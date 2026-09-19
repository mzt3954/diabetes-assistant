/**
 * pages/lifeplan.js — 生活方案
 * =============================
 * 功能：生活方案的展示、标签筛选、按天打卡、一键生成与定制生成。
 * 交互模块：DPA.ui(渲染/空状态/提示/弹窗)、DPA.store(方案/打卡/风险数据)、
 *          DPA.api.generateLifePlan(云端生成，失败降级本地)。
 */
// IIFE 隔离作用域；未登录先跳登录页。
(function () {
  'use strict';

  if (!DPA.auth.requireAuth()) return;

  var ui = DPA.ui;
  var store = DPA.store;
  var api = DPA.api;

  ui.renderNavbar('');
  ui.renderBottomNav('personal');

  var emptyArea = document.getElementById('emptyArea');
  var planArea = document.getElementById('planArea');
  var planList = document.getElementById('planList');
  var currentType = '饮食';

  // 统一的本地日期键来源，避免各页面各写一份
  var TODAY = store.dateKey(new Date());

  /* ---------- 渲染 ---------- */
  /**
   * 渲染方案区整体状态：无方案时展示空状态与生成引导，否则展示统计并渲染列表。
   * @returns {void} 无返回值
   */
  function render() {
    var list = store.plans.all();
    if (!list.length) {
      emptyArea.classList.remove('hidden');
      planArea.classList.add('hidden');
      emptyArea.innerHTML = ui.emptyState({
        icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
        title: '还没有生活方案',
        desc: '根据您的健康信息生成一份专属的饮食与运动方案',
        action: '一键生成方案'
      });
      emptyArea.querySelector('[data-act="empty-action"]').addEventListener('click', function () { generate(true); });
      return;
    }

    emptyArea.classList.add('hidden');
    planArea.classList.remove('hidden');

    // 统计
    var doneToday = store.punch.byDate(TODAY).filter(function (p) { return p.completion_status === '已完成'; }).length;
    var diet = list.filter(function (p) { return p.type === '饮食'; });
    var ex = list.filter(function (p) { return p.type === '运动'; });
    var other = list.filter(function (p) { return p.type === '其他'; });

    document.getElementById('planStats').innerHTML =
      stat(list.length, '方案总数') + stat(doneToday, '今日已打卡') +
      stat(Math.round(list.length ? doneToday / list.length * 100 : 0) + '%', '今日完成率');

    document.getElementById('countDiet').textContent = diet.length;
    document.getElementById('countExercise').textContent = ex.length;
    document.getElementById('countOther').textContent = other.length;

    renderList();
  }

  /** 生成单个统计块 HTML（数值 + 标签） */
  function stat(v, l) {
    return '<div class="plan-stat"><div class="plan-stat-value">' + v + '</div><div class="plan-stat-label">' + l + '</div></div>';
  }

  /**
   * 按当前类型筛选并渲染方案列表，为每个方案的打卡按钮绑定点击。
   * @returns {void} 无返回值
   * 用途：读取当天打卡状态映射，渲染方案项并支持点击打卡/取消打卡。
   */
  function renderList() {
    var list = store.plans.byType(currentType).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    if (!list.length) {
      planList.innerHTML = ui.emptyState({ title: '暂无' + currentType + '方案' });
      return;
    }
    // 一次性取出当天全部打卡状态，避免渲染时逐项查询
    var statusOf = store.punch.statusMap(TODAY);

    planList.innerHTML = list.map(function (p) {
      var done = statusOf[p.id] === '已完成';
      return '<div class="plan-item' + (done ? ' done' : '') + '" data-id="' + p.id + '">' +
        '<button class="plan-check' + (done ? ' checked' : '') + '" aria-label="打卡" aria-pressed="' + done + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' +
        '</button>' +
        '<div class="plan-body">' +
          '<div class="plan-time">' + ui.escapeHtml(p.time) + '</div>' +
          '<div class="plan-title">' + ui.escapeHtml(p.title) + '</div>' +
          '<div class="plan-content">' + ui.escapeHtml(p.content) + '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    planList.querySelectorAll('.plan-check').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var item = btn.closest('.plan-item');
        if (!item) return;
        var id = Number(item.dataset.id);
        var plan = store.plans.all().filter(function (p) { return p.id === id; })[0];
        if (!plan) { ui.toast('方案不存在，请刷新后重试', 'error'); return; }
        var done = store.punch.toggle(TODAY, id, plan.type, plan.title);
        btn.classList.toggle('checked', done);
        btn.setAttribute('aria-pressed', done ? 'true' : 'false');
        item.classList.toggle('done', done);
        ui.toast(done ? '打卡成功' : '已取消打卡');
        render();
      });
    });
  }

  /* ---------- 标签切换 ---------- */
  // 方案类型标签切换：更新当前类型并重渲染列表
  document.getElementById('planTabs').addEventListener('click', function (e) {
    var tab = e.target.closest('.plan-tab');
    if (!tab) return;
    currentType = tab.dataset.type;
    document.querySelectorAll('.plan-tab').forEach(function (t) { t.classList.toggle('active', t === tab); });
    renderList();
  });

  /* ---------- 生成 / 定制方案 ---------- */
  /**
   * 生成生活方案（一键或定制）。
   * @param {boolean} silent 为 true 时不弹出「方案已生成」提示（首次自动生成）
   * @returns {Promise} 解析为接口返回结果
   * 用途：结合风险等级与定制输入调用 api.generateLifePlan，成功后保存并重渲染。
   */
  function generate(silent) {
    var risk = store.risk.latest();
    var userInfo = { riskLevel: risk ? risk.level : '', disease: risk ? risk.disease : '' };
    var lifeState = document.getElementById('lifeState') ? document.getElementById('lifeState').value : '';
    var advice = document.getElementById('userAdvice') ? document.getElementById('userAdvice').value : '';

    return api.generateLifePlan({ userInfo: userInfo, lifeState: lifeState, advice: advice }).then(function (res) {
      var plans = (res && res.plans) || [];
      store.plans.save(plans);
      render();
      if (!silent) ui.toast('方案已生成');
      return res;
    });
  }

  // 定制方案弹层的开关控制（Modal 打开/关闭按钮及点击遮罩关闭）
  var modal = document.getElementById('customizeModal');
  var prevOverflow = '';
  /** 打开定制方案弹层：记录 body 原 overflow 并禁用背景滚动 */
  function openModal() {
    prevOverflow = document.body.style.overflow;
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
  /** 关闭定制方案弹层：移除 active 并还原 body overflow */
  function closeModal() {
    modal.classList.remove('active');
    document.body.style.overflow = prevOverflow;
  }

  document.getElementById('customizeBtn').addEventListener('click', openModal);
  document.getElementById('closeCustomize').addEventListener('click', closeModal);
  document.getElementById('cancelCustomize').addEventListener('click', closeModal);
  modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });

  // 提交定制方案：进入生成中状态，调用 generate 成功后关闭弹层
  document.getElementById('submitCustomize').addEventListener('click', function () {
    var btn = this;
    var label = btn.querySelector('.btn-text');
    var spinner = btn.querySelector('.loading-spinner');
    btn.disabled = true;
    label.textContent = '生成中...';
    spinner.classList.remove('hidden');

    generate(false).then(function () {
      btn.disabled = false;
      label.textContent = '生成方案';
      spinner.classList.add('hidden');
      closeModal();
    }).catch(function (err) {
      btn.disabled = false;
      label.textContent = '生成方案';
      spinner.classList.add('hidden');
      ui.toast('生成失败：' + (err.message || '请重试'), 'error');
    });
  });

  // 查看打卡记录：跳转到打卡分析页
  document.getElementById('checkinBtn').addEventListener('click', function () { location.href = 'checkin.html'; });

  /* ---------- 初始化 ---------- */
  // 首次进入且无方案时自动生成基础方案，否则直接渲染
  if (!store.plans.all().length) {
    // 首次进入自动生成一份基础方案
    generate(true).catch(function () { render(); });
  } else {
    render();
  }
})();
