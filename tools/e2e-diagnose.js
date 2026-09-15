'use strict';
/* global localStorage, document, window */
/**
 * E2E 排障脚本：打开页面、走一遍生活方案流程，把控制台输出与 DOM 状态打出来。
 *
 * 注意：本文件是 Node 脚本，但 page.evaluate() 的回调体实际运行在浏览器里，
 * 所以上面的 global 声明只是给 ESLint 看的，Node 侧并不存在这些变量。
 *
 * 用法: node tools/e2e-diagnose.js [应用页面]
 */
const { chromium } = require('@playwright/test');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080';
const PROXY = process.env.E2E_PROXY || process.env.HTTP_PROXY || '';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    proxy: PROXY ? { server: PROXY, bypass: '127.0.0.1,localhost' } : undefined
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const logs = [];
  page.on('console', (m) => logs.push('[' + m.type() + '] ' + m.text().slice(0, 300)));
  page.on('pageerror', (e) => logs.push('[pageerror] ' + String(e.message).slice(0, 300)));
  page.on('requestfailed', (r) => logs.push('[reqfail] ' + r.url().slice(0, 120) + ' :: ' + (r.failure() && r.failure().errorText)));

  const target = process.argv[2] || 'index.html';
  await page.goto(BASE + '/' + target);
  await page.evaluate(() => {
    localStorage.setItem('dpa:session', JSON.stringify({
      user_id: 2, username: 'user', role: 'user', avatar: '', loginTime: new Date().toISOString()
    }));
  });
  await page.reload();

  // 运行模式标识
  const mode = await page.evaluate(() => {
    const el = document.querySelector('#modeText, #runMode, .run-mode, [data-run-mode]');
    return el ? el.textContent.trim() : '(未找到运行模式元素)';
  });
  console.log('运行模式:', mode);

  console.log('DIFY 配置:', await page.evaluate(() => JSON.stringify({
    baseUrl: window.DPA_CONFIG && window.DPA_CONFIG.DIFY && window.DPA_CONFIG.DIFY.baseUrl,
    useMock: window.DPA_CONFIG && window.DPA_CONFIG.USE_MOCK,
    planKey: window.DPA_CONFIG && window.DPA_CONFIG.DIFY.apps.lifePlan.apiKey ? '(已配置)' : '(空)'
  })));

  await page.waitForTimeout(35000);  // 真实推理约 14s，留足余量

  console.log('planList 子元素数:', await page.evaluate(() => {
    const el = document.querySelector('#planList');
    return el ? el.children.length : '(未找到 #planList)';
  }));

  // 直接在页面上下文里调一次 API，看真实返回与是否降级
  console.log('\n--- 直接调用 DPA.api.generateLifePlan ---');
  const apiOut = await page.evaluate(async () => {
    try {
      const r = await window.DPA.api.generateLifePlan({
        userInfo: { age: 55, sex: '男', bmi: 26 }, lifeState: '轻体力活动', advice: '控糖'
      });
      return { ok: true, keys: Object.keys(r || {}), source: r && r.source, plans: (r && r.plans || []).length };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  });
  console.log(JSON.stringify(apiOut));

  console.log('页面 URL:', page.url());
  console.log('\n--- 控制台输出（后 30 条）---');
  logs.slice(-30).forEach((l) => console.log('  ' + l));

  await browser.close();
})();
