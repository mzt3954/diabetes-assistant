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
 * 【安全提示】
 * 前端明文存放 API Key 仅适用于教学/内网环境。生产环境请通过 Nginx
 * 反向代理转发 /v1/* 到 Dify，并在代理层注入 Authorization 头，
 * 前端不持有任何密钥。详见 docs/部署说明.md。
 * ------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  var CONFIG = {
    /* 应用信息 */
    app: {
      name: '糖尿病预治智能助手',
      shortName: '糖尿病助手',
      version: '2.0.0'
    },

    /* 是否强制使用本地降级引擎。true = 全部走本地；false = 优先走 Dify */
    USE_MOCK: false,

    /* Dify 服务地址（本地部署默认 http://localhost/v1，沙箱版替换为实际地址） */
    DIFY: {
      baseUrl: 'http://localhost/v1',
      /* 请求超时（毫秒） */
      timeout: 30000,
      /* 失败重试次数 */
      retry: 1,
      /* 8 个 Dify 应用：填入 apiKey 即启用 */
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
    PAGE_SIZE: 10
  };

  /**
   * 判断某个 Dify 应用是否已配置可用
   * @param {string} appId apps 中的键名，如 'riskPrediction'
   */
  CONFIG.isDifyReady = function (appId) {
    if (CONFIG.USE_MOCK) return false;
    var app = CONFIG.DIFY.apps[appId];
    return !!(app && app.apiKey && app.apiKey.indexOf('app-') === 0);
  };

  global.DPA_CONFIG = CONFIG;
})(window);
