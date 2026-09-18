/**
 * dify-local-check.js — 本地真实 Dify 部署前置条件诊断
 *
 * 用法：node tools/dify-local-check.js
 *
 * 逐项检查运行本地 Dify 所需的全部前置条件，并给出可直接执行的修复指引。
 * 每一项都区分「通过 / 警告 / 阻断」三级，最后给出总体结论与推荐路径。
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * 定位 Dify 部署目录。
 * 依次尝试多个候选路径，避免因项目目录结构调整而失效。
 * 可用环境变量 DIFY_DEPLOY_DIR 显式覆盖。
 */
function resolveDifyDir() {
  if (process.env.DIFY_DEPLOY_DIR) return process.env.DIFY_DEPLOY_DIR;
  const candidates = [
    // 整理后的结构：实训2/05-本地部署/dify/docker
    path.resolve(__dirname, '..', '..', '..', '05-本地部署', 'dify', 'docker'),
    // 整理前：实训2/dify-src/docker
    path.resolve(__dirname, '..', '..', 'dify-src', 'docker'),
    // 兼容：同层 05-本地部署
    path.resolve(__dirname, '..', '..', '05-本地部署', 'dify', 'docker'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'docker-compose.yaml'))) return c;
  }
  return candidates[0];
}

const DIFY_DIR = resolveDifyDir();

const results = [];
function record(level, name, detail, fix) {
  results.push({ level, name, detail, fix });
}

