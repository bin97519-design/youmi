package com.youmi.api.selection;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class SelectionPoolRepository {
  private static final String PRODUCT_COLUMNS = """
      id, user_id, source_platform, source_product_id, source_url, title, cover_image_url,
      product_data, raw_snapshot, collect_source, collect_status, publish_status, has_ai_edit,
      quality_score, origin_product_row_id, origin_product_id, last_collect_error,
      last_collected_at, created_at, updated_at
      """;

  private final JdbcTemplate jdbcTemplate;
  private final ObjectMapper objectMapper;

  public SelectionPoolRepository(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
    this.jdbcTemplate = jdbcTemplate;
    this.objectMapper = objectMapper;
  }

  public Optional<SelectionProduct> findById(Long userId, Long id) {
    List<SelectionProduct> rows = jdbcTemplate.query(
        "SELECT " + PRODUCT_COLUMNS + " FROM ym_selection_product WHERE user_id = ? AND id = ? AND deleted_at IS NULL",
        this::mapProduct, userId, id);
    return rows.stream().findFirst();
  }

  public Optional<SelectionProduct> findBySourceKey(Long userId, String platform, String productId) {
    List<SelectionProduct> rows = jdbcTemplate.query(
        "SELECT " + PRODUCT_COLUMNS + " FROM ym_selection_product WHERE user_id = ? AND source_platform = ? AND source_product_id = ?",
        this::mapProduct, userId, platform, productId);
    return rows.stream().findFirst();
  }

  public Long insert(
      Long userId, String platform, String productId, String sourceUrl, String title,
      String coverImageUrl, String productData, String rawSnapshot, String collectSource,
      String collectStatus, int qualityScore, Long originProductRowId, String originProductId) {
    KeyHolder keys = new GeneratedKeyHolder();
    jdbcTemplate.update(connection -> {
      PreparedStatement ps = connection.prepareStatement("""
          INSERT INTO ym_selection_product
            (user_id, source_platform, source_product_id, source_url, title, cover_image_url,
             product_data, raw_snapshot, collect_source, collect_status, publish_status,
             quality_score, origin_product_row_id, origin_product_id, last_collected_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNPUBLISHED', ?, ?, ?, ?)
          """, new String[] {"id"});
      ps.setLong(1, userId);
      ps.setString(2, platform);
      ps.setString(3, productId);
      ps.setString(4, sourceUrl);
      ps.setString(5, title);
      ps.setString(6, coverImageUrl);
      ps.setString(7, productData);
      ps.setString(8, rawSnapshot);
      ps.setString(9, collectSource);
      ps.setString(10, collectStatus);
      ps.setInt(11, qualityScore);
      if (originProductRowId == null) ps.setNull(12, java.sql.Types.BIGINT); else ps.setLong(12, originProductRowId);
      ps.setString(13, originProductId);
      ps.setTimestamp(14, "COLLECTED".equals(collectStatus) ? Timestamp.valueOf(LocalDateTime.now()) : null);
      return ps;
    }, keys);
    Number key = keys.getKey();
    if (key == null) throw new IllegalStateException("商品入库后未返回主键");
    return key.longValue();
  }

  public void updateCollected(
      Long id, String sourceUrl, String title, String coverImageUrl, String productData,
      String collectSource, String collectStatus, int qualityScore, Long originProductRowId,
      String originProductId) {
    jdbcTemplate.update("""
        UPDATE ym_selection_product
        SET source_url = ?, title = ?, cover_image_url = ?, product_data = ?, collect_source = ?,
            collect_status = ?, quality_score = ?, origin_product_row_id = ?, origin_product_id = ?,
            last_collect_error = NULL, last_collected_at = ?, deleted_at = NULL
        WHERE id = ?
        """, sourceUrl, title, coverImageUrl, productData, collectSource, collectStatus,
        qualityScore, originProductRowId, originProductId,
        "COLLECTED".equals(collectStatus) ? Timestamp.valueOf(LocalDateTime.now()) : null, id);
  }

  public void updateWorkingCopy(
      Long userId, Long id, String title, String coverImageUrl, String sourceUrl,
      String productData, boolean hasAiEdit, int qualityScore) {
    jdbcTemplate.update("""
        UPDATE ym_selection_product
        SET title = ?, cover_image_url = ?, source_url = ?, product_data = ?, has_ai_edit = ?, quality_score = ?
        WHERE user_id = ? AND id = ? AND deleted_at IS NULL
        """, title, coverImageUrl, sourceUrl, productData, hasAiEdit, qualityScore, userId, id);
  }

  public List<SelectionProduct> list(
      Long userId, String keyword, String platform, String collectStatus, String publishStatus,
      Long tagId, Boolean hasAiEdit, int page, int pageSize) {
    SqlAndArgs query = productFilter(userId, keyword, platform, collectStatus, publishStatus, tagId, hasAiEdit);
    query.sql.append(" ORDER BY p.updated_at DESC LIMIT ? OFFSET ?");
    query.args.add(pageSize);
    query.args.add((page - 1) * pageSize);
    return jdbcTemplate.query(query.sql.toString(), this::mapProduct, query.args.toArray());
  }

  public long count(
      Long userId, String keyword, String platform, String collectStatus, String publishStatus,
      Long tagId, Boolean hasAiEdit) {
    SqlAndArgs query = productFilter(userId, keyword, platform, collectStatus, publishStatus, tagId, hasAiEdit);
    String sql = query.sql.toString().replace("SELECT " + PRODUCT_COLUMNS + " FROM", "SELECT COUNT(*) FROM");
    Long count = jdbcTemplate.queryForObject(sql, Long.class, query.args.toArray());
    return count == null ? 0 : count;
  }

  private SqlAndArgs productFilter(
      Long userId, String keyword, String platform, String collectStatus, String publishStatus,
      Long tagId, Boolean hasAiEdit) {
    StringBuilder sql = new StringBuilder("SELECT ").append(PRODUCT_COLUMNS)
        .append(" FROM ym_selection_product p WHERE p.user_id = ? AND p.deleted_at IS NULL");
    List<Object> args = new ArrayList<>();
    args.add(userId);
    if (keyword != null) {
      sql.append(" AND (p.title LIKE ? OR p.source_product_id LIKE ?)");
      args.add("%" + keyword + "%");
      args.add("%" + keyword + "%");
    }
    if (platform != null) { sql.append(" AND p.source_platform = ?"); args.add(platform); }
    if (collectStatus != null) { sql.append(" AND p.collect_status = ?"); args.add(collectStatus); }
    if (publishStatus != null) { sql.append(" AND p.publish_status = ?"); args.add(publishStatus); }
    if (hasAiEdit != null) { sql.append(" AND p.has_ai_edit = ?"); args.add(hasAiEdit); }
    if (tagId != null) {
      sql.append(" AND EXISTS (SELECT 1 FROM ym_selection_product_tag_rel r WHERE r.product_id = p.id AND r.tag_id = ?)");
      args.add(tagId);
    }
    return new SqlAndArgs(sql, args);
  }

  public void insertRevision(Long productId, Long userId, String productData, String rawSnapshot, String changeType) {
    jdbcTemplate.update("""
        INSERT INTO ym_selection_product_revision
          (product_id, user_id, revision_no, product_data, raw_snapshot, change_type)
        SELECT ?, ?, COALESCE(MAX(revision_no), 0) + 1, ?, ?, ?
        FROM ym_selection_product_revision WHERE product_id = ?
        """, productId, userId, productData, rawSnapshot, changeType, productId);
  }

  public int softDelete(Long userId, List<Long> productIds) {
    if (productIds.isEmpty()) return 0;
    String placeholders = String.join(",", java.util.Collections.nCopies(productIds.size(), "?"));
    List<Object> args = new ArrayList<>();
    args.add(userId);
    args.addAll(productIds);
    return jdbcTemplate.update(
        "UPDATE ym_selection_product SET deleted_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id IN (" + placeholders + ")",
        args.toArray());
  }

  public Long insertTag(Long userId, String name, String color) {
    KeyHolder keys = new GeneratedKeyHolder();
    jdbcTemplate.update(connection -> {
      PreparedStatement ps = connection.prepareStatement(
          "INSERT INTO ym_selection_tag (user_id, name, color) VALUES (?, ?, ?)",
          new String[] {"id"});
      ps.setLong(1, userId); ps.setString(2, name); ps.setString(3, color);
      return ps;
    }, keys);
    return keys.getKey().longValue();
  }

  public boolean tagNameExists(Long userId, String name, Long excludeId) {
    Long count = excludeId == null
        ? jdbcTemplate.queryForObject("SELECT COUNT(*) FROM ym_selection_tag WHERE user_id = ? AND name = ?", Long.class, userId, name)
        : jdbcTemplate.queryForObject("SELECT COUNT(*) FROM ym_selection_tag WHERE user_id = ? AND name = ? AND id <> ?", Long.class, userId, name, excludeId);
    return count != null && count > 0;
  }

  public int updateTag(Long userId, Long id, String name, String color) {
    return jdbcTemplate.update("UPDATE ym_selection_tag SET name = ?, color = ? WHERE user_id = ? AND id = ?", name, color, userId, id);
  }

  public int deleteTag(Long userId, Long id) {
    jdbcTemplate.update("DELETE FROM ym_selection_product_tag_rel WHERE tag_id IN (SELECT id FROM ym_selection_tag WHERE user_id = ? AND id = ?)", userId, id);
    return jdbcTemplate.update("DELETE FROM ym_selection_tag WHERE user_id = ? AND id = ?", userId, id);
  }

  public List<SelectionPoolDtos.TagView> listTags(Long userId) {
    return jdbcTemplate.query("""
        SELECT t.id, t.name, t.color, COUNT(p.id) AS product_count
        FROM ym_selection_tag t
        LEFT JOIN ym_selection_product_tag_rel r ON r.tag_id = t.id
        LEFT JOIN ym_selection_product p ON p.id = r.product_id AND p.deleted_at IS NULL
        WHERE t.user_id = ? GROUP BY t.id, t.name, t.color ORDER BY t.created_at ASC
        """, (rs, rowNum) -> new SelectionPoolDtos.TagView(
            rs.getLong("id"), rs.getString("name"), rs.getString("color"), rs.getLong("product_count")), userId);
  }

  public List<SelectionPoolDtos.TagView> listTagsForProduct(Long userId, Long productId) {
    return jdbcTemplate.query("""
        SELECT t.id, t.name, t.color, 0 AS product_count FROM ym_selection_tag t
        INNER JOIN ym_selection_product_tag_rel r ON r.tag_id = t.id
        WHERE t.user_id = ? AND r.product_id = ? ORDER BY t.created_at ASC
        """, (rs, rowNum) -> new SelectionPoolDtos.TagView(
            rs.getLong("id"), rs.getString("name"), rs.getString("color"), 0), userId, productId);
  }

  public void replaceTags(Long userId, List<Long> productIds, List<Long> tagIds) {
    if (productIds.isEmpty()) return;
    String productMarks = String.join(",", java.util.Collections.nCopies(productIds.size(), "?"));
    List<Object> deleteArgs = new ArrayList<>();
    deleteArgs.add(userId); deleteArgs.addAll(productIds);
    jdbcTemplate.update("""
        DELETE FROM ym_selection_product_tag_rel
        WHERE product_id IN (SELECT id FROM ym_selection_product WHERE user_id = ? AND id IN (%s))
        """.formatted(productMarks), deleteArgs.toArray());
    for (Long productId : productIds) {
      for (Long tagId : tagIds) {
        jdbcTemplate.update("""
            INSERT INTO ym_selection_product_tag_rel (product_id, tag_id)
            SELECT p.id, t.id FROM ym_selection_product p, ym_selection_tag t
            WHERE p.id = ? AND p.user_id = ? AND p.deleted_at IS NULL AND t.id = ? AND t.user_id = ?
            """, productId, userId, tagId, userId);
      }
    }
  }

  public void createMigrationTask(
      String taskId, Long userId, String targetPlatform, String targetShopRef,
      String options, List<SelectionProduct> products) {
    jdbcTemplate.update("""
        INSERT INTO ym_product_migration_task
          (task_id, user_id, target_platform, target_shop_ref, status, total_count, options_json)
        VALUES (?, ?, ?, ?, 'QUEUED', ?, ?)
        """, taskId, userId, targetPlatform, targetShopRef, products.size(), options);
    int sequence = 0;
    for (SelectionProduct product : products) {
      jdbcTemplate.update("""
          INSERT INTO ym_product_migration_item
            (task_id, product_id, sequence_no, status, source_snapshot)
          VALUES (?, ?, ?, 'PENDING', ?)
          """, taskId, product.id(), ++sequence, migrationSnapshot(product));
    }
    String marks = String.join(",", java.util.Collections.nCopies(products.size(), "?"));
    List<Object> args = new ArrayList<>();
    args.add(userId); products.forEach(product -> args.add(product.id()));
    jdbcTemplate.update("UPDATE ym_selection_product SET publish_status = 'QUEUED' WHERE user_id = ? AND id IN (" + marks + ")", args.toArray());
  }

  public Optional<SelectionPoolDtos.MigrationTaskView> findMigrationTask(Long userId, String taskId) {
    List<SelectionPoolDtos.MigrationTaskView> rows = jdbcTemplate.query("""
        SELECT task_id, target_platform, target_shop_ref, status, total_count, success_count,
               failed_count, options_json, created_at, updated_at
        FROM ym_product_migration_task WHERE user_id = ? AND task_id = ?
        """, (rs, rowNum) -> new SelectionPoolDtos.MigrationTaskView(
            rs.getString("task_id"), rs.getString("target_platform"), rs.getString("target_shop_ref"),
            rs.getString("status"), rs.getInt("total_count"), rs.getInt("success_count"),
            rs.getInt("failed_count"), readJson(rs.getString("options_json")),
            time(rs, "created_at"), time(rs, "updated_at")),
        userId, taskId);
    return rows.stream().findFirst();
  }

  public List<SelectionPoolDtos.MigrationTaskView> listMigrationTasks(Long userId) {
    return jdbcTemplate.query("""
        SELECT task_id, target_platform, target_shop_ref, status, total_count, success_count,
               failed_count, options_json, created_at, updated_at
        FROM ym_product_migration_task
        WHERE user_id = ? AND status IN ('QUEUED', 'PUBLISHING')
        ORDER BY created_at DESC
        LIMIT 100
        """, (rs, rowNum) -> new SelectionPoolDtos.MigrationTaskView(
            rs.getString("task_id"), rs.getString("target_platform"), rs.getString("target_shop_ref"),
            rs.getString("status"), rs.getInt("total_count"), rs.getInt("success_count"),
            rs.getInt("failed_count"), readJson(rs.getString("options_json")),
            time(rs, "created_at"), time(rs, "updated_at")),
        userId);
  }

  public List<SelectionPoolDtos.MigrationItemHandoff> listMigrationHandoffItems(
      Long userId, String taskId) {
    return jdbcTemplate.query("""
        SELECT i.product_id, i.sequence_no, i.status, i.source_snapshot
        FROM ym_product_migration_item i
        JOIN ym_product_migration_task t ON t.task_id = i.task_id
        WHERE t.user_id = ? AND i.task_id = ? AND i.status IN ('PENDING', 'NEEDS_REVIEW')
        ORDER BY i.sequence_no
        """, (rs, rowNum) -> new SelectionPoolDtos.MigrationItemHandoff(
            rs.getLong("product_id"), rs.getInt("sequence_no"), rs.getString("status"),
            readJson(rs.getString("source_snapshot"))),
        userId, taskId);
  }

  public int claimMigrationTask(Long userId, String taskId) {
    return jdbcTemplate.update("""
        UPDATE ym_product_migration_task
        SET status = 'PUBLISHING'
        WHERE user_id = ? AND task_id = ? AND status IN ('QUEUED', 'PUBLISHING')
        """, userId, taskId);
  }

  public void updateMigrationItemResult(
      Long userId, String taskId, int sequenceNo, String status,
      String targetProductId, String targetUrl, String errorCode, String errorMessage) {
    List<Long> productIds = jdbcTemplate.queryForList("""
        SELECT i.product_id
        FROM ym_product_migration_item i
        JOIN ym_product_migration_task t ON t.task_id = i.task_id
        WHERE t.user_id = ? AND i.task_id = ? AND i.sequence_no = ?
        """, Long.class, userId, taskId, sequenceNo);
    if (productIds.isEmpty()) throw new com.youmi.api.common.ApiException(404, "搬家商品不存在");
    jdbcTemplate.update("""
        UPDATE ym_product_migration_item
        SET status = ?, target_product_id = ?, target_url = ?, error_code = ?, error_message = ?
        WHERE task_id = ? AND sequence_no = ?
        """, status, targetProductId, targetUrl, errorCode, errorMessage, taskId, sequenceNo);
    Long productId = productIds.get(0);
    String productStatus = switch (status) {
      case "PUBLISHED" -> "PUBLISHED";
      case "FAILED" -> "FAILED";
      default -> "QUEUED";
    };
    jdbcTemplate.update(
        "UPDATE ym_selection_product SET publish_status = ? WHERE user_id = ? AND id = ?",
        productStatus, userId, productId);
    Integer total = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM ym_product_migration_item WHERE task_id = ?", Integer.class, taskId);
    Integer success = jdbcTemplate.queryForObject("""
        SELECT COUNT(*) FROM ym_product_migration_item
        WHERE task_id = ? AND status IN ('PUBLISHED', 'DRAFTED')
        """, Integer.class, taskId);
    Integer failed = jdbcTemplate.queryForObject("""
        SELECT COUNT(*) FROM ym_product_migration_item
        WHERE task_id = ? AND status = 'FAILED'
        """, Integer.class, taskId);
    Integer pending = jdbcTemplate.queryForObject("""
        SELECT COUNT(*) FROM ym_product_migration_item
        WHERE task_id = ? AND status IN ('PENDING', 'NEEDS_REVIEW')
        """, Integer.class, taskId);
    String taskStatus = pending != null && pending > 0
        ? "PUBLISHING"
        : failed != null && failed > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED";
    jdbcTemplate.update("""
        UPDATE ym_product_migration_task
        SET status = ?, total_count = ?, success_count = ?, failed_count = ?,
            completed_at = CASE WHEN ? LIKE 'COMPLETED%' THEN CURRENT_TIMESTAMP ELSE NULL END
        WHERE user_id = ? AND task_id = ?
        """, taskStatus, total, success, failed, taskStatus, userId, taskId);
  }

  private SelectionProduct mapProduct(ResultSet rs, int rowNum) throws SQLException {
    return new SelectionProduct(
        rs.getLong("id"), rs.getLong("user_id"), rs.getString("source_platform"),
        rs.getString("source_product_id"), rs.getString("source_url"), rs.getString("title"),
        rs.getString("cover_image_url"), rs.getString("product_data"), rs.getString("raw_snapshot"),
        rs.getString("collect_source"), rs.getString("collect_status"), rs.getString("publish_status"),
        rs.getBoolean("has_ai_edit"), rs.getInt("quality_score"), nullableLong(rs, "origin_product_row_id"),
        rs.getString("origin_product_id"), rs.getString("last_collect_error"),
        localTime(rs, "last_collected_at"), localTime(rs, "created_at"), localTime(rs, "updated_at"));
  }

  private Long nullableLong(ResultSet rs, String field) throws SQLException {
    long value = rs.getLong(field);
    return rs.wasNull() ? null : value;
  }

  private LocalDateTime localTime(ResultSet rs, String field) throws SQLException {
    Timestamp value = rs.getTimestamp(field);
    return value == null ? null : value.toLocalDateTime();
  }

  private String time(ResultSet rs, String field) throws SQLException {
    LocalDateTime value = localTime(rs, field);
    return value == null ? null : value.toString();
  }

  private JsonNode readJson(String value) {
    if (value == null || value.isBlank()) return objectMapper.createObjectNode();
    try {
      return objectMapper.readTree(value);
    } catch (JsonProcessingException ignored) {
      return objectMapper.createObjectNode();
    }
  }

  private String migrationSnapshot(SelectionProduct product) {
    var snapshot = objectMapper.createObjectNode();
    snapshot.put("id", product.id());
    snapshot.put("sourcePlatform", product.sourcePlatform());
    snapshot.put("sourceProductId", product.sourceProductId());
    snapshot.put("sourceUrl", product.sourceUrl());
    snapshot.put("title", product.title());
    snapshot.put("coverImageUrl", product.coverImageUrl());
    snapshot.put("qualityScore", product.qualityScore());
    snapshot.set("productData", readJson(product.productData()));
    try {
      return objectMapper.writeValueAsString(snapshot);
    } catch (JsonProcessingException error) {
      throw new IllegalStateException("搬家商品快照序列化失败", error);
    }
  }

  private record SqlAndArgs(StringBuilder sql, List<Object> args) {}
}

