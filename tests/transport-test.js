/**
 * transport-test.js — dify-console.js 传输层与鉴权逻辑测试
 * ---------------------------------------------------------------------------
 * 这一层踩过三个真实的坑，每个都值得用测试钉死：
 *
 *   1. 密码字段是 **Base64**，不是明文、也不是 RSA。
 *      `qst123456`（9 字符）直接提交会被服务端判为 "Invalid encrypted data"，
 *      因为 Python 的 base64.b64decode 对长度非 4 倍数的串直接抛错。
 *      这不是"密码错"，纯粹是编码格式问题 —— 极易误诊。
 *
 *   2. Node 内置 fetch **不读 HTTP_PROXY**。在只允许代理出网的沙箱里，
 *      curl 能通、脚本却 ECONNREFUSED。必须自己实现代理传输。
 *
 *   3. 502 是"实例没起来"，不是"凭据不对"。错误分类错了会浪费大量时间。
 *
 * 前两部分是纯逻辑，离线可跑；末尾有一组联网冒烟，无代理时自动跳过。
 *
 * 运行：node tests/transport-test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const dc = require(path.join(ROOT, 'tools', 'dify-console.js'));

let pass = 0, fail = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    pass++;
    process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}\n`);
  } catch (e) {
    fail++;
    failures.push({ name, error: e });
    process.stdout.write(`  \x1b[31m✗\x1b[0m ${name}\n      ${e.message}\n`);
  }
}
function group(title) {
  process.stdout.write(`\n\x1b[1m${title}\x1b[0m\n`);
}

/* ======================================================================== */
group('一、密码编码：Base64（不是明文，也不是 RSA）');

test('encodePassword 输出合法 Base64', () => {
  const out = dc.encodePassword('qst123456');
  assert.strictEqual(out, 'cXN0MTIzNDU2');
  assert.match(out, /^[A-Za-z0-9+/]*={0,2}$/, '必须是标准 base64 字符集');
  assert.strictEqual(out.length % 4, 0, 'base64 长度必须是 4 的倍数');
});

test('encodePassword 可被 base64 正确还原（与 Dify 服务端同款解码）', () => {
  for (const pw of ['qst123456', 'root', 'MVe0%8F8', 'a', '密码123', 'p@ss w/ space']) {
    const decoded = Buffer.from(dc.encodePassword(pw), 'base64').toString('utf8');
    assert.strictEqual(decoded, pw, `往返失败: ${pw}`);
  }
});

test('回归：明文密码长度非 4 倍数会被服务端判为非法（证明必须编码）', () => {
  // 模拟 Python base64.b64decode(validate=False) 的行为：
  // 先丢弃非字母表字符，再要求长度为 4 的倍数
  const pythonDecodeOk = (s) => {
    const stripped = String(s).replace(/[^A-Za-z0-9+/=]/g, '');
    return stripped.length % 4 === 0 && stripped.length > 0;
  };
  // 真实密码直接发明文 → 服务端解码失败 → "Invalid encrypted data"
  assert.strictEqual(pythonDecodeOk('qst123456'), false, '9 字符明文应解码失败');
  assert.strictEqual(pythonDecodeOk('MVe0%8F8'), false, '含 % 的明文应解码失败');
  // 编码之后 → 合法
  assert.strictEqual(pythonDecodeOk(dc.encodePassword('qst123456')), true);
  assert.strictEqual(pythonDecodeOk(dc.encodePassword('MVe0%8F8')), true);
});

test('encodePassword 对非字符串入参不抛异常', () => {
  assert.doesNotThrow(() => dc.encodePassword(12345678));
  assert.strictEqual(Buffer.from(dc.encodePassword(12345678), 'base64').toString('utf8'), '12345678');
});

/* ======================================================================== */
group('二、代理判定：Node fetch 不读 HTTP_PROXY，必须自己处理');

const withEnv = (vars, fn) => {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  Object.assign(process.env, vars);
  try { fn(); } finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
};

