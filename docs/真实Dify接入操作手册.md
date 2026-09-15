# 真实 Dify 实例接入操作手册

> 本文档对应「从契约桩走向真实实例」这一步：把前端从本地降级引擎 / 契约桩，
> 切到真实运行的 Dify 实例。目标是让 `npm run test:real` 全绿，且页面
> 「运行模式」显示 **在线模式（已接入 Dify）**。

---

## 一、目标实例侦察结论（实测）

| 探测项 | 结果 | 含义 |
|--------|------|------|
| `GET /apps` | `200` | 控制台前端可达 |
| `GET /console/api/setup` | `{"step":"finished","setup_at":"2026-08-24T02:44:26"}` | 实例已初始化，存在 owner 账号 |
| `GET /console/api/system-features` | `app_dsl_version: "0.6.0"` | **导入 DSL 必须用 0.6.0 格式** |
| 同上 | `enable_email_password_login: true`、`is_allow_register: false` | 只能登录，不能自助注册 |
| `POST /console/api/login` | `400` + `LoginPayload: email/password Field required` | 登录端点可用，需邮箱 + 密码 |
| `GET /console/api/workspaces/current/model-providers` | `401` | 模型供应商配置需登录态 |
| `GET /v1/parameters` | `401` `Authorization header must be provided and start with 'Bearer'` | 服务 API 存活，缺 Key |

> **⚠ 端口是动态的**：云沙箱重启后对外端口会变（实测 47810 → 48140 → 46132）。
> 一旦出现 502 / ECONNREFUSED，**先核对浏览器地址栏的端口**，别先怀疑凭据。
> 所有命令都通过 `DIFY_BASE_URL` 传地址，不要写死。

**关键推论**：新建应用 / 取 API Key 只能走控制台内部接口（`/console/api/*`），
而它需要「登录态 + CSRF 令牌」两样东西（详见第 1 步的源码依据）。
因此本流程分「取凭据 → 自动化建应用 → 接线 → 验证」四步。

**已确认的模型供应商**（`providers` 命令实测）：实例上配了 4 个供应商
（deepseek / openai_api_compatible / ollama / siliconflow），
但**只有 `langgenius/deepseek/deepseek` 真正暴露了可用模型**：

| 模型 | 类型 | 上下文 |
|------|------|--------|
| `deepseek-v4-pro` | llm / chat | 1,000,000 |
| `deepseek-v4-flash` | llm / chat | 1,000,000 |

其余 3 个供应商在 `model-types/llm` 里返回空模型列表，不要拿去生成 DSL。

---

## 二、四步流程

### 第 1 步：取控制台凭据

> **先看这一节，否则一定会白折腾。** Dify 控制台的鉴权机制是读源码确认的
> （`api/libs/token.py` + `api/constants/__init__.py`，Dify 1.15.x）：

```python
COOKIE_NAME_ACCESS_TOKEN  = "access_token"     # ← httpOnly，JS 读不到
COOKIE_NAME_REFRESH_TOKEN = "refresh_token"
COOKIE_NAME_CSRF_TOKEN    = "csrf_token"       # ← 非 httpOnly
HEADER_NAME_CSRF_TOKEN    = "X-CSRF-Token"

def extract_access_token(request):
    return extract_console_cookie_token(request) or _try_extract_from_header(request)

def check_csrf_token(request, user_id):
    csrf_token = request.headers.get("X-CSRF-Token")
    csrf_token_from_cookie = request.cookies.get("csrf_token")
    if csrf_token != csrf_token_from_cookie:
        _unauthorized()
```

由此得出四条**必须知道**的事实：

