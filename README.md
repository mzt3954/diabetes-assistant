# 糖尿病预治智能助手

> 基于 **DeepSeek 大模型 + Dify LLM 应用平台** 的一站式糖尿病预防与治疗健康管理平台
> 版本 v2.1.0 ｜ 纯静态前端（零构建、零运行时依赖）｜ 双模式运行（在线 AI ⇄ 本地降级）

---

## 一、快速开始

### 方式一：直接打开（最快）
双击 `index.html` 即可。所有功能均可用（本地降级模式）。

### 方式二：本地服务器（推荐）
```bash
cd ai
npx http-server -p 8080
# 或
python -m http.server 8080
```
访问 <http://localhost:8080>

### 演示账号
| 角色 | 账号 | 密码 | 权限 |
|------|------|------|------|
| 管理员 | `admin` | `admin123` | 全部功能 + AI 智能管理 |
| 普通用户 | `user` | `user123` | 除智能管理外全部功能 |

> 登录页提供「演示账号」一键填充按钮。

---

## 二、功能模块

| # | 页面 | 功能 |
|---|------|------|
| 1 | `index.html` | 登录 / 注册 / 记住我 / 角色识别 |
| 2 | `home.html` | 轮播图、快捷入口、健康科普、糖尿病类型入口 |
| 3 | `article.html` | 科普文章详情、阅读量、收藏 |
| 4 | `diabetes.html` | 4 类糖尿病：病因 / 临床表现 / 治疗原则 / 生活注意事项 |
| 5 | `doctor.html` | 医师列表、在线咨询、快捷提问、**流式回复** |
| 6 | `risk-prediction.html` | 个人信息、风险评分、概率环、归因、个性化建议、历史记录 |
| 7 | `life-plan.html` | 方案展示、方案定制、饮食/运动打卡 |
| 8 | `checkin.html` | 近 7 日打卡概览、三维智能分析、打卡明细 |
| 9 | `health-news.html` | 标签分类、AI 生成资讯、收藏与取消收藏 |
| 10 | `assistant.html` | AI 智能助手，**SSE 流式输出**，多轮上下文 |
| 11 | `personal.html` | 资料编辑、我的方案/资讯/打卡、帮助、退出 |
| 12 | `admin.html` | **AI 智能管理**：自然语言管理数据、数据总览、数据表、导出 |
| 13 | `help.html` | 使用指南、常见问题、医疗免责声明 |

---

## 三、技术架构

```
表现层  13 × HTML（语义化，零内联脚本；6 处内联样式属性）
组件层  css/common.css（设计系统，含语义化令牌 --risk-* / --agent-color） + js/ui.js（导航/Toast/Modal/校验/转义/跳转白名单）
业务层  js/pages/*.js（各页面控制器）
服务层  js/api.js（Dify 客户端 + SSE 流式 + 空闲超时 + 重试策略 + 输出归一化 + 自动降级）
数据层  js/store.js（localStorage 仓储 + 内存缓存 + 按用户隔离） + js/seed.js（种子数据）
安全层  js/crypto.js（纯 JS SHA-256 + 加盐迭代口令哈希）
配置层  js/config.js（Dify Base URL / 代理模式 / App Keys / 开关）
```

### 双模式运行

```
                     ┌─ 已配置 Dify Key（或开启 proxyMode）→ 真实 Dify 工作流 / 对话流（SSE 流式）
页面 → js/api.js ────┤
                     └─ 未配置 / 请求失败 / 契约不匹配 → 自动降级 js/mock-engine.js（离线可用）
```

- **离线演示模式**：无需部署 Dify，克隆即跑，所有功能有真实输出
- **在线模式**：填入 Dify 地址与 Key 即切换为真实大模型能力（见 `docs/Dify应用配置指南.md`）
- **推荐生产形态**：`proxyMode: true` + Nginx `/v1/` 反向代理，密钥只存在于服务端，前端源码与 Network 面板均不可见
- **鲁棒性**：Dify 不可用时自动降级并 Toast 提示，不白屏；契约不匹配时同样降级，不渲染半成品

---

## 四、项目结构

