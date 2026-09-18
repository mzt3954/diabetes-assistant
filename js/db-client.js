/**
 * db-client.js — 用户数据持久化后端客户端（Express + MySQL）
 * ---------------------------------------------------------------------------
 * 【它在整个架构里的位置】
 *
 *   页面（同步读）──► DPA.store.users（localStorage = 同步缓存）
 *                            │  ▲
 *                  写穿透钩子 │  │ 镜像回填
 *                            ▼  │
 *                    DPA.db（本文件）
 *                            │  ▲
 *                  HTTP/JSON │  │
 *                            ▼  │
 *              server/index.js ──► MySQL（users / login_logs，真源）
 *
 *   设计要点：
 *   1. 前端既有 API 全是**同步**的（auth.login 被 273 条测试同步调用），
 *      所以本模块把「异步 HTTP」包成两种形态：
 *        · 登录 / 注册 —— 用同步 XHR，保证同步语义，走数据库权威校验
 *        · 其余读写     —— 异步写穿透 / 异步镜像，不阻塞页面
 *   2. 后端连不上时**自动降级**：探测失败即彻底退回纯 localStorage，
 *      功能与原来一模一样（离线演示模式）。
 *   3. 测试环境（jsdom / Node）下**完全不启用**，避免测试去打真实服务。
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  var CONFIG = global.DPA_CONFIG || {};
  var API = CONFIG.API || {};
  var store = global.DPA.store;

  /** 探测状态：'idle' 未开始 / 'pending' 进行中 / 'ready' 已连上 / 'offline' 不可用 */
  var probeState = 'idle';
  var lastProbeAt = 0;
  var consecutiveFailures = 0;
  var REPROBE_INTERVAL = 15000;   // 连不上时，每 15 秒重试一次
  var FAILURE_LIMIT = 3;          // 连续失败这么多次后，不再让同步登录去试

  /** 已同步到数据库的用户快照：username → { user_id, profile } */
  var synced = Object.create(null);
  var hookInstalled = false;
  var syncing = false;            // 防止写穿透重入

  /* ==================== 环境判定 ==================== */

  /**
   * 是否为「无头测试环境」（jsdom / Node）。
   * 这些环境下必须完全关闭数据库模式，否则测试会去打真实后端，
   * 导致结果不确定。
   *
   * 例外：把 window.__DPA_FORCE_DB__ 置为 true 可强制启用。
   * 这是给「前后端联调自测脚本」用的（tests/db-integration-check.js），
   * 页面正常运行不会设置它。
   */
  function isHeadlessEnv() {
    try {
      if (typeof XMLHttpRequest === 'undefined') return true;
      if (global.__DPA_FORCE_DB__ === true) return false;
      if (typeof process !== 'undefined' && process.versions && process.versions.node) {
        return true;
      }
      var ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
      if (/jsdom|node\.js|headlesschrome|puppeteer|playwright/i.test(ua)) return true;
    } catch (e) { /* 忽略 */ }
    return false;
  }

  var DISABLED = isHeadlessEnv() || API.enabled === false;

  /* ==================== 基础 HTTP ==================== */

  /** 解析 baseUrl：网址参数 ?api=... > CONFIG.API.baseUrl > 同源 */
  function baseUrl() {
    try {
      var m = /[?&]api=([^&#]+)/.exec(global.location.search || '');
      if (m) return decodeURIComponent(m[1]).replace(/\/+$/, '');
    } catch (e) { /* 忽略 */ }
    return String(API.baseUrl || '').replace(/\/+$/, '');
  }

  function url(path) {
    return baseUrl() + path;
  }

  /** 把后端统一响应体解包：{ok:true,data} → data；{ok:false,error} → 抛错 */
  function unwrap(xhr) {
    var body = null;
    try { body = JSON.parse(xhr.responseText); } catch (e) { body = null; }
    if (!body || typeof body !== 'object') {
      return { ok: false, code: 'BAD_RESPONSE', msg: '服务端返回了无法解析的内容' };
    }
    if (body.ok) return { ok: true, data: body.data };
    var err = body.error || {};
    return { ok: false, code: err.code || 'ERROR', msg: err.message || '请求失败' };
  }

  /** 异步请求（用于探测、镜像、写穿透） */
  function request(method, path, payload, cb) {
    if (DISABLED) { if (cb) cb({ ok: false, code: 'DISABLED', msg: '数据库模式未启用' }); return; }
    var xhr = new XMLHttpRequest();
    try {
      xhr.open(method, url(path), true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.timeout = API.timeout || 3000;
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        if (xhr.status === 0) { if (cb) cb({ ok: false, code: 'OFFLINE', msg: '无法连接后端' }); return; }
        if (cb) cb(unwrap(xhr));
      };
      xhr.ontimeout = function () { if (cb) cb({ ok: false, code: 'TIMEOUT', msg: '请求超时' }); };
      xhr.onerror = function () { if (cb) cb({ ok: false, code: 'OFFLINE', msg: '网络错误' }); };
      xhr.send(payload === undefined ? null : JSON.stringify(payload));
    } catch (e) {
      if (cb) cb({ ok: false, code: 'EXCEPTION', msg: String(e && e.message || e) });
    }
  }

  /**
   * 同步请求 —— 仅用于登录 / 注册，保证 auth.login 的同步语义。
   * 注意：同步 XHR 不允许设置 timeout（浏览器会抛 InvalidAccessError），
   * 所以只在「已探测到后端」时才调用，避免在死服务上长时间阻塞。
   */
  function requestSync(method, path, payload) {
    if (DISABLED) return { ok: false, code: 'DISABLED', msg: '数据库模式未启用' };
    var xhr = new XMLHttpRequest();
    try {
      xhr.open(method, url(path), false);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(payload === undefined ? null : JSON.stringify(payload));
    } catch (e) {
      return { ok: false, code: 'OFFLINE', msg: String(e && e.message || e) };
    }
    if (xhr.status === 0) return { ok: false, code: 'OFFLINE', msg: '无法连接后端' };
    return unwrap(xhr);
  }

  /* ==================== 探测与镜像 ==================== */

  function markReady() {
    probeState = 'ready';
    consecutiveFailures = 0;
    lastProbeAt = Date.now();
  }

  function markOffline() {
    probeState = 'offline';
    consecutiveFailures++;
    lastProbeAt = Date.now();
  }

  /** 探测后端是否可用；成功后拉一次用户镜像 */
  function probe(cb) {
    if (DISABLED) { if (cb) cb(false); return; }
    probeState = 'pending';
    request('GET', API.healthPath || '/api/health', undefined, function (r) {
      if (r.ok) {
        markReady();
        installHook();
        pullUsers(function () { if (cb) cb(true); });
      } else {
        markOffline();
        if (cb) cb(false);
      }
    });
  }

  /** 定时重探：后端后启动也能被自动接上 */
  function scheduleReprobe() {
    if (DISABLED) return;
    if (typeof global.setInterval !== 'function') return;
    global.setInterval(function () {
      if (probeState === 'ready') return;
      probe();
    }, REPROBE_INTERVAL);
  }

  /** 拉取数据库中的全部用户，刷新本地镜像 */
  function pullUsers(cb) {
    request('GET', '/api/users?page=1&pageSize=100', undefined, function (r) {
      if (r.ok && r.data && r.data.items) {
        var list = r.data.items;
        store.users.replaceAllFromDb(list);
        synced = Object.create(null);
        list.forEach(function (u) {
          synced[u.username] = { user_id: u.user_id, profile: profileKey(u) };
        });
        if (cb) cb(true, list);
      } else if (cb) {
        cb(false);
      }
    });
  }

  /* ==================== 写穿透（本地变更 → 数据库） ==================== */

  /** 提取用于比对的资料指纹（不含口令） */
  function profileKey(u) {
    return [
      u.phone || '', u.age === undefined || u.age === null ? '' : String(u.age),
      u.gender || '', u.diabetesType || '', u.avatar_url || ''
    ].join('\u0001');
  }

  /** 把一条本地用户推送到数据库（新建或更新） */
  function pushOne(localUser, done) {
    var body = {
      username: localUser.username,
      phone: localUser.phone || '',
      age: localUser.age === '' || localUser.age === undefined ? null : localUser.age,
      gender: localUser.gender || '',
      diabetesType: localUser.diabetesType || '',
      avatar_url: localUser.avatar_url || ''
    };
    var known = synced[localUser.username];
    if (known) {
      request('PUT', '/api/users/' + known.user_id, body, function (r) {
        if (r.ok && r.data && r.data.user) {
          synced[localUser.username] = { user_id: r.data.user.user_id, profile: profileKey(r.data.user) };
        }
        if (done) done(r);
      });
    } else {
      // 新账号：数据库需要口令。本地只有哈希，拿不到明文，
      // 因此新建走的是「注册」路径（见 auth.register 的同步注册），
      // 这里只处理「本地已存在但数据库没有」的兜底：用占位口令建号并标记需改密。
      request('POST', '/api/users', body, function (r) {
        if (r.ok && r.data && r.data.user) {
          synced[localUser.username] = { user_id: r.data.user.user_id, profile: profileKey(r.data.user) };
        }
        if (done) done(r);
      });
    }
  }

  /**
   * 全量对账：本地用户表 → 数据库。
   * 只推送「新增」和「资料有变化」的，数据库里多出来的不动（避免误删）。
   */
  function reconcile() {
    if (probeState !== 'ready' || syncing) return;
    syncing = true;
    var list = store.users.all();
    var names = Object.create(null);
    var pending = 0;
    var finished = 0;

    function step() {
      finished++;
      if (finished >= pending) syncing = false;
    }

    list.forEach(function (u) {
      names[u.username] = true;
      var known = synced[u.username];
      if (known && known.profile === profileKey(u)) return;   // 无变化
      pending++;
      pushOne(u, step);
    });

    if (pending === 0) { syncing = false; return; }
    // 兜底：3 秒后无论如何解除重入锁
    if (typeof global.setTimeout === 'function') {
      global.setTimeout(function () { syncing = false; }, 3000);
    }
  }

  /** 订阅本地用户表变更，做异步写穿透 */
  function installHook() {
    if (hookInstalled || DISABLED || !store || !store.onUsersChanged) return;
    store.onUsersChanged(function () {
      if (probeState !== 'ready') return;
      if (typeof global.setTimeout === 'function') {
        global.setTimeout(reconcile, 0);   // 让本次同步写入先完成
      } else {
        reconcile();
      }
    });
    hookInstalled = true;
  }

  /* ==================== 对外 API ==================== */

  var db = {
    /** 是否处于数据库模式 */
    get mode() { return probeState === 'ready' ? 'database' : 'local'; },
    get available() { return probeState === 'ready'; },
    get disabled() { return DISABLED; },
    get probeState() { return probeState; },
    get baseUrl() { return baseUrl(); },

    probe: probe,
    pullUsers: pullUsers,
    reconcile: reconcile,

    /**
     * 同步登录（走数据库，权威校验）。
     * @returns {{status:'ok',user:Object}|{status:'rejected',msg:string}|{status:'offline'}}
     */
    loginSync: function (username, password) {
      if (DISABLED || probeState === 'offline' && consecutiveFailures >= FAILURE_LIMIT) {
        return { status: 'offline' };
      }
      if (probeState !== 'ready' && probeState !== 'pending') return { status: 'offline' };

      var r = requestSync('POST', '/api/auth/login', { username: username, password: password });
      if (r.ok) {
        markReady();
        installHook();
        // 顺手把这条记录镜像进本地，并补一份本地口令哈希（供离线兜底）
        if (r.data && r.data.user) store.users.mirrorFromDb(r.data.user, password);
        return { status: 'ok', user: r.data.user };
      }
      if (r.code === 'INVALID_CREDENTIALS') {
        markReady();     // 服务端明确答复，说明连接是通的
        return { status: 'rejected', msg: r.msg };
      }
      // 连不上 / 超时 → 交给调用方降级
      markOffline();
      return { status: 'offline' };
    },

    /**
     * 同步注册（走数据库，用户名唯一性由数据库唯一索引把关）。
     * @returns {{status:'ok',user:Object}|{status:'rejected',msg:string}|{status:'offline'}}
     */
    registerSync: function (username, password, profile) {
      if (DISABLED) return { status: 'offline' };
      if (probeState !== 'ready' && probeState !== 'pending') return { status: 'offline' };

      var body = { username: username, password: password };
      if (profile) {
        if (profile.phone) body.phone = profile.phone;
        if (profile.age !== undefined && profile.age !== '') body.age = profile.age;
        if (profile.gender) body.gender = profile.gender;
        if (profile.diabetesType) body.diabetesType = profile.diabetesType;
      }

      var r = requestSync('POST', '/api/auth/register', body);
      if (r.ok) {
        markReady();
        installHook();
        if (r.data && r.data.user) {
          store.users.mirrorFromDb(r.data.user, password);
          synced[r.data.user.username] = {
            user_id: r.data.user.user_id, profile: profileKey(r.data.user)
          };
        }
        return { status: 'ok', user: r.data.user };
      }
      if (r.code === 'USERNAME_TAKEN') return { status: 'rejected', msg: r.msg };
      if (r.code && r.code.indexOf('INVALID_') === 0) return { status: 'rejected', msg: r.msg };
      markOffline();
      return { status: 'offline' };
    },

    /** 删除数据库中的用户（按用户名，先查 id） */
    removeByUsername: function (username, cb) {
      var known = synced[username];
      if (!known) { request('GET', '/api/users?keyword=' + encodeURIComponent(username), undefined, function (r) {
        if (!r.ok || !r.data || !r.data.items) { if (cb) cb(r); return; }
        var hit = r.data.items.filter(function (u) { return u.username === username; })[0];
        if (!hit) { if (cb) cb({ ok: true, data: { skipped: true } }); return; }
        request('DELETE', '/api/users/' + hit.user_id, undefined, function (r2) {
          if (r2.ok) delete synced[username];
          if (cb) cb(r2);
        });
      }); return; }
      request('DELETE', '/api/users/' + known.user_id, undefined, function (r) {
        if (r.ok) delete synced[username];
        if (cb) cb(r);
      });
    },

    /** 后端用户总数（诊断用） */
    countUsers: function (cb) {
      request('GET', '/api/users?page=1&pageSize=1', undefined, function (r) {
        if (cb) cb(r.ok && r.data ? r.data.total : null, r);
      });
    }
  };

  global.DPA = global.DPA || {};
  global.DPA.db = db;

  /* ==================== 自动启动 ==================== */
  if (!DISABLED) {
    if (global.document && global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', function () { probe(); scheduleReprobe(); });
    } else {
      probe();
      scheduleReprobe();
    }
  } else {
    probeState = 'offline';
  }
})(typeof window !== 'undefined' ? window : globalThis);