| # | 事实 | 后果 |
|---|------|------|
| 1 | cookie 名是 **`access_token`**，**不存在 `console_token`** | 在 localStorage / cookie 里找 `console_token` 永远是 `undefined` |
| 2 | `access_token` 是 **httpOnly** | Console 里 `localStorage.console_token`、`document.cookie` 都读不到，**只能看 DevTools 的 Cookie 面板** |
| 3 | `/console/api/*` 同时接受 Cookie 与 `Authorization: Bearer` | 拿到 access_token 就能用脚本调用 |
| 4 | 写操作（导入 DSL、建 Key）要过 **CSRF 校验**，且是拿 `X-CSRF-Token` 请求头与 **`csrf_token` cookie** 比对 | 只给 `access_token` 时 GET 能过、POST 会被 401 拒掉 |

**方式 A（推荐）**——从 Cookie 面板复制两个值：

1. 浏览器登录 `http://123.249.115.157:46132/apps`
2. `F12` → **Application / 应用程序** → 左侧 **Cookies** → 选中该站点
   （**不是** Local Storage —— 令牌不在那里）
3. 在列表里复制两个 cookie 的值：

```bash
# Git Bash
export DIFY_CONSOLE_TOKEN='access_token 的值'
export DIFY_CONSOLE_CSRF='csrf_token 的值'

# PowerShell
$env:DIFY_CONSOLE_TOKEN="access_token 的值"
$env:DIFY_CONSOLE_CSRF="csrf_token 的值"

# CMD
set DIFY_CONSOLE_TOKEN=access_token 的值
set DIFY_CONSOLE_CSRF=csrf_token 的值
```

> `access_token` 随「退出登录」立即失效，且不含账号密码，泄露面远小于密码。
> **有效期默认约 1 小时**，所以第 2～4 步要一次跑完。
> `csrf_token` 的有效期是 access_token 的 60 倍，可以放着不管。

**方式 B**——邮箱 + 密码，由脚本登录并解析 `Set-Cookie`：

```bash
export DIFY_CONSOLE_EMAIL='you@example.com'
export DIFY_CONSOLE_PASSWORD='******'
```

> 登录接口**不在响应体里返回令牌**，而是通过 `Set-Cookie` 下发，
> 脚本会从响应头里解析出 `access_token` / `csrf_token` / `refresh_token` 三者。

凭据会被缓存到 `tools/.console-token.json`（已在 `.gitignore` 中排除，权限 `0600`）。
先验证一下再往下走：

```bash
npm run dify:providers      # 顺带验证凭据；若失败会打印明确的补救指引
# 或
node tools/dify-console.js whoami
```

### 第 2 步：确认模型供应商（**最容易踩的坑**）

```bash
npm run dify:providers      # 等价于 node tools/dify-console.js providers
```

- 若列出 `● 已配置` 的供应商 → 记下它的 `provider` 与 `llm` 模型名，进入第 3 步。
- 若全部是 `○ 未配置` → **必须先到控制台配置**：
  1. 右上角头像 → **设置** → **模型供应商**
  2. 安装供应商插件（如 DeepSeek / OpenAI），填入供应商侧 API Key
  3. 回到本步骤重新执行，直到出现 `● 已配置`

> 没配供应商时，应用**能建、能导入、能拿 Key，但一执行就报
> `provider not configured`**——表现为前端静默降级回本地引擎，很难排查。
> 所以这一步不能跳。

### 第 3 步：生成并导入 8 个应用

```bash
# 用第 2 步查到的真实 provider / model 生成
node tools/gen-dsl.js --provider langgenius/deepseek/deepseek --model deepseek-chat

# 导入（自动读取 dify-apps/ 下全部 .yml）
npm run dify:import
```

生成器会自校验每个文件：`version` 必须为字符串、节点数 ≥2、边数 ≥节点数-1、
每条边的两个端点都必须存在、`position.y` 必须是数字。任一不满足会打印 `✖`。

若导入后控制台提示「插件缺失」，用真实标识重新生成一次再导入：

```bash
node tools/gen-dsl.js --provider <p> --model <m> \
  --plugin 'langgenius/deepseek:0.0.1@<sha>'
```

