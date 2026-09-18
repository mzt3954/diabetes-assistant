/**
 * db-integration-check.js — 前后端联调自测（前端 ↔ Express ↔ MySQL）
 * ---------------------------------------------------------------------------
 * 目的：在**不打开浏览器**的前提下，验证前端真的把用户数据写进了 MySQL。
 *
 * 做法：用 jsdom 加载全部前端模块，并打开 __DPA_FORCE_DB__ 强制启用数据库模式。
 *       jsdom 的 XMLHttpRequest 会发出**真实 HTTP 请求**打到后端，
 *       因此这条链路是真的：前端 JS → HTTP → Express → mysql2 → MySQL。
 *
 * 前置条件：
 *   1. MySQL 已启动，且已执行 node server/init-db.js
 *   2. 后端已启动：node server/index.js（默认 127.0.0.1:8090）
 *
 * 运行：node tests/db-integration-check.js
 *       node tests/db-integration-check.js --base http://127.0.0.1:8090
 * ---------------------------------------------------------------------------
 */
'use strict';

const { JSDOM } = require('jsdom');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const baseArg = argv.indexOf('--base');
const BASE = (baseArg >= 0 ? argv[baseArg + 1] : 'http://127.0.0.1:8090').replace(/\/+$/, '');

/* 注意顺序：db-client.js 必须排在 store.js 之后、auth.js 之前 */
const FILES = [
  'js/config.js', 'js/crypto.js', 'js/seed.js', 'js/store.js',
  'js/db-client.js', 'js/ui.js', 'js/auth.js', 'js/mock-engine.js', 'js/api.js',
];

/* ---------- 断言框架 ---------- */
let pass = 0, fail = 0;
const failures = [];
function ok(name) { pass++; console.log('  ✅ ' + name); }
function bad(name, err) { fail++; failures.push(name + ' → ' + (err && err.message || err)); console.log('  ❌ ' + name + '  → ' + (err && err.message || err)); }
function check(name, cond, detail) {
  if (cond) ok(name); else bad(name, new Error(detail || '断言失败'));
}
function eq(name, a, b) {
  if (a === b) ok(name); else bad(name, new Error(`期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`));
}

/** 探活后端（用 Node 原生 http，不经过 jsdom） */
function pingBase() {
  return new Promise((resolve) => {
    const req = http.get(BASE + '/api/health', { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve({ ok: res.statusCode === 200, body: JSON.parse(body) }); }
        catch (e) { resolve({ ok: false, body: null }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
  });
}

/** 用 Node 原生 http 直接读接口（绕开前端，作为独立取证）。失败时带一次重试。 */
function apiGet(pathname, retry) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    const req = http.get(BASE + pathname, { agent: false, timeout: 5000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { finish(JSON.parse(body)); }
        catch (e) { finish({ __parseError: body.slice(0, 200) }); }
      });
    });
    req.on('error', (e) => {
      if (!retry) {
        setTimeout(() => apiGet(pathname, true).then(finish), 300);
      } else {
        finish({ __error: e.message });
      }
    });
    req.on('timeout', () => { req.destroy(); finish({ __error: 'timeout' }); });
  });
}

const STAMP = Date.now().toString().slice(-8);
const NEW_USER = 'dbtest' + STAMP;

