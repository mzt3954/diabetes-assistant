# 前端重设计方案 · 糖尿病预治智能助手（DeepSeek + Dify）

> 产出方式：TRAE SOLO CN → Design 模式，基于本项目**现有代码结构**重新设计整套前端。
> 生成时间：2026-09-16　|　目录：`design-solo/`　|　总体积：约 172 KB（13 页面 + 3 个样式文件）
>
> **本目录不改动、不依赖替换任何原有文件**：原 13 个页面、`css/`、`js/`、`tests/` 保持原样。
> 这是一份"设计稿 + 可运行原型"，落地方式见文末《接回主站》。

---

## 一、文件清单

| 文件 | 大小 | 说明 |
|---|---|---|
| `css/tokens.css` | 12.1 KB | 设计令牌层：346 个 CSS 变量，含明亮/深色双主题 |
| `css/common.css` | 36.0 KB | 通用组件层：导航、底部标签栏、卡片、按钮、表单、Toast、Modal、骨架屏、空态 |
| `css/pages.css` | 30.2 KB | 页面级样式 + 四档响应式断点 |
| `index.html` | 8.8 KB | 登录 / 注册 |
| `home.html` | 8.1 KB | 首页（横幅轮播 + 4 入口 + 健康科普 + 糖尿病类型） |
| `article.html` | 3.8 KB | 科普文章详情 |
| `diabetes.html` | 3.1 KB | 糖尿病分型知识 |
| `doctor.html` | 5.9 KB | 医师咨询（列表视图 + 会话视图） |
| `risk-prediction.html` | 9.6 KB | 风险预测（表单 + 结果 + 历史评估） |
| `life-plan.html` | 9.0 KB | 生活方案（方案列表 + 定制弹窗 + 统计） |
| `checkin.html` | 6.8 KB | 打卡记录与分析（近 7 日 + 智能分析 + 明细） |
| `health-news.html` | 5.7 KB | 健康资讯（标签筛选 + 列表） |
| `assistant.html` | 8.1 KB | AI 智能助手（引导页 + 对话页） |
| `personal.html` | 8.8 KB | 个人中心（资料 + 统计 + 服务入口 + 管理入口） |
| `admin.html` | 7.9 KB | AI 智能管理（数据总览 + 管理助手 + 数据表） |
| `help.html` | 7.8 KB | 帮助中心（使用指南 + FAQ + 系统信息） |

---

## 二、设计系统

### 2.1 色彩

基础色板为 5 套完整色阶（50→950），语义层再做映射，避免页面直接写死色值。

| 语义令牌 | 明亮取值 | 深色取值 | 用途 |
|---|---|---|---|
| `--primary` | `blue-600` #2563EB | `blue-500` | 主色：主按钮、链接、选中态 |
| `--primary-light` / `--primary-soft` | `blue-100` / `blue-50` | `blue-900` / `blue-950` | 主色浅底、标签底 |
| `--secondary` | `green-500` #10B981 | `green-500` | 辅助色：健康/达标 |
| `--accent` | `amber-500` #F59E0B | `amber-500` | 强调：提醒、待办 |
| `--success` / `--warning` / `--error` / `--info` | `green-500` / `amber-500` / `rose-500` / `sky-500` | 各自 400/500 档 | 功能语义色 |
| `--purple` / `--teal` | `violet-500` / `teal-500` | `violet-400` / `teal-400` | AI 助手与图表的区分色 |
| `--risk-low` / `--risk-mid` / `--risk-high` | 绿 / 琥珀 / 玫瑰 | 400 档 | 医疗风险分级（风险预测、打卡解读专用） |
| `--chart-track` | `slate-200` | `slate-800` | 图表轨道底 |
| `--agent-color` | `violet-600` | `violet-400` | AI 生成内容的标识色 |

### 2.2 表面与文字

| 令牌 | 用途 |
|---|---|
| `--bg-page` / `--bg-card` / `--bg-elevated` | 页面底（slate-50 / slate-950）、卡片、浮层 |
| `--bg-hover` / `--bg-active` | 交互态底色 |
| `--bg-overlay` | 弹窗遮罩（明亮 45% / 深色 70%） |
| `--text-primary` / `--text-secondary` / `--text-muted` | 三级文字层级 |
| `--border-color` / `--border-light` / `--border-strong` / `--focus-ring` | 边框与键盘焦点环 |

### 2.3 排版