### 第 4 步：取 Key、接线、验证

```bash
npm run dify:keys            # 列出各应用的 API Key，缺失的自动创建
npm run dify:wire            # 把 8 个 Key 回写进 js/config.js
npm run test:real            # 用真实 Dify 跑 8 个应用的端到端校验
```

`test:real` 会区分四类问题，避免把网络问题误判成代码问题：

| 判定 | 含义 |
|------|------|
| `ok` | 契约与鉴权都通过 |
| `bad-key` | HTTP 401，Key 无效或过期 |
| `not-found` | HTTP 404，基址路径不对（如漏了 `/v1`） |
| `contract-mismatch` | HTTP 200 但输出结构不符合前端契约 |

只想验证鉴权层、不消耗模型额度时用：

```bash
npm run test:real:probe
```

---

## 三、8 个应用与设计取舍

| 文件 | 应用 | 模式 | 端点 | 图结构 |
|------|------|------|------|--------|
| `WF-1-home-data.yml` | WF-1 首页数据管理 | `workflow` | `/workflows/run` | start → 知识库检索 → llm → end |
| `WF-2-risk-prediction.yml` | WF-2 个人信息与风险预测 | `workflow` | `/workflows/run` | start → 知识库检索 → 代码节点(CDRS) → llm → end |
| `WF-3-life-plan.yml` | WF-3 生活计划定制 | `workflow` | `/workflows/run` | start → 知识库检索 → llm → end |
| `WF-4-health-news.yml` | WF-4 健康资讯生成 | `workflow` | `/workflows/run` | start → 知识库检索 → llm → end |
| `WF-5-checkin-analysis.yml` | WF-5 打卡分析 | `workflow` | `/workflows/run` | start → 知识库检索 → 代码节点(三维指标) → llm → end |
| `CHAT-1-doctor-chat.yml` | CHAT-1 医师咨询助手 | `advanced-chat` | `/chat-messages` 流式 | start → 知识库检索 → llm → answer |
| `CHAT-2-ai-assistant.yml` | CHAT-2 AI智能助手 | `advanced-chat` | `/chat-messages` 流式 | start → 知识库检索 → llm → answer |
| `AGENT-1-admin-agent.yml` | AGENT-1 AI管理助手 | `advanced-chat` | `/chat-messages` 阻塞 | start → llm → answer |

> 除 `AGENT-1`（数据管理场景不需要检索）外的 7 个应用都接入了知识库检索节点，
> 检索 `knowledge-base/` 下 6 份糖尿病专业文档；`WF-2` 与 `WF-5` 另含代码节点，
> 把确定性计算从大模型手里拿走。工作流图见 `docs/workflow-diagrams/`。

### 取舍 1：工作流只输出一个 `result` 变量

前端 `js/api.js` 的 `unwrap()` 决定输出形状：它把 `outputs` 当作一个整体，
先尝试整体 `JSON.parse`，失败再按 `result/output/data/text/answer/json/content`
顺序找「值是可解析 JSON 字符串」的键。

所以 `end` 节点**只能输出一个键**：

```yaml
outputs:
  - variable: result
    value_selector: [home_llm, text]
    value_type: string
```

如果拆成 `articles` + `diabetesTypes` 两个键，Dify 会把两个值都序列化成**字符串**，
前端 `arr()` 拿到的是字符串而不是数组 → 判空 → 直接抛「契约不匹配」并降级本地。
这是最容易踩的坑，改 DSL 时务必保持单键。

这条约束由 `npm run test:dsl` 守着（91 条断言），改坏会立刻失败。

### 取舍 1b：输出解析容忍 markdown 围栏

真实模型即使被要求「只输出 JSON」，仍常把结果包进 ```json ... ``` 或前后夹带说明。
前端 `tryParse` 因此做三级容错：① 直接解析 → ② 剥围栏后解析 → ③ 截取首尾括号之间再解析。
任何一级失败都返回 `null` 由上层降级，绝不抛异常。

