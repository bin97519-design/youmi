SET @db = DATABASE();

SET @has_ratio = (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema=@db AND table_name='ym_ecommerce_set_task' AND column_name='ratio');
SET @sql = IF(@has_ratio=0,
    'ALTER TABLE ym_ecommerce_set_task ADD COLUMN ratio VARCHAR(16) NULL AFTER prompt', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_billing = (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema=@db AND table_name='ym_ecommerce_set_task' AND column_name='billing_log_id');
SET @sql = IF(@has_billing=0,
    'ALTER TABLE ym_ecommerce_set_task ADD COLUMN billing_log_id BIGINT NULL AFTER error_message', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_retry = (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema=@db AND table_name='ym_ecommerce_set_task' AND column_name='retry_count');
SET @sql = IF(@has_retry=0,
    'ALTER TABLE ym_ecommerce_set_task ADD COLUMN retry_count INT NOT NULL DEFAULT 0 AFTER billing_log_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_status_idx = (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema=@db AND table_name='ym_ecommerce_set_task' AND index_name='idx_ecommerce_task_status');
SET @sql = IF(@has_status_idx=0,
    'ALTER TABLE ym_ecommerce_set_task ADD INDEX idx_ecommerce_task_status (set_id, status)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
