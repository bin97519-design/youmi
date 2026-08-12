package com.youmi.api.prompt;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class PromptLibraryRepositoryTest {
  private JdbcTemplate jdbcTemplate;
  private PromptLibraryRepository repository;

  @BeforeEach
  void setUp() {
    DriverManagerDataSource dataSource = new DriverManagerDataSource();
    dataSource.setDriverClassName("org.h2.Driver");
    dataSource.setUrl("jdbc:h2:mem:promptLibrary;MODE=MySQL;DB_CLOSE_DELAY=-1");
    dataSource.setUsername("sa");
    dataSource.setPassword("");
    jdbcTemplate = new JdbcTemplate(dataSource);
    jdbcTemplate.execute("DROP TABLE IF EXISTS ym_prompt_library_usage");
    jdbcTemplate.execute("DROP TABLE IF EXISTS ym_prompt_library");
    jdbcTemplate.execute("""
        CREATE TABLE ym_prompt_library (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          user_id BIGINT,
          scope VARCHAR(16) NOT NULL,
          template_key VARCHAR(64),
          title VARCHAR(128) NOT NULL,
          content CLOB NOT NULL,
          category VARCHAR(32) NOT NULL,
          tags_json CLOB,
          source VARCHAR(32) NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (template_key)
        )
        """);
    jdbcTemplate.execute("""
        CREATE TABLE ym_prompt_library_usage (
          prompt_id BIGINT NOT NULL,
          user_id BIGINT NOT NULL,
          use_count INT NOT NULL DEFAULT 0,
          last_used_at TIMESTAMP,
          PRIMARY KEY (prompt_id, user_id)
        )
        """);
    repository = new PromptLibraryRepository(jdbcTemplate, new ObjectMapper());
  }

  @Test
  void isolatesPersonalPromptsAndTracksRecentUsePerUser() {
    jdbcTemplate.update(
        """
            INSERT INTO ym_prompt_library
              (user_id, scope, template_key, title, content, category, tags_json, source)
            VALUES (NULL, 'PUBLIC', 'official-main', '公共主图', '公共提示词',
                    'MAIN_IMAGE', '["公共"]', 'PUBLIC')
            """);
    var userOnePrompt = repository.createPersonal(
        1L, "用户一", "用户一内容", "GENERAL", List.of("个人"), "MANUAL");
    var userTwoPrompt = repository.createPersonal(
        2L, "用户二", "用户二内容", "DETAIL", List.of("详情页"), "AGENT");

    var userOneVisible = repository.findVisible(1L, "all", "", "ALL");
    assertEquals(2, userOneVisible.size());
    assertTrue(userOneVisible.stream().anyMatch(item -> item.title().equals("公共主图")));
    assertTrue(userOneVisible.stream().anyMatch(item -> item.id().equals(userOnePrompt.id())));
    assertFalse(userOneVisible.stream().anyMatch(item -> item.id().equals(userTwoPrompt.id())));

    assertTrue(repository.updatePersonal(
        userOnePrompt.id(), 2L, "越权修改", "错误内容", "OTHER", List.of(), "MANUAL").isEmpty());
    assertFalse(repository.deletePersonal(userOnePrompt.id(), 2L));

    repository.markUsed(userOnePrompt.id(), 1L).orElseThrow();
    repository.markUsed(userOnePrompt.id(), 1L).orElseThrow();
    assertEquals(1, repository.findVisible(1L, "recent", "", "ALL").size());
    assertEquals(2, repository.findVisible(1L, "recent", "", "ALL").get(0).useCount());
    assertEquals(0, repository.findVisible(2L, "recent", "", "ALL").size());
  }
}
