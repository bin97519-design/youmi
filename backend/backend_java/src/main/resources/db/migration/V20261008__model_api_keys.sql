CREATE TABLE IF NOT EXISTS ym_model_api_key (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(128) NOT NULL,
  model VARCHAR(128) NOT NULL,
  provider VARCHAR(64) NOT NULL DEFAULT 'youmi888',
  base_url VARCHAR(512) NOT NULL,
  generation_path VARCHAR(255) NOT NULL DEFAULT '/v1/media/generate',
  task_path VARCHAR(255) NOT NULL DEFAULT '/v1/media/status',
  encrypted_api_key TEXT NOT NULL,
  encrypted_dek TEXT NOT NULL,
  encryption_key_version VARCHAR(32) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  priority INT NOT NULL DEFAULT 100,
  created_by BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ym_model_api_key_lookup (model, enabled, priority),
  INDEX idx_ym_model_api_key_provider (provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
