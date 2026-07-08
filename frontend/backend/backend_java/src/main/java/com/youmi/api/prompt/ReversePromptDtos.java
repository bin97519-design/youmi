package com.youmi.api.prompt;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Map;

public final class ReversePromptDtos {
  private ReversePromptDtos() {}

  public record AnalyzeImageRequest(
      String category,
      String imageUrl,
      String imageBase64,
      Boolean thinkingEnabled) {}

  public record AnalyzeImageResponse(
      String provider,
      String model,
      String category,
      String categoryLabel,
      JsonNode promptJson,
      String promptText,
      List<GroupMeta> groups,
      Map<String, String> fieldLabels,
      String raw) {}

  public record BridgeResult(
      String source,
      String category,
      String categoryLabel,
      String imageUrl,
      String thumbnailUrl,
      String pageUrl,
      JsonNode promptJson,
      String promptText,
      String createdAt) {}

  public record CategoryMeta(
      String value,
      String label,
      List<GroupMeta> groups,
      Map<String, String> fieldLabels) {}

  public record GroupMeta(String label, List<String> categories) {}
}
