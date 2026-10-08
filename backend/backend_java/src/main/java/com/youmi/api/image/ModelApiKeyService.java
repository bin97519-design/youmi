package com.youmi.api.image;

import com.youmi.api.common.ApiException;
import com.youmi.api.credential.CredentialVault;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ModelApiKeyService {
  private static final String DEFAULT_PROVIDER = "youmi888";
  private static final String DEFAULT_GENERATION_PATH = "/v1/media/generate";
  private static final String DEFAULT_TASK_PATH = "/v1/media/status";

  private final ModelApiKeyRepository repository;
  private final CredentialVault vault;
  private final ImageGenerationProperties imageProperties;

  public ModelApiKeyService(
      ModelApiKeyRepository repository,
      CredentialVault vault,
      ImageGenerationProperties imageProperties) {
    this.repository = repository;
    this.vault = vault;
    this.imageProperties = imageProperties;
  }

  public List<ModelApiKeyDtos.Row> list() {
    return repository.list().stream().map(this::toRow).toList();
  }

  public boolean hasAnyEnabled() {
    return repository.hasAnyEnabled();
  }

  /** 仅公开启用配置的模型名，不暴露线路地址或密钥。 */
  public List<String> enabledModels() {
    return repository.list().stream()
        .filter(ModelApiKeyRepository.StoredModelApiKey::enabled)
        .map(ModelApiKeyRepository.StoredModelApiKey::model)
        .filter(model -> model != null && !model.isBlank())
        .distinct()
        .toList();
  }

  @Transactional
  public ModelApiKeyDtos.Row create(ModelApiKeyDtos.SaveRequest request, Long createdBy) {
    NormalizedRequest normalized = normalize(request, true, null);
    CredentialVault.VaultPayload payload = encrypt(normalized.apiKey());
    long id = repository.insert(
        normalized.name(), normalized.model(), normalized.provider(), normalized.baseUrl(),
        normalized.generationPath(), normalized.taskPath(), payload.encryptedPayload(),
        payload.encryptedDek(), payload.keyVersion(), normalized.enabled(), normalized.priority(),
        createdBy);
    return toRow(requireStored(id));
  }

  @Transactional
  public ModelApiKeyDtos.Row update(long id, ModelApiKeyDtos.SaveRequest request) {
    ModelApiKeyRepository.StoredModelApiKey existing = requireStored(id);
    NormalizedRequest normalized = normalize(request, false, existing);
    repository.updateMetadata(
        id, normalized.name(), normalized.model(), normalized.provider(), normalized.baseUrl(),
        normalized.generationPath(), normalized.taskPath(), normalized.enabled(),
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
    if (requestedModel == null || requestedModel.isBlank()) return Optional.empty();
    String requested = requestedModel.trim();
    Optional<ModelApiKeyRepository.StoredModelApiKey> exact =
        repository.findEnabledForModel(requested);
    if (exact.isPresent()) return exact.map(this::decrypt);

    // Keep old rows (which stored the resolved internal alias) routable while
    // new and edited rows preserve the administrator-facing model name.
    String resolved = imageProperties.resolveModel(requested).trim();
    if (resolved.equalsIgnoreCase(requested)) return Optional.empty();
    return repository.findEnabledForModel(resolved).map(this::decrypt);
  }

  public ResolvedModelApiKey resolveById(long id) {
    return decrypt(requireStored(id));
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
        stored.generationPath(), stored.taskPath(), apiKey);
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
        stored.id(), stored.name(), stored.model(), stored.provider(), stored.baseUrl(),
        stored.generationPath(), stored.taskPath(), masked, true, stored.enabled(),
        stored.priority(), stored.createdAt(), stored.updatedAt());
  }

  private NormalizedRequest normalize(
      ModelApiKeyDtos.SaveRequest request,
      boolean creating,
      ModelApiKeyRepository.StoredModelApiKey existing) {
    if (request == null) throw new ApiException(400, "配置内容不能为空");
    String model = required(request.model(), "模型不能为空");
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
    return new NormalizedRequest(
        name, model, provider, baseUrl, generationPath, taskPath, apiKey, enabled, priority);
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
      String provider,
      String baseUrl,
      String generationPath,
      String taskPath,
      String apiKey,
      boolean enabled,
      int priority) {}

  public record ResolvedModelApiKey(
      long id,
      String model,
      String provider,
      String baseUrl,
      String generationPath,
      String taskPath,
      String apiKey) {
    public String generationEndpoint() {
      return baseUrl + generationPath;
    }

    public String taskEndpoint() {
      return baseUrl + taskPath;
    }
  }
}
