/**
 * mock-dify-server.js — Dify API 契约桩服务
 * ---------------------------------------------------------------------------
 * 用途：在没有真实 Dify 实例 / 没有 API Key 的环境下，提供一份**契约忠实**的
 *       Dify 服务端，用来对 js/api.js 做真实的 HTTP + SSE 联调测试。
 *
 * 它严格复刻 Dify 的以下行为：
 *   1. 路由按 **API Key** 区分应用（与 Dify 一致：一个应用一个 Key），
 *      而不是按 URL 路径。同一个 /v1/workflows/run 服务 5 个工作流应用。
 *   2. 鉴权：必须携带 `Authorization: Bearer app-xxx`，否则 401。
 *   3. 工作流阻塞响应结构：
 *      { workflow_run_id, task_id, data: { id, workflow_id, status, outputs,
 *        error, elapsed_time, total_tokens, created_at, finished_at } }
 *      且 outputs 的值是 **JSON 字符串**（Dify 的真实行为，用于检验 unwrap）。
 *   4. 对话流式响应：text/event-stream，事件序列
 *      message* → message_end（错误时插入 error 事件）。
 *   5. 对话阻塞响应：{ event:'message', answer, conversation_id, ... }
 *   6. GET /v1/parameters 返回应用参数。
 *   7. 故障注入（仅测试用）：可返回 401 / 500 / 契约不匹配 / SSE error，
 *      用于验证前端「重试」与「降级」两条路径。
 *
 * 用法：
 *   node tests/mock-dify-server.js                    # 只起 API（默认 8080）
 *   node tests/mock-dify-server.js --serve .          # 同时托管静态站点（联调演示）
 *   node tests/mock-dify-server.js --port 8080 --serve .
 *
 * 作为模块：
 *   const { start } = require('./mock-dify-server');
 *   const srv = await start({ port: 0, serve: null });
 *   srv.port, srv.url, srv.requests, srv.setFault('none'), srv.close()
 * ---------------------------------------------------------------------------
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

/* ==================== 应用注册表（Key → 应用） ==================== */

const APPS = {
  'app-wf-home-key':     { id: 'homeData',        name: '首页数据管理',     type: 'workflow' },
  'app-chat-doctor-key': { id: 'doctorChat',      name: '医师咨询助手',     type: 'chat' },
  'app-wf-risk-key':     { id: 'riskPrediction',  name: '个人信息与风险预测', type: 'workflow' },
  'app-wf-lifeplan-key': { id: 'lifePlan',        name: '生活方案定制',     type: 'workflow' },
  'app-wf-news-key':     { id: 'healthNews',      name: '健康资讯生成',     type: 'workflow' },
  'app-wf-checkin-key':  { id: 'checkinAnalysis', name: '打卡分析',         type: 'workflow' },
  'app-chat-assistant-key': { id: 'aiAssistant',  name: 'AI智能助手',       type: 'chat' },
  'app-agent-admin-key': { id: 'adminAgent',      name: 'AI管理助手',       type: 'agent' }
};

/** 测试用：把 key 与 appId 对应关系导出，供集成测试构造 config */
const KEY_BY_APP = {};
Object.keys(APPS).forEach((k) => { KEY_BY_APP[APPS[k].id] = k; });

/* ==================== 各应用的 outputs 造数 ==================== */

