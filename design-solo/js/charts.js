/**
 * design-solo/js/charts.js — 纯内联 SVG + CSS 数据可视化辅助
 * 设计迭代 2：为零依赖静态站提供趋势折线、进度环形图、浏览量条形图。
 * 颜色全部取自 CSS 设计令牌，禁止任何外部库或 CDN。
 */
(function (global) {
  'use strict';

  var doc = document;

  function cssVar(name, fallback) {
    try {
      var v = getComputedStyle(doc.documentElement).getPropertyValue(name);
      v = (v || '').trim();
      return v || fallback;
    } catch (e) {
      return fallback;
    }
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  var uidCounter = 0;
  function uid(prefix) {
    uidCounter++;
    return 'dpa-' + prefix + '-' + uidCounter;
  }

  /* ---------- 趋势折线 ---------- */
  function trendLine(selector, data, opts) {
    opts = opts || {};
    var container = typeof selector === 'string' ? doc.querySelector(selector) : selector;
    if (!container) return;
    if (!data || !data.length) {
      container.innerHTML = '<div class="empty-state" style="padding:24px"><div class="empty-state-desc">暂无趋势数据</div></div>';
      return;
    }

    var title = opts.title || '趋势分析';
    var W = 340, H = 160, PAD = 28;
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
        '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
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
  }

  /* ---------- 进度环形图 ---------- */
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
