-- Preserve existing whole-number Mi values while enabling two decimal places.
SET @db = DATABASE();

SET @mi_cost_type = (SELECT DATA_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ym_image_task' AND COLUMN_NAME='mi_cost');
SET @sql = IF(@mi_cost_type IS NOT NULL AND @mi_cost_type NOT IN ('decimal', 'numeric'),
  'ALTER TABLE ym_image_task MODIFY COLUMN mi_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @mi_price_type = (SELECT DATA_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='ym_mi_value_log' AND COLUMN_NAME='price');
SET @sql = IF(@mi_price_type IS NOT NULL AND @mi_price_type NOT IN ('decimal', 'numeric'),
  'ALTER TABLE ym_mi_value_log MODIFY COLUMN price DECIMAL(12,2) NOT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
