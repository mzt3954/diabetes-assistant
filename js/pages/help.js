/**
 * pages/help.js — 帮助中心
 * =========================
 * 功能：FAQ 常见问题列表（可展开折叠）、使用指南入口跳转、系统信息
 *      （版本号与在线/离线模式）展示。
 * 交互模块：DPA.ui(渲染/转义)、DPA_CONFIG(应用配置)，无数据请求。
 */
// IIFE 隔离作用域；未登录先跳登录页。
(function () {
  'use strict';

  if (!DPA.auth.requireAuth()) return;

  var ui = DPA.ui;

  ui.renderNavbar('');
  ui.renderBottomNav('personal');

  var FAQ = [
    {
      q: '风险预测的结果准确吗？能代替医生诊断吗？',
      a: '风险预测基于中国糖尿病风险评分（CDRS）量表的变量集，通过年龄、BMI、腰围、家族史、血压等指标加权计算，用于**风险筛查与健康提示**。它不能替代临床诊断——确诊需要空腹血糖、糖化血红蛋白或口服葡萄糖耐量试验（OGTT）等检查。若评估为高风险，请及时就医。'
    },
    {
      q: 'AI 助手的回答可靠吗？',
      a: 'AI 助手基于 DeepSeek 大模型与糖尿病专业医学知识库（RAG）生成回答，知识来源为糖尿病防治指南与专业文献。但由于大模型存在幻觉可能，回答仅供科普参考，涉及用药、剂量、治疗方案等决策必须咨询专业医师。'
    },
    {
      q: '我的健康数据会泄露吗？',
      a: '**离线模式下**：所有个人数据（健康信息、打卡记录、聊天记录）均保存在您本机浏览器的 localStorage 中，不会上传到任何服务器；清除浏览器数据会同时清除这些记录。\n\n**在线模式下**：风险预测输入、生活方案需求、打卡数据与聊天内容会发送至所配置的 Dify 服务用于生成结果，不再局限于本机。\n\n正式部署版本建议接入服务端数据库并启用加密、鉴权与访问审计。'
    },
    {
      q: '为什么有时候提示"离线演示模式"？',
      a: '系统支持双模式运行：当未配置 Dify 服务地址与 API Key，或 Dify 服务不可用时，会自动降级为本地智能引擎（规则评分 + 模板生成），保证功能可用。配置 Dify 后即切换为真实大模型能力。'
    },
    {
      q: '如何切换糖尿病类型查看不同内容？',
      a: '在首页点击「糖尿病类型」区域的卡片，进入类型详情页后，顶部提供 1 型 / 2 型 / 妊娠型 / 特殊型四个标签，可自由切换查看病因、临床表现、治疗原则与生活注意事项。'
    },
    {
      q: '打卡数据是怎么分析的？',
      a: '系统从三个维度分析近 7 天打卡：① 完成率 = 实际打卡项 / 应打卡项；② 连续打卡天数；③ 类型均衡度 = 饮食与运动完成率的较小值。综合得出"优秀 / 良好 / 需改进"评级，并给出针对性改进建议。'
    },
    {
      q: '管理员和普通用户有什么区别？',
      a: '普通用户可使用风险预测、生活方案、打卡、资讯、AI 助手与个人中心全部功能。管理员在此基础上额外拥有「AI 智能管理」入口，可通过自然语言指令查看统计数据、管理用户与文章、导出数据。'
    },
    {
      q: '如何自定义生活方案？',
      a: '进入「生活方案」页面，点击底部「定制方案」，填写当前生活习惯（如久坐、三餐不规律）与您的期望（如希望减重），系统会结合您的风险等级生成更贴合需求的饮食与运动方案。'
    }
  ];

  // 渲染 FAQ 列表：#faqList 逐条生成问题/答案卡片
  var host = document.getElementById('faqList');
  host.innerHTML = FAQ.map(function (item, i) {
    return '<div class="faq-item" data-index="' + i + '">' +
      '<div class="faq-question">' +
        '<span>' + ui.escapeHtml(item.q) + '</span>' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>' +
      '</div>' +
      '<div class="faq-answer"><div class="faq-answer-inner">' + ui.renderMarkdown(item.a) + '</div></div>' +
    '</div>';
  }).join('');

  // FAQ 折叠交互：点击问题标题切换其父项 .open 展开/收起
  host.addEventListener('click', function (e) {
    var q = e.target.closest('.faq-question');
    if (!q) return;
    q.parentElement.classList.toggle('open');
  });

  /* 使用指南跳转 */
  // 所有带 data-href 的菜单项点击后跳转对应页面
  document.querySelectorAll('.menu-item[data-href]').forEach(function (item) {
    item.addEventListener('click', function () { location.href = item.dataset.href; });
  });

  /* 系统信息 */
  // 展示应用版本与在线/离线运行模式
  document.getElementById('versionText').textContent = DPA_CONFIG.app.version;
  document.getElementById('modeText').textContent = DPA_CONFIG.isOnline()
    ? '在线模式（已接入 Dify）'
    : '离线演示模式（本地智能引擎）';
})();
