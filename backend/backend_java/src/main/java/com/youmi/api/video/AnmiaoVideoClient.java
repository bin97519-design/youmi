package com.youmi.api.video;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import com.youmi.api.image.ModelApiKeyDtos;
import com.youmi.api.image.ModelApiKeyService;
import com.youmi.api.image.ModelApiKeyService.ResolvedModelApiKey;
import com.youmi.api.ai.AiCallLogService;
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
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;

/** Volcengine-compatible task transport for LK888's per-second Seedance models. */
@Service
public class AnmiaoVideoClient {
  public static final String MODEL = "doubao-seedance-2-0-260128";
  public static final String MODEL25 = "doubao-seedance-2-5-260628";
  public static final String PREFIX = "anmiao-video:";
  private static final String PROVIDER = "anmiao";
  private static final Set<String> RATIOS = Set.of("adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9");
  public static final Set<String> RESOLUTIONS = Set.of("480p", "720p", "1080p", "4k");
  public static final Set<String> RESOLUTIONS25 = Set.of("480p", "720p", "1080p");

  private final AnmiaoVideoProperties properties;
  private final VideoGenerationClient media;
  private final ObjectMapper mapper;
  private final ModelApiKeyService modelApiKeys;
  private final AiCallLogService aiCallLogService;
  private final HttpClient http;

  public AnmiaoVideoClient(AnmiaoVideoProperties properties, VideoGenerationClient media, ObjectMapper mapper) {
    this(properties, media, mapper, null, null);
  }

  @Autowired
  public AnmiaoVideoClient(
      AnmiaoVideoProperties properties,
      VideoGenerationClient media,
      ObjectMapper mapper,
      ModelApiKeyService modelApiKeys,
      AiCallLogService aiCallLogService) {
    this.properties = properties;
    this.media = media;
    this.mapper = mapper;
    this.modelApiKeys = modelApiKeys;
    this.aiCallLogService = aiCallLogService;
    this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build();
  }

  public AnmiaoVideoClient(AnmiaoVideoProperties properties, VideoGenerationClient media,
      ObjectMapper mapper, ModelApiKeyService modelApiKeys) {
    this(properties, media, mapper, modelApiKeys, null);
  }

  public boolean available() { return properties.isAvailable(); }
  public boolean available25() { return properties.isAvailable25(); }

