/**
 * real-dify-check.js — 真实 Dify 实例接入自检（联调工具）
 * ---------------------------------------------------------------------------
 * 与 tests/integration-test.js 的区别：
 *   integration-test.js 打的是**契约桩**（无需凭据，验证前端网络层）
 *   real-dify-check.js  打的是**真实 Dify 实例**（需要 API Key，验证真实契约）
 *
 * 它用**真实的 js/api.js** 去访问真实 Dify，所以能直接回答：
 *   "我这 8 个应用，哪个 Key 配错了？哪个应用类型选错了？哪个输出契约对不上？"
 *
 * 用法：
 *   # 1) 只探测连通性与鉴权（不消耗 token，秒级）
 *   node tests/real-dify-check.js --probe
 *
 *   # 2) 完整跑一遍 8 个应用（会真实调用 Dify，消耗额度）
 *   node tests/real-dify-check.js
 *
 *   # 3) 用环境变量覆盖配置（推荐，避免把 Key 写进源码）
 *   DIFY_BASE_URL=https://api.dify.ai/v1 \
 *   DIFY_KEY_RISKPREDICTION=app-xxxx \
 *   node tests/real-dify-check.js
 *
 *   # 4) 机器可读输出
 *   node tests/real-dify-check.js --json
 *
 * 环境变量命名规则：DIFY_KEY_<APPID 大写>
 *   riskPrediction → DIFY_KEY_RISKPREDICTION
 *   homeData       → DIFY_KEY_HOMEDATA
 * ---------------------------------------------------------------------------
 */
'use strict';

const { JSDOM } = require('jsdom');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
// 代理感知的传输层：本沙箱只能经 HTTP_PROXY 出网，Node 内置 fetch 不读该变量
const dc = require(path.join(path.resolve(__dirname, '..'), 'tools', 'dify-console.js'));

const ROOT = path.resolve(__dirname, '..');
const ARGS = process.argv.slice(2);
const HAS = (f) => ARGS.indexOf(f) >= 0;
const PROBE_ONLY = HAS('--probe');
const JSON_OUT = HAS('--json');

/* ---------- 输出 ---------- */
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m'
};
const ok = (s) => C.green + '✅ ' + s + C.reset;
const bad = (s) => C.red + '❌ ' + s + C.reset;
const warn = (s) => C.yellow + '⚠️  ' + s + C.reset;
const dim = (s) => C.dim + s + C.reset;

const report = { baseUrl: null, probeOnly: PROBE_ONLY, startedAt: new Date().toISOString(), apps: [] };

/* ==================== 1. 读取项目配置 ==================== */

/**
 * 在隔离的 vm 上下文里执行 js/config.js，取出 DPA_CONFIG。
 * 不直接 require，因为它是个 IIFE，靠挂 window 导出。
 */
function loadConfig() {
  const code = fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'js/config.js' });
  return sandbox.window.DPA_CONFIG;
}

/** 环境变量覆盖：DIFY_BASE_URL / DIFY_KEY_<APPID> */
function applyEnvOverrides(cfg) {
  const applied = [];
  if (process.env.DIFY_BASE_URL) {
    cfg.DIFY.baseUrl = process.env.DIFY_BASE_URL;
    applied.push('baseUrl=' + cfg.DIFY.baseUrl);
  }
  Object.keys(cfg.DIFY.apps).forEach((appId) => {
    const envKey = 'DIFY_KEY_' + appId.toUpperCase();
    if (process.env[envKey]) {
      cfg.DIFY.apps[appId].apiKey = process.env[envKey];
      applied.push(appId + ' ← $' + envKey);
    }
  });
  if (process.env.DIFY_PROXY_MODE === '1' || process.env.DIFY_PROXY_MODE === 'true') {
    cfg.DIFY.proxyMode = true;
    applied.push('proxyMode=true');
  }
  return applied;
}

/* ==================== 2. 加载真实客户端（js/*.js） ==================== */

