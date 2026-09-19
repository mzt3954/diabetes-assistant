#!/usr/bin/env node
/**
 * db-mode-start.js — 一键启动「数据库模式」
 * ---------------------------------------------------------------------------
 * 一条命令完成四件事：
 *   1) 检测 MySQL，没起就拉起来（等待就绪）
 *   2) 检查 npm 依赖（express / mysql2）
 *   3) 启动后端服务（API + 前端静态站点）
 *   4) 打开浏览器指向 http://127.0.0.1:8090/index.html
 *
 * 用法：
 *   node tools/db-mode-start.js            启动（默认）
 *   node tools/db-mode-start.js --no-open  启动但不自动开浏览器
 *   node tools/db-mode-start.js --init     先重建库表再启动
 *   node tools/db-mode-start.js --stop     停掉后端与 MySQL
 *   node tools/db-mode-start.js --status   只看状态，不启动任何东西
 *
 * 【为什么要放在 Node 里而不是写进 .cmd】
 * cmd.exe 按 OEM 代码页（简体中文 Windows 是 936/GBK）解析批处理文件。
 * 只要 .cmd 里出现非 ASCII 字节（哪怕只是注释），就可能错位解析、
 * 把相邻语句吃掉。因此 .cmd 一律保持纯 ASCII，只做转发；
 * 全部业务逻辑与中文输出都放在本文件里。
 * ---------------------------------------------------------------------------
 */
'use strict';

const { spawn, spawnSync } = require('child_process');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const CFG = {
  dbPort: Number(process.env.DB_PORT || 3306),
  dbHost: process.env.DB_HOST || '127.0.0.1',
  apiPort: Number(process.env.SERVER_PORT || 8090),
  apiHost: '127.0.0.1',
  dbName: process.env.DB_NAME || 'diabetes_assistant',
  /** MySQL 首次启动（含崩溃恢复）可能需要较长时间 */
  mysqlBootTimeout: 90000,
  apiBootTimeout: 30000,
};

const BASE = `http://${CFG.apiHost}:${CFG.apiPort}`;
const MYSQLD_LOG = path.join(os.tmpdir(), 'dpa-mysqld-start.log');

/* ==================== 小工具 ==================== */

function log(msg) { process.stdout.write(msg + '\n'); }
function blank() { log(''); }
function hr(ch) { log((ch || '-').repeat(74)); }

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** 探测 TCP 端口是否可连接 */
function portOpen(port, host) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: host || '127.0.0.1' });
    let done = false;
    const finish = (v) => { if (!done) { done = true; sock.destroy(); resolve(v); } };
    sock.setTimeout(1200);
    sock.once('connect', () => finish(true));
    sock.once('error', () => finish(false));
    sock.once('timeout', () => finish(false));
  });
}

/** 轮询等待条件成立 */
async function waitFor(fn, timeoutMs, intervalMs, onTick) {
  const deadline = Date.now() + timeoutMs;
  let n = 0;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    if (await fn()) return true;
    n++;
    if (onTick) onTick(n);
    // eslint-disable-next-line no-await-in-loop
    await sleep(intervalMs);
  }
  return false;
}

/** 轻量 HTTP GET，返回 JSON 或 null */
function httpGetJson(url) {
  return new Promise((resolve) => {
    let req;
    try {
      const http = require('http');
      req = http.get(url, { agent: false, timeout: 2000 }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { resolve(null); } });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    } catch (e) { resolve(null); }
  });
}

/* ==================== MySQL 定位与启动 ==================== */

