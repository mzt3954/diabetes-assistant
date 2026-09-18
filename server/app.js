/**
 * app.js — Express 应用装配
 * ---------------------------------------------------------------------------
 *   /api/health       服务与数据库健康状态
 *   /api/auth/*       注册、登录
 *   /api/users/*      用户 CRUD
 *   其余路径          前端静态站点（单端口，天然同源，无跨域）
 *
 * 静态托管刻意排除了 /server、/node_modules 与点文件，
 * 避免把 .env（数据库口令）与 SQL 脚本通过 HTTP 暴露出去。
 * ---------------------------------------------------------------------------
 */
'use strict';

const path = require('path');
const express = require('express');

const config = require('./config');
const db = require('./db');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');

const PROJECT_ROOT = path.join(__dirname, '..');

/** 不允许通过 HTTP 访问的路径前缀（安全边界） */
const BLOCKED = /^\/(server|node_modules|\.env|\.git)(\/|$)/i;

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  /* ---------- 本地开发用的 CORS ----------
   * 前端可能由契约桩（8080）托管，而 API 在本服务（8090）上，
   * 此时属于跨源请求。这里只放行本机来源，不放行任意站点。 */
  app.use(function (req, res, next) {
    const origin = req.headers.origin;
    if (origin && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  });

  /* ---------- 访问日志 ---------- */
  app.use(function (req, res, next) {
    if (!req.path.startsWith('/api/')) return next();
    const started = Date.now();
    res.on('finish', function () {
      console.log(`[api] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - started}ms)`);
    });
    return next();
  });

  /* ---------- 健康检查 ---------- */
  app.get('/api/health', async function (req, res) {
    try {
      const info = await db.healthCheck();
      const counts = await db.stats();
      res.json({
        ok: true,
        data: {
          service: 'diabetes-assistant-user-api',
          status: 'up',
          database: {
            connected: true,
            name: info.db,
            version: info.version,
            serverTime: info.now_time,
            latencyMs: info.latencyMs,
          },
          tables: { users: Number(counts.users), login_logs: Number(counts.login_logs) },
          config: config.describe(),
        },
      });
    } catch (err) {
      res.status(503).json({
        ok: false,
        error: { code: 'DB_UNAVAILABLE', message: '数据库不可用：' + err.message },
        data: { service: 'diabetes-assistant-user-api', status: 'degraded', config: config.describe() },
      });
    }
  });

  /* ---------- 业务路由 ---------- */
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);

  /* ---------- 静态站点 ---------- */
  if (config.server.serveStatic) {
    app.use(function (req, res, next) {
      if (BLOCKED.test(req.path)) {
        return res.status(403).json({ ok: false, error: { code: 'FORBIDDEN', message: '该路径不对外提供' } });
      }
      return next();
    });
    app.use(express.static(PROJECT_ROOT, {
      dotfiles: 'deny',
      etag: false,
      lastModified: false,
      setHeaders: function (res) {
        // 演示期间禁用缓存，避免改了文件刷新不生效
        res.setHeader('Cache-Control', 'no-store');
      },
    }));
  }

  /* ---------- 404 ---------- */
  app.use(function (req, res) {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: '接口不存在：' + req.path } });
    }
    return res.status(404).send('404 Not Found');
  });

  /* ---------- 统一错误处理 ---------- */
  // eslint-disable-next-line no-unused-vars
  app.use(function (err, req, res, next) {
    // JSON 解析失败
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ ok: false, error: { code: 'BAD_JSON', message: '请求体不是合法 JSON' } });
    }
    // 数据库层可识别的错误
    const code = (err && err.code) || '';
    if (code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, error: { code: 'DUPLICATE', message: '数据已存在（唯一约束冲突）' } });
    }
    if (code === 'ER_NO_SUCH_TABLE') {
      return res.status(500).json({
        ok: false,
        error: { code: 'SCHEMA_MISSING', message: '数据表不存在，请先执行 server/sql/01-schema.sql' },
      });
    }
    if (code === 'ECONNREFUSED' || code === 'ER_ACCESS_DENIED_ERROR') {
      return res.status(503).json({
        ok: false,
        error: { code: 'DB_UNAVAILABLE', message: '数据库连接失败：' + err.message },
      });
    }

    console.error('[error]', err && err.stack ? err.stack : err);
    return res.status(500).json({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: (err && err.message) || '服务器内部错误' },
    });
  });

  return app;
}

module.exports = { createApp, PROJECT_ROOT };
