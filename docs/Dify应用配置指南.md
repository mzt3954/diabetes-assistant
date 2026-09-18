# Dify 应用配置指南

> 本文档说明如何把本项目从「离线演示模式」切换为「在线 AI 模式」。
> 共需在 Dify 中创建 **8 个应用**：5 个工作流 + 2 个对话流 + 1 个 Agent。

---

## 一、前置准备

1. 部署 Dify（本地版 / 沙箱版），确认可访问，例如 `http://localhost/v1`
2. 在 Dify 中创建知识库，上传 `项目素材/知识库/` 下的 6 份 docx：
   - 1型糖尿病生活注意事项全攻略.docx
   - 2型糖尿病生活注意事项全攻略.docx
   - 妊娠型糖尿病生活注意事项全攻略.docx
   - 特殊型糖尿病生活注意事项全攻略.docx
   - 糖尿病患者全攻略：打造专属健康生活.docx
   - 糖尿病生活习惯全方位参考指南.docx
   - 分段建议：**自动分段 + 父子分段**，索引方式「高质量」
3. 配置模型：规划类节点用 `deepseek-v4-pro`，生成类节点用 `deepseek-v4-flash`

---

## 二、应用清单

| 编号 | 应用名 | 类型 | 用途 | 对应课程任务 |
|------|--------|------|------|-------------|
| WF-1 | 首页数据管理 | 工作流 | 返回首页文章与类型数据 | 2-3 |
| CHAT-1 | 医师咨询助手 | 对话流 + 知识库 | 医师在线咨询 | 3-3 |
| WF-2 | 风险预测 | 工作流 | 补全信息 → 判断患病 → 评分 → 归因 → 建议 | 5-2 |
| WF-3 | 生活方案定制 | 工作流 | 生成饮食 + 运动方案 | 6-2 |
| WF-4 | 健康资讯生成 | 工作流 | 生成标签 + 文章 | 7-2 |
| WF-5 | 打卡分析 | 工作流 | 分析近 7 日生活状态 | 8-2 |
| CHAT-2 | AI 智能助手 | 对话流 + 工具调用 | 科普 / 信息管理 / 方案制定 | 9-2 |
| AGENT-1 | AI 管理助手 | Agent + Function Calling | 自然语言管理数据 | 10-2 |

---

## 三、各应用的输入输出契约

> 契约必须与前端 `js/api.js` 一致，否则需同步修改前端。

### WF-1 首页数据管理
- **输入**：`{ category?: string }`
- **输出**：
```json
{
  "articles": [{ "article_id": 1, "title": "...", "category": "...", "author": "...", "publish_time": "2026-01-15", "views": 100, "content": "..." }],
  "diabetesTypes": [{ "type_id": 1, "type_name": "1型糖尿病", "summary": "...", "pathogenesis": "...", "manifestation": "...", "treatment": "...", "life_notes": ["..."] }]
}
```

### WF-2 风险预测
- **输入**：
```json
{ "age": 45, "sex": "男", "height": 172, "weight": 78, "waistline": 92,
  "systolicPressure": 125, "familyHistory": "有", "isPregnancy": "无", "disease": "否" }
```
- **输出**：
```json
{
  "score": 12, "maxScore": 27, "level": "中风险", "probability": 44,
  "bmi": 26.4, "disease": "未患病", "riskType": "2型糖尿病",
  "factors": ["糖尿病家族史", "BMI 偏高"],
  "message": "您存在一定的糖尿病风险……",
  "advice": ["调整饮食结构……", "饭后 1 小时快走 30 分钟……"]
}
```

### WF-3 生活方案定制
- **输入**：`{ userInfo: {...}, lifeState: "久坐、三餐不规律", advice: "希望减重 5 公斤" }`
- **输出**：
```json
{ "plans": [{ "type": "饮食", "order": 1, "time": "07:00", "title": "营养早餐", "content": "..." }],
  "summary": "已为您生成 9 条生活方案……" }
```

