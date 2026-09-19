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

  /** 清空内存缓存：storage 事件（其他标签页写入）或键迁移后调用，避免读到脏数据 */
  function clearCache() { cache = Object.create(null); }

  /**
   * 读取存储项并解析为对象，带内存缓存（命中缓存则直接返回）。
   * @param {string} key 存储键（自动加前缀 P）
   * @param {*} fallback 缺失或解析失败时的默认值
   * @returns {*} 解析后的值
   */
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

  /**
   * 写入存储项（自动加前缀 P），写入成功后触发用户表变更钩子（若 key 为 users）。
   * @param {string} key 存储键
   * @param {*} value 要序列化的值
   * @returns {boolean} 是否写入成功（超出配额等异常返回 false）
   */
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

  /** 删除存储项（连同缓存），隐私模式等写入异常时静默忽略 */
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

  /** 生成自增 id：取 list 中指定字段的最大值 + 1（用于 user_id / article_id 等主键） */
  function uid(list, field) {
    var max = 0;
    list.forEach(function (it) {
      if (typeof it[field] === 'number' && it[field] > max) max = it[field];
    });
    return max + 1;
  }

  /** 深拷贝（JSON 序列化方式），用于把种子数据复制进本地存储 */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /** 补零到两位数（用于月/日格式化） */
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

  /**
   * 初始化仓储：首次运行时把种子数据（用户/文章/分型/医生）写入本地，
   * 并把历史明文口令就地升级为加盐哈希。
   */
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
    /** 全部用户列表 */
    all: function () { return read('users', []); },
    /** 按用户名查找用户 */
    findByUsername: function (username) {
      return users.all().filter(function (u) { return u.username === username; })[0] || null;
    },
    /** 按 user_id 查找用户 */
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

    /**
     * 创建新用户（密码加盐哈希存储），用户名重复则返回失败。
     * @param {Object} data {username, password, profile}
     * @returns {{ok:boolean, user?:Object, msg?:string}}
     */
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

    /**
     * 更新用户资料；只允许修改白名单字段，非白名单字段会忽略并告警。
     * @param {string} username 目标用户名
     * @param {Object} patch 待更新字段
     * @returns {{ok:boolean, user?:Object, msg?:string}}
     */
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

    /** 用户总数 */
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
    /** 读取当前会话对象 */
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

    /** 清除会话（同时清 localStorage / sessionStorage 两处的会话记录） */
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

    /** 当前登录用户名（未登录返回 null） */
    username: function () {
      var s = session.current();
      return s ? s.username : null;
    },

    /** 当前登录用户 id（未登录返回 null） */
    userId: function () {
      var s = session.current();
      return s ? s.user_id : null;
    },

    /** 是否管理员角色 */
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
    /** 全部文章列表（叠加独立存储的阅读量） */
    all: function () { return rawArticles().map(withViews); },
    /** 按 article_id 查文章 */
    get: function (id) {
      return articles.all().filter(function (a) { return a.article_id === id; })[0] || null;
    },
    /** 按分类筛选文章；cat 为空或 '全部' 时返回全部 */
    byCategory: function (cat) {
      if (!cat || cat === '全部') return articles.all();
      return articles.all().filter(function (a) { return a.category === cat; });
    },
    /** 现有文章分类集合 */
    categories: function () {
      var set = {};
      articles.all().forEach(function (a) { if (a.category) set[a.category] = 1; });
      return Object.keys(set);
    },
    /**
     * 新增文章（追加到列表头部）。
     * @param {Object} data {title, author?, publish_time?, content?, category?}
     * @returns {Object} 新文章对象（含自增 article_id）
     */
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
    /** 删除单篇文章 */
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
    /** 全部糖尿病类型 */
    all: function () { return read('diabetes_types', []); },
    /** 按类型名查询糖尿病类型 */
    get: function (name) {
      return types.all().filter(function (t) { return t.type_name === name; })[0] || null;
    }
  };

  /* ==================== 医生（doctor_information） ==================== */

  var doctors = {
    /** 全部医生 */
    all: function () { return read('doctors', []); },
    /** 按 info_id 查医生 */
    get: function (id) {
      return doctors.all().filter(function (d) { return d.info_id === id; })[0] || null;
    }
  };

  /* ==================== 收藏（article_collections） ==================== */

  var collections = {
    /** 收藏作用域键名（按当前用户名隔离） */
    key: function () { return 'collections:' + (session.username() || 'guest'); },
    /** 当前用户收藏列表 */
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
    /** 当前用户收藏的文章列表 */
    listArticles: function () {
      var ids = collections.idSet();
      return articles.all().filter(function (a) { return ids[a.article_id] === true; });
    },
    /** 收藏总数 */
    count: function () { return collections.all().length; }
  };

  /* ==================== 风险信息（user_risk_info） ==================== */

  var risk = {
    /** 风险记录作用域键名（按当前用户名隔离） */
    key: function () { return 'risk:' + (session.username() || 'guest'); },
    /** 最近一次风险预测记录 */
    latest: function () {
      var list = read(risk.key(), []);
      return list.length ? list[list.length - 1] : null;
    },
    /** 风险预测历史记录 */
    history: function () { return read(risk.key(), []); },
    /**
     * 保存一条风险预测记录（只保留最近 30 条）。
     * @param {Object} data 风险预测结果
     * @returns {Object} 带 record_id / create_time 的记录
     */
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
    /** 生活方案作用域键名（按当前用户名隔离） */
    key: function () { return 'plans:' + (session.username() || 'guest'); },
    /** 当前用户生活方案列表 */
    all: function () { return read(plans.key(), []); },
    /** 按类型筛选方案（如 '饮食'/'运动'/'其他'） */
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
    /**
     * 保存方案列表（补齐自增 id 与 user_id 后写入）。
     * @param {Array} list 方案数组
     * @returns {Array} 写入后的方案列表
     */
    save: function (list) {
      list.forEach(function (p, i) { p.id = p.id || i + 1; p.user_id = session.userId(); });
      write(plans.key(), list);
      return list;
    },
    /** 整体替换方案 */
    replace: function (list) { return plans.save(list); },
    /** 方案总数 */
    count: function () { return plans.all().length; },
    /** 清空方案 */
    clear: function () { write(plans.key(), []); }
  };

  /* ==================== 打卡（punch_in） ==================== */

  var punch = {
    /** 打卡作用域键名（按当前用户名隔离） */
    key: function () { return 'punch:' + (session.username() || 'guest'); },
    /** 当前用户打卡记录列表 */
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

    /** 某天的全部打卡记录 */
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

    /** 已完成打卡的总次数 */
    count: function () {
      return punch.all().filter(function (p) { return p.completion_status === '已完成'; }).length;
    },
    /** 清空打卡记录 */
    clear: function () { write(punch.key(), []); }
  };

  /* ==================== 聊天记录 ==================== */

  var chat = {
    /** 聊天记录作用域键名（按用户名 + 应用隔离） */
    key: function (appId) { return 'chat:' + (session.username() || 'guest') + ':' + appId; },
    /** 某应用的聊天记录 */
    all: function (appId) { return read(chat.key(appId), []); },
    /**
     * 追加一条聊天消息到某应用的记录（时间戳补齐，仅保留最新 200 条）。
     * @param {string} appId 应用键名
     * @param {Object} msg 消息对象
     * @returns {Array} 更新后的聊天记录
     */
    push: function (appId, msg) {
      var list = chat.all(appId);
      list.push(Object.assign({ time: new Date().toISOString() }, msg));
      if (list.length > 200) list = list.slice(-200);
      write(chat.key(appId), list);
      return list;
    },
    /** 清空某应用的聊天记录 */
    clear: function (appId) { write(chat.key(appId), []); },
    /** 读取某应用的服务端会话 id（用于多轮对话续接） */
    conversationId: function (appId) { return read('conv:' + appId, ''); },
    /** 保存某应用的服务端会话 id */
    setConversationId: function (appId, id) { write('conv:' + appId, id); }
  };

  /* ==================== 用户偏好 ==================== */

  var prefs = {
    /** 用户偏好作用域键名 */
    key: function () { return 'prefs:' + (session.username() || 'guest'); },
    /** 读取偏好项 */
    get: function (k, dft) {
      var p = read(prefs.key(), {});
      return p[k] === undefined ? dft : p[k];
    },
    /** 写入偏好项 */
    set: function (k, v) {
      var p = read(prefs.key(), {});
      p[k] = v;
      write(prefs.key(), p);
    }
  };

  /* ==================== 统计 ==================== */

  /** 汇总各实体数量，供管理后台统计使用 */
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
