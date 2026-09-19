/**
 * mock-engine.js — 本地智能引擎（Dify 降级兜底）
 * ------------------------------------------------------------------
 * 当未配置 Dify API Key、或 Dify 请求失败时，由本模块提供等效能力，
 * 保证系统在任何环境下都能完整演示（对应开发计划 5.3 双模式运行）。
 *
 * 算法依据：
 *  - 风险预测：中国糖尿病风险评分（CDRS）变量集加权累加
 *  - 打卡分析：完成率 / 连续天数 / 类型均衡度 三维指标
 * ------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  var CFG = global.DPA_CONFIG;
  var ui = global.DPA.ui;

  /* ==================== 风险预测 ==================== */

  /** 年龄评分（CDRS）：<40 → 0，每升一个年龄段 +2（封顶 6） */
  function scoreAge(age) {
    if (age < 40) return 0;
    if (age < 50) return 2;
    if (age < 60) return 4;
    return 6;
  }
  /** BMI 评分：<24 → 0，<28 → 3，>=28 → 5 */
  function scoreBMI(bmi) {
    if (bmi < 24) return 0;
    if (bmi < 28) return 3;
    return 5;
  }
  /** 腰围评分：女性 >=85 / 男性 >=90 记 3 分 */
  function scoreWaist(waist, sex) {
    if (!waist) return 0;
    var limit = (sex === '女') ? 85 : 90;
    return waist >= limit ? 3 : 0;
  }

  /**
   * 是/否型字段判定。
   * 必须用白名单精确匹配：早期实现用 /有|是|yes|true|1/ 做子串匹配，
   * 「没有」「无家族史（含"有"字的变体）」会被误判为「有」而多计 5 分。
   */
  var AFFIRMATIVE = ['有', '是', 'yes', 'y', 'true', '1', '确诊'];
  function isAffirmative(v) {
    if (v === null || v === undefined) return false;
    return AFFIRMATIVE.indexOf(String(v).trim().toLowerCase()) >= 0;
  }

  /** 家族史评分：有 → 5 分 */
  function scoreFamily(v) {
    return isAffirmative(v) ? 5 : 0;
  }
  /** 收缩压评分：>=130 记 3 分 */
  function scorePressure(sp) {
    if (!sp) return 0;
    return Number(sp) >= 130 ? 3 : 0;
  }
  /** 性别评分：男性 +1 分 */
  function scoreSex(sex) { return sex === '男' ? 1 : 0; }
  /** 妊娠史评分：女性且为妊娠型 → 4 分 */
  function scorePregnancy(v, sex) {
    if (sex !== '女') return 0;
    return isAffirmative(v) ? 4 : 0;
  }

  /** 归因：指出主要风险来源 */
  function attribute(items, data) {
    var sorted = items.slice().sort(function (a, b) { return b.score - a.score; });
    var top = sorted.filter(function (i) { return i.score > 0; }).slice(0, 3);
    var names = top.map(function (i) { return i.label; });

    var disease = '2型糖尿病';
    if (data.sex === '女' && isAffirmative(data.isPregnancy)) disease = '妊娠型糖尿病';
    else if (isAffirmative(data.familyHistory) && scoreBMI(data.bmi) >= 5) disease = '2型糖尿病';
    else if (scoreAge(data.age) >= 4 && scoreBMI(data.bmi) < 3) disease = '1型糖尿病（需临床鉴别）';

    return { factors: names, disease: disease };
  }

  /** 按风险等级生成个性化建议列表（低/中/高风险分支） */
  function adviceByLevel(level, factors) {
    var base = [
      '保持规律作息，保证每晚 7–8 小时高质量睡眠',
      '戒烟限酒：男性每日酒精 ≤25g，女性 ≤15g',
      '每周至少 150 分钟中等强度有氧运动，配合 2–3 次力量训练'
    ];
    if (level === '低风险') {
      return ['继续保持当前的饮食与运动习惯，每 1–3 年筛查一次血糖'].concat(base.slice(0, 2));
    }
    var mid = [
      '调整饮食结构：主食粗细搭配，每餐七八分饱，进食顺序为蔬菜→蛋白→主食',
      '饭后 1 小时快走 30 分钟，每周 5 次以上',
      '每 3–6 个月检测一次空腹血糖与糖化血红蛋白',
      '控制体重，若超重建议 3–6 个月内减重 5%–10%'
    ];
    if (level === '中风险') return mid.concat(base.slice(0, 1));

    // 高风险
    var high = [
      '建议尽快前往内分泌科进行口服葡萄糖耐量试验（OGTT）明确诊断',
      '严格控糖控量：减少精细米面与添加糖，增加全谷物、豆类与蔬菜',
      '在医生指导下制定运动处方，避免空腹运动导致低血糖',
      '每日监测血糖并记录，关注空腹与餐后 2 小时血糖变化',
      '同步管理血压与血脂，定期检查眼底、肾功能与足部'
    ];
    if (factors && factors.indexOf('腰围超标') >= 0) {
      high.push('重点减少腹部脂肪：控制总热量 + 有氧运动 + 力量训练组合');
    }
    return high;
  }

  /**
   * 风险预测
   * @param {Object} d {age, sex, height, weight, waistline, familyHistory, systolicPressure, isPregnancy}
   */
  function predictRisk(d) {
    d = d || {};
    var age = Number(d.age) || 0;
    var height = Number(d.height) || 0;
    var weight = Number(d.weight) || 0;
    var bmi = height > 0 ? +(weight / Math.pow(height / 100, 2)).toFixed(1) : 0;
    var waist = Number(d.waistline) || 0;
    var sex = d.sex || '男';

    var items = [
      { label: '年龄', score: scoreAge(age) },
      { label: 'BMI 偏高', score: scoreBMI(bmi) },
      { label: '腰围超标', score: scoreWaist(waist, sex) },
      { label: '糖尿病家族史', score: scoreFamily(d.familyHistory) },
      { label: '收缩压偏高', score: scorePressure(d.systolicPressure) },
      { label: '性别因素', score: scoreSex(sex) },
      { label: '妊娠史', score: scorePregnancy(d.isPregnancy, sex) }
    ];

    var score = items.reduce(function (s, i) { return s + i.score; }, 0);
    var R = CFG.RISK;
    var level = score <= R.lowMax ? '低风险' : (score <= R.midMax ? '中风险' : '高风险');
    var probability = Math.min(95, Math.round((score / 27) * 100));
    var attr = attribute(items, { sex: sex, isPregnancy: d.isPregnancy, familyHistory: d.familyHistory, age: age, bmi: bmi });

    var disease = '未患病';
    if (isAffirmative(d.disease)) disease = '已确诊糖尿病';

    return {
      score: score,
      maxScore: 27,
      level: level,
      probability: probability,
      bmi: bmi,
      disease: disease,
      riskType: level === '低风险' ? '暂无明显倾向' : attr.disease,
      factors: attr.factors,
      message: level === '低风险'
        ? '您的糖尿病风险较低，请继续保持健康的生活方式。'
        : (level === '中风险'
          ? '您存在一定的糖尿病风险，建议调整生活方式并定期筛查。'
          : '您的糖尿病风险较高，建议尽快到内分泌科就诊，进行规范检查。'),
      advice: adviceByLevel(level, attr.factors),
      source: 'local'
    };
  }

  /* ==================== 生活方案生成 ==================== */

  /** 「是否已确诊」判定：兼容布尔式（是/有）与结果式（已确诊糖尿病）两种取值 */
  function hasDiseaseFlag(v) {
    return isAffirmative(v) || String(v == null ? '' : v).indexOf('确诊') >= 0;
  }

  /**
   * 生成生活方案（离线兜底）：基于模板复制，结合是否确诊/风险等级微调。
   * @param {Object} userInfo 用户信息
   * @param {string} lifeState 生活习惯描述
   * @param {string} userAdvice 用户额外建议
   * @returns {{plans:Array, summary:string, source:string}}
   */
  function generateLifePlan(userInfo, lifeState, userAdvice) {
    var tpl = (global.DPA_SEED && global.DPA_SEED.LIFE_PLAN_TEMPLATE) || [];
    var list = JSON.parse(JSON.stringify(tpl));

    var tips = [];
    if (userAdvice) tips.push(userAdvice);
    if (lifeState) tips.push('参考生活习惯：' + lifeState);
    var extra = tips.length ? '（已结合您的个性化需求：' + tips.join('；') + '）' : '';

    // 根据是否已确诊/风险等级微调
    var risk = userInfo && userInfo.riskLevel;
    if (risk === '高风险' || (userInfo && hasDiseaseFlag(userInfo.disease))) {
      list.forEach(function (p) {
        if (p.type === '饮食') p.content = p.content.replace('七八分饱', '严格控制主食量至七分饱，餐后监测血糖');
        if (p.type === '运动') p.content += ' 运动前后监测血糖，避免低血糖。';
      });
    }
    // 模板可能为空（数据被清空），必须判空后再拼接
    if (extra && list.length) list[0].content += ' ' + extra;

    return {
      plans: list,
      summary: '已为您生成 ' + list.length + ' 条生活方案（饮食 ' + list.filter(function (p) { return p.type === '饮食'; }).length +
        ' 条 / 运动 ' + list.filter(function (p) { return p.type === '运动'; }).length +
        ' 条 / 其他 ' + list.filter(function (p) { return p.type === '其他'; }).length + ' 条）。' + extra,
      source: 'local'
    };
  }

  /* ==================== 健康资讯生成 ==================== */

  var NEWS_BANK = {
    '饮食指导': {
      title: '控糖饮食这样做：给您的个性化饮食建议',
      body: '## 一、主食选择\n优先选择全谷物（糙米、燕麦、全麦）与杂豆，替代部分白米白面，延缓餐后血糖上升。\n\n## 二、进餐顺序\n先吃蔬菜 → 再吃蛋白质 → 最后吃主食，可使餐后血糖峰值降低 15%–20%。\n\n## 三、分量控制\n每餐约 2/3 拳头主食 + 2 个拳头蔬菜 + 1/3 拳头肉类，七八分饱为宜。\n\n## 四、加餐建议\n两餐之间可选择低糖水果（苹果、柚子、草莓）或无糖酸奶，避免饥饿性低血糖。'
    },
    '运动指南': {
      title: '科学运动降血糖：从今天开始动起来',
      body: '## 一、运动类型\n有氧运动（快走、游泳、骑车）配合力量训练（深蹲、弹力带），效果最佳。\n\n## 二、时间安排\n饭后 1 小时运动较为适宜，每次 30–60 分钟，每周至少 150 分钟中等强度。\n\n## 三、注意事项\n运动前测血糖，低于 5.6 mmol/L 应先加餐；随身携带糖块以防低血糖。'
    },
    '生活习惯': {
      title: '被忽视的降糖细节：睡眠与情绪管理',
      body: '## 一、保证睡眠\n长期睡眠不足（<6 小时）会使 2 型糖尿病风险升高 2–3 倍，目标每晚 7–8 小时。\n\n## 二、情绪管理\n长期焦虑会使皮质醇升高、血糖波动，可通过音乐、冥想、瑜伽与社交缓解。\n\n## 三、戒烟限酒\n吸烟者心血管疾病风险高 2–3 倍；男性每日酒精 ≤25g，女性 ≤15g。'
    },
    '糖尿病科普': {
      title: '认识糖尿病：分型、症状与并发症',
      body: '## 一、主要分型\n1 型（胰岛素绝对缺乏，需终身注射）、2 型（最常见，胰岛素抵抗为主）、妊娠型、特殊型。\n\n## 二、典型症状\n"三多一少"：多饮、多食、多尿、体重下降；2 型起病隐匿，常无典型症状。\n\n## 三、并发症预防\n严格控制血糖、血压、血脂，每年筛查眼底、肾功能与足部。'
    }
  };

  /**
   * 生成健康资讯（离线兜底）：从内置知识库按标签取一篇并加上个性化前缀。
   * @param {Object} userInfo 用户信息
   * @param {string} tag 资讯标签
   * @returns {{tags, tag, article, source}}
   */
  function generateNews(userInfo, tag) {
    var tags = (global.DPA_SEED && global.DPA_SEED.NEWS_TAGS) || Object.keys(NEWS_BANK);
    var chosen = tag || tags[Math.floor(Math.random() * tags.length)];
    var tpl = NEWS_BANK[chosen] || NEWS_BANK['糖尿病科普'];
    var who = (userInfo && userInfo.username) ? userInfo.username + '，' : '';
    return {
      tags: tags,
      tag: chosen,
      article: {
        title: tpl.title,
        tags: [chosen],
        author: 'AI 健康助手',
        publish_time: new Date().toISOString().slice(0, 10),
        category: chosen,
        content: '## 面向' + who + '的个性化建议\n' + tpl.body + '\n\n> 温馨提示：以上内容基于糖尿病防治通用指南生成，仅供参考，具体方案请遵医嘱。'
      },
      source: 'local'
    };
  }

  /* ==================== 打卡分析 ==================== */

  /** 本地日期键；与 store.dateKey / ui.toDateKey 保持同一口径 */
  function localKey(d) {
    if (ui && typeof ui.toDateKey === 'function') return ui.toDateKey(d);
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /**
   * 打卡分析（三维指标）
   * @param {Array} planList  方案列表
   * @param {Array} punchList 打卡记录
   * @param {number} days     统计天数，默认 7
   * @param {Date}  anchorDate 统计锚点（窗口末日），默认当前时间。
   *                显式传入便于测试，也避免函数内部隐式依赖系统时钟。
   *
   * 【口径一致性】窗口日期、分子（已完成数）与分母（应完成数）全部限定在
   * 同一 days 窗口内，且一律使用**本地**日期键。早期实现用 UTC 生成窗口、
   * 却用本地日期写入打卡，导致 GMT+8 凌晨 00:00–08:00 当天打卡被漏计；
   * 同时类型完成率的分子取全量历史、分母取 7 天，会算出 >100% 的比率。
   */
  function analyzeCheckin(planList, punchList, days, anchorDate) {
    days = days || 7;
    var plans = planList || [];
    var punches = punchList || [];
    // 锚点支持 Date 或 'YYYY-MM-DD' 字符串，非法值回退到当前时间
    var anchor = anchorDate instanceof Date ? anchorDate : (anchorDate ? new Date(anchorDate) : new Date());
    if (isNaN(anchor.getTime())) anchor = new Date();
    var totalPlan = plans.length;

    /* 1. 窗口日期序列（本地日期键） */
    var windowDates = [];
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(anchor.getTime());
      d.setDate(d.getDate() - i);
      windowDates.push(localKey(d));
    }
    var inWindow = Object.create(null);
    windowDates.forEach(function (ds) { inWindow[ds] = true; });

    /* 2. 归集窗口内的已完成打卡（分子与分母同口径） */
    var doneByDate = Object.create(null);
    var dietDone = 0, exDone = 0;
    punches.forEach(function (p) {
      if (p.completion_status !== '已完成') return;
      var ds = p._date || localKey(new Date(p.punch_time));
      if (!inWindow[ds]) return;
      doneByDate[ds] = doneByDate[ds] || Object.create(null);
      doneByDate[ds][p._planId === undefined ? p.message : p._planId] = true;
      if (p.punch_type === '饮食') dietDone++;
      if (p.punch_type === '运动') exDone++;
    });

    var expected = totalPlan * days;
    var done = 0;
    var dayStats = windowDates.map(function (ds) {
      var cnt = doneByDate[ds] ? Object.keys(doneByDate[ds]).length : 0;
      done += cnt;
      return { date: ds, count: cnt, rate: totalPlan ? Math.min(1, cnt / totalPlan) : 0 };
    });
    var rate = expected ? done / expected : 0;

    /* 3. 连续打卡天数（自窗口末日向前） */
    var streak = 0;
    for (var j = dayStats.length - 1; j >= 0; j--) {
      if (dayStats[j].count > 0) streak++; else break;
    }

    /* 4. 类型均衡度 */
    var dietTotal = 0, exTotal = 0;
    plans.forEach(function (p) {
      if (p.type === '饮食') dietTotal++;
      if (p.type === '运动') exTotal++;
    });
    function clamp01(n) { return Math.max(0, Math.min(1, n)); }
    var dietRate = (dietTotal * days) ? clamp01(dietDone / (dietTotal * days)) : 0;
    var exRate = (exTotal * days) ? clamp01(exDone / (exTotal * days)) : 0;
    var balance = Math.min(dietRate, exRate);

    var C = CFG.CHECKIN;
    var evaluation = rate >= C.excellent ? '优秀' : (rate >= C.good ? '良好' : '需改进');

    var suggestions = [];
    if (rate < C.good) suggestions.push('近一周打卡完成率偏低，建议设定固定的打卡提醒时间，从每天完成 1–2 项开始逐步养成习惯。');
    if (dietRate < exRate - 0.15) suggestions.push('饮食打卡明显少于运动，建议加强三餐的规律记录与控糖执行。');
    if (exRate < dietRate - 0.15) suggestions.push('运动打卡偏少，建议增加饭后散步等低门槛运动。');
    if (streak >= 3) suggestions.push('已连续打卡 ' + streak + ' 天，请继续保持，形成稳定的健康节律。');
    if (!suggestions.length) suggestions.push('各项完成情况良好，建议维持当前节奏，并根据身体反馈微调方案。');

    var ratePct = Math.round(clamp01(rate) * 100);
    return {
      days: days,
      totalPlan: totalPlan,
      expected: expected,
      done: done,
      rate: ratePct,
      streak: streak,
      dietRate: Math.round(dietRate * 100),
      exerciseRate: Math.round(exRate * 100),
      balance: Math.round(balance * 100),
      dayStats: dayStats,
      evaluation: evaluation,
      completionStatus: '近 ' + days + ' 天共应完成 ' + expected + ' 项，实际完成 ' + done + ' 项，完成率 ' + ratePct + '%',
      suggestions: suggestions,
      source: 'local'
    };
  }

  /* ==================== 聊天类回复 ==================== */

  var DOCTOR_RULES = [
    { k: ['1型', '一型', '1 型'], a: '1 型糖尿病是自身免疫性疾病，胰岛β细胞被破坏导致胰岛素绝对缺乏，**必须终身注射胰岛素**。\n\n日常管理要点：\n- 每日监测血糖 4–7 次\n- 运动前测血糖，低于 5.6 mmol/L 先加餐\n- 保证充足优质蛋白摄入\n- 随身携带糖块以备低血糖急救' },
    { k: ['2型', '二型', '2 型'], a: '2 型糖尿病以胰岛素抵抗为主，占糖尿病总数 90% 以上。\n\n核心干预措施：\n- 控制主食量，每餐七八分饱，减重 5%–10%\n- 每周 150 分钟中等强度有氧运动 + 2–3 次力量训练\n- 每 3–6 个月查血脂，每 1–3 个月测血压\n- 保证每晚 7–8 小时睡眠' },
    { k: ['饮食', '吃什么', '食谱', '吃'], a: '糖尿病饮食的核心是**控糖控量、均衡营养**：\n\n1. 主食粗细搭配（糙米、燕麦、杂豆替代部分白米白面）\n2. 进食顺序：蔬菜 → 蛋白质 → 主食，可降低餐后血糖 15%–20%\n3. 每餐约 2/3 拳头主食 + 2 个拳头蔬菜 + 1/3 拳头肉类\n4. 加餐选低糖水果或无糖酸奶\n5. 严格限制添加糖与含糖饮料' },
    { k: ['运动', '锻炼', '跑步', '健身'], a: '推荐**有氧 + 力量**组合运动：\n\n- 有氧：快走、游泳、骑车，每周 ≥150 分钟\n- 力量：深蹲、俯卧撑、弹力带，每周 2–3 次\n- 时间：饭后 1 小时，每次 30–60 分钟\n- 注意：运动前测血糖，低于 5.6 mmol/L 先加餐' },
    { k: ['血糖', '监测', '测血糖'], a: '血糖监测频率因分型而异：\n\n- **1 型**：每日 4–7 次（空腹、三餐后、睡前）\n- **2 型**：稳定期每周 2–4 次\n- **妊娠型**：每日监测，含三餐后 1 或 2 小时\n\n同时每 3–6 个月查血脂，每 1–3 个月测血压。' },
    { k: ['妊娠', '怀孕', '孕妇'], a: '妊娠糖尿病管理要点：\n\n- 每日监测血糖，包括空腹与三餐后\n- 运动避免空腹，选散步、孕妇瑜伽等温和方式\n- 保证优质蛋白摄入，满足自身与胎儿需求\n- 产后 6–12 周复查 OGTT\n- 孕期血糖控制目标更严格，须遵医嘱' },
    { k: ['睡眠', '失眠', '作息'], a: '长期睡眠不足（<6 小时）会使 2 型糖尿病风险升高 2–3 倍。\n\n改善建议：\n- 固定作息时间\n- 睡前 1 小时避免电子设备\n- 保持卧室黑暗、安静、温度适宜\n- 可通过冥想、深呼吸、温水浴放松' },
    { k: ['并发症', '肾病', '眼底', '视网膜', '足'], a: '糖尿病主要慢性并发症包括心血管疾病、肾病、视网膜病变、神经病变与糖尿病足。\n\n预防措施：\n1. 严格控糖（关注糖化血红蛋白）\n2. 同步管理血压血脂\n3. 戒烟限酒\n4. 每年至少筛查一次眼底、肾功能与足部' }
  ];

  /**
   * 医师咨询回复（离线兜底）：按关键词规则匹配命中则返回预置建议，
   * 未命中返回一份通用的综合建议。
   * @param {string} query 用户提问
   * @param {Object} doctor 医生信息（可选，用于署名）
   * @returns {string} 回复文本（Markdown）
   */
  function doctorReply(query, doctor) {
    var q = String(query || '');
    for (var i = 0; i < DOCTOR_RULES.length; i++) {
      var r = DOCTOR_RULES[i];
      for (var j = 0; j < r.k.length; j++) {
        if (q.indexOf(r.k[j]) >= 0) {
          return (doctor ? '【' + doctor.doctor_name + ' ' + doctor.title + '】\n\n' : '') + r.a +
            '\n\n> 以上建议基于糖尿病防治通用指南，具体诊疗请以线下就诊为准。';
        }
      }
    }
    return '您好，我是' + (doctor ? doctor.doctor_name : '在线医师') + '。针对您的问题，建议从以下几个方面关注：\n\n' +
      '1. **饮食**：主食粗细搭配，进食顺序为蔬菜→蛋白→主食\n' +
      '2. **运动**：饭后 1 小时快走 30 分钟，每周 5 次以上\n' +
      '3. **监测**：定期检测血糖、血压、血脂\n' +
      '4. **作息**：保证每晚 7–8 小时睡眠，戒烟限酒\n\n' +
      '您可以进一步说明具体症状或指标（如空腹血糖、糖化血红蛋白数值），我会给出更有针对性的建议。\n\n' +
      '> 本回答仅供参考，不能替代面诊。';
  }

  var ASSISTANT_RULES = [
    { k: ['方案', '计划', '定制'], a: '我可以帮您制定或调整生活方案。当前系统已为您准备了**饮食**与**运动**两大类方案。\n\n您可以告诉我：\n- 您的糖尿病类型（1 型 / 2 型 / 妊娠型）\n- 目前的生活习惯（作息、饮食偏好、运动基础）\n- 您的具体需求（如减重、控糖、增肌）\n\n我会据此生成更贴合您的方案。您也可以直接前往「生活方案」页面查看与定制。' },
    { k: ['信息', '资料', '修改', '设置'], a: '您可以在**个人中心 → 编辑资料**中修改个人信息（用户名、手机号、年龄、性别、糖尿病类型）。\n\n如果您希望我直接帮您更新，可以告诉我具体要修改的内容，例如："把我的年龄改成 45 岁"。' },
    { k: ['打卡', '记录'], a: '打卡功能在「生活方案」页面：勾选已完成的方案项即完成打卡。\n\n在**个人中心 → 打卡记录**中，可以看到近 7 天的打卡情况、完成率与智能分析建议。' },
    { k: ['风险', '预测', '评估'], a: '您可以前往「风险预测」页面填写个人信息（年龄、身高、体重、腰围、家族史、血压等），系统会基于中国糖尿病风险评分量表给出风险等级、概率与个性化建议。\n\n需要注意：结果仅供健康筛查参考，不能替代临床诊断。' }
  ];

  /**
   * AI 助手回复（离线兜底）：按助手规则匹配，未命中回退到医生知识库。
   * @param {string} query 用户提问
   * @returns {string} 回复文本（Markdown）
   */
  function assistantReply(query) {
    var q = String(query || '');
    for (var i = 0; i < ASSISTANT_RULES.length; i++) {
      var r = ASSISTANT_RULES[i];
      for (var j = 0; j < r.k.length; j++) {
        if (q.indexOf(r.k[j]) >= 0) return ASSISTANT_RULES[i].a;
      }
    }
    // 兜底走医生知识库
    return '我是您的糖尿病健康助手，可以帮您：\n\n' +
      '1. **糖尿病科普**：分型、症状、并发症\n' +
      '2. **生活方案**：饮食与运动建议、方案定制\n' +
      '3. **信息管理**：查询与修改个人健康信息\n' +
      '4. **打卡分析**：解读您的打卡记录\n\n' +
      '您可以直接提问，例如："2 型糖尿病应该怎么吃？"\n\n' + doctorReply(q, null);
  }

  /* ==================== 管理助手指令 ==================== */

  /**
   * 管理助手指令解析（离线兜底）：识别统计/用户/文章/删除/新增/导出等指令，
   * 返回含 action / reply / refresh 的操作对象，破坏性操作交由 UI 二次确认。
   * @param {string} query 用户指令文本
   * @returns {Object} 操作响应对象
   */
  function adminCommand(query) {
    var q = String(query || '');
    var store = global.DPA.store;
    var s = store.stats();

    if (/统计|总览|概况|多少/.test(q)) {
      return {
        action: 'stats',
        reply: '**系统数据总览**\n\n- 注册用户：' + s.users + ' 人\n- 科普文章：' + s.articles + ' 篇\n- 生活方案：' + s.plans + ' 条\n- 打卡记录：' + s.punch + ' 条\n- 收藏记录：' + s.collections + ' 条\n- 风险预测记录：' + s.riskRecords + ' 条',
        refresh: true
      };
    }
    if (/用户/.test(q)) {
      var users = store.users.all().map(function (u) {
        return '- ' + u.username + '（' + (u.role === 'admin' ? '管理员' : '普通用户') + '）';
      }).join('\n');
      return { action: 'list_users', reply: '**用户列表（共 ' + s.users + ' 人）**\n\n' + users, refresh: true };
    }
    if (/文章|资讯/.test(q)) {
      var arts = store.articles.all().slice(0, 10).map(function (a) {
        return '- [' + a.category + '] ' + a.title + '（阅读 ' + a.views + '）';
      }).join('\n');
      return { action: 'list_articles', reply: '**文章列表（共 ' + s.articles + ' 篇，显示前 10）**\n\n' + arts, refresh: true };
    }
    if (/删除.*文章|清理文章/.test(q)) {
      // 支持一次删除多篇（"删除文章 3 和 5"），并做去重
      var ids = [];
      var re = /\d+/g;
      var mm;
      while ((mm = re.exec(q)) !== null) ids.push(Number(mm[0]));
      ids = ids.filter(function (id, i) { return ids.indexOf(id) === i; });

      if (!ids.length) {
        return { action: 'need_id', reply: '请指明要删除的文章 ID，例如："删除文章 3"。' };
      }
      var exist = ids.filter(function (id) { return !!store.articles.get(id); });
      if (!exist.length) {
        return { action: 'delete_articles', ids: [], reply: '未找到 ID 为 ' + ids.join('、') + ' 的文章，请核对后重试。', refresh: false };
      }
      // 破坏性操作**不**在本地引擎里直接执行，交由 UI 层二次确认
      var titles = exist.map(function (id) {
        return '- ID ' + id + '《' + store.articles.get(id).title + '》';
      });
      return {
        action: 'delete_articles',
        ids: exist,
        reply: '即将删除 ' + exist.length + ' 篇文章：\n\n' + titles.join('\n') + '\n\n请确认后执行。',
        refresh: false
      };
    }
    if (/新增|添加|创建/.test(q) && /文章/.test(q)) {
      var art = store.articles.add({
        title: '（管理员新增）糖尿病健康提示',
        content: '## 提示\n本文章由 AI 管理助手创建，可在管理页面编辑内容。',
        category: '糖尿病科普'
      });
      return { action: 'add_article', reply: '已新增文章：**' + art.title + '**（ID=' + art.article_id + '）。', refresh: true };
    }
    if (/备份|导出/.test(q)) {
      return { action: 'export', reply: '已生成数据快照。当前共 ' + s.users + ' 名用户、' + s.articles + ' 篇文章。可点击下方「导出数据」下载 JSON。', refresh: false };
    }
    return {
      action: 'unknown',
      reply: '我可以帮您管理平台数据，支持以下指令：\n\n' +
        '- "统计系统数据" / "数据总览"\n- "查看用户列表"\n- "查看文章列表"\n- "新增一篇文章"\n- "删除文章 3"\n- "导出数据"\n\n请用自然语言告诉我您的需求。',
      refresh: false
    };
  }

  global.DPA = global.DPA || {};
  global.DPA.mock = {
    predictRisk: predictRisk,
    generateLifePlan: generateLifePlan,
    generateNews: generateNews,
    analyzeCheckin: analyzeCheckin,
    doctorReply: doctorReply,
    assistantReply: assistantReply,
    adminCommand: adminCommand
  };
})(window);
