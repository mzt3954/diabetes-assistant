/**
 * index.js — 后端服务启动入口
 * ---------------------------------------------------------------------------
 * 一条命令同时提供「REST API」与「前端静态站点」：
 *
 *     node server/index.js
 *     → 浏览器打开 http://127.0.0.1:8090/index.html
 *
 * 启动流程：
 *   1) 读取配置（config.js：环境变量 > .env > 默认值）
 *   2) 若 AUTO_INIT_DB=1，先按序执行 sql/01-schema.sql、02-seed.sql
 *   3) 探活数据库（SELECT 1），失败不退出但明确告警，便于先看前端
 *   4) 监听端口并打印可访问地址
 *   5) 收到 Ctrl+C / SIGTERM 时优雅关闭连接池
 * ---------------------------------------------------------------------------
 */
'use strict';

const http = require('http');
const config = require('./config');
const db = require('./db');
const { createApp, PROJECT_ROOT } = require('./app');

function line() { console.log('-'.repeat(74)); }

/** 需要 AUTO_INIT_DB 时执行建库建表 */
async function autoInitIfNeeded() {
  if (!config.autoInit) return;
  console.log('[init] AUTO_INIT_DB=1，开始执行建库建表脚本…');
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, [require('path').join(__dirname, 'init-db.js')], {
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    throw new Error('建库建表脚本执行失败，请单独运行 `node server/init-db.js` 查看详细错误。');
  }
}

async function main() {
  line();
  console.log('糖尿病预治智能助手 — 后端服务（Express + MySQL）');
  line();
  console.log('  数据库：' + config.describe());
  console.log('  静态站点：' + (config.server.serveStatic ? PROJECT_ROOT : '已关闭（SERVE_STATIC=0）'));

  await autoInitIfNeeded();

  /* ---- 探活数据库：连不上也照常启动，但要把话说清楚 ---- */
  try {
    const info = await db.healthCheck();
    const st = await db.stats();
    console.log(`  数据库连接：正常（MySQL ${info.version}，${info.latencyMs} ms，` +
      `users=${st.users} 行，login_logs=${st.login_logs} 行）`);
  } catch (err) {
    console.log('');
    console.log('  ⚠ 数据库暂时不可用：' + err.message);
    if (err.code === 'ECONNREFUSED') {
      console.log('    → MySQL 似乎没有启动，请先启动 mysqld（默认端口 3306）。');
    } else if (err.code === 'ER_BAD_DB_ERROR') {
      console.log('    → 数据库 ' + config.db.database + ' 不存在，请执行：node server/init-db.js');
    } else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      console.log('    → 账号/口令不正确，请检查 server/.env 里的 DB_USER / DB_PASSWORD。');
    } else if (err.code === 'ER_NO_SUCH_TABLE') {
      console.log('    → 数据表缺失，请执行：node server/init-db.js');
    }
    console.log('    → 服务仍会启动，但涉及数据库的接口会返回 503。');
  }

  const app = createApp();
  const server = http.createServer(app);

  await new Promise((resolve, reject) => {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error('');
        console.error(`  ✗ 端口 ${config.server.port} 已被占用。`);
        console.error('    → 换端口启动：SERVER_PORT=8091 node server/index.js');
        console.error('    → 或先关掉占用该端口的进程。');
      }
      reject(err);
    });
    server.listen(config.server.port, config.server.host, resolve);
  });

  const base = `http://${config.server.host}:${config.server.port}`;
  console.log('');
  line();
  console.log('  服务已启动，按 Ctrl+C 停止。');
  console.log(`    前端首页    ${base}/index.html`);
  console.log(`    健康检查    ${base}/api/health`);
  console.log(`    用户列表    ${base}/api/users`);
  console.log(`    登录接口    POST ${base}/api/auth/login`);
  console.log(`    注册接口    POST ${base}/api/auth/register`);
  line();

  /* ---- 优雅退出 ---- */
  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    console.log(`\n[exit] 收到 ${signal}，正在关闭…`);
    server.close(async () => {
      await db.closePool();
      console.log('[exit] 已安全退出。');
      process.exit(0);
    });
    // 兜底：5 秒内没关干净就强制退出
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('');
  console.error('  ✗ 服务启动失败：' + err.message);
  console.error(err.stack);
  process.exit(1);
});
