/**
 * admin-init.js — 管理后台页（admin.html）页面初始化脚本
 *
 * 职责：
 *  1. 监听 DOMContentLoaded，待 DOM 就绪后执行管理后台数据表格的错误态保护
 *  2. 为「重试」按钮绑定点击刷新事件
 *  3. 监听表格区域，列表有数据时隐藏错误提示
 *  4. 3 秒后若仍无数据、无空态，则显示错误提示
 *
 * 本脚本不负责登录态检查与数据预取，仅聚焦表格的错误态/空态 UI 兜底。
 */

/**
 * admin-init.js — 由页面内联脚本抽取而来
 *
 * 抽取原因：CSP 指令 `script-src 'self'`（见 tests/mock-dify-server.js 与
 * snippets/security-headers.conf）不含 'unsafe-inline'，内联脚本会被浏览器拦截。
 * 抽取为外链文件后既满足 CSP，又保持原有执行时机（defer，位于其他脚本之后）。
 *
 * 原内联位置：admin.html 文件末尾、</body> 之前
 */
    // 设计迭代 2：管理后台数据表错误态保护
    /**
     * DOMContentLoaded 事件回调：管理后台页的初始化入口
     * @function
     * @returns {void}
     * 用途：DOM 就绪后绑定重试按钮、监听表格内容、设置错误态兜底，防止表格长期空白。
     */
    document.addEventListener('DOMContentLoaded', function () {
      var retry = document.getElementById('retryTable');
      /**
       * 「重试」按钮点击回调
       * @function
       * @returns {void}
       * 用途：点击重试时重新加载当前页面，以重新拉取数据。
       */
      if (retry) retry.addEventListener('click', function () { location.reload(); });

      var list = document.getElementById('tableArea');
      var error = document.getElementById('tableError');
      if (!list || !error) return;

      /**
       * MutationObserver 回调：当表格列表出现数据时隐藏错误提示
       * @function
       * @returns {void}
       * 用途：监听子节点变化，一旦渲染出列表项即收回错误态的展示。
       */
      var observer = new MutationObserver(function () {
        if (list.querySelectorAll('.list-item').length > 0) error.classList.remove('show');
      });
      observer.observe(list, { childList: true });

      /**
       * 延迟兜底回调：3 秒后仍无数据且无空态时显示错误提示
       * @function
       * @returns {void}
       * 用途：在数据加载异常或长时间无内容时，向用户展示错误态以引导重试。
       */
      setTimeout(function () {
        if (list.querySelectorAll('.list-item').length === 0 && !list.querySelector('.empty-state')) {
          error.classList.add('show');
        }
      }, 3000);
    });
