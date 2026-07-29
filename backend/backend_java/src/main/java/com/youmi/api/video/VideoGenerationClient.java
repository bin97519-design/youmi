package com.youmi.api.video;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import com.youmi.api.image.ImageGenerationProperties;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * GetToken Veo3.1 Fast 图生视频客户端。
 */
@Service
public class VideoGenerationClient {
  private static final String PROVIDER = "gettoken";
  private static final String VIDEO_GENERATION_PATH = "/veo3.1-fast/image-to-video";
  private static final String VIDEO_TASK_PREFIX = "gettoken-video:";
  private static final String VIDEO_MODEL = "veo31-fast-image2video";
  private static final int VIDEO_DURATION_SECONDS = 8;

  private final ObjectMapper objectMapper;
  private final ImageGenerationProperties properties;
  private final HttpClient httpClient;

  public VideoGenerationClient(ObjectMapper objectMapper, ImageGenerationProperties properties) {
    this.objectMapper = objectMapper;
    this.properties = properties;
    this.httpClient = HttpClient.newBuilder()
        .version(HttpClient.Version.HTTP_1_1)
        .followRedirects(HttpClient.Redirect.NORMAL)
        .connectTimeout(Duration.ofSeconds(10))
        .build();
  }

  public VideoGenerationDtos.CreateTaskResponse createTask(VideoGenerationDtos.CreateTaskRequest request)
      throws Exception {
    if (request == null || request.prompt() == null || request.prompt().isBlank()) {
      throw new ApiException(400, "prompt is required");
    }
    String prompt = request.prompt().trim();
    if (prompt.length() < 5 || prompt.length() > 8000) {
      throw new ApiException(400, "prompt length must be between 5 and 8000");
    }
    if (!properties.isGetTokenConfigured()) {
      throw new ApiException(400, "GetToken video api key is not configured");
    }

    List<String> imageUrls = request.normalizedImageUrls();
    if (imageUrls.size() != 1) {
      throw new ApiException(400, "Veo3.1 Fast image-to-video requires exactly one image URL");
    }

    String aspectRatio = normalizeAspectRatio(request.ratio());
    String resolution = normalizeResolution(request.resolution());
    int duration = normalizeDuration(request.durationSeconds());

    Map<String, Object> body = new LinkedHashMap<>();
    body.put("prompt", prompt);
    body.put("aspectRatio", aspectRatio);
    body.put("duration", String.valueOf(duration));
    body.put("resolution", resolution);
    body.put("imageUrls", imageUrls);
    putIfPresent(body, "webhookUrl", request.webhookUrl());
    putIfPresent(body, "clientTaskId", request.clientTaskId());

    JsonNode root = sendPost(
        properties.normalizedGetTokenBaseUrl() + VIDEO_GENERATION_PATH,
        body,
        "GetToken video request");

    String taskId = firstNonBlank(text(root, "task_id"), text(root, "taskId"), text(root, "id"));
    if (taskId.isBlank()) {
      throw new ApiException(502, "GetToken video did not return taskId: " + compact(root.toString()));
    }
    List<String> videoUrls = new ArrayList<>();
    collectVideoUrls(root, videoUrls);

    VideoGenerationDtos.CreateTaskResponse result = new VideoGenerationDtos.CreateTaskResponse();
    result.setProvider(PROVIDER);
    result.setModel(VIDEO_MODEL);
    result.setTaskId(VIDEO_TASK_PREFIX + taskId);
    result.setStatus(normalizeStatus(text(root, "status")));
    result.setVideoUrls(videoUrls);
    result.setRaw(root);
    return result;
  }