/** 每笔出网请求的记录：{ url, status, error? }。用于判定"是否真的调用了 Dify" */
const netLog = [];

/** 取出 [from, 末) 区间内、打到 baseUrl 且返回 2xx 的请求数 */
function countDifyHits(from, baseUrl) {
  const prefix = String(baseUrl).replace(/\/+$/, '');
  return netLog.slice(from).filter((e) => e.url.indexOf(prefix) === 0 && e.status >= 200 && e.status < 300).length;
}

function loadClient(cfg) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window;

  // 注入真实网络原语：js/api.js 里裸写的 fetch 解析到 window 上。
  // 注意：必须用 dify-console.js 的 fetchShim 而不是 globalThis.fetch ——
  // Node 的 fetch 不读 HTTP_PROXY，在只允许代理出网的沙箱里会 ECONNREFUSED。
  //
  // 同时记录每一笔请求：这是判断「是否真的打到 Dify」唯一可靠的依据。
  // 工作流可以靠返回值里的 source='local' 识别降级，但对话型应用只返回纯文本，
  // 拿不到 source —— 早先就是因此出现过「已降级本地引擎却判 ✅ 」的假通过。
  w.fetch = (...a) => {
    const url = String(a[0]);
    return dc.fetchShim(...a).then(
      (r) => { netLog.push({ url: url, status: r.status }); return r; },
      (e) => { netLog.push({ url: url, status: 0, error: e.message }); throw e; }
    );
  };
  w.AbortController = globalThis.AbortController;
  w.AbortSignal = globalThis.AbortSignal;
  w.TextDecoder = globalThis.TextDecoder;
  w.Headers = globalThis.Headers;
  w.Request = globalThis.Request;
  w.Response = globalThis.Response;

  const FILES = ['js/config.js', 'js/crypto.js', 'js/seed.js', 'js/store.js',
                 'js/ui.js', 'js/auth.js', 'js/mock-engine.js', 'js/api.js'];
  FILES.forEach((f) => w.eval(fs.readFileSync(path.join(ROOT, f), 'utf8')));

  // 覆盖为待测配置
  const live = w.DPA_CONFIG;
  live.USE_MOCK = false;
  live.DIFY.baseUrl = cfg.DIFY.baseUrl;
  live.DIFY.proxyMode = cfg.DIFY.proxyMode;
  live.DIFY.timeout = Number(process.env.DIFY_TIMEOUT || 60000);
  live.DIFY.retry = 0;   // 自检时不要重试，否则失败原因被掩盖
  Object.keys(cfg.DIFY.apps).forEach((id) => {
    if (live.DIFY.apps[id]) live.DIFY.apps[id].apiKey = cfg.DIFY.apps[id].apiKey;
  });

  w.DPA.auth.login('admin', 'admin123', true);
  return { window: w, DPA: w.DPA, CFG: live };
}

/* ==================== 3. 单个应用的探测 ==================== */

