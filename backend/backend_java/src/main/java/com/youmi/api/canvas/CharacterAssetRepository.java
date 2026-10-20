package com.youmi.api.canvas;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class CharacterAssetRepository {
  private static final TypeReference<Map<String, Object>> CONFIG_TYPE = new TypeReference<>() {};
  private static final String COLUMNS = """
      character_id, name, description, gender, age_group, culture,
      image_url, cover_url, config_json, created_at, updated_at
      """;

  private final JdbcTemplate jdbcTemplate;
  private final ObjectMapper objectMapper;

  public CharacterAssetRepository(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
    this.jdbcTemplate = jdbcTemplate;
    this.objectMapper = objectMapper;
  }

  /** Additive schema: existing canvas documents and other users' libraries are untouched. */
  @PostConstruct
  public void initializeSchema() {
    jdbcTemplate.execute("""
        CREATE TABLE IF NOT EXISTS ym_canvas_character_asset (
          character_id VARCHAR(80) PRIMARY KEY,
          user_id BIGINT NOT NULL,
          name VARCHAR(80) NOT NULL,
          description TEXT NOT NULL,
          gender VARCHAR(80) NOT NULL,
          age_group VARCHAR(80) NOT NULL,
          culture VARCHAR(80) NOT NULL,
          image_url VARCHAR(4096) NOT NULL,
          cover_url VARCHAR(4096) NOT NULL,
          config_json MEDIUMTEXT NOT NULL,
          deleted TINYINT NOT NULL DEFAULT 0,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          INDEX idx_character_owner_updated (user_id, deleted, updated_at)
        )
        """);
  }

  public List<CharacterAssetDtos.CharacterAsset> findByUserId(Long userId) {
    return jdbcTemplate.query(
        "SELECT " + COLUMNS + " FROM ym_canvas_character_asset"
            + " WHERE user_id = ? AND deleted = 0 ORDER BY updated_at DESC, character_id ASC",
        this::mapRow,
        userId);
  }

  public Optional<CharacterAssetDtos.CharacterAsset> findByIdAndUserId(String id, Long userId) {
    return jdbcTemplate.query(
        "SELECT " + COLUMNS + " FROM ym_canvas_character_asset"
            + " WHERE character_id = ? AND user_id = ? AND deleted = 0 LIMIT 1",
        this::mapRow,
        id,
        userId).stream().findFirst();
  }

  public CharacterAssetDtos.CharacterAsset create(Long userId, CharacterAssetDtos.SaveRequest request) {
    String id = UUID.randomUUID().toString();
    long now = System.currentTimeMillis();
    jdbcTemplate.update("""
        INSERT INTO ym_canvas_character_asset
          (character_id, user_id, name, description, gender, age_group, culture,
           image_url, cover_url, config_json, deleted, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        """,
        id, userId, request.name(), request.description(), request.gender(), request.ageGroup(),
        request.culture(), request.imageUrl(), request.coverUrl(), toJson(request.config()), now, now);
    return findByIdAndUserId(id, userId).orElseThrow();
  }

  public Optional<CharacterAssetDtos.CharacterAsset> update(
      String id, Long userId, CharacterAssetDtos.SaveRequest request) {
    jdbcTemplate.update("""
        UPDATE ym_canvas_character_asset
        SET name = ?, description = ?, gender = ?, age_group = ?, culture = ?,
            image_url = ?, cover_url = ?, config_json = ?, updated_at = ?
        WHERE character_id = ? AND user_id = ? AND deleted = 0
        """,
        request.name(), request.description(), request.gender(), request.ageGroup(), request.culture(),
        request.imageUrl(), request.coverUrl(), toJson(request.config()), System.currentTimeMillis(), id, userId);
    // MySQL may report no changed rows for an identical save in the same millisecond.
    return findByIdAndUserId(id, userId);
  }

  public boolean softDelete(String id, Long userId) {
    return jdbcTemplate.update("""
        UPDATE ym_canvas_character_asset SET deleted = 1, updated_at = ?
        WHERE character_id = ? AND user_id = ? AND deleted = 0
        """, System.currentTimeMillis(), id, userId) > 0;
  }

  private CharacterAssetDtos.CharacterAsset mapRow(ResultSet rs, int rowNum) throws SQLException {
    return new CharacterAssetDtos.CharacterAsset(
        rs.getString("character_id"), rs.getString("name"), rs.getString("description"),
        rs.getString("gender"), rs.getString("age_group"), rs.getString("culture"),
        rs.getString("image_url"), rs.getString("cover_url"), readConfig(rs.getString("config_json")),
        rs.getLong("created_at"), rs.getLong("updated_at"));
  }

  private Map<String, Object> readConfig(String json) {
    try {
      return json == null || json.isBlank() ? Map.of() : objectMapper.readValue(json, CONFIG_TYPE);
    } catch (JsonProcessingException error) {
      throw new IllegalStateException("角色数据读取失败", error);
    }
  }

  private String toJson(Map<String, Object> config) {
    try {
      return objectMapper.writeValueAsString(config == null ? Map.of() : config);
    } catch (JsonProcessingException error) {
      throw new IllegalArgumentException("角色配置不是有效 JSON", error);
    }
  }
}