  public VideoGenerationDtos.TaskStatusResponse getTask(String taskId) throws Exception {
    if (taskId == null || taskId.isBlank()) {
      throw new ApiException(400, "taskId is required");
    }
    String clean = taskId.trim();
    if (!clean.startsWith(VIDEO_TASK_PREFIX)) {
      throw new ApiException(400, "未知的 video taskId");
    }
    String realTaskId = clean.substring(VIDEO_TASK_PREFIX.length());
    if (realTaskId.isBlank()) {
      throw new ApiException(400, "video taskId 格式错误");
    }

    Map<String, Object> body = Map.of("taskId", realTaskId);
    JsonNode root = sendPost(
        properties.normalizedGetTokenBaseUrl() + properties.normalizedGetTokenQueryPath(),
        body,
        "GetToken video poll");
    String status = normalizeStatus(text(root, "status"));
    List<String> videoUrls = new ArrayList<>();
    collectVideoUrls(root, videoUrls);
    String error = firstNonBlank(
        text(root, "errorMessage"),
        text(root, "error"),
        text(root, "message"));
    if ("completed".equals(status) && videoUrls.isEmpty()) {
      status = "failed";
      error = firstNonBlank(
          error,
          "GetToken video task completed without a video result"
              + describeOutputTypes(root.path("results")));
    }

    VideoGenerationDtos.TaskStatusResponse result = new VideoGenerationDtos.TaskStatusResponse();
    result.setProvider(PROVIDER);
    result.setTaskId(clean);
    result.setStatus(status);
    result.setProgress(progressForStatus(status));
    result.setVideoUrls(videoUrls);
    result.setError(error.isBlank() ? null : error);
    result.setRaw(root);
    return result;
  }

