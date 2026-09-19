/**
 * crypto.js — 口令哈希工具（纯 JS SHA-256 + 迭代拉伸）
 * ------------------------------------------------------------------
 * 为什么不用 crypto.subtle？
 *   WebCrypto 的 subtle 只在「安全上下文」可用。本项目的典型运行环境是
 *   http://<局域网IP>:8080（非安全上下文）与 jsdom 测试环境，两处都没有
 *   crypto.subtle，会导致登录直接抛错。因此这里内置一份纯 JS SHA-256。
 *
 * 算法：sha256^ITER(salt + ':' + password)
 *   单轮 SHA-256 对离线爆破几乎没有成本，因此做 ITER 轮迭代拉伸。
 *   注意：这仍**不是**生产级口令方案（无 bcrypt/argon2 的内存硬化），
 *   真实系统必须把口令校验放到服务端并使用专用 KDF。此处目标仅是
 *   「localStorage 里不再出现明文口令」。
 *
 * 正确性：SHA-256 实现已用官方测试向量与 Node crypto 交叉验证，
 *         见 tests/logic-test.js 的「SHA-256 实现正确性」用例。
 * ------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  /* SHA-256 轮常量 */
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  var INIT_H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];

  /** 32 位循环右移 */
  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  /** UTF-8 编码为字节数组（支持中文与代理对） */
  function utf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var cp = 0x10000 + ((c - 0xd800) << 10) + (str.charCodeAt(++i) - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return out;
  }

  /** SHA-256 核心：字节数组 -> 8 个 32 位字 */
  function sha256Words(bytes) {
    var H = INIT_H.slice();
    var msg = bytes.slice();
    var bitLenHi = Math.floor(bytes.length / 536870912);      // (len*8) 的高 32 位
    var bitLenLo = (bytes.length << 3) >>> 0;                 // (len*8) 的低 32 位

    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    msg.push((bitLenHi >>> 24) & 255, (bitLenHi >>> 16) & 255, (bitLenHi >>> 8) & 255, bitLenHi & 255);
    msg.push((bitLenLo >>> 24) & 255, (bitLenLo >>> 16) & 255, (bitLenLo >>> 8) & 255, bitLenLo & 255);

    var w = new Array(64);
    for (var off = 0; off < msg.length; off += 64) {
      for (var t = 0; t < 16; t++) {
        var j = off + t * 4;
        w[t] = ((msg[j] << 24) | (msg[j + 1] << 16) | (msg[j + 2] << 8) | msg[j + 3]) | 0;
      }
      for (var t2 = 16; t2 < 64; t2++) {
        var x = w[t2 - 15], y = w[t2 - 2];
        var s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
        var s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
        w[t2] = (w[t2 - 16] + s0 + w[t2 - 7] + s1) | 0;
      }

      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (var t3 = 0; t3 < 64; t3++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var temp1 = (h + S1 + ch + K[t3] + w[t3]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var temp2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + temp1) | 0;
        d = c; c = b; b = a; a = (temp1 + temp2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H;
  }

  /** 8 个 32 位字拼接成 64 位十六进制字符串（SHA-256 摘要的最终表示） */
  function wordsToHex(H) {
    var out = '';
    for (var i = 0; i < H.length; i++) {
      out += ('00000000' + (H[i] >>> 0).toString(16)).slice(-8);
    }
    return out;
  }

  /** SHA-256 单轮，输入字符串，输出 64 位十六进制 */
  function sha256Hex(str) { return wordsToHex(sha256Words(utf8Bytes(str))); }

  /* ---------- 口令哈希 ---------- */

  var ITERATIONS = 1000;   // 迭代拉伸轮数

  /** 字节数组转十六进制字符串（用于随机盐的表示） */
  function toHex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += ('0' + (bytes[i] & 255).toString(16)).slice(-2);
    return out;
  }

  /** 生成随机盐（优先 WebCrypto，退化到 Math.random） */
  function randomSalt(byteLength) {
    var n = byteLength || 16;
    var arr = new Uint8Array(n);
    if (global.crypto && typeof global.crypto.getRandomValues === 'function') {
      global.crypto.getRandomValues(arr);
    } else {
      for (var i = 0; i < n; i++) arr[i] = Math.floor(Math.random() * 256);
    }
    return toHex(arr);
  }

  /**
   * 口令哈希：sha256^ITER(salt + ':' + password)
   * 同步返回，避免把 async 传染到整个登录流程。
   */
  function hashPassword(password, salt) {
    var acc = String(salt) + ':' + String(password);
    for (var i = 0; i < ITERATIONS; i++) acc = sha256Hex(acc);
    return acc;
  }

  /** 恒定时间字符串比较，避免时序侧信道 */
  function timingSafeEqual(a, b) {
    a = String(a); b = String(b);
    if (a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  global.DPA_Crypto = {
    sha256Hex: sha256Hex,
    hashPassword: hashPassword,
    randomSalt: randomSalt,
    timingSafeEqual: timingSafeEqual,
    ITERATIONS: ITERATIONS
  };
})(window);
