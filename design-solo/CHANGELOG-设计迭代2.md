# CHANGELOG — 设计迭代 2

> 迭代目标：在 `design-solo/` 现有原型基础上深化视觉与交互，完成数据可视化、微交互动效、医疗主题 SVG 占位、列表三态与响应式校验。
> 约束：零外部依赖；不修改 `design-solo/` 之外文件；保留原页面元素 id 与 class 契约。

---

## 一、新增文件

### `design-solo/js/charts.js`
- **原因**：项目为零依赖静态站，禁止引入 ECharts / D3 / CDN，因此封装纯内联 SVG + CSS 的可复用图表辅助。
- **内容**：
  - `DPA.charts.trendLine(selector, data, opts)`：近 7 日打卡趋势折线，含网格、渐变面积、描边动画。
  - `DPA.charts.progressRing(selector, percent, opts)`：生活方案 / 个人中心完成度环形图，颜色取自 CSS token。
  - `DPA.charts.barChart(selector, data, opts)`：资讯页浏览量横向条形图，支持空态降级。
- **颜色策略**：所有图表颜色通过 `getComputedStyle(document.documentElement)` 读取 `--primary`、`--success`、`--chart-track` 等 token，保证明亮 / 深色主题一致。

---

## 二、CSS 改动

### `design-solo/css/pages.css`

#### 1) 风险预测半环评分仪表盘（`#resultArea` 内由 `pages/risk.js` 渲染）
- **位置**：第 431–476 行 `.risk-gauge` 及其子元素。
- **原因**：需求要求结果区使用半环仪表盘，比纯文本百分比更直观。
- **实现**：
  - 容器 `160×90px` 并 `overflow:hidden`。
  - SVG `150×150` 旋转 180°，只显示上半圆。
  - 进度圆环使用 `stroke-dasharray / stroke-dashoffset` 动画，颜色取自风险 token（`--risk-low/mid/high`）。
  - 文字绝对定位在底部，显示百分比与“风险概率”。

#### 2) 打卡页近 7 日趋势折线
- **位置**：第 1458–1519 行 `.trend-chart`、`.trend-line`、`.trend-area`、`.trend-dot`、`.trend-axis`。
- **原因**：用可视化折线展示打卡完成趋势，替代纯数字。
- **实现**：
  - SVG 使用 `viewBox` 与 `preserveAspectRatio="none"`，宽度 `100%` 自适应。
  - 折线描边动画通过 `stroke-dasharray:500` + `drawLine` keyframes 实现。
  - 面积使用 SVG 线性渐变，透明度 0.18。
  - 缓动与时长使用 `--ease-out` / `--duration-slow`。

#### 3) 生活方案 / 个人中心进度环形图
- **位置**：第 1521–1589 行 `.ring-chart`、`.ring-track`、`.ring-fill`、`.ring-text`、`.ring-card`；第 1575 行新增 `.ring-row`。
- **原因**：用环形进度图展示今日 / 本周 / 累计完成度。
- **实现**：
  - SVG 圆环旋转 `-90deg`，通过 `stroke-dashoffset` 表示进度。
  - 提供 `.ring-fill.success/.warning/.error` 扩展类，颜色取自状态 token。
  - `.ring-row` 使用 `grid-template-columns: repeat(2, 1fr)`，移动端（≤480px）降级为单列，避免横向溢出。

#### 4) 资讯页浏览量条形图
- **位置**：第 1591–1651 行 `.bar-chart`、`.bar-chart-row`、`.bar-chart-label`、`.bar-chart-track`、`.bar-chart-fill`、`.bar-chart-value`。
- **原因**：展示热门资讯阅读量对比。
- **实现**：纯 div 条形，宽度通过内联 style 百分比驱动，过渡动画使用 `--duration-slow`。

#### 5) 响应式兜底
- **位置**：第 1456–1457 行（小屏断点）。
- **改动**：补充 `.ring-row { grid-template-columns: 1fr; }`，确保 390px 宽度下环形图不挤压溢出。

### `design-solo/css/common.css`

#### 6) 医疗健康主题 SVG 占位插画
- **位置**：第 1682–1699 行 `.skeleton-block` 背景图覆盖。
- **原因**：需求要求将列表卡片的灰色占位块替换为医疗主题插画，且不外链网络图片。
- **实现**：
  - 通用卡片：蓝绿色医疗笑脸/时钟图标。
  - 医生 / 列表项：听诊器图标（绿色描边）。
  - 类型卡片：医疗十字图标（蓝色描边）。
  - 全部使用 `data:image/svg+xml` 内联，颜色与 `--primary`（蓝）、`--secondary`（绿）一致。

#### 7) 微交互动效
- **位置**：第 1702–1776 行。
- **原因**：提升页面质感，但需使用 token 并保留无障碍降级。
- **实现**：
  - 页面进入：`.page` 使用 `pageIn` 动画（淡入 + 上移 8px）。
  - 卡片 hover / 按下：`.article-card`、`.news-card`、`.doctor-card`、`.type-card`、`.plan-item`、`.menu-item`、`.entry-item`、`.risk-history-item` 统一添加过渡与 `:active scale(0.985)` 反馈。
  - 底部标签栏切换：`.bottom-nav-item::after` 指示条使用 `scale` 弹簧动画；激活项图标上移 2px。
  - Toast 进出：`.toast` 使用 `toastIn` / `toastOut` keyframes。
  - 骨架屏 shimmer：使用 `calc(var(--duration-slow) * 3)` 与 `--ease-in-out`，背景渐变位移动画。

