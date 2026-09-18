/**
 * password.js — 口令哈希与校验（服务端）
 * ---------------------------------------------------------------------------
 * 为什么用 scrypt 而不是前端那套 sha256 迭代？
 *   前端的 js/crypto.js 是「浏览器里没有 crypto.subtle 时的降级方案」，
 *   目标是让 localStorage 里不出现明文口令。而服务端跑在 Node 上，
 *   有完整的 crypto 模块，应当使用**内存硬化**的 KDF：
 *     scrypt 每次派生需要 128*N*r ≈ 16 MB 内存，
 *     使 GPU 离线爆破的成本比单轮 SHA-256 高出数个数量级。
 *
 * 存储格式（两列分开存，便于在数据库里直接看懂）：
 *   password_salt  CHAR(32)     16 字节随机盐 → 32 位十六进制
 *   password_hash  VARCHAR(128) 64 字节派生密钥 → 128 位十六进制
 *
 * 参数：N=16384, r=8, p=1, keylen=64（Node 默认 maxmem 32MB 足够）
 * ---------------------------------------------------------------------------
 */
'use strict';

const crypto = require('crypto');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SALT_BYTES = 16;

/** 生成 16 字节随机盐（32 位十六进制） */
function randomSalt() {
  return crypto.randomBytes(SALT_BYTES).toString('hex');
}

/** 异步派生口令密钥，返回 64 字节的十六进制串 */
function derive(plain, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(plain == null ? '' : plain), String(salt), SCRYPT.keylen, SCRYPT,
      (err, key) => (err ? reject(err) : resolve(key.toString('hex'))));
  });
}

/**
 * 生成口令哈希
 * @param {string} plain 明文口令
 * @param {string} [salt] 不传则随机生成
 * @returns {Promise<{hash: string, salt: string}>}
 */
async function hashPassword(plain, salt) {
  const s = salt || randomSalt();
  const hash = await derive(plain, s);
  return { hash, salt: s };
}

/** 恒定时间比较两个十六进制串，避免时序侧信道 */
function timingSafeEqualHex(a, b) {
  const ba = Buffer.from(String(a), 'hex');
  const bb = Buffer.from(String(b), 'hex');
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * 校验口令
 * @param {string} plain 用户提交的明文口令
 * @param {string} hash  数据库中的 password_hash
 * @param {string} salt  数据库中的 password_salt
 * @returns {Promise<boolean>}
 */
async function verifyPassword(plain, hash, salt) {
  if (!hash || !salt) return false;
  const derived = await derive(plain, salt);
  return timingSafeEqualHex(derived, hash);
}

module.exports = { hashPassword, verifyPassword, randomSalt, timingSafeEqualHex, SCRYPT };
