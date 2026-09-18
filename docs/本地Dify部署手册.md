# 本地 Dify 部署手册（答辩现场）

> 目标：在本机运行**真实 Dify 实例**，与前端 `diabetes-assistant` 对接，答辩时一键启动。
>
> 版本：Dify **1.17.1**（自托管 docker-compose 部署）
> 部署目录：`C:\Users\mazit\Desktop\2026秋\实训2\05-本地部署\dify\docker`
> 编写时间：2026-09-18

---

## 一、当前状态结论（务必先读）

### 1.1 已完成

| 项目 | 状态 |
|---|---|
| Dify 1.17.1 部署文件 | ✅ 已获取（稀疏克隆，仅取 `docker/` 目录） |
| `.env` 配置 | ✅ 已生成（端口 8081、随机 SECRET_KEY、初始口令） |
| 前置条件诊断脚本 | ✅ `tools/dify-local-check.js` |
| 一键启动编排脚本 | ✅ `tools/dify-local-start.js`（含自动兜底） |
| Windows 双击入口 | ✅ `启动答辩演示.cmd` |
| Docker Desktop 启动崩溃 | ✅ **已定位并修复**（`ProgramData` 环境变量缺失） |

### 1.2 当前阻断项（**需人工处理，无法由脚本绕过**）

诊断结果：**2 项阻断**

| # | 阻断项 | 实测证据 | 性质 |
|---|---|---|---|
| 1 | **WSL2 不可用** | `fork/exec C:\WINDOWS\System32\wsl.exe: Access is denied` | 本机安全策略将 `wsl.exe` 列入程序黑名单 |
| 2 | **Docker 守护进程未就绪** | 由 #1 直接导致（Docker 的 Linux 引擎依赖 WSL2） | 连锁结果 |

Docker Desktop 自身弹出的报错原文：

```
There was a problem with WSL
An error occurred while running a WSL command.
Please check your WSL configuration and try again.
```

> **为什么脚本绕不过去**：安全策略的拦截提示明确声明
> *"This block cannot be approved or bypassed from the current command."*
> 必须在「安全中心 → 命令安全 → 程序黑名单」中由用户手动移除 `wsl.exe`。

### 1.3 另有一项警告

| 警告项 | 说明 | 影响 |
|---|---|---|
| Docker 代理未配置 | Docker Desktop 无 HTTPS 代理设置，实测访问 `hub.docker.com:443` 超时 | 即使 WSL2 恢复，**镜像仍拉不下来**（Dify 镜像约 10–15 GB） |

---

## 二、运行环境与依赖

### 2.1 硬件与系统要求

| 项目 | 最低 | 推荐 | 本机实测 |
|---|---|---|---|
| 内存 | 4 GB | **8 GB+** | **15.7 GB** ✅ |
| 磁盘可用 | 20 GB | 40 GB+ | C 盘 67 GB ✅ |
| CPU | 2 核 | 4 核+ | — |
| 虚拟化 | 需开启（WSL2 / Hyper-V） | 同左 | **受策略限制** ❌ |

### 2.2 软件依赖

| 组件 | 版本 | 本机实测 | 说明 |
|---|---|---|---|
| Docker Desktop | 4.x+ | **4.91.0（已安装）** ✅ | 提供容器运行时 |
| Docker Compose | v2+ | **v5.5.1** ✅ | 编排服务栈 |
| WSL2 | 内核 5.10+ | **被黑名单阻止** ❌ | **Linux 引擎的硬依赖** |
| Node.js | 18+ | v22.22.2 ✅ | 运行编排脚本 |

### 2.3 前端侧依赖

前端 `ai/` 目录是**零运行时依赖**的纯静态站点，本身不需要 Docker。
Docker 仅用于承载 Dify 平台。

---

## 三、数据存储

Dify 的全部持久化数据都落在**部署目录下的 `volumes/` 子目录**（bind mount），
因此备份/迁移只需拷贝该目录。

