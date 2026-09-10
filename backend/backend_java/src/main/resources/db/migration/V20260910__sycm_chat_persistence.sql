-- SYCM raw consultation/chat persistence. Run in the existing backend database.
CREATE TABLE IF NOT EXISTS ym_sycm_import_batch (
  user_id BIGINT NOT NULL,
  batch_id VARCHAR(128) NOT NULL,
  shop_id VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  consultation_count INT NOT NULL,
  message_count INT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ym_sycm_consultation (
  record_key CHAR(64) PRIMARY KEY,
  user_id BIGINT NOT NULL,
  shop_id VARCHAR(128) NOT NULL,
  shop_name VARCHAR(256) NOT NULL,
  consultation_date DATE NOT NULL,
  agent_id VARCHAR(128) NOT NULL,
  buyer_id VARCHAR(128) NOT NULL,
  started_at DATETIME(3) NOT NULL,
  ended_at DATETIME(3) NULL,
  data_id VARCHAR(256) NOT NULL,
  raw_json LONGTEXT NOT NULL,
  last_batch_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_sycm_consultation_scope (user_id, shop_id, consultation_date),
  INDEX idx_sycm_consultation_customer (user_id, shop_id, buyer_id, agent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ym_sycm_chat_message (
  record_key CHAR(64) PRIMARY KEY,
  user_id BIGINT NOT NULL,
  shop_id VARCHAR(128) NOT NULL,
  shop_name VARCHAR(256) NOT NULL,
  consultation_date DATE NOT NULL,
  agent_id VARCHAR(128) NOT NULL,
  buyer_id VARCHAR(128) NOT NULL,
  message_id VARCHAR(256) NOT NULL,
  sent_at DATETIME(3) NOT NULL,
  data_id VARCHAR(256) NOT NULL,
  raw_json LONGTEXT NOT NULL,
  last_batch_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_sycm_message_scope (user_id, shop_id, consultation_date, sent_at),
  INDEX idx_sycm_message_customer (user_id, shop_id, buyer_id, agent_id),
  INDEX idx_sycm_message_data (user_id, shop_id, data_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