/** 直接用 fetch 探测：不经过 api.js，用于区分"网络/鉴权问题"与"契约问题" */
async function probeApp(baseUrl, appId, app, timeoutMs) {
  const url = String(baseUrl).replace(/\/$/, '') + '/parameters';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: app.apiKey ? { Authorization: 'Bearer ' + app.apiKey } : {},
      signal: ctrl.signal
    });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch (e) { /* 非 JSON */ }
    return { ok: res.ok, status: res.status, body: body, raw: text.slice(0, 300) };
  } catch (e) {
    return { ok: false, status: 0, error: e.name === 'AbortError' ? '超时（' + timeoutMs + 'ms）' : String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

/* ==================== 4. 各应用的业务探针 ==================== */

const PROBES = {
  homeData: {
    type: 'workflow',
    run: (api) => api.homeData(),
    expect: (r) => [
      ['articles 非空', Array.isArray(r.articles) && r.articles.length > 0],
      ['diabetesTypes 非空', Array.isArray(r.diabetesTypes) && r.diabetesTypes.length > 0],
      ['source=dify（未降级）', r.source === 'dify']
    ],
    hint: '工作流需输出 articles 与 diabetesTypes（或 diabetes_types / types）'
  },
  riskPrediction: {
    type: 'workflow',
    run: (api) => api.predictRisk({ age: 62, sex: '男', height: 170, weight: 92, waistline: 102, familyHistory: '有', systolicPressure: 145 }),
    expect: (r) => [
      ['level 合法', ['低风险', '中风险', '高风险'].indexOf(r.level) >= 0],
      ['score 为数字', typeof r.score === 'number'],
      ['probability 在 0~100', typeof r.probability === 'number' && r.probability >= 0 && r.probability <= 100],
      ['advice 非空', Array.isArray(r.advice) && r.advice.length > 0],
      ['source=dify（未降级）', r.source === 'dify']
    ],
    hint: '工作流需输出 level（必须是 低风险/中风险/高风险 三者之一）、score、probability、advice'
  },
  lifePlan: {
    type: 'workflow',
    run: (api) => api.generateLifePlan({ userInfo: { age: 52, sex: '男' }, lifeState: '', advice: '' }),
    expect: (r) => [
      ['plans 非空', Array.isArray(r.plans) && r.plans.length > 0],
      ['plans[].title 存在', !!(r.plans[0] && r.plans[0].title)],
      ['source=dify（未降级）', r.source === 'dify']
    ],
    hint: '工作流需输出 plans 数组，每项含 type/order/time/title/content'
  },
  healthNews: {
    type: 'workflow',
    run: (api) => api.generateNews({ userInfo: {}, tag: '糖尿病科普' }),
    expect: (r) => [
      ['article.title 存在', !!(r.article && r.article.title)],
      ['article.content 存在', !!(r.article && r.article.content)],
      ['source=dify（未降级）', r.source === 'dify']
    ],
    hint: '工作流需输出 article.title 与 article.content'
  },
  checkinAnalysis: {
    type: 'workflow',
    run: (api) => api.analyzeCheckin({
      planList: [{ id: 1, type: '饮食', title: '早餐' }, { id: 2, type: '运动', title: '快走' }],
      punchList: [{ _date: new Date().toISOString().slice(0, 10), _planId: 1, punch_type: '饮食', completion_status: '已完成' }],
      days: 7
    }),
    expect: (r) => [
      ['evaluation 合法', ['优秀', '良好', '需改进'].indexOf(r.evaluation) >= 0],
      ['rate 在 0~100', typeof r.rate === 'number' && r.rate >= 0 && r.rate <= 100],
      ['source=dify（未降级）', r.source === 'dify']
    ],
    hint: '工作流需输出 evaluation（必须是 优秀/良好/需改进 三者之一）与 rate'
  },
  doctorChat: {
    type: 'chat',
    stream: true,
    run: async (api) => {
      const deltas = [];
      const text = await api.doctorChat('2型糖尿病患者日常饮食要注意什么？', { onDelta: (d) => deltas.push(d) });
      return { text: text, deltas: deltas };
    },
    expect: (r) => [
      ['回复非空', r.text && r.text.length > 0],
      ['SSE 分块 > 1（真流式）', r.deltas.length > 1],
      ['分块拼接 == 完整文本', r.deltas.join('') === r.text]
    ],
    hint: '应用类型需为「对话型/Chatflow」，且开启流式返回'
  },
  aiAssistant: {
    type: 'chat',
    stream: true,
    run: async (api) => {
      const deltas = [];
      const text = await api.assistantChat('你能帮我做什么？', { onDelta: (d) => deltas.push(d) });
      return { text: text, deltas: deltas };
    },
    expect: (r) => [
      ['回复非空', r.text && r.text.length > 0],
      ['SSE 分块 > 1（真流式）', r.deltas.length > 1]
    ],
    hint: '应用类型需为「对话型/Chatflow」'
  },
  adminAgent: {
    type: 'agent',
    run: (api) => api.adminCommand('统计一下系统里的文章数量'),
    expect: (r) => [
      ['action=agent（未降级）', r.action === 'agent'],
      ['reply 非空', !!(r.reply && r.reply.length > 0)]
    ],
    hint: '应用类型需为「Agent」，走 /v1/chat-messages 阻塞模式'
  }
};

/* ==================== 5. 主流程 ==================== */

(async () => {
  const cfg = loadConfig();
  const overrides = applyEnvOverrides(cfg);
  const baseUrl = cfg.DIFY.baseUrl;
  const apps = cfg.DIFY.apps;

  report.baseUrl = baseUrl;

  if (!JSON_OUT) {
    console.log(C.bold + '===== 真实 Dify 实例接入自检 =====' + C.reset);
    console.log('  基址      : ' + baseUrl);
    console.log('  模式      : ' + (cfg.DIFY.proxyMode ? '反代模式（Key 由代理注入）' : '直连模式（前端持有 Key）'));
    if (overrides.length) console.log('  环境覆盖  : ' + overrides.join(', '));
    console.log('  探测模式  : ' + (PROBE_ONLY ? '仅连通性/鉴权（不消耗额度）' : '完整跑 8 个应用（会消耗额度）'));
    console.log('');
  }

  /* ---- 5.1 基址连通性 ---- */
  const isRelative = !/^https?:\/\//i.test(String(baseUrl));
  if (isRelative) {
    if (!JSON_OUT) {
      console.log(warn('当前 baseUrl 是相对路径「' + baseUrl + '」，本脚本在 Node 里跑，无法解析相对地址。'));
      console.log('');
      console.log('  相对路径是为「同源反向代理」准备的（浏览器里访问没问题）。');
      console.log('  做真实实例自检时，请显式指定真实基址：');
      console.log('');
      console.log('    # Dify Cloud');
      console.log('    DIFY_BASE_URL=https://api.dify.ai/v1 node tests/real-dify-check.js --probe');
      console.log('');
      console.log('    # 自部署');
      console.log('    DIFY_BASE_URL=http://192.168.1.10/v1 node tests/real-dify-check.js --probe');
    }
    report.fatal = 'relative-base-url';
    if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
    process.exit(2);
  }

  const baseProbe = await probeApp(baseUrl, '__base__', { apiKey: '' }, 15000);
  if (!baseProbe.status && baseProbe.error) {
    if (!JSON_OUT) {
      console.log(bad('基址不可达：' + baseUrl));
      console.log('   ' + baseProbe.error);
      console.log('');
      console.log('   排查方向：');
      console.log('   1) ' + C.bold + '云沙箱的端口会变' + C.reset + '——先核对浏览器里能打开的那个端口');
      console.log('      （实测过 47810 → 48140 → 46132。端口不对时网关回 502 / 直接断连，');
      console.log('       看起来像服务挂了，其实是地址过期。改 DIFY_BASE_URL 即可）');
      console.log('   2) 沙箱容器是否被挂起：云沙箱空闲或重启后容器会停，需在控制台重新启动');
      console.log('   3) 地址是否正确（Dify Cloud 是 https://api.dify.ai/v1，自部署是 http://<host>/v1）');
      console.log('   4) 若走 Nginx 反代，确认 location /v1/ 已启用');
    }
    report.fatal = 'base-unreachable: ' + baseProbe.error;
    if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }
  if (!JSON_OUT) console.log(ok('基址可达（HTTP ' + baseProbe.status + '，鉴权层已响应）') + '\n');

  /* ---- 5.2 逐应用 ---- */
  const configured = Object.keys(apps).filter((id) => {
    const k = apps[id].apiKey;
    return cfg.DIFY.proxyMode || (k && String(k).indexOf('app-') === 0);
  });

  if (!configured.length) {
    if (!JSON_OUT) {
      console.log(warn('没有任何应用配置了有效 API Key，无法继续。'));
      console.log('');
      console.log('请任选一种方式提供 Key：');
      console.log('  A) 改 js/config.js 的 DIFY.apps.<appId>.apiKey');
      console.log('  B) 用环境变量（推荐，不落源码）：');
      Object.keys(apps).forEach((id) => {
        console.log('       DIFY_KEY_' + id.toUpperCase() + '=app-xxxx');
      });
      console.log('  C) 开启反代模式：DIFY_PROXY_MODE=1（Key 由 Nginx 注入）');
    }
    report.fatal = 'no-api-key';
    if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  if (!JSON_OUT) {
    console.log(C.bold + '【应用清单】' + C.reset);
    Object.keys(apps).forEach((id) => {
      const has = cfg.DIFY.proxyMode || (apps[id].apiKey && String(apps[id].apiKey).indexOf('app-') === 0);
      const mark = has ? C.green + '已配置' + C.reset : C.dim + '未配置' + C.reset;
      console.log('  ' + mark + '  ' + id.padEnd(18) + dim(apps[id].name + '  [' + apps[id].type + ']'));
    });
    console.log('');
  }

  const { DPA } = loadClient(cfg);

  /* ---- 5.2a 仅探测模式 ---- */
  if (PROBE_ONLY) {
    if (!JSON_OUT) console.log(C.bold + '【鉴权探测】' + C.reset);
    for (const id of configured) {
      const app = apps[id];
      const r = await probeApp(baseUrl, id, app, Number(process.env.DIFY_TIMEOUT || 20000));
      const entry = { appId: id, name: app.name, expectedType: app.type, probe: r };
      if (r.ok) {
        entry.verdict = 'ok';
        if (!JSON_OUT) console.log('  ' + ok(id.padEnd(18)) + dim('HTTP ' + r.status + '  ' + JSON.stringify(r.body).slice(0, 60)));
      } else if (r.status === 401) {
        entry.verdict = 'bad-key';
        if (!JSON_OUT) console.log('  ' + bad(id.padEnd(18)) + C.red + 'HTTP 401 Key 无效' + C.reset + dim('  ' + (r.body && r.body.message || '')));
      } else if (r.status === 404) {
        entry.verdict = 'not-found';
        if (!JSON_OUT) console.log('  ' + bad(id.padEnd(18)) + C.red + 'HTTP 404 端点不存在' + C.reset + dim('  ' + baseUrl + '/parameters'));
      } else {
        entry.verdict = 'error';
        if (!JSON_OUT) console.log('  ' + bad(id.padEnd(18)) + C.red + 'HTTP ' + r.status + ' ' + C.reset + dim(r.error || r.raw || ''));
      }
      report.apps.push(entry);
    }
    if (!JSON_OUT) {
      const badCount = report.apps.filter((a) => a.verdict !== 'ok').length;
      console.log('');
      console.log(badCount ? bad(badCount + ' 个应用鉴权失败') : ok('全部 ' + report.apps.length + ' 个应用鉴权通过'));
      console.log(dim('（仅探测模式：只验证了可达性与鉴权，未验证输出契约）'));
    }
    if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
    process.exit(report.apps.some((a) => a.verdict !== 'ok') ? 1 : 0);
  }

  /* ---- 5.2b 完整业务验证 ---- */
  if (!JSON_OUT) console.log(C.bold + '【完整业务验证】' + C.reset);

  let failed = 0;
  for (const id of configured) {
    const app = apps[id];
    const probe = PROBES[id];
    const entry = { appId: id, name: app.name, expectedType: app.type, checks: [] };

    if (!probe) {
      entry.verdict = 'skipped';
      entry.reason = '本工具未定义该应用的探针';
      report.apps.push(entry);
      continue;
    }

    let result = null, error = null;
    const t0 = Date.now();
    const nFrom = netLog.length;   // 本次运行前的位置，用于隔离统计
    try {
      result = await probe.run(DPA.api);
    } catch (e) {
      error = e;
    }
    const cost = Date.now() - t0;
    const difyHits = countDifyHits(nFrom, baseUrl);

    if (error) {
      entry.verdict = 'error';
      entry.error = String(error.message || error);
      entry.elapsedMs = cost;
      failed++;
      if (!JSON_OUT) {
        console.log('  ' + bad(id.padEnd(18)) + C.red + '调用抛错' + C.reset + dim(' (' + cost + 'ms)'));
        console.log('     ↳ ' + entry.error);
        console.log('     ↳ 期望类型：' + probe.type + '　提示：' + probe.hint);
      }
      report.apps.push(entry);
      continue;
    }

    /*
     * 关键：`确实调用了 Dify` 必须作为一票否决项。
     * 否则一旦请求失败、前端静默降级到本地 mock 引擎，本地数据一样能通过
     * 「字段非空 / 取值合法」这类断言，测试会显示全绿 —— 而 Dify 根本没被调用。
     */
    const baseChecks = probe.expect(result).map(([name, pass]) => ({ name: name, pass: !!pass }));
    const checks = baseChecks.concat([
      { name: `确实调用了 Dify 且返回 2xx（命中 ${difyHits} 次）`, pass: difyHits > 0 }
    ]);
    entry.checks = checks;
    entry.elapsedMs = cost;
    entry.degraded = difyHits === 0;
    entry.difyHits = difyHits;
    entry.sample = JSON.stringify(result).slice(0, 240);

    const allPass = checks.every((c) => c.pass);
    entry.verdict = allPass ? 'ok' : 'contract-mismatch';
    if (!allPass) failed++;

    if (!JSON_OUT) {
      console.log('  ' + (allPass ? ok(id.padEnd(18)) : bad(id.padEnd(18))) + dim(cost + 'ms'));
      checks.forEach((c) => {
        console.log('       ' + (c.pass ? C.green + '·' : C.red + '·') + C.reset + ' ' + c.name);
      });
      if (!allPass) {
        console.log('       ' + C.yellow + '期望应用类型：' + probe.type + C.reset);
        console.log('       ' + C.yellow + '契约要求：' + probe.hint + C.reset);
        if (entry.degraded) {
          console.log('       ' + C.yellow + '注意：已降级到本地引擎（source=local），说明请求失败或契约不匹配' + C.reset);
        }
        console.log('       ' + dim('实际返回样本：' + entry.sample));
      }
    }
    report.apps.push(entry);
  }

  /* ---- 5.3 汇总 ---- */
  const total = report.apps.length;
  const passed = report.apps.filter((a) => a.verdict === 'ok').length;

  if (!JSON_OUT) {
    console.log('');
    console.log(C.bold + '===== 结果：' + passed + ' / ' + total + ' 通过 =====' + C.reset);
    const skipped = Object.keys(apps).filter((id) => configured.indexOf(id) < 0);
    if (skipped.length) {
      console.log(warn('未配置 Key，已跳过：' + skipped.join(', ')));
    }
    if (failed) {
      console.log('');
      console.log('失败应用的处理建议：');
      report.apps.filter((a) => a.verdict !== 'ok' && a.verdict !== 'skipped').forEach((a) => {
        const p = PROBES[a.appId];
        console.log('  · ' + a.appId + ' → ' + (p ? p.hint : ''));
        if (a.verdict === 'error') console.log('      报错：' + a.error);
        if (a.degraded) console.log('      现象：请求失败或契约不符 → 前端已降级本地引擎');
      });
      console.log('');
      console.log(dim('提示：Dify 工作流的输出是「JSON 字符串」时，前端会自动解包；'));
      console.log(dim('      但如果键名与文档不一致（如 diabetes_types vs diabetesTypes），仍会判为契约不匹配。'));
    }
  }

  report.summary = { total: total, passed: passed, failed: failed };
  if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  if (JSON_OUT) console.log(JSON.stringify(Object.assign(report, { fatal: String(e && e.stack || e) }), null, 2));
  else console.error('\n自检脚本异常：', e);
  process.exit(1);
});
