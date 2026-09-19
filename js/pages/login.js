/**
 * pages/login.js — 登录 / 注册页
 * ==============================
 * 功能：登录表单与注册表单切换、密码显隐、表单校验、登录/注册提交、
 *      演示账号一键填充；已登录用户自动跳转。
 * 交互模块：DPA.ui(校验/转义/提示/重定向校验)、DPA.auth(登录/注册/会话)。
 */
// IIFE 隔离作用域。登录/注册成功后跳转到页面 URL 指定的安全 redirect。
(function () {
  'use strict';

  var auth = DPA.auth;
  var ui = DPA.ui;

  /* 已登录直接跳转 */
  // redirect 来自 URL，必须经白名单校验，否则构成开放重定向漏洞
  var redirect = ui.safeRedirect(ui.query('redirect'), 'home.html');
  if (auth.redirectIfLogged(redirect)) return;

  /* ---------- 标签切换 ---------- */
  var tabs = document.querySelectorAll('.auth-tab');
  var loginForm = document.getElementById('loginForm');
  var registerForm = document.getElementById('registerForm');

  /**
   * 切换登录/注册表单及顶部标签的激活态，并清空表单错误信息。
   * @param {string} target 目标标签：'login' 或 'register'
   * @returns {void} 无返回值
   */
  function switchTab(target) {
    tabs.forEach(function (t) {
      var on = t.dataset.tab === target;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    loginForm.classList.toggle('active', target === 'login');
    registerForm.classList.toggle('active', target === 'register');
    document.querySelectorAll('.form-error').forEach(function (e) { e.textContent = ''; e.classList.remove('show'); });
    document.querySelectorAll('.form-input').forEach(function (e) { e.classList.remove('error'); });
  }

  // Tab 及「去注册/去登录」链接触发切换
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () { switchTab(tab.dataset.tab); });
  });
  document.getElementById('goToRegister').addEventListener('click', function (e) { e.preventDefault(); switchTab('register'); });
  document.getElementById('goToLogin').addEventListener('click', function (e) { e.preventDefault(); switchTab('login'); });

  /* ---------- 密码显隐 ---------- */
  // 点击眼睛图标在明文/密文间切换
  document.querySelectorAll('.password-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var input = document.getElementById(btn.dataset.target);
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.style.color = show ? 'var(--primary-color)' : '';
    });
  });

  /* ---------- 加载态 ---------- */
  /**
   * 设置提交按钮的加载态：禁用按钮、切换文字并控制 loading 动画显示。
   * @param {HTMLElement} btn 按钮元素
   * @param {boolean} loading 是否处于加载中
   * @param {string} [text] 按钮文字（非加载态显示）
   * @returns {void} 无返回值
   */
  function setLoading(btn, loading, text) {
    var label = btn.querySelector('.btn-text');
    var spinner = btn.querySelector('.loading-spinner');
    btn.disabled = loading;
    if (label) label.textContent = loading ? (text + '中...') : text;
    if (spinner) spinner.classList.toggle('hidden', !loading);
  }

  /* ---------- 登录 ---------- */
  // 登录表单提交：校验 → 加载态 → 调用 auth.login，成功后带信息跳转
  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var ok = ui.validate({
      loginUsername: [ui.validators.required],
      loginPassword: [ui.validators.password]
    });
    if (!ok) return;

    var btn = document.getElementById('loginBtn');
    setLoading(btn, true, '登录');

    setTimeout(function () {
      var username = document.getElementById('loginUsername').value.trim();
      var password = document.getElementById('loginPassword').value;
      var remember = document.getElementById('rememberMe').checked;
      var res = auth.login(username, password, remember);
      setLoading(btn, false, '登录');

      if (!res.ok) {
        var err = document.getElementById('loginPasswordError');
        err.textContent = res.msg;
        err.classList.add('show');
        document.getElementById('loginPassword').classList.add('error');
        return;
      }
      ui.toast('欢迎回来，' + res.user.username);
      setTimeout(function () { location.href = redirect || 'home.html'; }, 400);
    }, 400);
  });

  /* ---------- 注册 ---------- */
  // 注册表单提交：校验（含二次密码一致性）→ 加载态 → 调用 auth.register
  registerForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var ok = ui.validate({
      registerUsername: [ui.validators.username],
      registerPassword: [ui.validators.password],
      registerConfirmPassword: [
        ui.validators.required,
        function (v) {
          return v === document.getElementById('registerPassword').value || '两次输入的密码不一致';
        }
      ]
    });
    if (!ok) return;

    var btn = document.getElementById('registerBtn');
    setLoading(btn, true, '注册');

    setTimeout(function () {
      var username = document.getElementById('registerUsername').value.trim();
      var password = document.getElementById('registerPassword').value;
      var res = auth.register(username, password);
      setLoading(btn, false, '注册');

      if (!res.ok) {
        var err = document.getElementById('registerUsernameError');
        err.textContent = res.msg;
        err.classList.add('show');
        return;
      }
      ui.toast('注册成功，正在进入系统');
      setTimeout(function () { location.href = 'home.html'; }, 500);
    }, 400);
  });

  /* ---------- 演示账号一键填充 ---------- */
  // 演示账号按钮：切换到登录并自动填入账号密码
  document.querySelectorAll('.demo-account').forEach(function (btn) {
    btn.addEventListener('click', function () {
      switchTab('login');
      document.getElementById('loginUsername').value = btn.dataset.u;
      document.getElementById('loginPassword').value = btn.dataset.p;
      ui.toast('已填充演示账号，点击登录即可');
    });
  });
})();