test('无代理环境变量时返回 null（走直连）', () => {
  withEnv({ HTTP_PROXY: '', HTTPS_PROXY: '', NO_PROXY: '' }, () => {
    assert.strictEqual(dc.proxyFor(new URL('http://example.com/a')), null);
  });
});

test('设置了 HTTP_PROXY 时命中该代理', () => {
  withEnv({ HTTP_PROXY: 'http://127.0.0.1:57062', HTTPS_PROXY: '', NO_PROXY: '' }, () => {
    const p = dc.proxyFor(new URL('http://example.com/a'));
    assert.ok(p, '应返回代理');
    assert.strictEqual(p.hostname, '127.0.0.1');
    assert.strictEqual(p.port, '57062');
  });
});

test('HTTPS 目标在只有 HTTP_PROXY 时也复用（常见于本地代理）', () => {
  withEnv({ HTTP_PROXY: 'http://127.0.0.1:57062', HTTPS_PROXY: '', NO_PROXY: '' }, () => {
    assert.ok(dc.proxyFor(new URL('https://example.com/a')), 'HTTPS 应回退到 HTTP_PROXY');
  });
});

test('HTTPS_PROXY 优先于 HTTP_PROXY', () => {
  withEnv({ HTTP_PROXY: 'http://127.0.0.1:1111', HTTPS_PROXY: 'http://127.0.0.1:2222', NO_PROXY: '' }, () => {
    assert.strictEqual(dc.proxyFor(new URL('https://example.com/a')).port, '2222');
  });
});

test('NO_PROXY 命中时绕过代理', () => {
  withEnv({ HTTP_PROXY: 'http://127.0.0.1:57062', HTTPS_PROXY: '', NO_PROXY: 'example.com' }, () => {
    assert.strictEqual(dc.proxyFor(new URL('http://example.com/a')), null);
    assert.ok(dc.proxyFor(new URL('http://other.com/a')), '未命中的仍走代理');
  });
});

test('NO_PROXY=* 全部直连', () => {
  withEnv({ HTTP_PROXY: 'http://127.0.0.1:57062', HTTPS_PROXY: '', NO_PROXY: '*' }, () => {
    assert.strictEqual(dc.proxyFor(new URL('http://anything.com/a')), null);
  });
});

test('NO_PROXY 支持子域后缀（.example.com 匹配 api.example.com）', () => {
  withEnv({ HTTP_PROXY: 'http://127.0.0.1:57062', HTTPS_PROXY: '', NO_PROXY: '.example.com' }, () => {
    assert.strictEqual(dc.proxyFor(new URL('http://api.example.com/a')), null);
    assert.ok(dc.proxyFor(new URL('http://notexample.com/a')), '不应误伤同后缀串');
  });
});

test('回归：裸后缀也不得误伤同结尾的域名（notexample.com ≠ example.com）', () => {
  // 这是本测试抓到的真实 bug：朴素 endsWith 会把 notexample.com 判成命中
  withEnv({ HTTP_PROXY: 'http://127.0.0.1:57062', HTTPS_PROXY: '', NO_PROXY: 'example.com' }, () => {
    assert.strictEqual(dc.proxyFor(new URL('http://example.com/a')), null, '根域应命中');
    assert.strictEqual(dc.proxyFor(new URL('http://api.example.com/a')), null, '子域应命中');
    assert.ok(dc.proxyFor(new URL('http://notexample.com/a')), 'notexample.com 必须走代理');
    assert.ok(dc.proxyFor(new URL('http://example.com.evil.net/a')), '前缀伪装必须走代理');
  });
});

test('NO_PROXY 匹配不区分大小写', () => {
  withEnv({ HTTP_PROXY: 'http://127.0.0.1:57062', HTTPS_PROXY: '', NO_PROXY: 'Example.COM' }, () => {
    assert.strictEqual(dc.proxyFor(new URL('http://api.example.com/a')), null);
  });
});

test('bypassProxy 直接调用与 proxyFor 行为一致', () => {
  withEnv({ NO_PROXY: 'a.com,b.com' }, () => {
    assert.strictEqual(dc.bypassProxy('a.com'), true);
    assert.strictEqual(dc.bypassProxy('b.com'), true);
    assert.strictEqual(dc.bypassProxy('c.com'), false);
  });
});

