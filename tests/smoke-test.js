/**
 * smoke-test.js — 无头 DOM 冒烟测试（本地文件加载，稳定可重复）
 * 用 jsdom 加载每个页面，捕获脚本错误并校验关键元素是否渲染。
 * 运行：node tests/smoke-test.js
 */
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname ? path.resolve(__dirname, '..') : process.cwd();
const BASE = 'http://localhost/';

/** 自定义资源加载器：直接读磁盘，绕过 HTTP，保证测试稳定 */
class LocalLoader extends ResourceLoader {
  fetch(url) {
    const u = new URL(url);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) return Promise.reject(new Error('forbidden'));
    return fs.promises.readFile(file).catch((e) => {
      throw new Error('ENOENT ' + rel);
    });
  }
}

const PAGES = [
  { file: 'index.html', name: '登录注册', needAuth: false, checks: ['#loginForm', '.auth-tab', '#registerForm'] },
  { file: 'home.html', name: '系统首页', needAuth: true, checks: ['#dpaNavbar', '#articleList .article-card', '#typeList .type-card', '.banner-dot'] },
  { file: 'article.html?id=1', name: '文章详情', needAuth: true, checks: ['#articleTitle', '#articleBody .md-h3', '#collectBtn'] },
  { file: 'diabetes.html?type=2型糖尿病', name: '糖尿病类型', needAuth: true, checks: ['#typeName', '#typeContent .type-block'] },
  { file: 'doctor.html', name: '医师咨询', needAuth: true, checks: ['#doctorList .doctor-card', '#chatView'] },
  { file: 'risk-prediction.html', name: '风险预测', needAuth: true, checks: ['#riskForm', '#age', '#historyList'] },
  { file: 'life-plan.html', name: '生活方案', needAuth: true, checks: ['#planTabs', '#planList .plan-item'] },
  { file: 'checkin.html', name: '打卡分析', needAuth: true, checks: ['#weekGrid .checkin-day', '#analysisArea', '#detailList'] },
  { file: 'health-news.html', name: '健康资讯', needAuth: true, checks: ['#newsTags .news-tag', '#newsList .news-card'] },
  { file: 'assistant.html', name: 'AI助手', needAuth: true, checks: ['#introView', '#chatView', '#startChat'] },
  { file: 'personal.html', name: '个人中心', needAuth: true, checks: ['#profileName', '.menu-section', '#logoutBtn', '#statCheckin'] },
  { file: 'admin.html', name: '智能管理', needAuth: true, admin: true, checks: ['#adminStats .admin-stat', '#tableArea', '#adminMessages .chat-msg'] },
  { file: 'help.html', name: '帮助中心', needAuth: true, checks: ['#faqList .faq-item', '#versionText'] }
];

const SEED_USERS = JSON.stringify([
  { user_id: 1, username: 'admin', password: 'admin123', avatar_url: '', role: 'admin', phone: '', age: '' },
  { user_id: 2, username: 'user', password: 'user123', avatar_url: '', role: 'user', phone: '', age: '' }
]);

function runPage(page, session) {
  return new Promise((resolve) => {
    const errors = [];
    const vc = new VirtualConsole();
    vc.on('jsdomError', (e) => errors.push('jsdomError: ' + (e.message || e)));
    vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

    const filePart = page.file.split('?')[0];
    const filePath = path.join(ROOT, filePart);
    const url = BASE + page.file;

    JSDOM.fromFile(filePath, {
      url,
      runScripts: 'dangerously',
      resources: new LocalLoader(),
      pretendToBeVisual: true,
      virtualConsole: vc,
      beforeParse(window) {
        try {
          window.localStorage.setItem('dpa:users', SEED_USERS);
          if (session) window.localStorage.setItem('dpa:session', JSON.stringify(session));
        } catch (e) { /* ignore */ }
        // 测试环境禁用真实网络：未配置 Dify 时应走本地引擎，fetch 不应被调用
        window.fetch = function () { return Promise.reject(new Error('no network in test')); };
      }
    }).then((dom) => {
      const { window } = dom;
      window.addEventListener('error', (e) => errors.push('window.error: ' + (e.message || e)));

      setTimeout(() => {
        const results = page.checks.map((sel) => {
          let ok = false;
          try { ok = !!window.document.querySelector(sel); } catch (e) { ok = false; }
          return { sel, ok };
        });

        const href = window.location.href;
        const redirected = page.needAuth && href.indexOf('index.html') >= 0;

        dom.window.close();
        resolve({ page, errors, results, redirected });
      }, 900);
    }).catch((e) => {
      resolve({ page, errors: ['load failed: ' + e.message], results: [], redirected: false });
    });
  });
}

(async () => {
  let pass = 0, fail = 0;
  console.log('===== 糖尿病预治智能助手 · 页面冒烟测试 =====\n');

  for (const page of PAGES) {
    const session = page.needAuth
      ? { username: page.admin ? 'admin' : 'user', role: page.admin ? 'admin' : 'user', loginTime: new Date().toISOString() }
      : null;

    const r = await runPage(page, session);
    const failedChecks = r.results.filter((x) => !x.ok);
    const ok = r.errors.length === 0 && failedChecks.length === 0 && !r.redirected;

    if (ok) {
      pass++;
      console.log(`✅ ${page.name.padEnd(8)} ${page.file}`);
    } else {
      fail++;
      console.log(`❌ ${page.name.padEnd(8)} ${page.file}`);
      if (r.redirected) console.log('     ↳ 被重定向到登录页（登录态未生效）');
      r.errors.slice(0, 4).forEach((e) => console.log('     ↳ ' + e.slice(0, 240)));
      failedChecks.forEach((c) => console.log('     ↳ 缺少元素: ' + c.sel));
    }
  }

  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail ? 1 : 0);
})();
