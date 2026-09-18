/**
 * auth.js — 登录态与权限守卫
 * ------------------------------------------------------------------
 * 角色统一为 role: 'user' | 'admin'（修复原 index.html 用 isAdmin、
 * personal.html 用 role 导致管理员入口永不显示的 P0 缺陷）。
 *
 * 【用户数据持久化】
 * 登录 / 注册优先走 MySQL 后端（DPA.db，见 js/db-client.js）：
 *   · 后端可用 → 以数据库为准（用户名唯一性、口令校验都在服务端完成）
 *   · 后端不可用 / 探测未完成 → 自动降级到 localStorage，
 *     行为与接入数据库之前完全一致（离线演示模式）
 * 两条路径都是**同步**返回，因此既有的同步调用方（含 273 条测试）不受影响。
 * ------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  var store = global.DPA.store;

  /** 数据库客户端（未加载该模块时为 undefined，自动退回纯本地模式） */
  function db() { return global.DPA.db; }

  var auth = {
    /** 当前用户（会话对象） */
    current: function () { return store.session.current(); },

    /** 是否已登录 */
    isLogged: function () { return !!store.session.current(); },

    /** 是否管理员 */
    isAdmin: function () { return store.session.isAdmin(); },

    /** 用户名 */
    username: function () { return store.session.username(); },

    /** 当前用户数据来源：'database' 数据库 / 'local' 本地降级 */
    source: function () {
      var d = db();
      return d && d.available ? 'database' : 'local';
    },

    /**
     * 登录
     * @param {string} username
     * @param {string} password
     * @param {boolean} persist 是否「记住我」
     * @returns {{ok:boolean, user?:Object, msg?:string, source:'database'|'local'}}
     */
    login: function (username, password, persist) {
      var d = db();
      if (d) {
        var r = d.loginSync(username, password);
        if (r && r.status === 'ok') {
          store.session.set(r.user, persist !== false);
          return { ok: true, user: r.user, source: 'database' };
        }
        if (r && r.status === 'rejected') {
          // 服务端明确答复「口令错误」，不再降级——否则数据库形同虚设
          return { ok: false, msg: r.msg || '用户名或密码错误', source: 'database' };
        }
      }
      /* 后端不可用：降级为本地校验（离线演示模式） */
      var user = store.users.verify(username, password);
      if (!user) return { ok: false, msg: '用户名或密码错误', source: 'local' };
      store.session.set(user, persist !== false);
      return { ok: true, user: user, source: 'local' };
    },

    /**
     * 注册并自动登录
     * @param {string} username
     * @param {string} password
     * @param {Object} [profile] 选填资料 { phone, age, gender, diabetesType }
     */
    register: function (username, password, profile) {
      var d = db();
      if (d) {
        var r = d.registerSync(username, password, profile);
        if (r && r.status === 'ok') {
          var u = store.users.findByUsername(r.user.username) || r.user;
          store.session.set(u, true);
          return { ok: true, user: u, source: 'database' };
        }
        if (r && r.status === 'rejected') {
          return { ok: false, msg: r.msg, source: 'database' };
        }
      }
      /* 后端不可用：降级为本地创建（离线演示模式） */
      var res = store.users.create({
        username: username, password: password, profile: profile
      });
      if (!res.ok) return res;
      store.session.set(res.user, true);
      return { ok: true, user: res.user, source: 'local' };
    },

    /** 退出 */
    logout: function (redirect) {
      store.session.clear();
      if (redirect !== false) location.href = 'index.html';
    },

    /**
     * 页面守卫：未登录跳转到登录页
     * @returns {boolean} 是否通过
     */
    requireAuth: function () {
      if (!auth.isLogged()) {
        var from = location.pathname.split('/').pop() + location.search;
        location.replace('index.html?redirect=' + encodeURIComponent(from));
        return false;
      }
      return true;
    },

    /** 管理员守卫：非管理员拦截 */
    requireAdmin: function () {
      if (!auth.requireAuth()) return false;
      if (!auth.isAdmin()) {
        if (global.DPA.ui) global.DPA.ui.toast('无权访问该页面，仅管理员可用', 'error');
        setTimeout(function () { location.replace('home.html'); }, 1200);
        return false;
      }
      return true;
    },

    /** 已登录用户访问登录页时自动跳转 */
    redirectIfLogged: function (target) {
      if (auth.isLogged()) {
        location.replace(target || 'home.html');
        return true;
      }
      return false;
    }
  };

  global.DPA = global.DPA || {};
  global.DPA.auth = auth;
})(window);
