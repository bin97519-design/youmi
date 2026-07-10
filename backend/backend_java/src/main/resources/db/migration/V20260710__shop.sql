-- 店铺归属：账号系统新增店铺归属功能
-- 说明：本文件为版本化记录镜像，与 schema.sql 中 DDL 保持一致。
-- 项目未引入 Flyway，真正每次启动被自动执行的是 classpath:schema.sql。
CREATE TABLE IF NOT EXISTS ym_shop (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(128) NOT NULL,
  code VARCHAR(64) NOT NULL UNIQUE,
  platform VARCHAR(32) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_shop_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 幂等给 ym_sys_user 加 shop_id 列 + 普通索引（非唯一）+ 外键（ON DELETE RESTRICT）
SET @db = DATABASE();
SET @has_shop_col = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=@db AND table_name='ym_sys_user' AND column_name='shop_id');
SET @sql = IF(@has_shop_col=0, 'ALTER TABLE ym_sys_user ADD COLUMN shop_id BIGINT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_shop_idx = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=@db AND table_name='ym_sys_user' AND index_name='idx_user_shop');
SET @sql = IF(@has_shop_idx=0, 'ALTER TABLE ym_sys_user ADD INDEX idx_user_shop (shop_id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_shop_fk = (SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=@db AND table_name='ym_sys_user' AND constraint_name='fk_user_shop' AND constraint_type='FOREIGN KEY');
SET @sql = IF(@has_shop_fk=0, 'ALTER TABLE ym_sys_user ADD CONSTRAINT fk_user_shop FOREIGN KEY (shop_id) REFERENCES ym_shop (id) ON DELETE RESTRICT', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