若没有这层容错，表现为：**页面显示在线模式，但每次请求都静默降级回本地引擎**，
Network 面板里 `POST /workflows/run` 返回 200，控制台只有一行
`[api] xxx 契约不匹配，已降级本地引擎`。这是最难排查的一类故障。

### 取舍 2：AGENT-1 用 `advanced-chat` 而非 `agent-chat`

契约文档写的是「Agent + Function Calling」，但真实落地有两个硬障碍：

1. `agent-chat` 模式用的是**顶层 `model_config`** 结构（不是 `workflow.graph`），
   字段多且版本敏感，导入失败风险高；
2. 那 5 个工具（`get_stats` / `list_users` / `list_articles` / `add_article` /
   `delete_article`）操作的是**前端 localStorage 里的数据**，不是服务端数据。
   Dify 的 Function Calling 只能调 HTTP 工具，没有可指向的后端端点。

而前端对 AGENT-1 的消费方式只是：`POST /chat-messages`（`blocking`）→ 读 `json.answer`。
`advanced-chat` 完全支持阻塞模式并返回 `answer`，**契约一致、导入风险最低**。

> **后续项**：若要真正实现 Function Calling，需要先给这 5 个工具搭一个 HTTP 后端
> （或改成 Dify 侧工具插件），再切到 `agent-chat` 模式。

### 取舍 3：`dependencies` 默认留空

`marketplace_plugin_unique_identifier` 需要形如 `langgenius/deepseek:0.0.1@<sha>` 的
精确标识。写错会让导入尝试安装一个不存在的插件而失败。因此默认 `dependencies: []`，
导入后若控制台提示插件缺失，再用 `--plugin` 补真实标识重新生成。

### 取舍 4：知识库节点未接入

契约文档要求 CHAT-1「对话流 + 知识库」，但 `knowledge-retrieval` 节点需要真实的
`dataset_ids`（且可能被服务端加密）。空 `dataset_ids` 会导致节点执行失败，
所以 DSL 中**暂不包含该节点**。

> **后续项**：先在控制台建知识库、上传 `项目素材/知识库/` 下的 6 份 docx
> （自动分段 + 父子分段，索引方式「高质量」），再把 dataset id 填进 DSL 的
> `knowledge-retrieval` 节点（插在 start 与 llm 之间），并给 llm 节点开启
> `context.enabled: true`。

---

## 四、命令速查

| 命令 | 作用 |
|------|------|
| `npm run dify:providers` | 列出模型供应商（**先跑这个**） |
| `npm run dify:apps` | 列出实例上已有应用 |
| `npm run dify:gen` | 生成 8 个 DSL 文件并自校验 |
| `npm run dify:import` | 导入 `dify-apps/` 下全部 DSL |
| `npm run dify:keys` | 列出 / 创建 API Key |
| `npm run dify:wire` | 把 Key 回写进 `js/config.js` |
| `npm run test:real` | 真实实例端到端校验 |
| `npm run test:real:probe` | 仅鉴权探测（不消耗额度） |
| `node tools/dify-console.js whoami` | 验证凭据是否有效 |
| `node tools/dify-console.js logout` | 清除本地凭据缓存 |

---

## 五、已知风险

1. **`access_token` 有效期约 1 小时**——第 2～4 步需连续执行；过期后重新从 Cookie 面板复制一次即可。
2. **只给 `access_token` 不给 `csrf_token` 时，GET 能过、POST 全挂**——
   表现为 `providers` / `apps` 正常，但 `import` / `keys --create` 一律 401。
   原因是 `check_csrf_token()` 拿 `X-CSRF-Token` 请求头与 `csrf_token` **cookie** 比对。
   工具已在写操作时同时发送 `Cookie: csrf_token=…` 与 `X-CSRF-Token: …`，
   并在失败时打印专门的补救指引。