- 字体栈：`-apple-system / Segoe UI / PingFang SC / Microsoft YaHei / Noto Sans SC`（中文优先渲染）
- 字号阶梯：12 / 13 / 14 / 15 / 16 / 17 / 18 / 19 / 20 / 22 / 24 / 28 / 32
- 行高：`tight 1.25` / `snug 1.4` / **`normal 1.6`（正文默认）** / `relaxed 1.75` —— 满足中文长文可读性
- 字重：400 / 500 / 600 / 700
- 等宽：`--font-mono`（用于展示请求 ID、版本号等技术信息）

### 2.4 间距 / 圆角 / 阴影 / 层级 / 动效

| 类别 | 取值 |
|---|---|
| 间距刻度 | 4 · 6 · 8 · 10 · 12 · 14 · 15 · 16 · 18 · 20 · 22 · 24 · 28 · 32 · 40 · 48 |
| 旧命名兼容 | `--spacing-xs/sm/md/lg/xl` |
| 圆角 | 6 / 10 / 14 / 18 / 24 / 全圆角 |
| 阴影 | 5 级 `xs→xl`，双层柔和阴影（低对比、偏医疗洁净感，不用重投影） |
| 层级 | dropdown 1000 → sticky 1020 → fixed 1030 → overlay 1040 → modal 1050 → toast 1060 |
| 动效 | 150 / 250 / 350 ms；`ease-out`、`ease-in-out`、`ease-spring` 三条曲线；已适配 `prefers-reduced-motion` |

### 2.5 响应式断点

| 断点 | 容器 | 导航 | 布局 |
|---|---|---|---|
| ≥1024px（PC） | `max-width: 1200px` | 顶部导航栏，**无底部标签栏** | 文章/医师/资讯**双列网格**；入口与类型 4 列；表单双列 |
| 769–1023px（平板） | `max-width: 960px` | 顶部导航栏 | 同上双列，类型 2 列 |
| ≤768px（手机） | `100%` | 顶部精简头 + **底部标签栏**（`.bottom-nav`，4 项：首页/资讯/助手/我的） | 单列；表单单列；`page` 预留 76px 底部安全区；根字号 13px |
| ≤480px（小屏） | `100%` | 同上 | 进一步压缩间距与字号 |

---

## 三、页面与现有代码的映射

**关键结论：13 个新页面 100% 保留了原页面的全部元素 `id`，并额外增加了状态类节点。** 因此新页面可直接复用现有 `js/pages/*.js` 控制器，无需改动业务逻辑。

| 新页面 | 对应原页面 | 保留 id 数 | 新增 id | 主要区块 |
|---|---|---|---|---|
| `index.html` | `index.html` | 17 → 20 | `dpaThemeToggle`、`tab-login`、`tab-register` | 登录 / 注册双 Tab |
| `home.html` | `home.html` | 6 → 9 | `dpaNavbar`、`dpaBottomNav`、`bannerSlides`/`bannerDots` | 横幅轮播、4 入口、健康科普、糖尿病类型 |
| `article.html` | `article.html` | 9 → 11 | `dpaNavbar`、`dpaBottomNav` | 文章正文、元信息、收藏、相关推荐 |
| `diabetes.html` | `diabetes.html` | 7 → 8 | `dpaNavbar`、`dpaBottomNav` | 分型 Hero、摘要、内容、分型切换 |
| `doctor.html` | `doctor.html` | 14 → 16 | `dpaNavbar`、`dpaBottomNav` | 医师列表 ↔ 会话视图双态切换 |
| `risk-prediction.html` | `risk-prediction.html` | 25 → 29 | `riskSkeleton`、`historySection`、`offlineBadge` | 基本信息、健康指标、结果区、历史评估 |
| `life-plan.html` | `life-plan.html` | 20 → 28 | `planSkeleton`、`emptyArea`、`customizeModal`、`planStats` | 方案列表、定制弹窗、统计卡 |
| `checkin.html` | `checkin.html` | 7 → 12 | `analysisSkeleton`、`detailSkeleton`、`weekGrid` | 近 7 日打卡、智能分析、打卡明细 |
| `health-news.html` | `health-news.html` | 6 → 9 | `newsSkeleton`、`newsTags`、`offlineBadge` | 资讯标签筛选、列表 |
| `assistant.html` | `assistant.html` | 11 → 13 | `introView`/`chatView`、`offlineBadge` | 引导页 ↔ 对话页 |
| `personal.html` | `personal.html` | 13 → 14 | `adminSection`、`statCheckin`/`statCollect`/`statPlan` | 资料、统计、我的服务、管理入口、更多 |
| `admin.html` | `admin.html` | 10 → 14 | `statsSkeleton`、`tableSkeleton`、`tableTabs` | 数据总览、AI 管理助手、数据表 |
| `help.html` | `help.html` | 5 → 7 | `faqSkeleton`、`modeText`/`versionText` | 使用指南、FAQ、系统信息 |

