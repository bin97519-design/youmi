package com.youmi.api.image;

import com.youmi.api.common.ApiException;
import com.youmi.api.credential.CredentialVault;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Comparator;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.beans.factory.annotation.Autowired;
import com.youmi.api.admin.AiFeatureMappingRepository;

@Service
public class ModelApiKeyService {
  public static final String MODEL_TYPE_IMAGE_GENERATION = "image_generation";
  public static final String MODEL_TYPE_VIDEO_GENERATION = "video_generation";
  public static final String MODEL_TYPE_VISION_REASONING = "vision_reasoning";
  private static final String DEFAULT_PROVIDER = "youmi888";
  private static final String DEFAULT_GENERATION_PATH = "/v1/media/generate";
  private static final String DEFAULT_TASK_PATH = "/v1/media/status";

  public static boolean usesProviderReportedCost(String provider) {
    String value = provider == null ? "" : provider.trim().toLowerCase(java.util.Locale.ROOT);
    return value.startsWith("lk888") || value.startsWith("youmi888") || value.startsWith("lingke")
        || value.startsWith("model-api") || value.startsWith("灵科ai") || value.startsWith("灵科 ai");
  }

  private final ModelApiKeyRepository repository;
  private final CredentialVault vault;
  private final ImageGenerationProperties imageProperties;
  private AiFeatureMappingRepository featureMappings;

  public ModelApiKeyService(
      ModelApiKeyRepository repository,
      CredentialVault vault,
      ImageGenerationProperties imageProperties) {
    this.repository = repository;
    this.vault = vault;
    this.imageProperties = imageProperties;
  }

  @Autowired(required = false)
  public void setFeatureMappings(AiFeatureMappingRepository featureMappings) {
    this.featureMappings = featureMappings;
  }

  public boolean isFeatureMappingConfigured(String featureCode) {
    return featureMappings != null && featureMappings.isConfigured(featureCode);
  }

  public boolean hasEnabledModel(String model, String modelType) {
    if (model == null || model.isBlank()) return false;
    return repository.list().stream().anyMatch(row -> row.enabled() && modelType.equals(row.modelType())
        && row.model().equalsIgnoreCase(model.trim()));
  }

  public List<ModelApiKeyDtos.ModelOption> enabledModelOptions(String modelType, String featureCode) {
    List<ModelApiKeyDtos.ModelOption> options = enabledModelOptions(modelType);
    if (!isFeatureMappingConfigured(featureCode)) return options;
    java.util.Set<Long> selected = java.util.Set.copyOf(featureMappings.selectedKeyIdsIfConfigured(featureCode));
    return repository.list().stream().filter(row -> selected.contains(row.id())
        && row.enabled() && modelType.equals(row.modelType()))
        .map(row -> new ModelApiKeyDtos.ModelOption(row.model(), row.name(), row.provider())).toList();
  }

  public List<String> enabledModels(String modelType, String featureCode) {
    return enabledModelOptions(modelType, featureCode).stream().map(ModelApiKeyDtos.ModelOption::value)
        .filter(value -> value != null && !value.isBlank()).distinct().toList();
  }

  public List<ModelApiKeyDtos.Row> list() {
    return repository.list().stream().map(this::toRow).toList();
  }

  public boolean hasAnyEnabled() {
    return repository.hasAnyEnabled(MODEL_TYPE_IMAGE_GENERATION);
  }

  /** 仅公开启用配置的模型名，不暴露线路地址或密钥。 */
  public List<String> enabledModels() {
    return enabledModels(MODEL_TYPE_IMAGE_GENERATION);
  }

  public List<String> enabledModels(String modelType) {
    return enabledRows(modelType).stream()
        .map(ModelApiKeyRepository.StoredModelApiKey::model)
        .filter(model -> model != null && !model.isBlank())
        .distinct()
        .toList();
  }

  public List<ModelApiKeyDtos.ModelOption> enabledModelOptions(String modelType) {
    return enabledRows(modelType).stream()
        .map(row -> new ModelApiKeyDtos.ModelOption(row.model(), row.name(), row.provider()))
        .toList();
  }

