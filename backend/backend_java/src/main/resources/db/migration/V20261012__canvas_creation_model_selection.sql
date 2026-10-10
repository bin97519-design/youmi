INSERT IGNORE INTO ym_ai_feature_mapping (feature_code, configured)
VALUES ('canvas-creation-image', 0), ('product-video-planning', 0);

CREATE TABLE IF NOT EXISTS ym_ai_model_selection_event (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  feature_code VARCHAR(64) NOT NULL,
  model VARCHAR(128) NOT NULL,
  selected TINYINT(1) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ym_ai_model_selection_feature_created (feature_code, created_at),
  INDEX idx_ym_ai_model_selection_user_created (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