/* ======================================================================== */
group('三、Set-Cookie 解析：node:http 的数组形态与 fetch 形态都要支持');

test('node:http 形态（普通对象，set-cookie 为数组）', () => {
  const jar = dc.parseSetCookies({
    'set-cookie': [
      'access_token=abc123; Path=/; HttpOnly; SameSite=Lax',
      'refresh_token=ref456; Path=/',
      'csrf_token=csrf789; Path=/'
    ]
  });
  assert.strictEqual(jar.access_token, 'abc123');
  assert.strictEqual(jar.refresh_token, 'ref456');
  assert.strictEqual(jar.csrf_token, 'csrf789');
});

test('node:http 形态（单条 set-cookie 为字符串）', () => {
  const jar = dc.parseSetCookies({ 'set-cookie': 'access_token=solo; Path=/' });
  assert.strictEqual(jar.access_token, 'solo');
});

test('fetch 形态（headers.getSetCookie）', () => {
  const jar = dc.parseSetCookies({ getSetCookie: () => ['access_token=f1; Path=/'] });
  assert.strictEqual(jar.access_token, 'f1');
});

test('fetch 形态（headers.get）', () => {
  const jar = dc.parseSetCookies({ get: (k) => (k === 'set-cookie' ? 'access_token=f2; Path=/' : null) });
  assert.strictEqual(jar.access_token, 'f2');
});

test('Cookie 值里含 = 时只按第一个 = 切分', () => {
  const jar = dc.parseSetCookies({ 'set-cookie': ['access_token=a=b=c; Path=/'] });
  assert.strictEqual(jar.access_token, 'a=b=c');
});

test('空/异常输入不抛异常', () => {
  assert.deepStrictEqual(dc.parseSetCookies(null), {});
  assert.deepStrictEqual(dc.parseSetCookies(undefined), {});
  assert.deepStrictEqual(dc.parseSetCookies({}), {});
  assert.deepStrictEqual(dc.parseSetCookies({ 'set-cookie': ['malformed'] }), {});
});

/* ======================================================================== */
group('四、失败分类：502 是实例挂了，404 是路径错，都不是凭据问题');

const fakeRes = (status, text) => ({ status, ok: false, text, json: null, headers: {} });

test('502 归类为「实例不可达」，并明确排除凭据原因', () => {
  const msg = dc.explainFailure(fakeRes(502, 'upstream connect failed'));
  assert.ok(msg, '应给出解释');
  assert.match(msg, /实例不可达/);
  assert.match(msg, /不是\*\*凭据/);
  assert.ok(!/密码|password/i.test(msg), '不应误导用户去查密码');
});

test('502 正文含 connection refused 时指出上游连接失败', () => {
  const msg = dc.explainFailure(fakeRes(502, 'upstream connect error: connection refused'));
  assert.match(msg, /网关上报上游连接失败/);
});

test('503 / 504 同样归类为实例不可达', () => {
  assert.match(dc.explainFailure(fakeRes(503, '')), /实例不可达/);
  assert.match(dc.explainFailure(fakeRes(504, '')), /实例不可达/);
});

test('404 归类为路径错误并打印当前 baseUrl', () => {
  const msg = dc.explainFailure(fakeRes(404, 'not found'));
  assert.match(msg, /路径不存在/);
  assert.ok(msg.includes(dc.BASE_URL), '应回显当前 baseUrl 便于核对');
});

test('401 含 csrf 时指向 CSRF 而不是密码', () => {
  const msg = dc.explainFailure(fakeRes(401, 'CSRF token missing'));
  assert.match(msg, /CSRF/);
  assert.match(msg, /csrf_token/);
});

test('普通 401 提示凭据过期（含有效期说明）', () => {
  const msg = dc.explainFailure(fakeRes(401, 'unauthorized'));
  assert.match(msg, /凭据无效或已过期/);
});

