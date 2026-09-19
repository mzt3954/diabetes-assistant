/**
 * risk-init.js — 风险评估页（risk-prediction.html）页面初始化脚本
 *
 * 职责：
 *  1. 监听 DOMContentLoaded，DOM 就绪后为「历史评估」区域的错误态提供重试刷新能力
 *  2. 为「重试」按钮（retryHistory）绑定点击刷新事件
 *
 * 本脚本不负责登录态检查与数据预取，聚焦历史评估列表的错误态重试兜底。
 */

/**
 * risk-init.js — 由页面内联脚本抽取而来
 *
 * 抽取原因：CSP 指令 `script-src 'self'`（见 tests/mock-dify-server.js 与
 * snippets/security-headers.conf）不含 'unsafe-inline'，内联脚本会被浏览器拦截。
 * 抽取为外链文件后既满足 CSP，又保持原有执行时机（defer，位于其他脚本之后）。
 *
 * 原内联位置：risk-prediction.html 文件末尾、</body> 之前
 */
    // 设计迭代 2：历史评估错误态重试
    /**
     * DOMContentLoaded 事件回调：风险评估页初始化入口
     * @function
     * @returns {void}
     * 用途：DOM 就绪后为「历史评估」重试按钮绑定点击刷新事件，用于错误态下重新加载数据。
     */
    document.addEventListener('DOMContentLoaded', function () {
      var retry = document.getElementById('retryHistory');
      /**
       * 历史评估「重试」按钮点击回调
       * @function
       * @returns {void}
       * 用途：点击重试时重新加载当前页面以重新拉取历史评估数据。
       */
      if (retry) retry.addEventListener('click', function () { location.reload(); });
    });
