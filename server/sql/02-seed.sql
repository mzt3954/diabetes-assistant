-- ============================================================================
--  糖尿病预治智能助手 · 用户数据持久化方案
--  02-seed.sql —— 演示账号与样例数据（幂等，可重复执行）
-- ----------------------------------------------------------------------------
--  口令均为 scrypt 派生，绝不存明文。明文对照如下（仅课程演示用）：
--    admin    / admin123   管理员
--    user     / user123    普通用户
--    zhangsan / zhang123   普通用户（样例资料较完整）
--    lisi     / lisi123    普通用户（样例资料较完整）
--
--  使用 INSERT ... ON DUPLICATE KEY UPDATE：重复执行不会报错，
--  也不会覆盖已经改过的资料（只刷新口令与状态）。
-- ============================================================================

USE `diabetes_assistant`;

-- ---------------------------------------------------------------------------
-- 1. 演示账号
-- ---------------------------------------------------------------------------
INSERT INTO `users`
  (`user_id`, `username`, `password_hash`, `password_salt`, `role`,
   `phone`, `age`, `gender`, `diabetes_type`, `avatar_url`, `status`)
VALUES
  (1, 'admin',
   'd01c417e9c0ec3be1d0eddee0aac6a5d3838dc2f7b16950eb6d233c292d9e6912944f78eb6ea38da1a8b932b0519bd91db01481a0011909e8118e6f2f2ed1f0e',
   '5f28fcd1f9556a4906078b9686849bc0',
   'admin', NULL, NULL, NULL, NULL, '', 1),

  (2, 'user',
   '5cc4998db84540175ad1f5f74a727d8e7634c26b564dbebf1e00c2de2c0af337f47a28ff065342366a16268b8f0af9b6196ff0cfc887f205d4b5ae320314836f',
   '8ee6cc3c3a91fd8b727726cbca291447',
   'user', '13800138000', 38, '男', '2型糖尿病', '', 1),

  (3, 'zhangsan',
   '6c9adc44c856513197f2978ccd71cea5825490b8e4a09928686f402cc51a2636b2dfdb9c54eb194ca16856ad1409d2317acd1957e3ede8b5e43071a69edbfd6e',
   'db630e9066d939e13580d43fd4c18ba4',
   'user', '13900139001', 45, '男', '2型糖尿病', '', 1),

  (4, 'lisi',
   '74a01942a5cba106ce08cbd28e5b0e19cd359354dd3764ad4f8189c9c7a20aec005ff30113073c95d15d80e96347f03017c3a38a32f806c376a56011fb606d48',
   'c70f8e574c132b23d025c9b68b41d7a9',
   'user', '13700137002', 32, '女', '未确诊/预防阶段', '', 1)
ON DUPLICATE KEY UPDATE
  `password_hash` = VALUES(`password_hash`),
  `password_salt` = VALUES(`password_salt`),
  `role`          = VALUES(`role`),
  `status`        = VALUES(`status`);

-- ---------------------------------------------------------------------------
-- 2. 登录日志样例（便于老师在数据库中直接看到关联数据）
--    login_logs 没有业务唯一键，无法用 ON DUPLICATE KEY UPDATE 去重，
--    因此改为「表为空时才写入」——用 NOT EXISTS 做守卫，重复执行不会累积脏数据。
--    真实运行中这张表由 POST /api/auth/login 持续写入。
-- ---------------------------------------------------------------------------
INSERT INTO `login_logs` (`user_id`, `username`, `success`, `ip`, `user_agent`)
SELECT `seed`.`user_id`, `seed`.`username`, `seed`.`success`, `seed`.`ip`, `seed`.`user_agent`
FROM (
  SELECT 1     AS `user_id`, 'admin'  AS `username`, 1 AS `success`,
         '127.0.0.1' AS `ip`, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) 演示环境' AS `user_agent`
  UNION ALL
  SELECT 2,     'user',   1, '127.0.0.1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) 演示环境'
  UNION ALL
  SELECT NULL,  'nobody', 0, '127.0.0.1', 'Mozilla/5.0 登录失败样例（用户不存在）'
) AS `seed`
WHERE NOT EXISTS (SELECT 1 FROM (SELECT `log_id` FROM `login_logs` LIMIT 1) AS `probe`);

-- ---------------------------------------------------------------------------
-- 3. 执行结果自检
-- ---------------------------------------------------------------------------
SELECT '--- 用户表 users ---' AS `检查项`;
SELECT `user_id`, `username`, `role`, `phone`, `age`, `gender`, `diabetes_type`,
       LEFT(`password_hash`, 16) AS `password_hash(前16位)`, `status`, `create_time`
FROM `users` ORDER BY `user_id`;

SELECT '--- 登录日志 login_logs ---' AS `检查项`;
SELECT `log_id`, `user_id`, `username`, `success`, `ip`, `login_time`
FROM `login_logs` ORDER BY `log_id`;
