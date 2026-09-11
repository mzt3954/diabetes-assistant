/**
 * auth.js — 登录态与权限守卫
 * ------------------------------------------------------------------
 * 角色统一为 role: 'user' | 'admin'（修复原 index.html 用 isAdmin、
 * personal.html 用 role 导致管理员入口永不显示的 P0 缺陷）。
 * ------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  var store = global.DPA.store;

  var auth = {
    /** 当前用户（会话对象） */
    current: function () { return store.session.current(); },

    /** 是否已登录 */
    isLogged: function () { return !!store.session.current(); },

    /** 是否管理员 */
    isAdmin: function () { return store.session.isAdmin(); },

    /** 用户名 */
    username: function () { return store.session.username(); },

    /** 登录 */
    login: function (username, password, persist) {
      var user = store.users.verify(username, password);
      if (!user) return { ok: false, msg: '用户名或密码错误' };
      store.session.set(user, persist !== false);
      return { ok: true, user: user };
    },

    /** 注册并自动登录 */
    register: function (username, password) {
      var res = store.users.create({ username: username, password: password });
      if (!res.ok) return res;
      store.session.set(res.user, true);
      return { ok: true, user: res.user };
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
