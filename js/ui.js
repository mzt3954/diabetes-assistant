/**
 * ui.js — 通用 UI 组件与工具
 * ------------------------------------------------------------------
 * 收敛原先在 8 个页面中重复实现的：导航栏、底部导航、Toast、Modal、
 * 空状态、加载态、表单校验、HTML 转义、时间格式化、轻量 Markdown。
 * ------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  var store = global.DPA.store;

  /* ============ 安全与格式化 ============ */

  /** HTML 转义，防 XSS（修复原 innerHTML 直接拼接用户输入的问题） */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 属性值转义（在 HTML 转义基础上额外转义反引号，用于 data-* / onclick 参数） */
  function escapeAttr(str) { return escapeHtml(str).replace(/`/g, '&#96;'); }

  /** 补零到两位数（时间/日期格式化用） */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  /** 2026-01-15 -> 2026年1月15日 */
  function formatDate(input) {
    var d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return String(input || '');
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  /** ISO -> HH:MM */
  function formatTime(input) {
    var d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return '';
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /** 2026-01-15T10:20:30 -> 2026-01-15 */
  function toDateKey(input) {
    var d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /** 相对时间：刚刚 / 5分钟前 / 3小时前 / 2天前 */
  function relativeTime(input) {
    var d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return '';
    var diff = Date.now() - d.getTime();
    var min = Math.floor(diff / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return min + '分钟前';
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + '小时前';
    var day = Math.floor(hr / 24);
    if (day < 30) return day + '天前';
    return toDateKey(d);
  }

  /**
   * 数字千分位。
   * 只对整数部分加分隔符：早期实现直接对整串正则替换，
   * formatNumber(1234.5678) 会得到 "1,234.5,678"。
   */
  function formatNumber(n) {
    var num = Number(n);
    if (!isFinite(num)) return String(n == null ? '' : n);
    var neg = num < 0;
    var parts = String(Math.abs(num)).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + parts.join('.');
  }

  /** 轻量 Markdown 渲染（支持 ## 标题、**加粗**、- 列表、1. 列表、空行分段） */
  function renderMarkdown(md) {
    if (!md) return '';
    var lines = String(md).split('\n');
    var html = [];
    var inList = false;
    function closeList() { if (inList) { html.push('</ul>'); inList = false; } }

    lines.forEach(function (raw) {
      var line = escapeHtml(raw);
      if (!line.trim()) { closeList(); html.push('<div class="md-gap"></div>'); return; }
      if (/^###\s+/.test(raw)) { closeList(); html.push('<h4 class="md-h4">' + line.replace(/^###\s+/, '') + '</h4>'); return; }
      if (/^##\s+/.test(raw)) { closeList(); html.push('<h3 class="md-h3">' + line.replace(/^##\s+/, '') + '</h3>'); return; }
      if (/^#\s+/.test(raw)) { closeList(); html.push('<h2 class="md-h2">' + line.replace(/^#\s+/, '') + '</h2>'); return; }
      if (/^\s*[-*]\s+/.test(raw)) {
        if (!inList) { html.push('<ul class="md-ul">'); inList = true; }
        html.push('<li>' + line.replace(/^\s*[-*]\s+/, '') + '</li>');
        return;
      }
      closeList();
      html.push('<p class="md-p">' + line + '</p>');
    });
    closeList();
    return html.join('')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.+?)`/g, '<code>$1</code>');
  }

  /* ============ Toast ============ */

  var TOAST_ICONS = {
    success: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
    error: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    warning: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'
  };

  /** 获取或按需创建全局 Toast 容器元素 */
  function toastContainer() {
    var el = document.getElementById('dpaToastContainer');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dpaToastContainer';
      el.className = 'toast-container';
      document.body.appendChild(el);
    }
    return el;
  }

  /** 显示一条 Toast 提示（success/error/warning/info，默认 2.2s 后自动淡出移除） */
  function toast(message, type, duration) {
    type = type || 'success';
    var box = toastContainer();
    var el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.setAttribute('role', 'status');
    el.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      (TOAST_ICONS[type] || TOAST_ICONS.info) + '</svg><span>' + escapeHtml(message) + '</span>';
    box.appendChild(el);
    setTimeout(function () {
      el.style.animation = 'toastOut .3s ease forwards';
      setTimeout(function () { el.remove(); }, 300);
    }, duration || 2200);
  }

  /* ============ Modal ============ */

  /**
   * 通用模态框
   * ⚠️ opts.html 会**原样**插入 innerHTML（用于容纳表单等富结构），
   *    因此调用方必须自行对任何动态内容调用 escapeHtml/escapeAttr。
   *    标题、按钮文案等纯文本字段已由本函数自动转义。
   */
  function modal(opts) {
    opts = opts || {};
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop active';
    backdrop.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true">' +
        '<div class="modal-header"><h3 class="modal-title">' + escapeHtml(opts.title || '提示') + '</h3>' +
        '<button class="modal-close" aria-label="关闭">&times;</button></div>' +
        '<div class="modal-body">' + (opts.html || '') + '</div>' +
        (opts.footer === false ? '' :
          '<div class="modal-footer">' +
            '<button class="btn btn-outline" data-act="cancel">' + escapeHtml(opts.cancelText || '取消') + '</button>' +
            '<button class="btn btn-primary" data-act="ok">' + escapeHtml(opts.okText || '确定') + '</button>' +
          '</div>') +
      '</div>';
    document.body.appendChild(backdrop);
    document.body.style.overflow = 'hidden';

    function close() {
      backdrop.remove();
      document.body.style.overflow = '';
      if (opts.onClose) opts.onClose();
    }
    backdrop.querySelector('.modal-close').onclick = close;
    var cancel = backdrop.querySelector('[data-act="cancel"]');
    if (cancel) cancel.onclick = close;
    var ok = backdrop.querySelector('[data-act="ok"]');
    if (ok) ok.onclick = function () {
      if (!opts.onOk || opts.onOk(backdrop) !== false) close();
    };
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
    return { el: backdrop, close: close };
  }

  /** 确认对话框：返回 Promise<boolean>，用户点确定 resolve(true)，取消/关闭 resolve(false) */
  function confirm(opts) {
    return new Promise(function (resolve) {
      var m = modal({
        title: opts.title || '确认操作',
        html: '<p style="color:var(--text-secondary);line-height:1.7">' + escapeHtml(opts.message || '') + '</p>',
        okText: opts.okText || '确定',
        cancelText: opts.cancelText || '取消',
        onOk: function () { resolve(true); },
        onClose: function () { resolve(false); }
      });
      if (opts.danger) {
        var btn = m.el.querySelector('[data-act="ok"]');
        if (btn) btn.style.background = 'var(--error-color)';
      }
    });
  }

  /* ============ 导航栏（统一渲染，替代各页重复实现） ============ */

  var NAV_ITEMS = [
    { href: 'home.html', text: '首页', key: 'home' },
    { href: 'health-news.html', text: '健康资讯', key: 'news' },
    { href: 'doctor.html', text: '医师咨询', key: 'doctor' },
    { href: 'assistant.html', text: '智能助手', key: 'assistant' }
  ];

  var BOTTOM_ITEMS = [
    { href: 'home.html', text: '首页', key: 'home', icon: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>' },
    { href: 'health-news.html', text: '资讯', key: 'news', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>' },
    { href: 'assistant.html', text: '助手', key: 'assistant', icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' },
    { href: 'personal.html', text: '我的', key: 'personal', icon: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>' }
  ];

  var LOGO_SVG = '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>';

  /** 渲染顶部导航栏到 #dpaNavbar */
  function renderNavbar(active) {
    var host = document.getElementById('dpaNavbar');
    if (!host) return;
    var s = store.session.current();
    var name = s ? s.username : '未登录';
    var initial = name.charAt(0).toUpperCase();

    var menu = NAV_ITEMS.map(function (it) {
      return '<a href="' + it.href + '" class="navbar-item' + (it.key === active ? ' active' : '') + '">' + it.text + '</a>';
    }).join('');

    host.className = 'navbar';
    host.innerHTML =
      '<div class="container"><div class="flex items-center justify-between">' +
        '<a href="home.html" class="navbar-brand">' + LOGO_SVG + '<span>糖尿病助手</span></a>' +
        '<nav class="navbar-menu">' + menu + '</nav>' +
        '<div class="relative">' +
          '<button class="navbar-user" id="dpaUserTrigger" aria-haspopup="true" aria-expanded="false">' +
            '<span class="navbar-avatar">' + escapeHtml(initial) + '</span>' +
            '<span class="navbar-username">' + escapeHtml(name) + '</span>' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>' +
          '</button>' +
          '<div class="user-dropdown" id="dpaUserDropdown">' +
            '<div class="dropdown-item" data-href="personal.html">个人中心</div>' +
            '<div class="dropdown-item" data-href="life-plan.html">我的方案</div>' +
            '<div class="dropdown-item" data-href="checkin.html">打卡记录</div>' +
            '<div class="dropdown-item" data-href="risk-prediction.html">风险预测</div>' +
            (store.session.isAdmin() ? '<div class="dropdown-item" data-href="admin.html">AI 智能管理</div>' : '') +
            '<div class="dropdown-divider"></div>' +
            '<div class="dropdown-item logout" data-act="logout">退出登录</div>' +
          '</div>' +
        '</div>' +
      '</div></div>';

    var trigger = document.getElementById('dpaUserTrigger');
    var dropdown = document.getElementById('dpaUserDropdown');
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = dropdown.classList.toggle('show');
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function () {
      dropdown.classList.remove('show');
      trigger.setAttribute('aria-expanded', 'false');
    });
    dropdown.addEventListener('click', function (e) {
      var item = e.target.closest('.dropdown-item');
      if (!item) return;
      if (item.dataset.act === 'logout') { global.DPA.auth.logout(); return; }
      if (item.dataset.href) location.href = item.dataset.href;
    });
  }

  /** 渲染底部导航到 #dpaBottomNav */
  function renderBottomNav(active) {
    var host = document.getElementById('dpaBottomNav');
    if (!host) return;
    host.className = 'bottom-nav';
    host.innerHTML = BOTTOM_ITEMS.map(function (it) {
      return '<a href="' + it.href + '" class="bottom-nav-item' + (it.key === active ? ' active' : '') + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + it.icon + '</svg>' +
        '<span>' + it.text + '</span></a>';
    }).join('');
  }

  /* ============ 状态占位 ============ */

  /** 生成空状态占位 HTML（可带图标/标题/说明/操作按钮） */
  function emptyState(opts) {
    opts = opts || {};
    return '<div class="empty-state">' +
      '<svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
      (opts.icon || '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>') +
      '</svg>' +
      '<div class="empty-state-title">' + escapeHtml(opts.title || '暂无数据') + '</div>' +
      '<div class="empty-state-desc">' + escapeHtml(opts.desc || '') + '</div>' +
      (opts.action ? '<button class="btn btn-primary mt-md" data-act="empty-action">' + escapeHtml(opts.action) + '</button>' : '') +
      '</div>';
  }

  /** 生成加载占位 HTML（转圈 + 提示文字） */
  function loading(text) {
    return '<div class="loading"><div class="loading-spinner"></div><div class="loading-text">' + escapeHtml(text || '加载中...') + '</div></div>';
  }

  /** 生成骨架屏列表 HTML（n 张卡片，默认 3） */
  function skeletonList(n) {
    var one = '<div class="skeleton-card"><div class="skeleton-block" style="width:100px;height:80px"></div>' +
      '<div style="flex:1"><div class="skeleton-line" style="width:80%"></div>' +
      '<div class="skeleton-line" style="width:50%"></div></div></div>';
    return new Array(n || 3).fill(one).join('');
  }

  /* ============ 表单校验 ============ */

  var validators = {
    /** 必填校验 */
    required: function (v) { return !!String(v || '').trim() || '此项为必填'; },
    /** 用户名校验（长度 + 只允许中英文/数字/下划线） */
    username: function (v) {
      v = String(v || '').trim();
      if (!v) return '请输入用户名';
      if (v.length < 3) return '用户名长度不能少于 3 位';
      if (!/^[A-Za-z0-9_\u4e00-\u9fa5]+$/.test(v)) return '用户名仅支持中英文、数字和下划线';
      return true;
    },
    /** 密码校验（至少 6 位） */
    password: function (v) {
      if (!v) return '请输入密码';
      if (String(v).length < 6) return '密码长度不能少于 6 位';
      return true;
    },
    /** 手机号校验（未填视为通过） */
    phone: function (v) {
      if (!v) return true;
      return /^1[3-9]\d{9}$/.test(v) || '请输入正确的手机号';
    },
    /** 数值范围校验（高阶函数，返回一个校验器） */
    range: function (min, max, label) {
      return function (v) {
        if (v === '' || v === null || v === undefined) return true;
        var n = Number(v);
        if (isNaN(n)) return (label || '数值') + '格式不正确';
        if (n < min || n > max) return (label || '数值') + '应在 ' + min + '~' + max + ' 之间';
        return true;
      };
    }
  };

  /**
   * 校验表单
   * @param {Object} rules { fieldId: [validatorFn, ...] }
   * @returns {boolean}
   */
  function validate(rules) {
    var ok = true;
    Object.keys(rules).forEach(function (id) {
      var input = document.getElementById(id);
      if (!input) return;
      var errEl = document.getElementById(id + 'Error');
      var value = input.value;
      var msg = '';
      for (var i = 0; i < rules[id].length; i++) {
        var r = rules[id][i](value);
        if (r !== true) { msg = r; break; }
      }
      if (msg) {
        ok = false;
        input.classList.add('error');
        if (errEl) { errEl.textContent = msg; errEl.classList.add('show'); }
      } else {
        input.classList.remove('error');
        if (errEl) { errEl.textContent = ''; errEl.classList.remove('show'); }
      }
    });
    return ok;
  }

  /* ============ 杂项 ============ */

  /** 防抖：wait ms 内的连续调用只执行最后一次（默认 300ms） */
  function debounce(fn, wait) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, wait || 300);
    };
  }

  /** 自动滚动到底部 */
  function scrollToBottom(el) {
    if (el) el.scrollTop = el.scrollHeight;
  }

  /**
   * 解析 URL 参数。
   * 对参数名做正则转义（否则形如 a.b 的名字会变成通配），
   * 并兜住 decodeURIComponent 对畸形序列（如 ?id=%）抛出的 URIError。
   */
  function query(name) {
    var safe = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var m = new RegExp('[?&]' + safe + '=([^&#]*)').exec(location.search);
    if (!m) return null;
    try {
      return decodeURIComponent(m[1]);
    } catch (e) {
      return m[1];
    }
  }

  /* ============ 跳转安全 ============ */

  /** 站内页面白名单（用于 redirect 参数校验） */
  var ALLOWED_PAGES = [
    'index.html', 'home.html', 'article.html', 'diabetes.html', 'doctor.html',
    'risk-prediction.html', 'life-plan.html', 'checkin.html', 'health-news.html',
    'assistant.html', 'personal.html', 'admin.html', 'help.html'
  ];

  /**
   * 校验跳转目标，阻断开放重定向（Open Redirect）。
   * 只允许站内白名单页面 + 查询串，拒绝协议、协议相对、反斜杠与目录穿越。
   * @param {string} target   来自 URL 的 redirect 参数
   * @param {string} fallback 校验失败时的兜底页面
   */
  function safeRedirect(target, fallback) {
    var dft = fallback || 'home.html';
    if (!target) return dft;
    var t = String(target).trim();
    if (!t) return dft;
    if (t.indexOf('\\') >= 0) return dft;                       // 反斜杠（部分浏览器视为 /）
    if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return dft;             // 含协议，如 https:
    if (t.indexOf('//') === 0) return dft;                      // 协议相对地址
    if (t.indexOf('..') >= 0) return dft;                       // 目录穿越
    var path = t.split('#')[0].split('?')[0];
    if (ALLOWED_PAGES.indexOf(path) < 0) return dft;
    return t;
  }

  /**
   * 读取 CSS 设计令牌，避免在 JS 中硬编码主题色。
   * @param {string} name CSS 变量名，如 '--risk-high'
   */
  function themeVar(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name);
      v = (v || '').trim();
      return v || fallback;
    } catch (e) {
      return fallback;
    }
  }

  /** 统一的"AI 降级"提示 */
  function notifyFallback() {
    toast('当前为离线演示模式，已使用本地智能引擎生成结果', 'info', 2600);
  }

  global.DPA = global.DPA || {};
  global.DPA.ui = {
    escapeHtml: escapeHtml,
    escapeAttr: escapeAttr,
    formatDate: formatDate,
    formatTime: formatTime,
    toDateKey: toDateKey,
    relativeTime: relativeTime,
    formatNumber: formatNumber,
    renderMarkdown: renderMarkdown,
    toast: toast,
    modal: modal,
    confirm: confirm,
    renderNavbar: renderNavbar,
    renderBottomNav: renderBottomNav,
    emptyState: emptyState,
    loading: loading,
    skeletonList: skeletonList,
    validators: validators,
    validate: validate,
    debounce: debounce,
    scrollToBottom: scrollToBottom,
    query: query,
    safeRedirect: safeRedirect,
    themeVar: themeVar,
    ALLOWED_PAGES: ALLOWED_PAGES,
    notifyFallback: notifyFallback
  };
})(window);
