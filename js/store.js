/**
 * store.js — 数据仓储层
 * ------------------------------------------------------------------
 * 统一封装 localStorage 读写，键名规范：dpa:<entity>[:<userId>]
 * 实体字段严格对齐 项目素材/知识库/db.txt 的表结构。
 * 所有页面只通过 DPA.store 访问数据，不直接操作 localStorage。
 *
 * 【v2.1 修复】
 *  1. 新增 dateKey()：统一使用**本地**日期键，修复打卡统计在 GMT+8
 *     凌晨 00:00–08:00 因 UTC 偏移而漏计当天打卡的缺陷。
 *  2. 新增内存缓存 + storage 事件失效：避免每次访问都 JSON.parse 全量数据。
 *  3. session 按 persist 写入单一存储（修复「记住我」失效）。
 *  4. 口令改为加盐哈希存储（crypto.js），历史明文数据自动升级。
 *  5. users.update 增加字段白名单，阻断 role/password 越权改写。
 *  6. 新增 users.rename()：改名时迁移全部用户维度数据键。
 *  7. 文章阅读量改为独立计数表，避免每次浏览全量重写文章列表。
 * ------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  var P = (global.DPA_CONFIG && global.DPA_CONFIG.STORAGE_PREFIX) || 'dpa:';
  var SEED = global.DPA_SEED || {};
  var Crypto = global.DPA_Crypto;

  /* ==================== 底层读写（带内存缓存） ==================== */

  var cache = Object.create(null);

  function clearCache() { cache = Object.create(null); }

  function read(key, fallback) {
    if (key in cache) return cache[key];
    var value = fallback;
    try {
      var raw = localStorage.getItem(P + key);
      if (raw !== null && raw !== undefined) value = JSON.parse(raw);
    } catch (e) {
      console.warn('[store] 读取失败:', key, e);
      value = fallback;
    }
    cache[key] = value;
    return value;
  }

  /**
   * 用户表变更钩子。
   * js/db-client.js 订阅它，把本地用户表的增删改「写穿透」到 MySQL，
   * 这样各个页面无需感知后端是否存在（离线时钩子为空，行为与原来一致）。
   */
  var usersChangedHandlers = [];
  /** >0 表示当前写入来自「数据库镜像回填」，不应再反向推回数据库（避免回环） */
  var suppressHook = 0;

  function emitUsersChanged(list) {
    if (suppressHook > 0) return;
    for (var i = 0; i < usersChangedHandlers.length; i++) {
      try { usersChangedHandlers[i](list); } catch (e) { console.warn('[store] users 变更钩子异常:', e); }
    }
  }

  /** 静默写入用户表：只落本地，不触发写穿透 */
  function writeUsersQuiet(list) {
    suppressHook++;
    try { write('users', list); } finally { suppressHook--; }
  }

  function write(key, value) {
    cache[key] = value;
    var ok = false;
    try {
      localStorage.setItem(P + key, JSON.stringify(value));
      ok = true;
    } catch (e) {
      console.error('[store] 写入失败（可能超出配额）:', key, e);
    }
    if (key === 'users') emitUsersChanged(value);
    return ok;
  }

  function remove(key) {
    delete cache[key];
    try { localStorage.removeItem(P + key); } catch (e) { /* 隐私模式等场景忽略 */ }
  }

  /* 其他标签页写入时使缓存失效，避免读到脏数据 */
  if (typeof global.addEventListener === 'function') {
    global.addEventListener('storage', function (e) {
      if (!e || !e.key || String(e.key).indexOf(P) === 0) clearCache();
    });
  }

  function uid(list, field) {
    var max = 0;
    list.forEach(function (it) {
      if (typeof it[field] === 'number' && it[field] > max) max = it[field];
    });
    return max + 1;
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  /**
   * 本地日期键 YYYY-MM-DD
   * 必须与 ui.toDateKey 使用同一口径（本地时区），否则打卡写入与统计读取
   * 会因 UTC 偏移而错位一天。
   */
  function dateKey(input) {
    var d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /* ==================== 初始化：写入种子数据 ==================== */

  function init() {
    if (!read('users', null)) write('users', clone(SEED.USERS || []));
    if (!read('articles', null)) write('articles', clone(SEED.ARTICLES || []));
    if (!read('diabetes_types', null)) write('diabetes_types', clone(SEED.DIABETES_TYPES || []));
    if (!read('doctors', null)) write('doctors', clone(SEED.DOCTORS || []));
    // 把种子/历史遗留的明文口令就地升级为加盐哈希
    users.migratePasswords();
  }

  /* ==================== 用户（users） ==================== */

  /** 对外返回的用户对象不含任何口令字段 */
  function publicUser(u) {
    if (!u) return null;
    var c = Object.assign({}, u);
    delete c.password;
    delete c.password_hash;
    delete c.password_salt;
    return c;
  }

  /** 允许通过 update() 修改的字段白名单（阻断 role/password 越权改写） */
  var UPDATABLE_FIELDS = ['username', 'phone', 'age', 'gender', 'diabetesType', 'avatar_url'];

  var users = {
    all: function () { return read('users', []); },
    findByUsername: function (username) {
      return users.all().filter(function (u) { return u.username === username; })[0] || null;
    },
    findById: function (id) {
      return users.all().filter(function (u) { return u.user_id === id; })[0] || null;
    },

    /* ---------------- 数据库镜像（见 js/db-client.js） ----------------
     * 定位：localStorage 是「同步缓存」，MySQL 是「持久化真源」。
     * 页面仍然同步读本地表，本地表由数据库镜像保持最新。
     *
     * 口令哈希无法从数据库回填：数据库里存的是服务端 scrypt 派生值，
     * 前端算法不同，不能复用。因此镜像时：
     *   · 本地已有同名用户 → 只更新资料字段与角色，保留本地口令哈希（离线仍可登录）
     *   · 本地没有该用户   → 若本次登录刚验证过明文口令，就补一份本地哈希；
     *                        否则留空 —— 留空的用户在离线状态下无法登录，
     *                        这是刻意的：拿不到口令就无法校验。
     */

    /** 把一条数据库用户记录合并进本地镜像 */
    mirrorFromDb: function (dbUser, plainPassword) {
      if (!dbUser || !dbUser.username) return null;
      var list = users.all();
      var idx = -1;
      for (var i = 0; i < list.length; i++) {
        if (list[i].username === dbUser.username) { idx = i; break; }
      }
      var age = (dbUser.age === '' || dbUser.age === null || dbUser.age === undefined)
        ? '' : String(dbUser.age);

      if (idx < 0) {
        var salt = plainPassword ? Crypto.randomSalt(16) : '';
        list.push({
          user_id: dbUser.user_id,
          username: dbUser.username,
          password_salt: salt,
          password_hash: plainPassword ? Crypto.hashPassword(String(plainPassword), salt) : '',
          avatar_url: dbUser.avatar_url || '',
          role: dbUser.role || 'user',
          phone: dbUser.phone || '',
          age: age,
          gender: dbUser.gender || '',
          diabetesType: dbUser.diabetesType || '',
          create_time: dbUser.create_time || new Date().toISOString()
        });
        idx = list.length - 1;
      } else {
        var t = list[idx];
        t.user_id = dbUser.user_id;
        t.role = dbUser.role || t.role;
        t.avatar_url = dbUser.avatar_url || '';
        t.phone = dbUser.phone || '';
        t.age = age;
        t.gender = dbUser.gender || '';
        t.diabetesType = dbUser.diabetesType || '';
        if (plainPassword) {
          var s2 = Crypto.randomSalt(16);
          t.password_salt = s2;
          t.password_hash = Crypto.hashPassword(String(plainPassword), s2);
        }
      }
      writeUsersQuiet(list);
      return publicUser(list[idx]);
    },

    /**
     * 用数据库的整份用户列表刷新本地镜像。
     * 数据库是权威来源：同名用户的资料字段以数据库为准，本地口令哈希保留不变。
     *
     * @param {Array}  dbUsers 数据库返回的用户数组
     * @param {Object} [opts]  { keepLocalHashed: true }
     *        keepLocalHashed（默认 true）：保留「本地有口令哈希、数据库里没有」的账号。
     *        这是为了不破坏离线演示——种子账号 admin/user 在断网时仍能登录。
     *        传 false 则严格对齐数据库（本地多出来的账号会被清掉）。
     */
    replaceAllFromDb: function (dbUsers, opts) {
      var keepLocalHashed = !opts || opts.keepLocalHashed !== false;

      var local = users.all();
      var localByName = Object.create(null);
      local.forEach(function (u) { localByName[u.username] = u; });

      var merged = [];
      var mergedNames = Object.create(null);
      (dbUsers || []).forEach(function (d) {
        var prev = localByName[d.username];
        var age = (d.age === '' || d.age === null || d.age === undefined) ? '' : String(d.age);
        mergedNames[d.username] = true;
        if (prev) {
          prev.user_id = d.user_id;
          prev.role = d.role || prev.role;
          prev.avatar_url = d.avatar_url || '';
          prev.phone = d.phone || '';
          prev.age = age;
          prev.gender = d.gender || '';
          prev.diabetesType = d.diabetesType || '';
          merged.push(prev);
        } else {
          merged.push({
            user_id: d.user_id,
            username: d.username,
            password_salt: '',
            password_hash: '',
            avatar_url: d.avatar_url || '',
            role: d.role || 'user',
            phone: d.phone || '',
            age: age,
            gender: d.gender || '',
            diabetesType: d.diabetesType || '',
            create_time: d.create_time || new Date().toISOString()
          });
        }
      });

      // 本地有口令哈希、数据库里没有的账号：保留，保证离线演示可登录
      local.forEach(function (u) {
        if (mergedNames[u.username]) return;
        if (!keepLocalHashed) return;
        if (!u.password_hash) return;
        mergedNames[u.username] = true;
        merged.push(u);
      });

      writeUsersQuiet(merged);
      return merged;
    },

    /**
     * 校验口令。兼容历史明文数据：校验通过后立即升级为哈希并删除明文。
     * @returns {Object|null} 脱敏后的用户对象
     */
    verify: function (username, password) {
      var u = users.findByUsername(username);
      if (!u) return null;
      var input = String(password == null ? '' : password);

      if (u.password_hash && u.password_salt) {
        var h = Crypto.hashPassword(input, u.password_salt);
        return Crypto.timingSafeEqual(h, u.password_hash) ? publicUser(u) : null;
      }
      // 历史明文（旧版本数据）
      if (typeof u.password === 'string' && Crypto.timingSafeEqual(u.password, input)) {
        users.upgradePassword(u.username, input);
        return publicUser(users.findByUsername(u.username));
      }
      return null;
    },

    /** 把指定用户的明文口令就地升级为哈希 */
    upgradePassword: function (username, plainPassword) {
      var list = users.all();
      for (var i = 0; i < list.length; i++) {
        if (list[i].username !== username) continue;
        var salt = Crypto.randomSalt(16);
        list[i].password_salt = salt;
        list[i].password_hash = Crypto.hashPassword(plainPassword, salt);
        delete list[i].password;
        write('users', list);
        return true;
      }
      return false;
    },

    /** 扫描全部用户，把仍为明文的口令升级为哈希。返回升级条数。 */
    migratePasswords: function () {
      var list = users.all();
      var changed = 0;
      list.forEach(function (u) {
        if (u.password_hash && u.password_salt) return;
        if (typeof u.password !== 'string') return;
        var salt = Crypto.randomSalt(16);
        u.password_salt = salt;
        u.password_hash = Crypto.hashPassword(u.password, salt);
        delete u.password;
        changed++;
      });
      if (changed) write('users', list);
      return changed;
    },

    create: function (data) {
      var list = users.all();
      if (users.findByUsername(data.username)) return { ok: false, msg: '用户名已存在' };
      var salt = Crypto.randomSalt(16);
      var p = data.profile || {};
      var user = {
        user_id: uid(list, 'user_id'),
        username: data.username,
        password_salt: salt,
        password_hash: Crypto.hashPassword(String(data.password), salt),
        avatar_url: p.avatar_url || '',
        role: 'user',
        phone: p.phone || '',
        age: p.age === undefined || p.age === null ? '' : String(p.age),
        gender: p.gender || '',
        diabetesType: p.diabetesType || '',
        create_time: new Date().toISOString()
      };
      list.push(user);
      write('users', list);
      return { ok: true, user: publicUser(user) };
    },

    update: function (username, patch) {
      var list = users.all();
      var idx = -1;
      for (var i = 0; i < list.length; i++) if (list[i].username === username) { idx = i; break; }
      if (idx < 0) return { ok: false, msg: '用户不存在' };
      // 改名需校验唯一性
      if (patch.username && patch.username !== username && users.findByUsername(patch.username)) {
        return { ok: false, msg: '用户名已存在' };
      }
      var rejected = [];
      Object.keys(patch).forEach(function (k) {
        if (UPDATABLE_FIELDS.indexOf(k) < 0) { rejected.push(k); return; }
        list[idx][k] = patch[k];
      });
      if (rejected.length) {
        console.warn('[store] users.update 已忽略不可修改字段:', rejected.join(', '));
      }
      write('users', list);
      return { ok: true, user: publicUser(list[idx]) };
    },

    /**
     * 修改用户名，并迁移该用户的全部维度数据键
     * （collections/risk/plans/punch/chat/prefs）。
     * 不做迁移会导致改名后用户的方案、打卡、收藏「集体消失」。
     */
    rename: function (oldName, newName) {
      if (!oldName || !newName) return { ok: false, msg: '用户名不能为空' };
      if (oldName === newName) return { ok: true, moved: 0, user: users.findByUsername(oldName) };
      if (users.findByUsername(newName)) return { ok: false, msg: '用户名已存在' };

      var res = users.update(oldName, { username: newName });
      if (!res.ok) return res;

      var moved = 0;
      try {
        moved = migrateUserKeys(oldName, newName);
      } catch (e) {
        console.warn('[store] 用户数据迁移部分失败:', e);
      }
      return { ok: true, moved: moved, user: res.user };
    },

    count: function () { return users.all().length; }
  };

  /** 用户维度数据键的前缀 */
  var SCOPED_PREFIXES = ['collections:', 'risk:', 'plans:', 'punch:', 'chat:', 'prefs:'];

  /** 把 dpa:<prefix><oldName>[...] 重命名为 dpa:<prefix><newName>[...] */
  function migrateUserKeys(oldName, newName) {
    var moves = [];
    for (var i = 0; i < localStorage.length; i++) {
      var full = localStorage.key(i);
      if (!full || full.indexOf(P) !== 0) continue;
      var rest = full.slice(P.length);
      for (var j = 0; j < SCOPED_PREFIXES.length; j++) {
        var pre = SCOPED_PREFIXES[j];
        var oldHead = pre + oldName;
        if (rest.indexOf(oldHead) !== 0) continue;
        moves.push([full, P + pre + newName + rest.slice(oldHead.length)]);
        break;
      }
    }
    var moved = 0;
    moves.forEach(function (pair) {
      var value = localStorage.getItem(pair[0]);
      if (value === null) return;
      localStorage.setItem(pair[1], value);
      localStorage.removeItem(pair[0]);
      moved++;
    });
    clearCache();   // 键名已变，缓存整体失效
    return moved;
  }

  /* ==================== 会话（session） ==================== */

  var SESSION_KEY = 'session';

  var session = {
    get: function () { return session.current(); },

    /**
     * 写入会话。persist=true 写 localStorage（记住我，跨浏览器重启保留），
     * false 写 sessionStorage（仅本次会话）。两者互斥，避免「取消记住我仍持久化」。
     */
    set: function (user, persist) {
      var s = {
        user_id: user.user_id === undefined ? null : user.user_id,
        username: user.username,
        role: user.role || 'user',
        avatar: user.avatar_url || '',
        loginTime: new Date().toISOString()
      };
      var payload = JSON.stringify(s);
      try {
        if (persist) {
          localStorage.setItem(P + SESSION_KEY, payload);
          sessionStorage.removeItem(P + SESSION_KEY);
        } else {
          sessionStorage.setItem(P + SESSION_KEY, payload);
          localStorage.removeItem(P + SESSION_KEY);
        }
      } catch (e) {
        console.warn('[store] 会话写入失败:', e);
      }
      delete cache[SESSION_KEY];
      return s;
    },

    clear: function () {
      remove(SESSION_KEY);
      try { sessionStorage.removeItem(P + SESSION_KEY); } catch (e) { /* ignore */ }
    },

    /** 优先 sessionStorage（本次会话），其次 localStorage（记住我） */
    current: function () {
      try {
        var raw = sessionStorage.getItem(P + SESSION_KEY);
        if (raw) return JSON.parse(raw);
      } catch (e) { /* ignore */ }
      return read(SESSION_KEY, null);
    },

    username: function () {
      var s = session.current();
      return s ? s.username : null;
    },

    userId: function () {
      var s = session.current();
      return s ? s.user_id : null;
    },

    isAdmin: function () {
      var s = session.current();
      return !!s && s.role === 'admin';
    }
  };

  /* ==================== 文章（articles） ==================== */

  /** 阅读量独立存储：dpa:article_views = { [article_id]: n } */
  var VIEWS_KEY = 'article_views';

  function rawArticles() { return read('articles', []); }
  function viewsMap() { return read(VIEWS_KEY, {}); }

  /** 把独立存储的阅读量叠加到文章对象上 */
  function withViews(a) {
    var v = viewsMap()[a.article_id];
    return v === undefined ? a : Object.assign({}, a, { views: v });
  }

  var articles = {
    all: function () { return rawArticles().map(withViews); },
    get: function (id) {
      return articles.all().filter(function (a) { return a.article_id === id; })[0] || null;
    },
    byCategory: function (cat) {
      if (!cat || cat === '全部') return articles.all();
      return articles.all().filter(function (a) { return a.category === cat; });
    },
    categories: function () {
      var set = {};
      articles.all().forEach(function (a) { if (a.category) set[a.category] = 1; });
      return Object.keys(set);
    },
    add: function (data) {
      var list = rawArticles();
      var item = {
        article_id: uid(list, 'article_id'),
        title: data.title,
        cover_url: '',
        author: data.author || 'AI 健康助手',
        publish_time: data.publish_time || dateKey(new Date()),
        content: data.content || '',
        category: data.category || '糖尿病科普',
        views: 0
      };
      list.unshift(item);
      write('articles', list);
      return item;
    },
    /** 只写阅读量计数表，避免每次浏览都全量重写文章列表 */
    incViews: function (id) {
      var map = viewsMap();
      var base = map[id];
      if (base === undefined) {
        var a = rawArticles().filter(function (x) { return x.article_id === id; })[0];
        base = a ? (a.views || 0) : 0;
      }
      map[id] = base + 1;
      write(VIEWS_KEY, map);
      return map[id];
    },
    remove: function (id) {
      write('articles', rawArticles().filter(function (a) { return a.article_id !== id; }));
    },
    /** 批量删除（管理助手用） */
    removeMany: function (ids) {
      var kill = Object.create(null);
      (ids || []).forEach(function (id) { kill[id] = true; });
      var removed = rawArticles().filter(function (a) { return kill[a.article_id]; }).length;
      write('articles', rawArticles().filter(function (a) { return !kill[a.article_id]; }));
      return removed;
    }
  };

  /* ==================== 糖尿病类型（diabetes_types） ==================== */

  var types = {
    all: function () { return read('diabetes_types', []); },
    get: function (name) {
      return types.all().filter(function (t) { return t.type_name === name; })[0] || null;
    }
  };

  /* ==================== 医生（doctor_information） ==================== */

  var doctors = {
    all: function () { return read('doctors', []); },
    get: function (id) {
      return doctors.all().filter(function (d) { return d.info_id === id; })[0] || null;
    }
  };

  /* ==================== 收藏（article_collections） ==================== */

  var collections = {
    key: function () { return 'collections:' + (session.username() || 'guest'); },
    all: function () { return read(collections.key(), []); },
    has: function (articleId) {
      return collections.all().some(function (c) { return c.article_id === articleId; });
    },
    /** 一次性取出收藏 id 集合，避免在列表渲染中循环单查 */
    idSet: function () {
      var set = Object.create(null);
      collections.all().forEach(function (c) { set[c.article_id] = true; });
      return set;
    },
    toggle: function (articleId) {
      var list = collections.all();
      var idx = -1;
      for (var i = 0; i < list.length; i++) if (list[i].article_id === articleId) { idx = i; break; }
      var added;
      if (idx >= 0) { list.splice(idx, 1); added = false; }
      else {
        list.push({
          collection_id: uid(list, 'collection_id'),
          user_id: session.userId(),
          article_id: articleId,
          create_time: new Date().toISOString()
        });
        added = true;
      }
      write(collections.key(), list);
      return added;
    },
    listArticles: function () {
      var ids = collections.idSet();
      return articles.all().filter(function (a) { return ids[a.article_id] === true; });
    },
    count: function () { return collections.all().length; }
  };

  /* ==================== 风险信息（user_risk_info） ==================== */

  var risk = {
    key: function () { return 'risk:' + (session.username() || 'guest'); },
    latest: function () {
      var list = read(risk.key(), []);
      return list.length ? list[list.length - 1] : null;
    },
    history: function () { return read(risk.key(), []); },
    save: function (data) {
      var list = read(risk.key(), []);
      var item = Object.assign({}, data, {
        record_id: uid(list, 'record_id'),
        user_id: session.userId(),
        create_time: new Date().toISOString()
      });
      list.push(item);
      if (list.length > 30) list = list.slice(-30);
      write(risk.key(), list);
      return item;
    }
  };

  /* ==================== 生活方案（life_plans） ==================== */

  var plans = {
    key: function () { return 'plans:' + (session.username() || 'guest'); },
    all: function () { return read(plans.key(), []); },
    byType: function (type) {
      return plans.all().filter(function (p) { return p.type === type; });
    },
    /** 用模板生成默认方案（离线兜底） */
    generateFromTemplate: function () {
      var list = clone(SEED.LIFE_PLAN_TEMPLATE || []);
      list.forEach(function (p, i) { p.id = i + 1; p.user_id = session.userId(); });
      write(plans.key(), list);
      return list;
    },
    save: function (list) {
      list.forEach(function (p, i) { p.id = p.id || i + 1; p.user_id = session.userId(); });
      write(plans.key(), list);
      return list;
    },
    replace: function (list) { return plans.save(list); },
    count: function () { return plans.all().length; },
    clear: function () { write(plans.key(), []); }
  };

  /* ==================== 打卡（punch_in） ==================== */

  var punch = {
    key: function () { return 'punch:' + (session.username() || 'guest'); },
    all: function () { return read(punch.key(), []); },

    /** 某天某方案的打卡状态 */
    status: function (date, planId) {
      var k = date + '#' + planId;
      var hit = punch.all().filter(function (p) { return p._k === k; })[0];
      return hit ? hit.completion_status : null;
    },

    /** 某天全部方案的状态映射，避免渲染列表时逐项查询 */
    statusMap: function (date) {
      var map = Object.create(null);
      punch.all().forEach(function (p) {
        if (p._date === date) map[p._planId] = p.completion_status;
      });
      return map;
    },

    toggle: function (date, planId, punchType, planTitle) {
      var list = punch.all();
      var k = date + '#' + planId;
      var idx = -1;
      for (var i = 0; i < list.length; i++) if (list[i]._k === k) { idx = i; break; }
      var done;
      if (idx >= 0) {
        done = list[idx].completion_status !== '已完成';
        list[idx].completion_status = done ? '已完成' : '未完成';
        list[idx].punch_time = new Date().toISOString();
      } else {
        list.push({
          user_id: session.userId(),
          punch_time: new Date().toISOString(),
          punch_type: punchType,
          completion_status: '已完成',
          message: planTitle || '',
          _k: k,
          _date: date,
          _planId: planId
        });
        done = true;
      }
      write(punch.key(), list);
      return done;
    },

    byDate: function (date) {
      return punch.all().filter(function (p) { return p._date === date; });
    },

    /**
     * 近 n 天的日期与打卡项。
     * 使用**本地**日期键（dateKey），与 punch.toggle 的写入口径一致。
     */
    recentDays: function (n) {
      var out = [];
      for (var i = n - 1; i >= 0; i--) {
        var d = new Date();
        d.setDate(d.getDate() - i);
        var ds = dateKey(d);
        out.push({ date: ds, items: punch.byDate(ds) });
      }
      return out;
    },

    count: function () {
      return punch.all().filter(function (p) { return p.completion_status === '已完成'; }).length;
    },
    clear: function () { write(punch.key(), []); }
  };

  /* ==================== 聊天记录 ==================== */

  var chat = {
    key: function (appId) { return 'chat:' + (session.username() || 'guest') + ':' + appId; },
    all: function (appId) { return read(chat.key(appId), []); },
    push: function (appId, msg) {
      var list = chat.all(appId);
      list.push(Object.assign({ time: new Date().toISOString() }, msg));
      if (list.length > 200) list = list.slice(-200);
      write(chat.key(appId), list);
      return list;
    },
    clear: function (appId) { write(chat.key(appId), []); },
    conversationId: function (appId) { return read('conv:' + appId, ''); },
    setConversationId: function (appId, id) { write('conv:' + appId, id); }
  };

  /* ==================== 用户偏好 ==================== */

  var prefs = {
    key: function () { return 'prefs:' + (session.username() || 'guest'); },
    get: function (k, dft) {
      var p = read(prefs.key(), {});
      return p[k] === undefined ? dft : p[k];
    },
    set: function (k, v) {
      var p = read(prefs.key(), {});
      p[k] = v;
      write(prefs.key(), p);
    }
  };

  /* ==================== 统计 ==================== */

  function stats() {
    return {
      users: users.count(),
      articles: articles.all().length,
      plans: plans.count(),
      punch: punch.count(),
      collections: collections.count(),
      riskRecords: risk.history().length
    };
  }

  /* ==================== 导出 ==================== */

  init(); // 首次加载自动写入种子数据，并升级历史明文口令

  global.DPA = global.DPA || {};
  global.DPA.store = {
    init: init,
    dateKey: dateKey,
    clearCache: clearCache,
    users: users,
    session: session,
    articles: articles,
    types: types,
    doctors: doctors,
    collections: collections,
    risk: risk,
    plans: plans,
    punch: punch,
    chat: chat,
    prefs: prefs,
    stats: stats,

    /**
     * 订阅「用户表变更」事件（js/db-client.js 用它做 MySQL 写穿透）。
     * 返回取消订阅的函数。
     */
    onUsersChanged: function (fn) {
      if (typeof fn !== 'function') return function () {};
      usersChangedHandlers.push(fn);
      return function () {
        var i = usersChangedHandlers.indexOf(fn);
        if (i >= 0) usersChangedHandlers.splice(i, 1);
      };
    },

    _raw: { read: read, write: write, remove: remove, uid: uid, migrateUserKeys: migrateUserKeys }
  };
})(window);