/** 注意：Dify 的 outputs 值通常是字符串，这里刻意用 JSON 字符串以检验 unwrap */
const WORKFLOW_OUTPUTS = {
  homeData: () => ({
    result: JSON.stringify({
      articles: [
        { article_id: 901, title: 'Dify 返回：糖尿病早期信号', category: '糖尿病科普', content: '多饮多尿多食体重下降', views: 12, publish_time: '2026-09-01' },
        { article_id: 902, title: 'Dify 返回：控糖饮食三原则', category: '饮食指导', content: '主食定量、粗细搭配、先菜后饭', views: 8, publish_time: '2026-09-02' }
      ],
      diabetesTypes: [
        { type_id: 91, type_name: '1型糖尿病', description: 'Dify 描述：胰岛素绝对缺乏' },
        { type_id: 92, type_name: '2型糖尿病', description: 'Dify 描述：胰岛素抵抗为主' }
      ]
    })
  }),

  riskPrediction: (inputs) => ({
    result: JSON.stringify({
      score: 18,
      maxScore: 27,
      level: '高风险',
      probability: 72,
      bmi: 29.4,
      disease: '未患病',
      riskType: '2型糖尿病倾向',
      factors: ['糖尿病家族史', '年龄≥45岁', '腰围超标'],
      message: 'Dify 综合评估：建议尽快就医筛查。',
      advice: ['尽快到内分泌科就诊', '每周至少 150 分钟中等强度运动']
    }),
    // 回显一个输入，证明 inputs 真的透传到了服务端
    echo_age: String((inputs && inputs.age) || '')
  }),

  lifePlan: () => ({
    result: JSON.stringify({
      plans: [
        { type: '饮食', order: 1, time: '07:30', title: 'Dify 早餐方案', content: '全麦面包 1 片 + 水煮蛋 1 个 + 无糖豆浆 200ml' },
        { type: '运动', order: 2, time: '19:00', title: 'Dify 运动方案', content: '快走 30 分钟，心率控制在 (170-年龄) 次/分' }
      ],
      summary: 'Dify 已为您生成 2 条生活方案。'
    })
  }),

  healthNews: (inputs) => ({
    result: JSON.stringify({
      tags: ['控糖', '运动'],
      tag: (inputs && inputs.tag) || '糖尿病科普',
      article: {
        title: 'Dify 生成：秋冬季控糖要点',
        tags: ['控糖'],
        author: 'Dify AI 健康助手',
        publish_time: '2026-09-14',
        category: '糖尿病科普',
        content: '## 一、饮食\n秋冬进补需控制总热量。\n\n## 二、运动\n餐后 1 小时散步 20 分钟。'
      }
    })
  }),

  checkinAnalysis: (inputs) => ({
    result: JSON.stringify({
      days: (inputs && inputs.days) || 7,
      totalPlan: 4,
      expected: 28,
      done: 24,
      rate: 86,
      streak: 6,
      dietRate: 90,
      exerciseRate: 80,
      balance: 85,
      dayStats: [],
      evaluation: '优秀',
      completionStatus: 'Dify 分析：近 7 天完成率 86%',
      suggestions: ['保持当前节奏', '可适当增加力量训练']
    })
  })
};

/* ==================== SSE 回复文本 ==================== */

const CHAT_REPLY = {
  doctorChat: (q) => '【Dify 医师助手】针对「' + q + '」的建议：\n1. 控制每日主食总量，优先选择低升糖指数食物；\n2. 餐后 1 小时进行 20 分钟快走；\n3. 每 3 个月复查一次糖化血红蛋白。以上内容不能替代面诊，请遵医嘱。',
  aiAssistant: (q) => '【Dify 智能助手】关于「' + q + '」：我可以帮你记录打卡、解读风险评分、生成个性化生活方案。请问你想先了解哪一项？',
  adminAgent: (q) => '【Dify 管理助手】已理解指令「' + q + '」。如需删除文章，请明确说出要删除的文章编号，我会先向你确认再执行。'
};

/* ==================== 故障注入 ==================== */

let FAULT = 'none';
/** none | unauthorized | server-error | bad-contract | sse-error | hang */
function setFault(f) { FAULT = f || 'none'; }

/* ==================== 工具 ==================== */

function json(res, status, body, extraHeaders) {
  const payload = JSON.stringify(body);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload)
  }, CORS, extraHeaders || {}));
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { resolve({ __raw: raw }); }
    });
  });
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '600'
};

/* 与 nginx snippets/security-headers.conf 保持一致的安全头 */
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

/* ==================== 静态站点 ==================== */

function serveStatic(rootDir, urlPath, res) {
  const rel = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(rootDir, rel);
  if (!file.startsWith(path.resolve(rootDir))) { json(res, 403, { error: 'forbidden' }); return true; }
  let target = file;
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) target = path.join(file, 'index.html');
  if (!fs.existsSync(target)) return false;
  const ext = path.extname(target).toLowerCase();
  const body = fs.readFileSync(target);
  res.writeHead(200, Object.assign({
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': ext === '.html' ? 'no-cache, must-revalidate' : 'public, max-age=3600'
  }, SECURITY_HEADERS));
  res.end(body);
  return true;
}

/* ==================== 鉴权 ==================== */

function authenticate(req) {
  const auth = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(String(auth).trim());
  if (!m) return { ok: false, reason: '缺少 Authorization: Bearer <api-key>' };
  const app = APPS[m[1]];
  if (!app) return { ok: false, reason: '无效的 API Key: ' + m[1] };
  return { ok: true, app, apiKey: m[1] };
}

