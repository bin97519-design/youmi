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
      @JsonProperty("webhook_url") String webhookUrl,
      @JsonProperty("client_task_id") String clientTaskId) {
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

  /**
   * 生图创建响应。改为可变类以支持在网关扣减后回填 {@code consumedMi} / {@code balance}。
   *
   * <p>访问器命名（provider()、tasks() 等）与原 record 一致，保证
   * {@link ImageTaskLogService#recordCreated} 等既有调用方无需改动；
   * 字段上的 {@code @JsonProperty} 保证序列化出的 JSON 字段名与原来完全相同。
   */
  public static class CreateTaskResponse {
    @JsonProperty("provider")
    private String provider;
    @JsonProperty("requestedModel")
    private String requestedModel;
    @JsonProperty("model")
    private String model;
    @JsonProperty("size")
    private String size;
    @JsonProperty("resolution")
    private String resolution;
    @JsonProperty("n")
    private int n;
    @JsonProperty("tasks")
    private List<TaskRef> tasks;
    @JsonProperty("raw")
    private JsonNode raw;
    @JsonProperty("consumedMi")
    private int consumedMi = 0;
    @JsonProperty("balance")
    private int balance = 0;

    public CreateTaskResponse(
        String provider, String requestedModel, String model, String size,
        String resolution, int n, List<TaskRef> tasks, JsonNode raw) {
      this(provider, requestedModel, model, size, resolution, n, tasks, raw, 0, 0);
    }

    public CreateTaskResponse(
        String provider, String requestedModel, String model, String size,
        String resolution, int n, List<TaskRef> tasks, JsonNode raw,
        int consumedMi, int balance) {
      this.provider = provider;
      this.requestedModel = requestedModel;
      this.model = model;
      this.size = size;
      this.resolution = resolution;
      this.n = n;
      this.tasks = tasks;
      this.raw = raw;
      this.consumedMi = consumedMi;
      this.balance = balance;
    }

    public String provider() {
      return provider;
    }

    public String requestedModel() {
      return requestedModel;
    }

    public String model() {
      return model;
    }

    public String size() {
      return size;
    }

    public String resolution() {
      return resolution;
    }

    public int n() {
      return n;
    }

    public List<TaskRef> tasks() {
      return tasks;
    }

    public JsonNode raw() {
      return raw;
    }

    public int consumedMi() {
      return consumedMi;
    }

    public int balance() {
      return balance;
    }

    public void setConsumedMi(int consumedMi) {
      this.consumedMi = consumedMi;
    }

    public void setBalance(int balance) {
      this.balance = balance;
    }
  }

  public record TaskStatusResponse(
      String provider,
      String taskId,
      String status,
      Integer progress,
      List<String> imageUrls,
      String persistStatus,
      String error,
      JsonNode raw) {}
}