3. **不要用 `GET /console/api/workspaces/current` 做鉴权探针**——该路径只接受 POST，
   用 GET 会返回 `405`，容易被误读成「凭据问题」。工具已改用
   `GET /console/api/account/profile`。
4. **模型供应商未配置时静默降级**——前端表现为「看起来在线、实际走本地」，
   排查入口是 `npm run dify:providers` 与浏览器 Console 的
   `[api] xxx 契约不匹配，已降级本地引擎` 警告。
5. **`json` 类型入参**——`userInfo` / `planList` / `punchList` 用 `json` 类型接收
   对象与数组。若目标实例对 `json` 校验更严格而报 422，需要改成
   `paragraph` 并让前端 `JSON.stringify` 后传入（会改动前端契约）。
6. **`advanced-chat` 的 `features` 只写了 `opening_statement` + `suggested_questions`**——
   与官方 0.6.0 导出样例保持一致的最小集；`file_upload` 等未启用，因为前端不上传文件。
7. **本流程未改动 `js/config.js` 的 `proxyMode`**——`write-config` 只回填 `apiKey`，
   仍处于「直连模式」。生产部署应改为 `proxyMode: true` + Nginx 注入 Authorization
   （见 `docs/Dify应用配置指南.md` 模式 B）。

---

## 六、拿不到控制台账号 / 实例不可达时

### 6.1 先判断是"实例挂了"还是"凭据不对"

云沙箱的端口网关在**后端容器停止**时返回 502，特征很好认：

```
HTTP/1.1 502 Bad Gateway
Connection: close
Retry-After: 1
Content-Type: text/plain; charset=utf-8
```

而 Dify 自己的 nginx 不会这样回。判别方法：

```bash
# 1) TCP 层是否还有人监听
timeout 5 bash -c 'cat < /dev/null > /dev/tcp/123.249.115.157/46132' && echo OPEN || echo REFUSED

# 2) 已知正常的端点是否也 502（/apps 是静态页，不受数据库影响）
curl -s -o /dev/null -w "%{http_code}\n" http://123.249.115.157:46132/apps
curl -s -o /dev/null -w "%{http_code}\n" http://123.249.115.157:46132/console/api/setup
```

若 `/apps` 也 502 → **实例停了，不是凭据问题**，需要在云沙箱控制台重启容器/会话。

### 6.2 在 VM 上重置或新建控制台账号（Dify 自带 CLI）

Dify 提供账号管理的 CLI 命令（源码：`api/commands/account.py`），
**不需要知道原密码，也不需要在 DB 里手写哈希**——命令内部会调用 Dify 自己的
`hash_password`：

```bash
# 找到 api 容器名（通常是 docker-api-1）
docker ps --format '{{.Names}}'

# 方式一：新建账号 + 工作区，命令会打印自动生成的密码
docker exec -it <api容器> flask create-tenant \
  --email you@example.com --name "我的工作区" --language zh-Hans

# 方式二：重置已有账号的密码
docker exec -it <api容器> flask reset-password \
  --email <邮箱> --new-password <新密码> --password-confirm <新密码>
```

> 两个命令都**只影响账号表**，不动应用数据。`create-tenant` 会新建一个独立工作区，
> 8 个应用会建在那个工作区里——功能上完全等价。
>
> 密码需满足 Dify 的 `password_pattern`，建议用 8 位以上、含大小写字母与数字的组合。

改完密码后，**用浏览器正常登录控制台**（浏览器会自动做 Base64 编码），
再按第 1 步的方式 A 复制 `access_token` + `csrf_token`。

### 6.3 密码字段是 Base64，既不是明文也不是 RSA

实测目标实例的登录接口返回：

```json
{"code":"authentication_failed","message":"Invalid encrypted data","status":401}
```

这个报错名不副实：它不是"加密失败"，而是**服务端 Base64 解码失败**。

证据在 Dify 源码 `api/libs/encryption.py`：

