package com.youmi.api.admin;

import java.util.List;

public final class AiFeatureMappingDtos {
  private AiFeatureMappingDtos() {}

  public record Mapping(
      String featureCode,
      String featureName,
      String modelType,
      String selectionMode,
      String modelPolicy,
      String defaultRoute,
      String fallbackRoute,
      List<KeyRoute> keyRoutes,
      boolean configured,
      List<Long> selectedApiKeyIds,
      Long defaultApiKeyId) {}

  public record SaveRequest(List<Long> selectedApiKeyIds, Long defaultApiKeyId) {}

  public record KeyRoute(
      Long apiKeyId,
      String apiKeyName,
      String model,
      String provider,
      int priority,
      boolean enabled) {}
}