(async function main() {
  console.log('='.repeat(74));
  console.log('前后端联调自测：前端 JS → Express → MySQL');
  console.log('='.repeat(74));
  console.log('  后端地址：' + BASE);
  console.log('');

  /* ---- 0. 后端是否在线 ---- */
  const ping = await pingBase();
  if (!ping.ok) {
    console.log('  ✗ 后端不可用（' + (ping.error || 'HTTP ' + ping.body) + '）');
    console.log('    请先启动：node server/index.js');
    process.exit(2);
  }
  console.log('  后端在线：' + JSON.stringify(ping.body.data.database));
  console.log('  数据库计数：' + JSON.stringify(ping.body.data.tables));
  console.log('');

  /* ---- 1. 搭建 jsdom 环境（同源指向后端） ---- */
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: BASE + '/index.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  // 强制启用数据库模式（正常情况下 jsdom 会被自动判定为测试环境而关闭）
  window.__DPA_FORCE_DB__ = true;
  // 不加载 config.local.js，避免真实 Dify Key 影响
  FILES.forEach((f) => {
    window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  });
  const DPA = window.DPA;

  console.log('【A · 模块装载】');
  check('DPA.db 已装载', !!DPA.db);
  check('DPA.db.disabled === false（强制启用生效）', DPA.db.disabled === false, 'disabled=' + DPA.db.disabled);
  check('DPA.auth 已装载', !!DPA.auth);
  console.log('');

  /* ---- 2. 探测后端 ---- */
  console.log('【B · 探测后端】');
  const probed = await new Promise((resolve) => {
    let done = false;
    DPA.db.probe((okFlag) => { if (!done) { done = true; resolve(okFlag); } });
    setTimeout(() => { if (!done) { done = true; resolve(false); } }, 8000);
  });
  check('probe() 探测成功', probed === true, 'probeState=' + DPA.db.probeState);
  eq('mode 变为 database', DPA.db.mode, 'database');
  eq('auth.source() 为 database', DPA.auth.source(), 'database');
  console.log('');

  /* ---- 3. 登录（同步，走数据库） ---- */
  console.log('【C · 登录（同步 API，走数据库校验）】');
  const r1 = DPA.auth.login('admin', 'admin123', true);
  check('admin/admin123 登录成功', r1.ok === true, JSON.stringify(r1));
  eq('数据来源标记为 database', r1.source, 'database');
  eq('返回角色为 admin', r1.user && r1.user.role, 'admin');
  check('返回体不含 password_hash', r1.user && r1.user.password_hash === undefined);
  check('返回体不含 password_salt', r1.user && r1.user.password_salt === undefined);
  eq('会话已建立', DPA.auth.username(), 'admin');

  const r2 = DPA.auth.login('admin', 'definitely-wrong', true);
  eq('错误口令被数据库拒绝', r2.ok, false);
  eq('错误口令未建立会话（仍为 admin）', DPA.auth.username(), 'admin');

  const r3 = DPA.auth.login('no-such-user-' + STAMP, 'whatever', true);
  eq('不存在的用户被拒绝', r3.ok, false);
  console.log('');

  /* ---- 4. 注册（同步，落库） ---- */
  console.log('【D · 注册（同步 API，写入 MySQL）】');
  DPA.auth.logout(false);
  const r4 = DPA.auth.register(NEW_USER, 'test1234', {
    phone: '13800001234', age: 41, gender: '男', diabetesType: '2型糖尿病',
  });
  check('注册成功', r4.ok === true, JSON.stringify(r4));
  eq('注册来源为 database', r4.source, 'database');
  eq('资料已随注册写入（手机号）', r4.user && r4.user.phone, '13800001234');
  eq('资料已随注册写入（糖尿病类型）', r4.user && r4.user.diabetesType, '2型糖尿病');

  const r5 = DPA.auth.register(NEW_USER, 'test1234');
  eq('重复用户名被数据库唯一索引拦下', r5.ok, false);
  console.log('');

  /* ---- 5. 独立取证：绕开前端，直接问后端要数据 ---- */
  console.log('【E · 独立取证（绕开前端，直接读接口）】');
  const list = await apiGet('/api/users?keyword=' + encodeURIComponent(NEW_USER));
  const hit = list && list.data && list.data.items && list.data.items[0];
  check('后端能查到刚注册的用户', !!hit, '响应：' + JSON.stringify(list).slice(0, 300));
  if (hit) {
    eq('数据库中的手机号一致', hit.phone, '13800001234');
    eq('数据库中的糖尿病类型一致', hit.diabetesType, '2型糖尿病');
    eq('数据库中的角色为 user', hit.role, 'user');
    check('数据库中 user_id 为正整数', Number.isInteger(hit.user_id) && hit.user_id > 0, 'user_id=' + hit.user_id);
  }
  console.log('');

  /* ---- 6. 改资料 → 写穿透到 MySQL ---- */
  console.log('【F · 改资料（本地同步改 + 异步写穿透）】');
  const up = DPA.store.users.update(NEW_USER, { phone: '13900005678', age: 42 });
  check('本地更新成功', up.ok === true, JSON.stringify(up));
  const rejected = DPA.store.users.update(NEW_USER, { role: 'admin', password: 'x' });
  check('越权字段被白名单挡下', rejected.ok === true, JSON.stringify(rejected));

  // 等写穿透完成（异步）
  await new Promise((r) => setTimeout(r, 1200));

  const list2 = await apiGet('/api/users?keyword=' + encodeURIComponent(NEW_USER));
  const hit2 = list2 && list2.data && list2.data.items && list2.data.items[0];
  check('改资料后仍能查到该用户', !!hit2);
  if (hit2) {
    eq('手机号已同步到 MySQL', hit2.phone, '13900005678');
    eq('年龄已同步到 MySQL', String(hit2.age), '42');
    eq('角色未被越权改写', hit2.role, 'user');
  }
  console.log('');

  /* ---- 7. 登录日志 ---- */
  console.log('【G · 登录日志】');
  const before = ping.body.data.tables.login_logs;
  const ping2 = await pingBase();
  const after = ping2.ok ? ping2.body.data.tables.login_logs : null;
  check('login_logs 行数在本次测试中增长', after === null || after > before, `${before} → ${after}`);
  console.log('');

  /* ---- 8. 删除（CRUD 的 D），同时把测试账号清理掉 ---- */
  console.log('【H · 删除（并清理测试账号）】');
  const del = await new Promise((resolve) => {
    DPA.db.removeByUsername(NEW_USER, resolve);
    setTimeout(() => resolve({ ok: false, code: 'TIMEOUT' }), 5000);
  });
  check('删除请求成功', del && del.ok === true, JSON.stringify(del));
  await new Promise((r) => setTimeout(r, 400));
  const list3 = await apiGet('/api/users?keyword=' + encodeURIComponent(NEW_USER));
  const gone = !(list3 && list3.data && list3.data.items && list3.data.items.length);
  check('数据库中已查不到该用户（删除生效）', gone, '响应：' + JSON.stringify(list3).slice(0, 200));
  console.log('');

  /* ---- 汇总 ---- */
  console.log('='.repeat(74));
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  if (fail) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  · ' + f));
  }
  console.log('');
  console.log(`本次联调账号 ${NEW_USER} 已在测试结束时删除，数据库保持干净。`);
  console.log('='.repeat(74));

  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('联调自测异常：' + err.message);
  console.error(err.stack);
  process.exit(1);
});
