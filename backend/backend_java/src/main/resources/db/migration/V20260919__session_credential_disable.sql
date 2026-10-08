-- 用户停用会话凭证时记录首次停用时间。

SET @has_session_credential_disabled_at = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ym_session_credential'
    AND COLUMN_NAME = 'disabled_at'
);
SET @sql = IF(
  @has_session_credential_disabled_at = 0,
  'ALTER TABLE ym_session_credential ADD COLUMN disabled_at DATETIME NULL AFTER status',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
