package com.youmi.api.selection;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.ArrayList;
import java.sql.Connection;
import java.sql.SQLException;
import java.lang.reflect.Proxy;
import java.lang.reflect.InvocationTargetException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class SelectionPoolRepositoryTest {
  private JdbcTemplate jdbcTemplate;
  private SelectionPoolRepository repository;
  private final List<String> queries = new ArrayList<>();

  @BeforeEach
  void setUp() {
    DriverManagerDataSource dataSource = new DriverManagerDataSource() {
      @Override public Connection getConnection() throws SQLException {
        Connection delegate = super.getConnection();
        return (Connection) Proxy.newProxyInstance(Connection.class.getClassLoader(),
            new Class<?>[] {Connection.class}, (proxy, method, args) -> {
              if (method.getName().equals("prepareStatement") && args[0] instanceof String sql) queries.add(sql);
              try { return method.invoke(delegate, args); }
              catch (InvocationTargetException error) { throw error.getCause(); }
            });
      }
    };
    dataSource.setDriverClassName("org.h2.Driver");
    dataSource.setUrl(
        "jdbc:h2:mem:selectionPool;MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE");
    dataSource.setUsername("sa");
    dataSource.setPassword("");
    jdbcTemplate = new JdbcTemplate(dataSource);
    resetSchema();
    repository = new SelectionPoolRepository(jdbcTemplate, new ObjectMapper());
    queries.clear();
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
    assertEquals(1, repository.listSummaries(7L, "亚麻", "TAOBAO", "COLLECTED", "PUBLISHED", 11L, true, 1, 20).size());
  }

  @Test
  void compactPageUsesThreeQueriesNoRawSnapshotAndReturnsOnlyMetadata() throws Exception {
    ObjectMapper mapper = new ObjectMapper();
    var data = mapper.createObjectNode();
    data.put("productType", "COLLECTED");
    data.putObject("category").put("name", "椰棕床垫");
    data.putObject("skuSplit").put("part", 1).put("groupName", "颜色分类");
    var groups = data.putArray("skuGroups");
    groups.addObject().put("name", "尺寸"); groups.addObject().put("name", "颜色分类");
    var skus = data.putArray("skus");
    for (int i = 0; i < 495; i++) {
      skus.addObject().put("skuId", "sku-" + i).put("quantity", i).put("price", "98.5")
          .put("imageUrl", "https://images.test/" + i).put("name", "尺寸和颜色测试组合-" + i);
    }
    data.set("sku", skus.deepCopy()); data.set("skuList", skus.deepCopy());
    data.putArray("images").add("https://images.test/cover.jpg");
    for (int i = 1; i <= 20; i++) {
      insertProduct(7L, "TMALL", "tm-" + i, "床垫" + i, "COLLECTED", "UNPUBLISHED", false, i);
    }
    jdbcTemplate.update("UPDATE ym_selection_product SET product_data=?, raw_snapshot=?", data.toString(), data.toString());
    insertProduct(8L, "TMALL", "foreign", "其他账号", "COLLECTED", "UNPUBLISHED", false, 21);
    jdbcTemplate.update("INSERT INTO ym_selection_tag (id,user_id,name,color) VALUES (11,7,'我的标签','#fff'), (12,8,'他人标签','#000')");
    jdbcTemplate.update("INSERT INTO ym_selection_product_tag_rel (product_id,tag_id) VALUES (20,11),(20,12),(21,11)");
    var service = new SelectionPoolService(repository, mapper);
    queries.clear();
    var compact = service.listCompact(7L, null, null, null, null, null, null, 1, 20);
    assertEquals(3, queries.size(), queries.toString());
    assertTrue(queries.stream().noneMatch(sql -> sql.contains("raw_snapshot")));
    assertEquals(20, compact.total());
    assertEquals(20, compact.items().size());
    var first = compact.items().get(0);
    assertEquals(495, first.listMeta().skuCount());
    assertEquals(2, first.listMeta().skuGroupCount());
    assertEquals("椰棕床垫", first.listMeta().categoryName());
    assertEquals("颜色分类", first.listMeta().skuSplit().groupName());
    assertEquals("https://images.test/cover.jpg", first.coverImageUrl());
    assertEquals(List.of("我的标签"), first.tags().stream().map(SelectionPoolDtos.TagView::name).toList());
    assertFalse(repository.listTagsForProducts(7L, List.of(20L, 21L)).containsKey(21L));
    var json = mapper.valueToTree(compact);
    assertFalse(json.path("items").get(0).has("productData"));
    assertFalse(json.path("items").get(0).has("rawSnapshot"));
    queries.clear();
    var full = service.list(7L, null, null, null, null, null, null, 1, 20);
    assertEquals(3, queries.size(), "Even legacy full lists use batched tags");
    int compactBytes = mapper.writeValueAsBytes(compact).length;
    int fullBytes = mapper.writeValueAsBytes(full).length;
    assertTrue(compactBytes < fullBytes / 20, compactBytes + " vs " + fullBytes);
    System.out.printf("SELECTION_LIST_FIXTURE: rows=20 skuEach=495 queries=3 compactBytes=%d fullBytes=%d%n", compactBytes, fullBytes);
    var detail = service.get(7L, first.id());
    assertEquals(495, detail.productData().path("skus").size());
    assertEquals(data, detail.rawSnapshot());
    assertTrue(repository.findById(8L, first.id()).isEmpty());
  }

  @Test
  void summaryPaginationIsStableAndSoftDeletesRemainHidden() {
    for (int i = 0; i < 4; i++) insertProduct(7L, "TMALL", "p" + i, "商品", "COLLECTED", "UNPUBLISHED", false, 1);
    repository.softDelete(7L, List.of(3L));
    var service = new SelectionPoolService(repository, new ObjectMapper());
    assertEquals(List.of(4L, 2L), service.listCompact(7L, null, null, null, null, null, null, 1, 2)
        .items().stream().map(SelectionPoolDtos.ProductSummaryView::id).toList());
    assertEquals(List.of(1L), service.listCompact(7L, null, null, null, null, null, null, 2, 2)
        .items().stream().map(SelectionPoolDtos.ProductSummaryView::id).toList());
    queries.clear();
    assertTrue(service.listCompact(7L, null, null, null, null, null, null, 50, 2).items().isEmpty());
    assertEquals(2, queries.size(), "Empty pages don't query tags");
    assertEquals(100, service.listCompact(7L, null, null, null, null, null, null, 0, 500).pageSize());
  }

  @Test
  void appendsVideoWithoutLosingProductDataAndDoesNotDuplicate() throws Exception {
    jdbcTemplate.execute("CREATE TABLE ym_selection_product_revision (product_id BIGINT, user_id BIGINT, revision_no INT, product_data CLOB, raw_snapshot CLOB, change_type VARCHAR(32))");
    insertProduct(7L, "TMALL", "curtain", "窗帘", "COLLECTED", "UNPUBLISHED", false, 1);
    jdbcTemplate.update("UPDATE ym_selection_product SET product_data = ? WHERE id = 1",
        "{\"customField\":42,\"media\":{\"mainImages\":[\"image.png\"],\"mainVideos\":[\"old.mp4\"]},\"skuGroups\":[{\"name\":\"color\",\"values\":[{\"name\":\"green\"}]}]}");
    var service = new SelectionPoolService(repository, new ObjectMapper());
    var first = service.appendMainVideo(7L, 1L, "new.mp4");
    var second = service.appendMainVideo(7L, 1L, "new.mp4");
    assertEquals(42, first.productData().path("customField").asInt());
    assertEquals("image.png", first.productData().path("media").path("mainImages").get(0).asText());
    assertEquals(1, first.productData().path("skuGroups").size());
    assertEquals(2, second.productData().path("media").path("mainVideos").size());
    assertTrue(second.hasAiEdit());
    assertEquals(1, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM ym_selection_product_revision", Integer.class));
    assertThrows(com.youmi.api.common.ApiException.class, () -> service.appendMainVideo(8L, 1L, "other.mp4"));
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
