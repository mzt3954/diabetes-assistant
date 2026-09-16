/**
 * dsl-test.js — Dify 应用 DSL 契约测试
 * ---------------------------------------------------------------------------
 * dify-apps/*.yml 是「前端契约的另一种表达形式」：
 *   - 工作流的 end 节点**必须只输出一个 result 变量**，否则前端 unwrap() 拆不出
 *     对象，会判「契约不匹配」并静默降级回本地引擎；
 *   - 所有 {{#nodeId.field#}} 与 value_selector 必须指向真实存在的节点；
 *   - 应用名必须能被 js/config.js 的 appId 匹配上，否则取到 Key 也回写不进去。
 * 这些约束目前没有任何东西守着，改坏 DSL 不会有任何反馈。本测试补上这道闸。
 *
 * 运行：node tests/dsl-test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const APP_DIR = path.join(ROOT, 'dify-apps');
const DSL_VERSION = '0.6.0';

/** 期望的 8 个应用：编号 → 模式 */
const EXPECTED = {
  'WF-1': 'workflow',
  'WF-2': 'workflow',
  'WF-3': 'workflow',
  'WF-4': 'workflow',
  'WF-5': 'workflow',
  'CHAT-1': 'advanced-chat',
  'CHAT-2': 'advanced-chat',
  'AGENT-1': 'advanced-chat'
};

/**
 * start 变量类型枚举。
 *
 * 这一版枚举是**真实实例校验失败时返回的**，不是猜的 —— 导入时若类型非法，
 * 服务 API 会报：
 *   1 validation error for VariableEntity
 *   type: Input should be 'text-input', 'select', 'paragraph', 'number',
 *         'external_data_tool', 'file', 'file-list', 'checkbox' or 'json_object'
 *
 * 教训：早先版本的这份枚举是凭文档推测的，里面含 'json' / 'url' / 'files'，
 * 结果测试放行了一个实例根本不接受的值（真实枚举里有 'json_object'，没有 'json'）。
 * 凡是"允许清单"类的常量，必须用被测系统的真实反馈来校准，否则测试形同虚设。
 */
const VAR_TYPES = new Set([
  'text-input', 'select', 'paragraph', 'number',
  'external_data_tool', 'file', 'file-list', 'checkbox', 'json_object'
]);

/* ---------- 断言框架（与 logic-test.js 保持一致的输出格式） ---------- */
let pass = 0, fail = 0;
const failures = [];
const queue = [];
function test(name, fn) { queue.push({ name, fn }); }
function suite(title) { queue.push({ name: null, title }); }
function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function eq(a, b, msg) { if (a !== b) throw new Error((msg || '') + ` 期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`); }

/* ---------- 载入 config.js，取 appId → 名称映射 ---------- */
function loadAppNames() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8');
  const sandbox = { window: {} };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const CFG = sandbox.window.DPA_CONFIG;
  assert(CFG && CFG.DIFY && CFG.DIFY.apps, 'config.js 未导出 DPA_CONFIG.DIFY.apps');
  const map = {};
  Object.keys(CFG.DIFY.apps).forEach((id) => { map[id] = CFG.DIFY.apps[id].name; });
  return map;
}

/* ---------- 载入全部 DSL ---------- */
function loadDocs() {
  assert(fs.existsSync(APP_DIR), '缺少 dify-apps/ 目录，请先运行 node tools/gen-dsl.js');
  const files = fs.readdirSync(APP_DIR).filter((f) => /\.ya?ml$/i.test(f)).sort();
  return files.map((f) => {
    const text = fs.readFileSync(path.join(APP_DIR, f), 'utf8');
    return { file: f, text, doc: yaml.load(text) };
  });
}

const APP_NAMES = loadAppNames();
const DOCS = loadDocs();

/** 递归收集对象里所有字符串（用于扫描 {{#...#}} 引用） */
function collectStrings(v, out) {
  out = out || [];
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => collectStrings(x, out));
  else if (v && typeof v === 'object') Object.keys(v).forEach((k) => collectStrings(v[k], out));
  return out;
}

/** 从应用名里识别编号（兼容旧命名 "WF-2 个人信息与风险预测"） */
function codeOf(name) {
  const m = String(name || '').match(/^(WF-\d|CHAT-\d|AGENT-\d)/);
  return m ? m[1] : null;
}

/** 从文件名里识别编号，如 "WF-2-risk-prediction.yml" → "WF-2" */
function codeOfFile(file) {
  const m = String(file || '').match(/^(WF-\d|CHAT-\d|AGENT-\d)/);
  return m ? m[1] : null;
}

/**
 * 应用编号来源：**优先取文件名前缀**。
 * 应用显示名已按产品要求去掉 WF-/CHAT-/AGENT- 前缀，编号只保留在文件名与文档中，
 * 因此这里不能再依赖 app.name 解析编号。
 */
