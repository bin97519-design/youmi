-- Recalculate ym_image_task.mi_cost with the current Mi-value price matrix.
--
-- Default mode is PREVIEW and does not change ym_image_task.
-- Apply in MySQL Workbench / mysql client with:
--   SET @apply = 1;
--   SOURCE /opt/youmi/backend/recalculate-image-mi-cost.sql;
--
-- Price matrix (Mi per generated image):
--                  1K   2K   4K
--   banana2         8    9   12
--   banana-pro     13   15   21
--   gpt-image-2     6   10   15
--
-- Rules:
--   * successful terminal tasks: unit price * generated image count
--   * failed terminal tasks: 0 Mi
--   * active tasks: unchanged
--   * GetToken fallback for a GPT task: charged as banana2
--   * unsupported model/resolution: unchanged and listed in the report

SET @apply := COALESCE(@apply, 0);
SET @run_id := UUID();

DROP TEMPORARY TABLE IF EXISTS tmp_ym_image_mi_recalculation;

CREATE TEMPORARY TABLE tmp_ym_image_mi_recalculation AS
SELECT priced.*,
       CASE
         WHEN priced.status_group = 'FAILED' THEN 0
         WHEN priced.status_group = 'SUCCESS' AND priced.unit_price IS NOT NULL
           THEN priced.unit_price * priced.billable_count
         ELSE priced.old_mi_cost
       END AS new_mi_cost,
       CASE
         WHEN priced.status_group = 'FAILED' THEN 1
         WHEN priced.status_group = 'SUCCESS' AND priced.unit_price IS NOT NULL THEN 1
         ELSE 0
       END AS eligible
FROM (
  SELECT normalized.*,
         CASE normalized.canonical_model
           WHEN 'banana2' THEN
             CASE normalized.canonical_resolution WHEN '1K' THEN 8 WHEN '2K' THEN 9 WHEN '4K' THEN 12 END
           WHEN 'banana-pro' THEN
             CASE normalized.canonical_resolution WHEN '1K' THEN 13 WHEN '2K' THEN 15 WHEN '4K' THEN 21 END
           WHEN 'gpt-image-2' THEN
             CASE normalized.canonical_resolution WHEN '1K' THEN 6 WHEN '2K' THEN 10 WHEN '4K' THEN 15 END
           ELSE NULL
         END AS unit_price
  FROM (
    SELECT t.id AS task_pk,
           t.task_id,
           t.user_id,
           COALESCE(t.provider, '') AS provider,
           COALESCE(t.model, '') AS model,
           COALESCE(t.requested_model, '') AS requested_model,
           COALESCE(t.resolution, '') AS resolution,
           LOWER(TRIM(COALESCE(t.status, ''))) AS task_status,
           COALESCE(t.requested_count, 1) AS requested_count,
           COALESCE(t.image_count, 0) AS image_count,
           COALESCE(t.mi_cost, 0) AS old_mi_cost,
           CASE
             WHEN LOWER(TRIM(COALESCE(t.status, ''))) IN
               ('completed', 'succeeded', 'success', 'done', 'finished', 'generated', 'ready')
               THEN 'SUCCESS'
             WHEN LOWER(TRIM(COALESCE(t.status, ''))) IN
               ('failed', 'error', 'cancelled', 'canceled', 'expired', 'aborted')
               OR LOWER(TRIM(COALESCE(t.status, ''))) LIKE '%fail%'
               OR LOWER(TRIM(COALESCE(t.status, ''))) LIKE '%error%'
               THEN 'FAILED'
             ELSE 'ACTIVE'
           END AS status_group,
           CASE
             WHEN COALESCE(t.image_count, 0) > 0 THEN t.image_count
             ELSE GREATEST(COALESCE(t.requested_count, 1), 1)
           END AS billable_count,
           CASE
             WHEN LOWER(TRIM(COALESCE(t.provider, ''))) LIKE '%gettoken%'
               AND REPLACE(REPLACE(REPLACE(LOWER(COALESCE(t.model, '')), '-', ''), '_', ''), ' ', '')
                   LIKE 'gptimage2%'
               THEN 'banana2'
             WHEN LOWER(COALESCE(t.model, '')) LIKE 'gemini-3-pro%'
               OR REPLACE(REPLACE(REPLACE(LOWER(COALESCE(t.model, '')), '-', ''), '_', ''), ' ', '')
                   LIKE 'bananapro%'
               THEN 'banana-pro'
             WHEN LOWER(COALESCE(t.model, '')) LIKE 'gemini-3.1-flash%'
               OR REPLACE(REPLACE(REPLACE(LOWER(COALESCE(t.model, '')), '-', ''), '_', ''), ' ', '')
                   LIKE 'banana2%'
               THEN 'banana2'
             WHEN REPLACE(REPLACE(REPLACE(LOWER(COALESCE(t.model, '')), '-', ''), '_', ''), ' ', '')
                   LIKE 'gptimage2%'
               THEN 'gpt-image-2'
             WHEN LOWER(COALESCE(t.requested_model, '')) LIKE 'gemini-3-pro%'
               OR REPLACE(REPLACE(REPLACE(LOWER(COALESCE(t.requested_model, '')), '-', ''), '_', ''), ' ', '')
                   LIKE 'bananapro%'
               THEN 'banana-pro'
             WHEN LOWER(COALESCE(t.requested_model, '')) LIKE 'gemini-3.1-flash%'
               OR REPLACE(REPLACE(REPLACE(LOWER(COALESCE(t.requested_model, '')), '-', ''), '_', ''), ' ', '')
                   LIKE 'banana2%'
               THEN 'banana2'
             WHEN LOWER(TRIM(COALESCE(t.provider, ''))) LIKE '%gettoken%'
               AND REPLACE(REPLACE(REPLACE(LOWER(COALESCE(t.requested_model, '')), '-', ''), '_', ''), ' ', '')
                   LIKE 'gptimage2%'
               THEN 'banana2'
             WHEN REPLACE(REPLACE(REPLACE(LOWER(COALESCE(t.requested_model, '')), '-', ''), '_', ''), ' ', '')
                   LIKE 'gptimage2%'
               THEN 'gpt-image-2'
             ELSE NULL
           END AS canonical_model,
           CASE
             WHEN UPPER(TRIM(COALESCE(t.resolution, ''))) REGEXP '(^|:)1K$' THEN '1K'
             WHEN UPPER(TRIM(COALESCE(t.resolution, ''))) REGEXP '(^|:)2K$' THEN '2K'
             WHEN UPPER(TRIM(COALESCE(t.resolution, ''))) REGEXP '(^|:)4K$' THEN '4K'
             ELSE NULL
           END AS canonical_resolution
    FROM ym_image_task t
    WHERE UPPER(COALESCE(t.task_type, 'IMAGE')) = 'IMAGE'
  ) normalized
) priced;

