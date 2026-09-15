/**
 * logic-test.js — 核心逻辑单元测试
 * 覆盖：风险预测算法分档、打卡分析、权限模型、XSS 转义、数据层 CRUD、
 *      口令哈希、时区一致性、改名数据迁移、会话持久化、Dify 输出归一化、跳转白名单
 * 运行：node tests/logic-test.js
 *
 * 【v2.1 修复】断言框架改为串行 await：
 *   旧实现在 test() 里同步调用 fn()，凡是返回 Promise 的用例（降级相关的 3 个）
 *   即使内部断言失败也永远显示 ✅ —— 异步异常被吞掉，测试形同虚设。
 *   现在统一 `await fn()`，失败会真实计入 fail。
 */
const { JSDOM } = require('jsdom');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
// 注意顺序：store.js 在**加载期**即执行 `var Crypto = global.DPA_Crypto`，
// 因此 crypto.js 必须排在 store.js 之前。
const FILES = [
  'js/config.js', 'js/crypto.js', 'js/seed.js', 'js/store.js',
  'js/ui.js', 'js/auth.js', 'js/mock-engine.js', 'js/api.js'
];

/* 在 jsdom 中加载全部模块，得到带 localStorage 的运行环境 */
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost/',
  runScripts: 'outside-only',
  pretendToBeVisual: true
});
const { window } = dom;
window.fetch = () => Promise.reject(new Error('no network'));
FILES.forEach((f) => {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
  window.eval(code);
});
const DPA = window.DPA;

/*
 * 强制离线基线。
 *
 * config.js 可能已被 dify-console.js 的 write-config 写入真实 Key，
 * 那样 isDifyReady() 会返回 true，本套"离线降级"用例的前提就不成立了 ——
 * 测试结果会随实例接线状态漂移。这里统一清空 Key，
 * 让单元测试与「有没有接真实 Dify」完全无关。
 * （真实联调由 tests/real-dify-check.js 负责。）
 */
Object.keys(window.DPA_CONFIG.DIFY.apps).forEach((id) => {
  window.DPA_CONFIG.DIFY.apps[id].apiKey = '';
});

/* ---------- 断言框架（支持 async） ---------- */
let pass = 0, fail = 0;
const failures = [];
const queue = [];
/** 框架自检指标：证明异步用例确实被 await，而不是被静默吞掉 */
const HARNESS = { asyncCases: 0, asyncFailures: 0 };

/** 登记用例；fn 可以是同步函数，也可以返回 Promise */
function test(name, fn) { queue.push({ name, fn }); }
/** 分组标题 */
function suite(title) { queue.push({ name: null, title }); }

function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function eq(a, b, msg) { if (a !== b) throw new Error((msg || '') + ` 期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`); }

/* ================================================================
   用例定义
   ================================================================ */

/* ---------- 1. 风险预测算法 ---------- */
suite('【风险预测 · CDRS 评分】');

test('低风险：年轻、BMI 正常、无家族史', () => {
  const r = DPA.mock.predictRisk({ age: 28, sex: '女', height: 165, weight: 55, waistline: 72, familyHistory: '无', systolicPressure: 110 });
  eq(r.level, '低风险', '等级');
  assert(r.score <= 8, '分数应 <=8，实际 ' + r.score);
  eq(r.bmi, 20.2, 'BMI');
  assert(r.advice.length > 0, '应有建议');
});

test('高风险：年长、肥胖、腰围超标、有家族史、血压高', () => {
  const r = DPA.mock.predictRisk({ age: 62, sex: '男', height: 170, weight: 92, waistline: 102, familyHistory: '有', systolicPressure: 145 });
  eq(r.level, '高风险', '等级');
  assert(r.score >= 16, '分数应 >=16，实际 ' + r.score);
  assert(r.probability > 60, '概率应 >60，实际 ' + r.probability);
  assert(r.factors.length > 0, '应有风险归因');
  assert(r.factors.indexOf('糖尿病家族史') >= 0, '应识别家族史');
});

test('中风险：中等年龄 + 超重 + 家族史', () => {
  const r = DPA.mock.predictRisk({ age: 45, sex: '男', height: 172, weight: 78, waistline: 92, familyHistory: '有', systolicPressure: 125 });
  eq(r.level, '中风险', '等级');
  assert(r.score >= 9 && r.score <= 15, '分数应在 9~15，实际 ' + r.score);
});

test('妊娠糖尿病归因：女性 + 妊娠史', () => {
  const r = DPA.mock.predictRisk({ age: 30, sex: '女', height: 160, weight: 70, waistline: 88, familyHistory: '无', systolicPressure: 120, isPregnancy: '有' });
  eq(r.riskType, '妊娠型糖尿病', '风险倾向');
});

test('风险分数上限为 27，概率不超过 95%', () => {
  const r = DPA.mock.predictRisk({ age: 80, sex: '男', height: 165, weight: 110, waistline: 130, familyHistory: '有', systolicPressure: 180 });
  assert(r.score <= 27, '分数不应超过 27');
  assert(r.probability <= 95, '概率不应超过 95');
});