| 数据 | 宿主路径（相对 `05-本地部署/dify/docker/`） | 内容 |
|---|---|---|
| **PostgreSQL 数据** | `volumes/db/data` | 应用、工作流、账号、会话记录 |
| **向量库数据** | `volumes/weaviate` | 知识库向量（6 份糖尿病专业文档） |
| **Redis 数据** | `volumes/redis/data` | 缓存与任务队列 |
| **应用文件** | `volumes/app/storage` | 上传文件、生成物 |
| **插件数据** | `volumes/plugin_daemon` | 已安装的供应商插件（如 DeepSeek） |
| **沙箱依赖** | `volumes/sandbox/dependencies` | 代码节点运行时依赖 |

另有 Docker 命名卷：`oradata`、`dify_es01_data`、`dify_agent_local_sandbox_home`、`dify_agent_local_sandbox_workspace`。

> **注意**：Docker 镜像本身存放在 Docker Desktop 的 WSL2 虚拟磁盘中（默认位于 C 盘
> `%LOCALAPPDATA%\Docker`）。若 C 盘紧张，可在 Docker Desktop → 设置 → Resources 中
> 迁移磁盘映像位置。

---

## 四、服务构成与启动方式

### 4.1 核心服务

| 服务 | 镜像 | 作用 |
|---|---|---|
| `api` / `api_websocket` / `worker` / `worker_beat` | `langgenius/dify-api:1.17.1` | 后端 API、异步任务、定时任务 |
| `web` | `langgenius/dify-web:1.17.1` | 控制台前端 |
| `plugin_daemon` | `langgenius/dify-plugin-daemon:0.6.10-local` | 模型供应商插件运行时 |
| `sandbox` | `langgenius/dify-sandbox:0.2.15` | 工作流代码节点沙箱 |
| `db_postgres` | `postgres` | 主数据库 |
| `redis` | `redis` | 缓存 / 队列 |
| `weaviate` | `cr.weaviate.io/semitechnologies/weaviate:1.39.2` | 向量库（知识库检索） |
| `nginx` | `nginx` | 反向代理，对外暴露 8081 |
| `ssrf_proxy` | `ubuntu/squid` | 出站请求代理（安全隔离） |

### 4.2 端口分配（本项目约定）

| 端口 | 用途 | 说明 |
|---|---|---|
| **8081** | Dify 控制台 / API | `.env` 中 `EXPOSE_NGINX_PORT=8081` |
| 8443 | Dify HTTPS | `EXPOSE_NGINX_SSL_PORT=8443`（未启用证书时不用） |
| **8080** | 前端演示站点 + 契约桩 | 与 Dify 并存，互不冲突 |

> 之所以把 Dify 从默认的 80 改到 8081：80 端口易与其他服务冲突且可能需管理员权限，
> 同时保留 8080 给答辩演示站点，两套链路可同时运行、随时切换。

### 4.3 启动 / 停止命令

```bash
cd "C:/Users/mazit/Desktop/2026秋/实训2/05-本地部署/dify/docker"

docker-compose up -d        # 启动（首次会拉取镜像）
docker-compose ps           # 查看状态
docker-compose logs -f api  # 查看后端日志
docker-compose down         # 停止并移除容器（数据保留在 volumes/）
docker-compose down -v      # 停止并删除数据卷（**慎用，会清空数据**）
```

---

## 五、一键启动（答辩现场）

### 5.1 推荐方式：双击

双击项目根目录下的 **`启动答辩演示.cmd`**。

它会自动执行：

1. 探测本地 Dify 是否已可用（已运行则直接接线）
2. 否则尝试启动 Docker Desktop（**已内置 `ProgramData` 环境变量修复**）并等待引擎就绪
3. `docker-compose up -d` 拉起 Dify 并等待健康检查
4. **任一环节失败 → 自动切换到契约桩**（零外部依赖，功能完整）
5. 输出最终可用的演示地址

