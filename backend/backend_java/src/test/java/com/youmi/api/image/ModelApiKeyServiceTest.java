package com.youmi.api.image;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.youmi.api.credential.CredentialVault;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class ModelApiKeyServiceTest {
  private JdbcTemplate jdbcTemplate;
  private ModelApiKeyService service;

  @BeforeEach
  void setUp() {
    DriverManagerDataSource dataSource = new DriverManagerDataSource(
        "jdbc:h2:mem:model-key-" + System.nanoTime() + ";MODE=MySQL;DB_CLOSE_DELAY=-1", "sa", "");
    jdbcTemplate = new JdbcTemplate(dataSource);
    jdbcTemplate.execute("""
        CREATE TABLE ym_model_api_key (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(128) NOT NULL,
          model VARCHAR(128) NOT NULL,
          provider VARCHAR(64) NOT NULL,
          base_url VARCHAR(512) NOT NULL,
          generation_path VARCHAR(255) NOT NULL,
          task_path VARCHAR(255) NOT NULL,
          encrypted_api_key CLOB NOT NULL,
          encrypted_dek CLOB NOT NULL,
          encryption_key_version VARCHAR(32) NOT NULL,
          enabled BOOLEAN NOT NULL,
          priority INT NOT NULL,
          created_by BIGINT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
        """);
    String masterKey = Base64.getEncoder().encodeToString(
        "0123456789abcdef0123456789abcdef".getBytes(StandardCharsets.UTF_8));
    service = new ModelApiKeyService(
        new ModelApiKeyRepository(jdbcTemplate),
        new CredentialVault(masterKey, "test-v1"),
        new ImageGenerationProperties());
  }

  @Test
  void encryptsSecretAndResolvesHighestPriorityEnabledKey() {
    ModelApiKeyDtos.Row first = service.create(new ModelApiKeyDtos.SaveRequest(
        "主线路", "banana-2.1", "youmi888", "https://api.example.com/",
        null, null, "sk-secret-first", true, 100), 1L);
    service.create(new ModelApiKeyDtos.SaveRequest(
        "备用线路", "banana-2.1", "youmi888-backup", "https://backup.example.com",
        null, null, "sk-secret-backup", true, 10), 1L);

    String encrypted = jdbcTemplate.queryForObject(
        "SELECT encrypted_api_key FROM ym_model_api_key WHERE id = ?", String.class, first.id());
    assertNotEquals("sk-secret-first", encrypted);
    assertFalse(encrypted.contains("secret-first"));

    ModelApiKeyService.ResolvedModelApiKey resolved = service.resolve("banana21").orElseThrow();
    assertEquals(first.id(), resolved.id());
    assertEquals("sk-secret-first", resolved.apiKey());
    assertEquals("https://api.example.com/v1/media/generate", resolved.generationEndpoint());
    assertEquals("sk-s****irst", first.apiKeyMasked());
  }

  @Test
  void updateWithoutSecretKeepsExistingKeyAndDisableOnlyStopsNewTasks() {
    ModelApiKeyDtos.Row created = service.create(new ModelApiKeyDtos.SaveRequest(
        "线路", "banana-2.1", "youmi888", "https://api.example.com",
        null, null, "sk-keep-this", true, 100), 1L);

    ModelApiKeyDtos.Row updated = service.update(created.id(), new ModelApiKeyDtos.SaveRequest(
        "新名称", "banana-2.1", "youmi888", "https://api.example.com",
        "/v1/media/generate", "/v1/media/status", "", true, 200));
    assertEquals("新名称", updated.name());
    assertEquals(200, updated.priority());
    assertEquals("新名称", service.list().get(0).name());
    assertEquals(200, service.list().get(0).priority());
    assertEquals("sk-keep-this", service.resolve("banana-2.1").orElseThrow().apiKey());

    service.disable(created.id());
    assertTrue(service.resolve("banana-2.1").isEmpty());
    assertEquals("sk-keep-this", service.resolveById(created.id()).apiKey());
  }

  @Test
  void exposesOnlyEnabledConfiguredModelNames() {
    ModelApiKeyDtos.Row enabled = service.create(new ModelApiKeyDtos.SaveRequest(
        "GPT 主线路", "GPT-image2.5", "youmi888", "https://api.example.com",
        null, null, "sk-gpt", true, 100), 1L);
    ModelApiKeyDtos.Row disabled = service.create(new ModelApiKeyDtos.SaveRequest(
        "旧线路", "old-model", "youmi888", "https://api.example.com",
        null, null, "sk-old", true, 10), 1L);
    service.disable(disabled.id());

    assertEquals(java.util.List.of("GPT-image2.5"), service.enabledModels());
    assertTrue(enabled.enabled());
  }

  @Test
  void preservesConfiguredAliasInsteadOfReplacingItWithInternalModel() {
    ModelApiKeyDtos.Row created = service.create(new ModelApiKeyDtos.SaveRequest(
        "Banana Pro 主线路", "banana-pro", "youmi888", "https://api.example.com",
        null, null, "sk-banana-pro", true, 100), 1L);

    assertEquals("banana-pro", created.model());
    assertEquals("banana-pro", service.list().get(0).model());
    assertEquals("banana-pro", service.resolve("banana-pro").orElseThrow().model());
  }
}
