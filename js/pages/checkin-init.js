/**
 * checkin-init.js — 打卡页（checkin.html）页面初始化脚本
 *
 * 职责：
 *  1. 监听 DOMContentLoaded，DOM 就绪后初始化打卡数据展示
 *  2. 依赖主模块 window.DPA（store / charts），缺依赖则直接返回
 *  3. 汇总近 7 日打卡数据，绘制「近 7 日打卡趋势」折线图
 *  4. 为打卡明细区域绑定重试刷新、错误态兜底
 *
 * 本脚本不负责登录态检查与数据预取，聚焦趋势图与明细错误态保护。
 */

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
    /**
     * DOMContentLoaded 事件回调：打卡页初始化入口
     * @function
     * @returns {void}
     * 用途：DOM 就绪后校验主模块依赖，汇总近 7 日打卡数据绘制趋势折线图，并绑定明细区域的重试与错误态保护。
     */
    document.addEventListener('DOMContentLoaded', function () {
      if (!window.DPA || !DPA.store || !DPA.charts) return;
      var WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];
      var today = DPA.store.dateKey(new Date());
      var recent = DPA.store.punch.recentDays(7);
      /**
       * 每日数据加工回调：统计各日已完成打卡数并生成图表数据点
       * @function
       * @param {Object} d 近 7 日中的某一日数据（含 date 与 items 打卡明细）
       * @returns {Object} 图表数据点 { label: 日期/今天标签, value: 已完成数量 }
       * 用途：为趋势折线图提供横轴标签（今日显示「今天」，其余显示周几）与纵轴数值。
       */
      var data = recent.map(function (d) {
        var count = d.items.filter(function (p) { return p.completion_status === '已完成'; }).length;
        var dateObj = new Date(d.date);
        var label = (d.date === today ? '今天' : '周' + WEEK_CN[dateObj.getDay()]);
        return { label: label, value: count };
      });
      DPA.charts.trendLine('#trendChart', data, { title: '近 7 日打卡趋势' });

      // 打卡明细错误态保护
      var retryDetail = document.getElementById('retryDetail');
      /**
       * 明细「重试」按钮点击回调
       * @function
       * @returns {void}
       * 用途：点击重试时重新加载当前页面以重新拉取打卡明细。
       */
      if (retryDetail) retryDetail.addEventListener('click', function () { location.reload(); });
      var detailList = document.getElementById('detailList');
      var detailError = document.getElementById('detailError');
      if (detailList && detailError) {
        /**
         * 明细列表 MutationObserver 回调：出现列表项时隐藏错误提示
         * @function
         * @returns {void}
         * 用途：监听明细子节点变化，渲染成功即收回错误态。
         */
        var detailObserver = new MutationObserver(function () {
          if (detailList.querySelectorAll('.list-item').length > 0) detailError.classList.remove('show');
        });
        detailObserver.observe(detailList, { childList: true });
        /**
         * 明细延迟兜底回调：3 秒后仍无数据且无空态时显示错误提示
         * @function
         * @returns {void}
         * 用途：明细加载异常或长时间空白时展示错误态以引导重试。
         */
        setTimeout(function () {
          if (detailList.querySelectorAll('.list-item').length === 0 && !detailList.querySelector('.empty-state')) {
            detailError.classList.add('show');
          }
        }, 3000);
      }
    });
