/**
 * pages/checkin.js — 打卡记录与打卡分析（对应课程任务 8-1 ~ 8-3）
 * 分析流程：本地/云端计算三维指标（完成率·连续天数·类型均衡度）→ 评级 → 建议
 */
(function () {
  'use strict';

  if (!DPA.auth.requireAuth()) return;

  var ui = DPA.ui;
  var store = DPA.store;
  var api = DPA.api;

  ui.renderNavbar('');
  ui.renderBottomNav('personal');

  var DAYS = 7;
  var WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];
  // 统一本地日期键来源（与 store.punch 写入口径一致）
  var TODAY = store.dateKey(new Date());

  /* ---------- 近 7 日网格 ---------- */
  function renderWeek() {
    var recent = store.punch.recentDays(DAYS);
    var total = store.plans.all().length || 1;

    document.getElementById('weekGrid').innerHTML = recent.map(function (d) {
      var count = d.items.filter(function (p) { return p.completion_status === '已完成'; }).length;
      var cls = count === 0 ? '' : (count >= total ? ' full' : ' some');
      var dateObj = new Date(d.date);
      var label = (d.date === TODAY ? '今天' : '周' + WEEK_CN[dateObj.getDay()]);
      return '<div class="checkin-day' + (d.date === TODAY ? ' today' : '') + '">' +
        '<div class="checkin-day-label">' + label + '</div>' +
        '<div class="checkin-day-ring ' + cls.trim() + '">' + count + '</div>' +
        '<div class="checkin-day-count">' + d.date.slice(5).replace('-', '/') + '</div>' +
      '</div>';
    }).join('');
  }

  /* ---------- 智能分析 ---------- */
  /** 进度条宽度做 0–100 夹取，防止异常数据把条撑出容器 */
  function barWidth(v) {
    var n = Number(v);
    if (!isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function renderAnalysis(res) {
    var area = document.getElementById('analysisArea');
    if (!store.plans.all().length) {
      area.innerHTML = ui.emptyState({
        title: '还没有生活方案',
        desc: '先到「生活方案」页面生成方案，完成打卡后即可查看分析',
        action: '去生成方案'
      });
      area.querySelector('[data-act="empty-action"]').addEventListener('click', function () { location.href = 'life-plan.html'; });
      return;
    }

    var levelCls = res.evaluation === '优秀' ? 'low' : (res.evaluation === '良好' ? 'mid' : 'high');
    var suggestions = (res.suggestions || []).map(function (s, i) {
      return '<div class="risk-advice-item"><span class="risk-advice-num">' + (i + 1) + '</span><span>' + ui.escapeHtml(s) + '</span></div>';
    }).join('');
    var dietW = barWidth(res.dietRate);
    var exW = barWidth(res.exerciseRate);

    area.innerHTML =
      '<div class="analysis-card">' +
        '<div class="text-center mb-md">' +
          '<span class="risk-level ' + levelCls + '">' + ui.escapeHtml(res.evaluation) + '</span>' +
          '<p class="text-sm text-muted mt-sm">' + ui.escapeHtml(res.completionStatus) + '</p>' +
        '</div>' +
        '<div class="analysis-metrics">' +
          metric(res.rate + '%', '完成率') +
          metric(res.streak + ' 天', '连续打卡') +
          metric(res.balance + '%', '类型均衡度') +
        '</div>' +
        '<div class="bar-row"><span class="bar-label">饮食执行</span><div class="bar-track"><div class="bar-fill" style="width:' + dietW + '%"></div></div><span class="bar-value">' + dietW + '%</span></div>' +
        '<div class="bar-row"><span class="bar-label">运动执行</span><div class="bar-track"><div class="bar-fill" style="width:' + exW + '%"></div></div><span class="bar-value">' + exW + '%</span></div>' +
      '</div>' +
      '<div class="analysis-card">' +
        '<h3 class="risk-section-title">改进建议</h3>' +
        (suggestions || '<p class="text-muted text-sm">暂无建议</p>') +
      '</div>';
  }

  function metric(v, l) {
    return '<div class="analysis-metric"><div class="analysis-metric-value">' + ui.escapeHtml(String(v)) + '</div><div class="analysis-metric-label">' + ui.escapeHtml(String(l)) + '</div></div>';
  }

  function analyze() {
    var area = document.getElementById('analysisArea');
    area.innerHTML = ui.loading('正在分析近 7 天打卡数据...');
    var plans = store.plans.all();
    var punches = store.punch.all();
    // 显式传入锚点日期：保证分析窗口与页面「今天」是同一个日期口径
    var payload = { planList: plans, punchList: punches, days: DAYS, anchorDate: TODAY };
    return api.analyzeCheckin(payload)
      .then(function (res) { renderAnalysis(res); return res; })
      .catch(function () { renderAnalysis(DPA.mock.analyzeCheckin(plans, punches, DAYS, TODAY)); });
  }

  /* ---------- 打卡明细 ---------- */
  function renderDetail() {
    var list = store.punch.all().slice().reverse();
    var host = document.getElementById('detailList');
    if (!list.length) {
      host.innerHTML = ui.emptyState({ title: '暂无打卡记录', desc: '完成生活方案中的项目即可打卡' });
      return;
    }
    host.innerHTML = list.slice(0, 30).map(function (p) {
      var done = p.completion_status === '已完成';
      return '<div class="list-item">' +
        '<div class="menu-icon ' + (p.punch_type === '饮食' ? 'green' : p.punch_type === '运动' ? 'blue' : 'orange') + '" style="width:36px;height:36px">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>' +
        '</div>' +
        '<div class="list-item-content">' +
          '<div class="list-item-title">' + ui.escapeHtml(p.message || p.punch_type) + '</div>' +
          '<div class="list-item-desc">' + ui.escapeHtml(p.punch_type) + ' · ' + ui.relativeTime(p.punch_time) + '</div>' +
        '</div>' +
        '<span class="tag ' + (done ? 'tag-secondary' : 'tag-error') + '">' + ui.escapeHtml(p.completion_status) + '</span>' +
      '</div>';
    }).join('');
  }

  /* ---------- 事件 ---------- */
  document.getElementById('gotoPlan').addEventListener('click', function () { location.href = 'life-plan.html'; });
  document.getElementById('refreshAnalysis').addEventListener('click', function () {
    analyze().then(function () { ui.toast('分析已更新'); });
  });

  /* ---------- 初始化 ---------- */
  renderWeek();
  renderDetail();
  analyze();
})();
