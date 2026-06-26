package com.youmi.api.image;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

public class ImageGenerationDtos {
  public record StatusResponse(
      boolean configured,
      String baseUrl,
      String generationPath,
      String taskPath,
      String defaultModel,
      String defaultSize,
      String defaultResolution,
      Map<String, String> modelAliases) {}

  public record CreateTaskRequest(
      String prompt,
      String model,
      String size,
      String ratio,
      String resolution,
      Integer n,
      Integer count,
      @JsonProperty("image_urls") List<String> imageUrlsSnake,
      @JsonAlias("imageUrls") List<String> imageUrls,
      String background,
      @JsonProperty("output_format") String outputFormat,
      String moderation,
      @JsonProperty("input_fidelity") String inputFidelity,
      @JsonProperty("output_compression") Integer outputCompression,
      @JsonProperty("webhook_url") String webhookUrl) {
    public List<String> normalizedImageUrls() {
      LinkedHashSet<String> urls = new LinkedHashSet<>();
      addUrls(urls, imageUrlsSnake);
      addUrls(urls, imageUrls);
      return new ArrayList<>(urls);
    }

    public int requestedCount() {
      int value = count == null ? (n == null ? 1 : n) : count;
      return Math.max(1, Math.min(4, value));
    }

    private static void addUrls(LinkedHashSet<String> urls, List<String> values) {
      if (values == null) return;
      for (String value : values) {
        if (value != null && !value.isBlank()) urls.add(value.trim());
      }
    }
  }

  public record TaskRef(String taskId, String status) {}

  public record CreateTaskResponse(
      String provider,
      String requestedModel,
      String model,
      String size,
      String resolution,
      int n,
      List<TaskRef> tasks,
      JsonNode raw) {}

  public record TaskStatusResponse(
      String provider,
      String taskId,
      String status,
      Integer progress,
      List<String> imageUrls,
      String error,
      JsonNode raw) {}
}