```python
class FieldEncryption:
    @classmethod
    def decrypt_field(cls, encoded_text: str) -> str | None:
        try:
            decoded_bytes = base64.b64decode(encoded_text)
            return decoded_bytes.decode("utf-8")
        except Exception:
            return None
```

文件头 docstring 写得很直白：

> This uses Base64 encoding for obfuscation, not cryptographic encryption.
> Real security relies on HTTPS for transport layer encryption.

即：**这个构建没有 RSA**（早期版本有，现已移除）。前端把密码做一次 Base64 提交，
服务端 Base64 解码后直接比对 hash；解码失败返回 `None`，
`controllers/console/wraps.py` 就抛 `ERROR_MSG_INVALID_ENCRYPTED_DATA = "Invalid encrypted data"`。

为什么明文会被判"无效"：Python 的 `base64.b64decode` 对长度不是 4 的倍数的串直接抛错。
`qst123456` 是 9 个字符，`MVe0%8F8` 含 `%`——都不合法 → 解码失败 → 401。
**这跟密码对不对无关，纯粹是编码格式问题。**

工具已内置处理：`tools/dify-console.js` 的 `encodePassword()` 会自动 Base64 编码，
所以 `DIFY_CONSOLE_PASSWORD` 直接填**明文**即可：

```bash
export DIFY_CONSOLE_EMAIL='qst@qst.com'
export DIFY_CONSOLE_PASSWORD='qst123456'      # 明文，脚本自己编码
node tools/dify-console.js providers
```

> 若仍报 `Invalid encrypted data`，说明服务端拿到的串没过 Base64 校验——
> 改走第 1 步的方式 A（cookie），它完全绕开登录接口。

---

## 七、实战踩坑清单（按排查顺序）

这一节记录的每一条都是**在真实实例上撞出来并验证过**的，不是推测。
按「现象 → 根因 → 处理」排列，排查时顺着往下走即可。

### 7.1 502 / ECONNREFUSED —— 先查端口，再查实例

| 现象 | 根因 |
|------|------|
| 网关返回 `upstream connect failed: … (os error 10061)` | 后端容器没在跑 |
| curl 能通、Node 脚本 `ECONNREFUSED` | **Node 的 fetch 不读 `HTTP_PROXY`** |

第二条极易误判：curl 读代理所以通，脚本直连所以被拒。
`tools/dify-console.js` 已内置代理感知的传输层（明文 HTTP 走 absolute-URI，HTTPS 走 CONNECT），
并提供了 `fetchShim` 供 `js/api.js` 与 `tests/real-dify-check.js` 注入，无需改动前端源码。

> 附带坑：走代理时**不要复用 keep-alive 连接**，实测会出现「同一 URL 第一次正常、
> 第二次拿到错乱响应」。传输层已固定为每请求独立连接（`agent: false`）。

### 7.2 导入后应用不能用 —— 没发布

导入成功（`completed`）**不代表可用**。应用是草稿态，此时调服务 API 会返回：

```json
{"code":"invalid_param","message":"Workflow not published","status":400}
```

前端会静默降级本地引擎，表现是「页面正常但数据不是 Dify 给的」。

- 发布端点：`POST /console/api/apps/{id}/workflows/publish`
  （**workflow 与 advanced-chat 通用**；`/console/api/apps/{id}/publish` 是 404）
- `import` 命令已内置「导入后自动发布」，重建时用 `delete` + `import` 即可

### 7.3 导入端点有复数 s

`POST /console/api/apps/import` → **404**；
正确的是 `POST /console/api/apps/imports`。
（判断技巧：返回 `415 Unsupported Media Type` 说明端点存在、只是期待 multipart；返回 HTML 的 404 才是路径错。）

### 7.4 start 变量类型枚举 —— 以实例报错为准

`type: 'json'` 会被拒绝。实例返回的真实枚举是：