/** 安全执行命令，返回 { ok, out, err } */
function run(cmd, args, opts) {
  try {
    const out = execFileSync(cmd, args, {
      encoding: 'utf8',
      timeout: (opts && opts.timeout) || 20000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, out: String(out).trim(), err: '' };
  } catch (e) {
    return {
      ok: false,
      out: (e.stdout ? String(e.stdout) : '').trim(),
      err: (e.stderr ? String(e.stderr) : e.message || '').trim(),
    };
  }
}

console.log('='.repeat(70));
console.log('本地真实 Dify 部署 · 前置条件诊断');
console.log('='.repeat(70));
console.log(`部署目录：${DIFY_DIR}`);
console.log('');

// ---------- 1. 部署文件 ----------
if (fs.existsSync(path.join(DIFY_DIR, 'docker-compose.yaml'))) {
  const envOk = fs.existsSync(path.join(DIFY_DIR, '.env'));
  record(envOk ? 'ok' : 'warn',
    '部署文件',
    `docker-compose.yaml 已就位${envOk ? '，.env 已配置' : '，但 .env 尚未生成'}`,
    envOk ? null : `cd "${DIFY_DIR}" && cp .env.example .env && node configure_dify_env.cjs`);
} else {
  record('block', '部署文件', `未找到 ${path.join(DIFY_DIR, 'docker-compose.yaml')}`,
    '重新执行稀疏克隆，或手动下载 Dify 的 docker 目录');
}

// ---------- 2. 内存 ----------
const totalGB = os.totalmem() / 1024 ** 3;
const freeGB = os.freemem() / 1024 ** 3;
if (totalGB >= 8) {
  record('ok', '内存', `总量 ${totalGB.toFixed(1)} GB（可用 ${freeGB.toFixed(1)} GB），满足 Dify 最低 8 GB 要求`);
} else if (totalGB >= 4) {
  record('warn', '内存', `总量 ${totalGB.toFixed(1)} GB，低于推荐的 8 GB，运行可能卡顿`);
} else {
  record('block', '内存', `总量 ${totalGB.toFixed(1)} GB，低于 Dify 最低要求 4 GB`);
}

// ---------- 3. Docker CLI ----------
const dockerVer = run('docker', ['--version']);
if (dockerVer.ok) {
  record('ok', 'Docker CLI', dockerVer.out);
} else {
  record('block', 'Docker CLI', '未安装或不在 PATH 中', '安装 Docker Desktop：https://www.docker.com/products/docker-desktop/');
}

// ---------- 4. Docker 守护进程 ----------
const dockerInfo = run('docker', ['info'], { timeout: 30000 });
if (dockerInfo.ok) {
  record('ok', 'Docker 守护进程', '已就绪，可执行容器操作');
} else {
  const msg = (dockerInfo.err || '').split('\n')[0];
  record('block', 'Docker 守护进程', `未就绪：${msg.slice(0, 110)}`,
    '启动 Docker Desktop 并等待托盘图标变为绿色');
}

// ---------- 5. WSL2（Docker Linux 引擎的硬依赖） ----------
const wslVer = run('wsl', ['--version']);
if (wslVer.ok) {
  const first = wslVer.out.split('\n')[0];
  record('ok', 'WSL2', first);
} else {
  const err = (wslVer.err || '').toLowerCase();
  // EPERM / Access is denied / 黑名单 都指向「进程被策略阻止启动」这一类原因
  const denied = /access is denied|denied|eperm|blocked|黑名单|policy/.test(err);
  record('block', 'WSL2',
    denied
      ? 'wsl.exe 无法启动（Access is denied / EPERM）—— 本机安全策略已将其列入程序黑名单'
      : `不可用：${(wslVer.err || '').split('\n')[0].slice(0, 110)}`,
    denied
      ? '在「安全中心 → 命令安全 → 程序黑名单」中移除 wsl.exe，然后重启终端；随后以管理员运行 wsl --install'
      : '以管理员身份运行 wsl --install 并重启系统');
}

// ---------- 6. Docker Desktop 代理（拉取镜像所需） ----------
const ddSettings = path.join(os.homedir(), 'AppData', 'Roaming', 'Docker', 'settings-store.json');
let proxyConfigured = false;
if (fs.existsSync(ddSettings)) {
  try {
    const s = JSON.parse(fs.readFileSync(ddSettings, 'utf8'));
    const http = s.ProxyHttpMode || s.OverrideProxyHTTP || s.ProxyHTTP;
    proxyConfigured = !!(s.OverrideProxyHTTP || s.OverrideProxyHTTPS);
    record(proxyConfigured ? 'ok' : 'warn', 'Docker 代理',
      proxyConfigured ? '已配置代理，可正常拉取镜像' : '未配置代理；若本机需经代理上网，镜像拉取会超时',
      proxyConfigured ? null : 'Docker Desktop → 设置 → Resources → Proxies，填入本机代理地址');
  } catch (e) {
    record('warn', 'Docker 代理', '配置文件存在但无法解析', '在 Docker Desktop 设置中手动确认代理配置');
  }
} else {
  record('warn', 'Docker 代理', '未找到 Docker Desktop 设置文件（可能尚未完成首次启动）',
    '首次启动 Docker Desktop 后，在 设置 → Resources → Proxies 中配置代理');
}

// ---------- 7. 端口占用 ----------
const NGINX_PORT = 8081;
const portProbe = run(process.platform === 'win32' ? 'netstat' : 'ss',
  process.platform === 'win32' ? ['-ano'] : ['-ltnp']);
if (portProbe.ok) {
  const occupied = portProbe.out.split('\n').some((l) => new RegExp(`[:.]${NGINX_PORT}\\s`).test(l) && /LISTEN/i.test(l));
  record(occupied ? 'warn' : 'ok', `端口 ${NGINX_PORT}`,
    occupied ? `已被占用（Dify 将无法绑定）` : '空闲，可用于 Dify 控制台',
    occupied ? `netstat -ano | findstr :${NGINX_PORT}  找到 PID 后 taskkill /PID <PID> /F` : null);
} else {
  record('warn', `端口 ${NGINX_PORT}`, '无法探测端口占用情况');
}

// ---------- 8. 磁盘空间 ----------
try {
  const st = fs.statfsSync ? fs.statfsSync('C:') : null;
  if (st) {
    const freeGB = (st.bsize * st.bavail) / 1024 ** 3;
    if (freeGB >= 30) record('ok', '磁盘空间', `C 盘可用 ${freeGB.toFixed(0)} GB（Dify 镜像约需 10–15 GB）`);
    else if (freeGB >= 15) record('warn', '磁盘空间', `C 盘可用 ${freeGB.toFixed(0)} GB，偏紧`);
    else record('block', '磁盘空间', `C 盘可用 ${freeGB.toFixed(0)} GB，不足`);
  }
} catch (e) { /* statfs 不可用时跳过 */ }

// ---------- 输出 ----------
const ICON = { ok: '[OK]  ', warn: '[警告]', block: '[阻断]' };
console.log('检查结果：\n');
for (const r of results) {
  console.log(`${ICON[r.level]} ${r.name}`);
  console.log(`        ${r.detail}`);
  if (r.fix) console.log(`        → 修复：${r.fix}`);
  console.log('');
}

const blocks = results.filter((r) => r.level === 'block');
const warns = results.filter((r) => r.level === 'warn');

console.log('='.repeat(70));
if (blocks.length === 0) {
  console.log('✓ 前置条件全部满足，可以执行一键启动：');
  console.log('    node tools/dify-local-start.js');
  if (warns.length) console.log(`  （另有 ${warns.length} 项警告，建议一并处理）`);
} else {
  console.log(`✗ 存在 ${blocks.length} 项阻断，本地 Dify 暂无法运行：`);
  blocks.forEach((b, i) => console.log(`    ${i + 1}. ${b.name} —— ${b.detail}`));
  console.log('');
  console.log('  修复后重新运行本诊断即可。');
  console.log('  ** 答辩兜底：契约桩方案不受上述任何一项影响，可随时使用：');
  console.log('     node tools/demo-mode.js local-mock');
  console.log('     node tests/mock-dify-server.js --port 8080 --serve .');
}
console.log('='.repeat(70));

process.exit(blocks.length === 0 ? 0 : 1);