### WF-4 健康资讯生成
- **输入**：`{ userInfo: {...}, tag?: "饮食指导" }`
- **输出**：
```json
{ "tags": ["饮食指导","运动指南","生活习惯","糖尿病科普"],
  "tag": "饮食指导",
  "article": { "title": "...", "tags": ["饮食指导"], "author": "AI 健康助手",
               "publish_time": "2026-09-12", "category": "饮食指导", "content": "## ..." } }
```

### WF-5 打卡分析
- **输入**：`{ planList: [...], punchList: [...], days: 7 }`
- **输出**：
```json
{ "rate": 72, "streak": 3, "dietRate": 80, "exerciseRate": 60, "balance": 60,
  "evaluation": "良好",
  "completionStatus": "近 7 天共应完成 63 项，实际完成 45 项，完成率 72%",
  "suggestions": ["……"] }
```

### CHAT-1 医师咨询助手 / CHAT-2 AI 智能助手
- **输入**：`{ query, conversation_id, user }`，`response_mode: streaming`
- **输出**：SSE 事件流，前端解析 `message.answer` 增量与 `message_end.conversation_id`
- **系统提示词基线**（提炼自 `实训2照片/任务1-1.png` 中的「糖尿病专家」）：
```
你是一位专业的糖尿病防治医师。回答须遵循以下原则：
1. 专业严谨：所有建议基于最新临床指南（医学营养治疗 MNT、运动疗法循证依据）
2. 循证优先：优先推荐有 RCT 研究支持的干预措施
3. 个体化导向：主动询问患者基本信息（年龄、分型、并发症、生活方式等）
4. 风险提示：对胰岛素使用、低血糖处理等关键环节必须明确提示
5. 人文关怀：使用通俗易懂语言，避免医学术语堆砌，关注患者心理状态
6. 安全边界：不给出具体用药剂量，涉及诊疗决策时建议线下就诊
```

### AGENT-1 AI 管理助手
- **工具（Function Calling）**：`get_stats`、`list_users`、`list_articles`、`add_article`、`delete_article`
- **输出**：`{ reply: "文本回答" }`

---

## 四、前端配置

编辑 `js/config.js`。有两种模式，**推荐生产用反代模式**：

### 模式 A：直连模式（教学 / 内网单机演示）

```js
DIFY: {
  baseUrl: 'http://localhost/v1',   // 改成你的 Dify 地址
  proxyMode: false,                 // ← 直连：需要下面填 Key
  timeout: 30000,
  retry: 1,
  apps: {
    homeData:        { apiKey: 'app-xxxxxxxx' },   // ← 填入各应用的 API Key
    doctorChat:      { apiKey: 'app-xxxxxxxx' },
    riskPrediction:  { apiKey: 'app-xxxxxxxx' },
    lifePlan:        { apiKey: 'app-xxxxxxxx' },
    healthNews:      { apiKey: 'app-xxxxxxxx' },
    checkinAnalysis: { apiKey: 'app-xxxxxxxx' },
    aiAssistant:     { apiKey: 'app-xxxxxxxx' },
    adminAgent:      { apiKey: 'app-xxxxxxxx' }
  }
}
```

> **只需配置其中一个**，对应功能即切换为在线模式，其余功能仍走本地引擎——可逐个灰度接入。
>
> ⚠️ 直连模式下 Key 会随前端资源分发，任何访客都能在源码或 Network 面板中读到。**仅用于教学/内网演示。**

在 Dify 应用页「访问 API」处获取 API Key（形如 `app-` 开头）。

### 模式 B：反向代理模式（生产推荐）

```js
DIFY: {
  baseUrl: '/v1',      // 同源相对路径，指向 Nginx 的 /v1/ 段
  proxyMode: true,     // ← 开启后 isDifyReady() 只看 baseUrl，前端不持有任何 Key
  timeout: 30000,
  retry: 1,
  apps: { /* apiKey 全部留空 */ }
}
```

密钥写在 Nginx 里（见 `nginx.conf` 的 `location /v1/` 段）：

