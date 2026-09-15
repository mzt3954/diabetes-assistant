/**
 * integration-test.js — Dify 真实联调测试（HTTP + SSE 全链路）
 * ---------------------------------------------------------------------------
 * 这是「真实联调」，不是 mock 掉 fetch 的假测试：
 *   起一个**真实的 HTTP 服务**（tests/mock-dify-server.js，严格复刻 Dify 契约），
 *   在 jsdom 里加载真实的 js/*.js，让 js/api.js 走真实的 fetch / SSE，
 *   覆盖 8 个应用的完整请求-响应-归一化链路，以及重试 / 降级 / 超时分支。
 *
 * 与 logic-test.js 的分工：
 *   logic-test.js        —— 归一化函数、算法、数据层的纯逻辑单测
 *   integration-test.js  —— 网络层：请求头、请求体、SSE 解析、重试策略、降级时机
 *
 * 运行：node tests/integration-test.js
 * ---------------------------------------------------------------------------
 */
'use strict';

const { JSDOM } = require('jsdom');
const path = require('path');
const fs = require('fs');
const { start } = require('./mock-dify-server');

const ROOT = path.resolve(__dirname, '..');
const FILES = [
  'js/config.js', 'js/crypto.js', 'js/seed.js', 'js/store.js',
  'js/ui.js', 'js/auth.js', 'js/mock-engine.js', 'js/api.js'
];

/* ---------- 断言框架（async） ---------- */
let pass = 0, fail = 0;
const failures = [];
const queue = [];
function test(name, fn) { queue.push({ name, fn }); }
function suite(t) { queue.push({ name: null, title: t }); }
function assert(c, m) { if (!c) throw new Error(m || '断言失败'); }
function eq(a, b, m) { if (a !== b) throw new Error((m || '') + ` 期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`); }

/* ---------- 环境准备 ---------- */
let srv;      // 桩服务
let window;   // jsdom window
let DPA;
let CFG;

function loadApp(apiBase, keys) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  window = dom.window;

  // 把 Node 的网络原语注入 jsdom：js/api.js 里裸写的 fetch/AbortController/TextDecoder
  // 会解析到 window 上，因此必须显式挂载，才能走真实 HTTP。
  window.fetch = (...args) => globalThis.fetch(...args);
  window.AbortController = globalThis.AbortController;
  window.AbortSignal = globalThis.AbortSignal;
  window.TextDecoder = globalThis.TextDecoder;
  window.Headers = globalThis.Headers;
  window.Request = globalThis.Request;
  window.Response = globalThis.Response;

  FILES.forEach((f) => window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  DPA = window.DPA;
  CFG = window.DPA_CONFIG;

  // 指向桩服务：直连模式 + 真实 app- Key（与 Dify 一致，一个应用一个 Key）
  CFG.USE_MOCK = false;
  CFG.DIFY.baseUrl = apiBase;
  CFG.DIFY.proxyMode = false;
  CFG.DIFY.timeout = 4000;
  CFG.DIFY.retry = 1;
  Object.keys(keys).forEach((appId) => {
    assert(CFG.DIFY.apps[appId], '配置里应存在应用 ' + appId);
    CFG.DIFY.apps[appId].apiKey = keys[appId];
  });

  // 登录，让 user 字段有值
  DPA.auth.login('admin', 'admin123', true);
}

/** 清空桩服务收到的请求记录 */
async function reset() {
  srv.requests.length = 0;
  srv.setFault('none');
}
const reqs = () => srv.requests;

/* ================================================================
   用例
   ================================================================ */

/* ---------- A. 连通性与鉴权 ---------- */
suite('【A · 连通性与鉴权】');

test('桩服务可访问，GET /v1/parameters 返回应用参数', async () => {
  const res = await window.fetch(srv.apiBase + '/parameters', {
    headers: { Authorization: 'Bearer ' + srv.keyByApp.riskPrediction }
  });
  eq(res.status, 200, 'HTTP 状态');
  const j = await res.json();
  assert(typeof j.introduction === 'string', '应有 introduction');
});

test('缺少 Authorization 时返回 401（前端据此降级）', async () => {
  const res = await window.fetch(srv.apiBase + '/workflows/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
  });
  eq(res.status, 401, 'HTTP 状态');
});

