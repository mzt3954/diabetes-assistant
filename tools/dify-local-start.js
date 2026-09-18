/**
 * dify-local-start.js — 答辩现场一键启动编排（真实 Dify 优先，契约桩兜底）
 *
 * 用法：
 *   node tools/dify-local-start.js                  # 默认：优先真实 Dify，失败自动兜底
 *   node tools/dify-local-start.js --prefer stub    # 直接用契约桩（最稳）
 *   node tools/dify-local-start.js --no-docker      # 不尝试启动 Docker，只做健康探测
 *
 * 编排流程：
 *   1. 探测本地 Dify 是否已可用（已运行则直接接线）
 *   2. 否则尝试启动 Docker Desktop（含 ProgramData 环境变量修复）→ 等待引擎
 *   3. docker compose 拉起 Dify → 等待健康检查
 *   4. 任一环节失败 → 自动切换到契约桩（零外部依赖，功能完整）
 *   5. 输出最终可用的演示地址与模式
 *
 * 设计要点：
 *   - 绝不中途退出：任何失败都收敛到一个「可演示」的终态
 *   - Docker Desktop 必须补齐 ProgramData/APPDATA 等环境变量，否则其后端会崩溃
 */
'use strict';

const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/**
 * 定位 Dify 部署目录。依次尝试多个候选路径，避免因目录结构调整而失效。
 * 可用环境变量 DIFY_DEPLOY_DIR 显式覆盖。
 */
function resolveDifyDir() {
  if (process.env.DIFY_DEPLOY_DIR) return process.env.DIFY_DEPLOY_DIR;
  const candidates = [
    // 整理后的结构：实训2/05-本地部署/dify/docker
    path.resolve(ROOT, '..', '..', '05-本地部署', 'dify', 'docker'),
    // 整理前：实训2/dify-src/docker
    path.resolve(ROOT, '..', 'dify-src', 'docker'),
    // 兼容：同层 05-本地部署
    path.resolve(ROOT, '..', '05-本地部署', 'dify', 'docker'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'docker-compose.yaml'))) return c;
  }
  return candidates[0];
}

const DIFY_DIR = resolveDifyDir();

const args = process.argv.slice(2);
function has(flag) { return args.includes(flag); }
function argVal(name, dft) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dft;
}

const PREFER = argVal('--prefer', 'dify');
const NO_DOCKER = has('--no-docker');

const DIFY_URL = argVal('--dify-url', 'http://127.0.0.1:8081');
const STUB_PORT = Number(argVal('--stub-port', '8080'));
const STUB_URL = `http://127.0.0.1:${STUB_PORT}`;

const DOCKER_DESKTOP = 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe';

function log(step, msg) { console.log(`[${step}] ${msg}`); }
function hr() { console.log('-'.repeat(68)); }

/** 带超时的 HTTP 探测 */
async function probe(url, ms = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    return { ok: true, status: r.status };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? '超时' : e.message };
  } finally { clearTimeout(t); }
}

