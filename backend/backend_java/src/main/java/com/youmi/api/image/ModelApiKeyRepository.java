package com.youmi.api.image;

import java.sql.PreparedStatement;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class ModelApiKeyRepository {
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final TypeReference<List<ModelApiKeyDtos.DefaultParameter>> DEFAULT_DATA_TYPE =
      new TypeReference<>() {};
  private final JdbcTemplate jdbcTemplate;

  public ModelApiKeyRepository(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public List<StoredModelApiKey> list() {
    return jdbcTemplate.query("""
        SELECT id, name, model, model_type, provider, base_url, generation_path, task_path,
               encrypted_api_key, encrypted_dek, encryption_key_version,
               default_data, enabled, priority, created_by, created_at, updated_at
        FROM ym_model_api_key
        ORDER BY model ASC, priority DESC, id ASC
        """, this::mapRow);
  }

  public Optional<StoredModelApiKey> findById(long id) {
    return jdbcTemplate.query("""
        SELECT id, name, model, model_type, provider, base_url, generation_path, task_path,
               encrypted_api_key, encrypted_dek, encryption_key_version,
               default_data, enabled, priority, created_by, created_at, updated_at
        FROM ym_model_api_key
        WHERE id = ?
        """, this::mapRow, id).stream().findFirst();
  }

  public Optional<StoredModelApiKey> findEnabledForModel(String model, String modelType) {
    return jdbcTemplate.query("""
        SELECT id, name, model, model_type, provider, base_url, generation_path, task_path,
               encrypted_api_key, encrypted_dek, encryption_key_version,
               default_data, enabled, priority, created_by, created_at, updated_at
        FROM ym_model_api_key
        WHERE enabled = 1 AND LOWER(model) = LOWER(?) AND model_type = ?
        ORDER BY priority DESC, id ASC
        LIMIT 1
        """, this::mapRow, model, modelType).stream().findFirst();
  }

  public boolean hasAnyEnabled(String modelType) {
    Integer count = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM ym_model_api_key WHERE enabled = 1 AND model_type = ?",
        Integer.class,
        modelType);
    return count != null && count > 0;
  }

  public long insert(
      String name,
      String model,
      String modelType,
      String provider,
      String baseUrl,
      String generationPath,
      String taskPath,
      String encryptedApiKey,
      String encryptedDek,
      String keyVersion,
      String defaultData,
      boolean enabled,
      int priority,
      Long createdBy) {
    KeyHolder keyHolder = new GeneratedKeyHolder();
    jdbcTemplate.update(connection -> {
      PreparedStatement statement = connection.prepareStatement("""
          INSERT INTO ym_model_api_key
            (name, model, model_type, provider, base_url, generation_path, task_path,
             encrypted_api_key, encrypted_dek, encryption_key_version,
             default_data, enabled, priority, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          """, new String[] {"id"});
      statement.setString(1, name);
      statement.setString(2, model);
      statement.setString(3, modelType);
      statement.setString(4, provider);
      statement.setString(5, baseUrl);
      statement.setString(6, generationPath);
      statement.setString(7, taskPath);
      statement.setString(8, encryptedApiKey);
      statement.setString(9, encryptedDek);
      statement.setString(10, keyVersion);
      statement.setString(11, defaultData);
      statement.setBoolean(12, enabled);
      statement.setInt(13, priority);
      statement.setObject(14, createdBy);
      return statement;
    }, keyHolder);
    Number key = keyHolder.getKey();
    if (key == null) throw new IllegalStateException("Failed to create model API key");
    return key.longValue();
  }

  public int updateMetadata(
      long id,
      String name,
      String model,
      String modelType,
      String provider,
      String baseUrl,
      String generationPath,
      String taskPath,
      String defaultData,
      boolean enabled,
      int priority) {
    return jdbcTemplate.update("""
        UPDATE ym_model_api_key
        SET name = ?, model = ?, model_type = ?, provider = ?, base_url = ?, generation_path = ?,
            task_path = ?, default_data = ?, enabled = ?, priority = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """, name, model, modelType, provider, baseUrl, generationPath, taskPath, defaultData, enabled, priority, id);
  }

  public int updateSecret(
      long id, String encryptedApiKey, String encryptedDek, String keyVersion) {
    return jdbcTemplate.update("""
        UPDATE ym_model_api_key
        SET encrypted_api_key = ?, encrypted_dek = ?, encryption_key_version = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """, encryptedApiKey, encryptedDek, keyVersion, id);
  }

  public int disable(long id) {
    return jdbcTemplate.update("""
        UPDATE ym_model_api_key
        SET enabled = 0, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """, id);
  }

  private StoredModelApiKey mapRow(java.sql.ResultSet rs, int rowNum) throws java.sql.SQLException {
    Timestamp createdAt = rs.getTimestamp("created_at");
    Timestamp updatedAt = rs.getTimestamp("updated_at");
    return new StoredModelApiKey(
        rs.getLong("id"),
        rs.getString("name"),
        rs.getString("model"),
        rs.getString("model_type"),
        rs.getString("provider"),
        rs.getString("base_url"),
        rs.getString("generation_path"),
        rs.getString("task_path"),
        parseDefaultData(rs.getString("default_data")),
        rs.getString("encrypted_api_key"),
        rs.getString("encrypted_dek"),
        rs.getString("encryption_key_version"),
        rs.getBoolean("enabled"),
        rs.getInt("priority"),
        (Long) rs.getObject("created_by"),
        createdAt == null ? null : createdAt.toLocalDateTime(),
        updatedAt == null ? null : updatedAt.toLocalDateTime());
  }

  private List<ModelApiKeyDtos.DefaultParameter> parseDefaultData(String json) {
    if (json == null || json.isBlank()) return List.of();
    try {
      return JSON.readValue(json, DEFAULT_DATA_TYPE);
    } catch (Exception ignored) {
      return List.of();
    }
  }

  public record StoredModelApiKey(
      long id,
      String name,
      String model,
      String modelType,
      String provider,
      String baseUrl,
      String generationPath,
      String taskPath,
      List<ModelApiKeyDtos.DefaultParameter> defaultData,
      String encryptedApiKey,
      String encryptedDek,
      String encryptionKeyVersion,
      boolean enabled,
      int priority,
      Long createdBy,
      LocalDateTime createdAt,
      LocalDateTime updatedAt) {}
}
