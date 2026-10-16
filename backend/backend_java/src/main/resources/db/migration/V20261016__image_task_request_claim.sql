CREATE TABLE IF NOT EXISTS ym_image_task_request_claim (
  user_id BIGINT NOT NULL,
  client_task_id VARCHAR(128) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'CLAIMED',
  task_id VARCHAR(128) NULL,
  billing_log_id BIGINT NULL,
  error_message VARCHAR(512) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, client_task_id),
  INDEX idx_image_task_request_claim_task (task_id)
);
