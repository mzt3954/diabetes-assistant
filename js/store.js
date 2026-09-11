/**
 * store.js — 数据仓储层
 * ------------------------------------------------------------------
 * 统一封装 localStorage 读写，键名规范：dpa:<entity>[:<userId>]
 * 实体字段严格对齐 项目素材/知识库/db.txt 的表结构。
 * 所有页面只通过 DPA.store 访问数据，不直接操作 localStorage。
 * ------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  var P = (global.DPA_CONFIG && global.DPA_CONFIG.STORAGE_PREFIX) || 'dpa:';
  var SEED = global.DPA_SEED || {};

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(P + key);
      if (raw === null || raw === undefined) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('[store] 读取失败:', key, e);
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(P + key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('[store] 写入失败（可能超出配额）:', key, e);
      return false;
    }
  }

  function remove(key) {
    localStorage.removeItem(P + key);
  }

  function uid(list, field) {
    var max = 0;
    list.forEach(function (it) {
      if (typeof it[field] === 'number' && it[field] > max) max = it[field];
    });
    return max + 1;
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function init() {
    if (!read('users', null)) write('users', clone(SEED.USERS || []));
    if (!read('articles', null)) write('articles', clone(SEED.ARTICLES || []));
    if (!read('diabetes_types', null)) write('diabetes_types', clone(SEED.DIABETES_TYPES || []));
    if (!read('doctors', null)) write('doctors', clone(SEED.DOCTORS || []));
  }

  var users = {
    all: function () { return read('users', []); },
    findByUsername: function (username) {
      return users.all().filter(function (u) { return u.username === username; })[0] || null;
    },
    verify: function (username, password) {
      var u = users.findByUsername(username);
      return (u && u.password === password) ? u : null;
    },
    create: function (data) {
      var list = users.all();
      if (users.findByUsername(data.username)) return { ok: false, msg: '用户名已存在' };
      var user = {
        user_id: uid(list, 'user_id'),
        username: data.username,
        password: data.password,
        avatar_url: '',
        role: 'user',
        phone: '',
        age: '',
        gender: '',
        create_time: new Date().toISOString()
      };
      list.push(user);
      write('users', list);
      return { ok: true, user: user };
    },
    update: function (username, patch) {
      var list = users.all();
      var idx = -1;
      for (var i = 0; i < list.length; i++) if (list[i].username === username) { idx = i; break; }
      if (idx < 0) return { ok: false, msg: '用户不存在' };
      if (patch.username && patch.username !== username && users.findByUsername(patch.username)) {
        return { ok: false, msg: '用户名已存在' };
      }
      Object.keys(patch).forEach(function (k) { list[idx][k] = patch[k]; });
      write('users', list);
      return { ok: true, user: list[idx] };
    },
    count: function () { return users.all().length; }
  };

  var session = {
    get: function () { return read('session', null); },
    set: function (user, persist) {
      var s = {
        username: user.username,
        role: user.role || 'user',
        avatar: user.avatar_url || '',
        loginTime: new Date().toISOString()
      };
      write('session', s);
      if (!persist) {
        try { sessionStorage.setItem(P + 'session', JSON.stringify(s)); } catch (e) {}
      }
      return s;
    },
    clear: function () {
      remove('session');
      try { sessionStorage.removeItem(P + 'session'); } catch (e) {}
    },
    current: function () {
      var s = read('session', null);
      if (s) return s;
      try {
        var raw = sessionStorage.getItem(P + 'session');
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    },
    username: function () {
      var s = session.current();
      return s ? s.username : null;
    },
    isAdmin: function () {
      var s = session.current();
      return !!s && s.role === 'admin';
    }
  };

  var articles = {
    all: function () { return read('articles', []); },
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
      var list = articles.all();
      var item = {
        article_id: uid(list, 'article_id'),
        title: data.title,
        cover_url: '',
        author: data.author || 'AI 健康助手',
        publish_time: data.publish_time || new Date().toISOString().slice(0, 10),
        content: data.content || '',
        category: data.category || '糖尿病科普',
        views: 0
      };
      list.unshift(item);
      write('articles', list);
      return item;
    },
    incViews: function (id) {
      var list = articles.all();
      list.forEach(function (a) { if (a.article_id === id) a.views = (a.views || 0) + 1; });
      write('articles', list);
    },
    remove: function (id) {
      write('articles', articles.all().filter(function (a) { return a.article_id !== id; }));
    }
  };

  var types = {
    all: function () { return read('diabetes_types', []); },
    get: function (name) {
      return types.all().filter(function (t) { return t.type_name === name; })[0] || null;
    }
  };

  var doctors = {
    all: function () { return read('doctors', []); },
    get: function (id) {
      return doctors.all().filter(function (d) { return d.info_id === id; })[0] || null;
    }
  };

  var collections = {
    key: function () { return 'collections:' + (session.username() || 'guest'); },
    all: function () { return read(collections.key(), []); },
    has: function (articleId) {
      return collections.all().some(function (c) { return c.article_id === articleId; });
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
          user_id: session.username(),
          article_id: articleId,
          create_time: new Date().toISOString()
        });
        added = true;
      }
      write(collections.key(), list);
      return added;
    },
    listArticles: function () {
      var ids = collections.all().map(function (c) { return c.article_id; });
      return articles.all().filter(function (a) { return ids.indexOf(a.article_id) >= 0; });
    },
    count: function () { return collections.all().length; }
  };

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
        userId: uid(list, 'userId'),
        create_time: new Date().toISOString()
      });
      list.push(item);
      if (list.length > 30) list = list.slice(-30);
      write(risk.key(), list);
      return item;
    }
  };

  var plans = {
    key: function () { return 'plans:' + (session.username() || 'guest'); },
    all: function () { return read(plans.key(), []); },
    byType: function (type) {
      return plans.all().filter(function (p) { return p.type === type; });
    },
    generateFromTemplate: function () {
      var list = clone(SEED.LIFE_PLAN_TEMPLATE || []);
      list.forEach(function (p, i) { p.id = i + 1; p.user_id = session.username(); });
      write(plans.key(), list);
      return list;
    },
    save: function (list) {
      list.forEach(function (p, i) { p.id = p.id || i + 1; p.user_id = session.username(); });
      write(plans.key(), list);
      return list;
    },
    replace: function (list) { return plans.save(list); },
    count: function () { return plans.all().length; },
    clear: function () { write(plans.key(), []); }
  };

  var punch = {
    key: function () { return 'punch:' + (session.username() || 'guest'); },
    all: function () { return read(punch.key(), []); },
    status: function (date, planId) {
      var k = date + '#' + planId;
      var hit = punch.all().filter(function (p) { return p._k === k; })[0];
      return hit ? hit.completion_status : null;
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
          user_id: session.username(),
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
    recentDays: function (n) {
      var out = [];
      for (var i = n - 1; i >= 0; i--) {
        var d = new Date();
        d.setDate(d.getDate() - i);
        var ds = d.toISOString().slice(0, 10);
        out.push({ date: ds, items: punch.byDate(ds) });
      }
      return out;
    },
    count: function () { return punch.all().filter(function (p) { return p.completion_status === '已完成'; }).length; },
    clear: function () { write(punch.key(), []); }
  };

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

  init(); // 首次加载自动写入种子数据

  global.DPA = global.DPA || {};
  global.DPA.store = {
    init: init,
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
    _raw: { read: read, write: write, remove: remove, uid: uid }
  };
})(window);