test('无效 API Key 返回 401', async () => {
  const res = await window.fetch(srv.apiBase + '/workflows/run', {
    method: 'POST',
    headers: { Authorization: 'Bearer app-not-exist', 'Content-Type': 'application/json' },
    body: '{}'
  });
  eq(res.status, 401, 'HTTP 状态');
});

test('isDifyReady 在填入真实 Key 后为 true', () => {
  eq(CFG.isDifyReady('riskPrediction'), true, 'riskPrediction');
  eq(CFG.isDifyReady('doctorChat'), true, 'doctorChat');
  eq(CFG.isOnline(), true, '整体应处于在线模式');
});

/* ---------- B. 5 个工作流应用（阻塞 HTTP） ---------- */
suite('【B · 工作流应用 · 真实 HTTP】');

test('WF-1 homeData：返回 Dify 数据而非本地降级', async () => {
  await reset();
  const r = await DPA.api.homeData();
  eq(r.source, 'dify', '来源应为 dify');
  assert(r.articles.length >= 2, '应有 Dify 文章');
  assert(r.diabetesTypes.length >= 2, '应有 Dify 类型');
  // 证明 outputs 里的 JSON 字符串被 unwrap 解开
  assert(String(r.articles[0].title).indexOf('Dify 返回') === 0, '标题应来自桩服务');
  eq(reqs().length, 1, '应只发 1 次请求');
  eq(reqs()[0].path, '/v1/workflows/run', '请求路径');
});

test('WF-2 riskPrediction：inputs 透传 + 归一化', async () => {
  await reset();
  const r = await DPA.api.predictRisk({ age: 52, sex: '男', height: 170, weight: 85, waistline: 95, familyHistory: '有', systolicPressure: 135 });
  eq(r.source, 'dify', '来源');
  eq(r.level, '高风险', '等级');
  eq(r.score, 18, '分数');
  eq(r.probability, 72, '概率');
  assert(r.advice.length >= 2, '建议条数');
  // 服务端回显了 age，证明请求体真的送达
  eq(reqs()[0].body.inputs.age, 52, 'inputs.age 应透传到服务端');
  eq(reqs()[0].body.response_mode, 'blocking', '应为阻塞模式');
  eq(reqs()[0].body.user, 'admin', 'user 应为当前登录用户');
});

test('WF-3 lifePlan：plans 归一化且保留 time/title/content', async () => {
  await reset();
  const r = await DPA.api.generateLifePlan({ userInfo: {}, lifeState: '', advice: '' });
  eq(r.source, 'dify', '来源');
  assert(r.plans.length >= 2, '方案条数');
  assert(r.plans[0].time, '应保留 time 字段');
  assert(r.summary.indexOf('Dify') >= 0, 'summary 应来自服务端');
});

test('WF-4 healthNews：article 嵌套结构被正确取出', async () => {
  await reset();
  const r = await DPA.api.generateNews({ userInfo: {}, tag: '饮食指导' });
  eq(r.source, 'dify', '来源');
  assert(r.article.title.indexOf('Dify 生成') === 0, '标题来自桩服务');
  eq(r.article.category, '糖尿病科普', '分类');
  assert(r.article.content.indexOf('##') >= 0, '正文含 Markdown');
});

test('WF-5 checkinAnalysis：三维指标归一化', async () => {
  await reset();
  const r = await DPA.api.analyzeCheckin({ planList: [], punchList: [], days: 7 });
  eq(r.source, 'dify', '来源');
  eq(r.rate, 86, '完成率');
  eq(r.streak, 6, '连续天数');
  eq(r.balance, 85, '均衡度');
  eq(r.evaluation, '优秀', '评级');
  eq(reqs()[0].body.inputs.days, 7, 'days 应透传');
});

test('请求头携带 Bearer Key（每个应用各自的 Key）', async () => {
  await reset();
  await DPA.api.predictRisk({ age: 40, sex: '女', height: 160, weight: 55, waistline: 70, familyHistory: '无', systolicPressure: 110 });
  eq(reqs()[0].app, 'riskPrediction', '服务端按 Key 解析出的应用应为 riskPrediction');
});

/* ---------- C. 对话应用（SSE 流式） ---------- */
suite('【C · 对话应用 · SSE 流式】');

