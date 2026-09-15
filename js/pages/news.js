/**
 * pages/news.js — 健康资讯（标签 / 生成 / 收藏）
 * 对应课程任务 7-1 ~ 7-3
 */
(function () {
  'use strict';

  if (!DPA.auth.requireAuth()) return;

  var ui = DPA.ui;
  var store = DPA.store;
  var api = DPA.api;

  ui.renderNavbar('news');
  ui.renderBottomNav('news');

  var SEED_TAGS = (window.DPA_SEED && DPA_SEED.NEWS_TAGS) || ['饮食指导', '运动指南', '生活习惯', '糖尿病科普'];
  var currentTag = '全部';
  var showOnlyFav = false;

  var listEl = document.getElementById('newsList');
  var tagsEl = document.getElementById('newsTags');

  /* ---------- 标签 ---------- */
  function renderTags() {
    var cats = store.articles.categories();
    var all = ['全部'].concat(SEED_TAGS.filter(function (t, i, a) { return a.indexOf(t) === i; }))
      .concat(cats.filter(function (c) { return SEED_TAGS.indexOf(c) < 0; }))
      .filter(function (t, i, a) { return a.indexOf(t) === i; });

    var html = all.map(function (t) {
      return '<button class="news-tag' + (t === currentTag && !showOnlyFav ? ' active' : '') + '" data-tag="' + ui.escapeAttr(t) + '">' + ui.escapeHtml(t) + '</button>';
    }).join('');
    html += '<button class="news-tag' + (showOnlyFav ? ' active' : '') + '" data-fav="1">★ 我的收藏</button>';
    tagsEl.innerHTML = html;

    tagsEl.querySelectorAll('.news-tag').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.dataset.fav) {
          showOnlyFav = true;
          currentTag = '';
        } else {
          showOnlyFav = false;
          currentTag = btn.dataset.tag;
        }
        renderTags();
        renderList();
      });
    });
  }

  /* ---------- 列表 ---------- */
  function excerpt(md) {
    return String(md || '').replace(/[#>*`-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);
  }

  function renderList() {
    var list = showOnlyFav
      ? store.collections.listArticles()
      : store.articles.byCategory(currentTag);

    document.getElementById('newsCount').textContent =
      showOnlyFav ? '共收藏 ' + list.length + ' 篇' : '共 ' + list.length + ' 篇文章';

    if (!list.length) {
      listEl.innerHTML = ui.emptyState({
        icon: showOnlyFav ? '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>' : undefined,
        title: showOnlyFav ? '还没有收藏文章' : '该分类暂无文章',
        desc: showOnlyFav ? '点击文章卡片右上角的收藏按钮即可收藏' : '试试点击右上角「生成资讯」创建一篇'
      });
      return;
    }

    // 一次性取出收藏集合，避免每篇文章都触发一次 store 查询
    var favSet = store.collections.idSet();

    listEl.innerHTML = list.map(function (a) {
      var fav = favSet[a.article_id] === true;
      return '<article class="news-card" data-id="' + a.article_id + '">' +
        '<div class="flex items-start justify-between gap-sm">' +
          '<h3 class="news-card-title">' + ui.escapeHtml(a.title) + '</h3>' +
          '<button class="collect-btn' + (fav ? ' active' : '') + '" data-collect="' + a.article_id + '" aria-label="收藏">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="' + (fav ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' +
          '</button>' +
        '</div>' +
        '<p class="news-card-excerpt">' + ui.escapeHtml(excerpt(a.content)) + '</p>' +
        '<div class="news-card-meta">' +
          '<span><span class="tag tag-primary">' + ui.escapeHtml(a.category || '科普') + '</span></span>' +
          '<span>' + ui.escapeHtml(a.author) + ' · ' + ui.escapeHtml(a.publish_time) + ' · ' + ui.formatNumber(a.views) + ' 阅读</span>' +
        '</div>' +
      '</article>';
    }).join('');

    listEl.querySelectorAll('.news-card').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.closest('.collect-btn')) return;
        location.href = 'article.html?id=' + card.dataset.id;
      });
    });

    listEl.querySelectorAll('.collect-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var added = store.collections.toggle(Number(btn.dataset.collect));
        ui.toast(added ? '已加入收藏' : '已取消收藏');
        renderTags();
        renderList();
      });
    });
  }

  /* ---------- 生成资讯 ---------- */
  document.getElementById('generateBtn').addEventListener('click', function () {
    var btn = this;
    var label = btn.querySelector('.btn-text');
    var spinner = btn.querySelector('.loading-spinner');
    btn.disabled = true;
    label.textContent = '生成中...';
    spinner.classList.remove('hidden');

    var risk = store.risk.latest();
    var userInfo = { username: DPA.auth.username(), riskLevel: risk ? risk.level : '' };
    var tag = (currentTag && currentTag !== '全部') ? currentTag : undefined;

    api.generateNews({ userInfo: userInfo, tag: tag }).then(function (res) {
      btn.disabled = false;
      label.textContent = '生成资讯';
      spinner.classList.add('hidden');
      if (!res || !res.article) { ui.toast('生成失败，请重试', 'error'); return; }

      var saved = store.articles.add(res.article);
      showOnlyFav = false;
      currentTag = saved.category;
      renderTags();
      renderList();
      ui.toast('已生成新资讯：' + saved.title);
    }).catch(function (err) {
      btn.disabled = false;
      label.textContent = '生成资讯';
      spinner.classList.add('hidden');
      ui.toast('生成失败：' + (err.message || '请重试'), 'error');
    });
  });

  /* ---------- 初始化 ---------- */
  renderTags();
  renderList();
})();
