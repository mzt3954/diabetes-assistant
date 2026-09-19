/**
 * pages/risk.js — 个人信息与糖尿病风险预测
 * ==========================================
 * 功能：填写健康信息 → 校验 → 提交风险预测 → 四段式结果展示；含性别联动、
 *      BMI 实时计算、历史记录与上次填写回填。
 * 流程：填写信息 → 校验 → 调用 WF-2 / 本地 CDRS 引擎 → 结果四段式展示
 *     （评分·分档·归因·建议）。
 * 交互模块：DPA.ui(校验/渲染/主题变量/提示)、DPA.store.risk(保存/历史)、
 *          DPA.api.predictRisk(云端预测，失败降级本地)。
 */
// IIFE 隔离作用域；未登录先跳登录页。
(function () {
  'use strict';

  if (!DPA.auth.requireAuth()) return;

  var ui = DPA.ui;
  var store = DPA.store;
  var api = DPA.api;

  ui.renderNavbar('');
  ui.renderBottomNav('personal');

  var form = document.getElementById('riskForm');
  var resultArea = document.getElementById('resultArea');
  var submitBtn = document.getElementById('submitBtn');

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- 性别联动：男性隐藏妊娠选项 ---------- */
  // 性别切换：女性显示妊娠项，男性隐藏并清空妊娠选择
  $('sex').addEventListener('change', function () {
    $('pregnancyGroup').style.display = this.value === '女' ? '' : 'none';
    if (this.value !== '女') $('isPregnancy').value = '无';
  });
  $('pregnancyGroup').style.display = 'none';

  /* ---------- BMI 实时计算 ---------- */
  /**
   * 根据身高体重实时计算 BMI 并填充到显示框，附带正常/超重/肥胖分档。
   * @returns {void} 无返回值
   */
  function calcBmi() {
    var h = Number($('height').value);
    var w = Number($('weight').value);
    if (h > 0 && w > 0) {
      var bmi = w / Math.pow(h / 100, 2);
      $('bmiDisplay').value = bmi.toFixed(1) + '  ' + (bmi < 24 ? '（正常）' : bmi < 28 ? '（超重）' : '（肥胖）');
    } else {
      $('bmiDisplay').value = '';
    }
  }
  $('height').addEventListener('input', calcBmi);
  $('weight').addEventListener('input', calcBmi);

  /* ---------- 校验规则 ---------- */
  /**
   * 校验表单各字段是否合法（年龄/性别/身高/体重/腰围/收缩压等范围校验）。
   * @returns {boolean} 全部通过返回 true，否则为 false
   */
  function validateForm() {
    return ui.validate({
      age: [ui.validators.required, ui.validators.range(1, 120, '年龄')],
      sex: [ui.validators.required],
      height: [ui.validators.required, ui.validators.range(80, 250, '身高')],
      weight: [ui.validators.required, ui.validators.range(20, 300, '体重')],
      waistline: [ui.validators.range(40, 200, '腰围')],
      systolicPressure: [ui.validators.range(60, 260, '收缩压')]
    });
  }

  /* ---------- 结果渲染 ---------- */
  var LEVEL_CLASS = { '低风险': 'low', '中风险': 'mid', '高风险': 'high' };
  // 颜色统一取自 CSS 设计令牌，避免在 JS 中重复硬编码主题色
  var LEVEL_COLOR = {
    '低风险': ui.themeVar('--risk-low', '#4CAF50'),
    '中风险': ui.themeVar('--risk-mid', '#FF9800'),
    '高风险': ui.themeVar('--risk-high', '#F44336')
  };
  var TRACK_COLOR = ui.themeVar('--chart-track', '#EEF2F7');

  /**
   * 生成环形仪表盘（gauge）SVG HTML，按百分比展示风险概率。
   * @param {number} percent 风险概率百分比
   * @param {string} color 主题色
   * @returns {string} 仪表盘 HTML 字符串
   */
  function gauge(percent, color) {
    var r = 62, c = 2 * Math.PI * r;
    var offset = c * (1 - percent / 100);
    return '<div class="risk-gauge">' +
      '<svg width="150" height="150" viewBox="0 0 150 150">' +
        '<circle cx="75" cy="75" r="' + r + '" fill="none" stroke="' + TRACK_COLOR + '" stroke-width="12"/>' +
        '<circle cx="75" cy="75" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="12" ' +
          'stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + offset.toFixed(1) + '"/>' +
      '</svg>' +
      '<div class="risk-gauge-text">' +
        '<div class="risk-gauge-score" style="color:' + color + '">' + percent + '%</div>' +
        '<div class="risk-gauge-label">风险概率</div>' +
      '</div>' +
    '</div>';
  }

  /**
   * 渲染风险预测结果：仪表盘、等级、评分/BMI 信息、风险因子、个性化建议与免责声明。
   * @param {Object} res 预测结果对象（level/probability/factors/advice 等）
   * @param {Object} input 提交时收集的用户输入
   * @returns {void} 无返回值
   */
  function renderResult(res, input) {
    var level = res.level || '低风险';
    var cls = LEVEL_CLASS[level] || 'low';
    var color = LEVEL_COLOR[level] || '#4CAF50';

    var factors = (res.factors || []).map(function (f) {
      return '<span class="tag tag-warning">' + ui.escapeHtml(f) + '</span>';
    }).join('');

    var advice = (res.advice || []).map(function (a, i) {
      return '<div class="risk-advice-item"><span class="risk-advice-num">' + (i + 1) + '</span><span>' + ui.escapeHtml(a) + '</span></div>';
    }).join('');

    resultArea.className = '';
    resultArea.innerHTML =
      '<div class="risk-result">' +
        gauge(res.probability || 0, color) +
        '<div class="risk-level ' + cls + '">' + ui.escapeHtml(level) + '</div>' +
        '<p class="risk-message">' + ui.escapeHtml(res.message || '') + '</p>' +
        '<p class="text-sm text-muted mt-sm">风险评分：' + (res.score || 0) + ' / ' + (res.maxScore || 27) +
          '　·　BMI：' + (res.bmi || '-') + '　·　风险倾向：' + ui.escapeHtml(res.riskType || '-') + '</p>' +
        (factors ? '<div class="risk-factors">' + factors + '</div>' : '') +
      '</div>' +
      '<div class="risk-advice">' +
        '<h3 class="risk-section-title">个性化建议</h3>' +
        (advice || '<p class="text-muted text-sm">暂无建议</p>') +
      '</div>' +
      '<div class="disclaimer mb-lg">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>' +
        '<span>本结果基于糖尿病风险评分量表筛查，仅供健康参考，<strong>不能替代临床诊断</strong>。如评估为高风险，请尽快前往内分泌科就诊。</span>' +
      '</div>' +
      '<div class="flex gap-md mb-lg">' +
        '<button class="btn btn-outline flex-1" id="reAssess">重新评估</button>' +
        '<a class="btn btn-primary flex-1" href="life-plan.html">查看生活方案</a>' +
      '</div>';

    $('reAssess').addEventListener('click', function () {
      resultArea.classList.add('hidden');
      form.classList.remove('hidden');
      resultArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    resultArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- 提交 ---------- */
  /**
   * 收集表单各字段为一个用户输入对象。
   * @returns {Object} 包含年龄/性别/身高/体重/腰围/血压/家族史/妊娠/疾病等字段
   */
  function collect() {
    return {
      age: Number($('age').value),
      sex: $('sex').value,
      height: Number($('height').value),
      weight: Number($('weight').value),
      waistline: Number($('waistline').value) || 0,
      systolicPressure: Number($('systolicPressure').value) || 0,
      familyHistory: $('familyHistory').value,
      isPregnancy: $('isPregnancy').value,
      disease: $('disease').value
    };
  }

  // 表单提交：校验 → 加载态 → 调用 api.predictRisk → 保存结果并渲染结果/历史
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!validateForm()) {
      ui.toast('请检查表单填写', 'error');
      return;
    }

    var input = collect();
    var label = submitBtn.querySelector('.btn-text');
    var spinner = submitBtn.querySelector('.loading-spinner');
    submitBtn.disabled = true;
    label.textContent = '评估中...';
    spinner.classList.remove('hidden');

    api.predictRisk(input).then(function (res) {
      submitBtn.disabled = false;
      label.textContent = '开始评估';
      spinner.classList.add('hidden');

      store.risk.save(Object.assign({}, input, res));
      form.classList.add('hidden');
      renderResult(res, input);
      renderHistory();
      ui.toast('评估完成');
    }).catch(function (err) {
      submitBtn.disabled = false;
      label.textContent = '开始评估';
      spinner.classList.add('hidden');
      ui.toast('评估失败：' + (err.message || '请稍后重试'), 'error');
    });
  });

  /* ---------- 重置 ---------- */
  // 重置按钮：清空表单、隐藏妊娠项与校验错误样式
  document.getElementById('resetBtn').addEventListener('click', function () {
    form.reset();
    $('pregnancyGroup').style.display = 'none';
    $('bmiDisplay').value = '';
    document.querySelectorAll('.form-error').forEach(function (e) { e.textContent = ''; e.classList.remove('show'); });
    document.querySelectorAll('.form-input, .form-select').forEach(function (e) { e.classList.remove('error'); });
  });

  /* ---------- 历史记录 ---------- */
  /**
   * 渲染历史评估记录列表（新到旧取前 6 条，含日期、年龄、BMI 与等级标签）。
   * @returns {void} 无返回值
   */
  function renderHistory() {
    var list = store.risk.history().slice().reverse();
    var host = $('historyList');
    if (!list.length) {
      host.innerHTML = '<p class="text-muted text-sm">暂无历史评估记录</p>';
      return;
    }
    host.innerHTML = list.slice(0, 6).map(function (r) {
      var cls = LEVEL_CLASS[r.level] || 'low';
      return '<div class="risk-history-item">' +
        '<span>' + ui.escapeHtml(ui.formatDate(r.create_time)) + '　<span class="text-muted">' +
          ui.escapeHtml(String(r.age == null ? '-' : r.age)) + '岁 · BMI ' + ui.escapeHtml(String(r.bmi || '-')) + '</span></span>' +
        '<span class="risk-level ' + cls + '" style="padding:2px 10px;font-size:12px;margin:0">' + ui.escapeHtml(r.level || '-') + '</span>' +
      '</div>';
    }).join('');
  }

  /* ---------- 回填上次填写 ---------- */
  // 首次进入回填上次评估数据，并重新计算 BMI
  (function prefill() {
    var last = store.risk.latest();
    if (!last) return;
    ['age', 'height', 'weight', 'waistline', 'systolicPressure'].forEach(function (k) {
      if (last[k]) $(k).value = last[k];
    });
    if (last.sex) { $('sex').value = last.sex; $('sex').dispatchEvent(new Event('change')); }
    if (last.familyHistory) $('familyHistory').value = last.familyHistory;
    if (last.disease) $('disease').value = last.disease;
    calcBmi();
  })();

  // 初始渲染历史记录列表
  renderHistory();
})();
