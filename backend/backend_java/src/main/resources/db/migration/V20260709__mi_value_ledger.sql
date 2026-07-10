-- 米值消费账本：记录每一次生图/视频扣减以及管理后台调账，用于可审计与对账。
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
