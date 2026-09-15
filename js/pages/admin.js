/**
 * pages/admin.js — AI 智能管理（管理员）
 * 对应课程任务 10-1 ~ 10-3：通过自然语言指令管理平台数据
 */
(function () {
  'use strict';

  if (!DPA.auth.requireAdmin()) return;

  var ui = DPA.ui;
  var store = DPA.store;
  var api = DPA.api;

  ui.renderNavbar('');
  ui.renderBottomNav('personal');

  var QUICK = ['统计系统数据', '查看用户列表', '查看文章列表', '新增一篇文章', '导出数据'];
  var currentTable = 'users';
  // 设计令牌统一取自 CSS，避免在 JS 中硬编码主题色
  var AGENT_COLOR = ui.themeVar('--agent-color', '#7C3AED');

  /* ---------- 数据总览 ---------- */
  function renderStats() {
    var s = store.stats();
    document.getElementById('adminStats').innerHTML =
      card(s.users, '注册用户') + card(s.articles, '科普文章') +
      card(s.plans, '生活方案') + card(s.punch, '打卡记录') +
      card(s.riskRecords, '风险记录') + card(s.collections, '收藏记录');
  }
  function card(v, l) {
    return '<div class="admin-stat"><div class="admin-stat-value">' + v + '</div><div class="admin-stat-label">' + l + '</div></div>';
  }

  /* ---------- 数据表 ---------- */
  function renderTable() {
    var host = document.getElementById('tableArea');
    var rows = [];
    var headers = [];

    switch (currentTable) {
      case 'users':
        headers = ['用户名', '角色', '手机号', '年龄'];
        rows = store.users.all().map(function (u) {
          return [u.username, u.role === 'admin' ? '管理员' : '普通用户', u.phone || '-', u.age || '-'];
        });
        break;
      case 'articles':
        headers = ['标题', '分类', '作者', '阅读量'];
        rows = store.articles.all().map(function (a) {
          return [a.title, a.category || '-', a.author, String(a.views || 0)];
        });
        break;
      case 'plans':
        headers = ['时间', '类型', '标题'];
        rows = store.plans.all().map(function (p) { return [p.time, p.type, p.title]; });
        break;
      case 'punch':
        headers = ['时间', '类型', '状态'];
        rows = store.punch.all().slice().reverse().map(function (p) {
          return [ui.relativeTime(p.punch_time), p.punch_type, p.completion_status];
        });
        break;
      case 'risk':
        headers = ['时间', '年龄', '风险等级'];
        rows = store.risk.history().slice().reverse().map(function (r) {
          return [ui.formatDate(r.create_time), String(r.age || '-'), r.level || '-'];
        });
        break;
    }

    if (!rows.length) {
      host.innerHTML = ui.emptyState({ title: '暂无数据' });
      return;
    }
    host.innerHTML =
      '<div class="list-item" style="background:var(--bg-gray);font-weight:600;font-size:13px">' +
        headers.map(function (h) { return '<div class="list-item-content">' + ui.escapeHtml(h) + '</div>'; }).join('') +
      '</div>' +
      rows.slice(0, 40).map(function (r) {
        return '<div class="list-item">' +
          r.map(function (c) { return '<div class="list-item-content truncate" style="font-size:13px">' + ui.escapeHtml(c) + '</div>'; }).join('') +
        '</div>';
      }).join('');
  }

  document.getElementById('tableTabs').addEventListener('click', function (e) {
    var chip = e.target.closest('.filter-chip');
    if (!chip) return;
    currentTable = chip.dataset.table;
    document.querySelectorAll('#tableTabs .filter-chip').forEach(function (c) { c.classList.toggle('active', c === chip); });
    renderTable();
  });

  /* ---------- 管理助手对话 ---------- */
  var messagesEl = document.getElementById('adminMessages');
  var inputEl = document.getElementById('adminInput');
  var sendBtn = document.getElementById('adminSend');
  var busy = false;

  function bubble(role, content) {
    var isUser = role === 'user';
    messagesEl.insertAdjacentHTML('beforeend',
      '<div class="chat-msg ' + (isUser ? 'user' : 'bot') + '" style="max-width:90%">' +
        '<div class="chat-avatar"' + (isUser ? '' : ' style="background:' + AGENT_COLOR + '"') + '>' + (isUser ? '管' : 'AI') + '</div>' +
        '<div><div class="chat-bubble">' + ui.renderMarkdown(content) + '</div></div>' +
      '</div>');
    ui.scrollToBottom(messagesEl);
  }

  function renderQuick() {
    var host = document.getElementById('adminQuick');
    host.innerHTML = QUICK.map(function (q) { return '<button type="button">' + ui.escapeHtml(q) + '</button>'; }).join('');
    host.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { send(b.textContent); });
    });
  }

  function refreshAll() { renderStats(); renderTable(); }

  /** 破坏性操作二次确认：本地引擎只解析出待删 ID，真正删除必须经用户确认 */
  function confirmDelete(ids) {
    return ui.confirm({
      title: '确认删除文章？',
      message: '将永久删除 ' + ids.length + ' 篇文章（ID：' + ids.join('、') + '），此操作不可撤销。',
      okText: '确认删除',
      danger: true
    }).then(function (ok) {
      if (!ok) { bubble('bot', '已取消删除。'); return null; }
      return api.adminDeleteArticles(ids).then(function (r) {
        bubble('bot', '已删除 ' + r.removed + ' 篇文章。');
        refreshAll();
        return r;
      });
    });
  }

  function send(text) {
    text = (text || inputEl.value).trim();
    if (!text || busy) return;
    inputEl.value = '';
    inputEl.style.height = 'auto';
    bubble('user', text);

    busy = true;
    sendBtn.disabled = true;
    messagesEl.insertAdjacentHTML('beforeend',
      '<div class="chat-msg bot" id="adminTyping" style="max-width:90%">' +
        '<div class="chat-avatar" style="background:' + AGENT_COLOR + '">AI</div>' +
        '<div><div class="chat-bubble"><span class="typing"><span></span><span></span><span></span></span></div></div></div>');
    ui.scrollToBottom(messagesEl);

    api.adminCommand(text).then(function (res) {
      var typing = document.getElementById('adminTyping');
      if (typing) typing.remove();
      bubble('bot', (res && res.reply) || '已处理您的请求。');
      if (res && res.refresh) refreshAll();
      if (res && res.action === 'delete_articles' && res.ids && res.ids.length) {
        return confirmDelete(res.ids);
      }
      return null;
    }).then(function () {
      busy = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }).catch(function (err) {
      var typing = document.getElementById('adminTyping');
      if (typing) typing.remove();
      bubble('bot', '执行失败：' + (err.message || '请重试'));
      busy = false;
      sendBtn.disabled = false;
    });
  }

  sendBtn.addEventListener('click', function () { send(); });
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  inputEl.addEventListener('input', function () {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 110) + 'px';
  });

  /* ---------- 导出数据 ---------- */
  document.getElementById('exportBtn').addEventListener('click', function () {
    ui.confirm({
      title: '导出数据快照',
      message: '将把用户、文章、方案、打卡与风险记录导出为 JSON 文件。其中包含健康相关信息，请妥善保管。',
      okText: '导出'
    }).then(function (ok) {
      if (!ok) return;
      var snapshot = {
        exportedAt: new Date().toISOString(),
        app: DPA_CONFIG.app.name,
        stats: store.stats(),
        users: store.users.all().map(function (u) { return { user_id: u.user_id, username: u.username, role: u.role }; }),
        articles: store.articles.all(),
        plans: store.plans.all(),
        punch: store.punch.all(),
        risk: store.risk.history()
      };
      var blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'dpa-data-' + ui.toDateKey(new Date()) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // 立即 revoke 会让部分浏览器（Firefox）下载失败，延后释放
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      ui.toast('数据已导出');
    });
  });

  /* ---------- 初始化 ---------- */
  renderStats();
  renderTable();
  renderQuick();
  bubble('bot', '您好，我是 **AI 管理助手** 🤖\n\n我可以通过自然语言帮您管理平台数据，支持：\n- "统计系统数据" / "数据总览"\n- "查看用户列表" / "查看文章列表"\n- "新增一篇文章"\n- "删除文章 3"\n- "导出数据"\n\n请告诉我您的需求。');
})();