> **关键设计：脚本绝不中途失败退出。** 无论 Dify 是否可用，最终都会收敛到一个
> 「可演示」的终态 —— 这是答辩现场最重要的保障。

### 5.2 命令行方式

```bash
cd "C:/Users/mazit/Desktop/2026秋/实训2/01-源代码/diabetes-assistant"

node tools/dify-local-check.js     # 先体检：看有无阻断项
node tools/dify-local-start.js     # 一键启动（真实 Dify 优先，自动兜底）

# 可选参数
node tools/dify-local-start.js --prefer stub    # 直接用契约桩（最稳）
node tools/dify-local-start.js --no-docker      # 不尝试启动 Docker
```

---

## 六、解除阻断的步骤（需人工操作）

要让真实 Dify 跑起来，需依次完成以下三步。**每步完成后重新运行 `dify-local-check.js` 复查。**

### 步骤 1：解除 `wsl.exe` 黑名单

1. 打开 **安全中心 → 命令安全 → 程序黑名单**
2. 找到 `wsl.exe`（路径 `C:\Windows\System32\wsl.exe`）并**移除**
3. 关闭并重新打开终端（使策略生效）

验证：

```bash
wsl --version
# 期望输出 WSL 版本信息，而非 "Access is denied"
```

### 步骤 2：确保 WSL2 已安装并可运行

若步骤 1 后 `wsl --version` 报「未安装发行版」，以**管理员身份**运行：

```powershell
wsl --install
```

然后**重启系统**。重启后验证：

```bash
wsl -l -v
# 期望至少有一个发行版，且 VERSION 为 2
```

### 步骤 3：为 Docker Desktop 配置代理

本机经代理上网（实测 `http_proxy` 指向本机端口），Docker Desktop 默认不继承该设置，
导致 `hub.docker.com` 连接超时。

1. Docker Desktop → **设置 → Resources → Proxies**
2. 开启 **Manual proxy configuration**
3. Web Server (HTTP) 与 Secure Web Server (HTTPS) 都填入本机代理地址
4. **Apply & Restart**

> 若本机代理为 `127.0.0.1:53520` 这类**本机回环地址**，Docker Desktop 运行在 WSL2 虚拟机中，
> 无法直接访问宿主的 `127.0.0.1`。此时需改用宿主机在 WSL2 网络中的地址
> （通常是 `172.x.x.x`，可在 WSL 中执行 `ip route show default` 查看网关地址），
> 或为代理软件开启「允许局域网连接」。

验证：

```bash
docker pull hello-world
# 期望成功拉取
```

### 步骤 4：完成首次部署

三步全部通过后：

```bash
cd "C:/Users/mazit/Desktop/2026秋/实训2/05-本地部署/dify/docker"
docker-compose up -d
```

首次会拉取约 **10–15 GB** 镜像，视网速可能耗时 10–40 分钟。启动后访问
`http://127.0.0.1:8081` 进入 Dify 控制台。

**初始管理员账号**：在 `.env` 中通过 `INIT_PASSWORD` 设定（当前值见该文件）。
首次访问时用 `INIT_PASSWORD` 对应的邮箱 + 口令登录。

---

## 七、部署完成后的接线流程

Dify 跑起来后，需要把前端的 8 个应用接上去。项目已备好全套自动化工具：

```bash
cd "C:/Users/mazit/Desktop/2026秋/实训2/01-源代码/diabetes-assistant"
export DIFY_BASE_URL=http://127.0.0.1:8081

# ① 确认模型供应商已配置（8 个应用全部依赖 DeepSeek）
npm run dify:providers

# ② 生成 8 个应用的 DSL（provider / model 按实际填）
node tools/gen-dsl.js --provider langgenius/deepseek/deepseek --model deepseek-chat

# ③ 导入 8 个应用
npm run dify:import

# ④ 创建各应用 API Key
npm run dify:keys

# ⑤ 把 Key 回写进前端配置
npm run dify:wire

# ⑥ 端到端验证
npm run test:real
```

