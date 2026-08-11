package com.youmi.api.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class CanvasAgentRepositoryTest {
  private JdbcTemplate jdbcTemplate;
  private CanvasAgentRepository repository;

  @BeforeEach
  void setUp() {
    DriverManagerDataSource dataSource = new DriverManagerDataSource();
    dataSource.setDriverClassName("org.h2.Driver");
    dataSource.setUrl("jdbc:h2:mem:agentRepository;MODE=MySQL;DB_CLOSE_DELAY=-1");
    dataSource.setUsername("sa");
    dataSource.setPassword("");
    jdbcTemplate = new JdbcTemplate(dataSource);
    jdbcTemplate.execute("DROP TABLE IF EXISTS ym_agent_conversation");
    jdbcTemplate.execute("DROP TABLE IF EXISTS ym_agent_usage");
    jdbcTemplate.execute("""
        CREATE TABLE ym_agent_conversation (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          conversation_id VARCHAR(128) NOT NULL,
          user_id BIGINT NOT NULL,
          canvas_id VARCHAR(64) NOT NULL,
          title VARCHAR(256) NOT NULL,
          messages_json CLOB NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (conversation_id, user_id, canvas_id)
        )
        """);
    jdbcTemplate.execute("""
        CREATE TABLE ym_agent_usage (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          user_id BIGINT NOT NULL,
          canvas_id VARCHAR(64),
          conversation_id VARCHAR(128),
          operation VARCHAR(32) NOT NULL,
          provider VARCHAR(64),
          model VARCHAR(128),
          status VARCHAR(20) NOT NULL,
          duration_ms BIGINT NOT NULL,
          input_chars INT NOT NULL,
          output_chars INT NOT NULL,
          image_count INT NOT NULL,
          error_message VARCHAR(1000),
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """);
    repository = new CanvasAgentRepository(jdbcTemplate, new ObjectMapper());
  }

  @Test
  void isolatesConversationHistoryByUserAndPersistsUsage() {
    repository.saveConversation(
        "agent-shared",
        1L,
        "canvas-a",
        "用户一对话",
        List.of(Map.of("id", "m1", "role", "user", "text", "用户一内容")));
    repository.saveConversation(
        "agent-shared",
        2L,
        "canvas-a",
        "用户二对话",
        List.of(Map.of("id", "m2", "role", "user", "text", "用户二内容")));
    repository.saveConversation(
        "agent-shared",
        1L,
        "canvas-b",
        "用户一另一画布",
        List.of(Map.of("id", "m3", "role", "user", "text", "另一画布内容")));

    var userOne = repository.findConversations(1L, "canvas-a");
    var userTwo = repository.findConversations(2L, "canvas-a");
    assertEquals(1, userOne.size());
    assertEquals("用户一内容", userOne.get(0).messages().get(0).get("text"));
    assertEquals("用户二内容", userTwo.get(0).messages().get(0).get("text"));

    repository.deleteConversation("agent-shared", 1L, "canvas-a");
    assertEquals(0, repository.findConversations(1L, "canvas-a").size());
    assertEquals(1, repository.findConversations(1L, "canvas-b").size());
    assertEquals(1, repository.findConversations(2L, "canvas-a").size());

    repository.recordUsage(
        2L,
        "canvas-a",
        "agent-shared",
        "CHAT",
        "teamorouter",
        "gpt-5.6-luna",
        "SUCCESS",
        1234,
        20,
        80,
        0,
        "");
    assertEquals(
        1,
        jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM ym_agent_usage WHERE user_id = 2 AND operation = 'CHAT'",
            Integer.class));
  }
}
