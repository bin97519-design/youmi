package com.youmi.api.admin;

import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class AiFeatureMappingRepository {
  private final JdbcTemplate jdbc;

  public AiFeatureMappingRepository(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public Optional<MappingState> find(String featureCode) {
    return jdbc.query("SELECT configured, default_api_key_id FROM ym_ai_feature_mapping WHERE feature_code = ?",
        (rs, row) -> new MappingState(rs.getBoolean("configured"), (Long) rs.getObject("default_api_key_id")),
        featureCode).stream().findFirst();
  }

  public List<Long> selectedKeyIds(String featureCode) {
    return jdbc.query("SELECT api_key_id FROM ym_ai_feature_mapping_key WHERE feature_code = ? ORDER BY api_key_id",
        (rs, row) -> rs.getLong(1), featureCode);
  }

  public boolean isConfigured(String featureCode) {
    return find(featureCode).map(MappingState::configured).orElse(false);
  }

  public List<Long> selectedKeyIdsIfConfigured(String featureCode) {
    return isConfigured(featureCode) ? selectedKeyIds(featureCode) : List.of();
  }

  public Optional<Long> defaultKeyIdIfConfigured(String featureCode) {
    return find(featureCode).filter(MappingState::configured).map(MappingState::defaultApiKeyId);
  }

  @Transactional
  public void saveDropdown(String featureCode, List<Long> apiKeyIds) {
    ensureRow(featureCode);
    jdbc.update("DELETE FROM ym_ai_feature_mapping_key WHERE feature_code = ?", featureCode);
    for (Long id : apiKeyIds) {
      jdbc.update("INSERT INTO ym_ai_feature_mapping_key (feature_code, api_key_id) VALUES (?, ?)", featureCode, id);
    }
    jdbc.update("UPDATE ym_ai_feature_mapping SET configured = 1, default_api_key_id = NULL WHERE feature_code = ?", featureCode);
  }

  @Transactional
  public void saveDefault(String featureCode, Long apiKeyId) {
    ensureRow(featureCode);
    jdbc.update("DELETE FROM ym_ai_feature_mapping_key WHERE feature_code = ?", featureCode);
    jdbc.update("UPDATE ym_ai_feature_mapping SET configured = 1, default_api_key_id = ? WHERE feature_code = ?", apiKeyId, featureCode);
  }

  private void ensureRow(String featureCode) {
    jdbc.update("INSERT IGNORE INTO ym_ai_feature_mapping (feature_code, configured) VALUES (?, 0)", featureCode);
  }

  public record MappingState(boolean configured, Long defaultApiKeyId) {}
}
