/**
 * e2e.spec.js — Playwright 端到端测试
 * 覆盖主链路：登录 → 首页 → 医师咨询 → 风险预测 → 生活方案 → 打卡分析 → 健康资讯 → AI 助手
 *           以及权限控制、XSS 防护、开放重定向防护、口令不落明文
 *
 * 运行：
 *   npm i -D @playwright/test && npx playwright install chromium
 *   npx playwright test
 */
const { test, expect } = require('@playwright/test');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080';

/**
 * 等待上限。
 *
 * 这些用例早先是照着「本地 mock 引擎即时返回」写的（10~15s 绰绰有余）。
 * 接入真实 Dify 后，单次推理实测要 3~18s（生活方案约 14s），
 * 15s 的等待会在数据返回前就判定失败 —— 看起来是页面 bug，其实是等得不够。
 * 统一提到 45s，并可用 E2E_WAIT 覆盖。
 */
const WAIT = Number(process.env.E2E_WAIT || 45000);

/**
 * 通过 localStorage 注入登录态，跳过 UI 登录。
 *
 * 注意：**不再**注入 dpa:users 里的明文口令。
 * v2.1 起 store.js 只认 password_hash / password_salt，且任何明文都会被
 * migratePasswords() 升级；在测试里手写明文口令既无必要，也与"口令不落明文"
 * 这条安全约束自相矛盾。页面鉴权只依赖 dpa:session，注入它即可。
 */
/**
 * 把 js/config.js 的 USE_MOCK 强制为 true，让 AI 输出固定走本地引擎。
 *
 * 为什么需要：E2E 验证的是界面行为，不是大模型的措辞。项目接入真实 Dify 后，
 * 同一句指令的真实回答与本地引擎不同（措辞、结构都可能变），断言会随机失败；
 * 真实链路的质量由 tests/real-dify-check.js 单独验证（8 个应用逐个打真实请求）。
 * 这样切不切真实 Dify，E2E 结果都稳定。
 */
async function forceOfflineEngine(page) {
  await page.route('**/js/config.js', async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace(/USE_MOCK:\s*false/, 'USE_MOCK: true');
    await route.fulfill({ response: res, body });
  });
}

async function loginAs(page, role) {
  await page.goto(BASE + '/index.html');
  await page.evaluate((r) => {
    localStorage.setItem('dpa:session', JSON.stringify({
      user_id: r === 'admin' ? 1 : 2,
      username: r,
      role: r === 'admin' ? 'admin' : 'user',
      avatar: '',
      loginTime: new Date().toISOString()
    }));
  }, role);
}

