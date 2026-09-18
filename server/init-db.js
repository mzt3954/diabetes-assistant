/**
 * init-db.js — 建库建表脚本（可重复执行）
 * ---------------------------------------------------------------------------
 * 作用：把 server/sql/ 下的 SQL 文件按文件名顺序执行一遍。
 *   01-schema.sql  —— 创建数据库 diabetes_assistant + users / login_logs 两张表
 *   02-seed.sql    —— 写入演示账号与登录日志样例
 *
 * 用法：
 *   node server/init-db.js            # 建库建表 + 种子数据（推荐）
 *   node server/init-db.js --schema   # 只建库建表，不写种子数据
 *   node server/init-db.js --check    # 只查看当前数据库状态，不做任何修改
 *
 * 说明：本脚本**不指定 database** 连接（因为库可能还不存在），
 *       因此需要 multipleStatements: true 来一次执行整份 SQL 文件。
 *       日常业务的连接池（db.js）仍然保持 multipleStatements: false。
 * ---------------------------------------------------------------------------
 */
'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('./config');

const args = process.argv.slice(2);
const onlySchema = args.includes('--schema');
const onlyCheck = args.includes('--check');

function log(...a) { console.log(...a); }
function line() { log('-'.repeat(74)); }

/** 建一条「不带 database」的连接：库还不存在时也能连上 */
async function connectWithoutDb() {
  return mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    charset: 'utf8mb4',
    multipleStatements: true,
    dateStrings: true,
  });
}

/** 读取并执行一个 SQL 文件 */
async function runSqlFile(conn, fileName) {
  const file = path.join(config.db.sqlDir, fileName);
  if (!fs.existsSync(file)) {
    throw new Error(`找不到 SQL 文件：${file}`);
  }
  const sql = fs.readFileSync(file, 'utf8');
  const started = Date.now();
  await conn.query(sql);
  log(`  ✓ ${fileName}  执行成功（${Date.now() - started} ms，${sql.length} 字节）`);
}

/** 打印当前数据库概览，便于人工核对 */
async function showStatus() {
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    charset: 'utf8mb4',
    dateStrings: true,
  });
  try {
    line();
    log('当前数据库状态');
    line();
    const [dbs] = await conn.query(
      'SELECT SCHEMA_NAME AS name, DEFAULT_CHARACTER_SET_NAME AS charset, ' +
      'DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA ' +
      'WHERE SCHEMA_NAME = ?', [config.db.database]
    );
    if (!dbs.length) {
      log(`  数据库 ${config.db.database} 尚不存在，请先执行：node server/init-db.js`);
      return;
    }
    log(`  数据库：${dbs[0].name}  字符集=${dbs[0].charset}  排序规则=${dbs[0].collation}`);

    const [tables] = await conn.query(
      'SELECT TABLE_NAME AS t, TABLE_ROWS AS r, ENGINE AS e, TABLE_COMMENT AS c ' +
      'FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
      [config.db.database]
    );
    log(`  数据表：共 ${tables.length} 张`);
    for (const t of tables) {
      const [[cnt]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t.t}\``);
      log(`    · ${t.t}  行数=${cnt.n}  引擎=${t.e}  ${t.c ? '注释=' + t.c : ''}`);
    }

    const [users] = await conn.query(
      'SELECT user_id, username, role, gender, diabetes_type, status, create_time ' +
      'FROM users ORDER BY user_id'
    );
    if (users.length) {
      log('');
      log('  users 表内容（口令字段已略去）：');
      log('    user_id | username | role  | gender | diabetes_type  | status | create_time');
      for (const u of users) {
        log(`    ${String(u.user_id).padEnd(7)} | ${String(u.username).padEnd(8)} | ` +
          `${String(u.role).padEnd(5)} | ${String(u.gender || '-').padEnd(6)} | ` +
          `${String(u.diabetes_type || '-').padEnd(14)} | ${String(u.status).padEnd(6)} | ${u.create_time}`);
      }
    }
  } finally {
    await conn.end();
  }
}

(async function main() {
  line();
  log('糖尿病预治智能助手 — 数据库初始化');
  line();
  log(`  目标：${config.describe()}`);
  log(`  模式：${onlyCheck ? '只检查（--check）' : onlySchema ? '仅建库建表（--schema）' : '建库建表 + 种子数据'}`);
  line();

  if (onlyCheck) {
    await showStatus();
    return;
  }

  let conn;
  try {
    conn = await connectWithoutDb();
    log(`  已连接 MySQL ${(await conn.query('SELECT VERSION() AS v'))[0][0].v}`);
    log('');

    log('执行 SQL 脚本：');
    await runSqlFile(conn, '01-schema.sql');
    if (!onlySchema) {
      await runSqlFile(conn, '02-seed.sql');
    }
  } catch (err) {
    log('');
    log('  ✗ 初始化失败：' + err.message);
    if (err.code === 'ECONNREFUSED') {
      log('    提示：MySQL 未启动或端口不是 ' + config.db.port + '。');
    } else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      log('    提示：账号或口令不正确，请检查 server/.env 中的 DB_USER / DB_PASSWORD。');
    }
    process.exitCode = 1;
    return;
  } finally {
    if (conn) await conn.end();
  }

  await showStatus();
  log('');
  line();
  log('  初始化完成。启动服务：node server/index.js');
  line();
})();
