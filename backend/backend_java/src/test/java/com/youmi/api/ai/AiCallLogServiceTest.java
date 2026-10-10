package com.youmi.api.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class AiCallLogServiceTest {
  private AiCallLogService service;

  @BeforeEach
  void setUp() {
    JdbcTemplate jdbc = new JdbcTemplate(new DriverManagerDataSource(
        "jdbc:h2:mem:ai-call-log-" + System.nanoTime() + ";MODE=MySQL;DB_CLOSE_DELAY=-1", "sa", ""));
    jdbc.execute("CREATE TABLE ym_model_api_key (id BIGINT PRIMARY KEY, name VARCHAR(128))");
    jdbc.execute("""
        CREATE TABLE ym_ai_call_log (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          source VARCHAR(64), operation VARCHAR(32), provider VARCHAR(64), model VARCHAR(128),
          api_key_id BIGINT, selection_mode VARCHAR(24) DEFAULT 'system_default',
          status VARCHAR(16), http_status INT, duration_ms BIGINT, error_code VARCHAR(64),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """);
    jdbc.update("INSERT INTO ym_model_api_key(id, name) VALUES(?, ?)", 7L, "Vision primary");
    service = new AiCallLogService(jdbc);
  }

  @Test
  void storesSelectionModeAndJoinsCredentialNameWithoutExposingSecret() {
    service.record("canvas-layering", "image_segment", "router", "vision-model", 7L,
        "system_default", true, 200, 320, null);
    service.record("canvas-video", "video_generate", "router", "video-model", null,
        "dropdown", false, 502, 640, "ApiException");

    List<AiCallLogDtos.Row> rows = service.listRecent(10, null, null);
    assertEquals(2, rows.size());
    assertEquals("dropdown", rows.get(0).selectionMode());
    assertNull(rows.get(0).apiKeyName());
    assertEquals("system_default", rows.get(1).selectionMode());
    assertEquals("Vision primary", rows.get(1).apiKeyName());
    assertEquals(1, service.listRecent(10, "canvas-layering", "SUCCESS").size());
  }
}