### 关键前置：配置 DeepSeek 供应商

**这一步不能跳。** 8 个应用全部使用 `langgenius/deepseek/deepseek` 供应商。
未配置供应商时，应用能建、能导入、能拿 Key，但**一执行就报 `provider not configured`**，
表现为前端静默降级回本地引擎，极难排查。

配置路径：Dify 控制台 → 右上角头像 → **设置** → **模型供应商** →
安装 **DeepSeek** 插件 → 填入 DeepSeek API Key。

> **重要认知**：Dify 是**编排平台**，推理仍在 DeepSeek 云端完成。
> 因此「本地部署 Dify」**并不能**让演示摆脱外网依赖 —— 仍需外网可达
> `api.deepseek.com` 且密钥有余额。

---

## 八、方案选型建议（答辩现场）

| 维度 | 本地真实 Dify | 契约桩 |
|---|---|---|
| 启动依赖 | Docker + WSL2 + 10–15 GB 镜像 | 仅 Node |
| 启动耗时 | 1–3 分钟（冷启动更久） | < 1 秒 |
| 是否需外网 | **是**（调用 DeepSeek 云 API） | 否 |
| 是否需密钥 | **是**（付费 DeepSeek Key） | 否 |
| 失败面 | Docker / WSL / 网络 / 密钥 / 额度 | 几乎为零 |
| 答辩说服力 | 高（真实平台） | 中（契约忠实模拟） |

**建议：双轨并行。**

- **主演示**用本地真实 Dify，体现「真实接入 Dify 平台」的工程完成度
- **兜底**保留契约桩，`dify-local-start.js` 已实现自动降级
- 答辩当天若 Dify 起不来，**不要现场排查**，直接用契约桩照常演示（功能与接口契约完全一致）

---

## 九、附录：文件清单

| 文件 | 位置 | 作用 |
|---|---|---|
| `docker-compose.yaml`、`.env`、`nginx/`、`volumes/` | `实训2/05-本地部署/dify/docker/` | Dify 1.17.1 部署文件 |
| `configure_dify_env.cjs` | 同上 | 生成并配置 `.env`（端口 / 密钥 / 口令） |
| `tools/dify-local-check.js` | `实训2/01-源代码/diabetes-assistant/` | 前置条件诊断（逐项给修复指引） |
| `tools/dify-local-start.js` | `实训2/01-源代码/diabetes-assistant/` | 一键启动编排（含自动兜底） |
| `启动答辩演示.cmd` | `实训2/01-源代码/diabetes-assistant/` | Windows 双击入口 |
| `tools/demo-check.js` | `实训2/01-源代码/diabetes-assistant/` | 契约桩链路体检 |
| `tools/demo-mode.js` | `实训2/01-源代码/diabetes-assistant/` | 演示模式切换 |

---

## 十、故障速查

| 现象 | 原因 | 处理 |
|---|---|---|
| Docker 启动后立即退出，日志含 `unable to get 'ProgramData'` | 从精简环境启动，缺 `ProgramData` 变量 | 已由 `dify-local-start.js` 内置修复；手动启动时需在完整 Windows 环境下进行 |
| Docker 报 `There was a problem with WSL` | `wsl.exe` 被黑名单阻止 | 见 §6 步骤 1 |
| `docker pull` 超时 | Docker 未配代理 | 见 §6 步骤 3 |
| Dify 起来但应用执行报 `provider not configured` | 未配置 DeepSeek 供应商 | 见 §7 |
| 页面显示「离线演示模式」但期望在线 | 前端 Key 未回写或地址不对 | 检查 `js/config.local.js` 的 `baseUrl`，或运行 `npm run dify:wire` |
| 端口 8081 被占用 | 上次残留进程 | `netstat -ano \| findstr :8081` 后 `taskkill /PID <PID> /F` |

---

*本手册配套项目 `diabetes-assistant` v2.1.0，Dify 版本 1.17.1。*
