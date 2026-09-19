/**
 * personal-init.js — 个人中心页（personal.html）页面初始化脚本
 *
 * 职责：
 *  1. 监听 DOMContentLoaded，DOM 就绪后初始化个人中心数据展示
 *  2. 依赖主模块 window.DPA（store / charts），缺依赖则直接返回
 *  3. 依据累计/近 7 日打卡完成度绘制两个进度环形图（累计完成度、本周完成度）
 *
 * 本脚本不负责登录态检查与数据预取，聚焦进度环形图的数据统计与绘制。
 */

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
    /**
     * DOMContentLoaded 事件回调：个人中心页初始化入口
     * @function
     * @returns {void}
     * 用途：DOM 就绪后校验主模块依赖，统计累计与近 7 日打卡完成度绘制两张进度环形图。
     */
    document.addEventListener('DOMContentLoaded', function () {
      if (!window.DPA || !DPA.store || !DPA.charts) return;
      var store = DPA.store;
      var total = store.plans.count() || 1;
      var doneTotal = store.punch.count();

      var weekCompleted = 0;
      /**
       * 近 7 日统计遍历回调
       * @function
       * @param {Object} d 7 日中的某一日数据
       * @returns {void}
       * 用途：累加近 7 天所有已完成打卡个数，供本周完成度计算使用。
       */
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