test('高风险建议中包含就医提示', () => {
  const r = DPA.mock.predictRisk({ age: 62, sex: '男', height: 170, weight: 92, waistline: 102, familyHistory: '有', systolicPressure: 145 });
  assert(r.advice.join('').indexOf('内分泌科') >= 0, '应提示就诊内分泌科');
});

/* ---------- 1b. 家族史否定词（修复正则误判） ---------- */
suite('【风险预测 · 家族史语义】');

test('"没有" 不应被判定为有家族史', () => {
  const r = DPA.mock.predictRisk({ age: 30, sex: '男', height: 175, weight: 70, waistline: 82, familyHistory: '没有', systolicPressure: 118 });
  assert(r.factors.indexOf('糖尿病家族史') < 0, '"没有" 不应计入家族史因子');
});

test('"无" / "否" / 空串 均视为无家族史', () => {
  ['无', '否', '', null, undefined].forEach((v) => {
    const r = DPA.mock.predictRisk({ age: 30, sex: '男', height: 175, weight: 70, waistline: 82, familyHistory: v, systolicPressure: 118 });
    assert(r.factors.indexOf('糖尿病家族史') < 0, JSON.stringify(v) + ' 不应计入家族史因子');
  });
});

test('"有" / "是" / "yes" 均视为有家族史', () => {
  ['有', '是', 'yes', true].forEach((v) => {
    const r = DPA.mock.predictRisk({ age: 45, sex: '男', height: 175, weight: 70, waistline: 82, familyHistory: v, systolicPressure: 118 });
    assert(r.factors.indexOf('糖尿病家族史') >= 0, JSON.stringify(v) + ' 应计入家族史因子');
  });
});

/* ---------- 2. 打卡分析 ---------- */
suite('【打卡分析 · 三维指标】');

const PLAN = [
  { id: 1, type: '饮食', title: '早餐' }, { id: 2, type: '饮食', title: '午餐' },
  { id: 3, type: '运动', title: '快走' }, { id: 4, type: '运动', title: '力量训练' }
];

/** 以「本地日期」构造最近 n 天的打卡记录（与生产写入口径一致） */
function punchDays(n, planIds) {
  const byId = {};
  PLAN.forEach((p) => { byId[p.id] = p.type; });
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = DPA.store.dateKey(d);
    planIds.forEach((id) => out.push({ _date: ds, _planId: id, punch_type: byId[id] || '其他', completion_status: '已完成' }));
  }
  return out;
}

test('零打卡：评级为需改进，完成率 0', () => {
  const r = DPA.mock.analyzeCheckin(PLAN, [], 7);
  eq(r.rate, 0, '完成率');
  eq(r.evaluation, '需改进', '评级');
  assert(r.suggestions.length > 0, '应有改进建议');
});

test('满勤打卡：评级优秀，连续 7 天', () => {
  const r = DPA.mock.analyzeCheckin(PLAN, punchDays(7, [1, 2, 3, 4], '饮食'), 7);
  eq(r.rate, 100, '完成率');
  eq(r.evaluation, '优秀', '评级');
  eq(r.streak, 7, '连续天数');
  eq(r.balance, 100, '类型均衡度');
});

test('仅运动打卡：类型均衡度为 0，给出饮食建议', () => {
  const r = DPA.mock.analyzeCheckin(PLAN, punchDays(7, [3, 4], '运动'), 7);
  eq(r.balance, 0, '均衡度');
  assert(r.suggestions.join('').indexOf('饮食') >= 0, '应提示加强饮食记录');
});

test('完成率被裁剪在 0~100（多余打卡不产生 >100%）', () => {
  // 窗口 1 天、计划 4 项，却塞入 40 条打卡：旧实现分子不设限会得到 1000%
  const punches = [];
  for (let k = 0; k < 10; k++) {
    [1, 2, 3, 4].forEach((id) => punches.push({ _date: DPA.store.dateKey(new Date()), _planId: id, punch_type: '饮食', completion_status: '已完成' }));
  }
  const r = DPA.mock.analyzeCheckin(PLAN, punches, 1, DPA.store.dateKey(new Date()));
  assert(r.rate <= 100, '完成率不应超过 100，实际 ' + r.rate);
  assert(r.rate >= 0, '完成率不应为负');
});

/* ---------- 2b. 时区一致性（核心缺陷回归） ---------- */
suite('【时区一致性 · 本地日期键】');

test('dateKey 使用本地时区，而非 UTC', () => {
  // 本地 2026-09-14 03:00，在 UTC+8 下其 UTC 表示是 2026-09-13T19:00Z
  const localEarlyMorning = new Date(2026, 8, 14, 3, 0, 0);
  eq(DPA.store.dateKey(localEarlyMorning), '2026-09-14', 'store.dateKey 应为本地日期');
  eq(DPA.ui.toDateKey(localEarlyMorning), '2026-09-14', 'ui.toDateKey 应为本地日期');
  eq(localEarlyMorning.toISOString().slice(0, 10), '2026-09-13', '（前提）UTC 日期确实落后一天');
});

