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

CREATE TABLE IF NOT EXISTS ym_mi_value_log (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  biz_type VARCHAR(20) NOT NULL COMMENT 'IMAGE/VIDEO/ADMIN_ADJUST',
  task_type VARCHAR(32) NULL,
  price INT NOT NULL COMMENT '本次变动的米值绝对值',
  before_balance INT NOT NULL COMMENT '变动前余额快照',
  after_balance INT NOT NULL COMMENT '变动后余额快照',
  task_id VARCHAR(128) NULL COMMENT '关联外部任务 id（异步终态回滚/确认用）',
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/SUCCESS/FAILED/ROLLBACK',
  remark VARCHAR(255) NULL COMMENT '备注，如管理后台调账原因',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_log_user (user_id),
  INDEX idx_log_status (status),
  INDEX idx_log_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 店铺归属（账号系统新增店铺归属功能） ──
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

-- 预埋默认店铺（幂等，ON DUPLICATE KEY UPDATE 避免重复插入报错）
INSERT INTO ym_shop (name, code, platform, status) VALUES
  ('爱洁猫', 'aijiemao', '淘宝', 'ACTIVE'),
  ('能见度', 'nengjiandu', '淘宝', 'ACTIVE'),
  ('宜爵', 'yijue', '淘宝', 'ACTIVE'),
  ('卡寐森', 'kameisen', '淘宝', 'ACTIVE'),
  ('猫人', 'maoren', '淘宝', 'ACTIVE'),
  ('诺沐', 'nuomu', '淘宝', 'ACTIVE'),
  ('奇思妙想', 'qisimiaoxiang', '淘宝', 'ACTIVE')
ON DUPLICATE KEY UPDATE name = name;

-- 给 ym_sys_user 增加 shop_id 列（幂等，避免重启重复 ALTER 报错）
SET @db = DATABASE();
SET @has_shop_col = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=@db AND table_name='ym_sys_user' AND column_name='shop_id');
SET @sql = IF(@has_shop_col=0, 'ALTER TABLE ym_sys_user ADD COLUMN shop_id BIGINT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 给 shop_id 增加普通索引（非唯一，幂等）
SET @has_shop_idx = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=@db AND table_name='ym_sys_user' AND index_name='idx_user_shop');
SET @sql = IF(@has_shop_idx=0, 'ALTER TABLE ym_sys_user ADD INDEX idx_user_shop (shop_id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 给 shop_id 增加外键约束（幂等，ON DELETE RESTRICT）
SET @has_shop_fk = (SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=@db AND table_name='ym_sys_user' AND constraint_name='fk_user_shop' AND constraint_type='FOREIGN KEY');
SET @sql = IF(@has_shop_fk=0, 'ALTER TABLE ym_sys_user ADD CONSTRAINT fk_user_shop FOREIGN KEY (shop_id) REFERENCES ym_shop (id) ON DELETE RESTRICT', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 生图结果持久化（后端异步转存落库，抗刷新裂图） ──
-- result_urls：永久 OSS URL（JSON 数组字符串）
SET @has_result_urls = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=@db AND table_name='ym_image_task' AND column_name='result_urls');
SET @sql = IF(@has_result_urls=0, 'ALTER TABLE ym_image_task ADD COLUMN result_urls LONGTEXT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- persist_status：PENDING / DONE / FAILED（持久化状态，落库耐久）
SET @has_persist_status = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=@db AND table_name='ym_image_task' AND column_name='persist_status');
SET @sql = IF(@has_persist_status=0, "ALTER TABLE ym_image_task ADD COLUMN persist_status VARCHAR(16) NOT NULL DEFAULT 'PENDING'", 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- is_fallback：兜底通道徽章（proxy 中转站生成的图）
SET @has_is_fallback = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=@db AND table_name='ym_image_task' AND column_name='is_fallback');
SET @sql = IF(@has_is_fallback=0, 'ALTER TABLE ym_image_task ADD COLUMN is_fallback TINYINT(1) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 生图客户端幂等（前端生成 client_task_id，刷新重提时后端跳过扣费+外部调用） ──
-- client_task_id：前端对同一张生图稳定携带的客户端幂等键
SET @has_client_task_id = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=@db AND table_name='ym_image_task' AND column_name='client_task_id');
SET @sql = IF(@has_client_task_id=0, 'ALTER TABLE ym_image_task ADD COLUMN client_task_id VARCHAR(128) NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- idx_ym_image_task_client：client_task_id 唯一性查询索引（幂等早返回依赖，必须放在加列之后）
SET @has_client_idx = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=@db AND table_name='ym_image_task' AND index_name='idx_ym_image_task_client');
SET @sql = IF(@has_client_idx=0, 'ALTER TABLE ym_image_task ADD INDEX idx_ym_image_task_client (client_task_id)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 幂等自愈：清理历史遗留的 client_task_id 重复数据（TOCTOU 竞态已产生的脏数据）
-- 同一 client_task_id 仅保留 id 最小的一条，其余置 NULL（UNIQUE INDEX 允许多个 NULL，不丢业务数据）。
-- 幂等可重复执行：去重后该 JOIN 不再命中任何行。
UPDATE ym_image_task t
INNER JOIN (
  SELECT client_task_id, MIN(id) AS keep_id
  FROM ym_image_task
  WHERE client_task_id IS NOT NULL AND client_task_id <> ''
  GROUP BY client_task_id
  HAVING COUNT(*) > 1
) d ON t.client_task_id = d.client_task_id AND t.id <> d.keep_id
SET t.client_task_id = NULL;

-- 幂等硬约束：防止同一 client_task_id 并发提交导致重复生图+重复扣费（TOCTOU 竞态）
SET @has_unique_client = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=@db AND table_name='ym_image_task' AND index_name='uk_ym_image_task_client');
SET @sql = IF(@has_unique_client=0, 'ALTER TABLE ym_image_task ADD UNIQUE INDEX uk_ym_image_task_client (client_task_id)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
