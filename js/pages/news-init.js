/**
 * news-init.js — 健康资讯页（health-news.html）页面初始化脚本
 *
 * 职责：
 *  1. 监听 DOMContentLoaded，DOM 就绪后初始化资讯页数据展示
 *  2. 为「重试」按钮绑定点击刷新事件
 *  3. 依赖主模块 window.DPA：取阅读量前 5 的文章绘制「热门资讯浏览量」条形图（失败则仅告警不阻塞）
 *  4. 监听资讯列表渲染：出现新闻卡片时隐藏错误提示；3 秒后仍无数据则显示错误态
 *
 * 本脚本不负责登录态检查与数据预取，聚焦浏览条形图与列表错误态保护。
 */

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
    /**
     * DOMContentLoaded 事件回调：健康资讯页初始化入口
     * @function
     * @returns {void}
     * 用途：DOM 就绪后绑定重试按钮、绘制热门资讯浏览量条形图，并为资讯列表设置错误态兜底。
     */
    document.addEventListener('DOMContentLoaded', function () {
      var retry = document.getElementById('retryNews');
      /**
       * 「重试」按钮点击回调
       * @function
       * @returns {void}
       * 用途：点击重试时重新加载当前页面以重新拉取资讯数据。
       */
      if (retry) retry.addEventListener('click', function () { location.reload(); });

      // 浏览量条形图：取阅读量前 5 的文章
      if (window.DPA && DPA.store && DPA.charts) {
        try {
          /**
           * 文章排序回调：按浏览量降序排列
           * @function
           * @param {Object} a 文章 A
           * @param {Object} b 文章 B
           * @returns {number} 浏览量差值（大者在前）
           * 用途：用于 sort 将文章按阅读量从高到低排序。
           */
          var articles = DPA.store.articles.all().slice().sort(function (a, b) {
            return (b.views || 0) - (a.views || 0);
          }).slice(0, 5);
          /**
           * 文章数据映射回调：转换为条形图数据点
           * @function
           * @param {Object} a 一篇文章
           * @returns {Object} 图表数据点 { label: 标题, value: 浏览量 }
           * 用途：为条形图提供标题与浏览量数据。
           */
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
        /**
         * 资讯列表 MutationObserver 回调：出现新闻卡片时隐藏错误提示
         * @function
         * @returns {void}
         * 用途：监听资讯子节点变化，渲染成功即收回错误态。
         */
        var observer = new MutationObserver(function () {
          if (list.querySelectorAll('.news-card').length > 0) error.classList.remove('show');
        });
        observer.observe(list, { childList: true });
        /**
         * 资讯列表延迟兜底回调：3 秒后仍无新闻卡片且无空态时显示错误提示
         * @function
         * @returns {void}
         * 用途：资讯加载异常或长时间空白时展示错误态以引导重试。
         */
        setTimeout(function () {
          if (list.querySelectorAll('.news-card').length === 0 && !list.querySelector('.empty-state')) {
            error.classList.add('show');
          }
        }, 3000);
      }
    });
