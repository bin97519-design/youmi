package com.youmi.api.canvas;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class CanvasRepository {
  private final JdbcTemplate jdbcTemplate;
  private final ObjectMapper objectMapper;

  public CanvasRepository(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
    this.jdbcTemplate = jdbcTemplate;
    this.objectMapper = objectMapper;
  }

  public List<CanvasDocument> findByUserId(Long userId) {
    String sql = """
        SELECT id, doc_id, user_id, title, payload_json, thumbnail_url, is_reverse_prompt, created_at, updated_at
        FROM ym_canvas_document
        WHERE user_id = ?
        ORDER BY updated_at DESC
        """;
    return jdbcTemplate.query(sql, this::mapRow, userId);
  }

  public Optional<CanvasDocument> findByDocIdAndUserId(String docId, Long userId) {
    String sql = """
        SELECT id, doc_id, user_id, title, payload_json, thumbnail_url, is_reverse_prompt, created_at, updated_at
        FROM ym_canvas_document
        WHERE doc_id = ? AND user_id = ?
        LIMIT 1
        """;
    List<CanvasDocument> docs = jdbcTemplate.query(sql, this::mapRow, docId, userId);
    return docs.stream().findFirst();
  }

  public void save(CanvasDocument doc) {
    String sql = """
        INSERT INTO ym_canvas_document (doc_id, user_id, title, payload_json, thumbnail_url, is_reverse_prompt)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          title = VALUES(title),
          payload_json = VALUES(payload_json),
          thumbnail_url = VALUES(thumbnail_url),
          is_reverse_prompt = VALUES(is_reverse_prompt)
        """;
    jdbcTemplate.update(sql, doc.docId(), doc.userId(), doc.title(), toJson(doc.payload()),
        doc.thumbnailUrl(), doc.isReversePrompt() ? 1 : 0);
  }

  public void deleteByDocIdAndUserId(String docId, Long userId) {
    jdbcTemplate.update("DELETE FROM ym_canvas_document WHERE doc_id = ? AND user_id = ?", docId, userId);
  }

  /**
   * 管理员全局查询：返回全部画布（跨用户）。
   * 注意：本方法不做 userId 过滤，必须仅在 requireAdmin 校验通过后由管理端调用。
   */
  public List<CanvasDocument> findAll() {
    String sql = """
        SELECT id, doc_id, user_id, title, payload_json, thumbnail_url, is_reverse_prompt, created_at, updated_at
        FROM ym_canvas_document
        ORDER BY updated_at DESC
        """;
    return jdbcTemplate.query(sql, this::mapRow);
  }

  /**
   * 管理员按 docId 全局查询单条画布（不限定 owner）。
   * 必须仅在 requireAdmin 校验通过后调用。
   */
  public Optional<CanvasDocument> findByDocId(String docId) {
    String sql = """
        SELECT id, doc_id, user_id, title, payload_json, thumbnail_url, is_reverse_prompt, created_at, updated_at
        FROM ym_canvas_document
        WHERE doc_id = ?
        LIMIT 1
        """;
    return jdbcTemplate.query(sql, this::mapRow, docId).stream().findFirst();
  }

  /**
   * 管理员按 docId 全局删除（不限定 owner）。
   * 必须仅在 requireAdmin 校验通过后调用。
   */
  public void deleteByDocId(String docId) {
    jdbcTemplate.update("DELETE FROM ym_canvas_document WHERE doc_id = ?", docId);
  }

  private CanvasDocument mapRow(ResultSet rs, int rowNum) throws SQLException {
    String payloadJson = rs.getString("payload_json");
    CanvasPayload payload;
    try {
      payload = objectMapper.readValue(payloadJson, CanvasPayload.class);
    } catch (JsonProcessingException e) {
      payload = new CanvasPayload();
    }
    return new CanvasDocument(
        rs.getLong("id"),
        rs.getString("doc_id"),
        rs.getLong("user_id"),
        rs.getString("title"),
        payload,
        rs.getString("thumbnail_url"),
        rs.getInt("is_reverse_prompt") == 1,
        rs.getTimestamp("created_at").toInstant().toEpochMilli(),
        rs.getTimestamp("updated_at").toInstant().toEpochMilli()
    );
  }

  private String toJson(Object obj) {
    try {
      return objectMapper.writeValueAsString(obj);
    } catch (JsonProcessingException e) {
      return "{}";
    }
  }
}
