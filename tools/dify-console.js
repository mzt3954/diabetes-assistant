#!/usr/bin/env node
/**
 * dify-console.js — 真实 Dify 控制台自动化（建应用 / 取 Key / 查供应商）
 * ==================================================================
 * 解决的问题：Dify 的「服务 API」（/v1/*）只能调用**已存在**的应用；
 * 要新建应用、拿 API Key，必须走控制台的内部接口（/console/api/*），
 * 而这些接口需要登录态 + CSRF 令牌。本脚本把这条链路自动化。
 *
 * 【鉴权机制｜读源码得出，非猜测】
 * 见 api/libs/token.py（Dify 1.15.x）：
 *
 *   def extract_access_token(request):
 *       return extract_console_cookie_token(request) or _try_extract_from_header(request)
 *   → 既接受 Cookie，也接受 `Authorization: Bearer <access_token>`。
 *
 *   def check_csrf_token(request, user_id):
 *       csrf_token = request.headers.get("X-CSRF-Token")
 *       csrf_token_from_cookie = request.cookies.get("csrf_token")
 *       if csrf_token != csrf_token_from_cookie: _unauthorized()
 *   → 写操作（POST/PUT/DELETE）**还必须带 X-CSRF-Token**，值须等于 csrf_token cookie。
 *
 * 常量（api/constants/__init__.py）：
 *   COOKIE_NAME_ACCESS_TOKEN  = "access_token"    ← httpOnly，JS 读不到
 *   COOKIE_NAME_REFRESH_TOKEN = "refresh_token"
 *   COOKIE_NAME_CSRF_TOKEN    = "csrf_token"      ← 非 httpOnly
 *   HEADER_NAME_CSRF_TOKEN    = "X-CSRF-Token"
 * 注意：**没有** console_token 这个键；实例为 http 时也不会有 __Host- 前缀。
 *
 * 【怎么拿凭据｜两种方式】
 *   方式 A（推荐）：从 DevTools 的 Cookie 面板复制两个值
 *     浏览器登录控制台 → F12 → Application → Cookies → 选中站点 → 找到：
 *       access_token   →  set DIFY_CONSOLE_TOKEN=<值>
 *       csrf_token     →  set DIFY_CONSOLE_CSRF=<值>
 *     （access_token 是 httpOnly，只能在 DevTools 面板看，Console 里读不到）
 *
 *   方式 B：给邮箱 + 密码，脚本自行登录并解析 Set-Cookie
 *       set DIFY_CONSOLE_EMAIL=you@example.com
 *       set DIFY_CONSOLE_PASSWORD=******
 *     注意：登录接口**不接受明文密码**，会返回
 *       {"code":"authentication_failed","message":"Invalid encrypted data"}
 *     名字唬人，其实是**纯 Base64 编码**（见 api/libs/encryption.py 的注释：
 *     "uses Base64 encoding for obfuscation, not cryptographic encryption"）。
 *     脚本会自动 base64 编码后再提交，无需额外配置。
 *     若连控制台账号都没有，可在 VM 上用 Dify 自带 CLI 新建一个：
 *       docker exec -it <api容器> flask create-tenant \
 *         --email you@example.com --name "我的工作区" --language zh-Hans
 *     （该命令会打印自动生成的密码；另有 flask reset-password 可重置已有账号）
 *
 * 【用法】
 *   node tools/dify-console.js whoami            # 验证凭据是否有效
 *   node tools/dify-console.js providers         # 列出已配置的模型供应商（关键！）
 *   node tools/dify-console.js apps              # 列出已有应用
 *   node tools/dify-console.js import <文件或目录...>   # 导入 DSL 建应用
 *   node tools/dify-console.js keys [--create]   # 列出/创建各应用的 API Key
 *   node tools/dify-console.js env               # 输出 8 个 Key 的 shell 导出脚本
 *   node tools/dify-console.js write-config      # 把 Key 回写进 js/config.js
 *   node tools/dify-console.js logout            # 清除本地凭据缓存
 *
 * 【环境变量】
 *   DIFY_BASE_URL        Dify 控制台地址，例如 http://<沙箱IP>:<端口>（必填）
 *   DIFY_CONSOLE_TOKEN   access_token 的值（或邮箱登录后自动获取）
 *   DIFY_CONSOLE_CSRF    csrf_token 的值（写操作必需）
 *   DIFY_CONSOLE_EMAIL / DIFY_CONSOLE_PASSWORD
 *
 * 安全：凭据缓存写入 tools/.console-token.json（0600），已在 .gitignore 中排除。
 * ==================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const tls = require('tls');

const ROOT = path.resolve(__dirname, '..');
const TOKEN_CACHE = path.join(__dirname, '.console-token.json');
const CONFIG_JS = path.join(ROOT, 'js', 'config.js');

const BASE_URL = (process.env.DIFY_BASE_URL || 'http://localhost').replace(/\/+$/, '');
const TIMEOUT = Number(process.env.DIFY_TIMEOUT || 20000);

/** 8 个应用：appId → 应用名（用于把 Dify 应用映射回 config.js） */
const APPS = {
  homeData:        { code: 'WF-1',    name: '首页数据管理' },
  doctorChat:      { code: 'CHAT-1',  name: '医师咨询助手' },
  riskPrediction:  { code: 'WF-2',    name: '个人信息与风险预测' },
  lifePlan:        { code: 'WF-3',    name: '生活方案定制' },
  healthNews:      { code: 'WF-4',    name: '健康资讯生成' },
  checkinAnalysis: { code: 'WF-5',    name: '打卡分析' },
  aiAssistant:     { code: 'CHAT-2',  name: 'AI智能助手' },
  adminAgent:      { code: 'AGENT-1', name: 'AI管理助手' }
};

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

const C = {
  ok:   (s) => `\x1b[32m${s}\x1b[0m`,
  bad:  (s) => `\x1b[31m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  dim:  (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`
};

