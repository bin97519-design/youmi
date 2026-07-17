package com.youmi.api.image;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class ImageTaskLogIsolationTest {
  private JdbcTemplate jdbcTemplate;
  private ImageTaskLogService service;

  @BeforeEach
  void setUp() {
    DriverManagerDataSource dataSource = new DriverManagerDataSource(
        "jdbc:h2:mem:imageTaskIsolation;MODE=MySQL;DB_CLOSE_DELAY=-1", "sa", "");
    jdbcTemplate = new JdbcTemplate(dataSource);
    jdbcTemplate.execute("DROP TABLE IF EXISTS ym_image_task");
    jdbcTemplate.execute("""
        CREATE TABLE ym_image_task (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          task_id VARCHAR(128) NOT NULL UNIQUE,
          client_task_id VARCHAR(128),
          user_id BIGINT,
          provider VARCHAR(64), model VARCHAR(64), requested_model VARCHAR(64),
          size VARCHAR(32), resolution VARCHAR(32), requested_count INT,
          status VARCHAR(32), progress INT DEFAULT 0, image_count INT DEFAULT 0,
          mi_cost INT DEFAULT 0, money_cost DECIMAL(12, 4), image_urls CLOB,
          error_message CLOB, raw_response CLOB, completed_at TIMESTAMP NULL
        )
        """);
    service = new ImageTaskLogService(jdbcTemplate, new ObjectMapper());
  }

  @Test
  void clientTaskLookupAndTaskOwnershipAreUserScoped() {
    insert("task-a", "same-client-id", 101L, "banana2");
    insert("task-b", "same-client-id", 202L, "gpt-image-2");

    ImageTaskLogService.ExistingTask taskA =
        service.findExistingByClientTaskId(101L, "same-client-id");
    ImageTaskLogService.ExistingTask taskB =
        service.findExistingByClientTaskId(202L, "same-client-id");

    assertNotNull(taskA);
    assertNotNull(taskB);
    assertEquals("task-a", taskA.taskId);
    assertEquals("task-b", taskB.taskId);
    assertTrue(service.isOwnedByUser(101L, "task-a"));
    assertFalse(service.isOwnedByUser(202L, "task-a"));
  }

  @Test
  void firstAvailableImageFreezesGenerationCompletionTime() throws Exception {
    insert("task-a", "client-a", 101L, "banana2");
    ImageGenerationDtos.TaskStatusResponse persisting = new ImageGenerationDtos.TaskStatusResponse(
        "gettoken", "task-a", "persisting", 100, List.of("https://cdn.example.com/result.png"), null, null);

    service.recordStatus(persisting);
    Timestamp firstCompletedAt = jdbcTemplate.queryForObject(
        "SELECT completed_at FROM ym_image_task WHERE task_id = 'task-a'", Timestamp.class);
    Thread.sleep(10);
    service.recordStatus(persisting);
    Timestamp secondCompletedAt = jdbcTemplate.queryForObject(
        "SELECT completed_at FROM ym_image_task WHERE task_id = 'task-a'", Timestamp.class);

    assertNotNull(firstCompletedAt);
    assertEquals(firstCompletedAt, secondCompletedAt);
    assertEquals(1, jdbcTemplate.queryForObject(
        "SELECT image_count FROM ym_image_task WHERE task_id = 'task-a'", Integer.class));
  }

  private void insert(String taskId, String clientTaskId, Long userId, String model) {
    jdbcTemplate.update("""
        INSERT INTO ym_image_task
          (task_id, client_task_id, user_id, provider, model, requested_model,
           size, resolution, requested_count, status, raw_response)
        VALUES (?, ?, ?, 'test', ?, ?, '1:1', '1K', 1, 'submitted', '{}')
        """, taskId, clientTaskId, userId, model, model);
  }
}
