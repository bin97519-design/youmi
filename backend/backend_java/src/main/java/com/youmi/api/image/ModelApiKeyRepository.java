package com.youmi.api.image;

import java.sql.PreparedStatement;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class ModelApiKeyRepository {
  private final JdbcTemplate jdbcTemplate;

  public ModelApiKeyRepository(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public List<StoredModelApiKey> list() {
    return jdbcTemplate.query("""
        SELECT id, name, model, provider, base_url, generation_path, task_path,
               encrypted_api_key, encrypted_dek, encryption_key_version,
               enabled, priority, created_by, created_at, updated_at
        FROM ym_model_api_key
        ORDER BY model ASC, priority DESC, id ASC
        """, this::mapRow);
  }

  public Optional<StoredModelApiKey> findById(long id) {
    return jdbcTemplate.query("""
        SELECT id, name, model, provider, base_url, generation_path, task_path,
               encrypted_api_key, encrypted_dek, encryption_key_version,
               enabled, priority, created_by, created_at, updated_at
        FROM ym_model_api_key
        WHERE id = ?
        """, this::mapRow, id).stream().findFirst();
  }

  public Optional<StoredModelApiKey> findEnabledForModel(String model) {
    return jdbcTemplate.query("""
        SELECT id, name, model, provider, base_url, generation_path, task_path,
               encrypted_api_key, encrypted_dek, encryption_key_version,
               enabled, priority, created_by, created_at, updated_at
        FROM ym_model_api_key
        WHERE enabled = 1 AND LOWER(model) = LOWER(?)
        ORDER BY priority DESC, id ASC
        LIMIT 1
        """, this::mapRow, model).stream().findFirst();
  }

  public boolean hasAnyEnabled() {
    Integer count = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM ym_model_api_key WHERE enabled = 1", Integer.class);
    return count != null && count > 0;
  }

  public long insert(
      String name,
      String model,
      String provider,
      String baseUrl,
      String generationPath,
      String taskPath,
      String encryptedApiKey,
      String encryptedDek,
      String keyVersion,
      boolean enabled,
      int priority,
      Long createdBy) {
    KeyHolder keyHolder = new GeneratedKeyHolder();
    jdbcTemplate.update(connection -> {
      PreparedStatement statement = connection.prepareStatement("""
          INSERT INTO ym_model_api_key
            (name, model, provider, base_url, generation_path, task_path,
             encrypted_api_key, encrypted_dek, encryption_key_version,
             enabled, priority, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          """, new String[] {"id"});
      statement.setString(1, name);
      statement.setString(2, model);
      statement.setString(3, provider);
      statement.setString(4, baseUrl);
      statement.setString(5, generationPath);
      statement.setString(6, taskPath);
      statement.setString(7, encryptedApiKey);
      statement.setString(8, encryptedDek);
      statement.setString(9, keyVersion);
      statement.setBoolean(10, enabled);
      statement.setInt(11, priority);
      statement.setObject(12, createdBy);
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
      String provider,
      String baseUrl,
      String generationPath,
      String taskPath,
      boolean enabled,
      int priority) {
    return jdbcTemplate.update("""
        UPDATE ym_model_api_key
        SET name = ?, model = ?, provider = ?, base_url = ?, generation_path = ?,
            task_path = ?, enabled = ?, priority = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """, name, model, provider, baseUrl, generationPath, taskPath, enabled, priority, id);
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
        rs.getString("provider"),
        rs.getString("base_url"),
        rs.getString("generation_path"),
        rs.getString("task_path"),
        rs.getString("encrypted_api_key"),
        rs.getString("encrypted_dek"),
        rs.getString("encryption_key_version"),
        rs.getBoolean("enabled"),
        rs.getInt("priority"),
        (Long) rs.getObject("created_by"),
        createdAt == null ? null : createdAt.toLocalDateTime(),
        updatedAt == null ? null : updatedAt.toLocalDateTime());
  }

  public record StoredModelApiKey(
      long id,
      String name,
      String model,
      String provider,
      String baseUrl,
      String generationPath,
      String taskPath,
      String encryptedApiKey,
      String encryptedDek,
      String encryptionKeyVersion,
      boolean enabled,
      int priority,
      Long createdBy,
      LocalDateTime createdAt,
      LocalDateTime updatedAt) {}
}