/** 在常见安装位置里找 mysqld.exe 与数据目录 */
function findMysql() {
  const roots = [
    process.env.MYSQL_HOME,
    'C:\\Program Files\\MySQL\\MySQL Server 8.4',
    'C:\\Program Files\\MySQL\\MySQL Server 8.0',
    'C:\\Program Files\\MySQL\\MySQL Server 8.1',
    'C:\\Program Files\\MySQL\\MySQL Server 8.2',
    'C:\\Program Files\\MySQL\\MySQL Server 8.3',
    'C:\\Program Files\\MySQL\\MySQL Server 5.7',
    'C:\\Program Files (x86)\\MySQL\\MySQL Server 8.4',
  ].filter(Boolean);

  // 也扫一遍 C:\Program Files\MySQL\ 下的所有版本目录
  const mysqlRoot = 'C:\\Program Files\\MySQL';
  try {
    if (fs.existsSync(mysqlRoot)) {
      fs.readdirSync(mysqlRoot).forEach((d) => {
        roots.push(path.join(mysqlRoot, d));
      });
    }
  } catch (e) { /* 忽略 */ }

  for (const base of roots) {
    const mysqld = path.join(base, 'bin', 'mysqld.exe');
    if (!fs.existsSync(mysqld)) continue;

    // 数据目录：优先本机的 ProgramData 同名目录
    let datadir = '';
    const ver = path.basename(base);
    const candidates = [
      path.join('C:\\ProgramData\\MySQL', ver, 'Data'),
      path.join(base, 'data'),
      path.join(base, 'Data'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(path.join(c, 'mysql'))) { datadir = c; break; }
    }
    return { mysqld, basedir: base, datadir };
  }
  return null;
}

/** 启动 mysqld（独立进程，脚本退出后继续运行） */
function startMysqld(info) {
  log('  正在启动 MySQL，首次启动可能需要 10~30 秒，请稍候…');

  if (!info.datadir) {
    log('  [错误] 找不到 MySQL 数据目录，无法启动。');
    log('         请确认 C:\\ProgramData\\MySQL\\<版本>\\Data 存在。');
    return false;
  }

  let out;
  try {
    out = fs.openSync(MYSQLD_LOG, 'w');
  } catch (e) { out = 'ignore'; }

  const child = spawn(info.mysqld, [
    `--basedir=${info.basedir}`,
    `--datadir=${info.datadir}`,
    `--port=${CFG.dbPort}`,
    '--console',
  ], {
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  child.unref();

  return true;
}

async function ensureMysql() {
  log('[1/4] 检查 MySQL');

  if (await portOpen(CFG.dbPort, CFG.dbHost)) {
    log(`  ✓ MySQL 已在运行（${CFG.dbHost}:${CFG.dbPort}）`);
    return true;
  }

  const info = findMysql();
  if (!info) {
    log('  ✗ 未找到 mysqld.exe。');
    log('    请确认已安装 MySQL，或设置环境变量 MYSQL_HOME 指向安装目录。');
    return false;
  }
  log(`  找到安装：${info.basedir}`);
  log(`  数据目录：${info.datadir || '(未找到)'}`);

  if (!startMysqld(info)) return false;

  const okFlag = await waitFor(
    () => portOpen(CFG.dbPort, CFG.dbHost),
    CFG.mysqlBootTimeout, 1500,
    (n) => { if (n % 4 === 0) process.stdout.write(`     等待就绪… ${Math.round(n * 1.5)}s\r`); }
  );

  if (okFlag) {
    log('');
    log(`  ✓ MySQL 已就绪（${CFG.dbHost}:${CFG.dbPort}）`);
    return true;
  }

  log('');
  log('  ✗ MySQL 启动超时。');
  log(`    日志：${MYSQLD_LOG}`);
  try {
    const tail = fs.readFileSync(MYSQLD_LOG, 'utf8').split(/\r?\n/).slice(-12).join('\n');
    if (tail.trim()) log('    --- 日志尾部 ---\n' + tail.split('\n').map((l) => '    ' + l).join('\n'));
  } catch (e) { /* 忽略 */ }
  return false;
}

/* ==================== 依赖与库表 ==================== */

function ensureDeps() {
  log('[2/4] 检查依赖');
  const missing = [];
  ['express', 'mysql2'].forEach((m) => {
    if (!fs.existsSync(path.join(ROOT, 'node_modules', m))) missing.push(m);
  });
  if (!missing.length) {
    log('  ✓ express / mysql2 已安装');
    return true;
  }
  log(`  ✗ 缺少依赖：${missing.join(', ')}`);
  log('    请先执行：npm install');
  return false;
}

async function ensureSchema(forceInit) {
  log('[3/4] 检查数据库与表');

  if (!forceInit) {
    // 用后端自带的探活脚本判断表是否齐全
    const r = spawnSync(process.execPath, [path.join(ROOT, 'server', 'init-db.js'), '--check'], {
      cwd: ROOT, encoding: 'utf8', windowsHide: true,
    });
    const out = String(r.stdout || '');
    if (r.status === 0 && /users/.test(out)) {
      const m = /users\s+行数=(\d+)/.exec(out);
      const l = /login_logs\s+行数=(\d+)/.exec(out);
      log(`  ✓ 库 ${CFG.dbName} 已就绪（users ${m ? m[1] : '?'} 行，login_logs ${l ? l[1] : '?'} 行）`);
      return true;
    }
    log('  ! 表缺失或不完整，开始建库建表…');
  } else {
    log('  ! --init：重建库表…');
  }

  const r = spawnSync(process.execPath, [path.join(ROOT, 'server', 'init-db.js')], {
    cwd: ROOT, encoding: 'utf8', windowsHide: true,
  });
  if (r.status !== 0) {
    log('  ✗ 建库建表失败：');
    log(String(r.stderr || r.stdout || '').split(/\r?\n/).slice(0, 15).map((l) => '    ' + l).join('\n'));
    return false;
  }
  log('  ✓ 建库建表完成');
  return true;
}

/* ==================== 后端 ==================== */

function startServer() {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    stdio: 'inherit',
    env: Object.assign({}, process.env, { SERVER_PORT: String(CFG.apiPort) }),
    windowsHide: true,
  });
  return child;
}

