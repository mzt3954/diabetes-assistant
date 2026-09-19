/**
 * help-init.js — 帮助中心页（help.html）页面初始化脚本
 *
 * 职责：
 *  1. 监听 DOMContentLoaded，DOM 就绪后执行帮助中心 FAQ（常见问题）错误的态保护
 *  2. 为「重试」按钮绑定点击刷新事件
 *  3. 监听 FAQ 列表渲染：出现条目时隐藏错误提示
 *  4. 3 秒后若仍无 FAQ 且无空态，则显示错误提示
 *
 * 本脚本不负责登录态检查与数据预取，聚焦 FAQ 列表的错误态 UI 兜底。
 */

/**
 * help-init.js — 由页面内联脚本抽取而来
 *
 * 抽取原因：CSP 指令 `script-src 'self'`（见 tests/mock-dify-server.js 与
 * snippets/security-headers.conf）不含 'unsafe-inline'，内联脚本会被浏览器拦截。
 * 抽取为外链文件后既满足 CSP，又保持原有执行时机（defer，位于其他脚本之后）。
 *
 * 原内联位置：help.html 文件末尾、</body> 之前
 */
    // 设计迭代 2：帮助中心 FAQ 错误态保护
    /**
     * DOMContentLoaded 事件回调：帮助中心页初始化入口
     * @function
     * @returns {void}
     * 用途：DOM 就绪后绑定重试按钮、监听 FAQ 列表渲染并设置 3 秒错误态兜底。
     */
    document.addEventListener('DOMContentLoaded', function () {
      var retry = document.getElementById('retryFaq');
      /**
       * 「重试」按钮点击回调
       * @function
       * @returns {void}
       * 用途：点击重试时重新加载当前页面以重新拉取 FAQ 数据。
       */
      if (retry) retry.addEventListener('click', function () { location.reload(); });

      var list = document.getElementById('faqList');
      var error = document.getElementById('faqError');
      if (!list || !error) return;

      /**
       * FAQ 列表 MutationObserver 回调：出现 FAQ 条目时隐藏错误提示
       * @function
       * @returns {void}
       * 用途：监听 FAQ 子节点变化，渲染成功即收回错误态。
       */
      var observer = new MutationObserver(function () {
        if (list.querySelectorAll('.faq-item').length > 0) error.classList.remove('show');
      });
      observer.observe(list, { childList: true });

      /**
       * 延迟兜底回调：3 秒后仍无 FAQ 且无空态时显示错误提示
       * @function
       * @returns {void}
       * 用途：FAQ 加载异常或长时间空白时展示错误态以引导重试。
       */
      setTimeout(function () {
        if (list.querySelectorAll('.faq-item').length === 0 && !list.querySelector('.empty-state')) {
          error.classList.add('show');
        }
      }, 3000);
    });