-- Summary before applying.
SELECT IF(@apply = 1, 'APPLY', 'PREVIEW') AS mode,
       @run_id AS run_id,
       COUNT(*) AS scanned_rows,
       SUM(eligible) AS eligible_rows,
       SUM(eligible = 1 AND old_mi_cost <> new_mi_cost) AS changed_rows,
       SUM(old_mi_cost) AS old_total_mi,
       SUM(CASE WHEN eligible = 1 THEN new_mi_cost ELSE old_mi_cost END) AS corrected_total_mi,
       SUM(CASE WHEN eligible = 1 THEN new_mi_cost ELSE old_mi_cost END) - SUM(old_mi_cost) AS total_delta_mi
FROM tmp_ym_image_mi_recalculation;

-- Breakdown used for finance verification.
SELECT provider,
       canonical_model,
       canonical_resolution,
       status_group,
       COUNT(*) AS task_rows,
       SUM(old_mi_cost) AS old_mi,
       SUM(CASE WHEN eligible = 1 THEN new_mi_cost ELSE old_mi_cost END) AS corrected_mi,
       SUM(CASE WHEN eligible = 1 THEN new_mi_cost ELSE old_mi_cost END) - SUM(old_mi_cost) AS delta_mi
FROM tmp_ym_image_mi_recalculation
GROUP BY provider, canonical_model, canonical_resolution, status_group
ORDER BY task_rows DESC;

-- Successful rows skipped because the model or resolution has no configured price.
SELECT provider, model, requested_model, resolution, task_status, COUNT(*) AS skipped_rows
FROM tmp_ym_image_mi_recalculation
WHERE status_group = 'SUCCESS' AND unit_price IS NULL
GROUP BY provider, model, requested_model, resolution, task_status
ORDER BY skipped_rows DESC;

-- Create the rollback audit table only in APPLY mode.
SET @audit_ddl := IF(
  @apply = 1,
  'CREATE TABLE IF NOT EXISTS ym_image_task_mi_cost_adjust_log (
     run_id CHAR(36) NOT NULL,
     task_pk BIGINT NOT NULL,
     task_id VARCHAR(128) NOT NULL,
     old_mi_cost INT NOT NULL,
     new_mi_cost INT NOT NULL,
     provider VARCHAR(32) NULL,
     model VARCHAR(128) NULL,
     requested_model VARCHAR(128) NULL,
     resolution VARCHAR(32) NULL,
     task_status VARCHAR(32) NULL,
     adjusted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (run_id, task_pk),
     INDEX idx_mi_adjust_task_id (task_id)
   )',
  'SELECT 1'
);
PREPARE audit_ddl_stmt FROM @audit_ddl;
EXECUTE audit_ddl_stmt;
DEALLOCATE PREPARE audit_ddl_stmt;

START TRANSACTION;

SET @audit_dml := IF(
  @apply = 1,
  'INSERT INTO ym_image_task_mi_cost_adjust_log (
     run_id, task_pk, task_id, old_mi_cost, new_mi_cost,
     provider, model, requested_model, resolution, task_status
   )
   SELECT @run_id, task_pk, task_id, old_mi_cost, new_mi_cost,
          provider, model, requested_model, resolution, task_status
   FROM tmp_ym_image_mi_recalculation
   WHERE eligible = 1 AND old_mi_cost <> new_mi_cost',
  'SELECT 0'
);
PREPARE audit_dml_stmt FROM @audit_dml;
EXECUTE audit_dml_stmt;
DEALLOCATE PREPARE audit_dml_stmt;

SET @update_dml := IF(
  @apply = 1,
  'UPDATE ym_image_task task
   JOIN tmp_ym_image_mi_recalculation correction ON correction.task_pk = task.id
   SET task.mi_cost = correction.new_mi_cost
   WHERE correction.eligible = 1 AND correction.old_mi_cost <> correction.new_mi_cost',
  'SELECT 0'
);
PREPARE update_dml_stmt FROM @update_dml;
EXECUTE update_dml_stmt;
SET @updated_rows := IF(@apply = 1, ROW_COUNT(), 0);
DEALLOCATE PREPARE update_dml_stmt;
COMMIT;

SELECT IF(@apply = 1, 'APPLIED', 'PREVIEW_ONLY') AS result,
       @run_id AS rollback_run_id,
       @updated_rows AS updated_rows;

-- Rollback an applied run when necessary:
-- SET @rollback_run_id = 'run-id printed above';
-- UPDATE ym_image_task task
-- JOIN ym_image_task_mi_cost_adjust_log audit ON audit.task_pk = task.id
-- SET task.mi_cost = audit.old_mi_cost
-- WHERE audit.run_id = @rollback_run_id;
