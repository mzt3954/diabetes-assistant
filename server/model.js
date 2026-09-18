/**
 * model.js — 用户模型层：字段校验、取值规范化、数据库行 ↔ 前端对象映射
 * ---------------------------------------------------------------------------
 * 校验规则与前端 js/ui.js 的 validators **保持一致**，
 * 但服务端必须独立再校验一次——前端校验只是体验，服务端校验才是安全边界。
 * ---------------------------------------------------------------------------
 */
'use strict';

/** 糖尿病分型（与前端 personal.js 下拉取值一致） */
const DIABETES_TYPES = ['1型糖尿病', '2型糖尿病', '妊娠型糖尿病', '特殊型糖尿病', '未确诊/预防阶段'];
const GENDERS = ['男', '女'];
const ROLES = ['user', 'admin'];

const USERNAME_RE = /^[A-Za-z0-9_\u4e00-\u9fa5]+$/;
const PHONE_RE = /^1[3-9]\d{9}$/;

/** 统一返回 { ok, value?, msg? } */
function fail(msg) { return { ok: false, msg }; }
function pass(value) { return { ok: true, value }; }

/* ==================== 字段校验 ==================== */

function checkUsername(raw) {
  const v = String(raw == null ? '' : raw).trim();
  if (!v) return fail('请输入用户名');
  if (v.length < 3) return fail('用户名长度不能少于 3 位');
  if (v.length > 50) return fail('用户名长度不能超过 50 位');
  if (!USERNAME_RE.test(v)) return fail('用户名仅支持中英文、数字和下划线');
  return pass(v);
}

function checkPassword(raw) {
  const v = String(raw == null ? '' : raw);
  if (!v) return fail('请输入密码');
  if (v.length < 6) return fail('密码长度不能少于 6 位');
  if (v.length > 72) return fail('密码长度不能超过 72 位');
  return pass(v);
}

/* ==================== 字段规范化（空串 → NULL） ==================== */

function normPhone(raw) {
  const v = String(raw == null ? '' : raw).trim();
  if (!v) return pass(null);
  if (!PHONE_RE.test(v)) return fail('手机号格式不正确');
  return pass(v);
}

function normAge(raw) {
  if (raw === '' || raw === null || raw === undefined) return pass(null);
  const n = Number(raw);
  if (!Number.isInteger(n)) return fail('年龄必须是整数');
  if (n < 1 || n > 120) return fail('年龄应在 1~120 之间');
  return pass(n);
}

function normGender(raw) {
  const v = String(raw == null ? '' : raw).trim();
  if (!v) return pass(null);
  if (GENDERS.indexOf(v) < 0) return fail('性别取值只能是 男 / 女');
  return pass(v);
}

function normDiabetesType(raw) {
  const v = String(raw == null ? '' : raw).trim();
  if (!v) return pass(null);
  if (DIABETES_TYPES.indexOf(v) < 0) return fail('糖尿病类型取值不合法');
  return pass(v);
}

function normAvatarUrl(raw) {
  const v = String(raw == null ? '' : raw).trim();
  if (v.length > 255) return fail('头像地址过长');
  return pass(v);
}

/* ==================== 行 → 前端对象 ==================== */

/**
 * 数据库行 → 前端使用的用户对象。
 * 关键：**绝不返回 password_hash / password_salt**，避免口令材料外泄。
 * 字段命名从 snake_case 转成前端既有的 camelCase（diabetesType）。
 */
function toPublicUser(row) {
  if (!row) return null;
  return {
    user_id: row.user_id,
    username: row.username,
    role: row.role,
    phone: row.phone === null || row.phone === undefined ? '' : row.phone,
    age: row.age === null || row.age === undefined ? '' : String(row.age),
    gender: row.gender || '',
    diabetesType: row.diabetes_type || '',
    avatar_url: row.avatar_url || '',
    status: row.status,
    create_time: row.create_time,
    update_time: row.update_time,
  };
}

/** 允许通过更新接口修改的字段（与前端 store.js 的 UPDATABLE_FIELDS 对齐） */
const UPDATABLE_FIELDS = ['username', 'phone', 'age', 'gender', 'diabetesType', 'avatar_url'];

module.exports = {
  DIABETES_TYPES, GENDERS, ROLES, UPDATABLE_FIELDS,
  checkUsername, checkPassword,
  normPhone, normAge, normGender, normDiabetesType, normAvatarUrl,
  toPublicUser,
};