test.describe('糖尿病预治智能助手 E2E', () => {

  // 所有用例统一走离线引擎，保证断言与真实大模型措辞解耦
  test.beforeEach(async ({ page }) => {
    await forceOfflineEngine(page);
  });


  test('1. 登录流程：演示账号一键填充 → 登录 → 进入首页', async ({ page }) => {
    await page.goto(BASE + '/index.html');
    await expect(page.locator('.auth-title')).toContainText('糖尿病预治智能助手');

    await page.locator('.demo-account').first().click();
    await expect(page.locator('#loginUsername')).toHaveValue('admin');

    await page.locator('#loginBtn').click();
    await page.waitForURL('**/home.html', { timeout: WAIT });
    await expect(page.locator('.navbar-brand')).toContainText('糖尿病助手');
  });

  test('2. 首页：轮播、文章列表、糖尿病类型均渲染', async ({ page }) => {
    await loginAs(page, 'user');
    await page.goto(BASE + '/home.html');

    await expect(page.locator('#articleList .article-card').first()).toBeVisible();
    await expect(page.locator('#typeList .type-card')).toHaveCount(4);
    await expect(page.locator('.banner-dot')).toHaveCount(3);

    // 点击类型卡片应跳转到类型详情页
    await page.locator('#typeList .type-card').first().click();
    await page.waitForURL('**/diabetes.html**');
    await expect(page.locator('#typeContent .type-block')).toHaveCount(4);
  });

  test('3. 医师咨询：选择医师 → 发送消息 → 收到流式回复', async ({ page }) => {
    await loginAs(page, 'user');
    await page.goto(BASE + '/doctor.html');

    await expect(page.locator('#doctorList .doctor-card').first()).toBeVisible();
    await page.locator('#doctorList .doctor-card').first().click();
    await expect(page.locator('#chatView')).toBeVisible();

    await page.locator('#chatInput').fill('2型糖尿病应该怎么吃？');
    await page.locator('#chatSend').click();

    // 等待机器人回复出现（流式）
    await expect(page.locator('#chatMessages .chat-msg.bot').last()).toContainText(/饮食|主食|蔬菜/, { timeout: WAIT });
  });

  test('4. 风险预测：填写表单 → 出分档、概率与建议', async ({ page }) => {
    await loginAs(page, 'user');
    await page.goto(BASE + '/risk-prediction.html');

    await page.locator('#age').fill('62');
    await page.locator('#sex').selectOption('男');
    await page.locator('#height').fill('170');
    await page.locator('#weight').fill('92');
    await page.locator('#waistline').fill('102');
    await page.locator('#systolicPressure').fill('145');
    await page.locator('#familyHistory').selectOption('有');

    await page.locator('#submitBtn').click();

    await expect(page.locator('.risk-gauge')).toBeVisible({ timeout: WAIT });
    await expect(page.locator('#resultArea .risk-level').first()).toContainText('高风险');
    await expect(page.locator('.risk-advice-item').first()).toBeVisible();
    await expect(page.locator('#resultArea .disclaimer')).toContainText('不能替代临床诊断');
  });

  test('5. 生活方案：自动生成方案 → 打卡勾选', async ({ page }) => {
    await loginAs(page, 'user');
    await page.goto(BASE + '/life-plan.html');

    await expect(page.locator('#planList .plan-item').first()).toBeVisible({ timeout: WAIT });

    // 勾选第一项打卡
    const check = page.locator('#planList .plan-check').first();
    await check.click();
    await expect(check).toHaveClass(/checked/);
  });

  test('6. 打卡分析：近 7 日网格与智能分析', async ({ page }) => {
    await loginAs(page, 'user');
    await page.goto(BASE + '/life-plan.html');
    await page.waitForSelector('#planList .plan-item');

    await page.goto(BASE + '/checkin.html');
    await expect(page.locator('#weekGrid .checkin-day')).toHaveCount(7);
    await expect(page.locator('#analysisArea .analysis-card').first()).toBeVisible({ timeout: WAIT });
    await expect(page.locator('.analysis-metric')).toHaveCount(3);
  });

  test('7. 健康资讯：标签切换、生成资讯、收藏', async ({ page }) => {
    await loginAs(page, 'user');
    await page.goto(BASE + '/health-news.html');

    await expect(page.locator('#newsList .news-card').first()).toBeVisible({ timeout: WAIT });

    // 收藏第一篇
    await page.locator('#newsList .collect-btn').first().click();
    await expect(page.locator('#newsList .collect-btn').first()).toHaveClass(/active/);

    // 生成资讯
    await page.locator('#generateBtn').click();
    await expect(page.locator('#newsList .news-card').first()).toBeVisible({ timeout: WAIT });
  });

  test('8. AI 助手：进入聊天 → 流式输出', async ({ page }) => {
    await loginAs(page, 'user');
    await page.goto(BASE + '/assistant.html');

    await page.locator('#startChat').click();
    await expect(page.locator('#chatView')).toBeVisible();

    await page.locator('#chatInput').fill('糖尿病有哪些并发症？');
    await page.locator('#chatSend').click();

    await expect(page.locator('#chatMessages .chat-msg.bot').last()).toContainText(/并发症|心血管|肾/, { timeout: WAIT });
  });

  test('9. 权限控制：管理员可见智能管理，普通用户不可见', async ({ page }) => {
    // 普通用户
    await loginAs(page, 'user');
    await page.goto(BASE + '/personal.html');
    await expect(page.locator('#adminSection')).toBeHidden();

    // 管理员
    await loginAs(page, 'admin');
    await page.goto(BASE + '/personal.html');
    await expect(page.locator('#adminSection')).toBeVisible();
    await expect(page.locator('#adminSection')).toContainText('AI 智能管理');
  });

  test('10. 智能管理：自然语言指令驱动数据变更', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto(BASE + '/admin.html');

    await expect(page.locator('#adminStats .admin-stat')).toHaveCount(6);

    await page.locator('#adminInput').fill('统计系统数据');
    await page.locator('#adminSend').click();

    await expect(page.locator('#adminMessages .chat-msg.bot').last()).toContainText(/注册用户|系统数据总览/, { timeout: WAIT });
  });

  test('11. 未登录访问受保护页面应跳转登录页', async ({ page }) => {
    await page.goto(BASE + '/index.html');
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '/personal.html');
    await page.waitForURL('**/index.html**', { timeout: WAIT });
  });

  test('12. XSS 防护：恶意输入被转义不执行', async ({ page }) => {
    await loginAs(page, 'user');
    await page.goto(BASE + '/personal.html');

    // 直接向聊天注入恶意脚本，验证不会执行
    await page.goto(BASE + '/assistant.html');
    await page.locator('#startChat').click();
    await page.locator('#chatInput').fill('<img src=x onerror=window.__xss=1>');
    await page.locator('#chatSend').click();
    await page.waitForTimeout(2500);

    const xss = await page.evaluate(() => window.__xss);
    expect(xss).toBeUndefined();
  });

  test('13. 开放重定向防护：redirect 指向外部站点时回落到首页', async ({ page }) => {
    await page.goto(BASE + '/index.html?redirect=https://evil.example.com/steal');
    await page.locator('.demo-account').first().click();
    await page.locator('#loginBtn').click();

    // 必须停在站内首页，绝不能跳到 evil.example.com
    await page.waitForURL('**/home.html**', { timeout: WAIT });
    expect(page.url()).toContain('/home.html');
    expect(page.url()).not.toContain('evil.example.com');
  });

  test('14. 开放重定向防护：协议相对与目录穿越同样被阻断', async ({ page }) => {
    for (const evil of ['//evil.example.com', '../../etc/passwd', 'unknown.html']) {
      // 每一轮都必须先清掉上一轮登录留下的会话：
      // login.js 开头有 redirectIfLogged()，已登录访问 index.html 会直接跳走，
      // 那样就看不到登录表单，测试会卡在等 .demo-account。
      await page.goto(BASE + '/index.html');
      await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });

      await page.goto(BASE + '/index.html?redirect=' + encodeURIComponent(evil));
      await page.locator('.demo-account').first().click();
      await page.locator('#loginBtn').click();
      await page.waitForURL('**/home.html**', { timeout: WAIT });
      expect(page.url()).toContain('/home.html');
      expect(page.url()).not.toContain('evil.example.com');
    }
  });

  test('15. 开放重定向防护：白名单内页面正常跳转（功能未被误伤）', async ({ page }) => {
    await page.goto(BASE + '/index.html?redirect=risk-prediction.html');
    await page.locator('.demo-account').first().click();
    await page.locator('#loginBtn').click();
    await page.waitForURL('**/risk-prediction.html**', { timeout: WAIT });
    expect(page.url()).toContain('/risk-prediction.html');
  });

  test('16. 安全：登录后 localStorage 中不存在明文口令', async ({ page }) => {
    await page.goto(BASE + '/index.html');
    await page.locator('.demo-account').first().click();
    await page.locator('#loginBtn').click();
    await page.waitForURL('**/home.html**', { timeout: WAIT });

    const raw = await page.evaluate(() => localStorage.getItem('dpa:users') || '');
    expect(raw).not.toContain('admin123');
    expect(raw).not.toContain('user123');
    expect(raw).toContain('password_hash');
    expect(raw).toContain('password_salt');
  });

  test('17. 安全：静态响应带上安全响应头（含 CSP）', async ({ request }) => {
    const res = await request.get(BASE + '/index.html');
    const h = res.headers();
    // 通过 http-server 直接访问时不会有这些头，因此这里仅在反代/桩服务下断言。
    // 见 tests/mock-dify-server.js 与 nginx.conf 的 snippets/security-headers.conf。
    if (process.env.EXPECT_SECURITY_HEADERS === '1') {
      expect(h['x-content-type-options']).toBe('nosniff');
      expect(h['content-security-policy']).toContain("default-src 'self'");
    }
    expect(res.status()).toBe(200);
  });


  /* ---------------- PC / 移动端布局区分 ---------------- */

  test('18. 响应式：PC 端隐藏底部导航，只保留顶部导航', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, 'user');
    await page.goto(BASE + '/home.html');

    await expect(page.locator('.navbar')).toBeVisible();
    await expect(page.locator('.navbar-menu')).toBeVisible();
    // 底部导航是移动端专属，PC 上必须不显示
    await expect(page.locator('.bottom-nav')).toBeHidden();
  });

  test('19. 响应式：移动端显示底部导航，顶栏菜单收起', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, 'user');
    await page.goto(BASE + '/home.html');

    await expect(page.locator('.bottom-nav')).toBeVisible();
    await expect(page.locator('.navbar-menu')).toBeHidden();
    // 顶栏品牌区仍在
    await expect(page.locator('.navbar-brand')).toBeVisible();
  });

  test('20. 响应式：PC 端文章列表为双列，移动端为单列', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, 'user');
    await page.goto(BASE + '/home.html');
    await page.waitForSelector('#articleList .article-card', { timeout: WAIT });
    const pcCols = await page.evaluate(() =>
      getComputedStyle(document.querySelector('#articleList')).gridTemplateColumns.split(' ').filter(Boolean).length);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);
    const mbDisplay = await page.evaluate(() =>
      getComputedStyle(document.querySelector('#articleList')).display);

    expect(pcCols).toBe(2);
    expect(mbDisplay).toBe('block');
  });

});
