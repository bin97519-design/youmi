SET @db = DATABASE();

SET @has_image_task_created_idx = (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = @db
    AND table_name = 'ym_image_task'
    AND index_name = 'idx_ym_image_task_created'
);
SET @sql = IF(
  @has_image_task_created_idx = 0,
  'ALTER TABLE ym_image_task ADD INDEX idx_ym_image_task_created (created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