```nginx
proxy_set_header Authorization "Bearer app-你的密钥";
```

这样**前端源码与 Network 面板中都不会出现任何密钥**。

### 模式 C：本地契约桩（无 Dify、无 Key 也能联调）

```bash
node tests/mock-dify-server.js --port 8080 --serve .
```

启动后会打印 8 个应用的 Key 对照表（如 `riskPrediction → app-wf-risk-key`），
把它们填进模式 A 的 `apps.*.apiKey` 即可在浏览器里跑通完整在线链路，
用于验证前端改动、演示在线效果，或排查真实 Dify 的对接问题。

---

## 五、跨域（CORS）配置

若 Dify 与前端不同源，需在 Dify 的 `.env` 中配置：

```env
CONSOLE_CORS_ALLOW_ORIGINS=*
WEB_API_CORS_ALLOW_ORIGINS=*
```

或通过 Nginx 反向代理（推荐，见 `docs/部署说明.md`）。

---

## 六、安全建议（生产环境必读）

前端明文存放 API Key **仅适用于教学/内网环境**。生产部署请：

1. 用 Nginx 反向代理 `/v1/*` 到 Dify，在代理层注入 `Authorization` 头
2. 前端 `config.js` 中不填任何 Key，设置 `proxyMode: true` 仅保留 `baseUrl: '/v1'`
3. 开启 Dify 的访问频率限制与用户隔离
4. 启用 `snippets/security-headers.conf`（CSP / nosniff / frame-ancestors 等）
5. 全站 HTTPS + HSTS（见 `nginx.conf` 的 443 段）

> **Nginx 陷阱提醒**：`add_header` 不是"子级覆盖父级、其余继承"的语义。
> 只要某个 `location` 内出现了**任意一条** `add_header`，父级的 `add_header`
> 就全部不再继承。本项目把安全头抽到 `snippets/security-headers.conf`，
> 并在**每个** `location` 里 `include`，避免安全头在静态资源/HTML 响应上静默丢失。

示例 Nginx 片段：
```nginx
location /v1/ {
    proxy_pass http://127.0.0.1:8080/v1/;
    proxy_http_version 1.1;
    proxy_set_header Authorization "Bearer app-你的密钥";
    proxy_set_header Connection "";   # SSE 必需：清掉 hop-by-hop 头
    proxy_buffering off;              # SSE 流式必需
    proxy_cache off;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
}
```

---

## 七、验证

配置完成后：

1. 打开 `help.html`，底部「运行模式」应显示 **在线模式（已接入 Dify）**
2. 进入「风险预测」填表提交，浏览器 Network 面板应出现 `POST /v1/workflows/run`
3. 进入「AI 智能助手」发送消息，Network 面板应出现 `POST /v1/chat-messages` 且返回 `text/event-stream`

若显示「离线演示模式」，检查：
- 直连模式：`apiKey` 是否以 `app-` 开头；反代模式：`proxyMode` 是否为 `true`
- `baseUrl` 是否可达（浏览器直接访问 `{baseUrl}/parameters` 测试）
- 是否被 CORS 拦截（看控制台报错）

### 用联调测试自动验证（不需要真实 Dify）

```bash
npm run test:integration
```

该测试会拉起契约桩服务，覆盖 8 个应用的请求/响应/归一化全链路，
以及 401 不重试、5xx 重试、契约不匹配降级、SSE 中断与空闲超时等边界。

---

## 知识库绑定（RAG）

8 个应用里除 `AGENT-1`（数据管理智能体，场景不需要）之外的 7 个都包含一个
**知识库检索（knowledge-retrieval）** 节点，用于检索 `knowledge-base/` 下的 6 份糖尿病专业文档。

### 为什么这样设计

- 健康类回答必须锚定事实，不能靠模型自由发挥；
- 知识库检索节点把「事实来源」和「语言组织」拆开：检索负责给事实，大模型只负责表达；
- 检索结果通过提示词变量 `{{#<app>_kb.result#}}` 注入，提示词中已写明
  「以下内容来自糖尿病专业文档知识库，请以此为准，不要编造」。