```
text-input | select | paragraph | number |
external_data_tool | file | file-list | checkbox | json_object
```

> **教训**：`tests/dsl-test.js` 早先那份枚举是从文档推的，含 `json` / `url` / `files`，
> 于是测试放行了一个实例根本不接受的值。**允许清单类常量必须用真实反馈校准**，
> 否则测试形同虚设。现枚举直接取自实例的 Pydantic 校验报错。

另外 `json_object` 会强制要求传**字典**，传数组会报
`xxx in input form must be a dict`。本项目 `planList` / `punchList` 天然是数组，
所以统一改成 `paragraph` + 前端 `JSON.stringify`（见 `js/api.js` 的 `serializeInputs`，
只序列化对象与数组，数字/字符串原样透传，避免 `number` 类型变量收到 `"30"`）。

### 7.5 推理模型会输出 `<think>` 思考块

`deepseek-v4-pro` 的输出形如：

```
<think>
<!--dify-deepseek-reasoning-->我们需要回答用户…
</think>{"articles":[…]}
```

**工作流与聊天是两种不同场景，必须分开处理**：

- **工作流（JSON）**：思考内容里的花括号会让「截取首尾括号」截错位置
  → 解析失败 → 静默降级。
- **聊天 / 智能体（文本）**：思考过程会**原样显示给用户**
  （实测回复长这样：`AI<think>用户要求统计系统数据。我需要复述意图…</think>…`），
  这是用户可见缺陷，不只是解析问题。

`js/api.js` 的 `stripThink(s, textMode)` 已同时覆盖两者：

| 情况 | JSON 模式 | 文本模式 |
|------|-----------|----------|
| 有 `</think>` 闭合 | 移除全部成对块 | 同左，保留块前块后正文 |
| 未闭合（流式中途） | 尽力抢救后面以 `{`/`[` 起头的正文 | 视为"还在思考"，只保留 `<think>` 之前的正文 |

> 流式推送有个隐蔽坑：**不能逐个 delta 判断 `<think>`**。
> 若 `</thi` 与 `nk>` 被拆到两个 chunk，就永远等不到闭合，之后的正误会一直被当思考丢弃。
> 正确做法是累积原文 → 整体去块 → 只把「新增的干净部分」推给 `onDelta`。

`tests/logic-test.js` 有 8 个用例锁定该行为。

### 7.6 工作流很慢 —— 默认超时不够

实测单次工作流调用 **约 40 秒**（`deepseek-v4-pro`）。默认 20s 必然超时，
超时后同样表现为「降级本地引擎」。

```bash
DIFY_TIMEOUT=180000 node tests/real-dify-check.js
```

若追求响应速度，可改用 `deepseek-v4-flash` 重新生成：
`node tools/gen-dsl.js --model deepseek-v4-flash` 然后 `delete` + `import`。

### 7.7 凭据相关

- 密码字段是 **Base64**（不是 RSA，也不是明文），详见 §6.3；工具已自动编码
- `X-CSRF-Token` 请求头 **GET 也要带**（本实例实测），且必须与 `csrf_token` cookie 同时发送
- Cookie 名是 `access_token` / `csrf_token`，**没有** `console_token`；
  `access_token` 是 httpOnly，只能在 DevTools → Application → Cookies 里看到，JS 读不到

### 7.8 测试本身的坑：假通过

两种「看着绿其实没验到」：

1. **对话型应用**只返回纯文本，拿不到 `source` 字段，
   降级到本地 mock 引擎后「回复非空 / 分块数 > 1」照样通过。
   → `tests/real-dify-check.js` 已加网络层记录器，
   断言「本次确实打到 Dify 且返回 2xx」，对所有 8 个应用一票否决。
2. **单元测试**依赖 `config.js` 状态：一旦 `write-config` 写入真实 Key，
   「未配置时应降级」类用例的前提就没了。
   → `logic-test.js` 启动时统一清空 Key，保证与实例接线状态无关。
