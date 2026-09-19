/**
 * lifeplan-init.js — 生活方案页（life-plan.html）页面初始化脚本
 *
 * 职责：
 *  1. 监听 DOMContentLoaded，DOM 就绪后初始化生活方案的进度展示
 *  2. 依赖主模块 window.DPA（store / charts），缺依赖则直接返回
 *  3. 依据今日/近 7 日打卡完成度绘制两个进度环形图（今日完成度、近 7 日完成度）
 *  4. 为方案列表绑定重试刷新、错误态兜底
 *  5. 首次进入自动生成基础方案期间，通过骨架屏占位避免页面长时间空白
 *
 * 本脚本不负责登录态检查与数据预取，聚焦进度图表、列表错误态与骨架屏展示。
 */

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
    /**
     * DOMContentLoaded 事件回调：生活方案页初始化入口
     * @function
     * @returns {void}
     * 用途：DOM 就绪后校验主模块依赖，统计今日与近 7 日打卡完成度绘制两张进度环形图，并为方案列表设置错误态与骨架屏兜底。
     */
    document.addEventListener('DOMContentLoaded', function () {
      if (!window.DPA || !DPA.store || !DPA.charts) return;
      var store = DPA.store;
      var TODAY = store.dateKey(new Date());
      var plans = store.plans.all();
      var total = plans.length || 1;

      /**
       * 今日完成打卡数筛选回调
       * @function
       * @param {Object} p 某次打卡记录
       * @returns {boolean} 该记录是否「已完成」
       * 用途：从今日打卡记录中过滤出已完成项以统计今日完成度分子。
       */
      var doneToday = store.punch.byDate(TODAY).filter(function (p) {
        return p.completion_status === '已完成';
      }).length;

      var weekCompleted = 0;
      var weekDays = store.punch.recentDays(7);
      /**
       * 近 7 日统计遍历回调
       * @function
       * @param {Object} d 7 日中的某一日数据
       * @returns {void}
       * 用途：累加近 7 天所有已完成打卡个数，供近 7 日完成度计算使用。
       */
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
      /**
       * 方案列表「重试」按钮点击回调
       * @function
       * @returns {void}
       * 用途：点击重试时重新加载当前页面以重新拉取方案数据。
       */
      if (retryPlan) retryPlan.addEventListener('click', function () { location.reload(); });
      var planList = document.getElementById('planList');
      var planError = document.getElementById('planError');
      if (planList && planError) {
        /**
         * 方案列表 MutationObserver 回调：出现方案条目时隐藏错误提示
         * @function
         * @returns {void}
         * 用途：监听方案子节点变化，渲染成功即收回错误态。
         */
        var planObserver = new MutationObserver(function () {
          if (planList.querySelectorAll('.plan-item').length > 0) planError.classList.remove('show');
        });
        planObserver.observe(planList, { childList: true });
        /**
         * 方案列表延迟兜底回调：3 秒后仍无方案且无空态时显示错误提示
         * @function
         * @returns {void}
         * 用途：方案加载异常或长时间空白时展示错误态以引导重试。
         */
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
        /**
         * reveal 函数：关闭骨架屏并停止监听
         * @function
         * @returns {void}
         * 用途：当方案区域或空态区域由 hidden 变为可见时，隐藏骨架屏并断开观察器，避免重复触发。
         */
        var reveal = function () {
          if (revealed) return;
          revealed = true;
          skeletonEl.classList.add('hidden');
          if (skeletonObserver) skeletonObserver.disconnect();
        };
        /**
         * 骨架屏 MutationObserver 回调：方案/空态区域可见时调用 reveal 收起骨架屏
         * @function
         * @returns {void}
         * 用途：监听两个区域的 class 变化，任一变为可见即隐藏骨架屏。
         */
        skeletonObserver = new MutationObserver(function () {
          if (!planAreaEl.classList.contains('hidden') || !emptyEl.classList.contains('hidden')) reveal();
        });
        skeletonObserver.observe(planAreaEl, { attributes: true, attributeFilter: ['class'] });
        skeletonObserver.observe(emptyEl, { attributes: true, attributeFilter: ['class'] });
        /**
         * 骨架屏兜底定时器回调
         * @function
         * @returns {void}
         * 用途：最长 60 秒后强制隐藏骨架屏，防止方案生成异常时骨架屏永久占位。
         */
        setTimeout(reveal, 60000);
      }
    });
