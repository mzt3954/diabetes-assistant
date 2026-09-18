/**
 * demo-mode.js — 一键切换演示模式（改写 js/config.local.js）
 *
 * 三种模式：
 *   local-mock  本地 Dify 契约桩（推荐）：baseUrl = http://127.0.0.1:8080/v1 + 桩服务的 8 个 Key
 *   offline     纯离线：USE_MOCK = true，全部走 js/mock-engine.js 本地规则引擎
 *   sandbox     课程云沙箱：恢复首次运行时的原始配置（含真实 Key）
 *
 * 用法：
 *   node tools/demo-mode.js local-mock
 *   node tools/demo-mode.js offline
 *   node tools/demo-mode.js sandbox
 *   node tools/demo-mode.js status
 *
 * 说明：首次运行任意模式时，会把当时的 js/config.local.js 备份为
 *       js/config.local.sandbox.js，供 sandbox 模式恢复。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOCAL = path.join(ROOT, 'js', 'config.local.js');
const BACKUP = path.join(ROOT, 'js', 'config.local.sandbox.js');

const MOCK_KEYS = {
  homeData: 'app-wf-home-key',
  doctorChat: 'app-chat-doctor-key',
  riskPrediction: 'app-wf-risk-key',
  lifePlan: 'app-wf-lifeplan-key',
  healthNews: 'app-wf-news-key',
  checkinAnalysis: 'app-wf-checkin-key',
  aiAssistant: 'app-chat-assistant-key',
  adminAgent: 'app-agent-admin-key',
};

function header(mode) {
  return '/**\n' +
    ' * config.local.js — 本地真实配置（**不入库**，已在 .gitignore 中）\n' +
    ' * 由 tools/demo-mode.js 自动生成，当前模式：' + mode + '\n' +
    ' * 生成时间：' + new Date().toISOString() + '\n' +
    ' */\n';
}

function contentLocalMock() {
  const apps = Object.keys(MOCK_KEYS)
    .map((k) => "        " + k + ": { apiKey: '" + MOCK_KEYS[k] + "' },")
    .join('\n');
  return header('local-mock（本地契约桩）') +
    '(function (global) {\n' +
    "  'use strict';\n" +
    '  global.DPA_CONFIG_LOCAL = {\n' +
    '    DIFY: {\n' +
    "      baseUrl: 'http://127.0.0.1:8080/v1',\n" +
    '      proxyMode: false,\n' +
    '      timeout: 60000,\n' +
    '      apps: {\n' + apps + '\n      }\n' +
    '    }\n' +
    '  };\n' +
    '})(window);\n';
}

function contentOffline() {
  return header('offline（纯离线引擎）') +
    '(function (global) {\n' +
    "  'use strict';\n" +
    '  global.DPA_CONFIG_LOCAL = {\n' +
    '    USE_MOCK: true,\n' +
    '    DIFY: { baseUrl: \'\', proxyMode: false, timeout: 60000, apps: {} }\n' +
    '  };\n' +
    '})(window);\n';
}

function ensureBackup() {
  if (!fs.existsSync(BACKUP) && fs.existsSync(LOCAL)) {
    fs.copyFileSync(LOCAL, BACKUP);
    console.log('[备份] 原 js/config.local.js → js/config.local.sandbox.js');
  }
}

function detectMode() {
  if (!fs.existsSync(LOCAL)) return '（不存在，将走离线降级）';
  const s = fs.readFileSync(LOCAL, 'utf8');
  if (/USE_MOCK\s*:\s*true/.test(s)) return 'offline（纯离线引擎）';
  if (/127\.0\.0\.1:8080|localhost:8080/.test(s)) return 'local-mock（本地契约桩）';
  if (/proxyMode\s*:\s*true/.test(s)) return '反向代理模式';
  const m = s.match(/baseUrl:\s*'([^']+)'/);
  return '直连模式 → ' + (m ? m[1] : '(未设置 baseUrl)');
}

function main() {
  const mode = (process.argv[2] || 'status').toLowerCase();

  if (mode === 'status') {
    console.log('当前 js/config.local.js 模式：' + detectMode());
    console.log('沙箱备份是否存在：' + (fs.existsSync(BACKUP) ? '是' : '否'));
    return;
  }

  ensureBackup();

  if (mode === 'local-mock') {
    fs.writeFileSync(LOCAL, contentLocalMock(), 'utf8');
    console.log('[完成] 已切换为本地契约桩模式。');
    console.log('       下一步：启动「演示 · 启动本地 Dify 契约桩」任务，然后访问 http://127.0.0.1:8080');
  } else if (mode === 'offline') {
    fs.writeFileSync(LOCAL, contentOffline(), 'utf8');
    console.log('[完成] 已切换为纯离线模式（USE_MOCK=true），全部功能走本地引擎。');
  } else if (mode === 'sandbox') {
    if (!fs.existsSync(BACKUP)) {
      console.error('[失败] 未找到备份 js/config.local.sandbox.js，无法恢复沙箱配置。');
      process.exit(1);
    }
    fs.copyFileSync(BACKUP, LOCAL);
    console.log('[完成] 已恢复课程沙箱配置（' + detectMode() + '）。');
    console.log('       注意：请先确认沙箱可达，否则页面会显示「离线演示模式」。');
  } else {
    console.error('未知模式：' + mode + '　可用：local-mock | offline | sandbox | status');
    process.exit(1);
  }
}

main();
