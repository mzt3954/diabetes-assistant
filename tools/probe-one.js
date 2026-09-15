'use strict';
/**
 * 单个应用的定点探测脚本（排障用）。
 * 用法: DIFY_TIMEOUT=180000 node tools/probe-one.js <appId>
 */
const fs = require('fs');
const path = require('path');
const dc = require('./dify-console.js');

const ROOT = path.resolve(__dirname, '..');
const appId = process.argv[2] || 'homeData';

const src = fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8');
const km = src.match(new RegExp(appId + ":\\s*\\{[^}]*apiKey\\s*:\\s*'([^']*)'"));
const bm = src.match(/baseUrl\s*:\s*'([^']*)'/);
const key = km ? km[1] : '';
const base = bm ? bm[1] : '';

if (!key || !base) {
  console.error('config.js 里没找到该应用的 apiKey 或 baseUrl');
  process.exit(2);
}
console.log('应用  :', appId);
console.log('基址  :', base);
console.log('Key   :', key.slice(0, 12) + '...');

const isWorkflow = !/^(doctorChat|aiAssistant|adminAgent)$/.test(appId);
const endpoint = isWorkflow ? '/workflows/run' : '/chat-messages';
const body = isWorkflow
  ? { inputs: {}, response_mode: 'blocking', user: 'probe-1' }
  : { inputs: {}, query: '你好，请做一次简短自我介绍。', response_mode: 'blocking', user: 'probe-1' };

(async () => {
  const t0 = Date.now();
  try {
    const r = await dc.fetchShim(base + endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await r.text();
    console.log('结果  : HTTP ' + r.status + '  耗时 ' + (Date.now() - t0) + 'ms');
    console.log(text.slice(0, 1200));

    // 完整原文落盘，便于检查「JSON 是否藏在 <think> 之后」
    const out = path.join(ROOT, 'tools', '.probe-' + appId + '.json');
    let raw = text;
    try {
      const j = JSON.parse(text);
      raw = (j.data && j.data.outputs && j.data.outputs.result) || j.answer || text;
    } catch (e) { /* 保持原文 */ }
    fs.writeFileSync(out, String(raw), 'utf8');
    console.log('');
    console.log('输出原文已写入: tools/.probe-' + appId + '.json  (' + String(raw).length + ' 字符)');
  } catch (e) {
    console.log('错误  : ' + e.message + '  耗时 ' + (Date.now() - t0) + 'ms');
  }
})();
