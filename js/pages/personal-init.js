/**
 * personal-init.js — 由页面内联脚本抽取而来
 *
 * 抽取原因：CSP 指令 `script-src 'self'`（见 tests/mock-dify-server.js 与
 * snippets/security-headers.conf）不含 'unsafe-inline'，内联脚本会被浏览器拦截。
 * 抽取为外链文件后既满足 CSP，又保持原有执行时机（defer，位于其他脚本之后）。
 *
 * 原内联位置：personal.html 文件末尾、</body> 之前
 */
    // 设计迭代 2：个人中心进度环形图
    document.addEventListener('DOMContentLoaded', function () {
      if (!window.DPA || !DPA.store || !DPA.charts) return;
      var store = DPA.store;
      var total = store.plans.count() || 1;
      var doneTotal = store.punch.count();

      var weekCompleted = 0;
      store.punch.recentDays(7).forEach(function (d) {
        d.items.forEach(function (p) { if (p.completion_status === '已完成') weekCompleted++; });
      });

      DPA.charts.progressRing('#personalRingOverall', Math.min(100, (doneTotal / total) * 100), {
        title: '累计完成度',
        label: doneTotal + '/' + total,
        color: doneTotal >= total ? '--success' : '--primary'
      });
      DPA.charts.progressRing('#personalRingWeek', Math.min(100, (weekCompleted / (total * 7)) * 100), {
        title: '本周完成度',
        label: weekCompleted + ' 项',
        color: weekCompleted >= total * 5 ? '--success' : '--primary'
      });
    });
