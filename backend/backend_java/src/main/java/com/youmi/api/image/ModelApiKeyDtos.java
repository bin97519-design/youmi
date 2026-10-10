package com.youmi.api.image;

import java.time.LocalDateTime;
import java.util.List;

public final class ModelApiKeyDtos {
  private ModelApiKeyDtos() {}

  public record SaveRequest(
      String name,
      String model,
      String modelType,
      String provider,
      String baseUrl,
      String generationPath,
      String taskPath,
      String apiKey,
      Boolean enabled,
      Integer priority,
      List<DefaultParameter> defaultData) {
    public SaveRequest(String name, String model, String modelType, String provider, String baseUrl,
        String generationPath, String taskPath, String apiKey, Boolean enabled, Integer priority) {
      this(name, model, modelType, provider, baseUrl, generationPath, taskPath, apiKey, enabled, priority, null);
    }
  }

  public record DefaultParameter(String name, String value) {}

  public record Row(
      Long id,
      String name,
      String model,
      String modelType,
      String provider,
      String baseUrl,
      String generationPath,
      String taskPath,
      String apiKeyMasked,
      boolean hasApiKey,
      boolean enabled,
      int priority,
      List<DefaultParameter> defaultData,
      LocalDateTime createdAt,
      LocalDateTime updatedAt) {}

  public record ModelOption(String value, String label, String provider) {}
}
