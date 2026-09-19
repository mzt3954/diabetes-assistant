/**
 * api.js — Dify 服务层
 * ------------------------------------------------------------------
 * 统一出口：页面只调用 api.xxx()，无需关心背后是 Dify 还是本地引擎。
 *  - 已配置 Dify Key  → 发起真实 HTTP / SSE 请求，并把返回结果**归一化**
 *                       成与本地引擎完全一致的契约
 *  - 未配置 / 请求失败 / 契约不匹配 → 自动降级到 mock-engine，并提示用户
 *
 * 【v2.1 修复】
 *  1. 重试策略：仅对网络异常/超时/5xx/429 重试，4xx 直接失败（避免 401 空转
 *     与 POST 工作流重复执行）；重试时保留调用方传入的 abort signal。
 *  2. 流式请求增加**空闲超时**，修复 Dify 挂起导致输入框永久禁用的问题。
 *  3. 为 8 个应用补齐 normalizeXxx：Dify 输出（常为 JSON 字符串）统一映射为
 *     页面期望的结构，契约不满足时降级而非渲染半成品。
 *  4. 流式已输出内容后不再重放本地回复，避免内容重复。
 *  5. 错误信息不再回显服务端响应体（仅写入控制台）。
 * ------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  var CFG = global.DPA_CONFIG;
  var mock = global.DPA.mock;
  var ui = global.DPA.ui;

  /* ==================== 通用工具 ==================== */

  /**
   * 拼接 Dify 完整地址：baseUrl + path（去掉 baseUrl 末尾斜杠）。
   * @param {string} path 接口路径，如 '/workflows/run'、'/chat-messages'
   * @returns {string} 拼接后的完整 URL
   */
  function endpoint(path) {
    return String(CFG.DIFY.baseUrl || '').replace(/\/$/, '') + path;
  }

  /**
   * 按应用 ID 取 Dify 应用配置对象。
   * @param {string} appId apps 中的键名（如 'riskPrediction'）
   * @returns {Object} 应用配置对象
   */
  function appConfig(appId) {
    var app = CFG.DIFY.apps[appId];
    if (!app) throw new Error('未注册的 Dify 应用: ' + appId);
    return app;
  }

  /**
   * 当前 Dify 会话的用户标识。
   * @returns {string} 当前登录用户名，未登录/读取异常时回退为 'anonymous'
   */
  function currentUser() {
    try {
      return global.DPA.store.session.username() || 'anonymous';
    } catch (e) {
      return 'anonymous';
    }
  }

  /** 合并多个 AbortSignal（优先用原生 AbortSignal.any） */
  function anySignal(signals) {
    var list = signals.filter(Boolean);
    if (list.length === 1) return list[0];
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
      return AbortSignal.any(list);
    }
    var ctrl = new AbortController();
    list.forEach(function (s) {
      if (s.aborted) { ctrl.abort(); return; }
      s.addEventListener('abort', function () { ctrl.abort(); }, { once: true });
    });
    return ctrl.signal;
  }

  /* ==================== 输出归一化 ==================== */

  /**
   * 把可能是「JSON 字符串」的值解析成对象。
   *
   * 真实大模型即使被要求「只输出 JSON」，仍常把结果包进 markdown 代码块
   * （```json ... ```）或前后各加一句说明。裸 JSON.parse 会在这种情况下
   * 直接失败，被上层判为「契约不匹配」并静默降级回本地引擎——表现为
   * 「看着在线、其实没走 Dify」，极难排查。因此这里做三级容错：
   *   1. 直接解析（正常路径，零开销）
   *   2. 剥离 ``` 围栏后再解析
   *   3. 截取首个 { 或 [ 到末个 } 或 ] 之间的内容再解析
   * 任何一级失败都返回 null，由调用方决定降级，绝不抛异常。
   */
  /**
   * 剥掉推理模型的 <think>…</think> 思考块。
   *
   * 实测：推理模型会在正式答案前输出一大段思考，形如
   *   <think>\n<!--dify-deepseek-reasoning-->用户要求统计…\n</think>{"articles":[…]}
   *
   * 两个场景后果不同，必须分开处理：
   *   - 工作流(JSON)：思考里的花括号会让「截取首尾括号」截错位置 → 解析失败 → 静默降级。
   *   - 聊天/智能体：思考过程会**原样显示给用户**（"AI<think>我需要复述意图…"），
   *     这是用户可见的缺陷，不只是解析问题。
   *
   * @param {string} s 原文
   * @param {boolean} textMode true=聊天正文：思考块未闭合说明"还在想"，正文视为空；
   *                           false=工作流：未闭合时尽力抢救后面以 { 或 [ 起头的正文。
   */
  function stripThink(s, textMode) {
    if (typeof s !== 'string' || s.indexOf('<think>') < 0) return s;

    // 没有闭合标签：说明思考块尚未结束（流式传输中途很常见）
    if (s.indexOf('</think>') < 0) {
      var open = s.indexOf('<think>');
      // <think> 之前的正文是有效内容，要保留（实测回复里就有 "AI" 这类前缀）
      if (textMode) return open > 0 ? s.slice(0, open) : '';
      return s.replace(/^[\s\S]*?<think>[\s\S]*?(\{|\[)/, '$1');
    }

    // 移除所有成对的思考块，保留块前与块后的正文
    return s.replace(/<think>[\s\S]*?<\/think>/g, '');
  }

  /**
   * 把值解析成对象（三级容错）。
   * 依次尝试：直接解析 → 剥离 markdown 代码块围栏 → 截取首尾 {/[ 之间的片段。
   * @param {*} v 待解析值（非字符串直接返回 null）
   * @returns {Object|null} 解析成功返回对象，失败返回 null（由调用方决定降级）
   */
  function tryParse(v) {
    if (typeof v !== 'string') return null;
    var s = stripThink(v.trim());
    if (!s) return null;

    try { return JSON.parse(s); } catch (e) { /* 进入容错分支 */ }

    // 2. 剥 markdown 代码块围栏：```json / ```JSON / ```
    var fence = s.match(/```[ \t]*(?:json)?[ \t]*\r?\n?([\s\S]*?)```/i);
    if (fence && fence[1]) {
      try { return JSON.parse(fence[1].trim()); } catch (e2) { s = fence[1].trim(); }
    }

    // 3. 截取首尾括号之间的片段
    var first = s.search(/[{[]/);
    var last = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    if (first > -1 && last > first) {
      try { return JSON.parse(s.slice(first, last + 1)); } catch (e3) { /* 放弃 */ }
    }

    return null;
  }

  /**
   * 从 Dify 工作流输出中取出结构化对象。
   * Dify 的 outputs 值通常都是字符串，且包装键名不固定，这里做统一拆包。
   */
  function unwrap(out) {
    if (out === null || out === undefined) return {};
    var parsed = tryParse(out);
    if (parsed && typeof parsed === 'object') return parsed;
    if (typeof out !== 'object') return {};
    var keys = ['result', 'output', 'outputs', 'data', 'text', 'answer', 'json', 'content'];
    for (var i = 0; i < keys.length; i++) {
      var v = out[keys[i]];
      if (v === undefined || v === null || v === '') continue;
      var p = tryParse(v);
      if (p && typeof p === 'object') return p;
      if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    }
    return out;
  }

  /** 数值转换；非法/非有限值回退到默认值 dft */
  function num(v, dft) {
    var n = Number(v);
    return isFinite(n) ? n : dft;
  }
  /** 百分比转换（0–100 取整钳制）；用于概率/比率字段归一 */
  function pct(v, dft) {
    return Math.max(0, Math.min(100, Math.round(num(v, dft === undefined ? 0 : dft))));
  }
  /** 字符串转换；null/undefined/空串回退到默认值 dft */
  function str(v, dft) {
    return (v === null || v === undefined || v === '') ? dft : String(v);
  }
  /** 数组归一：非数组一律返回空数组 */
  function arr(v) { return Array.isArray(v) ? v : []; }

  /**
   * 构造「Dify 契约不匹配」错误，并打上 .contract=true 标记。
   * @param {string} appId 应用 ID
   * @param {string} detail 契约不匹配的具体说明
   * @returns {Error} 带标记的错误对象
   */
  function contractError(appId, detail) {
    var e = new Error('Dify 返回契约不匹配（' + appId + '）：' + detail);
    e.contract = true;
    return e;
  }

  /** WF-1 首页数据 */
  function normalizeHome(out) {
    var o = unwrap(out);
    var articles = arr(o.articles);
    var types = arr(o.diabetesTypes || o.diabetes_types || o.types);
    if (!articles.length && !types.length) throw contractError('homeData', 'articles/diabetesTypes 均为空');
    return { articles: articles, diabetesTypes: types, source: 'dify' };
  }

  /** WF-2 风险预测 */
  function normalizeRisk(out) {
    var o = unwrap(out);
    var level = str(o.level, '');
    if (['低风险', '中风险', '高风险'].indexOf(level) < 0) {
      throw contractError('riskPrediction', 'level 取值非法: ' + level);
    }
    return {
      score: num(o.score, 0),
      maxScore: num(o.maxScore, 27),
      level: level,
      probability: pct(o.probability),
      bmi: num(o.bmi, 0),
      disease: str(o.disease, '未患病'),
      riskType: str(o.riskType, '暂无明显倾向'),
      factors: arr(o.factors).map(String),
      message: str(o.message, ''),
      advice: arr(o.advice).map(String),
      source: 'dify'
    };
  }

  /** WF-3 生活方案 */
  function normalizeLifePlan(out) {
    var o = unwrap(out);
    var plans = arr(o.plans || o.list);
    var cleaned = plans
      .filter(function (p) { return p && (p.title || p.content); })
      .map(function (p, i) {
        return {
          type: str(p.type, '其他'),
          order: num(p.order, i + 1),
          time: str(p.time, ''),
          title: str(p.title, '方案 ' + (i + 1)),
          content: str(p.content, '')
        };
      });
    if (!cleaned.length) throw contractError('lifePlan', 'plans 为空');
    return { plans: cleaned, summary: str(o.summary, '已为您生成 ' + cleaned.length + ' 条生活方案。'), source: 'dify' };
  }

  /** WF-4 健康资讯 */
  function normalizeNews(out) {
    var o = unwrap(out);
    var a = o.article || o;
    if (!a || !(a.title && a.content)) throw contractError('healthNews', '缺少 article.title / article.content');
    return {
      tags: arr(o.tags).map(String),
      tag: str(o.tag, str(a.category, '糖尿病科普')),
      article: {
        title: String(a.title),
        tags: arr(a.tags).map(String),
        author: str(a.author, 'AI 健康助手'),
        publish_time: str(a.publish_time, global.DPA.store.dateKey(new Date())),
        category: str(a.category, str(o.tag, '糖尿病科普')),
        content: String(a.content)
      },
      source: 'dify'
    };
  }

  /** WF-5 打卡分析 */
  function normalizeCheckin(out) {
    var o = unwrap(out);
    var evaluation = str(o.evaluation, '');
    if (['优秀', '良好', '需改进'].indexOf(evaluation) < 0) {
      throw contractError('checkinAnalysis', 'evaluation 取值非法: ' + evaluation);
    }
    var rate = pct(o.rate);
    return {
      days: num(o.days, 7),
      totalPlan: num(o.totalPlan, 0),
      expected: num(o.expected, 0),
      done: num(o.done, 0),
      rate: rate,
      streak: Math.max(0, num(o.streak, 0)),
      dietRate: pct(o.dietRate),
      exerciseRate: pct(o.exerciseRate || o.exRate),
      balance: pct(o.balance),
      dayStats: arr(o.dayStats),
      evaluation: evaluation,
      completionStatus: str(o.completionStatus, '完成率 ' + rate + '%'),
      suggestions: arr(o.suggestions).map(String),
      source: 'dify'
    };
  }

  /* ==================== 底层：请求 ==================== */

  /**
   * 带超时与重试的 fetch。
   * 重试条件：网络异常 / 超时 / 5xx / 429。
   * 4xx（如 401 Key 错误、422 参数错误）立即失败——重试无意义，且
   * POST 工作流重试可能造成重复执行。
   */
  function requestWithRetry(url, options, timeout, retry) {
    var attempt = 0;
    function run() {
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, timeout);
      var signal = options.signal ? anySignal([options.signal, ctrl.signal]) : ctrl.signal;
      var opts = Object.assign({}, options, { signal: signal });

      return fetch(url, opts).then(function (res) {
        clearTimeout(timer);
        if (!res.ok) {
          return res.text().then(function (body) {
            console.warn('[api] HTTP ' + res.status + ' ' + url, String(body).slice(0, 300));
            var err = new Error('服务返回 HTTP ' + res.status);
            err.status = res.status;
            err.retryable = res.status >= 500 || res.status === 429;
            throw err;
          });
        }
        return res;
      }).catch(function (err) {
        clearTimeout(timer);
        var retryable = err.retryable !== false;   // 网络错误/超时未显式标记 → 可重试
        if (retryable && attempt < retry) {
          attempt++;
          console.warn('[api] 第 ' + attempt + ' 次重试: ' + url);
          return run();
        }
        throw err;
      });
    }
    return run();
  }

  /**
   * 入参序列化。
   *
   * Dify 的 start 变量若是 `json_object` 类型，会强制要求传**字典**
   * （传数组会报 "xxx in input form must be a dict"）；而我们这里的
   * planList / punchList 天然是数组、userInfo 是对象。
   * 统一改成「文本型变量 + JSON 字符串」就没有这个形状约束了。
   *
   * 只处理对象与数组 —— 数字、字符串、布尔原样透传，
   * 否则 number 类型的变量拿到 "30" 这样的字符串可能被拒。
   */
  function serializeInputs(inputs) {
    var out = {};
    var src = inputs || {};
    for (var k in src) {
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
      var v = src[k];
      if (v === null || v === undefined) { out[k] = ''; continue; }
      if (typeof v === 'object') {
        try { out[k] = JSON.stringify(v); }
        catch (e) { out[k] = String(v); }
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  /** 工作流（阻塞模式） */
  function runWorkflowRaw(appId, inputs) {
    var app = appConfig(appId);
    var body = {
      inputs: serializeInputs(inputs),
      response_mode: 'blocking',
      user: currentUser()
    };
    return requestWithRetry(endpoint('/workflows/run'), {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + app.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }, CFG.DIFY.timeout, CFG.DIFY.retry)
      .then(function (res) { return res.json(); })
      .then(function (json) {
        if (!json || !json.data) throw new Error('响应格式异常');
        if (json.data.status === 'failed') throw new Error(json.data.error || '工作流执行失败');
        return json.data.outputs || {};
      });
  }

  /** Agent（阻塞模式） */
  function runAgentRaw(appId, query) {
    var app = appConfig(appId);
    var body = {
      inputs: {},
      query: query,
      response_mode: 'blocking',
      user: currentUser()
    };
    return requestWithRetry(endpoint('/chat-messages'), {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + app.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }, CFG.DIFY.timeout, CFG.DIFY.retry)
      .then(function (res) { return res.json(); })
      .then(function (json) {
        if (!json) throw new Error('响应格式异常');
        return str(json.answer, str(json.data && json.data.answer, ''));
      });
  }

  /**
   * 对话（SSE 流式）
   * @param {Object} opts { onDelta, onDone, conversationId, signal }
   * 带空闲超时：timeout 毫秒内未收到任何数据即中止，避免界面永久「打字中」。
   */
  function chatStreamRaw(appId, query, opts) {
    opts = opts || {};
    var app = appConfig(appId);
    var body = {
      inputs: {},
      query: query,
      response_mode: 'streaming',
      conversation_id: opts.conversationId || '',
      user: currentUser()
    };

    var ctrl = new AbortController();
    var idleTimer = null;
    function armIdle() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(function () { ctrl.abort(); }, CFG.DIFY.timeout);
    }
    function disarmIdle() { clearTimeout(idleTimer); idleTimer = null; }

    var signal = opts.signal ? anySignal([opts.signal, ctrl.signal]) : ctrl.signal;
    armIdle();

    return fetch(endpoint('/chat-messages'), {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + app.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: signal
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          console.warn('[api] chat-messages HTTP ' + res.status, String(t).slice(0, 300));
          var err = new Error('服务返回 HTTP ' + res.status);
          err.status = res.status;
          throw err;
        });
      }

      // 不支持流式读取时退回整体解析
      if (!res.body || !res.body.getReader) {
        return res.json().then(function (j) {
          var ans = stripThink(str(j && j.answer, ''), true);
          if (opts.onDelta && ans) opts.onDelta(ans);
          if (opts.onDone) opts.onDone(ans, (j && j.conversation_id) || '');
          return ans;
        });
      }

      var reader = res.body.getReader();
      var decoder = new TextDecoder('utf-8');
      var buffer = '';
      var raw = '';        // 模型原文（可能夹着 <think>）
      var emitted = 0;     // 已推给 onDelta 的"干净正文"长度
      var convId = opts.conversationId || '';

      /*
       * 增量推送必须在**累积原文**上去思考块、再取新增部分。
       * 若逐个 delta 判断 <think>，会被拆标签的情况打穿——
       * 比如 "</thi" 与 "nk>" 落在两个 chunk 里，就永远等不到闭合，
       * 之后的正误会一直被当成思考内容丢掉。
       */
      function pushClean() {
        var clean = stripThink(raw, true);
        if (clean.length > emitted) {
          var delta = clean.slice(emitted);
          emitted = clean.length;
          if (delta && opts.onDelta) opts.onDelta(delta);
        }
      }

      function handleEvent(chunk) {
        var lines = chunk.split('\n');
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line || line.indexOf('data:') !== 0) continue;
          var payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          var evt;
          try { evt = JSON.parse(payload); } catch (e) { continue; }
          if (evt.event === 'message' || evt.event === 'agent_message') {
            var delta = str(evt.answer, '');
            if (delta) { raw += delta; pushClean(); }
          } else if (evt.event === 'message_end') {
            convId = evt.conversation_id || convId;
          } else if (evt.event === 'error') {
            var err = new Error(evt.message || '服务返回错误');
            err.remote = true;
            throw err;
          }
        }
      }

      function pump() {
        return reader.read().then(function (r) {
          armIdle();
          if (r.done) {
            disarmIdle();
            var full = stripThink(raw, true);
            if (opts.onDone) opts.onDone(full, convId);
            return full;
          }
          buffer += decoder.decode(r.value, { stream: true });
          var idx;
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            handleEvent(buffer.slice(0, idx));
            buffer = buffer.slice(idx + 2);
          }
          return pump();
        });
      }

      return pump().then(function (v) { disarmIdle(); return v; }, function (e) { disarmIdle(); throw e; });
    }, function (e) {
      disarmIdle();
      throw e;
    });
  }

  /* ==================== 降级 ==================== */

  var FALLBACK_NOTICE_INTERVAL = 60000;   // 降级提示最小间隔，避免反复打扰
  var lastFallbackNotice = 0;

  /** 降级提示节流：距上次提示不足 FALLBACK_NOTICE_INTERVAL 时不再提醒，避免反复打扰 */
  function notifyFallbackOnce() {
    var now = Date.now();
    if (now - lastFallbackNotice < FALLBACK_NOTICE_INTERVAL) return;
    lastFallbackNotice = now;
    ui.notifyFallback();
  }

  /**
   * 降级执行本地引擎函数，并把结果包装成 Promise（同步抛出也转为 rejection）。
   * @param {Function} fn 本地引擎函数
   * @param {Array} args 透传给 fn 的参数
   * @returns {Promise} 本地执行结果
   */
  function fallback(fn, args) {
    notifyFallbackOnce();
    try {
      return Promise.resolve(fn.apply(null, args));
    } catch (e) {
      return Promise.reject(e);
    }
  }

  /* ==================== 高级业务方法（自动降级） ==================== */

  /** 1. 首页数据 */
  function homeData() {
    var local = function () {
      return { articles: global.DPA.store.articles.all(), diabetesTypes: global.DPA.store.types.all(), source: 'local' };
    };
    if (!CFG.isDifyReady('homeData')) return fallback(local, []);
    return runWorkflowRaw('homeData', {})
      .then(normalizeHome)
      .catch(function (err) { logFallback('homeData', err); return fallback(local, []); });
  }

  /** 2. 风险预测 */
  function predictRisk(inputs) {
    var local = function () { return mock.predictRisk(inputs); };
    if (!CFG.isDifyReady('riskPrediction')) return fallback(local, []);
    return runWorkflowRaw('riskPrediction', inputs)
      .then(normalizeRisk)
      .catch(function (err) { logFallback('riskPrediction', err); return fallback(local, []); });
  }

  /** 3. 生活方案生成 */
  function generateLifePlan(inputs) {
    var local = function () { return mock.generateLifePlan(inputs.userInfo, inputs.lifeState, inputs.advice); };
    if (!CFG.isDifyReady('lifePlan')) return fallback(local, []);
    return runWorkflowRaw('lifePlan', inputs)
      .then(normalizeLifePlan)
      .catch(function (err) { logFallback('lifePlan', err); return fallback(local, []); });
  }

  /** 4. 健康资讯生成 */
  function generateNews(inputs) {
    var local = function () { return mock.generateNews(inputs.userInfo, inputs.tag); };
    if (!CFG.isDifyReady('healthNews')) return fallback(local, []);
    return runWorkflowRaw('healthNews', inputs)
      .then(normalizeNews)
      .catch(function (err) { logFallback('healthNews', err); return fallback(local, []); });
  }

  /** 5. 打卡分析 */
  function analyzeCheckin(inputs) {
    var local = function () { return mock.analyzeCheckin(inputs.planList, inputs.punchList, inputs.days, inputs.anchorDate); };
    if (!CFG.isDifyReady('checkinAnalysis')) return fallback(local, []);
    return runWorkflowRaw('checkinAnalysis', inputs)
      .then(normalizeCheckin)
      .catch(function (err) { logFallback('checkinAnalysis', err); return fallback(local, []); });
  }

  /**
   * 流式对话 + 降级。
   * 关键：若 Dify 已输出过内容再失败，**不再重放本地回复**（否则气泡里会
   * 出现两段拼接的文本），而是把错误抛给页面层提示。
   */
  function chatWithFallback(appId, query, opts, localFactory) {
    opts = opts || {};
    var emitted = false;
    var wrapped = Object.assign({}, opts, {
      onDelta: function (d) {
        emitted = true;
        if (opts.onDelta) opts.onDelta(d);
      }
    });
    if (!CFG.isDifyReady(appId)) return fallback(localFactory, []);
    return chatStreamRaw(appId, query, wrapped).catch(function (err) {
      if (emitted) throw err;
      logFallback(appId, err);
      return fallback(localFactory, []);
    });
  }

  /** 6. 医师咨询（流式） */
  function doctorChat(query, opts) {
    opts = opts || {};
    return chatWithFallback('doctorChat', query, opts, function () {
      return simulateStream(mock.doctorReply(query, opts.doctor), opts);
    });
  }

  /** 7. AI 助手（流式） */
  function assistantChat(query, opts) {
    opts = opts || {};
    return chatWithFallback('aiAssistant', query, opts, function () {
      return simulateStream(mock.assistantReply(query), opts);
    });
  }

  /** 8. 管理助手 */
  function adminCommand(query) {
    var local = function () { return mock.adminCommand(query); };
    if (!CFG.isDifyReady('adminAgent')) return Promise.resolve(local());
    return runAgentRaw('adminAgent', query)
      .then(function (answer) {
        if (!answer) throw contractError('adminAgent', 'answer 为空');
        return { action: 'agent', reply: answer, refresh: true };
      })
      .catch(function (err) { logFallback('adminAgent', err); return fallback(local, []); });
  }

  /** 管理助手：确认后批量删除文章 */
  function adminDeleteArticles(ids) {
    var removed = global.DPA.store.articles.removeMany(ids);
    return Promise.resolve({ action: 'delete_articles_done', removed: removed, refresh: true });
  }

  /** 记录一次「降级到本地引擎」的原因（区分契约不匹配与请求失败），仅写入控制台 */
  function logFallback(appId, err) {
    if (err && err.contract) {
      console.warn('[api] ' + appId + ' 契约不匹配，已降级本地引擎：' + err.message);
    } else if (err) {
      console.warn('[api] ' + appId + ' 请求失败，已降级本地引擎：' + (err.message || err));
    }
  }

  /** 本地流式模拟：逐字回调，模拟真实打字机效果 */
  function simulateStream(text, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var full = String(text == null ? '' : text);
      var i = 0;
      var step = Math.max(1, Math.round(full.length / 120));
      var timer = setInterval(function () {
        if (opts.signal && opts.signal.aborted) {
          clearInterval(timer);
          resolve(full.slice(0, i));
          return;
        }
        var chunk = full.slice(i, i + step);
        i += step;
        if (chunk && opts.onDelta) opts.onDelta(chunk);
        if (i >= full.length) {
          clearInterval(timer);
          if (opts.onDone) opts.onDone(full, '');
          resolve(full);
        }
      }, 18);
    });
  }

  global.DPA = global.DPA || {};
  global.DPA.api = {
    /* 高级业务接口 */
    homeData: homeData,
    predictRisk: predictRisk,
    generateLifePlan: generateLifePlan,
    generateNews: generateNews,
    analyzeCheckin: analyzeCheckin,
    doctorChat: doctorChat,
    assistantChat: assistantChat,
    adminCommand: adminCommand,
    adminDeleteArticles: adminDeleteArticles,
    /* 底层接口（调试与联调测试用） */
    _raw: {
      runWorkflow: runWorkflowRaw,
      chatStream: chatStreamRaw,
      runAgent: runAgentRaw,
      normalize: {
        home: normalizeHome,
        risk: normalizeRisk,
        lifePlan: normalizeLifePlan,
        news: normalizeNews,
        checkin: normalizeCheckin
      },
      unwrap: unwrap,
      stripThink: stripThink,
      endpoint: endpoint
    }
  };
})(window);