```
ai/
├── index.html  home.html  article.html  diabetes.html
├── doctor.html  risk-prediction.html  life-plan.html  checkin.html
├── health-news.html  assistant.html  personal.html  admin.html  help.html
├── css/
│   ├── common.css      # 设计系统：令牌 / 重置 / 组件 / 工具类 / 响应式
│   └── pages.css       # 页面级样式（按页分节）
├── js/
│   ├── config.js       # ⚙️ Dify 配置入口（baseUrl / proxyMode / apiKey）
│   ├── crypto.js       # 🔐 纯 JS SHA-256 + 加盐迭代口令哈希
│   ├── seed.js         # 种子数据（提炼自项目素材知识库）
│   ├── store.js        # 数据仓储（CRUD + 缓存 + 按用户隔离 + 口令升级）
│   ├── auth.js         # 登录态 / 权限守卫（role: user|admin）
│   ├── ui.js           # 通用 UI 组件与工具（含 safeRedirect 跳转白名单）
│   ├── mock-engine.js  # 本地智能引擎（风险评分 / 方案 / 资讯 / 打卡分析）
│   ├── api.js          # Dify 服务层（HTTP + SSE + 归一化 + 降级）
│   └── pages/          # 13 个页面控制器
├── snippets/
│   └── security-headers.conf   # Nginx 安全响应头片段（规避 add_header 继承陷阱）
├── docs/
│   ├── 开发计划_优化版.md
│   ├── Dify应用配置指南.md
│   └── 部署说明.md
├── tests/
│   ├── logic-test.js          # 核心逻辑单元测试（72 项）
│   ├── smoke-test.js          # 13 页面 DOM 冒烟测试（jsdom）
│   ├── integration-test.js    # Dify 真实联调测试（HTTP + SSE，24 项）
│   ├── mock-dify-server.js    # Dify 契约桩服务（无 Key 也能联调）
│   └── e2e.spec.js            # Playwright 端到端测试（17 项）
├── .github/workflows/ci.yml   # CI：lint → 单测 → 冒烟 → 联调 → E2E
├── eslint.config.js           # ESLint 9 扁平配置
├── nginx.conf                 # Nginx 部署配置（HTTPS + 反代 + CSP）
└── package.json               # 仅含 devDependencies（运行时零依赖）
```

---

## 五、核心算法

### 风险预测（CDRS 量表）
| 变量 | 分档 | 分值 |
|------|------|------|
| 年龄 | <40 / 40–49 / 50–59 / ≥60 | 0 / 2 / 4 / 6 |
| BMI | <24 / 24–27.9 / ≥28 | 0 / 3 / 5 |
| 腰围 | 男<90cm 女<85cm / 超标 | 0 / 3 |
| 家族史 | 无 / 有 | 0 / 5 |
| 收缩压 | <130 / ≥130 | 0 / 3 |
| 性别 | 女 / 男 | 0 / 1 |
| 妊娠史 | 无 / 有（女性） | 0 / 4 |

总分 0–27：**<9 低风险 ｜ 9–15 中风险 ｜ ≥16 高风险**，并给出风险归因与个性化建议。

> ⚠️ 医疗安全：结果仅供筛查参考，不能替代临床诊断。

### 打卡分析（三维指标）
- **完成率** = 实际打卡项 / 应打卡项 → ≥85% 优秀 / ≥60% 良好 / <60% 需改进
- **连续天数** = 近 7 日最长连续打卡
- **类型均衡度** = min(饮食完成率, 运动完成率)

---

## 六、测试

```bash
npm install            # 只装开发依赖（运行时零依赖）
npm test               # 单元测试 + 冒烟测试
npm run test:integration   # Dify 联调测试（自动拉起契约桩服务，无需真实 Dify）
npm run test:e2e       # Playwright 端到端测试
npm run test:all       # 全部（不含 E2E）
npm run lint           # ESLint
```

| 测试 | 命令 | 覆盖 | 当前结果 |
|------|------|------|----------|
| 单元测试 | `node tests/logic-test.js` | 风险算法分档、打卡三维指标、**时区一致性**、**口令哈希**、权限模型、**会话持久化**、**改名数据迁移**、XSS 转义、**跳转白名单**、CRUD、降级、**输出归一化** | **85 / 85** |
| 冒烟测试 | `node tests/smoke-test.js` | 13 个页面的脚本错误与关键元素渲染 | **13 / 13** |
| DSL 契约测试 | `node tests/dsl-test.js` | 8 个应用 DSL 结构、mode、值引用、变量类型与前端契约一致性 | **91 / 91** |
| 传输层测试 | `node tests/transport-test.js` | 代理绕过、Set-Cookie 解析、失败分类、应用名映射、fetchShim 语义 | **40 / 40** |
| 联调测试 | `node tests/integration-test.js` | 真实 HTTP + SSE：8 个应用全链路、鉴权、重试策略、契约降级、SSE 异常与空闲超时 | **24 / 24** |
| E2E | `npx playwright test` | 主链路 + 权限 + XSS + 开放重定向 + 口令不落明文 | **17 / 17** |