test('CHAT-1 doctorChat：真实 SSE 流式，分块回调', async () => {
  await reset();
  const deltas = [];
  const text = await DPA.api.doctorChat('2型糖尿病怎么吃', { onDelta: (d) => deltas.push(d) });

  assert(text.length > 30, '应收到完整回复，实际长度 ' + text.length);
  assert(text.indexOf('Dify 医师助手') >= 0, '内容应来自桩服务');
  assert(deltas.length > 1, '应按块流式回调，实际块数 ' + deltas.length);
  eq(deltas.join(''), text, '分块拼接应等于完整文本');
  eq(reqs()[0].body.response_mode, 'streaming', '应为流式模式');
  eq(reqs()[0].body.conversation_id, '', '首次对话 conversation_id 应为空');
});

test('CHAT-2 assistantChat：真实 SSE 流式', async () => {
  await reset();
  let full = '';
  const text = await DPA.api.assistantChat('你能做什么', { onDelta: (d) => { full += d; } });
  assert(text.indexOf('Dify 智能助手') >= 0, '内容应来自桩服务');
  eq(full, text, 'onDelta 累积应等于返回值');
});

test('onDone 回调收到完整文本与会话 ID', async () => {
  await reset();
  let done = null;
  await DPA.api.doctorChat('测试 onDone', { onDone: (t, cid) => { done = { t, cid }; } });
  assert(done, 'onDone 应被调用');
  assert(done.t.indexOf('Dify 医师助手') >= 0, 'onDone 文本');
  assert(done.cid && done.cid.indexOf('conv-') === 0, '应返回 conversation_id，实际 ' + done.cid);
});

test('AGENT-1 adminAgent：阻塞模式返回 answer', async () => {
  await reset();
  const r = await DPA.api.adminCommand('帮我看看有哪些文章');
  eq(r.action, 'agent', 'action');
  assert(r.reply.indexOf('Dify 管理助手') >= 0, '回复应来自桩服务');
  eq(r.refresh, true, 'refresh');
  eq(reqs()[0].body.response_mode, 'blocking', 'Agent 用阻塞模式');
});

/* ---------- D. 重试策略 ---------- */
suite('【D · 重试策略】');

test('5xx 会重试（retry=1 → 共 2 次请求），最终降级本地', async () => {
  await reset();
  srv.setFault('server-error');
  const r = await DPA.api.predictRisk({ age: 50, sex: '男', height: 170, weight: 80, waistline: 92, familyHistory: '无', systolicPressure: 125 });
  eq(r.source, 'local', '应降级本地引擎');
  eq(reqs().length, 2, '5xx 应重试 1 次，共 2 次请求，实际 ' + reqs().length);
});

test('4xx（401）不重试，直接降级（避免无效空转与重复执行）', async () => {
  await reset();
  // 把 Key 改成无效值 → 桩服务返回 401
  const good = CFG.DIFY.apps.riskPrediction.apiKey;
  CFG.DIFY.apps.riskPrediction.apiKey = 'app-wrong-key';
  const r = await DPA.api.predictRisk({ age: 50, sex: '男', height: 170, weight: 80, waistline: 92, familyHistory: '无', systolicPressure: 125 });
  CFG.DIFY.apps.riskPrediction.apiKey = good;
  eq(r.source, 'local', '应降级本地引擎');
  eq(reqs().length, 1, '401 不应重试，应只请求 1 次，实际 ' + reqs().length);
});

test('网络不可达时降级本地（不抛给页面）', async () => {
  await reset();
  const good = CFG.DIFY.baseUrl;
  CFG.DIFY.baseUrl = 'http://127.0.0.1:1';   // 必然连接失败
  const r = await DPA.api.predictRisk({ age: 50, sex: '男', height: 170, weight: 80, waistline: 92, familyHistory: '无', systolicPressure: 125 });
  CFG.DIFY.baseUrl = good;
  eq(r.source, 'local', '应降级本地引擎');
  assert(r.level, '仍应返回可用结果');
});

/* ---------- E. 契约不匹配 → 降级 ---------- */
suite('【E · 契约不匹配 → 降级】');

