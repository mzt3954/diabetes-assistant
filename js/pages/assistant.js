/**
 * pages/assistant.js — AI 智能助手（SSE 流式输出）
 * 对应课程任务 9-1 ~ 9-3：实现聊天 + 流式显示 + 多轮上下文
 */
(function () {
  'use strict';

  if (!DPA.auth.requireAuth()) return;

  var ui = DPA.ui;
  var store = DPA.store;
  var api = DPA.api;

  ui.renderNavbar('assistant');
  ui.renderBottomNav('assistant');

  var APP_ID = 'aiAssistant';
  var QUICK = ['2型糖尿病应该怎么吃？', '帮我制定一份生活方案', '如何查看我的打卡分析？', '糖尿病有哪些并发症？'];

  var introView = document.getElementById('introView');
  var chatView = document.getElementById('chatView');
  var messagesEl = document.getElementById('chatMessages');
  var inputEl = document.getElementById('chatInput');
  var sendBtn = document.getElementById('chatSend');

  var streaming = false;
  var controller = null;

  /* ---------- 渲染 ---------- */
  function msgHtml(role, content, time) {
    var isUser = role === 'user';
    return '<div class="chat-msg ' + (isUser ? 'user' : 'bot') + '">' +
      '<div class="chat-avatar"' + (isUser ? '' : ' style="background:linear-gradient(135deg,#2196F3,#4CAF50)"') + '>' +
        (isUser ? ui.escapeHtml((DPA.auth.username() || 'U').charAt(0).toUpperCase()) : 'AI') + '</div>' +
      '<div><div class="chat-bubble">' + ui.renderMarkdown(content) + '</div>' +
      (time ? '<div class="chat-time">' + ui.formatTime(time) + '</div>' : '') + '</div></div>';
  }

  function append(role, content, time) {
    messagesEl.insertAdjacentHTML('beforeend', msgHtml(role, content, time));
    ui.scrollToBottom(messagesEl);
  }

  function renderHistory() {
    var history = store.chat.all(APP_ID);
    if (!history.length) {
      messagesEl.innerHTML = msgHtml('bot', '您好，我是糖尿病智能助手 👋\n\n我可以帮您：\n- 解答糖尿病相关问题\n- 制定与调整生活方案\n- 管理个人健康信息\n- 解读打卡分析\n\n请直接提问，或点击下方快捷问题试试。');
      return;
    }
    messagesEl.innerHTML = history.map(function (m) { return msgHtml(m.role, m.content, m.time); }).join('');
    ui.scrollToBottom(messagesEl);
  }

  function renderQuick() {
    var host = document.getElementById('chatQuick');
    host.innerHTML = QUICK.map(function (q) { return '<button type="button">' + ui.escapeHtml(q) + '</button>'; }).join('');
    host.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { send(b.textContent); });
    });
  }

  /* ---------- 视图切换 ---------- */
  function openChat() {
    introView.classList.add('hidden');
    chatView.classList.remove('hidden');
    document.getElementById('dpaBottomNav').classList.add('hidden');
    renderHistory();
    renderQuick();
    inputEl.focus();
  }
  function closeChat() {
    if (controller) { controller.abort(); controller = null; }
    streaming = false;
    setSending(false);
    chatView.classList.add('hidden');
    introView.classList.remove('hidden');
    document.getElementById('dpaBottomNav').classList.remove('hidden');
  }

  /* ---------- 发送 ---------- */
  function setSending(on) { sendBtn.disabled = on; inputEl.disabled = on; }

  function send(text) {
    text = (text || inputEl.value).trim();
    if (!text || streaming) return;

    inputEl.value = '';
    inputEl.style.height = 'auto';
    append('user', text, new Date().toISOString());
    store.chat.push(APP_ID, { role: 'user', content: text });

    streaming = true;
    setSending(true);

    var bubbleId = 'stream-' + Date.now();
    messagesEl.insertAdjacentHTML('beforeend',
      '<div class="chat-msg bot" id="' + bubbleId + '">' +
        '<div class="chat-avatar" style="background:linear-gradient(135deg,#2196F3,#4CAF50)">AI</div>' +
        '<div><div class="chat-bubble"><span class="typing"><span></span><span></span><span></span></span></div></div>' +
      '</div>');
    ui.scrollToBottom(messagesEl);

    var bubble = document.querySelector('#' + bubbleId + ' .chat-bubble');
    var full = '';
    var first = true;
    controller = new AbortController();

    api.assistantChat(text, {
      conversationId: store.chat.conversationId(APP_ID),
      signal: controller.signal,
      onDelta: function (delta) {
        if (first) { bubble.innerHTML = ''; first = false; }
        full += delta;
        bubble.innerHTML = ui.renderMarkdown(full);
        ui.scrollToBottom(messagesEl);
      },
      onDone: function (finalText, convId) {
        if (first) bubble.innerHTML = ui.renderMarkdown(full || finalText);
        if (convId) store.chat.setConversationId(APP_ID, convId);
        store.chat.push(APP_ID, { role: 'bot', content: full || finalText });
        finish();
      }
    }).catch(function (err) {
      // 已流式输出的内容保留，只在末尾追加中断提示
      var note = '<div class="text-error text-sm">（回复中断：' + ui.escapeHtml(err.message || '网络异常') + '）</div>';
      if (bubble) bubble.innerHTML = (full ? ui.renderMarkdown(full) : '') + note;
      if (full) store.chat.push(APP_ID, { role: 'bot', content: full });
      finish();
    });

    function finish() {
      streaming = false;
      controller = null;
      setSending(false);
      inputEl.focus();
    }
  }

  /* ---------- 事件 ---------- */
  document.getElementById('startChat').addEventListener('click', openChat);
  document.getElementById('backToIntro').addEventListener('click', closeChat);

  document.getElementById('clearChat').addEventListener('click', function () {
    ui.confirm({ title: '清空会话', message: '确定要清空全部聊天记录吗？', danger: true }).then(function (ok) {
      if (!ok) return;
      store.chat.clear(APP_ID);
      store.chat.setConversationId(APP_ID, '');
      renderHistory();
      ui.toast('会话已清空');
    });
  });

  sendBtn.addEventListener('click', function () { send(); });

  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  inputEl.addEventListener('input', function () {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 110) + 'px';
  });

  /* ---------- 初始化：带参直接进聊天 ---------- */
  if (ui.query('chat') === '1') openChat();
})();
