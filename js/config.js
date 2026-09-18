/**
 * config.js — 全局配置
 * ------------------------------------------------------------------
 * 糖尿病预治智能助手 / DeepSeek + Dify
 *
 * 【使用说明】
 * 1. 未配置 DIFY.apps.*.apiKey 时，系统自动使用本地降级引擎（mock-engine），
 *    所有功能离线可用，适合课堂演示与答辩。
 * 2. 部署好 Dify 后，把下面各应用的 apiKey 填上，并将 USE_MOCK 置为 false，
 *    即可切换为真实大模型能力。
 *
 * 【安全提示｜重要】
 * 默认配置**推荐走同源反向代理**：baseUrl 为相对路径 '/v1'，apiKey 留空，
 * 由 Nginx 在代理层注入 Authorization 头（见 nginx.conf 的 /v1/ 段）。
 * 这样前端源码与 Network 面板中都**不会出现任何密钥**。
 *
 * 直接把 apiKey 填在前端（明文）**仅适用于教学/内网单机演示**：密钥会随
 * 前端资源分发，任何访客都能读取并盗用。生产环境请勿这样使用。
 * ------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  var CONFIG = {
    /* 应用信息 */
    app: {
      name: '糖尿病预治智能助手',
      shortName: '糖尿病助手',
      version: '2.1.0'
    },

    /* 是否强制使用本地降级引擎。true = 全部走本地；false = 优先走 Dify */
    USE_MOCK: false,

    /* Dify 服务地址与鉴权方式 */
    DIFY: {
      /*
       * 相对路径 '/v1' 指向同源反向代理（推荐，见 nginx.conf 的 /v1/ 段）；
       * 直连 Dify 时改成完整地址，如 'http://localhost/v1'。
       */
      baseUrl: '',   // 本地开发在 js/config.local.js 中填写，见文件末尾说明

      /*
       * true  = 反代模式（推荐）：密钥由 Nginx 在代理层注入，前端不持有任何 Key。
       * false = 直连模式：需要给下面的 apps.*.apiKey 填值，密钥会明文出现在前端。
       *         仅适用于教学/内网单机演示。
       */
      proxyMode: false,

      /* 请求超时（毫秒）。流式请求按「空闲超时」计算：这么久没收到数据即中止。
       * 60s 是为课程云沙箱设定的：实测 checkinAnalysis 工作流需 40s+ */
      timeout: 60000,
      /* 失败重试次数（仅对网络异常/超时/5xx/429 生效） */
      retry: 1,
      /* 8 个 Dify 应用：直连模式下填入 apiKey 即启用 */
      apps: {
        homeData:        { key: 'WF-1',    name: '首页数据管理',   type: 'workflow', apiKey: '' },
        doctorChat:      { key: 'CHAT-1',  name: '医师咨询助手',   type: 'chat',     apiKey: '' },
        riskPrediction:  { key: 'WF-2',    name: '个人信息与风险预测', type: 'workflow', apiKey: '' },
        lifePlan:        { key: 'WF-3',    name: '生活方案定制',   type: 'workflow', apiKey: '' },
        healthNews:      { key: 'WF-4',    name: '健康资讯生成',   type: 'workflow', apiKey: '' },
        checkinAnalysis: { key: 'WF-5',    name: '打卡分析',       type: 'workflow', apiKey: '' },
        aiAssistant:     { key: 'CHAT-2',  name: 'AI智能助手',     type: 'chat',     apiKey: '' },
        adminAgent:      { key: 'AGENT-1', name: 'AI管理助手',     type: 'agent',    apiKey: '' }
      }
    },

    /* 存储键前缀（统一规范，避免键名冲突） */
    STORAGE_PREFIX: 'dpa:',

    /* 风险预测阈值（CDRS 量表，见开发计划 8.2） */
    RISK: {
      lowMax: 8,      // 0-8  低风险
      midMax: 15      // 9-15 中风险；>=16 高风险
    },

    /* 打卡分析阈值 */
    CHECKIN: {
      excellent: 0.85,  // 完成率 >= 85% 优秀
      good: 0.60        // 完成率 >= 60% 良好
    },

    /* 分页/列表默认条数 */
    PAGE_SIZE: 10,

    /* ------------------------------------------------------------------
     * 用户数据持久化后端（Express + MySQL，见 server/ 目录）
     *
     * 前端默认「同源」探测 /api/health：
     *   · 从 http://127.0.0.1:8090 打开 → 命中后端 → 用户数据存 MySQL
     *   · 从 http://127.0.0.1:8080 或 file:// 打开 → 探测失败 → 自动降级
     *     到 localStorage，功能完全不受影响（离线演示模式）
     *
     * baseUrl 留空 = 同源。若要跨端口连接后端，可写成
     * 'http://127.0.0.1:8090'（后端已放行本机来源的 CORS）。
     * 也可用网址参数临时指定：index.html?api=http://127.0.0.1:8090
     * ------------------------------------------------------------------ */
    API: {
      baseUrl: '',          // 留空 = 与页面同源
      enabled: true,        // 是否允许探测并使用数据库后端
      timeout: 3000,        // 同步登录请求的超时（毫秒）
      healthPath: '/api/health'
    }
  };

  /**
   * 判断某个 Dify 应用是否已配置可用
   *  - 反代模式：只要 baseUrl 有效即视为可用（密钥在代理层注入）
   *  - 直连模式：需要该应用的 apiKey 以 'app-' 开头
   * @param {string} appId apps 中的键名，如 'riskPrediction'
   */
  CONFIG.isDifyReady = function (appId) {
    if (CONFIG.USE_MOCK) return false;
    var d = CONFIG.DIFY;
    if (!d || !d.baseUrl) return false;
    if (d.proxyMode) return true;
    var app = d.apps[appId];
    return !!(app && app.apiKey && String(app.apiKey).indexOf('app-') === 0);
  };

  /** 当前是否处于在线模式（任一应用可用即算在线） */
  CONFIG.isOnline = function () {
    if (CONFIG.USE_MOCK) return false;
    if (CONFIG.DIFY.proxyMode) return !!CONFIG.DIFY.baseUrl;
    return Object.keys(CONFIG.DIFY.apps).some(function (k) { return CONFIG.isDifyReady(k); });
  };



  /* ------------------------------------------------------------------
   * 本地覆盖（可选）：js/config.local.js
   *
   * 真实 Dify 地址与 API Key 不写在本文件里，避免随仓库分发。
   * 本地开发时新建 js/config.local.js（已在 .gitignore 中忽略）写入：
   *   window.DPA_CONFIG_LOCAL = {
   *     DIFY: { baseUrl: 'http://<你的Dify地址>/v1',
   *             apps: { homeData: { apiKey: 'app-xxxx' }, ... } }
   *   };
   * 未提供该文件时，USE_MOCK 之外的应用会因缺少 Key 自动降级到本地引擎，
   * 功能完整可用（离线演示模式）。
   * ------------------------------------------------------------------ */
  if (global.DPA_CONFIG_LOCAL) {
    var LOCAL = global.DPA_CONFIG_LOCAL;
    if (typeof LOCAL.USE_MOCK === 'boolean') CONFIG.USE_MOCK = LOCAL.USE_MOCK;
    if (LOCAL.DIFY) {
      if (LOCAL.DIFY.baseUrl) CONFIG.DIFY.baseUrl = LOCAL.DIFY.baseUrl;
      if (typeof LOCAL.DIFY.proxyMode === 'boolean') CONFIG.DIFY.proxyMode = LOCAL.DIFY.proxyMode;
      if (typeof LOCAL.DIFY.timeout === 'number') CONFIG.DIFY.timeout = LOCAL.DIFY.timeout;
      if (LOCAL.DIFY.apps) {
        Object.keys(LOCAL.DIFY.apps).forEach(function (k) {
          if (CONFIG.DIFY.apps[k] && LOCAL.DIFY.apps[k].apiKey) {
            CONFIG.DIFY.apps[k].apiKey = LOCAL.DIFY.apps[k].apiKey;
          }
        });
      }
    }
    if (global.console && console.info) {
      console.info('[config] 已应用本地覆盖 js/config.local.js');
    }
  }

  global.DPA_CONFIG = CONFIG;
})(window);