/** 同步执行命令 */
function run(cmd, cmdArgs, opts) {
  try {
    const out = execFileSync(cmd, cmdArgs, {
      encoding: 'utf8', timeout: (opts && opts.timeout) || 60000,
      stdio: ['ignore', 'pipe', 'pipe'], cwd: (opts && opts.cwd) || undefined,
    });
    return { ok: true, out: String(out).trim(), err: '' };
  } catch (e) {
    return { ok: false, out: (e.stdout || '').toString().trim(), err: (e.stderr || e.message || '').toString().trim() };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 等待条件成立，最多 maxMs 毫秒 */
async function waitFor(fn, maxMs, intervalMs = 5000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await sleep(intervalMs);
  }
  return false;
}

// ============ 1. 本地 Dify 健康探测 ============
async function difyHealthy() {
  const r = await probe(`${DIFY_URL}/console/api/setup`, 4000);
  return r.ok && (r.status === 200 || r.status === 401 || r.status === 404);
}

// ============ 2. 启动 Docker Desktop（含环境变量修复）============
function startDockerDesktop() {
  if (!fs.existsSync(DOCKER_DESKTOP)) {
    return { ok: false, reason: `未找到 ${DOCKER_DESKTOP}` };
  }
  // 关键修复：从精简环境中启动时必须补齐这些变量，否则后端会以
  // "unable to get 'ProgramData'" 崩溃
  const env = Object.assign({}, process.env, {
    ProgramData: 'C:\\ProgramData',
    ALLUSERSPROFILE: 'C:\\ProgramData',
    APPDATA: path.join(process.env.USERPROFILE || 'C:\\Users\\mazit', 'AppData', 'Roaming'),
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    PUBLIC: 'C:\\Users\\Public',
  });

  try {
    const child = spawn(DOCKER_DESKTOP, [], { detached: true, stdio: 'ignore', env });
    child.unref();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

async function ensureDockerEngine() {
  if (run('docker', ['info'], { timeout: 25000 }).ok) {
    log('Docker', '守护进程已在运行');
    return { ok: true, started: false };
  }

  if (NO_DOCKER) {
    return { ok: false, reason: '按 --no-docker 要求跳过启动尝试' };
  }

  log('Docker', '守护进程未运行，正在启动 Docker Desktop…');
  const s = startDockerDesktop();
  if (!s.ok) return { ok: false, reason: s.reason };

  const ready = await waitFor(() => run('docker', ['info'], { timeout: 20000 }).ok, 240000, 6000);
  if (ready) {
    log('Docker', '✓ 守护进程已就绪');
    return { ok: true, started: true };
  }

  // 超时后给出精确原因
  const info = run('docker', ['info'], { timeout: 15000 });
  const wsl = run('wsl', ['--version'], { timeout: 10000 });
  let reason = '等待 240 秒后守护进程仍未就绪';
  if (!wsl.ok) {
    reason += `；WSL 不可用（${(wsl.err || '').split('\n')[0].slice(0, 80)}）—— ` +
      'Docker 的 Linux 引擎依赖 WSL2，请在「安全中心 → 命令安全 → 程序黑名单」中移除 wsl.exe';
  }
  return { ok: false, reason, raw: (info.err || '').split('\n')[0] };
}

// ============ 3. 拉起 Dify 服务栈 ============
async function startDifyStack() {
  if (!fs.existsSync(path.join(DIFY_DIR, 'docker-compose.yaml'))) {
    return { ok: false, reason: `未找到 ${path.join(DIFY_DIR, 'docker-compose.yaml')}` };
  }
  if (!fs.existsSync(path.join(DIFY_DIR, '.env'))) {
    return { ok: false, reason: '.env 未生成，请先运行 node configure_dify_env.cjs' };
  }

  log('Dify', '正在拉起服务栈（首次会拉取镜像，可能耗时较久）…');
  const up = run('docker-compose', ['up', '-d'], { cwd: DIFY_DIR, timeout: 1800000 });
  if (!up.ok) {
    const alt = run('docker', ['compose', 'up', '-d'], { cwd: DIFY_DIR, timeout: 1800000 });
    if (!alt.ok) {
      return { ok: false, reason: (alt.err || up.err || '').split('\n').slice(-3).join(' ').slice(0, 240) };
    }
  }

  log('Dify', '容器已启动，等待健康检查…');
  const healthy = await waitFor(difyHealthy, 300000, 6000);
  return healthy ? { ok: true } : { ok: false, reason: '容器已启动但 300 秒内未通过健康检查' };
}

// ============ 4. 契约桩兜底 ============
async function startStub() {
  const already = await probe(`${STUB_URL}/index.html`, 3000);
  if (already.ok && already.status === 200) {
    log('契约桩', '已在运行');
  } else {
    log('契约桩', '正在启动（单端口托管静态站点与 /v1 API）…');
    const env = Object.assign({}, process.env);
    const child = spawn('node', ['tests/mock-dify-server.js', '--port', String(STUB_PORT), '--serve', '.'], {
      cwd: ROOT, detached: true, stdio: 'ignore', env,
    });
    child.unref();
    const up = await waitFor(async () => {
      const r = await probe(`${STUB_URL}/index.html`, 3000);
      return r.ok && r.status === 200;
    }, 30000, 2000);
    if (!up) return { ok: false, reason: '契约桩 30 秒内未就绪' };
    log('契约桩', '✓ 已就绪');
  }

  // 前端切到契约桩模式
  const mode = run('node', ['tools/demo-mode.js', 'local-mock'], { cwd: ROOT });
  if (mode.ok) log('契约桩', '前端配置已切换到契约桩模式');
  return { ok: true };
}

// ============ 主流程 ============
(async () => {
  console.log('='.repeat(68));
  console.log('答辩演示一键启动 · 糖尿病预治智能助手');
  console.log('='.repeat(68));

  let mode = 'none';
  let demoUrl = '';
  const notes = [];

  // 0) 若用户强制走兜底，直接跳到契约桩
  if (PREFER === 'stub') {
    log('策略', '按 --prefer stub 直接使用契约桩');
  } else {
    // 1) 本地 Dify 已可用？
    log('探测', `检查本地 Dify ${DIFY_URL} …`);
    if (await difyHealthy()) {
      log('探测', '✓ 本地 Dify 已在运行');
      mode = 'dify';
    } else {
      // 2) 启动 Docker
      const dk = await ensureDockerEngine();
      if (!dk.ok) {
        notes.push(`Docker 不可用：${dk.reason}`);
        log('Docker', `✗ ${dk.reason}`);
      } else {
        // 3) 拉起 Dify
        const df = await startDifyStack();
        if (df.ok) {
          log('Dify', '✓ 服务栈健康');
          mode = 'dify';
        } else {
          notes.push(`Dify 启动失败：${df.reason}`);
          log('Dify', `✗ ${df.reason}`);
        }
      }
    }
  }

  // 4) 兜底
  if (mode !== 'dify') {
    hr();
    log('兜底', '真实 Dify 不可用，切换到契约桩（功能完整、零外部依赖）');
    const st = await startStub();
    if (st.ok) {
      mode = 'stub';
    } else {
      notes.push(`契约桩启动失败：${st.reason}`);
      log('兜底', `✗ ${st.reason}`);
    }
  }

  // 5) 结果
  hr();
  if (mode === 'dify') {
    const wire = run('node', ['tools/dify-console.js', 'write-config'], {
      cwd: ROOT,
      env: Object.assign({}, process.env, { DIFY_BASE_URL: DIFY_URL }),
    });
    demoUrl = `${STUB_URL}/index.html`;
    console.log('运行模式：本地真实 Dify');
    console.log(`Dify 控制台：${DIFY_URL}`);
    console.log(`前端地址：  ${demoUrl}`);
    console.log('演示账号：  admin / admin123（管理员）　user / user123（普通用户）');
    if (!wire.ok) {
      console.log('');
      console.log('提示：未能自动回写 API Key，请手动执行：');
      console.log(`  DIFY_BASE_URL=${DIFY_URL} npm run dify:keys && npm run dify:wire`);
    }
  } else if (mode === 'stub') {
    demoUrl = `${STUB_URL}/index.html`;
    console.log('运行模式：本地契约桩（完整在线模式：HTTP + SSE）');
    console.log(`前端地址：  ${demoUrl}`);
    console.log('演示账号：  admin / admin123（管理员）　user / user123（普通用户）');
  } else {
    console.log('✗ 未能进入任何可演示状态，请检查上方错误。');
  }

  if (notes.length) {
    console.log('');
    console.log('说明：');
    notes.forEach((n, i) => console.log(`  ${i + 1}. ${n}`));
    console.log('  修复后可运行 node tools/dify-local-check.js 复查');
  }

  console.log('');
  console.log('='.repeat(68));
  if (demoUrl) {
    console.log(`✓ 演示已就绪：${demoUrl}`);
    console.log('  停止服务：关闭对应终端窗口，或 docker-compose down（Dify）');
  }
  console.log('='.repeat(68));
  process.exit(mode === 'none' ? 1 : 0);
})().catch((e) => {
  console.error('编排过程异常：', e.message);
  process.exit(1);
});
