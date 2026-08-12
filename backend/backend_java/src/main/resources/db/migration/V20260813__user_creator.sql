-- 账号开户管理员追溯：记录实际执行创建操作的后台管理员。
-- 仅保存管理员 ID，不设外键，管理员账号删除后仍保留追溯信息。
SET @db = DATABASE();

SET @has_user_created_by_col = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=@db AND table_name='ym_sys_user' AND column_name='created_by');
SET @sql = IF(@has_user_created_by_col=0, 'ALTER TABLE ym_sys_user ADD COLUMN created_by BIGINT NULL AFTER shop_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_user_created_by_idx = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=@db AND table_name='ym_sys_user' AND index_name='idx_user_created_by');
SET @sql = IF(@has_user_created_by_idx=0, 'ALTER TABLE ym_sys_user ADD INDEX idx_user_created_by (created_by)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
