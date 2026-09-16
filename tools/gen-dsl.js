#!/usr/bin/env node
/**
 * gen-dsl.js — 生成 8 个可导入真实 Dify 的应用 DSL（version 0.6.0）
 * ==================================================================
 * 为什么是 0.6.0：目标实例 /console/api/system-features 返回
 *   app_dsl_version = "0.6.0"
 * 导入时 Dify 会比对 DSL 版本与服务器版本，写成 0.7.0 会触发迁移确认甚至拒绝。
 *
 * 【设计要点｜为什么这样连线】
 * 前端 js/api.js 的 unwrap() 决定了工作流输出的**形状**：
 *   outputs = { result: "<JSON 字符串>" }  →  tryParse 成功 → 拆包成对象
 * 如果 end 节点拆成 { articles: "...", diabetesTypes: "..." } 两个键，
 * 值会退化成字符串，前端 arr() 拿到空数组 → 直接判定「契约不匹配」并降级本地。
 * 因此**每个工作流都只输出一个 result 变量**，值是完整 JSON 字符串。
 *
 * 【用法】
 *   node tools/gen-dsl.js                                  # 用默认 provider/model 生成
 *   node tools/gen-dsl.js --provider langgenius/deepseek/deepseek --model deepseek-v4-pro
 *   node tools/gen-dsl.js --plugin langgenius/deepseek:0.0.1@<sha>   # 写进 dependencies
 *   node tools/gen-dsl.js --dry                            # 只打印不落盘
 * ==================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dify-apps');

/* ---------------- 参数 ---------------- */
function arg(name, dft) {
  const i = process.argv.indexOf('--' + name);
  return (i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--'))
    ? process.argv[i + 1] : dft;
}
const DRY = process.argv.includes('--dry');
const PROVIDER = arg('provider', 'langgenius/deepseek/deepseek');
const MODEL = arg('model', 'deepseek-v4-pro');
const MODEL_PRO = arg('model-pro', MODEL);      // 规划/推理类节点
const DSL_VERSION = arg('version', '0.6.0');
const PLUGIN = arg('plugin', '');               // marketplace_plugin_unique_identifier

/* ---------------- 图元构造 ---------------- */
const Y = 240;

function nd(id, dataType, title, extra, x) {
  return {
    id,
    type: 'custom',
    data: Object.assign({ type: dataType, title }, extra),
    position: { x, y: Y },
    positionAbsolute: { x, y: Y },
    sourcePosition: 'right',
    targetPosition: 'left',
    width: 244,
    height: 110
  };
}

/** start 节点。variables 项：{label, variable, type, required, max_length?} */
function startNode(id, title, variables, x) {
  return nd(id, 'start', title, { variables: variables || [] }, x);
}

/**
 * llm 节点。
 * @param {object} o {system, user, model, temperature, memory}
 */
function llmNode(id, title, o, x) {
  const data = {
    model: {
      provider: PROVIDER,
      name: o.model || MODEL,
      mode: 'chat',
      completion_params: { temperature: o.temperature === undefined ? 0.2 : o.temperature }
    },
    prompt_template: [
      { id: id + '-system', role: 'system', text: o.system },
      { id: id + '-user', role: 'user', text: o.user }
    ],
    context: { enabled: false, variable_selector: [] },
    vision: { enabled: false }
  };
  if (o.memory) {
    data.memory = {
      query_prompt_template: '{{#sys.query#}}',
      role_prefix: { assistant: '', user: '' },
      window: { enabled: true, size: 20 }
    };
  }
  return nd(id, 'llm', title, data, x);
}

/** end 节点：outs = [{variable, selector}]，一律 string */
function endNode(id, title, outs, x) {
  return nd(id, 'end', title, {
    outputs: outs.map((o) => ({ variable: o.variable, value_selector: o.selector, value_type: 'string' }))
  }, x);
}

/** answer 节点（仅 advanced-chat 用） */
function answerNode(id, title, answer, x) {
  return nd(id, 'answer', title, { answer, variables: [] }, x);
}

function edge(from, to, fromType, toType) {
  return {
    id: from + '-source-' + to + '-target',
    source: from,
    sourceHandle: 'source',
    target: to,
    targetHandle: 'target',
    type: 'custom',
    data: { sourceType: fromType, targetType: toType, isInIteration: false, isInLoop: false }
  };
}

/** 组装成完整 app DSL */
function makeApp(o) {
  const doc = {
    version: DSL_VERSION,
    kind: 'app',
    app: {
      name: o.name,
      description: o.description || '',
      icon: o.icon || '🤖',
      icon_type: 'emoji',
      icon_background: o.iconBg || '#E4FBCC',
      mode: o.mode,
      use_icon_as_answer_icon: false
    },
    dependencies: PLUGIN
      ? [{ current_identifier: null, type: 'marketplace', value: { marketplace_plugin_unique_identifier: PLUGIN, version: null } }]
      : [],
    workflow: {
      conversation_variables: [],
      environment_variables: [],
      features: o.features || {},
      graph: { nodes: o.nodes, edges: o.edges, viewport: { x: 0, y: 0, zoom: 0.8 } }
    }
  };
  return doc;
}

/* ---------------- 通用提示词片段 ---------------- */
const JSON_ONLY = '你只输出一个 JSON 对象，绝不用三反引号包裹，绝不输出任何解释、前言或后记。';

/* ================================================================== */
/* 8 个应用定义                                                        */
/* ================================================================== */

/* ---------- WF-1 首页数据管理 ---------- */
const WF1 = makeApp({
  name: '首页数据管理',
  mode: 'workflow',
  icon: '🏠', iconBg: '#FFEAD5',
  description: '返回首页文章列表与糖尿病类型数据',
  nodes: [
    startNode('home_start', '开始', [
      { label: '文章分类', variable: 'category', type: 'text-input', required: false, max_length: 50 }
    ], 40),
    llmNode('home_llm', '生成首页数据', {
      temperature: 0.3,
      system: '你是糖尿病健康知识库的数据生成器。' + JSON_ONLY,
      user: [
        '请生成「糖尿病预治智能助手」首页展示数据，严格按下面结构输出：',
        '',
        '{"articles":[{"article_id":1,"title":"文章标题","category":"饮食指导","author":"AI 健康助手","publish_time":"2026-01-15","views":128,"content":"正文，200字以内"}],"diabetesTypes":[{"type_id":1,"type_name":"1型糖尿病","summary":"一句话概述","pathogenesis":"发病机制","manifestation":"典型表现","treatment":"治疗要点","life_notes":["注意事项1","注意事项2","注意事项3"]}]}',
        '',
        '要求：',
        '1. articles 至少 3 条；category 只能取「饮食指导 / 运动指南 / 生活习惯 / 糖尿病科普」之一；',
        '2. diabetesTypes 必须恰好 4 条，type_name 依次为「1型糖尿病 / 2型糖尿病 / 妊娠型糖尿病 / 特殊型糖尿病」；',
        '3. 每条 life_notes 至少 3 项；',
        '4. publish_time 用今天的日期，格式 YYYY-MM-DD；views 为 50–500 的整数；',
        '5. 分类偏好（可为空，为空则不限）：{{#home_start.category#}}'
      ].join('\n')
    }, 360),
    endNode('home_end', '输出', [{ variable: 'result', selector: ['home_llm', 'text'] }], 680)
  ],
  edges: [edge('home_start', 'home_llm', 'start', 'llm'), edge('home_llm', 'home_end', 'llm', 'end')]
});

/* ---------- WF-2 个人信息与风险预测 ---------- */
const WF2 = makeApp({
  name: '个人信息与风险预测',
  mode: 'workflow',
  icon: '📊', iconBg: '#D1E9FF',
  description: '补全信息 → 判断患病 → 评分 → 归因 → 建议',
  nodes: [
    startNode('risk_start', '开始', [
      { label: '年龄', variable: 'age', type: 'number', required: true },
      { label: '性别', variable: 'sex', type: 'text-input', required: true, max_length: 10 },
      { label: '身高(cm)', variable: 'height', type: 'number', required: true },
      { label: '体重(kg)', variable: 'weight', type: 'number', required: true },
      { label: '腰围(cm)', variable: 'waistline', type: 'number', required: false },
      { label: '收缩压(mmHg)', variable: 'systolicPressure', type: 'number', required: false },
      { label: '糖尿病家族史', variable: 'familyHistory', type: 'text-input', required: false, max_length: 10 },
      { label: '是否妊娠期', variable: 'isPregnancy', type: 'text-input', required: false, max_length: 10 },
      { label: '是否已确诊糖尿病', variable: 'disease', type: 'text-input', required: false, max_length: 10 }
    ], 40),
    llmNode('risk_llm', '风险评估', {
      temperature: 0.1,
      model: MODEL_PRO,
      system: '你是糖尿病风险评估模型，依据《中国糖尿病风险评分表（CDRS）》口径进行评分。' + JSON_ONLY,
      user: [
        '请根据以下用户信息完成糖尿病风险评估。',
        '',
        '用户信息：',
        '- 年龄：{{#risk_start.age#}} 岁',
        '- 性别：{{#risk_start.sex#}}',
        '- 身高：{{#risk_start.height#}} cm',
        '- 体重：{{#risk_start.weight#}} kg',
        '- 腰围：{{#risk_start.waistline#}} cm',
        '- 收缩压：{{#risk_start.systolicPressure#}} mmHg',
        '- 糖尿病家族史：{{#risk_start.familyHistory#}}',
        '- 是否妊娠期：{{#risk_start.isPregnancy#}}',
        '- 是否已确诊糖尿病：{{#risk_start.disease#}}',
        '',
        '严格输出如下 JSON：',
        '{"score":12,"maxScore":27,"level":"中风险","probability":44,"bmi":26.4,"disease":"未患病","riskType":"2型糖尿病","factors":["糖尿病家族史","BMI 偏高"],"message":"您存在一定的糖尿病风险……","advice":["调整饮食结构……","饭后 1 小时快走 30 分钟……"]}',
        '',
        '评分规则（满分 27 分）：',
        '- 年龄 ≥45 岁 +4；≥60 岁 +6',
        '- BMI ≥24 +3；≥28 +5',
        '- 腰围 男≥90cm / 女≥85cm +3',
        '- 收缩压 ≥130mmHg +3',
        '- 有糖尿病家族史 +4',
        '- 妊娠期 +3',
        '- 已确诊糖尿病 +5',
        'level 判定：score ≤8 → 「低风险」；9–15 → 「中风险」；≥16 → 「高风险」（必须用这三个词之一）',
        'probability 为 0–100 的整数；bmi 保留 1 位小数；',
        'disease 只能取「未患病」或「已患病」；riskType 取「1型糖尿病 / 2型糖尿病 / 妊娠型糖尿病 / 特殊型糖尿病 / 暂无明显倾向」之一；',
        'factors 与 advice 各 2–4 条中文短句。'
      ].join('\n')
    }, 360),
    endNode('risk_end', '输出', [{ variable: 'result', selector: ['risk_llm', 'text'] }], 680)
  ],
  edges: [edge('risk_start', 'risk_llm', 'start', 'llm'), edge('risk_llm', 'risk_end', 'llm', 'end')]
});

/* ---------- WF-3 生活计划定制 ---------- */
const WF3 = makeApp({
  name: '生活方案定制',
  mode: 'workflow',
  icon: '🥗', iconBg: '#E4FBCC',
  description: '生成多条饮食 + 运动方案',
  nodes: [
    startNode('plan_start', '开始', [
      { label: '用户画像', variable: 'userInfo', type: 'paragraph', required: false },
      { label: '当前生活状态', variable: 'lifeState', type: 'paragraph', required: false, max_length: 500 },
      { label: '用户诉求', variable: 'advice', type: 'paragraph', required: false, max_length: 500 }
    ], 40),
    llmNode('plan_llm', '生成生活方案', {
      temperature: 0.4,
      system: '你是糖尿病生活方式干预的营养师与运动康复师，方案须符合医学营养治疗（MNT）与运动疗法循证依据。' + JSON_ONLY,
      user: [
        '请为该用户生成一日生活方案。',
        '',
        '用户画像（JSON）：{{#plan_start.userInfo#}}',
        '当前生活状态：{{#plan_start.lifeState#}}',
        '用户诉求：{{#plan_start.advice#}}',
        '',
        '严格输出如下 JSON：',
        '{"plans":[{"type":"饮食","order":1,"time":"07:00","title":"营养早餐","content":"……"},{"type":"运动","order":1,"time":"08:30","title":"餐后快走","content":"……"}],"summary":"已为您生成 9 条生活方案……"}',
        '',
        '要求：',
        '1. plans 共 9 条：饮食 5 条（早/午/晚餐 + 两次加餐）、运动 4 条；',
        '2. type 只能是「饮食」或「运动」；order 为同类内序号，从 1 开始；',
        '3. time 用 HH:MM 24 小时制，且按时间从早到晚排列；',
        '4. content 60–120 字，具体到食物种类与大致份量，或运动时长与强度；',
        '5. summary 一句话总结，需含方案条数。'
      ].join('\n')
    }, 360),
    endNode('plan_end', '输出', [{ variable: 'result', selector: ['plan_llm', 'text'] }], 680)
  ],
  edges: [edge('plan_start', 'plan_llm', 'start', 'llm'), edge('plan_llm', 'plan_end', 'llm', 'end')]
});

/* ---------- WF-4 健康资讯生成 ---------- */
const WF4 = makeApp({
  name: '健康资讯生成',
  mode: 'workflow',
  icon: '📰', iconBg: '#FFEAD5',
  description: '生成标签 + 文章',
  nodes: [
    startNode('news_start', '开始', [
      { label: '用户画像', variable: 'userInfo', type: 'paragraph', required: false },
      { label: '指定标签', variable: 'tag', type: 'text-input', required: false, max_length: 30 }
    ], 40),
    llmNode('news_llm', '生成资讯', {
      temperature: 0.6,
      system: '你是糖尿病健康科普编辑，内容须循证、通俗、可执行，不夸大疗效，不给出具体用药剂量。' + JSON_ONLY,
      user: [
        '请生成一篇糖尿病健康资讯。',
        '',
        '用户画像（JSON）：{{#news_start.userInfo#}}',
        '指定标签（可为空）：{{#news_start.tag#}}',
        '',
        '严格输出如下 JSON：',
        '{"tags":["饮食指导","运动指南","生活习惯","糖尿病科普"],"tag":"饮食指导","article":{"title":"文章标题","tags":["饮食指导"],"author":"AI 健康助手","publish_time":"2026-09-12","category":"饮食指导","content":"## 小标题\\n正文……"}}',
        '',
        '要求：',
        '1. tags 固定为「饮食指导、运动指南、生活习惯、糖尿病科普」这 4 个；',
        '2. 若「指定标签」为空，从 tags 中任选一个作为 tag；否则 tag 等于指定标签；',
        '3. article.tags 为含 tag 的数组；article.category 与 tag 一致；',
        '4. article.content 用 Markdown，包含 3–5 个二级标题（##），总长 600–900 字；',
        '5. publish_time 用今天的日期，格式 YYYY-MM-DD；author 固定「AI 健康助手」。'
      ].join('\n')
    }, 360),
    endNode('news_end', '输出', [{ variable: 'result', selector: ['news_llm', 'text'] }], 680)
  ],
  edges: [edge('news_start', 'news_llm', 'start', 'llm'), edge('news_llm', 'news_end', 'llm', 'end')]
});

/* ---------- WF-5 打卡分析 ---------- */
const WF5 = makeApp({
  name: '打卡分析',
  mode: 'workflow',
  icon: '✅', iconBg: '#E4FBCC',
  description: '分析近 7 日生活状态',
  nodes: [
    startNode('check_start', '开始', [
      { label: '计划列表', variable: 'planList', type: 'paragraph', required: false },
      { label: '打卡记录', variable: 'punchList', type: 'paragraph', required: false },
      { label: '统计天数', variable: 'days', type: 'number', required: false },
      { label: '锚点日期', variable: 'anchorDate', type: 'text-input', required: false, max_length: 20 }
    ], 40),
    llmNode('check_llm', '打卡分析', {
      temperature: 0.1,
      model: MODEL_PRO,
      system: '你是糖尿病健康管理数据分析师，只依据给定数据做统计，不臆造记录。' + JSON_ONLY,
      user: [
        '请分析该用户最近 {{#check_start.days#}} 天的生活计划执行情况。',
        '',
        '锚点日期（该窗口的最后一天）：{{#check_start.anchorDate#}}',
        '计划列表（JSON 数组）：{{#check_start.planList#}}',
        '打卡记录（JSON 数组）：{{#check_start.punchList#}}',
        '',
        '严格输出如下 JSON：',
        '{"days":7,"totalPlan":9,"expected":63,"done":45,"rate":72,"streak":3,"dietRate":80,"exerciseRate":60,"balance":60,"evaluation":"良好","completionStatus":"近 7 天共应完成 63 项，实际完成 45 项，完成率 72%","suggestions":["……","……","……"],"dayStats":[]}',
        '',
        '要求：',
        '1. totalPlan = 计划条数；expected = totalPlan × days；done = 打卡记录条数；',
        '2. rate = round(done / expected × 100)，expected 为 0 时 rate 取 0；',
        '3. evaluation 只能是「优秀」「良好」「需改进」：rate ≥85 → 优秀；60–84 → 良好；<60 → 需改进；',
        '4. dietRate / exerciseRate 分别为饮食类、运动类计划的完成率；balance 为饮食与运动的均衡度（0–100）；',
        '5. streak 为截至锚点日期连续完成的天数；',
        '6. suggestions 恰好 3 条，每条 20–40 字，必须可执行；',
        '7. 所有比率均为 0–100 的整数。'
      ].join('\n')
    }, 360),
    endNode('check_end', '输出', [{ variable: 'result', selector: ['check_llm', 'text'] }], 680)
  ],
  edges: [edge('check_start', 'check_llm', 'start', 'llm'), edge('check_llm', 'check_end', 'llm', 'end')]
});

/* ---------- CHAT-1 医师咨询助手 ---------- */
const DOCTOR_PROMPT = [
  '你是一位专业的糖尿病防治医师。回答须遵循以下原则：',
  '1. 专业严谨：所有建议基于最新临床指南（医学营养治疗 MNT、运动疗法循证依据）',
  '2. 循证优先：优先推荐有 RCT 研究支持的干预措施',
  '3. 个体化导向：主动询问患者基本信息（年龄、分型、并发症、生活方式等）',
  '4. 风险提示：对胰岛素使用、低血糖处理等关键环节必须明确提示',
  '5. 人文关怀：使用通俗易懂语言，避免医学术语堆砌，关注患者心理状态',
  '6. 安全边界：不给出具体用药剂量，涉及诊疗决策时建议线下就诊',
  '',
  '请用中文回答，先给结论再给说明，单次回答控制在 500 字以内。'
].join('\n');

const CHAT1 = makeApp({
  name: '医师咨询助手',
  mode: 'advanced-chat',
  icon: '🩺', iconBg: '#D1E9FF',
  description: '糖尿病在线咨询（多轮对话）',
  features: {
    opening_statement: '您好，我是糖尿病防治咨询助手。请告诉我您的年龄、糖尿病分型以及目前最关心的问题，我会结合临床指南为您解答。',
    suggested_questions: ['2型糖尿病早餐怎么吃？', '空腹血糖 7.2 算高吗？', '餐后多久运动比较合适？']
  },
  nodes: [
    startNode('chat1_start', '开始', [], 40),
    llmNode('chat1_llm', '医师咨询模型', {
      temperature: 0.3,
      model: MODEL_PRO,
      memory: true,
      system: DOCTOR_PROMPT,
      user: '{{#sys.query#}}'
    }, 360),
    answerNode('chat1_answer', '回复', '{{#chat1_llm.text#}}', 680)
  ],
  edges: [edge('chat1_start', 'chat1_llm', 'start', 'llm'), edge('chat1_llm', 'chat1_answer', 'llm', 'answer')]
});

/* ---------- CHAT-2 AI 智能助手 ---------- */
const ASSISTANT_PROMPT = [
  '你是「糖尿病预治智能助手」网站内的 AI 智能助手，服务范围严格限定为糖尿病相关的三类任务：',
  '',
  '【1. 科普问答】解释糖尿病分型、指标含义、并发症、用药常识。用通俗语言，先结论后说明。',
  '【2. 信息管理】帮助用户理解本站功能：如何填写风险预测、如何生成生活方案、如何打卡、如何收藏文章。给出具体到页面的操作步骤。',
  '【3. 方案制定与修改】在用户已有生活方案的基础上做增量调整（如「早餐太单调」「想减重 5 公斤」），输出可直接执行的调整项。',
  '',
  '约束：',
  '- 不给出具体用药剂量；涉及诊疗决策时建议线下就诊；',
  '- 不做与糖尿病无关的闲聊，礼貌说明服务范围并引导回主题；',
  '- 需要用户信息时，先提问再作答，不要假设用户未提供的病情；',
  '- 单次回答控制在 400 字以内，必要时用短列表。'
].join('\n');

const CHAT2 = makeApp({
  name: 'AI智能助手',
  mode: 'advanced-chat',
  icon: '🤖', iconBg: '#E4FBCC',
  description: '科普 / 信息管理 / 方案制定',
  features: {
    opening_statement: '你好，我是本站的 AI 智能助手。可以问我糖尿病知识、网站功能怎么用，或者让我帮你调整生活方案。',
    suggested_questions: ['风险预测怎么填？', '帮我调整一下早餐方案', '2型糖尿病能吃什么水果？']
  },
  nodes: [
    startNode('chat2_start', '开始', [], 40),
    llmNode('chat2_llm', '智能助手模型', {
      temperature: 0.4,
      memory: true,
      system: ASSISTANT_PROMPT,
      user: '{{#sys.query#}}'
    }, 360),
    answerNode('chat2_answer', '回复', '{{#chat2_llm.text#}}', 680)
  ],
  edges: [edge('chat2_start', 'chat2_llm', 'start', 'llm'), edge('chat2_llm', 'chat2_answer', 'llm', 'answer')]
});

/* ---------- AGENT-1 AI 管理助手 ---------- */
const ADMIN_PROMPT = [
  '你是「糖尿病预治智能助手」的后台管理助手，用自然语言帮管理员操作网站数据。',
  '',
  '你能理解并回答的意图：',
  '1. 数据统计：用户数、文章数、打卡数、风险预测次数等；',
  '2. 用户管理：列出用户、查询某个用户的信息；',
  '3. 文章管理：列出文章、新增文章、删除文章（按 id 或标题）。',
  '',
  '输出要求：',
  '- 先用一句话复述你理解到的操作意图，再给出结果或需要管理员确认的信息；',
  '- 涉及删除等不可逆操作时，必须明确列出将被影响的对象，并请管理员二次确认，不得直接声称已执行；',
  '- 若信息不足（例如只说「删掉那篇」），必须追问具体的 id 或标题；',
  '- 用中文回答，简洁，控制在 300 字以内。'
].join('\n');

const AGENT1 = makeApp({
  name: 'AI管理助手',
  mode: 'advanced-chat',
  icon: '🛠️', iconBg: '#FFEAD5',
  description: '自然语言管理网站数据',
  features: {
    opening_statement: '你好，我是后台管理助手。你可以用自然语言让我查统计、列用户、管理文章。',
    suggested_questions: ['现在有多少用户和文章？', '列出所有文章', '删除 id 为 3 的文章']
  },
  nodes: [
    startNode('agent_start', '开始', [], 40),
    llmNode('agent_llm', '管理助手模型', {
      temperature: 0.2,
      model: MODEL_PRO,
      memory: true,
      system: ADMIN_PROMPT,
      user: '{{#sys.query#}}'
    }, 360),
    answerNode('agent_answer', '回复', '{{#agent_llm.text#}}', 680)
  ],
  edges: [edge('agent_start', 'agent_llm', 'start', 'llm'), edge('agent_llm', 'agent_answer', 'llm', 'answer')]
});

/* ================================================================== */
/* 落盘                                                                */
/* ================================================================== */

const APPS = [
  ['WF-1-home-data', WF1],
  ['WF-2-risk-prediction', WF2],
  ['WF-3-life-plan', WF3],
  ['WF-4-health-news', WF4],
  ['WF-5-checkin-analysis', WF5],
  ['CHAT-1-doctor-chat', CHAT1],
  ['CHAT-2-ai-assistant', CHAT2],
  ['AGENT-1-admin-agent', AGENT1]
];

function main() {
  const dumpOpts = { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false };

  /**
   * 后处理：
   * 1) version 必须加引号。规范原文「Keep version quoted. Dify import expects a
   *    string and rejects non-string values.」js-yaml 会把 0.6.0 裸写成 0.6.0，
   *    虽然 YAML 语义上仍是字符串，但显式加引号才能与官方导出格式一致。
   * 2) 不动 `"y"` 的引号：js-yaml 给 position 的 y 键加引号是**保护性**的。
   *    YAML 1.1 把裸 y/n 视为布尔，去掉引号会让部分解析器把键读成 true。
   */
  function post(text) {
    return text.replace(/^version:\s*(\S+)\s*$/m, 'version: "$1"');
  }

  console.log(`DSL 版本: ${DSL_VERSION}   供应商: ${PROVIDER}   模型: ${MODEL}`);
  console.log(`dependencies: ${PLUGIN ? PLUGIN : '（空——导入后若提示插件缺失，用 --plugin 补上真实标识）'}`);
  console.log('');

  if (!DRY) fs.mkdirSync(OUT_DIR, { recursive: true });

  let totalBytes = 0;
  for (const [file, doc] of APPS) {
    const text = post(yaml.dump(doc, dumpOpts));
    totalBytes += Buffer.byteLength(text);
    const target = path.join(OUT_DIR, file + '.yml');
    if (!DRY) fs.writeFileSync(target, text);

    // 自校验：dump 后必须能被重新 parse 回等价结构
    const back = yaml.load(text);
    const n = back.workflow.graph.nodes.length;
    const e = back.workflow.graph.edges.length;
    const bad = [];
    if (back.version !== DSL_VERSION) bad.push('version');
    if (back.kind !== 'app') bad.push('kind');
    if (!back.app.name) bad.push('app.name');
    if (n < 2) bad.push('nodes');
    if (e < n - 1) bad.push('edges');
    // 每条边的端点必须存在
    const ids = new Set(back.workflow.graph.nodes.map((x) => x.id));
    for (const ed of back.workflow.graph.edges) {
      if (!ids.has(ed.source) || !ids.has(ed.target)) bad.push('dangling-edge:' + ed.id);
    }

    const mark = bad.length ? '✖ ' + bad.join(',') : '✔';
    console.log(`  ${mark}  ${file.padEnd(28)} ${String(n).padStart(2)} 节点 ${String(e).padStart(2)} 边  ${back.app.mode}`);
  }

  console.log('');
  console.log(`共 ${APPS.length} 个文件，${(totalBytes / 1024).toFixed(1)} KB`);
  if (!DRY) console.log(`已写入 ${path.relative(ROOT, OUT_DIR)}/`);
  console.log('');
  console.log('下一步：');
  console.log('  1) node tools/dify-console.js providers     # 确认供应商与模型名，必要时用 --provider/--model 重新生成');
  console.log('  2) node tools/dify-console.js import dify-apps');
  console.log('  3) node tools/dify-console.js keys --create');
}

main();
