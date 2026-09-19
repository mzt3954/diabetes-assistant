/**
 * pages/diabetes.js — 糖尿病类型详情页
 * ======================================
 * 功能：按「1型/2型/妊娠型/特殊型」展示糖尿病的病因、临床表现、治疗
 *      原则与生活注意事项，顶部标签可切换类型。
 * 交互模块：DPA.ui(渲染/转义)、DPA.store.types(类型数据)，prefill 自 js/seed.js。
 * 数据来源：项目素材/知识库/*.docx（已提炼进 js/seed.js）。
 */
// IIFE 隔离作用域；未登录先跳登录页。用 URL 的 type 定位当前类型。
(function () {
  'use strict';

  if (!DPA.auth.requireAuth()) return;

  var ui = DPA.ui;
  var store = DPA.store;

  ui.renderNavbar('');
  ui.renderBottomNav('home');

  var all = store.types.all();
  var currentName = ui.query('type') || (all[0] && all[0].type_name);

  /* 类型切换 */
  // 类型切换标签区：点击切换当前类型、激活样式，并更新 URL 参数
  var switchHost = document.getElementById('typeSwitch');
  switchHost.innerHTML = all.map(function (t) {
    return '<button class="filter-chip' + (t.type_name === currentName ? ' active' : '') + '" data-name="' + ui.escapeAttr(t.type_name) + '">' + ui.escapeHtml(t.type_name) + '</button>';
  }).join('');
  switchHost.addEventListener('click', function (e) {
    var chip = e.target.closest('.filter-chip');
    if (!chip) return;
    currentName = chip.dataset.name;
    switchHost.querySelectorAll('.filter-chip').forEach(function (c) { c.classList.toggle('active', c === chip); });
    render();
    history.replaceState(null, '', 'diabetes.html?type=' + encodeURIComponent(currentName));
  });

  /**
   * 根据当前类型渲染类型详情内容（标题、摘要、四个内容块与免责声明）。
   * @returns {void} 无返回值
   * 用途：类型不存在时显示空状态；否则渲染病因、临床表现、治疗原则、
   *       生活注意事项列表，并更新页面标题。
   */
  function render() {
    var t = store.types.get(currentName);
    if (!t) {
      document.getElementById('typeName').textContent = '未找到该类型';
      document.getElementById('typeContent').innerHTML = ui.emptyState({ title: '类型不存在' });
      return;
    }

    var hero = document.getElementById('typeHero');
    hero.className = 'type-hero ' + (t.color || 'type2');
    document.title = t.type_name + ' - 糖尿病预治智能助手';
    document.getElementById('typeName').textContent = t.type_name;
    document.getElementById('typeSummary').textContent = t.summary || '';

    var notes = (t.life_notes || []).map(function (n) { return '<li>' + ui.escapeHtml(n) + '</li>'; }).join('');

    document.getElementById('typeContent').innerHTML =
      '<div class="type-block"><h3>病因与发病机制</h3><p>' + ui.escapeHtml(t.pathogenesis) + '</p></div>' +
      '<div class="type-block"><h3>临床表现</h3><p>' + ui.escapeHtml(t.manifestation) + '</p></div>' +
      '<div class="type-block"><h3>治疗原则</h3><p>' + ui.escapeHtml(t.treatment) + '</p></div>' +
      '<div class="type-block"><h3>生活注意事项</h3><ul>' + notes + '</ul></div>' +
      '<div class="disclaimer mb-lg">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>' +
        '<span>以上内容基于糖尿病防治指南与所提供的知识库素材整理，仅供健康科普参考，不能替代专业医疗诊断与治疗。请遵医嘱。</span>' +
      '</div>';
  }

  // 初始渲染当前类型详情
  render();
})();