  private List<ModelApiKeyRepository.StoredModelApiKey> enabledRows(String modelType) {
    return repository.list().stream()
        .filter(ModelApiKeyRepository.StoredModelApiKey::enabled)
        .filter(row -> modelType.equals(row.modelType()))
        .filter(row -> row.model() != null && !row.model().isBlank())
        .toList();
  }

  @Transactional
  public ModelApiKeyDtos.Row create(ModelApiKeyDtos.SaveRequest request, Long createdBy) {
    NormalizedRequest normalized = normalize(request, true, null);
    CredentialVault.VaultPayload payload = encrypt(normalized.apiKey());
    long id = repository.insert(
        normalized.name(), normalized.model(), normalized.modelType(), normalized.provider(), normalized.baseUrl(),
        normalized.generationPath(), normalized.taskPath(), payload.encryptedPayload(),
        payload.encryptedDek(), payload.keyVersion(), serializeDefaultData(normalized.defaultData()),
        normalized.enabled(), normalized.priority(),
        createdBy);
    return toRow(requireStored(id));
  }

  @Transactional
  public ModelApiKeyDtos.Row update(long id, ModelApiKeyDtos.SaveRequest request) {
    ModelApiKeyRepository.StoredModelApiKey existing = requireStored(id);
    NormalizedRequest normalized = normalize(request, false, existing);
    repository.updateMetadata(
        id, normalized.name(), normalized.model(), normalized.modelType(), normalized.provider(), normalized.baseUrl(),
        normalized.generationPath(), normalized.taskPath(), serializeDefaultData(normalized.defaultData()), normalized.enabled(),
        normalized.priority());
    if (normalized.apiKey() != null) {
      CredentialVault.VaultPayload payload = encrypt(normalized.apiKey());
      repository.updateSecret(
          id, payload.encryptedPayload(), payload.encryptedDek(), payload.keyVersion());
    }
    return toRow(requireStored(id));
  }

  @Transactional
  public void disable(long id) {
    requireStored(id);
    repository.disable(id);
  }

  public Optional<ResolvedModelApiKey> resolve(String requestedModel) {
    return resolve(requestedModel, MODEL_TYPE_IMAGE_GENERATION);
  }

  public Optional<ResolvedModelApiKey> resolve(String requestedModel, String modelType) {
    if (requestedModel == null || requestedModel.isBlank()) return Optional.empty();
    String requested = requestedModel.trim();
    Optional<ModelApiKeyRepository.StoredModelApiKey> exact =
        repository.findEnabledForModel(requested, modelType);
    if (exact.isPresent()) return exact.map(this::decrypt);
    if (!MODEL_TYPE_IMAGE_GENERATION.equals(modelType)) return Optional.empty();

    if (requested.equalsIgnoreCase("GPT-image2.5")
        || requested.equalsIgnoreCase("gpt-image-2.5")) {
      return repository.findEnabledForModel("tt-image-2.5", modelType).map(this::decrypt);
    }
    if (requested.equalsIgnoreCase("tt-image-2.5")) {
      return repository.findEnabledForModel("GPT-image2.5", modelType).map(this::decrypt);
    }

    // Keep old rows (which stored the resolved internal alias) routable while
    // new and edited rows preserve the administrator-facing model name.
    String resolved = imageProperties.resolveModel(requested).trim();
    if (resolved.equalsIgnoreCase(requested)) return Optional.empty();
    return repository.findEnabledForModel(resolved, modelType).map(this::decrypt);
  }

