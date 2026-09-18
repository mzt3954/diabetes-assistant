/**
 * demo-check.js — 答辩前一键体检：确认本地站点与 Dify 链路是否可用
 *
 * 用法：
 *   node tools/demo-check.js                     # 检查 127.0.0.1:8080 的站点与 /v1
 *   node tools/demo-check.js --port 8080
 *   node tools/demo-check.js --base http://123.249.115.157:48823
 *
 * 检查项：
 *   1) 静态站点是否可访问（index.html）
 *   2) 当前 js/config.local.js 处于哪种模式
 *   3) /v1/parameters 是否可达（Dify 或本地桩）
 *   4) 8 个应用的 Key 是否已配置（形如 app- 开头）
 *   5) 给出结论与可执行的下一步建议
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOCAL = path.join(ROOT, 'js', 'config.local.js');

function arg(name, dft) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dft;
}

const PORT = Number(arg('--port', '8080'));
const BASE_OVERRIDE = arg('--base', '');

const APPS = [
  'homeData', 'doctorChat', 'riskPrediction', 'lifePlan',
  'healthNews', 'checkinAnalysis', 'aiAssistant', 'adminAgent',
];

function readLocalConfig() {
  if (!fs.existsSync(LOCAL)) return { exists: false, raw: '' };
  return { exists: true, raw: fs.readFileSync(LOCAL, 'utf8') };
}

function parseBaseUrl(raw) {
  const m = raw.match(/baseUrl:\s*'([^']*)'/);
  return m ? m[1] : '';
}

function countKeys(raw) {
  const found = {};
  APPS.forEach((a) => {
    const re = new RegExp(a + "\\s*:\\s*\\{\\s*apiKey:\\s*'([^']*)'");
    const m = raw.match(re);
    found[a] = m ? m[1] : '';
  });
  return found;
}

async function probe(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    return { ok: true, status: r.status };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? '超时' : e.message };
  } finally {
    clearTimeout(t);
  }
}

(async () => {
  console.log('='.repeat(64));
  console.log('答辩前环境体检 · 糖尿病预治智能助手');
  console.log('='.repeat(64));

  const cfg = readLocalConfig();
  console.log('\n[1] 本地配置 js/config.local.js');
  if (!cfg.exists) {
    console.log('  [--]  文件不存在 → 将走本地降级引擎（离线演示模式，功能完整）');
  } else {
    const s = cfg.raw;
    const mock = /USE_MOCK\s*:\s*true/.test(s);
    const keys = countKeys(s);
    const configured = Object.keys(keys).filter((k) => /^app-/.test(keys[k]));
    console.log('  [OK]  文件存在');
    console.log('        USE_MOCK = ' + (mock ? 'true（强制离线）' : 'false（优先在线）'));
    console.log('        baseUrl  = ' + (parseBaseUrl(s) || '(未设置)'));
    console.log('        已配置 Key 的应用：' + configured.length + ' / ' + APPS.length);
    APPS.forEach((a) => {
      const k = keys[a] || '';
      console.log('          ' + (k ? '✓' : '·') + ' ' + a.padEnd(18) + (k ? k : '（未配置 → 该功能走本地引擎）'));
    });
  }

  const base = BASE_OVERRIDE ||
    (cfg.exists && parseBaseUrl(cfg.raw) ? parseBaseUrl(cfg.raw).replace(/\/v1\/?$/, '') : '') ||
    ('http://127.0.0.1:' + PORT);

  console.log('\n[2] 静态站点 ' + 'http://127.0.0.1:' + PORT + '/index.html');
  const site = await probe('http://127.0.0.1:' + PORT + '/index.html', 5000);
  if (site.ok && site.status === 200) console.log('  [OK]  站点可访问（HTTP 200）');
  else console.log('  [!!]  站点不可访问：' + (site.error || 'HTTP ' + site.status) +
    '\n         → 请先在 VS Code 运行任务「演示 · 启动本地 Dify 契约桩」或「演示 · 仅启动静态站点」');

  console.log('\n[3] Dify API ' + base + '/v1/parameters');
  const api = await probe(base + '/v1/parameters', 8000);
  if (api.ok) {
    console.log('  [OK]  API 可达（HTTP ' + api.status + '）');
    if (api.status === 401) console.log('        （401 属正常：未带 Key 时 Dify 与桩服务都会拒绝）');
  } else {
    console.log('  [!!]  API 不可达：' + (api.error || 'HTTP ' + api.status));
    console.log('         → 若用课程沙箱，请确认沙箱地址与端口是否仍有效；');
    console.log('         → 若用本地桩，请确认「演示 · 启动本地 Dify 契约桩」任务已运行。');
  }

  console.log('\n[4] 结论');
  const ok = site.ok && site.status === 200 && api.ok;
  if (ok) {
    console.log('  ✓ 本地站点与 Dify 链路均可用，可以开始演示。');
    console.log('    浏览器访问：http://127.0.0.1:' + PORT + '/index.html');
    console.log('    演示账号：admin / admin123（管理员）　user / user123（普通用户）');
  } else if (site.ok && site.status === 200) {
    console.log('  △ 站点可用但 Dify 链路不可用：页面会自动降级为「离线演示模式」，功能仍完整。');
    console.log('    若希望演示在线模式，请切换到本地桩：node tools/demo-mode.js local-mock');
  } else {
    console.log('  ✗ 站点未启动，无法演示。请先运行启动任务。');
  }
  console.log('='.repeat(64));
})().catch((e) => { console.error(e); process.exit(1); });