三处统一外壳（13 页全含）：`#dpaNavbar`（顶部导航）、`#dpaBottomNav`（移动端底部标签栏）、`#dpaThemeToggle`（主题切换）。

---

## 四、状态覆盖

需求里要求的"骨架屏 / 空态 / 错误 / 无权限 / 离线降级 / 流式输出"在原型中都有对应节点：

| 状态 | 落点 |
|---|---|
| 加载骨架屏 | `riskSkeleton`、`planSkeleton`、`analysisSkeleton`、`detailSkeleton`、`newsSkeleton`、`statsSkeleton`、`tableSkeleton`、`faqSkeleton` |
| 空态 | `emptyArea`（生活方案）、各列表 `*-list` 空态样式 |
| 表单校验错误 | `ageError`、`heightError`、`weightError`、`sexError`、`waistlineError`、`systolicPressureError`、`loginUsernameError`… 全部 `role="alert"` |
| Dify 离线降级 | `offlineBadge`（风险预测、生活方案、资讯、助手、管理、打卡） |
| 危险操作确认 | 管理后台的数据表操作区 |
| 主题 | 跟随系统 `prefers-color-scheme` + 手动 `data-theme` 覆盖 |

---

## 五、预览方法

**方式一（推荐，零依赖）**：直接双击 `design-solo/index.html`。

> 原型挂载的是项目现有的 `../js/*`（`config` / `store` / `api` / `mock-engine` / `ui` / `auth` + `pages/*`），带登录守卫。请使用演示账号：
> - 普通用户：`user` / `user123`
> - 管理员：`admin` / `admin123`

**方式二**：把本目录同步到任意静态服务器根目录下的 `design-solo/`，访问 `/design-solo/index.html`
（注意：本地 `http://localhost:8080` 当前指向的是部署副本
`D:\AI\ChatGPT\CodeX\shixun2_build\deploy\html`，需先把本目录拷进去才会出现）。

---

## 六、接回主站（落地步骤）

原型与主站页面同名同结构，因此有三种落地强度，按需选择：

1. **并存对比**：保留 `design-solo/` 不动，主站加一个入口链接指向它。零风险。
2. **逐页替换**：把 `design-solo/<name>.html` 复制到项目根目录覆盖同名文件；
   `design-solo/css/*.css` 复制到 `css/` 下改名为 `tokens.css`/`common.css`/`pages.css`，
   并把页面里的 `css/xxx.css` 与 `../js/xxx.js` 同步为根目录相对路径。
   因为元素 id 完全一致，`js/pages/*.js` 无需修改。
3. **整站切换**：替换全部 13 页 + 3 个样式文件后，跑一遍项目原有测试套件
   （`tests/` 下 5 套：smoke / logic / dsl / transport / integration）确认无回归。

---

## 七、验证记录

独立验证环境：Playwright + Chromium，先以 `user/user123` 登录，再逐页检查
PC（1440×900）与移动（390×844，`isMobile` + `hasTouch`）：

| 检查项 | 结果 |
|---|---|
| 控制台错误 / 页面异常 | **13 页 × 2 视口 = 0 错误** |
| 横向溢出 | **全部 0px** |
| PC 容器宽度 | 1200px，底部标签栏显示状态为隐藏 |
| 移动端容器宽度 | 390px（满宽），底部标签栏显示 |
| 底部标签栏覆盖 | 13 页中 12 页显示；`admin.html`（管理后台）不显示，符合桌面形态 |
| 深色模式 | 正常，`--bg-page` 解析为 `rgb(2,6,23)` |
| 元素 id 兼容性 | 原页面 id **0 缺失** |
| 对原项目的改动 | `git status` 仅 `?? design-solo/`，原有文件零改动 |

---

## 八、已知缺口与后续

1. **Trae 侧收尾未完成**：任务在"设计系统 CSS""13 页 HTML"两步完成后，因账号额度耗尽（错误码 4008）中断，
   因此本 README 与上面的映射表由本地重新整理补齐；Trae 自身的视觉校验报告未产出。
2. **图片仍为占位**：列表卡片的封面位目前是骨架占位块，未接入真实图片素材。
3. **可继续迭代的方向**：真实图片/插画、微交互动效、图表可视化（风险仪表盘、血糖趋势折线、BMI 环形）、
   打印样式、更多极致无障碍细节（读屏标签、跳转链接）。
