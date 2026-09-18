/**
 * config.js — 后端配置（服务端口 + MySQL 连接参数）
 * ---------------------------------------------------------------------------
 * 配置来源优先级：进程环境变量 > server/.env > 代码内默认值。
 * .env 使用 Node 20.12+ 内置的 process.loadEnvFile()，无需 dotenv 依赖。
 *
 * 本机默认值与课程要求一致：MySQL 装在本机，root 账号无密码。
 * ---------------------------------------------------------------------------
 */
'use strict';

const path = require('path');

/* 读取 server/.env（文件不存在时静默跳过） */
try {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(path.join(__dirname, '.env'));
  }
} catch (e) {
  /* 没有 .env 属正常情况，继续使用默认值 */
}

function toInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  /** HTTP 服务 */
  server: {
    host: process.env.SERVER_HOST || '127.0.0.1',
    port: toInt(process.env.SERVER_PORT, 8090),
    /** 是否同时托管前端静态文件（单端口，规避跨域） */
    serveStatic: process.env.SERVE_STATIC !== '0',
  },

  /** MySQL 连接 */
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: toInt(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    // 注意：这里用 !== undefined 判断，才能正确表达「密码就是空串」
    password: process.env.DB_PASSWORD === undefined ? '' : process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'diabetes_assistant',
    connectionLimit: toInt(process.env.DB_POOL_SIZE, 10),
    /** 建库建表脚本所在目录 */
    sqlDir: path.join(__dirname, 'sql'),
  },

  /** 启动时自动执行建库建表 + 种子数据（AUTO_INIT_DB=1 开启） */
  autoInit: process.env.AUTO_INIT_DB === '1',
};

/** 供日志打印：隐藏口令 */
config.describe = function describe() {
  const c = config.db;
  return `${c.user}@${c.host}:${c.port}/${c.database}` +
    `（口令：${c.password ? '已设置' : '空'}）`;
};

module.exports = config;
