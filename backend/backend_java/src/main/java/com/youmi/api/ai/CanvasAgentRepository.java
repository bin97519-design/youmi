package com.youmi.api.ai;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class CanvasAgentRepository {
  private static final TypeReference<List<Map<String, Object>>> MESSAGE_LIST_TYPE =
      new TypeReference<>() {};

  private final JdbcTemplate jdbcTemplate;
  private final ObjectMapper objectMapper;

  public CanvasAgentRepository(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
    this.jdbcTemplate = jdbcTemplate;
    this.objectMapper = objectMapper;
  }

  public List<CanvasAgentDtos.ConversationResponse> findConversations(
      Long userId, String canvasId) {
    String sql = """
        SELECT conversation_id, canvas_id, title, messages_json, created_at, updated_at
        FROM ym_agent_conversation
        WHERE user_id = ? AND canvas_id = ?
        ORDER BY updated_at DESC
        LIMIT 50
        """;
    return jdbcTemplate.query(sql, this::mapConversation, userId, canvasId);
  }

  public CanvasAgentDtos.ConversationResponse saveConversation(
      String conversationId,
      Long userId,
      String canvasId,
      String title,
      List<Map<String, Object>> messages) {
    String sql = """
        INSERT INTO ym_agent_conversation
          (conversation_id, user_id, canvas_id, title, messages_json)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          canvas_id = VALUES(canvas_id),
          title = VALUES(title),
          messages_json = VALUES(messages_json),
          updated_at = CURRENT_TIMESTAMP
        """;
    jdbcTemplate.update(
        sql,
        conversationId,
        userId,
        canvasId,
        title,
        toJson(messages));
    return jdbcTemplate.query(
        """
            SELECT conversation_id, canvas_id, title, messages_json, created_at, updated_at
            FROM ym_agent_conversation
            WHERE conversation_id = ? AND user_id = ? AND canvas_id = ?
            LIMIT 1
            """,
        this::mapConversation,
        conversationId,
        userId,
        canvasId).stream().findFirst().orElseThrow();
  }

  public void deleteConversation(String conversationId, Long userId, String canvasId) {
    jdbcTemplate.update(
        "DELETE FROM ym_agent_conversation WHERE conversation_id = ? AND user_id = ? AND canvas_id = ?",
        conversationId,
        userId,
        canvasId);
  }

  public void recordUsage(
      Long userId,
      String canvasId,
      String conversationId,
      String operation,
      String provider,
      String model,
      String status,
      long durationMs,
      int inputChars,
      int outputChars,
      int imageCount,
      String errorMessage) {
    jdbcTemplate.update(
        """
            INSERT INTO ym_agent_usage
              (user_id, canvas_id, conversation_id, operation, provider, model, status,
               duration_ms, input_chars, output_chars, image_count, error_message)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
        userId,
        blankToNull(canvasId),
        blankToNull(conversationId),
        operation,
        blankToNull(provider),
        blankToNull(model),
        status,
        Math.max(0, durationMs),
        Math.max(0, inputChars),
        Math.max(0, outputChars),
        Math.max(0, imageCount),
        truncate(errorMessage, 1000));
  }

  private CanvasAgentDtos.ConversationResponse mapConversation(ResultSet rs, int rowNum)
      throws SQLException {
    return new CanvasAgentDtos.ConversationResponse(
        rs.getString("conversation_id"),
        rs.getString("canvas_id"),
        rs.getString("title"),
        readMessages(rs.getString("messages_json")),
        rs.getTimestamp("created_at").toInstant().toEpochMilli(),
        rs.getTimestamp("updated_at").toInstant().toEpochMilli());
  }

  private List<Map<String, Object>> readMessages(String json) {
    if (json == null || json.isBlank()) return List.of();
    try {
      return objectMapper.readValue(json, MESSAGE_LIST_TYPE);
    } catch (JsonProcessingException error) {
      return List.of();
    }
  }

  private String toJson(List<Map<String, Object>> messages) {
    try {
      return objectMapper.writeValueAsString(messages == null ? List.of() : messages);
    } catch (JsonProcessingException error) {
      return "[]";
    }
  }

  private String blankToNull(String value) {
    return value == null || value.isBlank() ? null : value.trim();
  }

  private String truncate(String value, int maxLength) {
    if (value == null || value.isBlank()) return null;
    String cleaned = value.replaceAll("\\s+", " ").trim();
    return cleaned.length() > maxLength ? cleaned.substring(0, maxLength) : cleaned;
  }
}