test('store.dateKey 与 ui.toDateKey 口径完全一致', () => {
  const samples = [
    new Date(2026, 0, 1, 0, 0, 0), new Date(2026, 5, 30, 23, 59, 59),
    new Date(2026, 11, 31, 8, 0, 0), new Date(2026, 8, 14, 3, 0, 0)
  ];
  samples.forEach((d) => eq(DPA.store.dateKey(d), DPA.ui.toDateKey(d), '日期键应一致'));
});

test('GMT+8 凌晨场景：窗口锚定本地日期后当天打卡被计入', () => {
  const anchor = '2026-09-14';
  const punches = [1, 2, 3, 4].map((id) => ({ _date: anchor, _planId: id, punch_type: '饮食', completion_status: '已完成' }));
  const r = DPA.mock.analyzeCheckin(PLAN, punches, 7, anchor);
  // 4 项计划 × 7 天 = 28 个应完成项，当天完成 4 项 → 14%
  eq(r.rate, 14, '当天 4 项打卡应计入 7 天窗口（4/28）');
  eq(r.done, 4, '已完成项数');
  eq(r.streak, 1, '连续天数');
});

test('窗口锚定错误（UTC 前一天）时当天打卡会被漏计 —— 反证缺陷存在', () => {
  const anchor = '2026-09-14';
  const punches = [1, 2, 3, 4].map((id) => ({ _date: anchor, _planId: id, punch_type: '饮食', completion_status: '已完成' }));
  const buggy = DPA.mock.analyzeCheckin(PLAN, punches, 7, '2026-09-13'); // 旧实现会取到 UTC 键
  eq(buggy.rate, 0, '锚定到错误日期时完成率应为 0（证明窗口口径敏感）');
});

test('anchorDate 接受 YYYY-MM-DD 字符串与 Date 对象两种入参', () => {
  const punches = [1, 2, 3, 4].map((id) => ({ _date: '2026-09-14', _planId: id, punch_type: '饮食', completion_status: '已完成' }));
  const a = DPA.mock.analyzeCheckin(PLAN, punches, 7, '2026-09-14');
  const b = DPA.mock.analyzeCheckin(PLAN, punches, 7, new Date(2026, 8, 14, 12, 0, 0));
  eq(a.rate, b.rate, '两种入参结果应一致');
  eq(a.rate, 14, '完成率');
});

/* ---------- 3. 口令哈希（crypto.js） ---------- */
suite('【安全 · 口令哈希】');

