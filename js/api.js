/**
 * api.js — Dify 服务层
 * ------------------------------------------------------------------
 * 统一出口：页面只调用 api.xxx()，无需关心背后是 Dify 还是本地引擎。
 *  - 已配置 Dify Key  → 发起真实 HTTP / SSE 请求
 *  - 未配置 / 请求失败 → 自动降级到 mock-engine，并提示用户
 * ------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  var CFG = global.DPA_CONFIG;
  var mock = global.DPA.mock;
  var ui = global.DPA.ui;

  function appConfig(appId) {
    var app = CFG.DIFY.apps[appId];
    if (!app) throw new Error('未注册的 Dify 应用: ' + appId);
    return app;
  }

  function requestWithRetry(url, options, timeout, retry) {
    var attempt = 0;
    function run() {
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, timeout);
      var opts = Object.assign({}, options, { signal: ctrl.signal });
      return fetch(url, opts).then(function (res) {
        clearTimeout(timer);
        if (!res.ok) return res.text().then(function (t) { throw new Error('HTTP ' + res.status + ': ' + t.slice(0, 200)); });
        return res;
      }).catch(function (err) {
        clearTimeout(timer);
        if (attempt < retry) { attempt++; return run(); }
        throw err;
      });
    }
    return run();
  }

  function runWorkflowRaw(appId, inputs) {
    var app = appConfig(appId);
    var url = CFG.DIFY.baseUrl.replace(/\/$/, '') + '/workflows/run';
    var body = { inputs: inputs || {}, response_mode: 'blocking', user: (global.DPA.store.session.username() || 'anonymous') };
    return requestWithRetry(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + app.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, CFG.DIFY.timeout, CFG.DIFY.retry)
      .then(function (res) { return res.json(); })
      .then(function (json) {
        if (!json || !json.data) throw new Error('响应格式异常');
        if (json.data.status === 'failed') throw new Error(json.data.error || '工作流执行失败');
        return json.data.outputs || {};
      });
  }

  function runAgentRaw(appId, query) {
    var app = appConfig(appId);
    var url = CFG.DIFY.baseUrl.replace(/\/$/, '') + '/chat-messages';
    var body = { inputs: {}, query: query, response_mode: 'blocking', user: (global.DPA.store.session.username() || 'anonymous') };
    return requestWithRetry(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + app.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, CFG.DIFY.timeout, CFG.DIFY.retry)
      .then(function (res) { return res.json(); })
      .then(function (json) { return json.answer || json.data && json.data.answer || ''; });
  }

  function chatStreamRaw(appId, query, opts) {
    opts = opts || {};
    var app = appConfig(appId);
    var url = CFG.DIFY.baseUrl.replace(/\/$/, '') + '/chat-messages';
    var body = { inputs: {}, query: query, response_mode: 'streaming', conversation_id: opts.conversationId || '', user: (global.DPA.store.session.username() || 'anonymous') };
    return fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + app.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal
    }).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { throw new Error('HTTP ' + res.status); });
      if (!res.body || !res.body.getReader) return res.json().then(function (j) {
        var ans = j.answer || '';
        if (opts.onDelta) opts.onDelta(ans);
        if (opts.onDone) opts.onDone(ans, j.conversation_id || '');
      });
      var reader = res.body.getReader();
      var decoder = new TextDecoder('utf-8');
      var buffer = ''; var full = ''; var convId = opts.conversationId || '';
      function handleEvent(chunk) {
        var lines = chunk.split('\n');
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line || line.indexOf('data:') !== 0) continue;
          var payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          var evt; try { evt = JSON.parse(payload); } catch (e) { continue; }
          if (evt.event === 'message' || evt.event === 'agent_message') { var delta = evt.answer || ''; if (delta) { full += delta; if (opts.onDelta) opts.onDelta(delta); } }
          else if (evt.event === 'message_end') convId = evt.conversation_id || convId;
          else if (evt.event === 'error') throw new Error(evt.message || '服务返回错误');
        }
      }
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) { if (opts.onDone) opts.onDone(full, convId); return full; }
          buffer += decoder.decode(r.value, { stream: true });
          var idx; while ((idx = buffer.indexOf('\n\n')) >= 0) { handleEvent(buffer.slice(0, idx)); buffer = buffer.slice(idx + 2); }
          return pump();
        });
      }
      return pump();
    });
  }

  function fallback(fn, args) { ui.notifyFallback(); try { return Promise.resolve(fn.apply(null, args)); } catch (e) { return Promise.reject(e); } }

  function homeData() {
    var local = function () { return { articles: global.DPA.store.articles.all(), diabetesTypes: global.DPA.store.types.all(), source: 'local' }; };
    if (!CFG.isDifyReady('homeData')) return fallback(local, []);
    return runWorkflowRaw('homeData', {}).catch(function () { return fallback(local, []); });
  }

  function predictRisk(inputs) {
    var local = function () { return mock.predictRisk(inputs); };
    if (!CFG.isDifyReady('riskPrediction')) return fallback(local, []);
    return runWorkflowRaw('riskPrediction', inputs)
      .then(function (out) { if (out && typeof out.result === 'string') { try { return JSON.parse(out.result); } catch (e) { return out; } } return out; })
      .catch(function () { return fallback(local, []); });
  }

  function generateLifePlan(inputs) {
    var local = function () { return mock.generateLifePlan(inputs.userInfo, inputs.lifeState, inputs.advice); };
    if (!CFG.isDifyReady('lifePlan')) return fallback(local, []);
    return runWorkflowRaw('lifePlan', inputs).catch(function () { return fallback(local, []); });
  }

  function generateNews(inputs) {
    var local = function () { return mock.generateNews(inputs.userInfo, inputs.tag); };
    if (!CFG.isDifyReady('healthNews')) return fallback(local, []);
    return runWorkflowRaw('healthNews', inputs).catch(function () { return fallback(local, []); });
  }

  function analyzeCheckin(inputs) {
    var local = function () { return mock.analyzeCheckin(inputs.planList, inputs.punchList, inputs.days); };
    if (!CFG.isDifyReady('checkinAnalysis')) return fallback(local, []);
    return runWorkflowRaw('checkinAnalysis', inputs).catch(function () { return fallback(local, []); });
  }

  function doctorChat(query, opts) {
    opts = opts || {};
    var local = function () { return simulateStream(mock.doctorReply(query, opts.doctor), opts); };
    if (!CFG.isDifyReady('doctorChat')) return fallback(local, []);
    return chatStreamRaw('doctorChat', query, opts).catch(function () { return fallback(local, []); });
  }

  function assistantChat(query, opts) {
    opts = opts || {};
    var local = function () { return simulateStream(mock.assistantReply(query), opts); };
    if (!CFG.isDifyReady('aiAssistant')) return fallback(local, []);
    return chatStreamRaw('aiAssistant', query, opts).catch(function () { return fallback(local, []); });
  }

  function adminCommand(query) {
    var local = function () { return mock.adminCommand(query); };
    if (!CFG.isDifyReady('adminAgent')) return Promise.resolve(local());
    return runAgentRaw('adminAgent', query).then(function (answer) { return { action: 'agent', reply: answer, refresh: true }; }).catch(function () { return fallback(local, []); });
  }

  function simulateStream(text, opts) {
    return new Promise(function (resolve) {
      var i = 0; var step = Math.max(1, Math.round(text.length / 120));
      var timer = setInterval(function () {
        if (opts.signal && opts.signal.aborted) { clearInterval(timer); resolve(text.slice(0, i)); return; }
        var chunk = text.slice(i, i + step); i += step;
        if (chunk && opts.onDelta) opts.onDelta(chunk);
        if (i >= text.length) { clearInterval(timer); if (opts.onDone) opts.onDone(text, ''); resolve(text); }
      }, 18);
    });
  }

  global.DPA = global.DPA || {};
  global.DPA.api = {
    homeData: homeData, predictRisk: predictRisk, generateLifePlan: generateLifePlan, generateNews: generateNews,
    analyzeCheckin: analyzeCheckin, doctorChat: doctorChat, assistantChat: assistantChat, adminCommand: adminCommand,
    _raw: { runWorkflow: runWorkflowRaw, chatStream: chatStreamRaw, runAgent: runAgentRaw }
  };
})(window);