test('200 等正常状态返回 null（不误报）', () => {
  assert.strictEqual(dc.explainFailure({ status: 200, text: '', headers: {} }), null);
  assert.strictEqual(dc.explainFailure({ status: 405, text: '', headers: {} }), null);
});

/* ======================================================================== */
group('五、应用名映射：Dify 侧带编号前缀也要能对上 config.js');

test('精确名匹配', () => {
  const map = dc.matchToAppIds([{ id: 'a1', name: '首页数据管理' }]);
  assert.strictEqual(map.homeData.id, 'a1');
});

test('Dify 侧带编号前缀（WF-2 个人信息与风险预测）也能匹配', () => {
  const map = dc.matchToAppIds([{ id: 'a2', name: 'WF-2 个人信息与风险预测' }]);
  assert.strictEqual(map.riskPrediction.id, 'a2');
});

test('8 个应用全部可映射', () => {
  const apps = Object.values(dc.APPS).map((a, i) => ({ id: 'id' + i, name: a.code + ' ' + a.name }));
  const map = dc.matchToAppIds(apps);
  assert.strictEqual(Object.keys(map).length, 8, '应全部命中');
});

test('无匹配的 appId 不出现在结果里（而非报错）', () => {
  const map = dc.matchToAppIds([{ id: 'x', name: '完全无关的应用' }]);
  assert.strictEqual(Object.keys(map).length, 0);
});

test('APPS 与 config.js 的 8 个 appId 完全一致', () => {
  const fs = require('fs');
  const cfg = fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8');
  for (const id of Object.keys(dc.APPS)) {
    assert.ok(new RegExp(`\\b${id}\\s*:`).test(cfg), `config.js 缺少 appId: ${id}`);
  }
});

/* ======================================================================== */
group('六、fetchShim：把代理传输包装成 fetch 语义（供 api.js / real-dify-check 注入）');