### 无真实 Dify 也能联调

`tests/mock-dify-server.js` 是一份**契约忠实**的 Dify 桩服务：按 API Key 区分应用（与 Dify 一致）、
校验 `Authorization: Bearer`、复刻工作流阻塞响应结构与 SSE 事件序列、并支持故障注入
（401 / 500 / 契约不匹配 / SSE error / 连接挂起），用于验证前端的重试与降级两条路径。

```bash
# 只起 API（默认 8080）
node tests/mock-dify-server.js
# 同时托管静态站点，浏览器直接联调
node tests/mock-dify-server.js --port 8080 --serve .
```

启动后会打印 8 个应用的 Key 对照表，把它们填入 `js/config.js` 的 `apps.*.apiKey` 即可在线联调。

---

## 七、素材来源

| 素材 | 用途 |
|------|------|
| `项目素材/知识库/*.docx`（6 份，约 2.3 万字） | Dify 知识库（RAG）+ 前端种子数据（`js/seed.js`） |
| `项目素材/知识库/db.txt`（9 张表） | 数据模型规范（`js/store.js` 字段对齐） |
| `实训2代码/diabetesAssistant/`（空骨架） | 目录结构参考（未采纳 Tailwind，改用纯 CSS 保证离线可用） |
| `实训2照片/任务1-1.png` | Dify「糖尿病专家」提示词基线 |
| `实训2照片/任务2-2.png` | 视觉风格参考 |

---

## 八、v2.1 修复清单

本版本针对代码评审提出的问题做了系统性修复，全部带回归测试。

### 正确性

| 问题 | 修复 | 回归测试 |
|------|------|----------|
| 打卡统计在 GMT+8 凌晨 00:00–08:00 漏计当天打卡（写入用本地日期键、读取用 UTC） | 统一为**本地日期键**：新增 `store.dateKey()`，与 `ui.toDateKey()` 同口径；`analyzeCheckin()` 增加 `anchorDate` 参数 | `时区一致性` 4 项（含反证用例） |
| 测试框架 `test()` 未 `await`，异步断言失败仍显示 ✅（形同虚设） | 断言框架改为串行 `await`，并输出异步用例计数 | `断言框架已 await` 自检用例 |
| `formatNumber(1234.5678)` 输出 `"1,234.5,678"` | 只对整数部分加千分位 | E2E 页面渲染 |
| 家族史判定 `/有\|是\|yes\|true\|1/` 把「没有」判为有 | 改为 `AFFIRMATIVE` 白名单 + `isAffirmative()` | `家族史语义` 3 项 |
| 完成率分子不设限，多余打卡可算出 >100% | 分子分母同窗口裁剪 + `clamp01()` | `完成率被裁剪在 0~100` |
| 「记住我」取消后仍持久化（两个 storage 都写） | 按 `persist` 写入**单一** storage，`current()` 优先 sessionStorage | `会话 · 记住我` 4 项 |
| 改名后方案/打卡/收藏「集体消失」（数据键未迁移） | 新增 `users.rename()` + `migrateUserKeys()` | `用户改名 · 数据键迁移` 3 项 |
| 管理助手删除文章不可撤销 | 改为返回 `action:'delete_articles'` + `ids`，由 UI 二次确认 | E2E 主链路 |

### 安全性

| 问题 | 修复 | 回归测试 |
|------|------|----------|
| localStorage 明文存口令 | 新增 `js/crypto.js`（纯 JS SHA-256 + 加盐 + 1000 轮迭代），历史明文自动升级 | `口令哈希` 7 项（NIST 向量 + Node crypto 交叉校验） |
| 开放重定向：`?redirect=` 未校验 | `ui.safeRedirect()` + 页面白名单，阻断协议/协议相对/反斜杠/目录穿越 | `跳转白名单` 3 项 + E2E 3 项 |
| `users.update()` 可越权改写 `role` | `UPDATABLE_FIELDS` 白名单 | `拒绝越权改写 role` |
| Nginx `add_header` 继承陷阱导致安全头在静态资源/HTML 响应上丢失 | 抽出 `snippets/security-headers.conf`，每个 `location` 显式 `include`，并加 `always` | E2E 安全响应头用例 |
| 无 CSP / 无 TLS | 新增 CSP（`script-src 'self'`）、HSTS、443 站点与 HTTP→HTTPS 跳转 | `snippets/security-headers.conf` |
| 服务端错误响应体回显到界面 | 仅写入控制台 | — |

