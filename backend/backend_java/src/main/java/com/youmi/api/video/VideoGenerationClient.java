package com.youmi.api.video;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import com.youmi.api.file.OssStorageService;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import org.springframework.stereotype.Service;

/** THQ video generation client. API keys stay on the backend and completed videos are persisted to OSS. */
@Service
public class VideoGenerationClient {
  private static final String PROVIDER = "thq";
  private static final String TASK_PREFIX = "thq-video:";
  private static final String CREATE_PATH = "/videos";
  private static final long MAX_REFERENCE_BYTES = 30L * 1024L * 1024L;
  private static final Set<String> RATIOS = Set.of("21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "adaptive");
  private static final Map<String, ModelSpec> MODELS = Map.of(
      "seedance-2.0-0826-480p", new ModelSpec("480p"),
      "seedance-2.0-0826-720p", new ModelSpec("720p"),
      "seedance-2.0-fast-0826-480p", new ModelSpec("480p"),
      "seedance-2.0-fast-0826-720p", new ModelSpec("720p"));

  private final ObjectMapper objectMapper;
  private final VideoGenerationProperties properties;
  private final OssStorageService ossStorageService;
  private final HttpClient httpClient;
  private final ConcurrentMap<String, String> persistedVideoUrls = new ConcurrentHashMap<>();
  private final ConcurrentMap<String, Object> persistLocks = new ConcurrentHashMap<>();

  public VideoGenerationClient(
      ObjectMapper objectMapper,
      VideoGenerationProperties properties,
      OssStorageService ossStorageService) {
    this.objectMapper = objectMapper;
    this.properties = properties;
    this.ossStorageService = ossStorageService;
    this.httpClient = HttpClient.newBuilder()
        .version(HttpClient.Version.HTTP_1_1)
        .followRedirects(HttpClient.Redirect.NORMAL)
        .connectTimeout(Duration.ofSeconds(15))
        .build();
  }

  public VideoGenerationDtos.CreateTaskResponse createTask(VideoGenerationDtos.CreateTaskRequest request)
      throws Exception {
    NormalizedRequest normalized = normalizeRequest(request);
    requireConfigured();
    JsonNode root = sendJsonCreate(normalized);
    ensureSuccessful(root, "THQ video create");

    String taskId = firstNonBlank(
        text(root, "id"),
        text(root, "task_id"),
        text(root.path("data"), "id"),
        text(root.path("data"), "task_id"));
    if (taskId.isBlank()) {
      throw new ApiException(502, "THQ video did not return task_id: " + compact(root.toString()));
    }

    VideoGenerationDtos.CreateTaskResponse result = new VideoGenerationDtos.CreateTaskResponse();
    result.setProvider(PROVIDER);
    result.setModel(normalized.model());
    result.setTaskId(TASK_PREFIX + taskId);
    result.setStatus(normalizeStatus(firstNonBlank(text(root, "status"), text(root.path("data"), "status"))));
    result.setRaw(root);
    return result;
  }

  public VideoGenerationDtos.TaskStatusResponse getTask(String taskId, Long userId) throws Exception {
    String cleanTaskId = requireTaskId(taskId);
    String realTaskId = cleanTaskId.substring(TASK_PREFIX.length());
    JsonNode root = sendJson(
        "GET",
        properties.normalizedBaseUrl() + CREATE_PATH + "/" + encodePath(realTaskId),
        null,
        "THQ video poll");

    String status = normalizeStatus(firstNonBlank(text(root, "status"), text(root.path("data"), "status")));
    if (isFailureEnvelope(root)) status = "failed";
    Integer progress = integer(root, "progress");
    if (progress == null) progress = integer(root.path("data"), "progress");
    if (progress == null) progress = progressForStatus(status);
    String error = extractError(root);
    List<String> videoUrls = new ArrayList<>();

    if ("completed".equals(status)) {
      String providerUrl = resolveDownloadUrl(root);
      if (properties.isPersistGeneratedVideos()) {
        try {
          videoUrls.add(persistVideo(cleanTaskId, realTaskId, providerUrl, userId));
        } catch (Exception persistError) {
          System.err.println("[video-persist] task=" + cleanTaskId + " failed: " + persistError.getMessage());
          status = "persisting";
          progress = 96;
        }
      } else {
        videoUrls.add(providerUrl);
      }
    }

    VideoGenerationDtos.TaskStatusResponse result = new VideoGenerationDtos.TaskStatusResponse();
    result.setProvider(PROVIDER);
    result.setTaskId(cleanTaskId);
    result.setStatus(status);
    result.setProgress(progress);
    result.setVideoUrls(videoUrls);
    result.setError(error.isBlank() ? null : error);
    result.setRaw(root);
    return result;
  }

  private NormalizedRequest normalizeRequest(VideoGenerationDtos.CreateTaskRequest request) {
    if (request == null || request.prompt() == null || request.prompt().isBlank()) {
      throw new ApiException(400, "prompt is required");
    }
    String prompt = request.prompt().trim();
    if (prompt.length() > 2500) throw new ApiException(400, "prompt must not exceed 2500 characters");

    String model = blankToDefault(request.model(), "seedance-2.0-fast-0826-720p");
    ModelSpec spec = MODELS.get(model);
    if (spec == null) throw new ApiException(400, "unsupported THQ video model: " + model);

    String ratio = blankToDefault(request.ratio(), "16:9");
    if (!RATIOS.contains(ratio)) throw new ApiException(400, "unsupported video aspect ratio: " + ratio);

    int duration = request.durationSeconds() == null ? 15 : request.durationSeconds();
    if (duration != 15) throw new ApiException(400, "SD2 official video duration must be 15 seconds");

    String resolution = blankToDefault(request.resolution(), spec.resolution()).toLowerCase(Locale.ROOT);
    if (!spec.resolution().equals(resolution)) {
      throw new ApiException(400, "resolution must match the SD2 official model suffix");
    }

    Long seed = request.seed();
    if (seed != null && (seed < 0 || seed > 2147483647L)) {
      throw new ApiException(400, "seed must be between 0 and 2147483647");
    }

    String firstFrameUrl = request.normalizedFirstFrameUrl();
    String lastFrameUrl = request.lastFrameUrl() == null ? "" : request.lastFrameUrl().trim();
    List<String> references = request.normalizedReferenceImageUrls();
    int imageCount = references.size() + (firstFrameUrl.isBlank() ? 0 : 1) + (lastFrameUrl.isBlank() ? 0 : 1);
    if (imageCount > 15) throw new ApiException(400, "SD2 official video supports at most 15 references");

    String idempotencyKey = normalizeIdempotencyKey(request.clientTaskId());

    return new NormalizedRequest(
        prompt,
        model,
        ratio,
        duration,
        resolution,
        firstFrameUrl,
        lastFrameUrl,
        references,
        request.negativePrompt() == null ? "" : request.negativePrompt().trim(),
        request.generateAudio() == null || request.generateAudio(),
        seed,
        idempotencyKey);
  }

  private JsonNode sendJsonCreate(NormalizedRequest request) throws Exception {
    HttpRequest httpRequest = authorizedRequest(properties.normalizedBaseUrl() + CREATE_PATH)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .header("Idempotency-Key", request.idempotencyKey())
        .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(textParameters(request))))
        .build();
    return send(httpRequest, "THQ video create");
  }

  private Map<String, Object> textParameters(NormalizedRequest request) throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("model", request.model());
    body.put("prompt", promptWithReferenceBinding(request));
    body.put("seconds", "15");
    body.put("aspect_ratio", request.ratio());
    // The official guide says the model suffix is sufficient, but the live priced-model
    // gateway currently rejects requests unless resolution (or size) is also present.
    body.put("resolution", request.resolution());
    body.put("generate_audio", request.generateAudio());
    if (!request.negativePrompt().isBlank()) body.put("negative_prompt", request.negativePrompt());
    if (request.seed() != null) body.put("seed", request.seed());
    List<Map<String, String>> references = referenceParameters(request);
    if (!references.isEmpty()) body.put("references", references);
    return body;
  }

  private List<Map<String, String>> referenceParameters(NormalizedRequest request) throws Exception {
    List<Map<String, String>> references = new ArrayList<>();
    for (String source : request.allReferenceUrls()) {
      references.add(Map.of(
          "type", "image",
          "role", "reference",
          "source", prepareReferenceSource(source)));
    }
    return references;
  }

  private String prepareReferenceSource(String source) throws Exception {
    String value = source == null ? "" : source.trim();
    if (value.startsWith("data:image/")) return value;

    URI uri;
    try {
      uri = URI.create(value);
    } catch (Exception error) {
      throw new ApiException(400, "invalid reference image URL");
    }
    String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
    if (!"http".equals(scheme) && !"https".equals(scheme)) {
      throw new ApiException(400, "reference images must use HTTPS URLs or data URIs");
    }

    // Embed remote images so the provider never has to fetch expiring or access-restricted URLs.
    DownloadedAsset asset = downloadReference(value);
    return "data:" + asset.contentType() + ";base64," + Base64.getEncoder().encodeToString(asset.bytes());
  }

  private String promptWithReferenceBinding(NormalizedRequest request) {
    if (request.allReferenceUrls().isEmpty()) return request.prompt();
    String instruction = "必须以参考图中的主体为视频核心，保持其外观、颜色、材质和关键结构一致，不得替换或忽略参考主体。\n";
    int available = Math.max(0, 2500 - instruction.length());
    String prompt = request.prompt().length() > available
        ? request.prompt().substring(0, available)
        : request.prompt();
    return instruction + prompt;
  }

  private DownloadedAsset downloadReference(String sourceUrl) throws Exception {
    URI uri;
    try {
      uri = URI.create(sourceUrl);
    } catch (Exception error) {
      throw new ApiException(400, "invalid reference image URL");
    }
    String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
    if (!scheme.equals("http") && !scheme.equals("https")) {
      throw new ApiException(400, "reference images must use http or https URLs");
    }

    HttpRequest request = HttpRequest.newBuilder()
        .uri(uri)
        .timeout(Duration.ofSeconds(Math.max(30, properties.getTimeoutSeconds())))
        .header("Accept", "image/jpeg,image/png,image/webp,image/*")
        .header("User-Agent", "Youmi-Canvas/1.0")
        .GET()
        .build();
    HttpResponse<byte[]> response = httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      throw new ApiException(502, "reference image download failed: " + response.statusCode());
    }
    byte[] bytes = response.body();
    if (bytes == null || bytes.length == 0) throw new ApiException(502, "reference image is empty");
    if (bytes.length > MAX_REFERENCE_BYTES) throw new ApiException(400, "reference image exceeds 30MB");

    String contentType = response.headers().firstValue("Content-Type").orElse("")
        .split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
    if (!Set.of("image/jpeg", "image/png", "image/webp").contains(contentType)) {
      contentType = inferImageContentType(uri.getPath());
    }
    if (contentType.isBlank()) throw new ApiException(400, "reference image must be JPEG, PNG or WebP");
    return new DownloadedAsset(contentType, bytes);
  }

  private String persistVideo(String taskId, String realTaskId, String providerUrl, Long userId) throws Exception {
    String cached = persistedVideoUrls.get(taskId);
    if (cached != null && !cached.isBlank()) return cached;
    if (ossStorageService == null || !ossStorageService.isConfigured()) {
      throw new ApiException(502, "OSS is not configured for generated video persistence");
    }

    Object lock = persistLocks.computeIfAbsent(taskId, ignored -> new Object());
    try {
      synchronized (lock) {
        cached = persistedVideoUrls.get(taskId);
        if (cached != null && !cached.isBlank()) return cached;

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(providerUrl))
            .timeout(Duration.ofSeconds(Math.max(120, properties.getDownloadTimeoutSeconds())))
            .header("Accept", "video/*,application/octet-stream")
            .header("User-Agent", "Youmi-Canvas/1.0")
            .GET()
            .build();
        HttpResponse<InputStream> response = httpClient.send(request, HttpResponse.BodyHandlers.ofInputStream());
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
          try (InputStream ignored = response.body()) {
            // Close the response body before retrying on a later poll.
          }
          throw new ApiException(502, "THQ video download failed: " + response.statusCode());
        }

        String contentType = response.headers().firstValue("Content-Type").orElse("video/mp4")
            .split(";", 2)[0].trim();
        String safeTask = realTaskId.replaceAll("[^A-Za-z0-9._-]", "_");
        String objectName = ossStorageService.scopeUserDir(userId, "generated-videos")
            + "/" + LocalDate.now() + "/" + safeTask + extensionForVideo(contentType);
        try (InputStream input = response.body()) {
          ossStorageService.uploadStream(input, objectName, contentType);
        }
        String storedUrl = ossStorageService.getFileUrl(objectName);
        persistedVideoUrls.put(taskId, storedUrl);
        System.out.println("[video-persist] stored generated video to OSS: " + storedUrl);
        return storedUrl;
      }
    } finally {
      persistLocks.remove(taskId, lock);
    }
  }

  private JsonNode sendJson(String method, String endpoint, String body, String operation) throws Exception {
    HttpRequest.Builder builder = authorizedRequest(endpoint).header("Accept", "application/json");
    if ("POST".equals(method)) {
      builder.header("Content-Type", "application/json")
          .POST(HttpRequest.BodyPublishers.ofString(body == null ? "{}" : body));
    } else {
      builder.GET();
    }
    return send(builder.build(), operation);
  }

  private JsonNode send(HttpRequest request, String operation) throws Exception {
    HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      throw new ApiException(502, operation + " failed: " + response.statusCode() + " " + compact(response.body()));
    }
    if (response.body() == null || response.body().isBlank()) {
      throw new ApiException(502, operation + " returned empty body");
    }
    return objectMapper.readTree(response.body());
  }

  private HttpRequest.Builder authorizedRequest(String endpoint) {
    return HttpRequest.newBuilder()
        .uri(URI.create(endpoint))
        .timeout(Duration.ofSeconds(Math.max(30, properties.getTimeoutSeconds())))
        .header("Authorization", "Bearer " + properties.getApiKey())
        .header("User-Agent", "Youmi-Canvas/1.0");
  }

  private void ensureSuccessful(JsonNode root, String operation) {
    if (isFailureEnvelope(root)) {
      throw new ApiException(502, operation + " failed: " + extractError(root));
    }
  }

  private boolean isFailureEnvelope(JsonNode root) {
    JsonNode success = root.path("success");
    if (success.isBoolean() && !success.asBoolean()) return true;

    String status = normalizeStatus(firstNonBlank(
        text(root, "status"),
        text(root.path("data"), "status")));
    if ("failed".equals(status) || "canceled".equals(status)) return true;

    String code = firstNonBlank(
        text(root, "code"),
        text(root.path("error"), "code"),
        text(root.path("data"), "code"));
    if (code.isBlank()) return false;
    String normalized = code.trim().toLowerCase(Locale.ROOT);
    return normalized.contains("fail")
        || normalized.contains("error")
        || normalized.contains("invalid")
        || normalized.contains("denied")
        || normalized.contains("expired")
        || normalized.contains("cancel");
  }

  private String requireTaskId(String taskId) {
    if (taskId == null || taskId.isBlank()) throw new ApiException(400, "taskId is required");
    String clean = taskId.trim();
    if (!clean.startsWith(TASK_PREFIX) || clean.length() <= TASK_PREFIX.length()) {
      throw new ApiException(400, "unknown video taskId");
    }
    return clean;
  }

  private String resolveDownloadUrl(JsonNode root) {
    String value = firstNonBlank(
        text(root, "download_url"),
        text(root, "downloadUrl"),
        text(root.path("data"), "download_url"),
        text(root.path("data"), "downloadUrl"));
    if (value.isBlank()) throw new ApiException(502, "THQ completed video did not return download_url");
    return URI.create(properties.normalizedBaseUrl() + "/").resolve(value).toString();
  }

  private String extractError(JsonNode root) {
    String value = firstNonBlank(
        text(root, "message"),
        text(root, "error_message"),
        text(root.path("data"), "message"),
        text(root.path("data"), "error_message"));
    if (!value.isBlank()) return value;
    JsonNode error = root.path("error");
    if (!error.isMissingNode() && !error.isNull()) {
      return error.isTextual() ? error.asText() : compact(error.toString());
    }
    return firstNonBlank(text(root, "code"), text(root.path("data"), "code"));
  }

  private String normalizeStatus(String value) {
    String status = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    return switch (status) {
      case "queued", "pending", "submitted" -> "queued";
      case "running", "processing", "in_progress" -> "processing";
      case "success", "succeeded", "completed", "done", "finished" -> "completed";
      case "failure", "failed", "error", "timeout" -> "failed";
      case "canceled", "cancelled" -> "canceled";
      default -> status.isBlank() ? "queued" : status;
    };
  }

  private Integer progressForStatus(String status) {
    return switch (status) {
      case "queued" -> 0;
      case "processing" -> 50;
      case "persisting" -> 96;
      case "completed", "failed", "canceled" -> 100;
      default -> null;
    };
  }

  private Integer integer(JsonNode node, String field) {
    JsonNode value = node == null ? null : node.path(field);
    return value != null && value.isNumber() ? Math.max(0, Math.min(100, value.asInt())) : null;
  }

  private String text(JsonNode node, String field) {
    if (node == null || node.isMissingNode() || node.isNull()) return "";
    JsonNode value = node.path(field);
    return value.isTextual() || value.isNumber() || value.isBoolean() ? value.asText() : "";
  }

  private String firstNonBlank(String... values) {
    for (String value : values) {
      if (value != null && !value.isBlank()) return value;
    }
    return "";
  }

  private String blankToDefault(String value, String fallback) {
    return value == null || value.isBlank() ? fallback : value.trim();
  }

  private String inferImageContentType(String path) {
    String lower = path == null ? "" : path.toLowerCase(Locale.ROOT);
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".webp")) return "image/webp";
    return "";
  }

  private String extensionForVideo(String contentType) {
    String normalized = contentType == null ? "" : contentType.toLowerCase(Locale.ROOT);
    if (normalized.contains("webm")) return ".webm";
    if (normalized.contains("quicktime")) return ".mov";
    return ".mp4";
  }

  private String encodePath(String value) {
    return value.replace("%", "%25").replace("/", "%2F").replace("?", "%3F").replace("#", "%23");
  }

  private String compact(String body) {
    if (body == null || body.isBlank()) return "";
    String compacted = body.replaceAll("\\s+", " ").trim();
    return compacted.length() > 500 ? compacted.substring(0, 500) + "..." : compacted;
  }

  private void requireConfigured() {
    if (!properties.isConfigured()) throw new ApiException(400, "THQ_VIDEO_API_KEY is not configured");
  }

  private String normalizeIdempotencyKey(String value) {
    String normalized = value == null ? "" : value.trim();
    if (normalized.matches("[A-Za-z0-9._:-]{1,128}")) return normalized;
    return "youmi-video-" + UUID.randomUUID();
  }

  private record ModelSpec(String resolution) {}

  private record DownloadedAsset(String contentType, byte[] bytes) {}

  private record NormalizedRequest(
      String prompt,
      String model,
      String ratio,
      int duration,
      String resolution,
      String firstFrameUrl,
      String lastFrameUrl,
      List<String> referenceImageUrls,
      String negativePrompt,
      boolean generateAudio,
      Long seed,
      String idempotencyKey) {
    List<String> allReferenceUrls() {
      List<String> result = new ArrayList<>();
      if (!firstFrameUrl.isBlank()) result.add(firstFrameUrl);
      if (!lastFrameUrl.isBlank() && !result.contains(lastFrameUrl)) result.add(lastFrameUrl);
      for (String url : referenceImageUrls) {
        if (!result.contains(url)) result.add(url);
      }
      return result;
    }
  }
}
