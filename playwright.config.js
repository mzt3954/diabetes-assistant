/**
 * playwright.config.js — E2E 测试配置
 * 自动拉起静态服务器并等待就绪。
 */
const { defineConfig, devices } = require('@playwright/test');

const PORT = process.env.PORT || 8080;
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  timeout: 40000,
  expect: { timeout: 12000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'tests/report', open: 'never' }]],
  use: {
    baseURL: BASE,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 900 }
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
