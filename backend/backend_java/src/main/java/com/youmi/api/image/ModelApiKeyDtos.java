package com.youmi.api.image;

import java.time.LocalDateTime;

public final class ModelApiKeyDtos {
  private ModelApiKeyDtos() {}

  public record SaveRequest(
      String name,
      String model,
      String provider,
      String baseUrl,
      String generationPath,
      String taskPath,
      String apiKey,
      Boolean enabled,
      Integer priority) {}

  public record Row(
      Long id,
      String name,
      String model,
      String provider,
      String baseUrl,
      String generationPath,
      String taskPath,
      String apiKeyMasked,
      boolean hasApiKey,
      boolean enabled,
      int priority,
      LocalDateTime createdAt,
      LocalDateTime updatedAt) {}
}