test('工作流返回非 JSON 输出时降级（而非渲染半成品）', async () => {
  await reset();
  srv.setFault('bad-contract');
  const r = await DPA.api.predictRisk({ age: 50, sex: '男', height: 170, weight: 80, waistline: 92, familyHistory: '无', systolicPressure: 125 });
  eq(r.source, 'local', '契约不匹配应降级');
  assert(r.level, '应给出可用的本地结果');
});

test('对话 answer 为空时降级到本地回复', async () => {
  await reset();
  srv.setFault('bad-contract');
  const text = await DPA.api.assistantChat('空回复测试', {});
  assert(text.length > 10, '应给出本地回复');
});

/* ---------- F. SSE 异常与空闲超时 ---------- */
suite('【F · SSE 异常与空闲超时】');

test('SSE 中途返回 error 事件 → 抛错给页面（已输出内容不回滚重放）', async () => {
  await reset();
  srv.setFault('sse-error');
  const deltas = [];
  let err = null;
  try {
    await DPA.api.doctorChat('触发 sse error', { onDelta: (d) => deltas.push(d) });
  } catch (e) { err = e; }
  assert(err, '应抛出错误');
  assert(deltas.length >= 1, '已输出的分块应已回调给页面');
  eq(deltas.join(''), '部分内容', '不应重放本地回复（否则会出现重复内容）');
});

test('SSE 挂起时按空闲超时中止，不会永久卡住界面', async () => {
  await reset();
  const saved = CFG.DIFY.timeout;
  CFG.DIFY.timeout = 300;              // 缩短空闲超时，加快测试
  srv.setFault('hang');
  const t0 = Date.now();
  let err = null;
  try {
    await DPA.api.doctorChat('挂起测试', {});
  } catch (e) { err = e; }
  const cost = Date.now() - t0;
  CFG.DIFY.timeout = saved;
  assert(err, '应因空闲超时抛错');
  assert(cost < 3000, '应在超时后及时返回，实际耗时 ' + cost + 'ms');
});

/* ---------- G. 端到端：请求体结构符合 Dify 契约 ---------- */
suite('【G · 请求体契约】');

test('工作流请求体包含 inputs / response_mode / user', async () => {
  await reset();
  await DPA.api.analyzeCheckin({ planList: [{ id: 1, type: '饮食' }], punchList: [], days: 7 });
  const b = reqs()[0].body;
  assert('inputs' in b, '应有 inputs');
  eq(b.response_mode, 'blocking', 'response_mode');
  assert(b.user, '应有 user');
  eq(b.inputs.days, 7, 'inputs.days');
});

test('对话请求体包含 query / response_mode / conversation_id / user', async () => {
  await reset();
  await DPA.api.assistantChat('契约检查', {});
  const b = reqs()[0].body;
  eq(b.query, '契约检查', 'query');
  eq(b.response_mode, 'streaming', 'response_mode');
  eq(b.conversation_id, '', 'conversation_id');
  assert(b.user, 'user');
});

test('conversationId 透传（多轮对话）', async () => {
  await reset();
  await DPA.api.doctorChat('第二轮', { conversationId: 'conv-abc-123' });
  eq(reqs()[0].body.conversation_id, 'conv-abc-123', '应透传 conversation_id');
});

/* ================================================================
   执行
   ================================================================ */
(async () => {
  console.log('===== Dify 联调集成测试 =====\n');
  console.log('正在启动 Dify 契约桩服务...');

  srv = await start({ port: 0 });
  console.log('桩服务地址：' + srv.apiBase + '\n');

  loadApp(srv.apiBase, srv.keyByApp);
  console.log('已加载 js/*.js 并指向桩服务（直连模式，8 个应用 Key 已注入）\n');

  for (const item of queue) {
    if (item.name === null) { console.log('\n' + item.title); continue; }
    try {
      await item.fn();
      pass++;
      console.log('✅ ' + item.name);
    } catch (e) {
      fail++;
      const msg = (e && e.message) || String(e);
      failures.push(item.name + ' → ' + msg);
      console.log('❌ ' + item.name + '\n     ↳ ' + msg);
    }
  }

  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
  if (failures.length) {
    console.log('\n失败用例：');
    failures.forEach((f) => console.log('  · ' + f));
  }

  await srv.close();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error('\n集成测试启动失败：', e);
  if (srv) await srv.close();
  process.exit(1);
});
