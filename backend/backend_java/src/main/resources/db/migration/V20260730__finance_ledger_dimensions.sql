-- 财务系统：给米值流水增加消费发生时的平台/店铺快照。
-- 项目未引入 Flyway，真正每次启动自动执行的是 classpath:schema.sql；
-- 本文件作为版本化镜像，便于线上人工审计和独立执行。
SET @db = DATABASE();

SET @has_log_shop_col = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=@db AND table_name='ym_mi_value_log' AND column_name='shop_id');
SET @sql = IF(@has_log_shop_col=0, 'ALTER TABLE ym_mi_value_log ADD COLUMN shop_id BIGINT NULL AFTER user_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_log_platform_col = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=@db AND table_name='ym_mi_value_log' AND column_name='platform_id');
SET @sql = IF(@has_log_platform_col=0, 'ALTER TABLE ym_mi_value_log ADD COLUMN platform_id BIGINT NULL AFTER shop_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_log_shop_idx = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=@db AND table_name='ym_mi_value_log' AND index_name='idx_log_shop_created');
SET @sql = IF(@has_log_shop_idx=0, 'ALTER TABLE ym_mi_value_log ADD INDEX idx_log_shop_created (shop_id, created_at)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_log_platform_idx = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=@db AND table_name='ym_mi_value_log' AND index_name='idx_log_platform_created');
SET @sql = IF(@has_log_platform_idx=0, 'ALTER TABLE ym_mi_value_log ADD INDEX idx_log_platform_created (platform_id, created_at)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