/* ==================== 业务处理 ==================== */

async function handleWorkflowRun(req, res, auth, requests) {
  const body = await readBody(req);
  requests.push({ path: '/v1/workflows/run', app: auth.app.id, body });

  if (FAULT === 'server-error') return json(res, 500, { code: 'internal_error', message: 'stub injected 500' });
  if (FAULT === 'bad-contract') {
    // 契约不匹配：level 非法 + outputs 非 JSON
    return json(res, 200, wrapWorkflow(auth.app.id, { result: 'not-a-json-payload' }));
  }

  const maker = WORKFLOW_OUTPUTS[auth.app.id];
  if (!maker) return json(res, 404, { code: 'not_found', message: '该应用不是工作流类型' });

  const outputs = maker(body.inputs || {});
  return json(res, 200, wrapWorkflow(auth.app.id, outputs));
}

function wrapWorkflow(appId, outputs) {
  const now = Math.floor(Date.now() / 1000);
  return {
    workflow_run_id: 'run-' + appId + '-' + now,
    task_id: 'task-' + now,
    data: {
      id: 'exec-' + now,
      workflow_id: 'wf-' + appId,
      status: 'succeeded',
      outputs: outputs,
      error: null,
      elapsed_time: 0.12,
      total_tokens: 128,
      total_steps: 3,
      created_at: now,
      finished_at: now
    }
  };
}

async function handleChatMessages(req, res, auth, requests) {
  const body = await readBody(req);
  requests.push({ path: '/v1/chat-messages', app: auth.app.id, body });

  const appId = auth.app.id;
  const isAgent = auth.app.type === 'agent';
  const replyFn = CHAT_REPLY[appId] || (() => '【Dify 桩】未注册回复的应用：' + appId);
  const answer = replyFn(String(body.query || ''));

  /* ---- 阻塞模式 ---- */
  if (body.response_mode !== 'streaming') {
    if (FAULT === 'server-error') return json(res, 500, { code: 'internal_error', message: 'stub injected 500' });
    if (FAULT === 'bad-contract') return json(res, 200, { answer: '' });   // answer 为空 → 触发降级
    return json(res, 200, {
      event: isAgent ? 'agent_message' : 'message',
      task_id: 'task-' + Date.now(),
      message_id: 'msg-' + Date.now(),
      conversation_id: body.conversation_id || 'conv-' + Date.now(),
      answer: answer,
      created_at: Math.floor(Date.now() / 1000)
    });
  }

  /* ---- 流式模式（SSE）---- */
  res.writeHead(200, Object.assign({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'          // 告诉 nginx 不要缓冲
  }, CORS));

  const convId = body.conversation_id || 'conv-' + Date.now();
  const taskId = 'task-' + Date.now();
  const msgId = 'msg-' + Date.now();
  const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');

  if (FAULT === 'hang') {
    // 只发一个事件然后永久挂起：用于验证前端「空闲超时」不会卡死界面
    send({ event: 'message', task_id: taskId, message_id: msgId, conversation_id: convId, answer: '正在思考…' });
    return;   // 不 end()，连接保持打开
  }

  if (FAULT === 'sse-error') {
    send({ event: 'message', task_id: taskId, message_id: msgId, conversation_id: convId, answer: '部分内容' });
    setTimeout(() => {
      send({ event: 'error', task_id: taskId, message_id: msgId, status: 500, code: 'stub_error', message: 'stub injected sse error' });
      res.end();
    }, 20);
    return;
  }

  // 正常流：按 8 个字符一块推送，块间 12ms，模拟打字机
  const chunks = [];
  for (let i = 0; i < answer.length; i += 8) chunks.push(answer.slice(i, i + 8));

  let idx = 0;
  const timer = setInterval(() => {
    if (idx < chunks.length) {
      send({
        event: isAgent ? 'agent_message' : 'message',
        task_id: taskId,
        message_id: msgId,
        conversation_id: convId,
        answer: chunks[idx],
        created_at: Math.floor(Date.now() / 1000)
      });
      idx++;
      return;
    }
    clearInterval(timer);
    send({
      event: 'message_end',
      task_id: taskId,
      message_id: msgId,
      conversation_id: convId,
      metadata: { usage: { total_tokens: 96 } }
    });
    res.end();
  }, 12);

  req.on('close', () => clearInterval(timer));
}