test('SHA-256 官方测试向量：空串', () => {
  eq(DPA_Crypto().sha256Hex(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '空串摘要');
});

test('SHA-256 官方测试向量：abc', () => {
  eq(DPA_Crypto().sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'abc 摘要');
});

test('SHA-256 官方测试向量：长度 56 与 64（填充边界）', () => {
  eq(DPA_Crypto().sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1', '56 字节摘要');
  eq(DPA_Crypto().sha256Hex('a'.repeat(64)),
    'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb', '64 字节摘要');
});

test('SHA-256 支持中文与 emoji（UTF-8 多字节，与 Node crypto 交叉校验）', () => {
  const nodeCrypto = require('crypto');
  const expect = (s) => nodeCrypto.createHash('sha256').update(s, 'utf8').digest('hex');
  eq(DPA_Crypto().sha256Hex('糖尿病'), expect('糖尿病'), '中文摘要应与 Node 一致');
  eq(DPA_Crypto().sha256Hex('🩺💉'), expect('🩺💉'), 'emoji 摘要应与 Node 一致');
});

test('hashPassword 加盐后同一口令产生不同摘要，同盐则稳定', () => {
  const s1 = DPA_Crypto().randomSalt(16), s2 = DPA_Crypto().randomSalt(16);
  const h1 = DPA_Crypto().hashPassword('admin123', s1);
  const h1b = DPA_Crypto().hashPassword('admin123', s1);
  const h2 = DPA_Crypto().hashPassword('admin123', s2);
  eq(h1, h1b, '同盐同口令应稳定');
  assert(h1 !== h2, '不同盐应产生不同摘要（加盐生效）');
  assert(h1.length === 64, '摘要应为 64 位十六进制');
  assert(h1 !== 'admin123', '摘要不得等于明文');
});

test('hashPassword 已做迭代拉伸（不是单轮 SHA-256）', () => {
  const salt = 'aabbccdd';
  const singleRound = DPA_Crypto().sha256Hex(salt + ':x');
  const stretched = DPA_Crypto().hashPassword('x', salt);
  assert(stretched !== singleRound, '迭代拉伸结果不应等于单轮 SHA-256');
  eq(stretched, DPA_Crypto().hashPassword('x', salt), '同输入应可重复');
  eq(DPA_Crypto().ITERATIONS, 1000, '迭代轮数');
});

test('timingSafeEqual 正确比较且长度不等直接 false', () => {
  assert(DPA_Crypto().timingSafeEqual('abc', 'abc'), '相等应为 true');
  assert(!DPA_Crypto().timingSafeEqual('abc', 'abd'), '不等应为 false');
  assert(!DPA_Crypto().timingSafeEqual('abc', 'abcd'), '长度不等应为 false');
});

test('localStorage 中不残留明文口令', () => {
  const raw = window.localStorage.getItem('dpa:users') || '';
  assert(raw.indexOf('admin123') < 0, 'localStorage 不应出现明文 admin123');
  assert(raw.indexOf('user123') < 0, 'localStorage 不应出现明文 user123');
  assert(raw.indexOf('password_hash') >= 0, '应存有 password_hash');
});

/* ---------- 4. 权限模型 ---------- */
suite('【权限模型】');

test('管理员登录后 isAdmin 为 true，role 为 admin', () => {
  const res = DPA.auth.login('admin', 'admin123', true);
  assert(res.ok, '登录应成功');
  eq(DPA.auth.isAdmin(), true, 'isAdmin');
  eq(DPA.store.session.current().role, 'admin', 'role');
});

test('普通用户登录后 isAdmin 为 false', () => {
  const res = DPA.auth.login('user', 'user123', true);
  assert(res.ok, '登录应成功');
  eq(DPA.auth.isAdmin(), false, 'isAdmin');
  eq(DPA.store.session.current().role, 'user', 'role');
});

test('错误密码登录失败', () => {
  eq(DPA.auth.login('admin', 'wrong', true).ok, false, '应登录失败');
});

test('登录返回的用户对象不含口令字段', () => {
  const res = DPA.auth.login('admin', 'admin123', true);
  const u = res.user || {};
  assert(!('password' in u), '不应返回 password');
  assert(!('password_hash' in u), '不应返回 password_hash');
  assert(!('password_salt' in u), '不应返回 password_salt');
});

test('注册新用户角色默认为 user', () => {
  const res = DPA.auth.register('tester01', 'test123456');
  assert(res.ok, '注册应成功');
  eq(DPA.auth.isAdmin(), false, '新用户非管理员');
});

test('重复用户名注册被拒绝', () => {
  eq(DPA.auth.register('tester01', 'test123456').ok, false, '应拒绝重复用户名');
});

test('users.update 白名单：拒绝越权改写 role', () => {
  DPA.store.users.update('tester01', { role: 'admin', username: 'tester01' });
  const u = DPA.store.users.findByUsername('tester01');
  eq(u.role, 'user', 'role 不应被改写为 admin');
});

/* ---------- 5. 会话持久化（记住我） ---------- */
suite('【会话 · 记住我】');

test('persist=true 写 localStorage，且不写 sessionStorage', () => {
  DPA.store.session.clear();
  DPA.auth.login('admin', 'admin123', true);
  assert(window.localStorage.getItem('dpa:session'), 'localStorage 应有会话');
  eq(window.sessionStorage.getItem('dpa:session'), null, 'sessionStorage 不应有会话');
});

test('persist=false 只写 sessionStorage，localStorage 被清除', () => {
  DPA.store.session.clear();
  DPA.auth.login('admin', 'admin123', false);
  assert(window.sessionStorage.getItem('dpa:session'), 'sessionStorage 应有会话');
  eq(window.localStorage.getItem('dpa:session'), null, 'localStorage 不应残留会话（取消记住我）');
});

test('session.current 优先返回 sessionStorage 中的会话', () => {
  DPA.store.session.clear();
  DPA.store.session.set({ user_id: 1, username: 'admin', role: 'admin' }, true);
  DPA.store.session.set({ user_id: 2, username: 'user', role: 'user' }, false);
  eq(DPA.store.session.username(), 'user', '应优先取本次会话');
});

test('session.clear 同时清空两处存储', () => {
  DPA.store.session.set({ user_id: 1, username: 'admin', role: 'admin' }, true);
  DPA.store.session.set({ user_id: 1, username: 'admin', role: 'admin' }, false);
  DPA.store.session.clear();
  eq(DPA.store.session.current(), null, '会话应为空');
  eq(window.localStorage.getItem('dpa:session'), null, 'localStorage 应清空');
  eq(window.sessionStorage.getItem('dpa:session'), null, 'sessionStorage 应清空');
});

/* ---------- 6. 用户名改名 · 数据迁移 ---------- */
suite('【用户改名 · 数据键迁移】');

test('改名后收藏数据随用户迁移，不丢失', () => {
  DPA.auth.login('user', 'user123', true);
  const id = DPA.store.articles.all()[0].article_id;
  if (!DPA.store.collections.has(id)) DPA.store.collections.toggle(id);
  const before = DPA.store.collections.count();
  assert(before >= 1, '前置条件：user 应有至少 1 条收藏');

  const r = DPA.store.users.rename('user', 'user_renamed');
  assert(r.ok, '改名应成功：' + (r.msg || ''));
  assert(r.moved >= 1, '应迁移至少 1 个数据键，实际 ' + r.moved);

  DPA.store.session.set({ user_id: 2, username: 'user_renamed', role: 'user' }, true);
  eq(DPA.store.collections.count(), before, '改名后收藏应完整保留');

  const back = DPA.store.users.rename('user_renamed', 'user');
  assert(back.ok, '应能改回原名');
});

test('改名到已存在的用户名被拒绝', () => {
  const r = DPA.store.users.rename('user', 'admin');
  eq(r.ok, false, '不应允许改名为已存在用户');
});

test('改名为自身（同名）是空操作且不报错', () => {
  const r = DPA.store.users.rename('user', 'user');
  assert(r.ok, '同名改名应视为成功');
  eq(r.moved, 0, '不应迁移任何键');
});

/* ---------- 7. XSS 转义 ---------- */
suite('【安全 · XSS 转义】');

test('escapeHtml 转义尖括号与引号', () => {
  const out = DPA.ui.escapeHtml('<script>alert("x")</script>');
  assert(out.indexOf('<script>') < 0, '不应保留 script 标签');
  assert(out.indexOf('&lt;script&gt;') >= 0, '应被转义');
});

test('恶意用户名不会注入到 HTML', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const out = DPA.ui.escapeHtml(evil);
  assert(out.indexOf('<img') < 0, '不应保留 img 标签');
});

test('renderMarkdown 对内容做转义', () => {
  const out = DPA.ui.renderMarkdown('## <script>bad</script>');
  assert(out.indexOf('<script>') < 0, 'Markdown 渲染应转义');
});

/* ---------- 8. 跳转安全（开放重定向） ---------- */
suite('【安全 · 跳转白名单】');

test('safeRedirect 放行站内白名单页面（含查询串）', () => {
  eq(DPA.ui.safeRedirect('home.html', 'index.html'), 'home.html', '普通站内页');
  eq(DPA.ui.safeRedirect('article.html?id=3', 'index.html'), 'article.html?id=3', '带查询串');
});

test('safeRedirect 阻断协议、协议相对、反斜杠与目录穿越', () => {
  const evil = [
    'https://evil.example.com', 'http://evil.example.com/x',
    '//evil.example.com', '\\\\evil.example.com',
    'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>',
    '../../etc/passwd', 'index.html/../../secret', 'unknown.html'
  ];
  evil.forEach((t) => eq(DPA.ui.safeRedirect(t, 'index.html'), 'index.html', '应回退：' + t));
});

test('safeRedirect 对空值返回兜底页', () => {
  eq(DPA.ui.safeRedirect('', 'home.html'), 'home.html', '空串');
  eq(DPA.ui.safeRedirect(null, 'home.html'), 'home.html', 'null');
  eq(DPA.ui.safeRedirect(undefined, 'home.html'), 'home.html', 'undefined');
});

/* ---------- 9. 数据层 CRUD ---------- */
suite('【数据层 · CRUD】');

test('种子数据已初始化（文章 >=6 篇、类型 4 类、医生 4 位）', () => {
  assert(DPA.store.articles.all().length >= 6, '文章数 ' + DPA.store.articles.all().length);
  eq(DPA.store.types.all().length, 4, '糖尿病类型数');
  eq(DPA.store.doctors.all().length, 4, '医生数');
});

test('文章新增与删除', () => {
  const before = DPA.store.articles.all().length;
  const art = DPA.store.articles.add({ title: '测试文章', content: '正文', category: '糖尿病科普' });
  eq(DPA.store.articles.all().length, before + 1, '新增后数量');
  DPA.store.articles.remove(art.article_id);
  eq(DPA.store.articles.all().length, before, '删除后数量');
});

test('文章批量删除 removeMany', () => {
  const a = DPA.store.articles.add({ title: '批删A', content: 'x', category: '糖尿病科普' });
  const b = DPA.store.articles.add({ title: '批删B', content: 'x', category: '糖尿病科普' });
  const before = DPA.store.articles.all().length;
  const n = DPA.store.articles.removeMany([a.article_id, b.article_id]);
  eq(n, 2, '应删除 2 篇');
  eq(DPA.store.articles.all().length, before - 2, '剩余数量');
});

test('阅读量递增不重写文章列表（独立计数表）', () => {
  const art = DPA.store.articles.all()[0];
  const v0 = DPA.store.articles.get(art.article_id).views || 0;
  DPA.store.articles.incViews(art.article_id);
  eq(DPA.store.articles.get(art.article_id).views, v0 + 1, '阅读量应 +1');
  assert(window.localStorage.getItem('dpa:article_views'), '应有独立计数表 dpa:article_views');
});

test('收藏切换（加入 / 移除）', () => {
  DPA.auth.login('admin', 'admin123', true);
  const id = DPA.store.articles.all()[1].article_id;
  const before = DPA.store.collections.has(id);
  const first = DPA.store.collections.toggle(id);
  eq(first, !before, '切换结果');
  eq(DPA.store.collections.has(id), !before, '状态应翻转');
  DPA.store.collections.toggle(id);
  eq(DPA.store.collections.has(id), before, '再切回原状');
});

test('生活方案生成与保存', () => {
  const res = DPA.mock.generateLifePlan({ userInfo: {}, lifeState: '', advice: '' });
  assert(res.plans.length >= 8, '方案条数应 >=8');
  DPA.store.plans.save(res.plans);
  eq(DPA.store.plans.count(), res.plans.length, '保存后数量一致');
});

test('打卡切换与计数', () => {
  const before = DPA.store.punch.count();
  const done = DPA.store.punch.toggle('2026-01-01', 999, '饮食', '测试项');
  eq(done, true, '首次打卡应为已完成');
  eq(DPA.store.punch.count(), before + 1, '计数应 +1');
});

test('punch.statusMap 返回当日各计划的完成状态', () => {
  DPA.store.punch.toggle('2026-01-02', 1001, '运动', '测试项');
  const m = DPA.store.punch.statusMap('2026-01-02');
  eq(m['1001'], '已完成', '应返回该计划的完成状态');
  eq(m['9999'], undefined, '未打卡的计划不应出现在映射中');
});

test('风险记录保存使用 record_id 且可查询历史', () => {
  const rec = DPA.store.risk.save({ age: 50, sex: '男', height: 170, weight: 85, waistline: 95, familyHistory: '有', systolicPressure: 135, level: '高风险', score: 17, probability: 70 });
  assert(rec && rec.record_id !== undefined, '应返回 record_id');
  const hist = DPA.store.risk.history();
  assert(hist.length >= 1, '历史应有记录');
});

test('数据按用户隔离（不同用户收藏互不可见）', () => {
  DPA.auth.login('user', 'user123', true);
  const id = DPA.store.articles.all()[2].article_id;
  DPA.store.collections.toggle(id);
  const userCount = DPA.store.collections.count();
  DPA.auth.login('admin', 'admin123', true);
  const adminCount = DPA.store.collections.count();
  assert(userCount !== adminCount || adminCount === 0, '不同用户数据应隔离（user=' + userCount + ', admin=' + adminCount + '）');
});

/* ---------- 10. 双模式运行 · 降级 ---------- */
suite('【双模式运行 · 降级】');

test('未配置 Dify 时 isDifyReady 返回 false', () => {
  eq(window.DPA_CONFIG.isDifyReady('riskPrediction'), false, '未配置应为 false');
});

test('离线时 predictRisk 走本地引擎并返回结果', async () => {
  const r = await DPA.api.predictRisk({ age: 50, sex: '男', height: 170, weight: 85, waistline: 95, familyHistory: '有', systolicPressure: 135 });
  assert(r && r.level, '应返回风险等级');
  eq(r.source, 'local', '来源应为本地引擎');
});

test('离线时 analyzeCheckin 走本地引擎', async () => {
  const r = await DPA.api.analyzeCheckin({ planList: PLAN, punchList: [], days: 7 });
  eq(r.source, 'local', '来源应为本地引擎');
  eq(r.days, 7, '分析天数');
});

test('离线时 doctorChat 流式回调可用', async () => {
  let full = '';
  const text = await DPA.api.doctorChat('2型糖尿病怎么吃', { onDelta: (d) => { full += d; } });
  assert(text.length > 20, '应生成回复');
  assert(full.length > 20, '流式回调应收到内容');
});

test('降级用例的失败会真实计入 fail（验证断言框架已 await）', async () => {
  // 前置用例中的 3 个降级用例都是 async。若框架未 await，asyncCases 会停在 0。
  assert(HARNESS.asyncCases >= 3, '应已 await 至少 3 个异步用例，实际 ' + HARNESS.asyncCases);
  // 直接验证 await 语义：异步抛错必须能被外层 try/catch 捕获并计数
  let caught = false;
  try { await Promise.reject(new Error('__EXPECTED_ASYNC_FAILURE__')); } catch (e) { caught = true; }
  assert(caught, '异步异常应被捕获（证明 await 生效）');
});

/* ---------- 11. Dify 输出归一化 ---------- */
suite('【Dify 输出归一化】');

const N = DPA.api._raw.normalize;

test('unwrap 解开 Dify 的字符串包裹层', () => {
  const a = DPA.api._raw.unwrap({ data: '{"a":1,"b":2}' });
  eq(a.a, 1, '字符串应被解析为对象');
  eq(a.b, 2, 'b');
  const b = DPA.api._raw.unwrap('{"x":"y"}');
  eq(b.x, 'y', '字符串入参也应被解析');
});

test('unwrap 保留无法解析的字符串原样', () => {
  const out = DPA.api._raw.unwrap({ note: '这不是 JSON' });
  eq(out.note, '这不是 JSON', '非法 JSON 应原样保留');
  const nul = DPA.api._raw.unwrap(null);
  eq(typeof nul, 'object', 'null 入参应返回空对象');
});

/*
 * 真实大模型常把 JSON 包进 markdown 代码块或夹带说明文字。裸 JSON.parse
 * 一旦失败就会被判「契约不匹配」并静默降级，表现为「看着在线其实没走 Dify」。
 * 下面四个用例锁定 tryParse 的三级容错行为。
 */
test('unwrap 能剥离 ```json 围栏', () => {
  const raw = '```json\n{"articles":[{"title":"a"}],"diabetesTypes":[]}\n```';
  const o = DPA.api._raw.unwrap({ result: raw });
  eq(o.articles.length, 1, '围栏内 JSON 应被解析');
  eq(o.articles[0].title, 'a', 'title');
});

test('unwrap 能剥离无语言标记的围栏', () => {
  const o = DPA.api._raw.unwrap({ result: '```\n{"level":"低风险","score":3}\n```' });
  eq(o.level, '低风险', '无语言标记的围栏也应被剥离');
});

test('unwrap 能容忍前后夹带的说明文字', () => {
  const o = DPA.api._raw.unwrap({ result: '好的，以下是结果：\n{"level":"高风险","score":20}\n希望有帮助。' });
  eq(o.level, '高风险', '应截取首尾花括号之间的内容');
  eq(o.score, 20, 'score');
});

test('unwrap 对彻底非 JSON 的内容仍不误判', () => {
  const o = DPA.api._raw.unwrap({ result: '服务暂时不可用，请稍后再试。' });
  eq(o.result, '服务暂时不可用，请稍后再试。', '无法解析时应原样保留，不能凭空造对象');
});

/*
 * 推理模型（deepseek-v4-pro 实测）会先输出 <think>…</think> 思考块再给 JSON。
 * 不剥掉的话，思考内容里的花括号会让「截取首尾括号」截错位置，
 * 最终解析失败 → 判契约不匹配 → 静默降级本地引擎。
 */
test('unwrap 能剥掉 <think> 思考块（推理模型实测输出）', () => {
  const raw = '<think>\n<!--dify-deepseek-reasoning-->我们需要回答用户。注意：日期 2026-05-07。\n</think>{"level":"高风险","score":20}';
  const o = DPA.api._raw.unwrap({ result: raw });
  eq(o.level, '高风险', '思考块之后才是真正的 JSON');
  eq(o.score, 20, 'score');
});

test('unwrap 能处理思考块里含花括号的情况', () => {
  // 思考里出现 { 时，朴素的"截首尾括号"会截错，必须先剥 think
  const raw = '<think>先算一下 {score: 20} 是否越界</think>{"level":"中风险","score":12}';
  const o = DPA.api._raw.unwrap({ result: raw });
  eq(o.level, '中风险', '应剥掉含花括号的思考块');
  eq(o.score, 12, 'score');
});

test('unwrap 能处理没有闭合标签的 <think>（流式截断）', () => {
  const raw = '<think>思考被截断……{"level":"低风险","score":4}';
  const o = DPA.api._raw.unwrap({ result: raw });
  eq(o.level, '低风险', '无闭合标签时也应尽量恢复');
});

/*
 * 聊天/智能体是**文本**场景，与工作流 JSON 的处理不同：
 * 思考块未闭合时必须认为"还在思考"、正文为空，否则模型的原始思考过程
 * 会原样显示给用户（实测过："AI<think>我需要复述意图…"）。
 */
test('stripThink 文本模式：已闭合的思考块被移除', () => {
  const s = DPA.api._raw.stripThink;
  eq(s('<think>先想一下…</think>您好，统计如下：注册用户 2 人。', true),
    '您好，统计如下：注册用户 2 人。', '闭合块应被移除');
});

test('stripThink 文本模式：思考块未闭合时返回空（还在思考）', () => {
  const s = DPA.api._raw.stripThink;
  eq(s('<think>我正在思考，还没想完', true), '', '未闭合应视为仍在思考，不能把思考当正文');
});

test('stripThink 文本模式：真实智能管理回复不再夹带思考过程', () => {
  const s = DPA.api._raw.stripThink;
  const raw = 'AI<think><!--dify-deepseek-reasoning-->用户要求统计系统数据。我需要复述意图…</think>系统数据总览：注册用户 2 人。';
  const out = s(raw, true);
  assert(out.indexOf('<think>') < 0, '输出不应含 <think> 标签');
  assert(out.indexOf('我需要复述意图') < 0, '输出不应含思考内容');
  eq(out, 'AI系统数据总览：注册用户 2 人。', '应保留思考块之外的正文');
});

test('stripThink JSON 模式仍保留"抢救后续 JSON"的行为', () => {
  const s = DPA.api._raw.stripThink;
  eq(s('<think>思考被截断…{"level":"低风险"}', false),
    '{"level":"低风险"}', '工作流场景未闭合时应抢救出 JSON');
});

test('normalizeRisk 接受带思考块的真实模型输出', () => {
  const raw = '<think>分析各项指标…</think>{"score":18,"maxScore":27,"level":"高风险","probability":72,"bmi":27.1,"disease":"未患病","riskType":"2型糖尿病","factors":["家族史"],"message":"风险较高","advice":["尽快就医"]}';
  const r = N.risk({ result: raw });
  eq(r.level, '高风险', '带思考块的输出应通过契约校验');
  eq(r.probability, 72, 'probability');
});

test('normalizeRisk 接受被围栏包裹的真实模型输出', () => {
  const raw = '```json\n{"score":18,"maxScore":27,"level":"高风险","probability":72,"bmi":27.1,"disease":"未患病","riskType":"2型糖尿病","factors":["家族史"],"message":"风险较高","advice":["尽快就医"]}\n```';
  const r = N.risk({ result: raw });
  eq(r.level, '高风险', '围栏包裹的输出应通过契约校验');
  eq(r.probability, 72, 'probability');
});

test('normalizeRisk：合法输出被接受', () => {
  const r = N.risk({ level: '高风险', score: 18, probability: 72, advice: ['就医'], factors: ['家族史'] });
  eq(r.level, '高风险', 'level');
  eq(r.score, 18, 'score');
  eq(r.advice.length, 1, 'advice');
  eq(r.source, 'dify', 'source');
});

test('normalizeRisk：level 非法时抛契约错误（触发降级）', () => {
  ['', '中等', 'HIGH', undefined].forEach((lv) => {
    let threw = false;
    try { N.risk({ level: lv }); } catch (e) { threw = true; assert(e.contract === true, '应标记 contract'); }
    assert(threw, 'level=' + JSON.stringify(lv) + ' 应抛契约错误');
  });
});

test('normalizeRisk：缺字段时使用安全默认值', () => {
  const r = N.risk({ level: '低风险' });
  eq(r.score, 0, 'score 默认 0');
  eq(r.probability, 0, 'probability 默认 0');
  eq(r.advice.length, 0, 'advice 默认空数组');
});

test('normalizeRisk：概率越界被裁剪到 0~100', () => {
  eq(N.risk({ level: '高风险', score: 20, probability: 999, advice: [], factors: [] }).probability, 100, '上限');
  eq(N.risk({ level: '低风险', score: 1, probability: -5, advice: [], factors: [] }).probability, 0, '下限');
});

test('normalizeCheckin：合法输出被接受', () => {
  const r = N.checkin({ rate: 80, streak: 5, balance: 60, evaluation: '良好', suggestions: ['继续保持'] });
  eq(r.rate, 80, 'rate');
  eq(r.streak, 5, 'streak');
});

test('normalizeCheckin：rate 越界被裁剪', () => {
  eq(N.checkin({ rate: 150, streak: 0, balance: 0, evaluation: '优秀', suggestions: [] }).rate, 100, '上限');
});

test('normalizeCheckin：evaluation 非法时抛契约错误', () => {
  let threw = false;
  try { N.checkin({ rate: 80, evaluation: '很好' }); } catch (e) { threw = true; }
  assert(threw, 'evaluation 非法应抛错');
});

test('normalizeHome / normalizeLifePlan / normalizeNews 拒绝错误契约', () => {
  [['home', {}], ['lifePlan', { plans: 'not-array' }], ['news', { articles: null }]].forEach(([k, bad]) => {
    let threw = false;
    try { N[k](bad); } catch (e) { threw = true; }
    assert(threw, k + ' 应拒绝错误结构');
  });
});

test('api._raw.endpoint 拼接同源 /v1 路径', () => {
  const url = DPA.api._raw.endpoint('/workflows/run');
  assert(url.indexOf('/workflows/run') >= 0, '应包含接口路径，实际 ' + url);
  assert(url.indexOf('//') !== 0, '不应是协议相对地址，实际 ' + url);
});

/* ================================================================
   串行执行（await 每个用例，异步失败也会被计入）
   ================================================================ */
(async () => {
  console.log('===== 核心逻辑测试 =====\n');
  for (const item of queue) {
    if (item.name === null) { console.log('\n' + item.title); continue; }
    let ret;
    try {
      ret = item.fn();
      if (ret && typeof ret.then === 'function') HARNESS.asyncCases++;
      await ret;                    // 关键：等待 Promise，异步断言失败才会被下面 catch
      pass++;
      console.log('✅ ' + item.name);
    } catch (e) {
      if (ret && typeof ret.then === 'function') HARNESS.asyncFailures++;
      fail++;
      const msg = (e && e.message) || String(e);
      failures.push(item.name + ' → ' + msg);
      console.log('❌ ' + item.name + '\n     ↳ ' + msg);
    }
  }
  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
  console.log(`（其中异步用例 ${HARNESS.asyncCases} 个，异步失败 ${HARNESS.asyncFailures} 个）`);
  if (failures.length) {
    console.log('\n失败用例：');
    failures.forEach((f) => console.log('  · ' + f));
  }
  process.exit(fail ? 1 : 0);
})();

/** 取 crypto 全局（jsdom window 上的 DPA_Crypto） */
function DPA_Crypto() { return window.DPA_Crypto; }
