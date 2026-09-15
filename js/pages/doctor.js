/**
 * pages/doctor.js — 医师咨询
 * 接入 Dify Chatflow（CHAT-1），未配置时走本地医师知识库，均支持流式输出。
 */
(function () {
  'use strict';

  if (!DPA.auth.requireAuth()) return;

  var ui = DPA.ui;
  var store = DPA.store;
  var api = DPA.api;

  ui.renderNavbar('doctor');
  ui.renderBottomNav('');

  var APP_ID = 'doctorChat';
  var QUICK_QUESTIONS = ['1型糖尿病和2型糖尿病的区别', '糖尿病患者的饮食原则', '饭后运动要注意什么', '血糖监测频率怎么定'];

  var listView = document.getElementById('listView');
  var chatView = document.getElementById('chatView');
  var messagesEl = document.getElementById('chatMessages');
  var inputEl = document.getElementById('chatInput');
  var sendBtn = document.getElementById('chatSend');

  var currentDoctor = null;
  var streaming = false;
  var controller = null;

  /* ---------- 医生列表 ---------- */
  function renderDoctors() {
    var list = store.doctors.all();
    var host = document.getElementById('doctorList');
    host.innerHTML = list.map(function (d) {
      return '<article class="doctor-card" data-id="' + d.info_id + '">' +
        '<div class="doctor-avatar" style="background:' + ui.escapeAttr(d.color || '#2196F3') + '">' + ui.escapeHtml(d.avatar || d.doctor_name.charAt(0)) + '</div>' +
        '<div class="doctor-info">' +
          '<div class="doctor-name-row"><span class="doctor-name">' + ui.escapeHtml(d.doctor_name) + '</span>' +
          '<span class="tag tag-primary">' + ui.escapeHtml(d.title) + '</span></div>' +
          '<div class="doctor-dept">' + ui.escapeHtml(d.department) + '</div>' +
          '<div class="doctor-intro">' + ui.escapeHtml(d.introduction) + '</div>' +
        '</div>' +
        '<div class="doctor-status ' + (d.online ? 'online' : 'offline') + '"><span class="dot"></span>' + (d.online ? '在线' : '离线') + '</div>' +
      '</article>';
    }).join('');

    host.querySelectorAll('.doctor-card').forEach(function (card) {
      card.addEventListener('click', function () { openChat(Number(card.dataset.id)); });
    });
  }

  /* ---------- 消息渲染 ---------- */
  function msgHtml(role, content, time) {
    var isUser = role === 'user';
    return '<div class="chat-msg ' + (isUser ? 'user' : 'bot') + '">' +
      '<div class="chat-avatar">' + (isUser ? ui.escapeHtml((DPA.auth.username() || 'U').charAt(0).toUpperCase()) : '医') + '</div>' +
      '<div><div class="chat-bubble">' + ui.renderMarkdown(content) + '</div>' +
      (time ? '<div class="chat-time">' + ui.formatTime(time) + '</div>' : '') + '</div></div>';
  }

  function appendMessage(role, content, time) {
    messagesEl.insertAdjacentHTML('beforeend', msgHtml(role, content, time));
    ui.scrollToBottom(messagesEl);
  }

  function renderHistory() {
    var history = store.chat.all(APP_ID);
    if (!history.length) {
      messagesEl.innerHTML = msgHtml('bot', '您好，我是' + (currentDoctor ? currentDoctor.doctor_name : '在线医师') +
        '，很高兴为您服务。\n\n您可以咨询糖尿病相关的任何问题，例如分型区别、饮食运动、血糖监测等。');
      return;
    }
    messagesEl.innerHTML = history.map(function (m) { return msgHtml(m.role, m.content, m.time); }).join('');
    ui.scrollToBottom(messagesEl);
  }

  /* ---------- 打开 / 关闭聊天 ---------- */
  function openChat(id) {
    currentDoctor = store.doctors.get(id);
    if (!currentDoctor) return;

    document.getElementById('chatAvatar').textContent = currentDoctor.avatar || currentDoctor.doctor_name.charAt(0);
    document.getElementById('chatAvatar').style.background = currentDoctor.color || '#2196F3';
    document.getElementById('chatDoctorName').textContent = currentDoctor.doctor_name;
    document.getElementById('chatDoctorDept').textContent = currentDoctor.department + ' · ' + currentDoctor.title;

    listView.classList.add('hidden');
    chatView.classList.remove('hidden');
    document.getElementById('dpaBottomNav').classList.add('hidden');

    renderHistory();
    renderQuick();
  }

  function closeChat() {
    if (controller) { controller.abort(); controller = null; }
    streaming = false;
    setSending(false);
    chatView.classList.add('hidden');
    listView.classList.remove('hidden');
    document.getElementById('dpaBottomNav').classList.remove('hidden');
  }

  function renderQuick() {
    var host = document.getElementById('chatQuick');
    host.innerHTML = QUICK_QUESTIONS.map(function (q) {
      return '<button type="button">' + ui.escapeHtml(q) + '</button>';
    }).join('');
    host.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { send(b.textContent); });
    });
  }

  /* ---------- 发送消息（流式） ---------- */
  function setSending(on) {
    sendBtn.disabled = on;
    inputEl.disabled = on;
  }

  function send(text) {
    text = (text || inputEl.value).trim();
    if (!text || streaming) return;

    inputEl.value = '';
    inputEl.style.height = 'auto';
    appendMessage('user', text, new Date().toISOString());
    store.chat.push(APP_ID, { role: 'user', content: text });

    streaming = true;
    setSending(true);

    // 机器人气泡占位
    var bubbleId = 'stream-' + Date.now();
    messagesEl.insertAdjacentHTML('beforeend',
      '<div class="chat-msg bot" id="' + bubbleId + '">' +
        '<div class="chat-avatar">医</div>' +
        '<div><div class="chat-bubble"><span class="typing"><span></span><span></span><span></span></span></div></div>' +
      '</div>');
    ui.scrollToBottom(messagesEl);

    var bubble = document.querySelector('#' + bubbleId + ' .chat-bubble');
    var full = '';
    var firstChunk = true;
    controller = new AbortController();

    api.doctorChat(text, {
      doctor: currentDoctor,
      conversationId: store.chat.conversationId(APP_ID),
      signal: controller.signal,
      onDelta: function (delta) {
        if (firstChunk) { bubble.innerHTML = ''; firstChunk = false; }
        full += delta;
        bubble.innerHTML = ui.renderMarkdown(full);
        ui.scrollToBottom(messagesEl);
      },
      onDone: function (finalText, convId) {
        if (firstChunk) bubble.innerHTML = ui.renderMarkdown(full || finalText);
        if (convId) store.chat.setConversationId(APP_ID, convId);
        store.chat.push(APP_ID, { role: 'bot', content: full || finalText });
        finish();
      }
    }).catch(function (err) {
      // 已流式输出的内容保留，只在末尾追加中断提示；
      // 直接覆盖整个气泡会把用户已经读到的内容清掉。
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

  /* ---------- 事件绑定 ---------- */
  document.getElementById('backToList').addEventListener('click', closeChat);

  document.getElementById('clearChat').addEventListener('click', function () {
    ui.confirm({ title: '清空会话', message: '确定要清空与当前医师的聊天记录吗？', danger: true }).then(function (ok) {
      if (!ok) return;
      store.chat.clear(APP_ID);
      store.chat.setConversationId(APP_ID, '');
      renderHistory();
      ui.toast('会话已清空');
    });
  });

  sendBtn.addEventListener('click', function () { send(); });

  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  inputEl.addEventListener('input', function () {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 110) + 'px';
  });

  /* ---------- 初始化 ---------- */
  renderDoctors();
  var preId = Number(ui.query('doctor'));
  if (preId) openChat(preId);
})();