function codeOfDoc(d) {
  return codeOfFile(d && d.file) || codeOf(d && d.doc && d.doc.app && d.doc.app.name);
}

/* ================================================================
   用例
   ================================================================ */

suite('【DSL · 文件与清单】');

test('dify-apps/ 下恰好 8 个 DSL 文件', () => {
  eq(DOCS.length, 8, '文件数');
});

test('8 个应用编号齐备且无多余', () => {
  const found = DOCS.map((d) => codeOfDoc(d));
  Object.keys(EXPECTED).forEach((code) => {
    assert(found.indexOf(code) > -1, '缺少 ' + code);
  });
  found.forEach((c) => {
    assert(c && EXPECTED[c], '出现未预期的应用编号：' + c);
  });
});

test('每个 DSL 的应用名都能匹配到 config.js 的 appId', () => {
  Object.keys(APP_NAMES).forEach((id) => {
    const want = APP_NAMES[id];
    const hit = DOCS.some((d) => {
      const n = String(d.doc.app.name);
      return n.indexOf(want) > -1 || want.indexOf(n) > -1;
    });
    assert(hit, 'appId ' + id + '（' + want + '）在 dify-apps/ 中找不到对应应用');
  });
});

suite('【DSL · 顶层结构】');

DOCS.forEach(({ file, doc }) => {
  test(file + ' 顶层字段合法', () => {
    // 必须加引号：Dify 导入要求 version 是字符串，非字符串会被拒
    eq(typeof doc.version, 'string', 'version 必须是字符串');
    eq(doc.version, DSL_VERSION, 'version');
    eq(doc.kind, 'app', 'kind');
    assert(Array.isArray(doc.dependencies), 'dependencies 必须是数组');
    assert(doc.app && typeof doc.app.name === 'string' && doc.app.name, 'app.name 不能为空');
    assert(typeof doc.app.mode === 'string' && doc.app.mode, 'app.mode 不能为空');
    assert(doc.workflow && doc.workflow.graph, '缺少 workflow.graph');
    assert(Array.isArray(doc.workflow.graph.nodes), 'nodes 必须是数组');
    assert(Array.isArray(doc.workflow.graph.edges), 'edges 必须是数组');
    assert(doc.workflow.graph.viewport && typeof doc.workflow.graph.viewport.zoom === 'number', 'viewport.zoom 必须是数字');
  });

  test(file + ' 模式与预期一致', () => {
    const code = codeOfDoc({ file, doc });
    eq(doc.app.mode, EXPECTED[code], code + ' 的 mode');
  });
});

suite('【DSL · 图结构完整性】');

DOCS.forEach(({ file, doc }) => {
  const nodes = doc.workflow.graph.nodes;
  const edges = doc.workflow.graph.edges;
  const byId = {};
  nodes.forEach((n) => { byId[n.id] = n; });

  test(file + ' 节点与边的数量、连通性合理', () => {
    assert(nodes.length >= 2, '至少要有 start + 终止节点');
    assert(edges.length >= nodes.length - 1, '边数不足，图不连通');
  });

  test(file + ' 恰好一个 start 节点，且存在终止节点', () => {
    const starts = nodes.filter((n) => n.data.type === 'start');
    eq(starts.length, 1, 'start 节点数');
    const ends = nodes.filter((n) => n.data.type === 'end' || n.data.type === 'answer');
    assert(ends.length >= 1, '缺少 end / answer 终止节点');
  });

  test(file + ' 每条边的端点存在且类型自洽', () => {
    edges.forEach((e) => {
      assert(byId[e.source], '边 ' + e.id + ' 的 source 不存在：' + e.source);
      assert(byId[e.target], '边 ' + e.id + ' 的 target 不存在：' + e.target);
      eq(e.data.sourceType, byId[e.source].data.type, e.id + ' 的 sourceType');
      eq(e.data.targetType, byId[e.target].data.type, e.id + ' 的 targetType');
      eq(e.sourceHandle, 'source', e.id + ' 的 sourceHandle');
      eq(e.targetHandle, 'target', e.id + ' 的 targetHandle');
    });
  });

  test(file + ' 所有节点都带 position 且 y 是数字', () => {
    nodes.forEach((n) => {
      assert(n.position && typeof n.position.y === 'number', n.id + ' 缺少 position.y');
      assert(typeof n.data.title === 'string' && n.data.title, n.id + ' 缺少 data.title');
    });
  });

  test(file + ' 每个 llm 节点都配了 provider 与模型名', () => {
    const llms = nodes.filter((n) => n.data.type === 'llm');
    assert(llms.length >= 1, '至少需要一个 llm 节点');
    llms.forEach((n) => {
      assert(n.data.model && n.data.model.provider, n.id + ' 缺少 model.provider');
      assert(n.data.model.name, n.id + ' 缺少 model.name');
      eq(n.data.model.mode, 'chat', n.id + ' 的 model.mode');
      assert(Array.isArray(n.data.prompt_template) && n.data.prompt_template.length >= 1,
        n.id + ' 缺少 prompt_template');
    });
  });
});