  private JsonNode sendPost(String endpoint, Map<String, Object> body, String operation) throws Exception {
    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(endpoint))
        .timeout(Duration.ofSeconds(Math.max(30, properties.getTimeoutSeconds())))
        .header("Authorization", "Bearer " + properties.getGetTokenApiKey())
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
        .build();
    HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      throw new ApiException(
          502,
          operation + " failed: " + response.statusCode() + " " + compact(response.body()));
    }
    if (response.body() == null || response.body().isBlank()) {
      throw new ApiException(502, operation + " returned empty body");
    }
    return objectMapper.readTree(response.body());
  }

  private String normalizeAspectRatio(String value) {
    String normalized = value == null ? "" : value.trim();
    if (normalized.isBlank()) {
      return "16:9";
    }
    if (!normalized.equals("16:9") && !normalized.equals("9:16")) {
      throw new ApiException(400, "ratio must be 16:9 or 9:16");
    }
    return normalized;
  }

  private String normalizeResolution(String value) {
    String normalized = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    if (normalized.isBlank()) {
      return "720p";
    }
    if (!normalized.equals("720p") && !normalized.equals("1080p") && !normalized.equals("4k")) {
      throw new ApiException(400, "resolution must be 720p, 1080p or 4k");
    }
    return normalized;
  }

  private int normalizeDuration(Integer value) {
    if (value == null) {
      return VIDEO_DURATION_SECONDS;
    }
    if (value != VIDEO_DURATION_SECONDS) {
      throw new ApiException(400, "durationSeconds must be 8");
    }
    return value;
  }

  private String normalizeStatus(String value) {
    String status = value == null ? "" : value.trim().toUpperCase(Locale.ROOT);
    return switch (status) {
      case "QUEUED", "PENDING", "SUBMITTED" -> "queued";
      case "RUNNING", "PROCESSING", "IN_PROGRESS" -> "processing";
      case "SUCCESS", "SUCCEEDED", "COMPLETED", "DONE", "FINISHED" -> "completed";
      case "FAILED", "FAILURE", "ERROR", "TIMEOUT" -> "failed";
      case "CANCELED", "CANCELLED" -> "canceled";
      default -> status.isBlank() ? "unknown" : status.toLowerCase(Locale.ROOT);
    };
  }

  private Integer progressForStatus(String status) {
    return switch (status) {
      case "queued" -> 0;
      case "processing" -> 50;
      case "completed", "failed", "canceled" -> 100;
      default -> null;
    };
  }

  private void putIfPresent(Map<String, Object> body, String key, Object value) {
    if (value == null) {
      return;
    }
    if (value instanceof String s && s.isBlank()) {
      return;
    }
    body.put(key, value);
  }

  private String text(JsonNode node, String field) {
    if (node == null || node.isMissingNode() || node.isNull()) {
      return "";
    }
    JsonNode value = node.path(field);
    return value.isTextual() || value.isNumber() || value.isBoolean() ? value.asText() : "";
  }

  private String firstNonBlank(String... values) {
    for (String value : values) {
      if (value != null && !value.isBlank()) {
        return value;
      }
    }
    return "";
  }

  private void collectVideoUrls(JsonNode node, List<String> urls) {
    if (node == null || node.isMissingNode() || node.isNull()) {
      return;
    }
    if (node.isTextual() && looksLikeVideoUrl(node.asText())) {
      addUrl(urls, node.asText());
      return;
    }
    if (node.isArray()) {
      for (JsonNode item : node) {
        collectVideoUrls(item, urls);
      }
      return;
    }
    if (!node.isObject()) {
      return;
    }

    String outputType = firstNonBlank(text(node, "outputType"), text(node, "output_type"));
    if (isVideoOutputType(outputType)) {
      addHttpUrl(urls, firstNonBlank(
          text(node, "video_url"),
          text(node, "videoUrl"),
          text(node, "url")));
    } else {
      collectVideoUrls(node.path("video_url"), urls);
      collectVideoUrls(node.path("videoUrl"), urls);
      collectVideoUrls(node.path("url"), urls);
    }
    collectVideoUrls(node.path("urls"), urls);
    collectVideoUrls(node.path("results"), urls);
    collectVideoUrls(node.path("result"), urls);
    collectVideoUrls(node.path("data"), urls);
  }

  private void addHttpUrl(List<String> urls, String value) {
    if (value == null || value.isBlank()) {
      return;
    }
    String normalized = value.trim().toLowerCase(Locale.ROOT);
    if (normalized.startsWith("http://")
        || normalized.startsWith("https://")
        || normalized.startsWith("data:video/")) {
      addUrl(urls, value);
    }
  }

  private void addUrl(List<String> urls, String value) {
    if (value == null || value.isBlank()) {
      return;
    }
    String trimmed = value.trim();
    if (!urls.contains(trimmed)) {
      urls.add(trimmed);
    }
  }

  private boolean looksLikeVideoUrl(String value) {
    if (value == null) {
      return false;
    }
    String lower = value.trim().toLowerCase(Locale.ROOT);
    if (lower.startsWith("data:video/")) {
      return true;
    }
    if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
      return false;
    }
    int queryIndex = lower.indexOf('?');
    String path = queryIndex >= 0 ? lower.substring(0, queryIndex) : lower;
    return path.endsWith(".mp4")
        || path.endsWith(".webm")
        || path.endsWith(".mov")
        || path.endsWith(".m4v")
        || path.endsWith(".avi")
        || path.endsWith(".mkv")
        || path.endsWith(".mpeg")
        || path.endsWith(".mpg");
  }

  private boolean isVideoOutputType(String value) {
    if (value == null || value.isBlank()) {
      return false;
    }
    String normalized = value.trim().toLowerCase(Locale.ROOT);
    return normalized.equals("video")
        || normalized.equals("mp4")
        || normalized.equals("webm")
        || normalized.equals("mov")
        || normalized.startsWith("video/");
  }

  private String describeOutputTypes(JsonNode results) {
    if (results == null || !results.isArray()) {
      return "";
    }
    List<String> types = new ArrayList<>();
    for (JsonNode item : results) {
      String value = firstNonBlank(text(item, "outputType"), text(item, "output_type"));
      if (!value.isBlank() && !types.contains(value)) {
        types.add(value);
      }
    }
    return types.isEmpty() ? "" : " (outputType=" + String.join(",", types) + ")";
  }

  private String compact(String body) {
    if (body == null || body.isBlank()) {
      return "";
    }
    String compacted = body.replaceAll("\\s+", " ").trim();
    return compacted.length() > 500 ? compacted.substring(0, 500) + "..." : compacted;
  }
}
