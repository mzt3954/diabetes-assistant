/**
 * doctor-init.js — 由页面内联脚本抽取而来
 *
 * 抽取原因：CSP 指令 `script-src 'self'`（见 tests/mock-dify-server.js 与
 * snippets/security-headers.conf）不含 'unsafe-inline'，内联脚本会被浏览器拦截。
 * 抽取为外链文件后既满足 CSP，又保持原有执行时机（defer，位于其他脚本之后）。
 *
 * 原内联位置：doctor.html 文件末尾、</body> 之前
 */
    // 设计迭代 2：医师列表加载/空态/错误态保护
    document.addEventListener('DOMContentLoaded', function () {
      var retry = document.getElementById('retryDoctor');
      if (retry) retry.addEventListener('click', function () { location.reload(); });

      var list = document.getElementById('doctorList');
      var error = document.getElementById('doctorError');
      if (!list || !error) return;

      var emptyHtml =
        '<div class="empty-state">' +
          '<svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' +
          '<div class="empty-state-title">暂无医师数据</div>' +
          '<div class="empty-state-desc">医师信息尚未初始化，请刷新页面或检查本地数据。</div>' +
        '</div>';

      var observer = new MutationObserver(function () {
        var cards = list.querySelectorAll('.doctor-card');
        if (cards.length > 0) {
          error.classList.remove('show');
        } else if (!list.querySelector('.empty-state') && list.innerHTML.trim() !== '') {
          list.innerHTML = emptyHtml;
        }
      });
      observer.observe(list, { childList: true });

      setTimeout(function () {
        var cards = list.querySelectorAll('.doctor-card');
        var hasEmpty = list.querySelector('.empty-state');
        if (cards.length === 0 && !hasEmpty) {
          if (window.DPA && DPA.store && DPA.store.doctors && DPA.store.doctors.all().length === 0) {
            list.innerHTML = emptyHtml;
          } else {
            error.classList.add('show');
          }
        }
      }, 3000);
    });
