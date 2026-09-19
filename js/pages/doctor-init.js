/**
 * doctor-init.js — 医师列表页（doctor.html）页面初始化脚本
 *
 * 职责：
 *  1. 监听 DOMContentLoaded，DOM 就绪后执行医师列表的空态/错误态保护
 *  2. 为「重试」按钮绑定点击刷新事件
 *  3. 监听医师列表渲染：有卡片则隐藏错误态；列表为空则注入空态 HTML
 *  4. 3 秒后兜底判断：无数据且本地亦无医师记录时展示空态，否则展示错误态
 *
 * 本脚本不负责登录态检查与数据预取，聚焦医师列表的展示兜底。
 */

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
    /**
     * DOMContentLoaded 事件回调：医师列表页初始化入口
     * @function
     * @returns {void}
     * 用途：DOM 就绪后绑定重试按钮、监听医师列表渲染并注入空态、设置 3 秒兜底的空态/错误态判断。
     */
    document.addEventListener('DOMContentLoaded', function () {
      var retry = document.getElementById('retryDoctor');
      /**
       * 「重试」按钮点击回调
       * @function
       * @returns {void}
       * 用途：点击重试时重新加载当前页面以重新拉取医师数据。
       */
      if (retry) retry.addEventListener('click', function () { location.reload(); });

      var list = document.getElementById('doctorList');
      var error = document.getElementById('doctorError');
      if (!list || !error) return;

      /**
       * 空态 HTML 模板：当医师列表为空时注入到列表区域展示
       * @constant {String} emptyHtml
       * 用途：提供「暂无医师数据」的带图标空态提示结构。
       */
      var emptyHtml =
        '<div class="empty-state">' +
          '<svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' +
          '<div class="empty-state-title">暂无医师数据</div>' +
          '<div class="empty-state-desc">医师信息尚未初始化，请刷新页面或检查本地数据。</div>' +
        '</div>';

      /**
       * 医师列表 MutationObserver 回调：根据渲染结果切换错误态或注入空态
       * @function
       * @returns {void}
       * 用途：出现医师卡片时隐藏错误态；列表为空且非空态内容时注入空态 HTML。
       */
      var observer = new MutationObserver(function () {
        var cards = list.querySelectorAll('.doctor-card');
        if (cards.length > 0) {
          error.classList.remove('show');
        } else if (!list.querySelector('.empty-state') && list.innerHTML.trim() !== '') {
          list.innerHTML = emptyHtml;
        }
      });
      observer.observe(list, { childList: true });

      /**
       * 延迟兜底回调：3 秒后依据本地医师记录决定展示空态或错误态
       * @function
       * @returns {void}
       * 用途：无医师卡片时，若本地 store 确无医师记录则注入空态，否则展示错误态引导重试。
       */
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
