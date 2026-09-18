/**
 * checkin-init.js — 由页面内联脚本抽取而来
 *
 * 抽取原因：CSP 指令 `script-src 'self'`（见 tests/mock-dify-server.js 与
 * snippets/security-headers.conf）不含 'unsafe-inline'，内联脚本会被浏览器拦截。
 * 抽取为外链文件后既满足 CSP，又保持原有执行时机（defer，位于其他脚本之后）。
 *
 * 原内联位置：checkin.html 文件末尾、</body> 之前
 */
    // 设计迭代 2：近 7 日打卡趋势折线
    document.addEventListener('DOMContentLoaded', function () {
      if (!window.DPA || !DPA.store || !DPA.charts) return;
      var WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];
      var today = DPA.store.dateKey(new Date());
      var recent = DPA.store.punch.recentDays(7);
      var data = recent.map(function (d) {
        var count = d.items.filter(function (p) { return p.completion_status === '已完成'; }).length;
        var dateObj = new Date(d.date);
        var label = (d.date === today ? '今天' : '周' + WEEK_CN[dateObj.getDay()]);
        return { label: label, value: count };
      });
      DPA.charts.trendLine('#trendChart', data, { title: '近 7 日打卡趋势' });

      // 打卡明细错误态保护
      var retryDetail = document.getElementById('retryDetail');
      if (retryDetail) retryDetail.addEventListener('click', function () { location.reload(); });
      var detailList = document.getElementById('detailList');
      var detailError = document.getElementById('detailError');
      if (detailList && detailError) {
        var detailObserver = new MutationObserver(function () {
          if (detailList.querySelectorAll('.list-item').length > 0) detailError.classList.remove('show');
        });
        detailObserver.observe(detailList, { childList: true });
        setTimeout(function () {
          if (detailList.querySelectorAll('.list-item').length === 0 && !detailList.querySelector('.empty-state')) {
            detailError.classList.add('show');
          }
        }, 3000);
      }
    });
