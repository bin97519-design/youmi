package com.youmi.api.prompt;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class PromptLibraryRepository {
  private static final TypeReference<List<String>> TAG_LIST_TYPE = new TypeReference<>() {};

  private final JdbcTemplate jdbcTemplate;
  private final ObjectMapper objectMapper;

  public PromptLibraryRepository(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
    this.jdbcTemplate = jdbcTemplate;
    this.objectMapper = objectMapper;
  }

  public List<PromptLibraryDtos.PromptResponse> findVisible(
      Long userId, String view, String query, String category) {
    StringBuilder sql = new StringBuilder("""
        SELECT p.id, p.scope, p.title, p.content, p.category, p.tags_json, p.source,
               COALESCE(u.use_count, 0) AS use_count, u.last_used_at,
               p.created_at, p.updated_at
        FROM ym_prompt_library p
        LEFT JOIN ym_prompt_library_usage u ON u.prompt_id = p.id AND u.user_id = ?
        WHERE (p.scope = 'PUBLIC' OR (p.scope = 'PERSONAL' AND p.user_id = ?))
        """);
    List<Object> args = new ArrayList<>();
    args.add(userId);
    args.add(userId);

    if ("mine".equals(view)) {
      sql.append(" AND p.scope = 'PERSONAL' AND p.user_id = ?");
      args.add(userId);
    } else if ("public".equals(view)) {
      sql.append(" AND p.scope = 'PUBLIC'");
    } else if ("recent".equals(view)) {
      sql.append(" AND u.last_used_at IS NOT NULL");
    }

    if (category != null && !category.isBlank() && !"ALL".equals(category)) {
      sql.append(" AND p.category = ?");
      args.add(category);
    }
    if (query != null && !query.isBlank()) {
      sql.append(" AND (LOWER(p.title) LIKE ? OR LOWER(p.content) LIKE ? OR LOWER(p.tags_json) LIKE ?)");
      String pattern = "%" + query.trim().toLowerCase() + "%";
      args.add(pattern);
      args.add(pattern);
      args.add(pattern);
    }

    if ("recent".equals(view)) {
      sql.append(" ORDER BY u.last_used_at DESC, p.updated_at DESC");
    } else {
      sql.append(" ORDER BY CASE WHEN p.scope = 'PERSONAL' THEN 0 ELSE 1 END, p.updated_at DESC");
    }
    sql.append(" LIMIT 300");
    return jdbcTemplate.query(sql.toString(), this::mapPrompt, args.toArray());
  }

  public PromptLibraryDtos.PromptResponse createPersonal(
      Long userId,
      String title,
      String content,
      String category,
      List<String> tags,
      String source) {
    KeyHolder keyHolder = new GeneratedKeyHolder();
    jdbcTemplate.update(connection -> {
      var statement = connection.prepareStatement(
          """
              INSERT INTO ym_prompt_library
                (user_id, scope, title, content, category, tags_json, source)
              VALUES (?, 'PERSONAL', ?, ?, ?, ?, ?)
              """,
          new String[] {"id"});
      statement.setLong(1, userId);
      statement.setString(2, title);
      statement.setString(3, content);
      statement.setString(4, category);
      statement.setString(5, toJson(tags));
      statement.setString(6, source);
      return statement;
    }, keyHolder);
    Long id = keyHolder.getKey().longValue();
    return findVisibleById(id, userId).orElseThrow();
  }

  public Optional<PromptLibraryDtos.PromptResponse> updatePersonal(
      Long id,
      Long userId,
      String title,
      String content,
      String category,
      List<String> tags,
      String source) {
    int changed = jdbcTemplate.update(
        """
            UPDATE ym_prompt_library
            SET title = ?, content = ?, category = ?, tags_json = ?, source = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ? AND scope = 'PERSONAL'
            """,
        title,
        content,
        category,
        toJson(tags),
        source,
        id,
        userId);
    return changed == 0 ? Optional.empty() : findVisibleById(id, userId);
  }

  public boolean deletePersonal(Long id, Long userId) {
    int changed = jdbcTemplate.update(
        "DELETE FROM ym_prompt_library WHERE id = ? AND user_id = ? AND scope = 'PERSONAL'",
        id,
        userId);
    if (changed > 0) {
      jdbcTemplate.update("DELETE FROM ym_prompt_library_usage WHERE prompt_id = ?", id);
    }
    return changed > 0;
  }

  public Optional<PromptLibraryDtos.PromptResponse> markUsed(Long id, Long userId) {
    if (findVisibleById(id, userId).isEmpty()) return Optional.empty();
    jdbcTemplate.update(
        """
            INSERT INTO ym_prompt_library_usage (prompt_id, user_id, use_count, last_used_at)
            VALUES (?, ?, 1, CURRENT_TIMESTAMP)
            ON DUPLICATE KEY UPDATE
              use_count = use_count + 1,
              last_used_at = CURRENT_TIMESTAMP
            """,
        id,
        userId);
    return findVisibleById(id, userId);
  }

  public Optional<PromptLibraryDtos.PromptResponse> findVisibleById(Long id, Long userId) {
    String sql = """
        SELECT p.id, p.scope, p.title, p.content, p.category, p.tags_json, p.source,
               COALESCE(u.use_count, 0) AS use_count, u.last_used_at,
               p.created_at, p.updated_at
        FROM ym_prompt_library p
        LEFT JOIN ym_prompt_library_usage u ON u.prompt_id = p.id AND u.user_id = ?
        WHERE p.id = ? AND (p.scope = 'PUBLIC' OR (p.scope = 'PERSONAL' AND p.user_id = ?))
        LIMIT 1
        """;
    return jdbcTemplate.query(sql, this::mapPrompt, userId, id, userId)
        .stream().findFirst();
  }

  private PromptLibraryDtos.PromptResponse mapPrompt(ResultSet rs, int rowNum)
      throws SQLException {
    Timestamp lastUsedAt = rs.getTimestamp("last_used_at");
    return new PromptLibraryDtos.PromptResponse(
        rs.getLong("id"),
        rs.getString("scope"),
        rs.getString("title"),
        rs.getString("content"),
        rs.getString("category"),
        readTags(rs.getString("tags_json")),
        rs.getString("source"),
        rs.getInt("use_count"),
        lastUsedAt == null ? null : lastUsedAt.toInstant().toEpochMilli(),
        rs.getTimestamp("created_at").toInstant().toEpochMilli(),
        rs.getTimestamp("updated_at").toInstant().toEpochMilli());
  }

  private List<String> readTags(String json) {
    if (json == null || json.isBlank()) return List.of();
    try {
      return objectMapper.readValue(json, TAG_LIST_TYPE);
    } catch (JsonProcessingException error) {
      return List.of();
    }
  }

  private String toJson(List<String> tags) {
    try {
      return objectMapper.writeValueAsString(tags == null ? List.of() : tags);
    } catch (JsonProcessingException error) {
      return "[]";
    }
  }
}
