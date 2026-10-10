package com.youmi.api.image;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.youmi.api.credential.CredentialVault;
import com.youmi.api.admin.AiFeatureMappingService;
import com.youmi.api.admin.AiFeatureMappingRepository;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
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
          model_type VARCHAR(32) NOT NULL,
          provider VARCHAR(64) NOT NULL,
          base_url VARCHAR(512) NOT NULL,
          generation_path VARCHAR(255) NOT NULL,
          task_path VARCHAR(255) NOT NULL,
          default_data CLOB NULL,
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
    jdbcTemplate.execute("CREATE TABLE ym_ai_feature_mapping (feature_code VARCHAR(64) PRIMARY KEY, configured BOOLEAN NOT NULL DEFAULT FALSE, default_api_key_id BIGINT NULL)");
    jdbcTemplate.execute("CREATE TABLE ym_ai_feature_mapping_key (feature_code VARCHAR(64) NOT NULL, api_key_id BIGINT NOT NULL, PRIMARY KEY(feature_code, api_key_id))");
    String masterKey = Base64.getEncoder().encodeToString(
        "0123456789abcdef0123456789abcdef".getBytes(StandardCharsets.UTF_8));
    service = new ModelApiKeyService(
        new ModelApiKeyRepository(jdbcTemplate),
        new CredentialVault(masterKey, "test-v1"),
        new ImageGenerationProperties());
    service.setFeatureMappings(new AiFeatureMappingRepository(jdbcTemplate));
  }

  @Test
  void encryptsSecretAndResolvesHighestPriorityEnabledKey() {
    ModelApiKeyDtos.Row first = service.create(new ModelApiKeyDtos.SaveRequest(
        "主线路", "banana-2.1", ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION,
        "youmi888", "https://api.example.com/",
        null, null, "sk-secret-first", true, 100), 1L);
    service.create(new ModelApiKeyDtos.SaveRequest(
        "备用线路", "banana-2.1", ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION,
        "youmi888-backup", "https://backup.example.com",
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
    assertEquals(ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION, first.modelType());
  }

  @Test
  void updateWithoutSecretKeepsExistingKeyAndDisableOnlyStopsNewTasks() {
    ModelApiKeyDtos.Row created = service.create(new ModelApiKeyDtos.SaveRequest(
        "线路", "banana-2.1", ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION,
        "youmi888", "https://api.example.com",
        null, null, "sk-keep-this", true, 100), 1L);

    ModelApiKeyDtos.Row updated = service.update(created.id(), new ModelApiKeyDtos.SaveRequest(
        "新名称", "banana-2.1", ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION,
        "youmi888", "https://api.example.com",
        "/v1/media/generate", "/v1/media/status", "", true, 200));
    assertEquals("新名称", updated.name());
    assertEquals(200, updated.priority());
    assertEquals("新名称", service.list().get(0).name());
    assertEquals(200, service.list().get(0).priority());
    assertEquals("sk-keep-this", service.resolve("banana-2.1").orElseThrow().apiKey());

    service.disable(created.id());
    assertTrue(service.resolve("banana-2.1").isEmpty());
    assertEquals("sk-keep-this", service.resolveImageById(created.id()).apiKey());
  }

  @Test
  void exposesOnlyEnabledConfiguredModelNames() {
    ModelApiKeyDtos.Row enabled = service.create(new ModelApiKeyDtos.SaveRequest(
        "GPT 主线路", "GPT-image2.5", ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION,
        "youmi888", "https://api.example.com",
        null, null, "sk-gpt", true, 100), 1L);
    ModelApiKeyDtos.Row disabled = service.create(new ModelApiKeyDtos.SaveRequest(
        "旧线路", "old-model", ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION,
        "youmi888", "https://api.example.com",
        null, null, "sk-old", true, 10), 1L);
    service.create(new ModelApiKeyDtos.SaveRequest(
        "视频线路", "seedance-2.5", ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION,
        "youmi888", "https://api.example.com", null, null, "sk-video", true, 100), 1L);
    service.create(new ModelApiKeyDtos.SaveRequest(
        "识图线路", "gem-3.1-pro", ModelApiKeyService.MODEL_TYPE_VISION_REASONING,
        "youmi888", "https://api.example.com", null, null, "sk-vision", true, 100), 1L);
    service.disable(disabled.id());

    assertEquals(java.util.List.of("GPT-image2.5"), service.enabledModels());
    assertTrue(enabled.enabled());
  }

  @Test
  void videoAndVisionKeysDoNotMarkImageGenerationAsConfigured() {
    service.create(new ModelApiKeyDtos.SaveRequest(
        "视频线路", "seedance-2.5", ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION,
        "youmi888", "https://api.example.com", null, null, "sk-video", true, 100), 1L);
    service.create(new ModelApiKeyDtos.SaveRequest(
        "识图线路", "gem-3.1-pro", ModelApiKeyService.MODEL_TYPE_VISION_REASONING,
        "youmi888", "https://api.example.com", null, null, "sk-vision", true, 100), 1L);

    assertFalse(service.hasAnyEnabled());
    assertTrue(service.enabledModels().isEmpty());
  }

  @Test
  void selectsHighestPriorityEnabledVisionCredentialForDefaultRoute() {
    ModelApiKeyDtos.Row lower = service.create(new ModelApiKeyDtos.SaveRequest(
        "视觉备用", "vision-low", ModelApiKeyService.MODEL_TYPE_VISION_REASONING,
        "router", "https://low.example.com", "/v1/chat/completions", "/v1/models",
        "sk-low", true, 20), 1L);
    ModelApiKeyDtos.Row preferred = service.create(new ModelApiKeyDtos.SaveRequest(
        "视觉主线", "vision-high", ModelApiKeyService.MODEL_TYPE_VISION_REASONING,
        "router", "https://high.example.com", "/v1/chat/completions", "/v1/models",
        "sk-high", true, 80), 1L);

    assertEquals(preferred.id(), service.preferredEnabledModel(
        ModelApiKeyService.MODEL_TYPE_VISION_REASONING).orElseThrow().id());
    service.disable(preferred.id());
    assertEquals(lower.id(), service.preferredEnabledModel(
        ModelApiKeyService.MODEL_TYPE_VISION_REASONING).orElseThrow().id());
  }

  @Test
  void featureMappingDistinguishesDropdownModelsFromDefaultVisionRoute() {
    service.create(new ModelApiKeyDtos.SaveRequest(
        "图片生图", "image-model", ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION,
        "router", "https://image.example.com", null, null, "sk-image", true, 100), 1L);
    service.create(new ModelApiKeyDtos.SaveRequest(
        "视觉普通线路", "vision-low", ModelApiKeyService.MODEL_TYPE_VISION_REASONING,
        "router", "https://vision-low.example.com", "/v1/chat/completions", "/v1/models",
        "sk-vision-low", true, 20), 1L);
    ModelApiKeyDtos.Row preferred = service.create(new ModelApiKeyDtos.SaveRequest(
        "视觉优先线路", "vision-high", ModelApiKeyService.MODEL_TYPE_VISION_REASONING,
        "router", "https://vision-high.example.com", "/v1/chat/completions", "/v1/models",
        "sk-vision-high", true, 80), 1L);

    var mappings = new AiFeatureMappingService(service, new AiFeatureMappingRepository(jdbcTemplate)).list();
    var layering = mappings.stream().filter(row -> row.featureCode().equals("canvas-layering"))
        .findFirst().orElseThrow();
    var agent = mappings.stream().filter(row -> row.featureCode().equals("canvas-agent"))
        .findFirst().orElseThrow();
    var image = mappings.stream().filter(row -> row.featureCode().equals("canvas-image"))
        .findFirst().orElseThrow();

    assertEquals("system_default", layering.selectionMode());
    assertTrue(layering.defaultRoute().contains("视觉优先线路"));
    assertEquals("dropdown", agent.selectionMode());
    assertTrue(agent.defaultRoute().contains("全局 Agent 配置"));
    assertEquals("dropdown", image.selectionMode());
    assertEquals("image-model", image.keyRoutes().get(0).model());
    assertEquals(preferred.id(), layering.keyRoutes().get(0).apiKeyId());
  }

  @Test
  void savedFeatureMappingRestrictsDropdownAndDefaultRoutingToSelectedKeys() {
    ModelApiKeyDtos.Row first = service.create(new ModelApiKeyDtos.SaveRequest(
        "图片线路 A", "mapped-image", ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION,
        "router-a", "https://a.example.com", null, null, "sk-image-a", true, 100), 1L);
    ModelApiKeyDtos.Row second = service.create(new ModelApiKeyDtos.SaveRequest(
        "图片线路 B", "mapped-image", ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION,
        "router-b", "https://b.example.com", null, null, "sk-image-b", true, 50), 1L);
    ModelApiKeyDtos.Row vision = service.create(new ModelApiKeyDtos.SaveRequest(
        "指定视觉线路", "vision-selected", ModelApiKeyService.MODEL_TYPE_VISION_REASONING,
        "vision", "https://vision.example.com", "/chat", "/models", "sk-vision", true, 1), 1L);
    AiFeatureMappingService mappings = new AiFeatureMappingService(service, new AiFeatureMappingRepository(jdbcTemplate));

    mappings.save("canvas-image", new com.youmi.api.admin.AiFeatureMappingDtos.SaveRequest(List.of(second.id()), null));
    assertEquals("router-b", service.resolve("mapped-image", ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION,
        "canvas-image").orElseThrow().provider());
    assertEquals(List.of("mapped-image"), service.enabledModels(
        ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION, "canvas-image"));

    mappings.save("canvas-layering", new com.youmi.api.admin.AiFeatureMappingDtos.SaveRequest(null, vision.id()));
    assertEquals(vision.id(), service.preferredEnabledModel(
        ModelApiKeyService.MODEL_TYPE_VISION_REASONING, "canvas-layering").orElseThrow().id());
    assertEquals(first.id(), service.resolve("mapped-image", ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION)
        .orElseThrow().id());
  }

  @Test
  void productVideoModelsAndRoutingRequireAnExplicitFeatureMapping() {
    ModelApiKeyDtos.Row image = service.create(new ModelApiKeyDtos.SaveRequest(
        "未映射图片线路", "unmapped-image", ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION,
        "router", "https://image.example.com", null, null, "sk-image", true, 100), 1L);
    ModelApiKeyDtos.Row video = service.create(new ModelApiKeyDtos.SaveRequest(
        "未映射视频线路", "unmapped-video", ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION,
        "router", "https://video.example.com", null, null, "sk-video", true, 100), 1L);

    assertTrue(service.enabledModelOptions(ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION,
        "product-video-image").isEmpty());
    assertTrue(service.enabledModelOptions(ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION,
        "product-video-video").isEmpty());
    assertTrue(service.resolve(image.model(), ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION,
        "product-video-image").isEmpty());
    assertTrue(service.resolve(video.model(), ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION,
        "product-video-video").isEmpty());
    assertEquals(List.of("unmapped-video"), service.enabledModels(
        ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video"));

    var mapping = new AiFeatureMappingService(service, new AiFeatureMappingRepository(jdbcTemplate))
        .list().stream()
        .filter(item -> item.featureCode().equals("product-video-video"))
        .findFirst().orElseThrow();
    assertFalse(mapping.configured());
    assertTrue(mapping.selectedApiKeyIds().isEmpty());
  }

  @Test
  void preservesConfiguredAliasInsteadOfReplacingItWithInternalModel() {
    ModelApiKeyDtos.Row created = service.create(new ModelApiKeyDtos.SaveRequest(
        "Banana Pro 主线路", "banana-pro", ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION,
        "youmi888", "https://api.example.com",
        null, null, "sk-banana-pro", true, 100), 1L);

    assertEquals("banana-pro", created.model());
    assertEquals("banana-pro", service.list().get(0).model());
    assertEquals("banana-pro", service.resolve("banana-pro").orElseThrow().model());
  }

  @Test
  void persistsAndResolvesMultipleDefaultParameters() {
    var defaults = List.of(
        new ModelApiKeyDtos.DefaultParameter("background", "auto"),
        new ModelApiKeyDtos.DefaultParameter("quality", "high"));
    ModelApiKeyDtos.Row created = service.create(new ModelApiKeyDtos.SaveRequest(
        "带默认参数", "defaults-image", ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION,
        "router", "https://api.example.com", null, null, "sk-defaults", true, 100, defaults), 1L);

    assertEquals(defaults, created.defaultData());
    assertEquals("auto", service.resolve("defaults-image").orElseThrow().defaultData().get("background"));

    ModelApiKeyDtos.Row updated = service.update(created.id(), new ModelApiKeyDtos.SaveRequest(
        "带默认参数", "defaults-image", ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION,
        "router", "https://api.example.com", null, null, "", true, 100));
    assertEquals(defaults, updated.defaultData());
  }

  @Test
  void gptImageDisplayAliasesResolveTheStoredTtImageCredential() {
    ModelApiKeyDtos.Row stored = service.create(new ModelApiKeyDtos.SaveRequest(
        "GPT-image 主线路", "tt-image-2.5", ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION,
        "灵科AI", "https://api.example.com", "/v1/images/generations", "/v1/images/tasks/{id}",
        "sk-image", true, 100), 1L);

    assertEquals(stored.id(), service.resolve("GPT-image2.5").orElseThrow().id());
    assertEquals(stored.id(), service.resolve("gpt-image-2.5").orElseThrow().id());
  }

  @Test
  void sunburstCanvasModelResolvesSelectedTtImageCredential() {
    ModelApiKeyDtos.Row stored = service.create(new ModelApiKeyDtos.SaveRequest(
        "image-2.5高质", "tt-image-2.5", ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION,
        "灵科AI", "https://api.example.com", "/v1/images/generations", "/v1/images/tasks/{id}",
        "sk-image", true, 100), 1L);
    new AiFeatureMappingService(service, new AiFeatureMappingRepository(jdbcTemplate)).save(
        "canvas-image", new com.youmi.api.admin.AiFeatureMappingDtos.SaveRequest(List.of(stored.id()), null));

    assertEquals(stored.id(), service.resolve("gpt-image2.5-sunburst-api",
        ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION, "canvas-image").orElseThrow().id());
  }

  @Test
  void productVideoImageAliasesResolveDistinctCredentialsForSameUpstreamModel() {
    ModelApiKeyDtos.Row fast = service.create(new ModelApiKeyDtos.SaveRequest(
        "image-2.5快速", "tt-image-2.5", ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION,
        "灵科AI", "https://api.example.com", "/v1/images/generations", "/v1/images/tasks/{id}",
        "sk-fast", true, 100), 1L);
    ModelApiKeyDtos.Row highQuality = service.create(new ModelApiKeyDtos.SaveRequest(
        "image-2.5高质", "tt-image-2.5", ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION,
        "灵科AI", "https://api.example.com", "/v1/images/generations", "/v1/images/tasks/{id}",
        "sk-high", true, 100), 1L);
    new AiFeatureMappingService(service, new AiFeatureMappingRepository(jdbcTemplate)).save(
        "product-video-image", new com.youmi.api.admin.AiFeatureMappingDtos.SaveRequest(
            List.of(fast.id(), highQuality.id()), fast.id()));

    assertEquals(fast.id(), service.resolve("image-2.5快速",
        ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION, "product-video-image").orElseThrow().id());
    assertEquals(highQuality.id(), service.resolve("image-2.5高质",
        ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION, "product-video-image").orElseThrow().id());
  }

  @Test
  void bananaProApiAliasResolvesSelectedCanvasImageCredential() {
    ModelApiKeyDtos.Row stored = service.create(new ModelApiKeyDtos.SaveRequest(
        "香蕉pro", "banana-pro", ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION,
        "灵科AI", "https://api.example.com", null, null, "sk-image", true, 100), 1L);
    new AiFeatureMappingService(service, new AiFeatureMappingRepository(jdbcTemplate)).save(
        "canvas-image", new com.youmi.api.admin.AiFeatureMappingDtos.SaveRequest(List.of(stored.id()), null));

    assertEquals(stored.id(), service.resolve("banana-pro-api",
        ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION, "canvas-image").orElseThrow().id());
  }
}