  public Optional<ResolvedModelApiKey> resolve(String requestedModel, String modelType, String featureCode) {
    if (!isFeatureMappingConfigured(featureCode)) return resolve(requestedModel, modelType);
    if (requestedModel == null || requestedModel.isBlank()) return Optional.empty();
    String normalized = requestedModel.trim();
    String alias = normalized;
    if (normalized.equalsIgnoreCase("banana-pro-api")) {
      alias = "banana-pro";
    } else if (normalized.equalsIgnoreCase("gpt-image2.5-sunburst-api")) {
      alias = "tt-image-2.5";
    } else if (normalized.equalsIgnoreCase("GPT-image2.5") || normalized.equalsIgnoreCase("gpt-image-2.5")) {
      alias = "tt-image-2.5";
    } else if (normalized.equalsIgnoreCase("tt-image-2.5")) {
      alias = "GPT-image2.5";
    } else if (MODEL_TYPE_IMAGE_GENERATION.equals(modelType)) {
      alias = imageProperties.resolveModel(normalized).trim();
    }
    final String aliasModel = alias;
    java.util.Set<Long> selected = java.util.Set.copyOf(featureMappings.selectedKeyIdsIfConfigured(featureCode));
    return repository.list().stream().filter(row -> selected.contains(row.id())
        && row.enabled() && modelType.equals(row.modelType())
        && (row.model().equalsIgnoreCase(normalized) || row.model().equalsIgnoreCase(aliasModel)))
        .sorted(Comparator.comparingInt(ModelApiKeyRepository.StoredModelApiKey::priority).reversed()
            .thenComparingLong(ModelApiKeyRepository.StoredModelApiKey::id))
        .findFirst().map(this::decrypt);
  }

  /** Resolves the highest-priority enabled credential when an operation has no model selector. */
  public Optional<ResolvedModelApiKey> preferredEnabledModel(String modelType) {
    return repository.list().stream()
        .filter(ModelApiKeyRepository.StoredModelApiKey::enabled)
        .filter(row -> modelType.equals(row.modelType()))
        .filter(row -> row.model() != null && !row.model().isBlank())
        .sorted(Comparator.comparingInt(ModelApiKeyRepository.StoredModelApiKey::priority).reversed()
            .thenComparingLong(ModelApiKeyRepository.StoredModelApiKey::id))
        .findFirst()
        .map(this::decrypt);
  }

  public Optional<ResolvedModelApiKey> preferredEnabledModel(String modelType, String featureCode) {
    if (!isFeatureMappingConfigured(featureCode)) return preferredEnabledModel(modelType);
    return featureMappings.defaultKeyIdIfConfigured(featureCode)
        .flatMap(id -> repository.findById(id))
        .filter(row -> row.enabled() && modelType.equals(row.modelType()))
        .map(this::decrypt);
  }

  public ResolvedModelApiKey resolveImageById(long id) {
    ModelApiKeyRepository.StoredModelApiKey stored = requireStored(id);
    if (!MODEL_TYPE_IMAGE_GENERATION.equals(stored.modelType())) {
      throw new ApiException(400, "该凭证不是生图模型配置");
    }
    return decrypt(stored);
  }

  public ResolvedModelApiKey resolveById(long id) {
    return resolveImageById(id);
  }

  public ResolvedModelApiKey resolveById(long id, String modelType) {
    ModelApiKeyRepository.StoredModelApiKey stored = requireStored(id);
    if (!modelType.equals(stored.modelType())) {
      throw new ApiException(400, "模型 API Key 类型不匹配");
    }
    return decrypt(stored);
  }

  private ModelApiKeyRepository.StoredModelApiKey requireStored(long id) {
    return repository.findById(id)
        .orElseThrow(() -> new ApiException(404, "模型 API Key 配置不存在"));
  }

  private CredentialVault.VaultPayload encrypt(String apiKey) {
    return vault.encrypt(apiKey.getBytes(StandardCharsets.UTF_8));
  }

  private ResolvedModelApiKey decrypt(ModelApiKeyRepository.StoredModelApiKey stored) {
    byte[] plaintext = vault.decrypt(new CredentialVault.VaultPayload(
        stored.encryptedApiKey(), stored.encryptedDek(), stored.encryptionKeyVersion()));
    String apiKey = new String(plaintext, StandardCharsets.UTF_8);
    if (apiKey.isBlank()) throw new ApiException(503, "模型 API Key 配置为空");
    return new ResolvedModelApiKey(
        stored.id(), stored.model(), stored.provider(), stored.baseUrl(),
        stored.generationPath(), stored.taskPath(), apiKey, defaultDataMap(stored.defaultData()));
  }

