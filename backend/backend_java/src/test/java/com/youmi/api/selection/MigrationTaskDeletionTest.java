package com.youmi.api.selection;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class MigrationTaskDeletionTest {
  private JdbcTemplate jdbc;
  private SelectionPoolRepository repository;

  @BeforeEach
  void setup() {
    var ds = new DriverManagerDataSource("jdbc:h2:mem:taskDelete;MODE=MySQL;DB_CLOSE_DELAY=-1", "sa", "");
    jdbc = new JdbcTemplate(ds);
    jdbc.execute("DROP ALL OBJECTS");
    jdbc.execute("""
        CREATE TABLE ym_product_migration_task (task_id VARCHAR(64) PRIMARY KEY, user_id BIGINT,
          status VARCHAR(32), target_platform VARCHAR(32) DEFAULT 'JD', target_shop_ref VARCHAR(64),
          total_count INT DEFAULT 1, success_count INT DEFAULT 0, failed_count INT DEFAULT 0,
          options_json CLOB, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, completed_at TIMESTAMP)
        """);
    jdbc.execute("""
        CREATE TABLE ym_product_migration_item (task_id VARCHAR(64), product_id BIGINT,
          sequence_no INT DEFAULT 1, status VARCHAR(32) DEFAULT 'PENDING', source_snapshot CLOB DEFAULT '{}')
        """);
    jdbc.execute("CREATE TABLE ym_selection_product (id BIGINT PRIMARY KEY, user_id BIGINT, publish_status VARCHAR(32), title VARCHAR(100))");
    jdbc.update("INSERT INTO ym_selection_product VALUES (1, 7, 'QUEUED', '保留商品')");
    repository = new SelectionPoolRepository(jdbc, new ObjectMapper());
  }

  private void task(String id, long user, String status) {
    jdbc.update("INSERT INTO ym_product_migration_task (task_id,user_id,status) VALUES (?,?,?)", id, user, status);
    jdbc.update("INSERT INTO ym_product_migration_item (task_id,product_id) VALUES (?,1)", id);
  }

  private String state(String id) {
    return jdbc.queryForObject("SELECT status FROM ym_product_migration_task WHERE task_id=?", String.class, id);
  }

  @Test void deletesOnlyOwnedPendingTasksAndIsRetryable() {
    task("one", 7, "QUEUED"); task("other", 8, "PUBLISHING"); task("done", 7, "COMPLETED");
    assertEquals(List.of("one"), repository.deleteMigrationTasks(7L, List.of("one", "other", "done"), false));
    assertEquals("DELETED", state("one"));
    assertEquals("PUBLISHING", state("other"));
    assertEquals("COMPLETED", state("done"));
    assertEquals(List.of("one"), repository.deleteMigrationTasks(7L, List.of("one"), false));
    assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM ym_selection_product", Integer.class));
    assertEquals(3, jdbc.queryForObject("SELECT COUNT(*) FROM ym_product_migration_item", Integer.class));
  }

  @Test void clearAllHasNoHundredRowLimitAndKeepsCompletedTasks() {
    for (int i = 0; i < 105; i++) task("pending_" + i, 7, "PUBLISHING");
    task("done", 7, "COMPLETED"); task("other", 8, "QUEUED");
    assertEquals(100, repository.listMigrationTasks(7L).size());
    assertEquals(105, repository.deleteMigrationTasks(7L, List.of(), true).size());
    assertTrue(repository.listMigrationTasks(7L).isEmpty());
    assertEquals("COMPLETED", state("done")); assertEquals("QUEUED", state("other"));
  }

  @Test void deletionPreventsClaimHandoffAndLateCallback() {
    task("one", 7, "PUBLISHING");
    repository.deleteMigrationTasks(7L, List.of("one"), false);
    assertEquals(0, repository.claimMigrationTask(7L, "one"));
    assertTrue(repository.listMigrationHandoffItems(7L, "one").isEmpty());
    assertThrows(ApiException.class, () -> repository.updateMigrationItemResult(7L, "one", 1, "PUBLISHED", null, null, null, null));
    assertEquals("DELETED", state("one"));
  }

  @Test void productStatusRespectsOtherTasksAndPublishedHistory() {
    task("one", 7, "QUEUED"); task("two", 7, "QUEUED");
    repository.deleteMigrationTasks(7L, List.of("one"), false);
    assertEquals("QUEUED", jdbc.queryForObject("SELECT publish_status FROM ym_selection_product WHERE id=1", String.class));
    task("history", 7, "COMPLETED");
    jdbc.update("UPDATE ym_product_migration_item SET status='PUBLISHED' WHERE task_id='history'");
    repository.deleteMigrationTasks(7L, List.of("two"), false);
    assertEquals("PUBLISHED", jdbc.queryForObject("SELECT publish_status FROM ym_selection_product WHERE id=1", String.class));
  }

  @Test void validatesBulkDeleteScope() {
    var service = new SelectionPoolService(repository, new ObjectMapper());
    assertThrows(ApiException.class, () -> service.deleteMigrationTasks(7L, new SelectionPoolDtos.MigrationDeleteRequest(List.of(), false)));
    assertThrows(ApiException.class, () -> service.deleteMigrationTasks(7L, new SelectionPoolDtos.MigrationDeleteRequest(List.of("one"), true)));
    assertThrows(ApiException.class, () -> service.deleteMigrationTasks(7L, new SelectionPoolDtos.MigrationDeleteRequest(List.of("../one"), false)));
  }
}