function stopAll() {
  log('正在停止…');
  const killByImage = (img) => {
    const r = spawnSync('taskkill', ['/F', '/IM', img], { encoding: 'utf8', windowsHide: true });
    return r.status === 0;
  };
  // 后端是 node，不能按镜像名杀（会误伤别的 node 进程），按端口找
  const r = spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true });
  const lines = String(r.stdout || '').split(/\r?\n/);
  const pids = new Set();
  lines.forEach((l) => {
    if (!new RegExp(`[:.]${CFG.apiPort}\\s`).test(l)) return;
    if (!/LISTENING/i.test(l)) return;
    const m = /(\d+)\s*$/.exec(l.trim());
    if (m) pids.add(m[1]);
  });
  pids.forEach((pid) => {
    spawnSync('taskkill', ['/F', '/PID', pid], { windowsHide: true });
    log(`  ✓ 已停止占用 ${CFG.apiPort} 的进程（PID ${pid}）`);
  });
  if (killByImage('mysqld.exe')) log('  ✓ 已停止 MySQL');
  log('完成。');
}

/* ==================== 浏览器 ==================== */

function openBrowser(url) {
  try {
    const child = spawn('cmd', ['/c', 'start', '', url.replace(/[&^]/g, '^$&')], {
      detached: true, stdio: 'ignore', windowsHide: true,
    });
    child.unref();
    return true;
  } catch (e) {
    return false;
  }
}

/* ==================== 主流程 ==================== */

