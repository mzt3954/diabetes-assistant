/**
 * routes/users.js — 用户数据的增删改查（CRUD）
 * ---------------------------------------------------------------------------
 *   GET    /api/users          查询列表（分页 + 关键字 + 角色过滤）
 *   GET    /api/users/:id      查询单个用户
 *   POST   /api/users          新增用户（等价于后台建号，走同一套哈希逻辑）
 *   PUT    /api/users/:id      更新用户资料
 *   DELETE /api/users/:id      删除用户
 *
 * 安全要点：
 *   1. 所有 SQL 一律使用 ? 占位符，杜绝注入
 *   2. 更新字段走**白名单**，role / password / status 不允许通过该接口改写，
 *      防止普通用户提权（与前端 store.js 的 UPDATABLE_FIELDS 保持一致）
 *   3. 返回体一律经 toPublicUser 脱敏，password_hash / password_salt 永不出库
 * ---------------------------------------------------------------------------
 */
'use strict';

const express = require('express');
const db = require('../db');
const model = require('../model');
const { hashPassword } = require('../password');

const router = express.Router();

function badRequest(res, code, message, status) {
  return res.status(status || 400).json({ ok: false, error: { code, message } });
}

/** 解析并校验路径上的 :id */
function parseId(raw) {
  const id = parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/* ==================== 查（列表） ==================== */

router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
    const keyword = String(req.query.keyword || '').trim();
    const role = String(req.query.role || '').trim();

    const where = [];
    const params = [];

    if (keyword) {
      where.push('(username LIKE ? OR phone LIKE ?)');
      params.push('%' + keyword + '%', '%' + keyword + '%');
    }
    if (role) {
      if (model.ROLES.indexOf(role) < 0) return badRequest(res, 'INVALID_ROLE', '角色取值只能是 user / admin');
      where.push('role = ?');
      params.push(role);
    }
    const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';

    const countRows = await db.query('SELECT COUNT(*) AS total FROM users' + whereSql, params);
    const total = Number(countRows[0].total);

    // page / pageSize 已确保为安全整数，直接内插（避免 execute 对 LIMIT 占位符的限制）
    const offset = (page - 1) * pageSize;
    const rows = await db.query(
      'SELECT * FROM users' + whereSql + ' ORDER BY user_id ASC LIMIT ' + pageSize + ' OFFSET ' + offset,
      params
    );

    return res.json({
      ok: true,
      data: {
        total: total,
        page: page,
        pageSize: pageSize,
        items: rows.map(model.toPublicUser),
      },
    });
  } catch (err) {
    return next(err);
  }
});

/* ==================== 查（单个） ==================== */

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return badRequest(res, 'INVALID_ID', '用户ID必须是正整数');

    const rows = await db.query('SELECT * FROM users WHERE user_id = ?', [id]);
    if (!rows.length) return badRequest(res, 'USER_NOT_FOUND', '用户不存在', 404);

    return res.json({ ok: true, data: { user: model.toPublicUser(rows[0]) } });
  } catch (err) {
    return next(err);
  }
});

/* ==================== 增 ==================== */

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};

    const u = model.checkUsername(body.username);
    if (!u.ok) return badRequest(res, 'INVALID_USERNAME', u.msg);

    const p = model.checkPassword(body.password);
    if (!p.ok) return badRequest(res, 'INVALID_PASSWORD', p.msg);

    const phone = model.normPhone(body.phone);
    if (!phone.ok) return badRequest(res, 'INVALID_PHONE', phone.msg);
    const age = model.normAge(body.age);
    if (!age.ok) return badRequest(res, 'INVALID_AGE', age.msg);
    const gender = model.normGender(body.gender);
    if (!gender.ok) return badRequest(res, 'INVALID_GENDER', gender.msg);
    const dtype = model.normDiabetesType(body.diabetesType);
    if (!dtype.ok) return badRequest(res, 'INVALID_DIABETES_TYPE', dtype.msg);
    const avatar = model.normAvatarUrl(body.avatar_url);
    if (!avatar.ok) return badRequest(res, 'INVALID_AVATAR', avatar.msg);

    const dup = await db.query('SELECT user_id FROM users WHERE username = ? LIMIT 1', [u.value]);
    if (dup.length) return badRequest(res, 'USERNAME_TAKEN', '用户名已存在', 409);

    const role = model.ROLES.indexOf(body.role) >= 0 ? body.role : 'user';
    const { hash, salt } = await hashPassword(p.value);

    const result = await db.execute(
      'INSERT INTO users (username, password_hash, password_salt, role, phone, age, gender, diabetes_type, avatar_url, status) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
      [u.value, hash, salt, role, phone.value, age.value, gender.value, dtype.value, avatar.value]
    );

    const rows = await db.query('SELECT * FROM users WHERE user_id = ?', [result.insertId]);
    return res.status(201).json({ ok: true, data: { user: model.toPublicUser(rows[0]) } });
  } catch (err) {
    return next(err);
  }
});