  private ModelApiKeyDtos.Row toRow(ModelApiKeyRepository.StoredModelApiKey stored) {
    String masked = "已配置";
    try {
      String apiKey = new String(vault.decrypt(new CredentialVault.VaultPayload(
          stored.encryptedApiKey(), stored.encryptedDek(), stored.encryptionKeyVersion())),
          StandardCharsets.UTF_8);
      masked = mask(apiKey);
    } catch (RuntimeException ignored) {
      // 列表接口不因主密钥暂时不可用而泄漏或阻断非敏感配置的查看。
    }
    return new ModelApiKeyDtos.Row(
        stored.id(), stored.name(), stored.model(), stored.modelType(), stored.provider(), stored.baseUrl(),
        stored.generationPath(), stored.taskPath(), masked, true, stored.enabled(),
        stored.priority(), stored.defaultData(), stored.createdAt(), stored.updatedAt());
  }

  private NormalizedRequest normalize(
      ModelApiKeyDtos.SaveRequest request,
      boolean creating,
      ModelApiKeyRepository.StoredModelApiKey existing) {
    if (request == null) throw new ApiException(400, "配置内容不能为空");
    String model = required(request.model(), "模型不能为空");
    String modelType = normalizeModelType(
        request.modelType(), existing == null ? MODEL_TYPE_IMAGE_GENERATION : existing.modelType());
    String name = optional(request.name(), existing == null ? model : existing.name());
    String provider = optional(
        request.provider(), existing == null ? DEFAULT_PROVIDER : existing.provider());
    String baseUrl = normalizeBaseUrl(required(
        request.baseUrl() == null && existing != null ? existing.baseUrl() : request.baseUrl(),
        "Base URL 不能为空"));
    String generationPath = normalizePath(optional(
        request.generationPath(),
        existing == null ? DEFAULT_GENERATION_PATH : existing.generationPath()),
        DEFAULT_GENERATION_PATH);
    String taskPath = normalizePath(optional(
        request.taskPath(), existing == null ? DEFAULT_TASK_PATH : existing.taskPath()),
        DEFAULT_TASK_PATH);
    String apiKey = request.apiKey() == null ? null : request.apiKey().trim();
    if (creating && (apiKey == null || apiKey.isBlank())) {
      throw new ApiException(400, "API Key 不能为空");
    }
    if (apiKey != null && apiKey.isBlank()) apiKey = null;
    boolean enabled = request.enabled() == null
        ? existing == null || existing.enabled()
        : request.enabled();
    int priority = request.priority() == null
        ? existing == null ? 100 : existing.priority()
        : Math.max(-10000, Math.min(10000, request.priority()));
    List<ModelApiKeyDtos.DefaultParameter> defaultData = normalizeDefaultData(
        request.defaultData() == null && existing != null ? existing.defaultData() : request.defaultData());
    return new NormalizedRequest(
        name, model, modelType, provider, baseUrl, generationPath, taskPath, apiKey, enabled, priority, defaultData);
  }

  private List<ModelApiKeyDtos.DefaultParameter> normalizeDefaultData(
      List<ModelApiKeyDtos.DefaultParameter> entries) {
    if (entries == null || entries.isEmpty()) return List.of();
    if (entries.size() > 50) throw new ApiException(400, "默认数据最多配置 50 组");
    Map<String, String> unique = new LinkedHashMap<>();
    for (ModelApiKeyDtos.DefaultParameter entry : entries) {
      if (entry == null) continue;
      String name = entry.name() == null ? "" : entry.name().trim();
      String value = entry.value() == null ? "" : entry.value().trim();
      if (name.isEmpty() && value.isEmpty()) continue;
      if (name.isEmpty() || value.isEmpty()) throw new ApiException(400, "默认数据的参数名和值都不能为空");
      if (name.length() > 128 || value.length() > 2048) throw new ApiException(400, "默认数据参数长度超出限制");
      if (unique.putIfAbsent(name, value) != null) throw new ApiException(400, "默认数据参数名不能重复");
    }
    return unique.entrySet().stream().map(entry -> new ModelApiKeyDtos.DefaultParameter(
        entry.getKey(), entry.getValue())).toList();
  }

