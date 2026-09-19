/**
 * design-solo/js/charts.js — 纯内联 SVG + CSS 数据可视化辅助
 * 设计迭代 2：为零依赖静态站提供趋势折线、进度环形图、浏览量条形图。
 * 颜色全部取自 CSS 设计令牌，禁止任何外部库或 CDN。
 */
(function (global) {
  'use strict';

  var doc = document;

  /** 读取 CSS 自定义属性（设计令牌）值，读取失败时回退到 fallback */
  function cssVar(name, fallback) {
    try {
      var v = getComputedStyle(doc.documentElement).getPropertyValue(name);
      v = (v || '').trim();
      return v || fallback;
    } catch (e) {
      return fallback;
    }
  }

  /** HTML 转义，防止标签/IP 注入 */
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  var uidCounter = 0;
  /** 生成页内唯一 id（前缀 + 自增计数），用于 SVG 渐变等需引用元素 */
  function uid(prefix) {
    uidCounter++;
    return 'dpa-' + prefix + '-' + uidCounter;
  }

  /* ---------- 趋势折线 ---------- */
  /**
   * 渲染趋势折线图（内联 SVG + 渐变面积），按容器实际宽度自适应。
   * @param {string|Element} selector 容器选择器或 DOM 元素
   * @param {Array} data 数据点数组 [{label, value}]
   * @param {Object} [opts] 配置 {title 图表标题}
   */
  function trendLine(selector, data, opts) {
    opts = opts || {};
    var container = typeof selector === 'string' ? doc.querySelector(selector) : selector;
    if (!container) return;
    if (!data || !data.length) {
      container.innerHTML = '<div class="empty-state" style="padding:24px"><div class="empty-state-desc">暂无趋势数据</div></div>';
      return;
    }

    var title = opts.title || '趋势分析';
    // 按容器实际宽度渲染：SVG 的 viewBox 与实际显示尺寸 1:1，避免被整体放大
    // （否则坐标轴文字会随图形一起缩放，在宽屏上被拉到几十像素高）
    var cw = container.clientWidth || 0;
    var W = Math.max(260, Math.round((cw > 80 ? cw : 360) - 34));
    var H = W < 480 ? 150 : 180;
    var PAD = W < 480 ? 22 : 28;
    var gradId = uid('trendGrad');
    var primary = cssVar('--primary', '#2563eb');
    var primarySoft = cssVar('--primary-soft', '#eff6ff');

    var values = data.map(function (d) { return Number(d.value) || 0; });
    var max = Math.max.apply(null, values);
    var min = Math.min.apply(null, values);
    var range = max - min;
    if (range === 0) { max = max + 1; min = min - 1; range = max - min; }
    min = Math.max(0, min - range * 0.1);
    max = max + range * 0.1;
    range = max - min;

    function x(i) {
      return data.length === 1 ? W / 2 : PAD + (W - PAD * 2) * i / (data.length - 1);
    }
    function y(v) {
      return H - PAD - ((v - min) / range) * (H - PAD * 2);
    }

    var points = data.map(function (d, i) { return [x(i), y(d.value)]; });
    var polyline = points.map(function (p) { return p.join(','); }).join(' ');
    var areaPath = points.map(function (p, i) {
      return (i === 0 ? 'M ' : 'L ') + p[0] + ' ' + p[1];
    }).join(' ') + ' L ' + points[points.length - 1][0] + ' ' + (H - PAD) + ' L ' + points[0][0] + ' ' + (H - PAD) + ' Z';

    var gridLines = '';
    for (var i = 0; i < 5; i++) {
      var gy = PAD + (H - PAD * 2) * i / 4;
      gridLines += '<line class="trend-grid" x1="' + PAD + '" y1="' + gy + '" x2="' + (W - PAD) + '" y2="' + gy + '"/>';
    }

    var axisLabels = data.map(function (d, i) {
      return '<text class="trend-axis" x="' + x(i) + '" y="' + (H - 6) + '">' + escapeHtml(d.label) + '</text>';
    }).join('');

    var dots = points.map(function (p) {
      return '<circle class="trend-dot" cx="' + p[0] + '" cy="' + p[1] + '" r="4"/>';
    }).join('');

    container.innerHTML =
      '<div class="trend-chart">' +
        '<div class="trend-chart-title">' + escapeHtml(title) + '</div>' +
        '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">' +
          '<defs>' +
            '<linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">' +
              '<stop offset="0%" stop-color="' + primary + '" stop-opacity="0.35"/>' +
              '<stop offset="100%" stop-color="' + primarySoft + '" stop-opacity="0"/>' +
            '</linearGradient>' +
          '</defs>' +
          gridLines +
          '<path class="trend-area" d="' + areaPath + '" style="fill:url(#' + gradId + ')"/>' +
          '<polyline class="trend-line" points="' + polyline + '"/>' +
          dots +
          axisLabels +
        '</svg>' +
      '</div>';

    if (!container.__dpaTrendBound) {
      container.__dpaTrendBound = true;
      var rt;
      window.addEventListener('resize', function () {
        clearTimeout(rt);
        rt = setTimeout(function () {
          if (doc.body && doc.body.contains(container)) trendLine(container, data, opts);
        }, 200);
      });
    }
  }

  /* ---------- 进度环形图 ---------- */
  /**
   * 渲染进度环形图（SVG 圆环 + 中心百分比）。
   * @param {string|Element} selector 容器选择器或 DOM 元素
   * @param {number} percent 完成百分比（0–100）
   * @param {Object} [opts] 配置 {title, label, color(CSS 变量名)}
   */
  function progressRing(selector, percent, opts) {
    opts = opts || {};
    var container = typeof selector === 'string' ? doc.querySelector(selector) : selector;
    if (!container) return;

    var title = opts.title || '完成度';
    var colorVar = opts.color || '--primary';
    var color = cssVar(colorVar, '#2563eb');
    var track = cssVar('--chart-track', '#e2e8f0');
    var size = 120, r = 52, sw = 10;
    var c = 2 * Math.PI * r;
    var pct = Math.max(0, Math.min(100, Number(percent) || 0));
    var offset = c * (1 - pct / 100);

    container.innerHTML =
      '<div class="ring-card">' +
        '<div class="ring-card-title">' + escapeHtml(title) + '</div>' +
        '<div class="ring-chart">' +
          '<svg viewBox="0 0 ' + size + ' ' + size + '">' +
            '<circle class="ring-track" cx="' + (size / 2) + '" cy="' + (size / 2) + '" r="' + r + '"/>' +
            '<circle class="ring-fill" cx="' + (size / 2) + '" cy="' + (size / 2) + '" r="' + r + '" ' +
              'stroke="' + color + '" stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + offset.toFixed(2) + '"/>' +
          '</svg>' +
          '<div class="ring-text">' +
            '<div class="ring-value">' + Math.round(pct) + '%</div>' +
            '<div class="ring-label">' + escapeHtml(opts.label || '完成') + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* ---------- 浏览量条形图 ---------- */
  /**
   * 渲染浏览量横向条形图（纯 CSS 条宽）。
   * @param {string|Element} selector 容器选择器或 DOM 元素
   * @param {Array} data 数据数组 [{label, value}]
   * @param {Object} [opts] 配置 {title}
   */
  function barChart(selector, data, opts) {
    opts = opts || {};
    var container = typeof selector === 'string' ? doc.querySelector(selector) : selector;
    if (!container) return;
    if (!data || !data.length) {
      container.innerHTML = '<div class="empty-state" style="padding:24px"><div class="empty-state-desc">暂无数据</div></div>';
      return;
    }

    var title = opts.title || '浏览量排行';
    var max = Math.max.apply(null, data.map(function (d) { return Number(d.value) || 0; })) || 1;

    var rows = data.map(function (d) {
      var w = Math.max(0, Math.min(100, Math.round((Number(d.value) || 0) / max * 100)));
      return '<div class="bar-chart-row">' +
        '<div class="bar-chart-label" title="' + escapeHtml(d.label) + '">' + escapeHtml(d.label) + '</div>' +
        '<div class="bar-chart-track"><div class="bar-chart-fill" style="width:' + w + '%"></div></div>' +
        '<div class="bar-chart-value">' + escapeHtml(String(d.value)) + '</div>' +
      '</div>';
    }).join('');

    container.innerHTML =
      '<div class="bar-chart">' +
        '<div class="bar-chart-title">' + escapeHtml(title) + '</div>' +
        rows +
      '</div>';
  }

  global.DPA = global.DPA || {};
  global.DPA.charts = {
    trendLine: trendLine,
    progressRing: progressRing,
    barChart: barChart
  };
})(window);
