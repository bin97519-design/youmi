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
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * 视频生成客户端。复用既有 Agnes 配置（baseUrl / apiKey），不新建一套配置。
 *
 * <p><b>注意（待联调）：</b> Agnes 视频生成的具体端点与请求/响应字段当前为基于图片接口的
 * 合理推测（见 TODO 标注），重点是让米值闸门闭环正确。联调时按真实接口校准路径与字段即可，
 * 闸门逻辑（checkAndDeduct → commit / rollback）不依赖具体字段。
 */
@Service
public class VideoGenerationClient {
  // TODO(联调): 确认 Agnes 视频生成端点；以下为基于图片接口的合理推测。
  private static final String AGNES_VIDEO_GENERATION_PATH = "/v1/videos/generations";
  private static final String AGNES_VIDEO_TASK_PATH = "/v1/tasks/";
  private static final String AGNES_VIDEO_TASK_PREFIX = "agnes-video:";
  private static final String DEFAULT_VIDEO_MODEL = "agnes-video";

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
    if (!properties.isAgnesConfigured()) {
      throw new ApiException(400, "Agnes video api key is not configured");
    }

    String model = (request.model() == null || request.model().isBlank())
        ? DEFAULT_VIDEO_MODEL : request.model();
    // TODO(联调): ratio / duration 等字段需与 Agnes 视频接口确认。
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("model", model);
    body.put("prompt", request.prompt().trim());
    putIfPresent(body, "ratio", request.ratio());
    putIfPresent(body, "duration", request.durationSeconds());

    String endpoint = properties.normalizedAgnesBaseUrl() + AGNES_VIDEO_GENERATION_PATH;
    HttpRequest httpRequest = HttpRequest.newBuilder()
        .uri(URI.create(endpoint))
        .timeout(Duration.ofSeconds(120))
        .header("Authorization", "Bearer " + properties.getAgnesApiKey())
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
        .build();
    HttpResponse<String> response = httpClient.send(httpRequest, HttpResponse.BodyHandlers.ofString());
    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      throw new ApiException(502, "Agnes video request failed: " + response.statusCode() + " " + compact(response.body()));
    }
    JsonNode root = objectMapper.readTree(response.body());

    // 兼容异步（返回 task_id）与同步（直接返回视频 url）两种形态
    String taskId = firstNonBlank(text(root, "task_id"), text(root, "taskId"), text(root, "id"));
    List<String> videoUrls = new ArrayList<>();
    collectVideoUrls(root, videoUrls);

    String status;
    if (!taskId.isBlank()) {
      taskId = AGNES_VIDEO_TASK_PREFIX + taskId;
      status = "submitted";
    } else if (!videoUrls.isEmpty()) {
      taskId = AGNES_VIDEO_TASK_PREFIX + UUID.randomUUID().toString().replace("-", "");
      status = "completed";
    } else {
      throw new ApiException(502, "Agnes video did not return task_id or video url: " + compact(response.body()));
    }

    VideoGenerationDtos.CreateTaskResponse result = new VideoGenerationDtos.CreateTaskResponse();
    result.setProvider("agnes");
    result.setModel(model);
    result.setTaskId(taskId);
    result.setStatus(status);
    result.setVideoUrls(videoUrls);
    result.setRaw(root);
    return result;
  }

  public VideoGenerationDtos.TaskStatusResponse getTask(String taskId) throws Exception {
    if (taskId == null || taskId.isBlank()) {
      throw new ApiException(400, "taskId is required");
    }
    String clean = taskId.trim();
    if (!clean.startsWith(AGNES_VIDEO_TASK_PREFIX)) {
      throw new ApiException(400, "未知的 video taskId");
    }
    String realTaskId = clean.substring(AGNES_VIDEO_TASK_PREFIX.length());
    if (realTaskId.isBlank()) {
      throw new ApiException(400, "video taskId 格式错误");
    }
    // TODO(联调): 确认 Agnes 视频任务轮询端点；当前参考图片任务的 /v1/tasks/{id} 实现。
    String endpoint = properties.normalizedAgnesBaseUrl() + AGNES_VIDEO_TASK_PATH + realTaskId;
    HttpRequest httpRequest = HttpRequest.newBuilder()
        .uri(URI.create(endpoint))
        .timeout(Duration.ofSeconds(30))
        .header("Authorization", "Bearer " + properties.getAgnesApiKey())
        .GET()
        .build();
    HttpResponse<String> response = httpClient.send(httpRequest, HttpResponse.BodyHandlers.ofString());
    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      throw new ApiException(502, "Agnes video poll failed: " + response.statusCode());
    }
    JsonNode root = objectMapper.readTree(response.body());
    String status = firstNonBlank(text(root, "status"), "unknown");
    List<String> videoUrls = new ArrayList<>();
    collectVideoUrls(root, videoUrls);

    VideoGenerationDtos.TaskStatusResponse result = new VideoGenerationDtos.TaskStatusResponse();
    result.setProvider("agnes");
    result.setTaskId(clean);
    result.setStatus(status);
    result.setProgress(null);
    result.setVideoUrls(videoUrls);
    result.setError(null);
    result.setRaw(root);
    return result;
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
    collectVideoUrls(node.path("video_url"), urls);
    collectVideoUrls(node.path("videoUrl"), urls);
    collectVideoUrls(node.path("url"), urls);
    collectVideoUrls(node.path("urls"), urls);
    collectVideoUrls(node.path("result"), urls);
    collectVideoUrls(node.path("data"), urls);
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
    String lower = value.toLowerCase();
    return lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("data:video/");
  }

  private String compact(String body) {
    if (body == null || body.isBlank()) {
      return "";
    }
    String compacted = body.replaceAll("\\s+", " ").trim();
    return compacted.length() > 500 ? compacted.substring(0, 500) + "..." : compacted;
  }
}