  public boolean hasConfiguredModelVersion(boolean version25) {
    String marker = version25 ? "seedance-2-5" : "seedance-2-0";
    return configuredModels().stream().anyMatch(option -> option.value() != null
        && option.value().toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-").contains(marker));
  }

  public List<ModelApiKeyDtos.ModelOption> configuredModels() {
    return modelApiKeys == null ? List.of() : modelApiKeys.enabledModelOptions(
        ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video");
  }

  public boolean isMappedModelConfigured() {
    return modelApiKeys != null && modelApiKeys.isFeatureMappingConfigured("canvas-video");
  }

  public boolean isConfiguredKeyExcluded(String model) {
    return isMappedModelConfigured() && modelApiKeys.hasEnabledModel(
        model, ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION)
        && resolveConfiguredModel(model) == null;
  }

  public boolean supportsModel(String model) {
    if (MODEL.equals(model) || MODEL25.equals(model)) return true;
    return resolveConfiguredModel(model) != null && model != null
        && model.toLowerCase(Locale.ROOT).contains("seedance-2.");
  }

  public int price(VideoGenerationDtos.CreateTaskRequest request) {
    validate(request);
    int rate = isModel25(request.model())
        ? properties.miPerSecond25(resolution(request)) : properties.miPerSecond(resolution(request));
    ResolvedModelApiKey credential = resolveConfiguredModel(request.model());
    String key = credential == null ? properties.apiKeyForModel(request.model()) : credential.apiKey();
    if (key == null || key.isBlank() || rate == 0)
      throw new ApiException(503, "按秒视频所选画质尚未配置密钥和每秒米值单价");
    return Math.multiplyExact(request.durationSeconds(), rate);
  }

  public VideoGenerationDtos.CreateTaskResponse createTask(VideoGenerationDtos.CreateTaskRequest request) throws Exception {
    price(request);
    ResolvedModelApiKey credential = resolveConfiguredModel(request.model());
    List<Object> content = new ArrayList<>();
    content.add(Map.of("type", "text", "text", request.prompt().trim()));
    List<String> references = referenceImages(request);
    String firstFrame = request.normalizedFirstFrameUrl();
    if (!references.isEmpty()) {
      for (String url : references) content.add(image("reference_image", url));
    } else if (!firstFrame.isBlank()) {
      content.add(image("first_frame", firstFrame));
    }
    String lastFrame = request.lastFrameUrl() == null ? "" : request.lastFrameUrl().trim();
    if (!lastFrame.isBlank()) content.add(image("last_frame", lastFrame));
    String endpoint = credential == null
        ? properties.normalizedBaseUrl() + "/contents/generations/tasks"
        : credential.generationEndpoint();
    String apiKey = credential == null ? properties.apiKeyForModel(request.model()) : credential.apiKey();
    long started = System.nanoTime();
    JsonNode root;
    String id;
    try {
      Map<String, Object> body = new LinkedHashMap<>(credential == null ? Map.of() : credential.defaultData());
      body.put("model", providerModel(request.model()));
      body.put("content", content);
      body.put("resolution", resolution(request));
      body.put("ratio", request.ratio());
      body.put("duration", request.durationSeconds());
      root = sendUrl(apiKey, "POST", endpoint, body);
      id = providerTaskId(root);
      if (!id.matches("[A-Za-z0-9_-]+")) throw new ApiException(502, "按秒视频接口未返回有效任务编号");
      recordCall("canvas-video", request.model(), credential, true, started, null);
    } catch (Exception error) {
      recordCall("canvas-video", request.model(), credential, false, started, error);
      throw error;
    }
    var result = new VideoGenerationDtos.CreateTaskResponse();
    result.setProvider(credential == null ? PROVIDER : credential.provider());
    result.setModel(request.model());
    // Persist the credential route in the ID so polling still works after a restart.
    String keyRoute = credential != null ? "key:" + credential.id() + ":"
        : properties.hasDedicatedKey(request.model())
        ? (MODEL25.equals(request.model()) ? "25:" : "20:") : "";
    result.setTaskId(PREFIX + keyRoute + id);
    result.setStatus("queued");
    result.setRaw(root);
    return result;
  }

  public VideoGenerationDtos.TaskStatusResponse getTask(String taskId, Long userId) throws Exception {
    if (taskId == null || !taskId.matches("anmiao-video:(?:(?:20|25):|key:[0-9]+:)?[A-Za-z0-9_-]+"))
      throw new ApiException(400, "按秒视频任务编号无效");
    String routeAndId = taskId.substring(PREFIX.length());
    ResolvedModelApiKey credential = null;
    String endpoint;
    String key;
    String id;
    if (routeAndId.startsWith("key:")) {
      int separator = routeAndId.indexOf(':', 4);
      long credentialId = Long.parseLong(routeAndId.substring(4, separator));
      credential = modelApiKeys.resolveById(credentialId, ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION);
      id = routeAndId.substring(separator + 1);
      endpoint = credential.taskEndpoint().replace("{id}", id);
      if (endpoint.equals(credential.taskEndpoint())) endpoint += "/" + id;
      key = credential.apiKey();
    } else {
      key = routeAndId.startsWith("20:") ? properties.apiKeyForModel(MODEL)
        : routeAndId.startsWith("25:") ? properties.apiKeyForModel(MODEL25) : properties.getApiKey();
      id = routeAndId.substring(routeAndId.lastIndexOf(':') + 1);
      endpoint = properties.normalizedBaseUrl() + "/contents/generations/tasks/" + id;
    }
    JsonNode root = sendUrl(key, "GET", endpoint, null);
    JsonNode task = taskPayload(root);
    String providerStatus = text(task, "status").toLowerCase(Locale.ROOT);
    String status = switch (providerStatus) {
      case "queued", "pending" -> "queued";
      case "running", "processing" -> "processing";
      case "succeeded", "completed" -> "completed";
      case "failed", "error", "cancelled", "canceled" -> "failed";
      default -> throw new ApiException(502, "按秒视频接口返回未知状态：" + providerStatus);
    };
    var result = new VideoGenerationDtos.TaskStatusResponse();
    result.setProvider(credential == null ? PROVIDER : credential.provider());
    result.setTaskId(taskId);
    result.setStatus(status);
    result.setStage(switch (status) {
      case "queued" -> "中转站排队中";
      case "processing" -> "中转站生成中";
      case "failed" -> "生成失败";
      default -> "已完成";
    });
    result.setProgress("completed".equals(status) || "failed".equals(status) ? 100 : null);
    result.setRaw(root);
    if ("failed".equals(status)) {
      JsonNode error = task.path("error");
      result.setError(firstNonBlank(text(error, "message"), text(error, "code"), "视频生成失败"));
    } else if ("completed".equals(status)) {
      String url = text(task.path("content"), "video_url");
      if (url.isBlank()) throw new ApiException(502, "按秒视频已完成，但未返回成片地址");
      requirePublicUrl(url);
      if (properties.isPersistGeneratedVideos()) {
        try {
          result.setVideoUrls(List.of(media.persistVideo(taskId, id, url, userId)));
        } catch (Exception error) {
          result.setStatus("persisting");
          result.setStage("正在保存成片，稍后自动重试");
          result.setProgress(null);
        }
      } else {
        result.setVideoUrls(List.of(url));
      }
    }
    return result;
  }

  private void validate(VideoGenerationDtos.CreateTaskRequest request) {
    if (request == null || request.prompt() == null || request.prompt().isBlank())
      throw new ApiException(400, "视频提示词不能为空");
    if (request.prompt().length() > 2500) throw new ApiException(400, "视频提示词不能超过 2500 字");
    boolean model25 = isModel25(request.model());
    boolean configured = resolveConfiguredModel(request.model()) != null;
    if (!MODEL.equals(request.model()) && !MODEL25.equals(request.model()) && !configured)
      throw new ApiException(400, "按秒视频模型编号无效或未配置密钥");
    int maxDuration = model25 ? 30 : 15;
    if (request.durationSeconds() == null || request.durationSeconds() < 4 || request.durationSeconds() > maxDuration)
      throw new ApiException(400, "按秒视频时长必须是 4 至 " + maxDuration + " 的整数秒");
    if (!RATIOS.contains(request.ratio())) throw new ApiException(400, "成片比例不受支持");
    if (!(model25 ? RESOLUTIONS25 : RESOLUTIONS).contains(resolution(request)))
      throw new ApiException(400, model25
          ? "SD 2.5 画质仅支持 480p、720p 或 1080p"
          : "按秒视频画质仅支持 480p、720p、1080p 或 4k");
    String first = request.normalizedFirstFrameUrl();
    String last = request.lastFrameUrl() == null ? "" : request.lastFrameUrl().trim();
    List<String> references = referenceImages(request);
    int maxReferences = model25 ? 30 : 9;
    if (references.size() > maxReferences)
      throw new ApiException(400, "按秒视频最多支持 " + maxReferences + " 张参考图");
    if (model25 && references.isEmpty() && !first.isBlank() && !"adaptive".equals(request.ratio()))
      throw new ApiException(400, "SD 2.5 首帧任务的比例只能选择自适应");
    if (!references.isEmpty() && !last.isBlank())
      throw new ApiException(400, "多张参考图不能与尾帧模式混用");
    if (!last.isBlank() && first.isBlank()) throw new ApiException(400, "尾帧必须与首帧一起提供");
    if (references.isEmpty() && request.normalizedImageUrls().stream().anyMatch(url -> !url.equals(first)))
      throw new ApiException(400, "首帧模式不能混用其他参考图");
    if (references.isEmpty() && !first.isBlank()) requirePublicUrl(first);
    for (String url : references) requirePublicUrl(url);
    if (!last.isBlank()) requirePublicUrl(last);
  }

  private List<String> referenceImages(VideoGenerationDtos.CreateTaskRequest request) {
    if (request.firstFrameUrl() != null && !request.firstFrameUrl().isBlank()) return List.of();
    List<String> urls = request.normalizedImageUrls();
    return urls.size() > 1 ? urls : List.of();
  }

  private Map<String, Object> image(String role, String url) {
    return Map.of("type", "image_url", "role", role, "image_url", Map.of("url", url));
  }

  private String resolution(VideoGenerationDtos.CreateTaskRequest request) {
    String value = request.resolution();
    return value == null || value.isBlank() ? "720p" : value.trim().toLowerCase(Locale.ROOT);
  }

  private void requirePublicUrl(String value) {
    try {
      URI uri = URI.create(value);
      if (Set.of("https", "http").contains(uri.getScheme()) && uri.getHost() != null) return;
    } catch (Exception ignored) { }
    throw new ApiException(400, "参考图片必须是公网 HTTP(S) 地址");
  }

  private JsonNode send(String apiKey, String method, String path, Object body) throws Exception {
    if (apiKey == null || apiKey.isBlank()) throw new ApiException(503, "该按秒视频通道尚未配置密钥");
    return sendUrl(apiKey, method, properties.normalizedBaseUrl() + "/" + path, body);
  }

  private JsonNode sendUrl(String apiKey, String method, String endpoint, Object body) throws Exception {
    if (apiKey == null || apiKey.isBlank()) throw new ApiException(503, "该按秒视频通道尚未配置密钥");
    URI url = URI.create(endpoint);
    HttpRequest.Builder request = HttpRequest.newBuilder(url)
        .timeout(Duration.ofSeconds(Math.max(5, properties.getTimeoutSeconds())))
        .header("Authorization", "Bearer " + apiKey.trim())
        .header("Accept", "application/json");
    if ("POST".equals(method)) request.header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)));
    else request.GET();
    HttpResponse<String> response = http.send(request.build(), HttpResponse.BodyHandlers.ofString());
    JsonNode root;
    try {
      root = mapper.readTree(response.body());
    } catch (Exception error) {
      throw new ApiException(502, "按秒视频接口返回了无法解析的响应（HTTP " + response.statusCode() + "）", error);
    }
    if (root == null) throw new ApiException(502, "按秒视频接口返回为空（HTTP " + response.statusCode() + "）");
    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      String reason = firstNonBlank(text(root.path("error"), "message"), text(root.path("error"), "code"), "上游服务拒绝请求");
      reason = reason.replace(apiKey.trim(), "[redacted]").replaceAll("sk-[A-Za-z0-9_-]+", "[redacted]");
      int status = response.statusCode() >= 400 && response.statusCode() < 500 ? response.statusCode() : 502;
      throw new ApiException(status, "按秒视频接口请求失败（HTTP " + response.statusCode() + "）：" + reason);
    }
    return root;
  }

  private ResolvedModelApiKey resolveConfiguredModel(String model) {
    if (modelApiKeys == null || model == null) return null;
    return modelApiKeys.resolve(model, ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION,
        "canvas-video").orElse(null);
  }

  private void recordCall(String source, String model, ResolvedModelApiKey credential,
      boolean success, long started, Exception error) {
    if (aiCallLogService == null) return;
    aiCallLogService.record(source, "video_generate",
        credential == null ? PROVIDER : credential.provider(), model,
        credential == null ? null : credential.id(), "dropdown", success, null,
        (System.nanoTime() - started) / 1_000_000L,
        error == null ? null : error.getClass().getSimpleName());
  }

  private boolean isModel25(String model) {
    return MODEL25.equals(model) || (model != null && model.toLowerCase(Locale.ROOT).contains("seedance-2.5"));
  }

  private String providerModel(String model) {
    if (model != null && model.equalsIgnoreCase("seedance-2.0-guanfang-anmiao")) return MODEL;
    if (model != null && model.equalsIgnoreCase("seedance-2.5-guanfang-anmiao")) return MODEL25;
    return model;
  }

  private String providerTaskId(JsonNode root) {
    String taskId = findNamedTaskId(root);
    if (!taskId.isBlank()) return taskId;
    JsonNode task = taskPayload(root);
    return firstNonBlank(text(task, "id"), text(root, "id"));
  }

  private String findNamedTaskId(JsonNode node) {
    if (node == null || !node.isContainerNode()) return "";
    if (node.isObject()) {
      String direct = firstNonBlank(text(node, "task_id"), text(node, "taskId"));
      if (!direct.isBlank()) return direct;
      JsonNode task = node.path("task");
      if (task.isObject()) {
        String nested = firstNonBlank(text(task, "id"), text(task, "task_id"), text(task, "taskId"));
        if (!nested.isBlank()) return nested;
      }
      var fields = node.fields();
      while (fields.hasNext()) {
        String nested = findNamedTaskId(fields.next().getValue());
        if (!nested.isBlank()) return nested;
      }
    } else {
      for (JsonNode child : node) {
        String nested = findNamedTaskId(child);
        if (!nested.isBlank()) return nested;
      }
    }
    return "";
  }

  private JsonNode taskPayload(JsonNode root) {
    JsonNode data = root.path("data");
    return data.isObject() ? data : root;
  }

  private String text(JsonNode root, String key) {
    JsonNode value = root.path(key);
    return value.isTextual() || value.isNumber() ? value.asText() : "";
  }

  private String firstNonBlank(String... values) {
    for (String value : values) if (value != null && !value.isBlank()) return value;
    return "";
  }
}
