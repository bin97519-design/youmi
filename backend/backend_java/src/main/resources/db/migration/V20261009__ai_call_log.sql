CREATE TABLE IF NOT EXISTS ym_ai_call_log (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  source VARCHAR(64) NOT NULL,
  operation VARCHAR(32) NOT NULL,
  provider VARCHAR(64) NULL,
  model VARCHAR(128) NULL,
  api_key_id BIGINT NULL,
  selection_mode VARCHAR(24) NOT NULL DEFAULT 'system_default',
  status VARCHAR(16) NOT NULL,
  http_status INT NULL,
  duration_ms BIGINT NOT NULL DEFAULT 0,
  error_code VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ym_ai_call_log_created (created_at),
  INDEX idx_ym_ai_call_log_key_created (api_key_id, created_at),
  INDEX idx_ym_ai_call_log_model_created (model, created_at)
);

SET @db = DATABASE();
SET @has_ai_call_log_selection_mode = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ym_ai_call_log' AND COLUMN_NAME='selection_mode');
SET @sql = IF(@has_ai_call_log_selection_mode=0, "ALTER TABLE ym_ai_call_log ADD COLUMN selection_mode VARCHAR(24) NOT NULL DEFAULT 'system_default' AFTER api_key_id", 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
