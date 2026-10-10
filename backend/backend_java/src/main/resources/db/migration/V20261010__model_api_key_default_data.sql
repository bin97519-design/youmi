-- 为模型密钥配置增加可选的多组默认请求参数。
SET @db = DATABASE();
SET @has_model_api_key_default_data = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ym_model_api_key' AND COLUMN_NAME='default_data');
SET @sql = IF(@has_model_api_key_default_data=0, 'ALTER TABLE ym_model_api_key ADD COLUMN default_data LONGTEXT NULL AFTER task_path', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
