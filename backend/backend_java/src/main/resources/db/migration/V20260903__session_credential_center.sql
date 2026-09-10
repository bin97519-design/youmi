-- 第三方平台登录凭证中心（首期：生意参谋）。
-- 项目未引入 Flyway，生产部署时可单独执行；schema.sql 保持同样的幂等定义。

CREATE TABLE IF NOT EXISTS ym_credential_pairing_code (
  id VARCHAR(64) PRIMARY KEY,
  user_id BIGINT NOT NULL,
  code_hash CHAR(64) NOT NULL,
  label VARCHAR(80) NOT NULL,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_credential_pairing_code_hash (code_hash),
  INDEX idx_credential_pairing_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ym_credential_device (
  id VARCHAR(64) PRIMARY KEY,
  user_id BIGINT NOT NULL,
  device_instance_id VARCHAR(128) NOT NULL,
  device_name VARCHAR(80) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  last_seen_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at DATETIME NULL,
  UNIQUE KEY uk_credential_device_token (token_hash),
  INDEX idx_credential_device_user (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ym_credential_upload_nonce (
  device_id VARCHAR(64) NOT NULL,
  nonce VARCHAR(128) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (device_id, nonce),
  INDEX idx_credential_nonce_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ym_session_credential (
  id VARCHAR(64) PRIMARY KEY,
  user_id BIGINT NOT NULL,
  platform VARCHAR(32) NOT NULL,
  account_id VARCHAR(128) NOT NULL DEFAULT '',
  account_name VARCHAR(128) NOT NULL DEFAULT '',
  shop_id VARCHAR(128) NOT NULL DEFAULT '',
  shop_name VARCHAR(128) NOT NULL DEFAULT '',
  identity_key CHAR(64) NOT NULL,
  source_device_id VARCHAR(64) NOT NULL,
  encrypted_payload LONGTEXT NOT NULL,
  encrypted_dek TEXT NOT NULL,
  encryption_key_version VARCHAR(32) NOT NULL,
  credential_version BIGINT NOT NULL DEFAULT 1,
  environment_json TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'CAPTURED',
  max_concurrency INT NOT NULL DEFAULT 1,
  captured_at DATETIME NOT NULL,
  expires_at DATETIME NULL,
  last_validated_at DATETIME NULL,
  last_used_at DATETIME NULL,
  last_error_code VARCHAR(64) NULL,
  last_error_message_masked VARCHAR(512) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_session_credential_identity (user_id, identity_key),
  INDEX idx_session_credential_user_status (user_id, platform, status),
  INDEX idx_session_credential_device (source_device_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ym_credential_audit_log (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  device_id VARCHAR(64) NULL,
  credential_id VARCHAR(64) NULL,
  action VARCHAR(64) NOT NULL,
  detail_masked VARCHAR(512) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_credential_audit_user (user_id, created_at),
  INDEX idx_credential_audit_credential (credential_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
