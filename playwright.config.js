/**
 * playwright.config.js — E2E 测试配置
 * 自动拉起静态服务器并等待就绪。
 */
const { defineConfig, devices } = require('@playwright/test');

const PORT = process.env.PORT || 8080;
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;

/*
 * 浏览器默认不读 HTTP_PROXY。若 js/config.js 的 baseUrl 指向真实 Dify 实例，
 * 页面里的 fetch 会一直挂到超时才降级本地引擎，表现为「列表迟迟不渲染」——
 * 看起来像前端 bug，实则是网络不通。
 * 这里让 Chromium 复用同一个代理（但绕过本地静态服务器，否则 8080 也走代理会失败）。
 */
const PROXY = process.env.E2E_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  timeout: Number(process.env.E2E_TIMEOUT || 180000),
  expect: { timeout: Number(process.env.E2E_WAIT || 45000) },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'tests/report', open: 'never' }]],
  use: {
    baseURL: BASE,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 900 },
    proxy: PROXY ? { server: PROXY, bypass: '127.0.0.1,localhost' } : undefined
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  webServer: process.env.BASE_URL ? undefined : {
    command: 'npx http-server -p ' + PORT + ' -c-1 --silent',
    url: BASE + '/index.html',
    reuseExistingServer: true,
    timeout: 60000
  }
});
