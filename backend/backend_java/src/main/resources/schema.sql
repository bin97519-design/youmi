CREATE TABLE IF NOT EXISTS ym_sys_user (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  account VARCHAR(64) NOT NULL UNIQUE,
  phone VARCHAR(32) NULL UNIQUE,
  nickname VARCHAR(64) NOT NULL,
  password_hash VARCHAR(128) NOT NULL,
  password_salt VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  mi_value INT NOT NULL DEFAULT 0,
  plan_name VARCHAR(32) NOT NULL DEFAULT '普通用户',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ym_sys_role (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ym_sys_user_role (
  user_id BIGINT NOT NULL,
  role_id BIGINT NOT NULL,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS ym_sys_role_permission (
  role_id BIGINT NOT NULL,
  permission_code VARCHAR(100) NOT NULL,
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE IF NOT EXISTS ym_login_log (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  account VARCHAR(64) NOT NULL,
  ip VARCHAR(64) NULL,
  user_agent VARCHAR(512) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ym_image_task (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  task_id VARCHAR(128) NOT NULL UNIQUE,
  user_id BIGINT NULL,
  provider VARCHAR(32) NOT NULL DEFAULT 'apimart',
  task_type VARCHAR(32) NOT NULL DEFAULT 'IMAGE',
  prompt TEXT NOT NULL,
  model VARCHAR(128) NULL,
  requested_model VARCHAR(128) NULL,
  size VARCHAR(32) NULL,
  resolution VARCHAR(32) NULL,
  requested_count INT NOT NULL DEFAULT 1,
  status VARCHAR(32) NOT NULL DEFAULT 'submitted',
  progress INT NOT NULL DEFAULT 0,
  image_count INT NOT NULL DEFAULT 0,
  mi_cost INT NOT NULL DEFAULT 0,
  money_cost DECIMAL(12,4) NOT NULL DEFAULT 0,
  image_urls LONGTEXT NULL,
  error_message VARCHAR(512) NULL,
  raw_response LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  INDEX idx_ym_image_task_user_created (user_id, created_at),
  INDEX idx_ym_image_task_status (status),
  INDEX idx_ym_image_task_model (model)
);

CREATE TABLE IF NOT EXISTS ym_canvas_document (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  doc_id VARCHAR(64) NOT NULL,
  user_id BIGINT NOT NULL,
  title VARCHAR(256) NOT NULL DEFAULT '',
  payload_json LONGTEXT NOT NULL,
  thumbnail_url VARCHAR(512) NULL,
  is_reverse_prompt TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_ym_canvas_doc_user (doc_id, user_id),
  INDEX idx_ym_canvas_user_updated (user_id, updated_at DESC)
);

CREATE TABLE IF NOT EXISTS ym_ecommerce_set (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    set_id VARCHAR(64) NOT NULL UNIQUE,
    user_id BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PLANNING',
    product_image_url VARCHAR(512),
    product_description TEXT,
    planning_data JSON,
    generation_config JSON,
    platform VARCHAR(32),
    model VARCHAR(64),
    total_tasks INT DEFAULT 0,
    completed_tasks INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_ecommerce_set_user_id (user_id),
    INDEX idx_ecommerce_set_set_id (set_id)
);

CREATE TABLE IF NOT EXISTS ym_ecommerce_set_task (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    set_id VARCHAR(64) NOT NULL,
    task_id VARCHAR(128),
    task_type VARCHAR(32) NOT NULL,
    selling_point_type VARCHAR(64),
    selling_point_title VARCHAR(128),
    prompt TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    progress INT DEFAULT 0,
    image_url VARCHAR(512),
    thumbnail_url VARCHAR(512),
    error_message TEXT,
    sort_order INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_ecommerce_set_task_set_id (set_id)
);
