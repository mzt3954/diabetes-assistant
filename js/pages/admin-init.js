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
    document.addEventListener('DOMContentLoaded', function () {
      var retry = document.getElementById('retryTable');
      if (retry) retry.addEventListener('click', function () { location.reload(); });

      var list = document.getElementById('tableArea');
      var error = document.getElementById('tableError');
      if (!list || !error) return;

      var observer = new MutationObserver(function () {
        if (list.querySelectorAll('.list-item').length > 0) error.classList.remove('show');
      });
      observer.observe(list, { childList: true });

      setTimeout(function () {
        if (list.querySelectorAll('.list-item').length === 0 && !list.querySelector('.empty-state')) {
          error.classList.add('show');
        }
      }, 3000);
    });
