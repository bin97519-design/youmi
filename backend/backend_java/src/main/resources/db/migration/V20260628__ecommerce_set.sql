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
    INDEX idx_user_id (user_id),
    INDEX idx_set_id (set_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
    INDEX idx_set_id (set_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
