-- ============================================================================
--  糖尿病预治智能助手 · 用户数据持久化方案
--  01-schema.sql —— 建库与建表（幂等，可重复执行）
-- ----------------------------------------------------------------------------
--  目标环境 ：MySQL 8.0+（本机实测 MySQL 8.4.9）
--  字符集   ：utf8mb4 / utf8mb4_unicode_ci（支持中文、emoji）
--  存储引擎 ：InnoDB（支持事务与外键）
--  执行方式 ：mysql -u root < server/sql/01-schema.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 创建数据库
-- ---------------------------------------------------------------------------
CREATE DATABASE IF NOT EXISTS `diabetes_assistant`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `diabetes_assistant`;

-- ---------------------------------------------------------------------------
-- 2. 用户表 users
-- ---------------------------------------------------------------------------
--  设计说明：
--   · user_id      —— 代理主键，无符号自增，避免业务字段做主键
--   · username     —— 登录名，唯一索引；50 字符足以覆盖中文/英文用户名
--   · password_*   —— 只存「盐 + 派生密钥」，绝不存明文口令
--                     算法：scrypt(password, salt, 64, {N:16384,r:8,p:1})
--                     派生密钥 64 字节 → 128 位十六进制
--   · role         —— 枚举，限定取值，避免脏数据
--   · phone        —— 允许 NULL；唯一性不强制（家庭成员可能共用手机号）
--   · age          —— TINYINT UNSIGNED，1~255，业务层再校验 1~120
--   · gender       —— 枚举，与前端下拉取值一致（男 / 女），空值存 NULL
--   · diabetes_type—— 糖尿病分型，取值与前端下拉一致
--   · status       —— 账号状态：1 正常 / 0 停用，便于后台管理
--   · create_time / update_time —— 审计字段，由数据库自动维护
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `user_id`       INT UNSIGNED     NOT NULL AUTO_INCREMENT           COMMENT '用户ID，主键，自增',
  `username`      VARCHAR(50)      NOT NULL                          COMMENT '登录用户名，全局唯一',
  `password_hash` VARCHAR(128)     NOT NULL                          COMMENT '口令派生密钥（scrypt，64字节→128位十六进制）',
  `password_salt` CHAR(32)         NOT NULL                          COMMENT '口令随机盐（16字节→32位十六进制）',
  `role`          ENUM('user','admin') NOT NULL DEFAULT 'user'       COMMENT '角色：user 普通用户 / admin 管理员',
  `phone`         VARCHAR(20)      DEFAULT NULL                      COMMENT '手机号码（选填）',
  `age`           TINYINT UNSIGNED DEFAULT NULL                      COMMENT '年龄（选填，业务校验 1~120）',
  `gender`        ENUM('男','女')  DEFAULT NULL                      COMMENT '性别（选填）',
  `diabetes_type` VARCHAR(32)      DEFAULT NULL                      COMMENT '糖尿病类型（选填）',
  `avatar_url`    VARCHAR(255)     NOT NULL DEFAULT ''               COMMENT '头像地址（选填）',
  `status`        TINYINT          NOT NULL DEFAULT 1                COMMENT '账号状态：1 正常 / 0 停用',
  `create_time`   DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time`   DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP
                                   ON UPDATE CURRENT_TIMESTAMP       COMMENT '最后更新时间',
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `uk_users_username` (`username`),
  KEY `idx_users_role` (`role`),
  KEY `idx_users_create_time` (`create_time`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci
  COMMENT = '用户表：保存系统全部用户的账号与基础资料';

-- ---------------------------------------------------------------------------
-- 3. 登录日志表 login_logs
-- ---------------------------------------------------------------------------
--  记录每一次登录尝试（成功与失败都记），用于安全审计与演示「真实落库」。
--  user_id 可空：登录失败时无法确定用户，只记录尝试的用户名。
--  外键 ON DELETE SET NULL：删除用户后保留审计记录，不产生孤儿外键。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `login_logs` (
  `log_id`     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT   COMMENT '日志ID，主键，自增',
  `user_id`    INT UNSIGNED    DEFAULT NULL              COMMENT '用户ID（登录失败时为空）',
  `username`   VARCHAR(50)     NOT NULL                  COMMENT '本次尝试登录的用户名',
  `success`    TINYINT(1)      NOT NULL DEFAULT 0        COMMENT '是否成功：1 成功 / 0 失败',
  `ip`         VARCHAR(45)     DEFAULT NULL              COMMENT '客户端IP（兼容 IPv6）',
  `user_agent` VARCHAR(255)    DEFAULT NULL              COMMENT '客户端 User-Agent',
  `login_time` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '登录时间',
  PRIMARY KEY (`log_id`),
  KEY `idx_login_logs_user` (`user_id`),
  KEY `idx_login_logs_time` (`login_time`),
  CONSTRAINT `fk_login_logs_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci
  COMMENT = '用户登录日志表：记录登录尝试，用于安全审计';