### 性能

| 问题 | 修复 |
|------|------|
| 每次数据访问都 `JSON.parse` 全量数据 | `store` 增加内存缓存 + `storage` 事件失效 |
| 每次浏览文章都重写整张文章表 | 阅读量改为独立计数表 `dpa:article_views` |
| 列表渲染中逐条 `collections.has()` 造成 O(n·m) | `collections.idSet()` 一次取出集合，降为 O(1) 查表 |
| 13 个页面共 107 个 `<script>` 阻塞解析 | 全部加 `defer` |
| Dify 挂起导致输入框永久禁用 | 流式请求增加**空闲超时** |

### 可维护性

| 问题 | 修复 |
|------|------|
| 版本号三处不一致（1.0.0 / 2.0.0） | 统一为 `2.1.0`（`package.json` / `config.js` / `README`） |
| `npm test` 未接线（`echo "Error: no test specified"`） | 接入真实测试；`jsdom` 从 dependencies 移到 devDependencies |
| 缺少工程配置 | 新增 `.gitignore`、`eslint.config.js`、`.github/workflows/ci.yml` |
| Dify 输出契约靠代码推断，未联调验证 | 新增契约桩服务 + 24 项真实 HTTP/SSE 联调测试 |

---

## 九、免责声明

本系统提供的所有健康建议、风险预测结果与生活方案均基于公开医学指南与人工智能生成，**仅供健康科普与自我管理参考，不构成医疗诊断或治疗建议**。任何健康问题请咨询专业医师，紧急情况请立即就医。

---

## 知识库素材整合（项目素材 → 产品）

