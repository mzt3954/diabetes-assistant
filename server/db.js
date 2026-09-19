/**
 * db.js — MySQL 连接池与数据访问层
 * ---------------------------------------------------------------------------
 * 统一使用 mysql2/promise 的连接池：
 *   · 连接池复用 TCP 连接，避免每次请求重新握手
 *   · 全部查询走参数化占位符（?），从根本上杜绝 SQL 注入
 *   · dateStrings: true —— DATETIME 直接以字符串返回，避免 Node 与 MySQL
 *     时区不一致导致「创建时间差 8 小时」这类问题
 * ---------------------------------------------------------------------------
 */
'use strict';

const mysql = require('mysql2/promise');
const config = require('./config');

let pool = null;

/** 获取（惰性创建）连接池 */
function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      charset: 'utf8mb4',
      waitForConnections: true,
      connectionLimit: config.db.connectionLimit,
      queueLimit: 0,
      dateStrings: true,
      multipleStatements: false,
    });
  }
  return pool;
}

/**
 * 执行查询
 * @param {string} sql    带 ? 占位符的 SQL
 * @param {Array}  params 参数数组
 * @returns {Promise<Array>} 结果行
 */
async function query(sql, params) {
  const [rows] = await getPool().execute(sql, params || []);
  return rows;
}

/** 执行写操作，返回 { affectedRows, insertId } */
async function execute(sql, params) {
  const [result] = await getPool().execute(sql, params || []);
  return result;
}

/** 在事务中执行（回调内使用传入的 conn 执行语句） */
async function withTransaction(fn) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * 健康检查：能连上并执行 SELECT 1 即视为正常。
 * 连接池建立时不会立即握手，因此必须真正跑一次查询才能确认数据库可用。
 */
async function healthCheck() {
  const started = Date.now();
  const rows = await query('SELECT DATABASE() AS db, VERSION() AS version, NOW() AS now_time');
  return Object.assign({ latencyMs: Date.now() - started }, rows[0]);
}

/** 统计各表行数，供 /api/health 展示 */
async function stats() {
  const rows = await query(
    'SELECT (SELECT COUNT(*) FROM users) AS users, ' +
    '(SELECT COUNT(*) FROM login_logs) AS login_logs'
  );
  return rows[0];
}

/** 关闭连接池（进程退出时调用，释放所有连接） */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { getPool, query, execute, withTransaction, healthCheck, stats, closePool };