  private String serializeDefaultData(List<ModelApiKeyDtos.DefaultParameter> values) {
    try {
      return new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(values);
    } catch (com.fasterxml.jackson.core.JsonProcessingException error) {
      throw new ApiException(400, "默认数据格式不正确");
    }
  }

  private Map<String, Object> defaultDataMap(List<ModelApiKeyDtos.DefaultParameter> values) {
    Map<String, Object> result = new LinkedHashMap<>();
    if (values != null) values.forEach(value -> result.put(value.name(), value.value()));
    return result;
  }

  private String normalizeModelType(String value, String fallback) {
    String normalized = optional(value, fallback).trim().toLowerCase();
    if (normalized.equals(MODEL_TYPE_IMAGE_GENERATION)
        || normalized.equals(MODEL_TYPE_VIDEO_GENERATION)
        || normalized.equals(MODEL_TYPE_VISION_REASONING)) {
      return normalized;
    }
    throw new ApiException(400, "模型类型必须是生图、视频或识图逻辑推理");
  }

  private String normalizeBaseUrl(String value) {
    String trimmed = value.trim();
    URI uri;
    try {
      uri = URI.create(trimmed);
    } catch (IllegalArgumentException error) {
      throw new ApiException(400, "Base URL 格式不正确");
    }
    if (uri.getScheme() == null || uri.getHost() == null
        || !(uri.getScheme().equalsIgnoreCase("https") || uri.getScheme().equalsIgnoreCase("http"))) {
      throw new ApiException(400, "Base URL 必须是 HTTP 或 HTTPS 地址");
    }
    return trimmed.endsWith("/") ? trimmed.substring(0, trimmed.length() - 1) : trimmed;
  }

  private String normalizePath(String value, String fallback) {
    String result = value == null || value.isBlank() ? fallback : value.trim();
    return result.startsWith("/") ? result : "/" + result;
  }

  private String required(String value, String message) {
    if (value == null || value.isBlank()) throw new ApiException(400, message);
    return value.trim();
  }

  private String optional(String value, String fallback) {
    return value == null || value.isBlank() ? fallback : value.trim();
  }

  private String mask(String value) {
    if (value == null || value.isBlank()) return "未配置";
    String trimmed = value.trim();
    if (trimmed.length() <= 8) return "****";
    return trimmed.substring(0, 4) + "****" + trimmed.substring(trimmed.length() - 4);
  }

  private record NormalizedRequest(
      String name,
      String model,
      String modelType,
      String provider,
      String baseUrl,
      String generationPath,
      String taskPath,
      String apiKey,
      boolean enabled,
      int priority,
      List<ModelApiKeyDtos.DefaultParameter> defaultData) {}

  public record ResolvedModelApiKey(
      long id,
      String model,
      String provider,
      String baseUrl,
      String generationPath,
      String taskPath,
      String apiKey,
      Map<String, Object> defaultData) {
    public ResolvedModelApiKey(long id, String model, String provider, String baseUrl,
        String generationPath, String taskPath, String apiKey) {
      this(id, model, provider, baseUrl, generationPath, taskPath, apiKey, Map.of());
    }

    public ResolvedModelApiKey {
      defaultData = defaultData == null ? Map.of() : Map.copyOf(defaultData);
    }
    public String generationEndpoint() {
      return baseUrl + generationPath;
    }

    public String taskEndpoint() {
      return baseUrl + taskPath;
    }
  }
}
