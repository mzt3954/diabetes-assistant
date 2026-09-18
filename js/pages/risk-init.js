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
    document.addEventListener('DOMContentLoaded', function () {
      var retry = document.getElementById('retryHistory');
      if (retry) retry.addEventListener('click', function () { location.reload(); });
    });