课程提供的 **项目素材/知识库/** 含 6 份糖尿病专业文档（约 2.3 万字），本项目把素材完整落到了三个位置：

| 落点 | 内容 | 位置 |
|------|------|------|
| Dify 知识库（RAG 数据源） | 6 份文档抽取为 Markdown，可整包上传到 Dify 知识库供应用检索 | `knowledge-base/*.md` |
| 前端内容（糖尿病类型） | 四类糖尿病的「生活注意事项」由素材原文提炼，每类 12–18 条要点 | `js/seed.js` → `DIABETES_TYPES[].life_notes` |
| 前端内容（健康资讯/科普） | 6 篇科普文章以素材为事实来源撰写 | `js/seed.js` → `ARTICLES` |

知识库文件清单（`knowledge-base/`）：

```
1型糖尿病生活注意事项全攻略.md          约 1700 字
2型糖尿病生活注意事项全攻略.md          约 3400 字
妊娠型糖尿病生活注意事项全攻略.md        约 3700 字
特殊型糖尿病生活注意事项全攻略.md        约 5100 字
糖尿病患者全攻略：打造专属健康生活.md     约 5600 字
糖尿病生活习惯全方位参考指南.md          约 2000 字
README.md / index.json                  知识库说明与索引
```

> 内容边界：知识库为健康科普与生活方式管理建议，不含具体用药剂量；
> 所有展示页面均带医疗免责声明。

---

## 一键校验

```bash
# 代码侧：单元 + 冒烟 + 契约 + 传输 + 联调 + 端到端（共 270 条）
npm run verify
```

交付侧（文档清洁度、页眉、内嵌图片、源代码包完整性、任务对照表）：

```bash
cd "C:\Users\mazit\Desktop\2026秋\实训2\项目2评审"
python 交付自检.py
```

> 交付自检脚本会检查 18 项必需交付物是否齐全、15 份文档结构是否有效、
> 正文/表格/页眉页脚是否残留模板占位符、内嵌图片数量是否与预期一致、
> 源代码包是否完整（13 页面 / 8 DSL / 9 测试 / 8 知识库 / 8 工作流图）、
> 以及任务对照表条目数。

---

## 测试分层说明

| 层次 | 命令 | 是否依赖真实 Dify |
|------|------|------------------|
| 单元 / 冒烟 / 契约 / 传输 | `npm test` | 否 |
| 端到端（Playwright） | `npx playwright test` | **否**（用例内强制离线引擎，避免断言绑定大模型措辞） |
| 真实联调 | `npm run test:real` | **是**（需可用 Dify 实例） |

> 真实联调请先设置超时：`set DIFY_TIMEOUT=60000`。
> 实测部分工作流（如打卡分析）需 40 秒以上，超时设过短会被误判为 Dify 故障。

---

## 配置自己的 Dify（可选）

仓库里**不包含任何 Dify 地址与 API Key**。不配置时应用自动运行在**离线演示模式**
（本地规则引擎），13 个页面与全部功能都可用，只是回答由本地引擎生成。

要接自己的 Dify，只需在本地新建一个**不入库**的文件：

```bash
cd ai
cat > js/config.local.js <<'EOF'
(function (global) {
  'use strict';
  global.DPA_CONFIG_LOCAL = {
    DIFY: {
      baseUrl: 'http://<你的Dify地址>/v1',
      proxyMode: false,
      timeout: 60000,
      apps: {
        homeData:        { apiKey: 'app-xxxxxxxx' },
        doctorChat:      { apiKey: 'app-xxxxxxxx' },
        riskPrediction:  { apiKey: 'app-xxxxxxxx' },
        lifePlan:        { apiKey: 'app-xxxxxxxx' },
        healthNews:      { apiKey: 'app-xxxxxxxx' },
        checkinAnalysis: { apiKey: 'app-xxxxxxxx' },
        aiAssistant:     { apiKey: 'app-xxxxxxxx' },
        adminAgent:      { apiKey: 'app-xxxxxxxx' }
      }
    }
  };
})(window);
EOF
```

`js/config.local.js` 已在 `.gitignore` 中，不会被提交。
页面里已按「`config.local.js` → `config.js`」顺序引入，文件不存在时浏览器只报一个
404，功能照常（自动降级）。

### 8 个应用怎么建

`dify-apps/` 下是本项目 8 个应用的 DSL 文件，可直接导入 Dify：

```bash
# 方式一：在 Dify 界面「导入 DSL 文件」逐个导入
# 方式二：用内置的控制台自动化工具批量导入并生成 Key
set DIFY_BASE_URL=http://<你的Dify地址>
set DIFY_CONSOLE_EMAIL=<登录邮箱>
set DIFY_CONSOLE_PASSWORD=<登录密码>
node tools/dify-console.js import dify-apps
node tools/dify-console.js keys --create
node tools/dify-console.js write-config     # 自动生成 js/config.local.js
```

### 超时设置提醒

`timeout` 建议不低于 **60000**（60 秒）。实测部分工作流（打卡分析）在课程云沙箱上
需要 40 秒以上，超时设得过短会让正常请求被误判为失败并降级 —— 页面上表现为
「当前离线演示模式」，但根因是客户端等得不够，不是 Dify 的问题。

---

## PC / 移动端适配

同一套代码在三种屏幕下呈现**明确不同的布局**，断点定义在 `css/common.css` 的「23. 响应式」段。

| 断点 | 导航 | 容器宽度 | 列表布局 | 表单 |
|------|------|---------|---------|------|
| **PC** ≥1024px | 顶部导航（**无底栏**） | 1200px | 文章 / 资讯 / 医师列表 **双列网格** | 双列 |
| **平板** 769–1023px | 顶部导航（无底栏） | 960px | 双列网格 | 双列 |
| **手机** ≤768px | 顶部精简 + **底部标签栏** | 100% | 单列 | 单列 |
| **小屏** ≤480px | 底部标签栏 | 100% | 单列 | 单列 |

### 主要差异点

**导航**
- PC 只保留顶部导航（品牌 + 菜单 + 用户），底部标签栏 `display: none`
- 手机隐藏顶部菜单，启用底部标签栏（首页 / 资讯 / 助手 / 我的），并为它预留 76px 底部留白

**内容布局**
- PC 宽屏下文章、资讯、医师列表切为**双列网格**，卡片带圆角与悬浮反馈，充分利用横向空间
- 手机端全部单列，`entry-grid` 快捷入口保持四宫格
- 后台数据总览：PC 三列 → 手机两列（避免数字被挤压）

**触控与可读性（仅手机生效）**
- 表单控件最小高度 44px、主按钮 46px、菜单项 56px，符合移动端触控目标建议
- 轮播指示点扩大到 24×24 的点击区（视觉仍是小圆点，用伪元素绘制）
- 字号基准从 16px 降到 13px，正文与间距同步收紧

### 回归保护

`tests/e2e.spec.js` 里有 3 条专门验证适配差异的用例：

```bash
npx playwright test -g "响应式"
```

- **18** PC 端隐藏底部导航，只保留顶部导航
- **19** 移动端显示底部导航，顶栏菜单收起
- **20** PC 端文章列表为双列，移动端为单列

这样以后改样式若破坏了 PC / 移动端区分，测试会直接失败。
