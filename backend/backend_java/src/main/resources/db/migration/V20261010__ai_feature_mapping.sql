CREATE TABLE IF NOT EXISTS ym_ai_feature_mapping (
  feature_code VARCHAR(64) PRIMARY KEY,
  configured TINYINT(1) NOT NULL DEFAULT 0,
  default_api_key_id BIGINT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ym_ai_feature_mapping_key (
  feature_code VARCHAR(64) NOT NULL,
  api_key_id BIGINT NOT NULL,
  PRIMARY KEY (feature_code, api_key_id),
  INDEX idx_ym_ai_feature_mapping_key_key (api_key_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO ym_ai_feature_mapping (feature_code, configured) VALUES
  ('canvas-image', 0), ('canvas-layering', 0), ('canvas-agent', 0), ('canvas-video', 0);