#### 8) 错误态 / 重试按钮
- **位置**：第 1778–1813 行 `.error-state`。
- **原因**：列表页面需补全加载 / 空态 / 错误三态，错误态必须提供重试入口。
- **实现**：默认 `display:none`，配合 `.show` 或移除 `.hidden` 显示；包含图标、标题、描述与 `.btn.btn-primary.btn-sm` 重试按钮。

#### 9) 无障碍降级
- **位置**：第 1663–1680 行、第 1815–1829 行 `@media (prefers-reduced-motion: reduce)`。
- **原因**：满足 `prefers-reduced-motion` 要求。
- **实现**：全局动画时长置为 0.01ms，并单独关闭 spinner、skeleton、chart 动画与过渡。

---

## 三、HTML 改动

### `design-solo/risk-prediction.html`
- **位置**：第 159–178 行 `#historySection` 区域。
- **改动**：为“历史评估”列表补充骨架屏 `#riskSkeleton`（默认隐藏）、空态（默认显示）、错误态 `#historyError` 与重试按钮 `#retryHistory`。
- **原因**：历史评估属于数据列表，需具备三态；错误时提供重试。
- **半环仪表盘**：结果区 `#resultArea` 仍由 `../js/pages/risk.js` 渲染，其 `gauge()` 函数已改为半环 SVG（颜色取自 CSS token）。

### `design-solo/checkin.html`
- **位置**：
  - 第 61–64 行：新增 `#trendChart` 容器，用于渲染近 7 日趋势折线。
  - 第 77–118 行：新增 `#analysisSkeleton` 与 `#detailSkeleton` 骨架屏。
  - 第 128–134 行：新增 `#detailError` 错误态与 `#retryDetail` 重试按钮。
  - 第 153–184 行：内联脚本绑定 `DPA.charts.trendLine`，并监听列表渲染做错误态保护。
- **原因**：需求要求打卡页加趋势折线；打卡明细列表需加载 / 空态 / 错误态。

### `design-solo/life-plan.html`
- **位置**：
  - 第 78–82 行：新增 `.ring-row` 与 `#planRingToday`、`#planRingWeek` 容器。
  - 第 90–106 行：新增 `#planSkeleton` 骨架屏。
  - 第 110–116 行：新增 `#planError` 错误态与 `#retryPlan` 重试按钮。
  - 第 187–233 行：内联脚本调用 `DPA.charts.progressRing` 渲染今日 / 近 7 日完成度。
- **原因**：生活方案页需展示进度环形图；方案列表需三态。

### `design-solo/personal.html`
- **位置**：
  - 第 52–57 行：新增“健康目标”区块与 `#personalRings` 容器。
  - 第 137–160 行：内联脚本调用 `DPA.charts.progressRing` 渲染累计 / 本周完成度。
- **原因**：个人中心需展示进度环形图，直观反馈用户健康目标达成情况。

### `design-solo/health-news.html`
- **位置**：
  - 第 56–57 行：新增 `#newsBarChart` 容器，用于热门资讯浏览量条形图。
  - 第 70–87 行：新增 `#newsSkeleton` 骨架屏（卡片结构复用 `.skeleton-card`）。
  - 第 98–104 行：新增 `#newsError` 错误态与 `#retryNews` 重试按钮。
  - 第 122–157 行：内联脚本绑定 `DPA.charts.barChart`，并做列表错误态保护。
- **原因**：资讯页需展示浏览量条形图；资讯列表需三态。

### `design-solo/doctor.html`
- **位置**：
  - 第 33–57 行：将默认医生列表改为骨架屏（使用 `.skeleton-block` 医疗主题占位）。
  - 第 59–65 行：新增 `#doctorError` 错误态与 `#retryDoctor` 重试按钮。
  - 第 118–157 行：内联脚本实现空态注入与错误态保护。
- **原因**：医师列表需加载 / 空态 / 错误态三态。

### `design-solo/admin.html`
- **位置**：
  - 第 57–64 行：新增 `#statsSkeleton` 骨架屏。
  - 第 110–117 行：新增 `#tableSkeleton` 骨架屏。
  - 第 127–133 行：新增 `#tableError` 错误态与 `#retryTable` 重试按钮。
  - 第 151–171 行：内联脚本实现数据表错误态保护。
- **原因**：管理后台数据表需加载 / 空态 / 错误态三态。

### `design-solo/help.html`
- **位置**：
  - 第 70–75 行：新增 `#faqSkeleton` 骨架屏。
  - 第 85–91 行：新增 `#faqError` 错误态与 `#retryFaq` 重试按钮。
  - 第 122–143 行：内联脚本实现 FAQ 错误态保护。
- **原因**：帮助中心 FAQ 列表需加载 / 空态 / 错误态三态。

---

## 四、响应式校验结果

- **方法**：使用 Playwright + Chromium 在本地启动静态服务器，分别将视口设为 1440×900 与 390×844，检查每个页面是否存在横向滚动（`scrollWidth > clientWidth`）。
- **范围**：`design-solo/` 下全部 13 个页面（index / home / article / diabetes / doctor / risk-prediction / life-plan / checkin / health-news / assistant / personal / admin / help）。
- **结果**：26 次检查全部通过，无横向滚动。

---

## 五、未改动说明

- 未修改 `design-solo/` 之外的任何文件，根目录 13 个 HTML、`css/`、`js/` 保持原样。
- 所有页面仍复用 `../js/*` 业务脚本，id 与 class 契约未破坏。
- 所有新增可视化、插画、动效均不依赖外部 CDN 或 npm 包。