async function status() {
  hr('=');
  log('数据库模式 — 当前状态');
  hr('=');
  const dbUp = await portOpen(CFG.dbPort, CFG.dbHost);
  const apiUp = await portOpen(CFG.apiPort, CFG.apiHost);
  log(`  MySQL      ${dbUp ? '运行中' : '未运行'}   (${CFG.dbHost}:${CFG.dbPort})`);
  log(`  后端服务    ${apiUp ? '运行中' : '未运行'}   (${BASE})`);
  if (apiUp) {
    const h = await httpGetJson(`${BASE}/api/health`);
    if (h && h.ok && h.data) {
      const d = h.data;
      log(`  数据库      ${d.database && d.database.connected ? '已连接 ' + d.database.version : '未连接'}`);
      log(`  表行数      users ${d.tables && d.tables.users} / login_logs ${d.tables && d.tables.login_logs}`);
    }
  }
  hr('=');
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--stop')) { stopAll(); return; }
  if (argv.includes('--status')) { await status(); return; }

  const noOpen = argv.includes('--no-open');
  const forceInit = argv.includes('--init');

  hr('=');
  log('糖尿病预治智能助手 — 数据库模式启动器');
  hr('=');
  blank();

  /* 1. MySQL */
  if (!(await ensureMysql())) { blank(); pauseExit(1); return; }
  blank();

  /* 2. 依赖 */
  if (!(await ensureDeps())) { blank(); pauseExit(1); return; }
  blank();

  /* 3. 库表 */
  if (!(await ensureSchema(forceInit))) { blank(); pauseExit(1); return; }
  blank();

  /* 4. 后端 */
  log(`[4/4] 启动后端服务（${BASE}）`);

  // 端口已被占用 → 提示但不强行杀（避免误伤）
  if (await portOpen(CFG.apiPort, CFG.apiHost)) {
    const h = await httpGetJson(`${BASE}/api/health`);
    if (h && h.ok) {
      log(`  ! 端口 ${CFG.apiPort} 已被一个正常的后端占用，直接复用它。`);
      log('    如需重启，请先运行：node tools/db-mode-start.js --stop');
      blank();
      await openAndReport(noOpen);
      pauseExit(0);
      return;
    }
    log(`  ✗ 端口 ${CFG.apiPort} 被占用且不是本项目的后端。`);
    log('    换个端口：set SERVER_PORT=8091 后再启动');
    log('    或先清理：node tools/db-mode-start.js --stop');
    blank();
    pauseExit(1);
    return;
  }

  const server = startServer();

  const ready = await waitFor(
    async () => !!(await httpGetJson(`${BASE}/api/health`)),
    CFG.apiBootTimeout, 800
  );

  if (!ready) {
    log('  ✗ 后端启动超时。上面若已打印错误，请按提示处理。');
    try { server.kill(); } catch (e) { /* 忽略 */ }
    blank();
    pauseExit(1);
    return;
  }

  log('  ✓ 后端已就绪');
  blank();

  await openAndReport(noOpen);

  // 优雅退出：Ctrl+C 或窗口关闭时停后端（MySQL 保持运行）
  const shutdown = () => {
    try { server.kill(); } catch (e) { /* 忽略 */ }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  server.on('exit', (code) => {
    blank();
    log(`后端已退出（代码 ${code}）。MySQL 仍在后台运行。`);
    pauseExit(code === 0 ? 0 : 1);
  });
}

async function openAndReport(noOpen) {
  const h = await httpGetJson(`${BASE}/api/health`);
  const dbInfo = h && h.ok ? h.data : null;

  hr('=');
  log('  数据库模式已就绪');
  hr('=');
  log(`    前端首页      ${BASE}/index.html`);
  log(`    用户列表接口  ${BASE}/api/users`);
  log(`    健康检查      ${BASE}/api/health`);
  if (dbInfo && dbInfo.database) {
    log('');
    log(`    数据库        ${CFG.dbName}  (MySQL ${dbInfo.database.version})`);
    log(`    用户 / 日志   ${dbInfo.tables.users} 行 / ${dbInfo.tables.login_logs} 行`);
  }
  log('');
  log('    登录账号      admin / admin123（管理员）');
  log('                  user  / user123 （普通用户）');
  log('');
  log('    老师查库命令：');
  log(`      "C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysql.exe" -u root`);
  log(`      USE ${CFG.dbName};  SELECT * FROM users;`);
  hr('=');
  blank();

  if (!noOpen) {
    if (openBrowser(`${BASE}/index.html`)) {
      log('  已尝试打开浏览器；若未自动弹出，请手动访问上面的地址。');
    } else {
      log('  无法自动打开浏览器，请手动访问上面的地址。');
    }
  }
  log('  按 Ctrl+C 停止后端（MySQL 会继续运行）。');
  blank();
}

function pauseExit(code) {
  // 由 .cmd 调用时会在结束后 pause；直接被 node 调用时不必卡住
  process.exit(code);
}

main().catch((err) => {
  log('');
  log('启动器异常：' + (err && err.message || err));
  if (err && err.stack) log(err.stack);
  process.exit(1);
});
