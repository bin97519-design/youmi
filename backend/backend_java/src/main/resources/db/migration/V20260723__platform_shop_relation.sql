CREATE TABLE IF NOT EXISTS ym_platform (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(64) NOT NULL UNIQUE,
  code VARCHAR(32) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  sort_order INT NOT NULL DEFAULT 100,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_platform_status_sort (status, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO ym_platform (name, code, status, sort_order) VALUES
  ('淘宝', 'TAOBAO', 'ACTIVE', 10),
  ('天猫', 'TMALL', 'ACTIVE', 20),
  ('抖音', 'DOUYIN', 'ACTIVE', 30),
  ('京东', 'JD', 'ACTIVE', 40),
  ('拼多多', 'PINDUODUO', 'ACTIVE', 50),
  ('其他', 'OTHER', 'ACTIVE', 999)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  status = VALUES(status),
  sort_order = VALUES(sort_order);

SET @db = DATABASE();
SET @has_shop_platform_col = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=@db AND table_name='ym_shop' AND column_name='platform_id');
SET @sql = IF(@has_shop_platform_col=0, 'ALTER TABLE ym_shop ADD COLUMN platform_id BIGINT NULL AFTER code', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO ym_platform (name, code, status, sort_order)
SELECT DISTINCT
  TRIM(s.platform),
  CONCAT('LEGACY_', UPPER(SUBSTRING(MD5(TRIM(s.platform)), 1, 12))),
  'ACTIVE',
  900
FROM ym_shop s
LEFT JOIN ym_platform p ON p.name = TRIM(s.platform)
WHERE s.platform IS NOT NULL AND TRIM(s.platform) <> '' AND p.id IS NULL
ON DUPLICATE KEY UPDATE name = VALUES(name);

UPDATE ym_shop s
INNER JOIN ym_platform p ON p.name = TRIM(s.platform)
SET s.platform_id = p.id
WHERE s.platform_id IS NULL AND s.platform IS NOT NULL AND TRIM(s.platform) <> '';

UPDATE ym_shop
SET platform_id = (SELECT id FROM ym_platform WHERE code = 'OTHER' LIMIT 1)
WHERE platform_id IS NULL;

UPDATE ym_shop s
INNER JOIN ym_platform p ON p.id = s.platform_id
SET s.platform = p.name
WHERE s.platform IS NULL OR s.platform <> p.name;

ALTER TABLE ym_shop MODIFY COLUMN platform_id BIGINT NOT NULL;

SET @has_shop_platform_idx = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=@db AND table_name='ym_shop' AND index_name='idx_shop_platform');
SET @sql = IF(@has_shop_platform_idx=0, 'ALTER TABLE ym_shop ADD INDEX idx_shop_platform (platform_id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_shop_platform_fk = (SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=@db AND table_name='ym_shop' AND constraint_name='fk_shop_platform' AND constraint_type='FOREIGN KEY');
SET @sql = IF(@has_shop_platform_fk=0, 'ALTER TABLE ym_shop ADD CONSTRAINT fk_shop_platform FOREIGN KEY (platform_id) REFERENCES ym_platform (id) ON DELETE RESTRICT', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