function handleParameters(res, auth) {
  json(res, 200, {
    introduction: '桩服务：' + auth.app.name,
    user_input_form: [],
    file_upload: { image: { enabled: false } },
    system_parameters: { audio_file_size_limit: 50, file_size_limit: 15, image_file_size_limit: 10 }
  });
}

/* ==================== 服务器 ==================== */

function createServer(opts) {
  opts = opts || {};
  const serveRoot = opts.serve || null;
  const requests = [];

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const p = u.pathname;

    // 预检
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      return res.end();
    }

    // 测试控制面（非 Dify 契约，仅供集成测试使用）
    if (p === '/__control__') {
      if (req.method === 'POST') {
        const b = await readBody(req);
        setFault(b.fault);
        return json(res, 200, { fault: FAULT });
      }
      return json(res, 200, { fault: FAULT, apps: Object.keys(APPS), keyByApp: KEY_BY_APP });
    }
    if (p === '/__requests__') {
      return json(res, 200, { count: requests.length, requests: requests });
    }
    if (p === '/__reset__' && req.method === 'POST') {
      requests.length = 0;
      setFault('none');
      return json(res, 200, { ok: true });
    }

    // Dify API
    if (p.startsWith('/v1/')) {
      const auth = authenticate(req);
      if (!auth.ok) {
        // 401 也要记账，否则集成测试无法断言「未重试」
        requests.push({ path: p, method: req.method, unauthorized: true, reason: auth.reason });
        return json(res, 401, { code: 'unauthorized', message: auth.reason });
      }
      try {
        if (p === '/v1/workflows/run' && req.method === 'POST') return await handleWorkflowRun(req, res, auth, requests);
        if (p === '/v1/chat-messages' && req.method === 'POST') return await handleChatMessages(req, res, auth, requests);
        if (p === '/v1/parameters' && req.method === 'GET') return handleParameters(res, auth);
        if (p === '/v1/info' && req.method === 'GET') return json(res, 200, { name: auth.app.name, mode: auth.app.type });
        return json(res, 404, { code: 'not_found', message: '未实现的 Dify 接口: ' + p });
      } catch (e) {
        return json(res, 500, { code: 'internal_error', message: String(e && e.message) });
      }
    }

    // 静态站点（可选）
    if (serveRoot) {
      if (serveStatic(serveRoot, req.url, res)) return;
      // 未命中 → 回退 index.html（与 nginx try_files 一致）
      if (serveStatic(serveRoot, '/index.html', res)) return;
    }

    json(res, 404, { code: 'not_found', message: p });
  });

  server.requests = requests;
  server.setFault = setFault;
  server.getFault = () => FAULT;
  server.apps = APPS;
  server.keyByApp = KEY_BY_APP;
  return server;
}

/** 启动并等待 listening，返回 { port, url, server, close() } */
function start(opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const server = createServer(opts);
    server.on('error', reject);
    server.listen(opts.port === undefined ? 0 : opts.port, opts.host || '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        port,
        url: 'http://127.0.0.1:' + port,
        apiBase: 'http://127.0.0.1:' + port + '/v1',
        requests: server.requests,
        setFault: server.setFault,
        keyByApp: server.keyByApp,
        apps: server.apps,
        close: () => new Promise((r) => {
          // hang 故障会留下未结束的 SSE 连接，closeAllConnections 保证进程能退出
          if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
          server.close(() => r());
        })
      });
    });
  });
}

module.exports = { start, createServer, APPS, KEY_BY_APP };

/* ==================== CLI ==================== */

if (require.main === module) {
  const argv = process.argv.slice(2);
  const getArg = (name, dft) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : dft;
  };
  const port = Number(getArg('--port', '8080'));
  const serveArg = argv.indexOf('--serve');
  const serve = serveArg >= 0 ? path.resolve(argv[serveArg + 1] || '.') : null;

  start({ port, serve }).then((s) => {
    console.log('Dify 契约桩已启动');
    console.log('  API 基址 : ' + s.apiBase);
    if (serve) console.log('  静态站点 : ' + s.url + '  (root=' + serve + ')');
    console.log('  API Key 对照：');
    Object.keys(KEY_BY_APP).forEach((appId) => {
      console.log('    ' + appId.padEnd(18) + ' → ' + KEY_BY_APP[appId]);
    });
    console.log('\n按 Ctrl+C 停止。');
  }).catch((e) => {
    console.error('启动失败：', e);
    process.exit(1);
  });
}
