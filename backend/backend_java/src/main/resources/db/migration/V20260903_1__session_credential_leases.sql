-- 会话凭证租约。业务进程必须通过短租约使用凭证，禁止直接读取密文表。

CREATE TABLE IF NOT EXISTS ym_session_credential_lease (
  id VARCHAR(64) PRIMARY KEY,
  credential_id VARCHAR(64) NOT NULL,
  credential_version BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  purpose VARCHAR(80) NOT NULL,
  task_id VARCHAR(128) NOT NULL,
  run_id VARCHAR(128) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  leased_at DATETIME NOT NULL,
  heartbeat_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  released_at DATETIME NULL,
  invalidate_reason VARCHAR(256) NULL,
  INDEX idx_credential_lease_credential_status (credential_id, status, expires_at),
  INDEX idx_credential_lease_user_status (user_id, status, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
