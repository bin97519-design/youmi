-- 生图结果持久化列：后端异步转存落库，抗刷新裂图
-- 与 schema.sql 中的幂等 ALTER 保持一致（此处为 Flyway 风格镜像，幂等可执行）。
-- 列：
--   result_urls    LONGTEXT  NULL            永久 OSS URL（JSON 数组字符串）
--   persist_status VARCHAR(16) NOT NULL DEFAULT 'PENDING'   PENDING / DONE / FAILED
--   is_fallback    TINYINT(1) NOT NULL DEFAULT 0            兜底通道徽章

SET @db = DATABASE();

SET @has_result_urls = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=@db AND table_name='ym_image_task' AND column_name='result_urls');
SET @sql = IF(@has_result_urls=0, 'ALTER TABLE ym_image_task ADD COLUMN result_urls LONGTEXT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_persist_status = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=@db AND table_name='ym_image_task' AND column_name='persist_status');
SET @sql = IF(@has_persist_status=0, "ALTER TABLE ym_image_task ADD COLUMN persist_status VARCHAR(16) NOT NULL DEFAULT 'PENDING'", 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_is_fallback = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=@db AND table_name='ym_image_task' AND column_name='is_fallback');
SET @sql = IF(@has_is_fallback=0, 'ALTER TABLE ym_image_task ADD COLUMN is_fallback TINYINT(1) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