suite('【DSL · 前端契约（最关键）】');

DOCS.filter((d) => d.doc.app.mode === 'workflow').forEach(({ file, doc }) => {
  const nodes = doc.workflow.graph.nodes;

  test(file + ' end 节点恰好输出一个 result 变量', () => {
    const ends = nodes.filter((n) => n.data.type === 'end');
    eq(ends.length, 1, 'end 节点数');
    const outs = ends[0].data.outputs;
    assert(Array.isArray(outs), 'end.outputs 必须是数组');
    // 前端 unwrap() 只认单键包装。拆成多键时 Dify 会把各值序列化成字符串，
    // 前端 arr() 拿到字符串而非数组 → 判空 → 抛契约错误并降级。
    eq(outs.length, 1, 'end 只能输出 1 个变量（前端 unwrap 的硬要求）');
    eq(outs[0].variable, 'result', '输出变量名必须是 result');
    eq(outs[0].value_type, 'string', 'result 的 value_type');
    assert(Array.isArray(outs[0].value_selector) && outs[0].value_selector.length === 2,
      'value_selector 必须是 [nodeId, field] 两元组');
  });

  test(file + ' end 的 value_selector 指向真实存在的 llm 节点', () => {
    const ends = nodes.filter((n) => n.data.type === 'end');
    const sel = ends[0].data.outputs[0].value_selector;
    const target = nodes.filter((n) => n.id === sel[0])[0];
    assert(target, 'value_selector 指向了不存在的节点：' + sel[0]);
    eq(target.data.type, 'llm', sel[0] + ' 不是 llm 节点');
    eq(sel[1], 'text', '应取 llm 节点的 text 字段');
  });
});

DOCS.filter((d) => d.doc.app.mode === 'advanced-chat').forEach(({ file, doc }) => {
  const nodes = doc.workflow.graph.nodes;

  test(file + ' 有 answer 节点且引用真实节点', () => {
    const answers = nodes.filter((n) => n.data.type === 'answer');
    eq(answers.length, 1, 'answer 节点数');
    const m = String(answers[0].data.answer).match(/\{\{#([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)#\}\}/);
    assert(m, 'answer 应引用某个节点的字段，实际：' + answers[0].data.answer);
    const target = nodes.filter((n) => n.id === m[1])[0];
    assert(target, 'answer 引用了不存在的节点：' + m[1]);
    eq(target.data.type, 'llm', m[1] + ' 不是 llm 节点');
  });

  test(file + ' 对话应用的 start 节点不含输入变量', () => {
    const start = nodes.filter((n) => n.data.type === 'start')[0];
    eq((start.data.variables || []).length, 0, '前端只传 query，start 不应声明变量');
  });
});

suite('【DSL · 引用与变量类型】');

DOCS.forEach(({ file, doc }) => {
  const nodes = doc.workflow.graph.nodes;
  const ids = new Set(nodes.map((n) => n.id));

  test(file + ' 所有 {{#nodeId.field#}} 引用都指向存在的节点', () => {
    const refs = [];
    collectStrings(doc).forEach((s) => {
      const re = /\{\{#([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)#\}\}/g;
      let m;
      while ((m = re.exec(s)) !== null) refs.push(m[1]);
    });
    assert(refs.length > 0, '一个变量引用都没有，提示词里没带任何输入');
    refs.forEach((id) => {
      if (id === 'sys') return;              // {{#sys.query#}} 是平台内置变量
      assert(ids.has(id), '引用了不存在的节点：' + id);
    });
  });

  test(file + ' start 变量类型都在官方枚举内', () => {
    const start = nodes.filter((n) => n.data.type === 'start')[0];
    (start.data.variables || []).forEach((v) => {
      assert(VAR_TYPES.has(v.type), '非法变量类型：' + v.variable + ' → ' + v.type);
      assert(typeof v.variable === 'string' && v.variable, '变量名不能为空');
      assert(typeof v.label === 'string' && v.label, v.variable + ' 缺少 label');
      assert(typeof v.required === 'boolean', v.variable + ' 的 required 必须是布尔值');
    });
  });
});

/* ================================================================
   运行
   ================================================================ */
(async () => {
  console.log('===== Dify DSL 契约测试 =====\n');
  for (const item of queue) {
    if (item.name === null) { console.log('\n' + item.title); continue; }
    try {
      await item.fn();
      pass++;
      console.log('✅ ' + item.name);
    } catch (e) {
      fail++;
      const msg = (e && e.message) || String(e);
      failures.push(item.name + ' → ' + msg);
      console.log('❌ ' + item.name + '\n     ↳ ' + msg);
    }
  }
  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
  if (failures.length) {
    console.log('\n失败用例：');
    failures.forEach((f) => console.log('  · ' + f));
  }
  process.exit(fail ? 1 : 0);
})();
