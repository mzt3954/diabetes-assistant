/**
 * lifeplan-init.js — 由页面内联脚本抽取而来
 *
 * 抽取原因：CSP 指令 `script-src 'self'`（见 tests/mock-dify-server.js 与
 * snippets/security-headers.conf）不含 'unsafe-inline'，内联脚本会被浏览器拦截。
 * 抽取为外链文件后既满足 CSP，又保持原有执行时机（defer，位于其他脚本之后）。
 *
 * 原内联位置：life-plan.html 文件末尾、</body> 之前
 */
    // 设计迭代 2：生活方案进度环形图
    document.addEventListener('DOMContentLoaded', function () {
      if (!window.DPA || !DPA.store || !DPA.charts) return;
      var store = DPA.store;
      var TODAY = store.dateKey(new Date());
      var plans = store.plans.all();
      var total = plans.length || 1;

      var doneToday = store.punch.byDate(TODAY).filter(function (p) {
        return p.completion_status === '已完成';
      }).length;

      var weekCompleted = 0;
      var weekDays = store.punch.recentDays(7);
      weekDays.forEach(function (d) {
        d.items.forEach(function (p) { if (p.completion_status === '已完成') weekCompleted++; });
      });

      DPA.charts.progressRing('#planRingToday', (doneToday / total) * 100, {
        title: '今日完成度',
        label: doneToday + '/' + total,
        color: doneToday >= total ? '--success' : '--primary'
      });
      DPA.charts.progressRing('#planRingWeek', Math.min(100, (weekCompleted / (total * 7)) * 100), {
        title: '近 7 日完成度',
        label: weekCompleted + ' 项',
        color: weekCompleted >= total * 5 ? '--success' : '--primary'
      });

      // 方案列表错误态保护
      var retryPlan = document.getElementById('retryPlan');
      if (retryPlan) retryPlan.addEventListener('click', function () { location.reload(); });
      var planList = document.getElementById('planList');
      var planError = document.getElementById('planError');
      if (planList && planError) {
        var planObserver = new MutationObserver(function () {
          if (planList.querySelectorAll('.plan-item').length > 0) planError.classList.remove('show');
        });
        planObserver.observe(planList, { childList: true });
        setTimeout(function () {
          if (planList.querySelectorAll('.plan-item').length === 0 && !planList.querySelector('.empty-state')) {
            planError.classList.add('show');
          }
        }, 3000);
      }

      // 首次进入会自动生成基础方案：生成期间先亮出骨架屏，避免页面长时间空白
      var planAreaEl = document.getElementById('planArea');
      var emptyEl = document.getElementById('emptyArea');
      var skeletonEl = document.getElementById('planSkeleton');
      if (planAreaEl && emptyEl && skeletonEl &&
          planAreaEl.classList.contains('hidden') && emptyEl.classList.contains('hidden')) {
        skeletonEl.classList.remove('hidden');
        var revealed = false;
        var skeletonObserver;
        var reveal = function () {
          if (revealed) return;
          revealed = true;
          skeletonEl.classList.add('hidden');
          if (skeletonObserver) skeletonObserver.disconnect();
        };
        skeletonObserver = new MutationObserver(function () {
          if (!planAreaEl.classList.contains('hidden') || !emptyEl.classList.contains('hidden')) reveal();
        });
        skeletonObserver.observe(planAreaEl, { attributes: true, attributeFilter: ['class'] });
        skeletonObserver.observe(emptyEl, { attributes: true, attributeFilter: ['class'] });
        setTimeout(reveal, 60000);
      }
    });
