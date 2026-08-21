-- 选品库商品、标签与搬家任务表。当前项目启动建表同步维护在 schema.sql。
CREATE TABLE IF NOT EXISTS ym_selection_product (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  source_platform VARCHAR(32) NOT NULL,
  source_product_id VARCHAR(128) NOT NULL,
  source_url VARCHAR(1024) NULL,
  title VARCHAR(512) NOT NULL,
  cover_image_url VARCHAR(1024) NULL,
  product_data LONGTEXT NOT NULL,
  raw_snapshot LONGTEXT NOT NULL,
  collect_source VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
  collect_status VARCHAR(32) NOT NULL DEFAULT 'COLLECTED',
  publish_status VARCHAR(32) NOT NULL DEFAULT 'UNPUBLISHED',
  has_ai_edit TINYINT(1) NOT NULL DEFAULT 0,
  quality_score INT NOT NULL DEFAULT 0,
  origin_product_row_id BIGINT NULL,
  origin_product_id VARCHAR(128) NULL,
  last_collect_error VARCHAR(1024) NULL,
  last_collected_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  UNIQUE KEY uk_selection_source (user_id, source_platform, source_product_id),
  INDEX idx_selection_user_updated (user_id, updated_at),
  INDEX idx_selection_collect_status (user_id, collect_status),
  INDEX idx_selection_publish_status (user_id, publish_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ym_selection_product_revision (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  product_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  revision_no INT NOT NULL,
  product_data LONGTEXT NOT NULL,
  raw_snapshot LONGTEXT NULL,
  change_type VARCHAR(32) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_selection_revision (product_id, revision_no),
  INDEX idx_selection_revision_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ym_selection_tag (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  name VARCHAR(32) NOT NULL,
  color VARCHAR(16) NOT NULL DEFAULT '#7C5CFC',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_selection_tag_name (user_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ym_selection_product_tag_rel (
  product_id BIGINT NOT NULL,
  tag_id BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (product_id, tag_id),
  INDEX idx_selection_tag_rel_tag (tag_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ym_product_migration_task (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  task_id VARCHAR(64) NOT NULL UNIQUE,
  user_id BIGINT NOT NULL,
  target_platform VARCHAR(32) NOT NULL,
  target_shop_ref VARCHAR(128) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'QUEUED',
  total_count INT NOT NULL DEFAULT 0,
  success_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  options_json LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  INDEX idx_migration_user_created (user_id, created_at),
  INDEX idx_migration_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ym_product_migration_item (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  task_id VARCHAR(64) NOT NULL,
  product_id BIGINT NOT NULL,
  sequence_no INT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  source_snapshot LONGTEXT NOT NULL,
  target_product_id VARCHAR(128) NULL,
  target_url VARCHAR(1024) NULL,
  retry_count INT NOT NULL DEFAULT 0,
  error_code VARCHAR(64) NULL,
  error_message VARCHAR(1024) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_migration_item_product (task_id, product_id),
  INDEX idx_migration_item_status (task_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

