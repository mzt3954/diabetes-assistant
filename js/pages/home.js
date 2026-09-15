/**
 * pages/home.js — 系统首页
 */
(function () {
  'use strict';

  if (!DPA.auth.requireAuth()) return;

  var ui = DPA.ui;
  var store = DPA.store;
  var api = DPA.api;

  ui.renderNavbar('home');
  ui.renderBottomNav('home');

  /* ---------- 轮播图 ---------- */
  var current = 0;
  var total = 3;
  var slides = document.getElementById('bannerSlides');
  var dotsHost = document.getElementById('bannerDots');

  dotsHost.innerHTML = new Array(total).fill(0).map(function (_, i) {
    return '<button class="banner-dot' + (i === 0 ? ' active' : '') + '" data-index="' + i + '" aria-label="第 ' + (i + 1) + ' 张"></button>';
  }).join('');

  function goTo(i) {
    current = (i + total) % total;
    slides.style.transform = 'translateX(-' + current * 100 + '%)';
    dotsHost.querySelectorAll('.banner-dot').forEach(function (d, k) {
      d.classList.toggle('active', k === current);
    });
  }
  dotsHost.addEventListener('click', function (e) {
    var dot = e.target.closest('.banner-dot');
    if (dot) goTo(Number(dot.dataset.index));
  });
  var timer = setInterval(function () { goTo(current + 1); }, 4000);
  document.addEventListener('visibilitychange', function () {
    // 先清掉旧定时器，否则每次切回可见都会叠加一个 interval，轮播会越来越快
    clearInterval(timer);
    if (!document.hidden) timer = setInterval(function () { goTo(current + 1); }, 4000);
  });

  /* ---------- 快捷入口跳转 ---------- */
  document.querySelectorAll('.entry-item[data-href]').forEach(function (el) {
    el.addEventListener('click', function () { location.href = el.dataset.href; });
  });

  /* ---------- 文章列表 ---------- */
  function articleCard(a) {
    return '<div class="article-card" data-id="' + a.article_id + '">' +
      '<div class="article-cover">' + ui.escapeHtml(a.category || '科普') + '</div>' +
      '<div class="article-info">' +
        '<h3 class="article-title">' + ui.escapeHtml(a.title) + '</h3>' +
        '<div class="article-meta">' +
          '<span>' + ui.escapeHtml(a.author) + '</span>' +
          '<span>' + ui.escapeHtml(a.publish_time) + '</span>' +
          '<span class="article-views">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' +
            ui.formatNumber(a.views) +
          '</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function renderArticles(list) {
    var host = document.getElementById('articleList');
    // 防御：Dify/降级返回的任何非数组值都不应让页面崩掉
    list = Array.isArray(list) ? list : [];
    if (!list.length) {
      host.innerHTML = ui.emptyState({ title: '暂无科普文章', desc: '稍后再来看看吧' });
      return;
    }
    host.innerHTML = list.slice(0, 5).map(articleCard).join('');
    host.querySelectorAll('.article-card').forEach(function (card) {
      card.addEventListener('click', function () { location.href = 'article.html?id=' + card.dataset.id; });
    });
  }

  /* ---------- 糖尿病类型 ---------- */
  var TYPE_ICONS = {
    type1: '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    type2: '<circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/>',
    gestational: '<path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M12 6v6l4 2"/>',
    special: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'
  };

  function renderTypes(list) {
    var host = document.getElementById('typeList');
    list = Array.isArray(list) ? list : [];
    host.innerHTML = list.map(function (t) {
      var color = t.color || 'type2';
      return '<div class="type-card" data-name="' + ui.escapeAttr(t.type_name) + '">' +
        '<div class="type-icon ' + color + '">' +
          '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + (TYPE_ICONS[color] || TYPE_ICONS.type2) + '</svg>' +
        '</div>' +
        '<h3 class="type-name">' + ui.escapeHtml(t.type_name) + '</h3>' +
        '<p class="type-desc">' + ui.escapeHtml(t.summary || '') + '</p>' +
      '</div>';
    }).join('');
    host.querySelectorAll('.type-card').forEach(function (card) {
      card.addEventListener('click', function () {
        location.href = 'diabetes.html?type=' + encodeURIComponent(card.dataset.name);
      });
    });
  }

  /* ---------- 初始化 ---------- */
  document.getElementById('articleList').innerHTML = ui.skeletonList(3);

  api.homeData().then(function (data) {
    renderArticles(data.articles && data.articles.length ? data.articles : store.articles.all());
    renderTypes(data.diabetesTypes && data.diabetesTypes.length ? data.diabetesTypes : store.types.all());
  }).catch(function () {
    renderArticles(store.articles.all());
    renderTypes(store.types.all());
  });
})();