/* ==================== 改 ==================== */

router.put('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return badRequest(res, 'INVALID_ID', '用户ID必须是正整数');

    const body = req.body || {};
    const exists = await db.query('SELECT user_id FROM users WHERE user_id = ?', [id]);
    if (!exists.length) return badRequest(res, 'USER_NOT_FOUND', '用户不存在', 404);

    const sets = [];
    const params = [];
    const rejected = [];

    Object.keys(body).forEach(function (key) {
      if (model.UPDATABLE_FIELDS.indexOf(key) < 0) { rejected.push(key); }
    });

    if (body.username !== undefined) {
      const u = model.checkUsername(body.username);
      if (!u.ok) throw Object.assign(new Error(u.msg), { __code: 'INVALID_USERNAME' });
      const dup = await db.query('SELECT user_id FROM users WHERE username = ? AND user_id <> ? LIMIT 1', [u.value, id]);
      if (dup.length) throw Object.assign(new Error('用户名已存在'), { __code: 'USERNAME_TAKEN', __status: 409 });
      sets.push('username = ?'); params.push(u.value);
    }
    if (body.phone !== undefined) {
      const r = model.normPhone(body.phone);
      if (!r.ok) throw Object.assign(new Error(r.msg), { __code: 'INVALID_PHONE' });
      sets.push('phone = ?'); params.push(r.value);
    }
    if (body.age !== undefined) {
      const r = model.normAge(body.age);
      if (!r.ok) throw Object.assign(new Error(r.msg), { __code: 'INVALID_AGE' });
      sets.push('age = ?'); params.push(r.value);
    }
    if (body.gender !== undefined) {
      const r = model.normGender(body.gender);
      if (!r.ok) throw Object.assign(new Error(r.msg), { __code: 'INVALID_GENDER' });
      sets.push('gender = ?'); params.push(r.value);
    }
    if (body.diabetesType !== undefined) {
      const r = model.normDiabetesType(body.diabetesType);
      if (!r.ok) throw Object.assign(new Error(r.msg), { __code: 'INVALID_DIABETES_TYPE' });
      sets.push('diabetes_type = ?'); params.push(r.value);
    }
    if (body.avatar_url !== undefined) {
      const r = model.normAvatarUrl(body.avatar_url);
      if (!r.ok) throw Object.assign(new Error(r.msg), { __code: 'INVALID_AVATAR' });
      sets.push('avatar_url = ?'); params.push(r.value);
    }

    if (!sets.length) return badRequest(res, 'NOTHING_TO_UPDATE', '没有可更新的字段');

    params.push(id);
    await db.execute('UPDATE users SET ' + sets.join(', ') + ' WHERE user_id = ?', params);

    const rows = await db.query('SELECT * FROM users WHERE user_id = ?', [id]);
    const payload = { ok: true, data: { user: model.toPublicUser(rows[0]) } };
    if (rejected.length) payload.data.rejected = rejected;   // 明确告知被白名单挡下的字段
    return res.json(payload);
  } catch (err) {
    if (err && err.__code) return badRequest(res, err.__code, err.message, err.__status);
    return next(err);
  }
});

/* ==================== 删 ==================== */

router.delete('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return badRequest(res, 'INVALID_ID', '用户ID必须是正整数');

    const rows = await db.query('SELECT user_id, username FROM users WHERE user_id = ?', [id]);
    if (!rows.length) return badRequest(res, 'USER_NOT_FOUND', '用户不存在', 404);

    // login_logs 的外键为 ON DELETE SET NULL，历史日志会保留、user_id 置空
    await db.execute('DELETE FROM users WHERE user_id = ?', [id]);

    return res.json({
      ok: true,
      data: { deleted: { user_id: id, username: rows[0].username } },
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