### 配置步骤

1. 进入 Dify → **知识库 → 创建知识库**，名称建议「糖尿病专业知识库」；
2. 上传 `knowledge-base/` 下的 6 个 Markdown 文件（或对应的 .docx 原文）；
3. 分段设置：分段标识符按 Markdown 标题（`##`），最大分段长度 500 tokens，重叠 50；
4. 索引方式选「高质量」；
5. 知识库创建完成后复制其 **Dataset ID**；
6. 回到每个应用，打开工作流画布，选中「知识库检索」节点，
   在 **数据集（Dataset）** 里勾选刚创建的知识库；
7. 若希望把 ID 固化进 DSL，可在 `dify-apps/*.yml` 中把对应节点的
   `dataset_ids: []` 填成 `["<你的Dataset ID>"]` 后再导入。

> 也可以导入 DSL 之后再在界面上逐个绑定，效果相同。

## 代码节点（确定性计算）

`WF-2 个人信息与风险预测` 与 `WF-5 打卡分析` 各含一个 **代码节点（code, python3）**：

| 应用 | 代码节点 | 输出 |
|------|---------|------|
| WF-2 | CDRS 风险计算 | score / maxScore / level / probability / bmi / breakdown |
| WF-5 | 打卡三维指标计算 | completionRate / streak / dietRate / exerciseRate / balance / rating |

**设计意图**：像风险分值、完成率、连续性这类**确定性计算**，交给代码节点比交给大模型更可靠——
同一份输入必须算出同一个结果。代码节点的权重与 `js/mock-engine.js` 中的本地引擎**完全一致**
（年龄 0/2/4/6、BMI 0/3/5、腰围 3、家族史 5、收缩压 3、性别 1、妊娠 4，合计 0–27 分），
因此「真实 Dify 模式」与「离线降级模式」得到的分档与概率是一样的。

大模型节点只负责：归因说明、个性化建议、方案生成、分析文案。
提示词中已用 `{{#risk_calc.score#}}` 之类的变量把代码节点结果传进去，
并明确写了「必须原样采用，不得自行改动」。

## 工作流设计图

`docs/workflow-diagrams/` 下有 8 张 PNG，由 `dify-apps/*.yml` 的真实图结构（节点类型、
连边关系、模型名、top_k 等）直接渲染生成，可在答辩与文档中直接引用。
DSL 变更后重新生成：

```bash
cd "C:\Users\mazit\Desktop\2026秋\实训2\01-源代码\diabetes-assistant"
python ../shixun2_build/render_workflows.py
```

### 一致性实测证据

「真实 Dify 模式」与「离线降级模式」结果是否真的一致，已用交叉验证脚本实测（不是靠人工比对）：

| 验证脚本 | 覆盖 | 用例数 | 结果 |
|---------|------|-------|------|
| `shixun2_build/verify_code_node_parity.py` | WF-2 代码节点（Python） vs `mock-engine.predictRisk`（JS） | 5 | **5/5 完全一致**（score / maxScore / level / probability / bmi 逐项相等） |
| `shixun2_build/verify_checkin_parity.py` | WF-5 代码节点（Python） vs `mock-engine.analyzeCheckin`（JS） | 4 | **4/4 完全一致**（days / totalPlan / expected / done / rate / streak / dietRate / exerciseRate / balance 逐项相等） |

做法：直接从 `dify-apps/*.yml` 里抽出代码节点的 Python 源码执行，
同时在 jsdom 中加载前端模块调用 JS 引擎，用同一组输入比对输出。
覆盖了边界场景：无打卡、仅单类型打卡、非连续打卡、窗口外数据。

> 首次验证时发现 WF-5 的代码节点算法与前端**并不一致**（原先用「打卡次数/方案数」，
> 而前端采用「窗口内去重对数 /（方案数 × 天数）」且返回百分比）。
> 已按前端算法重写并通过 4/4 验证 —— 这类差异如果只靠肉眼比对是发现不了的。
