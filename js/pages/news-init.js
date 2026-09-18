/**
 * news-init.js — 由页面内联脚本抽取而来
 *
 * 抽取原因：CSP 指令 `script-src 'self'`（见 tests/mock-dify-server.js 与
 * snippets/security-headers.conf）不含 'unsafe-inline'，内联脚本会被浏览器拦截。
 * 抽取为外链文件后既满足 CSP，又保持原有执行时机（defer，位于其他脚本之后）。
 *
 * 原内联位置：health-news.html 文件末尾、</body> 之前
 */
    // 设计迭代 2：资讯页浏览量条形图 + 列表错误态重试
    document.addEventListener('DOMContentLoaded', function () {
      var retry = document.getElementById('retryNews');
      if (retry) retry.addEventListener('click', function () { location.reload(); });

      // 浏览量条形图：取阅读量前 5 的文章
      if (window.DPA && DPA.store && DPA.charts) {
        try {
          var articles = DPA.store.articles.all().slice().sort(function (a, b) {
            return (b.views || 0) - (a.views || 0);
          }).slice(0, 5);
          var data = articles.map(function (a) {
            return { label: a.title, value: a.views || 0 };
          });
          DPA.charts.barChart('#newsBarChart', data, { title: '热门资讯浏览量' });
        } catch (e) {
          console.warn('[charts] 资讯条形图渲染失败', e);
        }
      }

      // 列表错误态保护：3 秒后若仍未渲染出新闻卡片则显示错误态
      var list = document.getElementById('newsList');
      var error = document.getElementById('newsError');
      if (list && error) {
        var observer = new MutationObserver(function () {
          if (list.querySelectorAll('.news-card').length > 0) error.classList.remove('show');
        });
        observer.observe(list, { childList: true });
        setTimeout(function () {
          if (list.querySelectorAll('.news-card').length === 0 && !list.querySelector('.empty-state')) {
            error.classList.add('show');
          }
        }, 3000);
      }
    });
