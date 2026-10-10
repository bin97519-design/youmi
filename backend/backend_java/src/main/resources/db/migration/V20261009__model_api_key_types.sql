-- 模型密钥按生图、视频、识图逻辑推理分类。
-- 项目未引入 Flyway；本文件为可供生产手工执行的幂等迁移镜像，schema.sql 同步维护。
SET @db = DATABASE();

SET @has_model_api_key_type = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ym_model_api_key' AND COLUMN_NAME='model_type');
SET @sql = IF(@has_model_api_key_type=0, "ALTER TABLE ym_model_api_key ADD COLUMN model_type VARCHAR(32) NOT NULL DEFAULT 'image_generation' AFTER model", 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @model_api_key_lookup_columns = (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ym_model_api_key' AND INDEX_NAME='idx_ym_model_api_key_lookup');
SET @sql = IF(@model_api_key_lookup_columns IS NOT NULL AND @model_api_key_lookup_columns <> 'model_type,model,enabled,priority', 'DROP INDEX idx_ym_model_api_key_lookup ON ym_model_api_key', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_model_api_key_lookup = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ym_model_api_key' AND INDEX_NAME='idx_ym_model_api_key_lookup');
SET @sql = IF(@has_model_api_key_lookup=0, 'CREATE INDEX idx_ym_model_api_key_lookup ON ym_model_api_key (model_type, model, enabled, priority)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