function log(msg) { process.stdout.write(msg + '\n'); }
function die(msg, code = 1) { log(C.bad('✖ ' + msg)); process.exit(code); }

/* ------------------------------------------------------------------ */
/* HTTP 传输层                                                          */
/*                                                                      */
/* 为什么不用 fetch：Node 内置的 fetch（undici）**不读 HTTP_PROXY**，      */
/* 在只允许通过代理出网的沙箱里会直接 ECONNREFUSED。curl 会读，所以       */
/* 「curl 能通、脚本不通」正是这个原因。这里用 node:http 自己实现，       */
/* 明文 HTTP 走代理的 absolute-URI 形式，HTTPS 走 CONNECT 隧道。          */
/* ------------------------------------------------------------------ */

/** 命中 NO_PROXY 则返回 true（该目标应直连） */
function bypassProxy(hostname) {
  const list = (process.env.NO_PROXY || process.env.no_proxy || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const h = String(hostname).toLowerCase();
  return list.some((raw) => {
    const p = raw.toLowerCase();
    if (p === '*') return true;
    // 后缀匹配必须落在「点边界」上：.example.com 应匹配 api.example.com，
    // 但不能匹配 notexample.com —— 朴素的 endsWith 会误伤后者。
    if (p.startsWith('.')) return h === p.slice(1) || h.endsWith(p);
    return h === p || h.endsWith('.' + p);
  });
}

/** 返回该目标应使用的代理 URL；不需要代理则 null */
function proxyFor(u) {
  if (bypassProxy(u.hostname)) return null;
  const env = (k) => process.env[k] || process.env[k.toLowerCase()];
  const raw = u.protocol === 'https:'
    ? (env('HTTPS_PROXY') || env('HTTP_PROXY'))
    : env('HTTP_PROXY');
  if (!raw) return null;
  try { return new URL(raw); } catch { return null; }
}

/** 发一个原始请求 → { status, headers, body } */
function rawRequest(transport, options, payload) {
  return new Promise((resolve, reject) => {
    // agent:false —— 每个请求用独立连接。
    // 走代理时若复用 keep-alive 连接，实测会出现「同一 URL 第一次正常、
    // 第二次拿到错乱响应」的情况。本工具一次只发少量请求，稳定性优先。
    const req = transport.request(Object.assign({ agent: false }, options), (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.setTimeout(TIMEOUT, () => req.destroy(new Error(`请求超时（${TIMEOUT}ms）`)));
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

/** HTTPS 经代理：先 CONNECT 建隧道，再在隧道上做 TLS */
function connectTunnel(proxy, u) {
  return new Promise((resolve, reject) => {
    const port = u.port || 443;
    const req = http.request({
      host: proxy.hostname,
      port: proxy.port || 80,
      method: 'CONNECT',
      path: `${u.hostname}:${port}`,
      headers: { Host: `${u.hostname}:${port}` }
    });
    req.setTimeout(TIMEOUT, () => req.destroy(new Error('代理 CONNECT 超时')));
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return reject(new Error(`代理 CONNECT 被拒: HTTP ${res.statusCode}`));
      }
      socket.on('error', reject);
      resolve(tls.connect({ socket, servername: u.hostname }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** 统一的 HTTP 发送入口（自动处理代理） */
async function send(method, url, { headers = {}, payload } = {}) {
  const u = new URL(url);
  const proxy = proxyFor(u);
  const hdrs = Object.assign({ Host: u.host }, headers);

  // 明文 HTTP + 代理：把完整 URL 作为 path 发给代理
  if (proxy && u.protocol === 'http:') {
    return rawRequest(http, {
      host: proxy.hostname,
      port: proxy.port || 80,
      method,
      path: u.href,
      headers: hdrs
    }, payload);
  }

  // HTTPS + 代理：CONNECT 隧道 + TLS
  if (proxy && u.protocol === 'https:') {
    const socket = await connectTunnel(proxy, u);
    return rawRequest(http, {
      method,
      path: u.pathname + u.search,
      headers: hdrs,
      createConnection: () => socket,
      agent: false
    }, payload);
  }

  // 直连
  return rawRequest(u.protocol === 'https:' ? https : http, {
    host: u.hostname,
    port: u.port || (u.protocol === 'https:' ? 443 : 80),
    method,
    path: u.pathname + u.search,
    headers: hdrs
  }, payload);
}

/**
 * 解析 Set-Cookie 响应头。
 * 登录接口（/console/api/login）**不在响应体里返回令牌**，而是通过
 * Set-Cookie 下发（见 api/controllers/console/auth/login.py）。
 * 所以必须从响应头里取。
 */
function parseSetCookies(headers) {
  const jar = {};
  if (!headers) return jar;
  let raw = [];
  if (typeof headers.getSetCookie === 'function') raw = headers.getSetCookie();
  else if (typeof headers.get === 'function') {
    const v = headers.get('set-cookie');
    if (v) raw = [v];
  } else {
    // node:http 的 res.headers 是普通对象，set-cookie 为数组
    const v = headers['set-cookie'] || headers['Set-Cookie'];
    if (Array.isArray(v)) raw = v;
    else if (v) raw = [v];
  }
  for (const c of raw) {
    const pair = String(c).split(';')[0];
    const i = pair.indexOf('=');
    if (i < 0) continue;
    jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return jar;
}

/** 统一请求：超时 + 保留原始响应头（Set-Cookie 解析需要） */
async function call(method, url, { headers = {}, body, raw = false } = {}) {
  const hdrs = Object.assign({}, headers);
  let payload;
  if (body !== undefined) {
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      // FormData/Blob 是 undici 的流式对象，node:http 不认。
      // 借 undici 的 Request 一次性序列化成 buffer，并取回带 boundary 的 Content-Type ——
      // 比手工拼 multipart 边界可靠得多。
      const probe = new Request('http://localhost/', { method: 'POST', body });
      payload = Buffer.from(await probe.arrayBuffer());
      hdrs['Content-Type'] = probe.headers.get('content-type');
    } else {
      payload = raw ? body : JSON.stringify(body);
      if (!raw && !hdrs['Content-Type']) hdrs['Content-Type'] = 'application/json';
    }
    hdrs['Content-Length'] = Buffer.byteLength(payload);
  }

  let res;
  try {
    res = await send(method, url, { headers: hdrs, payload });
  } catch (err) {
    const code = err.code ? ` (${err.code})` : '';
    throw new Error(`网络层失败: ${err.message}${code} — ${url}`);
  }

  const text = res.body;
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON，保留原文 */ }
  return { status: res.status, ok: res.status >= 200 && res.status < 300, json, text, headers: res.headers };
}

/* ------------------------------------------------------------------ */
/* 鉴权：access_token + csrf_token                                     */
/* ------------------------------------------------------------------ */

/** 当前凭据：{ accessToken, csrfToken, refreshToken } */
let _auth = null;

function readCachedAuth() {
  try {
    const j = JSON.parse(fs.readFileSync(TOKEN_CACHE, 'utf8'));
    if (j && j.baseUrl === BASE_URL && j.accessToken) return j;
  } catch { /* 无缓存 */ }
  return null;
}

function writeCachedAuth(auth) {
  try {
    fs.writeFileSync(TOKEN_CACHE, JSON.stringify(Object.assign({
      baseUrl: BASE_URL, saved_at: new Date().toISOString()
    }, auth), null, 2), { mode: 0o600 });
  } catch (e) {
    log(C.warn('⚠ 凭据缓存写入失败（不影响本次运行）: ' + e.message));
  }
}

/**
 * 编码密码字段。
 *
 * 实测目标实例的登录接口拒绝明文密码，返回
 *   {"code":"authentication_failed","message":"Invalid encrypted data","status":401}
 * 看名字像加密，其实是**纯 Base64 编码**。依据 api/libs/encryption.py：
 *
 *   """
 *   Field Encoding/Decoding Utilities
 *   Note: This uses Base64 encoding for obfuscation, not cryptographic encryption.
 *   Real security relies on HTTPS for transport layer encryption.
 *   """
 *   class FieldEncryption:
 *       @classmethod
 *       def decrypt_field(cls, encoded_text):
 *           try:
 *               decoded_bytes = base64.b64decode(encoded_text)
 *               return decoded_bytes.decode("utf-8")
 *           except Exception:
 *               return None
 *
 * 服务端 base64 解码失败 → decrypt_field 返回 None →
 * controllers/console/wraps.py 抛 "Invalid encrypted data"。
 * 所以这里只需要 base64 编码，**不是 RSA**。
 * （坑：密码里若含 `%` 等非 base64 字符，直接发明文会被判为「无效加密数据」，
 *   看起来像密码错误，实则字段格式问题。）
 */
function encodePassword(plain) {
  return Buffer.from(String(plain), 'utf8').toString('base64');
}

const MISSING_CRED_HELP = [
  '缺少控制台凭据。二选一：',
  '',
  '  ' + C.bold('方式 A（推荐）：从 DevTools 的 Cookie 面板复制'),
  '    1. 浏览器登录 ' + BASE_URL + '/apps',
  '    2. F12 → Application（应用程序）→ Cookies → 选中该站点',
  '    3. 复制两个 cookie 的值：',
  '         access_token  →  ' + C.dim('set DIFY_CONSOLE_TOKEN=<值>'),
  '         csrf_token    →  ' + C.dim('set DIFY_CONSOLE_CSRF=<值>'),
  '',
  '    ⚠ cookie 名是 access_token，不是 console_token（Dify 没有这个键）。',
  '    ⚠ access_token 是 httpOnly，Console 里 localStorage 读不到，必须看 Cookie 面板。',
  '    ⚠ csrf_token 是写操作（导入 DSL / 建 Key）必需的，只给 access_token 会在 POST 时被拒。',
  '',
  '  ' + C.bold('方式 B：给邮箱 + 密码，脚本自行登录'),
  '      set DIFY_CONSOLE_EMAIL=你的登录邮箱',
  '      set DIFY_CONSOLE_PASSWORD=你的密码',
  '      （脚本会把密码做 Base64 编码后提交——该接口不接受明文，但也不是加密）'
].join('\n');

async function getAuth() {
  if (_auth) return _auth;

  // 1) 环境变量给的 access_token（可选带 csrf）
  const envToken = process.env.DIFY_CONSOLE_TOKEN && process.env.DIFY_CONSOLE_TOKEN.trim();
  if (envToken) {
    _auth = {
      accessToken: envToken,
      csrfToken: (process.env.DIFY_CONSOLE_CSRF || '').trim(),
      refreshToken: '',
      source: 'env'
    };
    return _auth;
  }

  // 2) 本地缓存
  const cached = readCachedAuth();
  if (cached) {
    _auth = {
      accessToken: cached.accessToken,
      csrfToken: cached.csrfToken || '',
      refreshToken: cached.refreshToken || '',
      source: 'cache'
    };
    return _auth;
  }

  // 3) 邮箱 + 密码登录
  const email = process.env.DIFY_CONSOLE_EMAIL;
  const password = process.env.DIFY_CONSOLE_PASSWORD;
  if (!email || !password) die(MISSING_CRED_HELP, 3);

  const r = await call('POST', BASE_URL + '/console/api/login', {
    headers: { 'Content-Type': 'application/json' },
    body: {
      email,
      password: encodePassword(password),
      language: 'zh-Hans',
      remember_me: true
    }
  });

  if (!r.ok) {
    // 出现这个错误说明 password 字段没通过 base64 解码
    if (/invalid encrypted data/i.test(r.text)) {
      die([
        '登录被拒：Invalid encrypted data',
        '',
        '这个报错名不副实——它不是加密失败，而是服务端 base64 解码失败',
        '（api/libs/encryption.py 明说 "Base64 encoding for obfuscation, not encryption"）。',
        '本脚本已经对 password 做了 base64 编码，若仍报此错，通常是：',
        '  1. 环境变量里的密码被 shell 改写（如含 $ % 等字符未转义）——用单引号包裹；',
        '  2. 密码里含非 UTF-8 字符；',
        '  3. 目标实例版本较新，改用真实加密（此时需按官方前端的方式处理）。',
        '',
        '也可以直接绕开登录接口，改用 cookie：',
        '  浏览器登录 → F12 → Application → Cookies → 复制 access_token 与 csrf_token',
        '  set DIFY_CONSOLE_TOKEN=<access_token>',
        '  set DIFY_CONSOLE_CSRF=<csrf_token>'
      ].join('\n'), 1);
    }
    die(explainFailure(r) || `登录失败 HTTP ${r.status}: ${r.text.slice(0, 300)}`, 1);
  }

  // 令牌在 Set-Cookie 里；部分版本也会在响应体里返回，两条路都兜住
  const jar = parseSetCookies(r.headers);
  const body = (r.json && (r.json.data || r.json)) || {};
  const auth = {
    accessToken: jar.access_token || body.access_token || '',
    csrfToken: jar.csrf_token || body.csrf_token || '',
    refreshToken: jar.refresh_token || body.refresh_token || '',
    source: 'login'
  };
  if (!auth.accessToken) {
    die('登录成功但未在 Set-Cookie / 响应体中找到 access_token。原始响应：' + r.text.slice(0, 300));
  }
  _auth = auth;
  writeCachedAuth(auth);
  log(C.ok('✔ 登录成功') + C.dim(`（已取得 access_token${auth.csrfToken ? ' + csrf_token' : '，未取到 csrf_token'}）`));
  return _auth;
}

/** 控制台接口调用：同时带 Authorization、Cookie 与 X-CSRF-Token */
async function api(method, p, opts = {}) {
  const auth = opts.auth || (await getAuth());
  const headers = {
    'Authorization': 'Bearer ' + auth.accessToken,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  /*
   * 必须把令牌**同时**放进 Cookie 和 Authorization 头：
   *   - extract_access_token() 先读 cookie，再退回 Authorization 头，两者都能过鉴权；
   *   - 但 check_csrf_token() 是拿 `X-CSRF-Token` 请求头去和 `csrf_token` **cookie**
   *     比对（不相等就 401）。只发请求头不发 cookie，比对对象为 None，
   *     所有请求都会被判 CSRF 失败（含 GET）。
   * 因此这里把三件套都发出去，覆盖服务端可能采用的任一种取法。
   */
  const jar = [];
  if (auth.accessToken) jar.push('access_token=' + auth.accessToken);
  if (auth.csrfToken) jar.push('csrf_token=' + auth.csrfToken);
  if (auth.refreshToken) jar.push('refresh_token=' + auth.refreshToken);
  if (jar.length) headers['Cookie'] = jar.join('; ');

  /*
   * 实测结论（本实例 Dify 1.15 / DSL 0.6.0）：**GET 也必须带 X-CSRF-Token**。
   *   仅 Authorization              → 401 "CSRF token is missing or invalid."
   *   Authorization + Cookie        → 401 同上
   *   Authorization + Cookie + 头   → 200 ✔
   * 所以这里不区分方法，只要拿到 csrf_token 就一律带上（早先"仅写操作带"的
   * 假设是错的，会让 whoami/providers/apps 这些只读命令全部失败）。
   */
  if (auth.csrfToken) headers['X-CSRF-Token'] = auth.csrfToken;

  Object.assign(headers, opts.headers || {});
  const r = await call(method, BASE_URL + p, Object.assign({}, opts, { headers }));

  /*
   * access_token 有效期约 1 小时，跑长任务（导入 + 发布 + 建 Key 全套）时必然过期。
   * 若手上有邮箱密码，就自动重登一次并重试，避免整套流程在第 40 分钟断掉。
   * 只重试一次（_retried 标记），失败不掩盖，原样抛出由调用方处理。
   */
  if (r.status === 401 && !opts._retried && process.env.DIFY_CONSOLE_EMAIL && process.env.DIFY_CONSOLE_PASSWORD) {
    log(C.dim('（凭据已过期，正在自动重新登录…）'));
    _auth = null;
    try { fs.unlinkSync(TOKEN_CACHE); } catch (e) { /* 无缓存 */ }
    await getAuth();
    return api(method, p, Object.assign({}, opts, { _retried: true }));
  }

  return r;
}

/** 识别 CSRF 失败并给出可操作提示 */
function explainFailure(r) {
  const t = (r.text || '').toLowerCase();

  // 502/503/504 —— 大概率是「实例没起来」，不是凭据问题。
  // 云沙箱的端口网关在后端容器停止时会回 502，并带这些特征：
  //   Connection: close / Retry-After: 1 / body 里含 upstream connect error
  if (r.status === 502 || r.status === 503 || r.status === 504) {
    const gateway = /upstream connect error|connection refused|no healthy upstream|connect: connection refused/.test(t);
    return [
      `实例不可达（HTTP ${r.status}${gateway ? '，网关上报上游连接失败' : ''}）。`,
      '这**不是**凭据或代码问题——Dify 的容器当前没有在运行。',
      '',
      '排查顺序：',
      '  1. 回到云沙箱控制台，确认该端口对应的实例状态是「运行中」；',
      '     若显示已停止/已回收，重新启动它。',
      '  2. 实例恢复后先探活（应返回 200 或 302，而不是 502）：',
      `       curl -s -o /dev/null -w "%{http_code}\\n" ${BASE_URL}/apps`,
      '  3. 再重跑本命令。',
      '',
      `原始响应: ${(r.text || '').slice(0, 200).replace(/\s+/g, ' ')}`
    ].join('\n');
  }

  // 404 —— 通常是把 baseUrl 写错了（少了/多了路径段），不是没权限。
  if (r.status === 404) {
    return [
      `路径不存在（HTTP 404）——检查 baseUrl 是否正确。`,
      `  当前 DIFY_BASE_URL = ${BASE_URL}`,
      '  控制台接口应挂在 /console/api 下；若你填的是控制台网页地址（如 .../apps），',
      '  需要去掉尾部路径，只保留协议+主机+端口。',
      '  提示：控制台接口的探活端点是 GET /console/api/account/profile（未登录返回 401）。'
    ].join('\n');
  }

  if (r.status === 401 || r.status === 403) {
    if (t.indexOf('csrf') > -1) {
      return [
        '写操作被 CSRF 校验拒绝（check_csrf_token）。',
        '除了 access_token，还必须提供 csrf_token：',
        '  F12 → Application → Cookies → 复制 csrf_token 的值，然后：',
        '    set DIFY_CONSOLE_CSRF=<值>',
        '（csrf_token 不是 httpOnly，也可以在 Console 里执行 document.cookie 查看）'
      ].join('\n');
    }
    return '凭据无效或已过期（HTTP ' + r.status + '）。access_token 有效期默认约 1 小时，请重新获取。';
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 子命令                                                              */
/* ------------------------------------------------------------------ */

async function cmdWhoami() {
  const auth = await getAuth();
  // 注意：不要用 /console/api/workspaces/current —— 那个路径只接受 POST，
  // 用 GET 会得到 405（方法不允许），会被误读成「凭据问题」。
  const r = await api('GET', '/console/api/account/profile', { auth });
  if (!r.ok) die(explainFailure(r) || `HTTP ${r.status}: ${r.text.slice(0, 300)}`);
  const me = (r.json && (r.json.data !== undefined ? r.json.data : r.json)) || {};

  log(C.ok('✔ 凭据有效'));
  log(`  账号: ${me.email || '(未知)'}${me.name ? '   姓名: ' + me.name : ''}`);

  const ws = await api('GET', '/console/api/workspaces', { auth });
  if (ws.ok) {
    const d = (ws.json && (ws.json.data !== undefined ? ws.json.data : ws.json)) || [];
    const list = Array.isArray(d) ? d : [];
    if (list.length) log(`  工作区: ${list[0].name || '(未命名)'}   id=${list[0].id || ''}`);
  }
  log(`  access_token: ${auth.accessToken.slice(0, 12)}…   csrf_token: ${auth.csrfToken ? C.ok('已提供') : C.warn('未提供（写操作会失败）')}`);
  return me;
}

/**
 * 列出模型供应商 —— 这是最关键的侦察项。
 * 没有 configured=true 的供应商，任何 LLM 节点都会在执行时报
 * "provider not configured"，应用能建但跑不通。
 */
async function cmdProviders() {
  const r = await api('GET', '/console/api/workspaces/current/model-providers');
  if (!r.ok) die(explainFailure(r) || `HTTP ${r.status}: ${r.text.slice(0, 400)}`);

  // 兼容两种返回：数组 或 {provider: {...}} 字典
  let list = [];
  const d = r.json && (r.json.data !== undefined ? r.json.data : r.json);
  if (Array.isArray(d)) list = d;
  else if (d && typeof d === 'object') list = Object.keys(d).map((k) => Object.assign({ provider: k }, d[k]));

  if (!list.length) {
    log(C.warn('⚠ 未发现任何模型供应商插件。'));
    log('  请在控制台「插件市场」安装供应商插件（如 DeepSeek / OpenAI），再配置 API Key。');
    return [];
  }

  log(C.bold('模型供应商清单：'));
  log('');
  const configured = [];
  for (const p of list) {
    const name = p.provider || p.name || '?';
    const isCfg = !!(p.configured || p.custom_configuration);
    const models = p.models || [];
    const used = models.filter((m) => m && m.model_type === 'llm').map((m) => m.model || m.name);
    if (isCfg) configured.push(name);
    log(`  ${isCfg ? C.ok('● 已配置') : C.dim('○ 未配置')}  ${C.bold(name)}`);
    if (used.length) log(C.dim(`       LLM 模型: ${used.join(', ')}`));
  }
  log('');
  if (configured.length) {
    log(C.ok(`✔ 可用供应商 ${configured.length} 个：${configured.join(', ')}`));
  } else {
    log(C.bad('✖ 没有任何「已配置」的供应商 → 8 个应用建了也跑不通，必须先在控制台配置 API Key。'));
  }
  return list;
}

async function cmdApps() {
  const r = await api('GET', '/console/api/apps?page=1&limit=100');
  if (!r.ok) die(explainFailure(r) || `HTTP ${r.status}: ${r.text.slice(0, 400)}`);
  const d = (r.json && (r.json.data !== undefined ? r.json.data : r.json)) || [];
  const list = Array.isArray(d) ? d : (d.data || []);
  log(C.bold(`已有应用 ${list.length} 个：`));
  for (const a of list) {
    log(`  ${C.dim(String(a.mode).padEnd(14))} ${a.name}   ${C.dim('id=' + a.id)}`);
  }
  if (!list.length) log(C.warn('  （空——8 个应用都还没建）'));
  return list;
}

/** 导入 DSL 建应用。支持传文件或目录（目录下取所有 .yml/.yaml） */
async function cmdImport(targets) {
  if (!targets.length) die('用法: node tools/dify-console.js import <文件或目录...>');

  const files = [];
  for (const t of targets) {
    const abs = path.resolve(t);
    if (!fs.existsSync(abs)) { log(C.warn('⚠ 跳过不存在的路径: ' + t)); continue; }
    if (fs.statSync(abs).isDirectory()) {
      for (const f of fs.readdirSync(abs).sort()) {
        if (/\.ya?ml$/i.test(f)) files.push(path.join(abs, f));
      }
    } else {
      files.push(abs);
    }
  }
  if (!files.length) die('没有找到任何 .yml/.yaml 文件');

  // 重复导入会留下多份同名应用：keys / write-config 只取第一个匹配，
  // 极易把 Key 写到"看不见的那一份"上。这里提前拦一下。
  try {
    const existing = await api('GET', '/console/api/apps?page=1&limit=100');
    const d = (existing.json && (existing.json.data !== undefined ? existing.json.data : existing.json)) || [];
    const list = Array.isArray(d) ? d : (d.data || []);
    const names = Object.keys(APPS).map((k) => APPS[k].name);
    const dup = list.filter((a) => names.some((n) =>
      a.name === n || a.name.indexOf(n) > -1 || n.indexOf(a.name) > -1));
    if (dup.length) {
      log(C.warn(`⚠ 实例上已存在 ${dup.length} 个同名应用，继续导入会产生重复。`));
      log(C.dim('  建议先清理：node tools/dify-console.js delete   （需 DIFY_FORCE=1）'));
      log('');
    }
  } catch (e) { /* 查不到就算了，不阻塞导入 */ }

  log(C.bold(`准备导入 ${files.length} 个 DSL 文件 → ${BASE_URL}`));
  log('');

  const results = [];
  for (const f of files) {
    const yaml = fs.readFileSync(f, 'utf8');
    const base = path.basename(f);
    process.stdout.write(`  ${base.padEnd(34)} `);

    // 先试 JSON 形式（yaml-content），失败再退回 multipart
    let r = await api('POST', '/console/api/apps/imports', {
      body: { mode: 'yaml-content', yaml_content: yaml }
    });

    if (r.status === 404 || r.status === 405 || r.status === 415) {
      const fd = new FormData();
      fd.append('mode', 'yaml-file');
      fd.append('file', new Blob([yaml], { type: 'application/yaml' }), base);
      r = await api('POST', '/console/api/apps/imports', { body: fd, raw: true });
    }

    const j = r.json || {};
    if (r.ok) {
      const appId = j.app_id || (j.data && j.data.app_id) || '';

      // 导入后是草稿态，未发布则服务 API 一律 400 "Workflow not published"，
      // 前端会静默降级回本地引擎。这里顺手发布掉，省得再跑一次命令。
      let pub = '';
      if (appId) {
        const pr = await publishApp(appId);
        pub = pr.ok ? ' +已发布' : C.warn(' +发布失败(' + pr.status + ')');
      }

      log(C.ok(`✔ ${j.status || 'ok'}`) + C.dim(`  app_id=${appId || '(异步任务)'}`) + pub);
      results.push({ file: base, ok: true, appId, mode: j.app_mode, name: j.app_name });
    } else {
      log(C.bad(`✖ HTTP ${r.status}`));
      const hint = explainFailure(r);
      if (hint) log(C.warn('      ' + hint.replace(/\n/g, '\n      ')));
      else log(C.dim('      ' + r.text.slice(0, 400).replace(/\n/g, '\n      ')));
      results.push({ file: base, ok: false, status: r.status, body: r.text });
    }
  }

  const okN = results.filter((x) => x.ok).length;
  log('');
  log(okN === files.length
    ? C.ok(`✔ 全部导入成功（${okN}/${files.length}）`)
    : C.warn(`⚠ 成功 ${okN}/${files.length}，失败项见上方输出`));
  return results;
}

/** 列出各应用的 API Key；--create 时对缺失的自动创建 */
/**
 * 发布应用。
 *
 * 关键：导入后的应用是**草稿态**，服务 API 会拒绝调用 ——
 *   POST /v1/workflows/run → 400 {"code":"invalid_param","message":"Workflow not published"}
 * 所以建完必须发布，否则前端会静默降级回本地引擎。
 *
 * 本版本（DSL 0.6.0）下 workflow 与 advanced-chat 都走
 * /console/api/apps/{id}/workflows/publish（/publish 那个端点返回 404）。
 */
async function publishApp(appId) {
  return api('POST', `/console/api/apps/${appId}/workflows/publish`, { body: {} });
}

/**
 * 删除本工具创建的 8 个应用（用于重建）。
 *
 * 安全约束：只删「名字能匹配上 APPS 表」的应用，且拒绝按任意 id 删除 ——
 * 免得误伤工作区里与本工具无关的应用（例如实例上原有的「糖尿病专家」）。
 */
async function cmdDelete() {
  const apps = await cmdApps();

  // 注意：必须删掉**所有**同名匹配项，不能只删第一个。
  // 重复导入会留下多份同名应用（实测过一次留下 8 份旧版），
  // 只删首个的话残骸还在，且 keys/write-config 会匹配到错误的那一份。
  const names = Object.keys(APPS).map((k) => APPS[k].name);
  const targets = apps
    .filter((a) => names.some((n) =>
      a.name === n || a.name.indexOf(n) > -1 || n.indexOf(a.name) > -1))
    .map((a) => ({ appId: '', id: a.id, name: a.name }));

  if (!targets.length) { log(C.warn('没有可删除的目标（未匹配到任何本项目应用）')); return; }
  if (targets.length > Object.keys(APPS).length) {
    log(C.warn(`⚠ 检测到 ${targets.length} 个匹配项（多于 8 个），说明存在重复导入，本次会一并清理。`));
  }

  log('');
  log(C.bold(`即将删除 ${targets.length} 个本项目应用：`));
  targets.forEach((t) => log(`  · ${t.name}  ${C.dim(t.id)}`));

  if (process.env.DIFY_FORCE !== '1') {
    log('');
    log(C.warn('未执行。确认后请加 DIFY_FORCE=1 重跑（实例上与本项目无关的应用不会被触碰）。'));
    return;
  }

  log('');
  let n = 0;
  for (const t of targets) {
    const r = await api('DELETE', `/console/api/apps/${t.id}`);
    if (r.ok || r.status === 204) { log(`  ${C.ok('✔')} 已删除 ${t.name}`); n++; }
    else log(`  ${C.bad('✖')} 删除失败 ${t.name} HTTP ${r.status}: ${r.text.slice(0, 120)}`);
  }
  log('');
  log(C.ok(`✔ 已删除 ${n}/${targets.length} 个`));
}

/** 发布全部已匹配的应用 */
async function cmdPublish() {
  const apps = await cmdApps();
  const matched = matchToAppIds(apps);
  log('');
  log(C.bold('发布：'));
  let n = 0;
  for (const id of Object.keys(APPS)) {
    const m = matched[id];
    if (!m) { log(`  ${C.warn('○')} ${APPS[id].code} ${id}  未匹配到应用`); continue; }
    const r = await publishApp(m.id);
    if (r.ok) { log(`  ${C.ok('✔')} ${APPS[id].code} ${id.padEnd(17)} 已发布`); n++; }
    else {
      log(`  ${C.bad('✖')} ${APPS[id].code} ${id.padEnd(17)} 发布失败 HTTP ${r.status}`);
      const hint = explainFailure(r);
      if (hint) log(C.dim('      ' + hint.replace(/\n/g, '\n      ')));
      else log(C.dim('      ' + r.text.slice(0, 200)));
    }
  }
  log('');
  log(n === Object.keys(APPS).length
    ? C.ok(`✔ 全部 ${n} 个应用已发布`)
    : C.warn(`⚠ 发布成功 ${n}/${Object.keys(APPS).length}`));
}

/** 取某个应用的 API Key；没有且 create=true 时创建。返回 { token, error } */
async function fetchApiKey(appId, create) {
  const r = await api('GET', `/console/api/apps/${appId}/api-keys`);
  let keys = [];
  if (r.ok) {
    const d = (r.json && (r.json.data !== undefined ? r.json.data : r.json)) || [];
    keys = Array.isArray(d) ? d : (d.data || []);
  }
  if (!keys.length && create) {
    const c = await api('POST', `/console/api/apps/${appId}/api-keys`, { body: {} });
    if (!c.ok) return { token: '', error: c };
    const nd = (c.json && (c.json.data !== undefined ? c.json.data : c.json)) || {};
    keys = [nd];
  }
  return { token: keys.length ? (keys[0].token || '') : '', error: null };
}

async function cmdKeys(opts = {}) {
  const apps = await cmdApps();
  if (!apps.length) return [];

  log('');
  log(C.bold('API Key：'));
  const out = [];

  for (const a of apps) {
    const { token, error } = await fetchApiKey(a.id, !!opts.create);
    if (error) {
      log(`  ${C.bad('✖')} ${a.name}  创建 Key 失败 HTTP ${error.status}`);
      const hint = explainFailure(error);
      log(C.dim('      ' + (hint || error.text.slice(0, 200)).replace(/\n/g, '\n      ')));
      continue;
    }
    log(`  ${token ? C.ok('✔') : C.dim('○')} ${a.name.padEnd(18)} ${C.dim(String(a.mode).padEnd(14))} ${token || C.warn('(无 Key)')}`);
    out.push({ id: a.id, name: a.name, mode: a.mode, token });
  }

  // 与 config.js 的 appId 对齐
  log('');
  const matched = matchToAppIds(out);
  for (const k of Object.keys(APPS)) {
    const m = matched[k];
    log(`  ${APPS[k].code.padEnd(8)} ${k.padEnd(17)} ${m ? C.ok(m.token || '(无Key)') : C.warn('未匹配到应用')}`);
  }
  return out;
}

/** 按应用名把 Dify 应用映射回 config.js 的 appId */
function matchToAppIds(difyApps) {
  const map = {};
  for (const id of Object.keys(APPS)) {
    const want = APPS[id];
    // 双向包含匹配：Dify 里的名字可能是「WF-2 个人信息与风险预测」，
    // config.js 里是「个人信息与风险预测」，前缀对不齐但包含关系成立。
    const hit = difyApps.find((a) =>
      a.name === want.name ||
      a.name.indexOf(want.name) > -1 ||
      want.name.indexOf(a.name) > -1
    );
    if (hit) map[id] = hit;
  }
  return map;
}

/** 输出可直接 source 的 shell 脚本，供 real-dify-check.js 使用 */
async function cmdEnv() {
  const apps = await cmdApps();
  const matched = matchToAppIds(apps);
  const lines = [
    '# 由 tools/dify-console.js 生成 —— 供 tests/real-dify-check.js 使用',
    '# 用法（Git Bash）:  source tools/.dify-keys.sh && node tests/real-dify-check.js',
    `export DIFY_BASE_URL="${BASE_URL}/v1"`
  ];
  for (const id of Object.keys(APPS)) {
    const m = matched[id];
    lines.push(`export DIFY_KEY_${id.toUpperCase()}="${m ? (m.token || '') : ''}"   # ${APPS[id].code} ${APPS[id].name}`);
  }
  const outFile = path.join(__dirname, '.dify-keys.sh');
  fs.writeFileSync(outFile, lines.join('\n') + '\n');
  log(lines.join('\n'));
  log('');
  log(C.ok(`✔ 已写入 ${path.relative(ROOT, outFile)}`) + C.dim('（已在 .gitignore 中排除）'));
}

/** 把 Key 回写进 js/config.js 的 DIFY.apps.*.apiKey */
async function cmdWriteConfig() {
  const apps = await cmdApps();
  const matched = matchToAppIds(apps);
  let src = fs.readFileSync(CONFIG_JS, 'utf8');
  let n = 0;
  const skipped = [];

  for (const id of Object.keys(APPS)) {
    const m = matched[id];
    if (!m) { skipped.push(id + '（未匹配到应用）'); continue; }

    // 应用列表接口不返回 Key，必须单独取一次
    if (!m.token) {
      const { token, error } = await fetchApiKey(m.id, true);
      if (!token) {
        skipped.push(id + (error ? `（取 Key 失败 HTTP ${error.status}）` : '（该应用无 Key）'));
        continue;
      }
      m.token = token;
    }

    const re = new RegExp(`(${id}\\s*:\\s*\\{[^}]*?apiKey\\s*:\\s*)'[^']*'`);
    if (re.test(src)) {
      src = src.replace(re, `$1'${m.token}'`);
      n++;
    } else {
      skipped.push(id + '（config.js 中找不到 apiKey 字段）');
    }
  }

  /*
   * 直连模式（proxyMode: false）下 baseUrl 必须是完整地址，
   * config.js 默认写的 '/v1' 是相对路径，只在反代模式下成立。
   */
  const apiBase = BASE_URL + '/v1';
  const reBase = /(baseUrl\s*:\s*)'[^']*'/;
  if (reBase.test(src)) {
    const old = src.match(reBase)[0];
    if (!old.includes(apiBase)) {
      src = src.replace(reBase, `$1'${apiBase}'`);
      log(C.ok(`✔ baseUrl 已设为 ${apiBase}`));
    }
  }

  if (n) {
    fs.writeFileSync(CONFIG_JS, src);
    log(C.ok(`✔ 已回写 ${n} 个 Key 到 js/config.js`));
  } else {
    log(C.warn('⚠ 没有回写任何 Key'));
  }
  if (skipped.length) {
    log(C.warn('⚠ 跳过的项：'));
    skipped.forEach((s) => log('    · ' + s));
  }
}

/* ------------------------------------------------------------------ */
/* 入口                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const create = args.includes('--create');

  log(C.dim(`Dify 控制台: ${BASE_URL}`));
  log('');

  switch (cmd) {
    case 'whoami':       await cmdWhoami(); break;
    case 'publish':      await cmdPublish(); break;
    case 'delete':       await cmdDelete(); break;
    case 'providers':    await cmdProviders(); break;
    case 'apps':         await cmdApps(); break;
    case 'import':       await cmdImport(args.filter((a) => !a.startsWith('--'))); break;
    case 'keys':         await cmdKeys({ create }); break;
    case 'env':          await cmdEnv(); break;
    case 'write-config': await cmdWriteConfig(); break;
    case 'logout':
      try { fs.unlinkSync(TOKEN_CACHE); log(C.ok('✔ 已清除本地凭据缓存')); }
      catch { log(C.dim('（无缓存）')); }
      break;
    default:
      log([
        C.bold('dify-console.js — 真实 Dify 控制台自动化'),
        '',
        '  node tools/dify-console.js whoami         验证凭据',
        '  node tools/dify-console.js providers      列出模型供应商  ← 先跑这个',
        '  node tools/dify-console.js apps           列出已有应用',
        '  node tools/dify-console.js import <路径>  导入 DSL 建应用（导入后自动发布）',
        '  node tools/dify-console.js publish       发布 8 个应用（改成草稿后需重发）',
        '  node tools/dify-console.js delete        删除本项目 8 个应用（需 DIFY_FORCE=1）',
        '  node tools/dify-console.js keys [--create] 列出/创建 API Key',
        '  node tools/dify-console.js env            输出 Key 环境变量脚本',
        '  node tools/dify-console.js write-config   回写 Key 到 js/config.js',
        '  node tools/dify-console.js logout         清除凭据缓存',
        '',
        C.bold('凭据（cookie 名是 access_token / csrf_token，不是 console_token）：'),
        '  set DIFY_CONSOLE_TOKEN=<access_token 的值>',
        '  set DIFY_CONSOLE_CSRF=<csrf_token 的值>      # 写操作必需',
        '  —— 或者 ——',
        '  set DIFY_CONSOLE_EMAIL=<邮箱>',
        '  set DIFY_CONSOLE_PASSWORD=<密码>             # 脚本自动做 base64 编码'
      ].join('\n'));
  }
}

/**
 * fetch 兼容适配器 —— 把 send() 包装成 fetch 语义。
 *
 * 为什么需要：js/api.js 与 tests/real-dify-check.js 里是裸写的 fetch，
 * 而 Node 的 fetch 不读 HTTP_PROXY。在只允许代理出网的沙箱里，
 * 这些代码会 ECONNREFUSED。把本函数注入到 window.fetch 即可让全链路
 * 共用同一套（代理感知的）传输层，无需改动前端源码。
 *
 * 取舍：响应体整体缓冲后再模拟流式。对 SSE 消费者是等价的
 * （api.js 本身就是"缓冲 + 按 \n\n 切帧"的写法），只是少了逐块到达的时序。
 */
async function fetchShim(url, init = {}) {
  const method = String(init.method || 'GET').toUpperCase();
  const headers = {};
  const src = init.headers || {};
  if (typeof src.forEach === 'function') src.forEach((v, k) => { headers[k] = v; });
  else Object.assign(headers, src);

  let payload;
  if (init.body !== undefined && init.body !== null) {
    payload = typeof init.body === 'string' ? init.body : String(init.body);
    const hasCT = Object.keys(headers).some((k) => k.toLowerCase() === 'content-type');
    if (!hasCT) headers['Content-Type'] = 'application/json';
  }

  const res = await send(method, String(url), { headers, payload });
  const bodyText = res.body;
  const raw = res.headers || {};

  return {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    statusText: '',
    headers: {
      get: (k) => {
        const v = raw[String(k).toLowerCase()];
        return Array.isArray(v) ? v.join(', ') : (v === undefined ? null : v);
      },
      getSetCookie: () => {
        const v = raw['set-cookie'];
        return Array.isArray(v) ? v : (v ? [v] : []);
      }
    },
    text: async () => bodyText,
    json: async () => JSON.parse(bodyText),
    body: {
      getReader: () => {
        let sent = false;
        return {
          read: async () => {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: Buffer.from(bodyText, 'utf8') };
          },
          cancel: async () => {},
          releaseLock: () => {}
        };
      }
    }
  };
}

// 作为 CLI 直接运行时才执行入口；被 require（测试）时只导出内部函数。
if (require.main === module) {
  main().catch((e) => die(e && e.message ? e.message : String(e)));
}

module.exports = {
  // 传输层
  send, fetchShim, proxyFor, bypassProxy, parseSetCookies,
  // 鉴权
  encodePassword,
  // 其它可测纯函数
  explainFailure, matchToAppIds, BASE_URL, APPS
};
