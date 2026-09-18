/**
 * routes/auth.js — 注册与登录
 * ---------------------------------------------------------------------------
 * 两个接口：
 *   POST /api/auth/register   注册（用户名唯一，口令 scrypt 哈希后入库）
 *   POST /api/auth/login      登录（校验口令 + 账号状态，并写入登录日志）
 *
 * 安全要点：
 *   1. 口令永不落明文，数据库只存 salt + scrypt 派生密钥
 *   2. 用户不存在时也执行一次等价耗时的哈希运算，避免通过响应时间
 *      探测「哪些用户名已注册」（用户枚举）
 *   3. 登录成功与失败**都**写 login_logs，便于审计
 * ---------------------------------------------------------------------------
 */
'use strict';

const express = require('express');
const db = require('../db');
const model = require('../model');
const { hashPassword, verifyPassword } = require('../password');

const router = express.Router();

/** 取客户端 IP（兼容反向代理的 X-Forwarded-For） */
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  let ip = '';
  if (typeof fwd === 'string' && fwd) {
    ip = fwd.split(',')[0].trim();
  } else {
    ip = (req.socket && req.socket.remoteAddress) || '';
    ip = ip.replace(/^::ffff:/, '');
  }
  return ip ? ip.slice(0, 45) : null;
}

function userAgent(req) {
  const ua = String(req.headers['user-agent'] || '');
  return ua ? ua.slice(0, 255) : null;
}

/** 写登录日志；失败不影响主流程 */
async function writeLoginLog(req, userId, username, success) {
  try {
    await db.execute(
      'INSERT INTO login_logs (user_id, username, success, ip, user_agent) VALUES (?, ?, ?, ?, ?)',
      [userId || null, String(username).slice(0, 50), success ? 1 : 0, clientIp(req), userAgent(req)]
    );
  } catch (e) {
    console.warn('[auth] 写登录日志失败：' + e.message);
  }
}

function badRequest(res, code, message, status) {
  return res.status(status || 400).json({ ok: false, error: { code, message } });
}

/* ==================== 注册 ==================== */

router.post('/register', async (req, res, next) => {
  try {
    const body = req.body || {};

    const u = model.checkUsername(body.username);
    if (!u.ok) return badRequest(res, 'INVALID_USERNAME', u.msg);

    const p = model.checkPassword(body.password);
    if (!p.ok) return badRequest(res, 'INVALID_PASSWORD', p.msg);

    const dup = await db.query('SELECT user_id FROM users WHERE username = ? LIMIT 1', [u.value]);
    if (dup.length) return badRequest(res, 'USERNAME_TAKEN', '用户名已存在', 409);

    /* 选填资料：注册时若前端一并提交，则同步落库（不提交则全部为 NULL） */
    const ph = model.normPhone(body.phone);
    if (!ph.ok) return badRequest(res, 'INVALID_PHONE', ph.msg);
    const ag = model.normAge(body.age);
    if (!ag.ok) return badRequest(res, 'INVALID_AGE', ag.msg);
    const ge = model.normGender(body.gender);
    if (!ge.ok) return badRequest(res, 'INVALID_GENDER', ge.msg);
    const dt = model.normDiabetesType(body.diabetesType);
    if (!dt.ok) return badRequest(res, 'INVALID_DIABETES_TYPE', dt.msg);
    const av = model.normAvatarUrl(body.avatar_url);
    if (!av.ok) return badRequest(res, 'INVALID_AVATAR_URL', av.msg);

    const { hash, salt } = await hashPassword(p.value);
    const result = await db.execute(
      'INSERT INTO users (username, password_hash, password_salt, role, status, ' +
      'phone, age, gender, diabetes_type, avatar_url) ' +
      'VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)',
      [u.value, hash, salt, 'user',
        ph.value, ag.value, ge.value, dt.value, av.value === null ? '' : av.value]
    );

    const rows = await db.query('SELECT * FROM users WHERE user_id = ?', [result.insertId]);
    console.log(`[auth] 注册成功：${u.value}（user_id=${result.insertId}）`);
    return res.status(201).json({ ok: true, data: { user: model.toPublicUser(rows[0]) } });
  } catch (err) {
    return next(err);
  }
});

/* ==================== 登录 ==================== */

router.post('/login', async (req, res, next) => {
  try {
    const body = req.body || {};
    const username = String(body.username == null ? '' : body.username).trim();
    const password = String(body.password == null ? '' : body.password);

    if (!username || !password) {
      return badRequest(res, 'MISSING_CREDENTIALS', '请输入用户名和密码');
    }

    const rows = await db.query('SELECT * FROM users WHERE username = ? LIMIT 1', [username]);
    const user = rows[0] || null;

    let passwordOk = false;
    if (user) {
      passwordOk = await verifyPassword(password, user.password_hash, user.password_salt);
    } else {
      // 用户不存在也做一次等价运算，消除时间差（防用户枚举）
      await hashPassword(password);
    }

    const active = !!user && Number(user.status) === 1;
    const success = !!user && passwordOk && active;

    await writeLoginLog(req, user ? user.user_id : null, username, success);

    if (!success) {
      return badRequest(res, 'INVALID_CREDENTIALS', '用户名或密码错误', 401);
    }

    console.log(`[auth] 登录成功：${username}（user_id=${user.user_id}）`);
    return res.json({ ok: true, data: { user: model.toPublicUser(user) } });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