(async () => {
  const httpSrv = require('http');

  // 本地回环必须绕过沙箱代理 —— 测试服务器只在 127.0.0.1 上，
  // 让请求绕地球一圈再回来既不必要，也会引入代理自身的行为差异。
  const savedNoProxy = process.env.NO_PROXY;
  process.env.NO_PROXY = '127.0.0.1,localhost';
  const restoreEnv = () => {
    if (savedNoProxy === undefined) delete process.env.NO_PROXY;
    else process.env.NO_PROXY = savedNoProxy;
  };

  const server = httpSrv.createServer((req, res) => {
    if (req.url === '/json') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'access_token=t1; Path=/' });
      return res.end(JSON.stringify({ data: { status: 'succeeded' } }));
    }
    if (req.url === '/echo') {
      let b = '';
      req.on('data', (c) => b += c);
      return req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ got: b, ct: req.headers['content-type'] || '' }));
      });
    }
    if (req.url === '/sse') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      return res.end('data: {"event":"message","answer":"你"}\n\ndata: {"event":"message","answer":"好"}\n\ndata: {"event":"message_end","conversation_id":"c1"}\n\n');
    }
    if (req.url === '/500') {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end('boom');
    }
    res.writeHead(404); res.end('nope');
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  // 本地回环必须绕过代理，否则会被沙箱代理拦走
  withEnv({ NO_PROXY: '127.0.0.1,localhost', HTTP_PROXY: 'http://127.0.0.1:57062', HTTPS_PROXY: '' }, () => {
    assert.strictEqual(dc.proxyFor(new URL(base + '/json')), null, '本地回环应绕过代理');
  });

  const t = async (name, fn) => {
    try { await fn(); pass++; process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}\n`); }
    catch (e) { fail++; failures.push({ name, error: e }); process.stdout.write(`  \x1b[31m✗\x1b[0m ${name}\n      ${e.message}\n`); }
  };

  await t('GET 返回 ok/status，json() 可解析', async () => {
    const res = await dc.fetchShim(base + '/json');
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.status, 200);
    const j = await res.json();
    assert.strictEqual(j.data.status, 'succeeded');
  });

  await t('headers.get / getSetCookie 与 fetch 行为一致', async () => {
    const res = await dc.fetchShim(base + '/json');
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.strictEqual(res.headers.get('x-absent'), null);
    assert.deepStrictEqual(res.headers.getSetCookie(), ['access_token=t1; Path=/']);
  });

  await t('POST 自动补 Content-Type 并原样传递 body', async () => {
    const res = await dc.fetchShim(base + '/echo', {
      method: 'POST',
      body: JSON.stringify({ inputs: { age: 30 } })
    });
    const j = await res.json();
    assert.strictEqual(j.got, '{"inputs":{"age":30}}');
    assert.match(j.ct, /application\/json/);
  });

  await t('显式 Content-Type 不被覆盖', async () => {
    const res = await dc.fetchShim(base + '/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'plain'
    });
    const j = await res.json();
    assert.strictEqual(j.ct, 'text/plain');
  });

  await t('非 2xx 时 ok=false，text() 保留原始响应体', async () => {
    const res = await dc.fetchShim(base + '/500');
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.status, 500);
    assert.strictEqual(await res.text(), 'boom');
  });

  await t('SSE：getReader() 可完整读出并按 \\n\\n 切帧', async () => {
    const res = await dc.fetchShim(base + '/sse');
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    const events = [];
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      buf += decoder.decode(r.value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) { events.push(buf.slice(0, i)); buf = buf.slice(i + 2); }
    }
    assert.strictEqual(events.length, 3, '应切出 3 个事件帧');
    assert.match(events[0], /"answer":"你"/);
    assert.match(events[2], /"conversation_id":"c1"/);
  });

  await t('reader 在 done 之后重复 read 仍返回 done', async () => {
    const res = await dc.fetchShim(base + '/json');
    const reader = res.body.getReader();
    await reader.read();
    assert.strictEqual((await reader.read()).done, true);
    assert.strictEqual((await reader.read()).done, true);
  });

  await t('网络失败时 reject（而不是返回假的响应）', async () => {
    let threw = false;
    try {
      await dc.fetchShim('http://127.0.0.1:1/none');
    } catch { threw = true; }
    assert.strictEqual(threw, true, '连不上应当抛错');
  });

  server.close();
  restoreEnv();   // 还原 NO_PROXY，避免影响后续用例

  /* ======================================================================== */
  group('七、联网冒烟（无代理或实例离线时自动跳过）');

  const proxy = dc.proxyFor(new URL(dc.BASE_URL));
  if (!proxy) {
    process.stdout.write('  \x1b[33m—\x1b[0m 未配置代理，跳过联网用例\n');
  } else {
    try {
      const r = await dc.send('GET', dc.BASE_URL + '/console/api/setup', { headers: {} });
      if (r.status === 502 || r.status === 503 || r.status === 504) {
        // 实例离线不算失败 —— 这是环境状态，不是代码缺陷
        process.stdout.write(`  \x1b[33m—\x1b[0m 实例离线（HTTP ${r.status}，网关无法连上后端容器），跳过\n`);
      } else {
        process.stdout.write(`  \x1b[32m✓\x1b[0m 实例在线（HTTP ${r.status}）\n`);
        pass++;
      }
      assert.ok(r.status > 0, '应拿到 HTTP 状态码');
      process.stdout.write('  \x1b[32m✓\x1b[0m 代理传输层可用（成功经代理拿到 HTTP 响应）\n');
      pass++;
    } catch (e) {
      fail++;
      failures.push({ name: '代理传输层', error: e });
      process.stdout.write(`  \x1b[31m✗\x1b[0m 代理传输层失败: ${e.message}\n`);
    }
  }

  /* ---------------- 汇总 ---------------- */
  process.stdout.write('\n' + '='.repeat(58) + '\n');
  if (fail === 0) {
    process.stdout.write(`\x1b[32m===== 结果：${pass} 通过 / 0 失败 =====\x1b[0m\n`);
  } else {
    process.stdout.write(`\x1b[31m===== 结果：${pass} 通过 / ${fail} 失败 =====\x1b[0m\n`);
    for (const f of failures) process.stdout.write(`  · ${f.name}: ${f.error.message}\n`);
  }
  process.exit(fail === 0 ? 0 : 1);
})();
