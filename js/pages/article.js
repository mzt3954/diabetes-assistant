/**
 * pages/article.js — 科普文章详情页
 * ===================================
 * 功能：展示单篇文章的完整内容（标题/作者/时间/分类/阅读量），支持收藏
 *      与相关文章推荐跳转，文章不存在时给出空状态引导返回首页。
 * 交互模块：DPA.ui(渲染/弹窗/提示/转义)、DPA.store.articles(文章读取/阅读量累加)、
 *          DPA.store.collections(收藏切换/查询)。
 */
// IIFE 隔离作用域；未登录先跳登录页。通过 URL 的 id 参数定位文章。
(function () {
  'use strict';

  if (!DPA.auth.requireAuth()) return;

  var ui = DPA.ui;
  var store = DPA.store;

  ui.renderNavbar('');
  ui.renderBottomNav('news');

  var id = Number(ui.query('id'));
  var article = store.articles.get(id);

  // 文章不存在：展示空状态并绑定「返回首页」按钮
  if (!article) {
    document.getElementById('articleTitle').textContent = '文章不存在';
    document.getElementById('articleBody').innerHTML = ui.emptyState({
      title: '未找到该文章',
      desc: '文章可能已被删除，返回首页浏览其他内容',
      action: '返回首页'
    });
    var btn = document.querySelector('[data-act="empty-action"]');
    if (btn) btn.addEventListener('click', function () { location.href = 'home.html'; });
    return;
  }

  store.articles.incViews(id);

  document.title = article.title + ' - 糖尿病预治智能助手';
  document.getElementById('articleTitle').textContent = article.title;
  document.getElementById('articleMeta').innerHTML =
    '<span>' + ui.escapeHtml(article.author) + '</span>' +
    '<span>' + ui.escapeHtml(article.publish_time) + '</span>' +
    '<span>' + ui.escapeHtml(article.category || '科普') + '</span>' +
    '<span>阅读 ' + ui.formatNumber((article.views || 0) + 1) + '</span>';

  document.getElementById('articleBody').innerHTML = ui.renderMarkdown(article.content);

  /* 收藏 */
  var collectBtn = document.getElementById('collectBtn');
  var collectText = document.getElementById('collectText');

  /**
   * 根据收藏状态同步收藏按钮的样式与文字。
   * @returns {void} 无返回值
   * 用途：读取当前文章是否已收藏，切换按钮为「已收藏/收藏」外观。
   */
  function syncCollect() {
    var has = store.collections.has(id);
    collectBtn.classList.toggle('btn-outline', !has);
    collectBtn.classList.toggle('btn-primary', has);
    collectText.textContent = has ? '已收藏' : '收藏';
  }
  syncCollect();

  // 收藏按钮点击：切换收藏状态并同步按钮，同时给出提示
  collectBtn.addEventListener('click', function () {
    var added = store.collections.toggle(id);
    syncCollect();
    ui.toast(added ? '已加入收藏' : '已取消收藏');
  });

  // 返回按钮：有历史记录则后退，否则回资讯列表页
  document.getElementById('backBtn').addEventListener('click', function () {
    if (history.length > 1) history.back();
    else location.href = 'health-news.html';
  });

  /* 相关推荐 */
  // 取除当前文章外的前 3 篇作为相关推荐，点击卡片跳转对应详情页
  var related = store.articles.all()
    .filter(function (a) { return a.article_id !== id; })
    .slice(0, 3);
  var host = document.getElementById('relatedList');
  host.innerHTML = related.map(function (a) {
    return '<div class="article-card" data-id="' + a.article_id + '">' +
      '<div class="article-cover">' + ui.escapeHtml(a.category || '科普') + '</div>' +
      '<div class="article-info"><h3 class="article-title">' + ui.escapeHtml(a.title) + '</h3>' +
      '<div class="article-meta"><span>' + ui.escapeHtml(a.author) + '</span><span>' + ui.escapeHtml(a.publish_time) + '</span></div></div></div>';
  }).join('') || ui.emptyState({ title: '暂无更多文章' });

  // 相关推荐卡片点击：跳转到对应文章详情页
  host.querySelectorAll('.article-card').forEach(function (card) {
    card.addEventListener('click', function () { location.href = 'article.html?id=' + card.dataset.id; });
  });
})();
