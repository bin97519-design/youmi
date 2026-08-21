package com.youmi.api.selection;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class SelectionPoolRepositoryTest {
  private JdbcTemplate jdbcTemplate;
  private SelectionPoolRepository repository;

  @BeforeEach
  void setUp() {
    DriverManagerDataSource dataSource = new DriverManagerDataSource();
    dataSource.setDriverClassName("org.h2.Driver");
    dataSource.setUrl(
        "jdbc:h2:mem:selectionPool;MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE");
    dataSource.setUsername("sa");
    dataSource.setPassword("");
    jdbcTemplate = new JdbcTemplate(dataSource);
    resetSchema();
    repository = new SelectionPoolRepository(jdbcTemplate, new ObjectMapper());
  }

  @Test
  void paginatesNewestProductsAndKeepsUsersIsolated() {
    insertProduct(7L, "TAOBAO", "tb-1", "窗帘一", "COLLECTED", "UNPUBLISHED", false, 1);
    insertProduct(7L, "TMALL", "tm-2", "窗帘二", "COLLECTED", "PUBLISHED", true, 2);
    insertProduct(7L, "1688", "al-3", "床品三", "FAILED", "FAILED", false, 3);
    insertProduct(7L, "DOUYIN", "dy-4", "灯具四", "COLLECTING", "UNPUBLISHED", true, 4);
    insertProduct(8L, "TAOBAO", "other-1", "其他用户商品", "COLLECTED", "UNPUBLISHED", false, 5);

    List<SelectionProduct> firstPage =
        repository.list(7L, null, null, null, null, null, null, 1, 2);
    List<SelectionProduct> secondPage =
        repository.list(7L, null, null, null, null, null, null, 2, 2);

    assertEquals(List.of("dy-4", "al-3"), firstPage.stream().map(SelectionProduct::sourceProductId).toList());
    assertEquals(List.of("tm-2", "tb-1"), secondPage.stream().map(SelectionProduct::sourceProductId).toList());
    assertEquals(4L, repository.count(7L, null, null, null, null, null, null));
    assertTrue(firstPage.stream().allMatch(product -> product.userId().equals(7L)));
  }

  @Test
  void filtersByKeywordPlatformStatusesAiEditAndTag() {
    insertProduct(7L, "TAOBAO", "tb-curtain", "亚麻窗帘", "COLLECTED", "PUBLISHED", true, 1);
    insertProduct(7L, "TMALL", "tm-bed", "实木床", "COLLECTED", "UNPUBLISHED", false, 2);
    insertProduct(7L, "TAOBAO", "tb-failed", "遮光窗帘", "FAILED", "FAILED", false, 3);
    jdbcTemplate.update("INSERT INTO ym_selection_tag (id, user_id, name, color) VALUES (11, 7, '窗帘', '#22c3dc')");
    jdbcTemplate.update("INSERT INTO ym_selection_product_tag_rel (product_id, tag_id) VALUES (1, 11)");

    assertEquals(
        1,
        repository.list(7L, "亚麻", "TAOBAO", "COLLECTED", "PUBLISHED", 11L, true, 1, 20).size());
    assertEquals(2L, repository.count(7L, "窗帘", "TAOBAO", null, null, null, null));
    assertEquals(1L, repository.count(7L, "tm-bed", null, null, null, null, null));
    assertEquals(1L, repository.count(7L, null, null, "FAILED", "FAILED", null, false));
  }

  private void insertProduct(
      Long userId,
      String platform,
      String sourceProductId,
      String title,
      String collectStatus,
      String publishStatus,
      boolean hasAiEdit,
      int minute) {
    jdbcTemplate.update(
        """
        INSERT INTO ym_selection_product
          (user_id, source_platform, source_product_id, title, product_data, raw_snapshot,
           collect_source, collect_status, publish_status, has_ai_edit, quality_score,
           created_at, updated_at)
        VALUES (?, ?, ?, ?, '{}', '{}', 'MANUAL', ?, ?, ?, 80,
                TIMESTAMP '2026-08-21 10:00:00', DATEADD('MINUTE', ?, TIMESTAMP '2026-08-21 10:00:00'))
        """,
        userId,
        platform,
        sourceProductId,
        title,
        collectStatus,
        publishStatus,
        hasAiEdit,
        minute);
  }

  private void resetSchema() {
    jdbcTemplate.execute("DROP ALL OBJECTS");
    jdbcTemplate.execute(
        """
        CREATE TABLE ym_selection_product (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          user_id BIGINT NOT NULL,
          source_platform VARCHAR(32) NOT NULL,
          source_product_id VARCHAR(128) NOT NULL,
          source_url VARCHAR(1024),
          title VARCHAR(512) NOT NULL,
          cover_image_url VARCHAR(1024),
          product_data CLOB NOT NULL,
          raw_snapshot CLOB NOT NULL,
          collect_source VARCHAR(32) NOT NULL,
          collect_status VARCHAR(32) NOT NULL,
          publish_status VARCHAR(32) NOT NULL,
          has_ai_edit BOOLEAN NOT NULL DEFAULT FALSE,
          quality_score INT NOT NULL DEFAULT 0,
          origin_product_row_id BIGINT,
          origin_product_id VARCHAR(128),
          last_collect_error VARCHAR(1024),
          last_collected_at TIMESTAMP,
          created_at TIMESTAMP NOT NULL,
          updated_at TIMESTAMP NOT NULL,
          deleted_at TIMESTAMP
        )
        """);
    jdbcTemplate.execute(
        """
        CREATE TABLE ym_selection_tag (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          user_id BIGINT NOT NULL,
          name VARCHAR(32) NOT NULL,
          color VARCHAR(16) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """);
    jdbcTemplate.execute(
        """
        CREATE TABLE ym_selection_product_tag_rel (
          product_id BIGINT NOT NULL,
          tag_id BIGINT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (product_id, tag_id)
        )
        """);
  }
}
