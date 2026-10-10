package com.youmi.api.video;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import com.youmi.api.ai.AiCallLogService;
import com.youmi.api.image.ModelApiKeyService;
import com.youmi.api.image.ModelApiKeyService.ResolvedModelApiKey;
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

@Service
public class MinimaxVideoClient {
  public static final String MODEL = "minimax-h3";
  public static final String PREFIX = "minimax-h3:";
  public static final String CONFIGURED_MODEL = "hailuo-h3-shouweizhen";
  public static final String CONFIGURED_PREFIX = "hailuo-h3:";
  public static final Set<String> RESOLUTIONS = Set.of("768p", "1080p", "2k", "4k");
  private static final Set<String> RATIOS = Set.of("adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9");
  private final MinimaxVideoProperties properties;
  private final VideoGenerationClient media;
  private final ObjectMapper mapper;
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build();
  private AiCallLogService aiCallLogService;
  private ModelApiKeyService modelApiKeys;

  public MinimaxVideoClient(MinimaxVideoProperties properties, VideoGenerationClient media, ObjectMapper mapper) {
    this.properties = properties;
    this.media = media;
    this.mapper = mapper;
  }

  @Autowired(required = false)
  void setAiCallLogService(AiCallLogService service) { this.aiCallLogService = service; }

  @Autowired(required = false)
  void setModelApiKeyService(ModelApiKeyService service) { this.modelApiKeys = service; }

  public boolean hasConfiguredHailuoModel() {
    return resolveHailuoCredential().filter(key ->
        ModelApiKeyService.usesProviderReportedCost(key.provider())
            || RESOLUTIONS.stream().anyMatch(value -> properties.rate(value) > 0)).isPresent();
  }

  public int price(VideoGenerationDtos.CreateTaskRequest request) {
    validate(request);
    int rate = properties.rate(resolution(request));
    boolean configuredModel = isConfiguredModel(request.model());
    java.util.Optional<ResolvedModelApiKey> credential = configuredModel
        ? resolveHailuoCredential() : java.util.Optional.empty();
    if (configuredModel && credential.isEmpty())
      throw new ApiException(503, "Mini H3 首尾帧模型管理密钥未配置或未绑定画布视频功能");
    if (configuredModel && ModelApiKeyService.usesProviderReportedCost(credential.get().provider()))
      return 0;
    if ((!configuredModel && !properties.hasKey()) || rate == 0)
      throw new ApiException(503, "Mini H3 首尾帧所选画质尚未配置模型密钥和每秒米值单价");
    return Math.multiplyExact(rate, request.durationSeconds());
  }

  public static boolean supportsModel(String model) {
    return MODEL.equals(model) || CONFIGURED_MODEL.equals(model);
  }

  public boolean supportsConfiguredHailuoModel(String model) {
    return CONFIGURED_MODEL.equals(model) && resolveHailuoCredential().isPresent();
  }

  public VideoGenerationDtos.CreateTaskResponse createTask(VideoGenerationDtos.CreateTaskRequest request) throws Exception {
    price(request);
    if (isConfiguredModel(request.model())) return createConfiguredHailuoTask(request);
    Map<String, Object> params = new LinkedHashMap<>();
    params.put("duration", String.valueOf(request.durationSeconds()));
    params.put("resolution", resolution(request).toUpperCase(Locale.ROOT));
    List<String> frames = frames(request);
    params.put("aspect_ratio", ratio(request));
    params.put("mode", frames.isEmpty() ? "cankaosheng" : "shouweizhen");
    if (!frames.isEmpty()) params.put("images", frames);
    else if (!request.normalizedImageUrls().isEmpty()) params.put("image_url", request.normalizedImageUrls());
    JsonNode root = send("POST", "/v1/media/generate",
        Map.of("model", request.model(), "prompt", request.prompt().trim(), "params", params));
    String id = text(root.path("data"), "task_id");
    if (!id.matches("[0-9]+")) throw new ApiException(502, "MiniMax H3 未返回有效任务编号，请核对中转站记录后再重试");
    var result = new VideoGenerationDtos.CreateTaskResponse();
    result.setProvider("lk888-minimax");
    result.setModel(request.model());
    result.setTaskId(PREFIX + id);
    result.setStatus("queued");
    result.setRaw(root);
    return result;
  }

  public VideoGenerationDtos.TaskStatusResponse getTask(String taskId, Long userId) throws Exception {
    if (taskId != null && taskId.startsWith(CONFIGURED_PREFIX))
      return getConfiguredHailuoTask(taskId, userId);
    if (taskId == null || !taskId.matches("minimax-h3:[0-9]+"))
      throw new ApiException(400, "MiniMax H3 任务编号无效");
    String id = taskId.substring(PREFIX.length());
    JsonNode root = send("GET", "/v1/media/status?task_id=" + id, null);
    String state = text(root, "state");
    if (!Set.of("pending", "running", "success", "failed").contains(state))
      throw new ApiException(502, "MiniMax H3 返回未知任务状态，请稍后继续查询");
    boolean terminal = root.path("is_final").isBoolean() && root.path("is_final").booleanValue();
    if (terminal && !Set.of("success", "failed").contains(state))
      throw new ApiException(502, "MiniMax H3 返回的终态不完整，请稍后继续查询");
    String status = terminal ? (state.equals("success") ? "completed" : "failed")
        : state.equals("pending") ? "queued" : "processing";
    var result = new VideoGenerationDtos.TaskStatusResponse();
    result.setProvider("lk888-minimax");
    result.setTaskId(taskId);
    result.setStatus(status);
    result.setStage(first(text(root, "status"), status.equals("queued") ? "中转站排队中" : "中转站生成中"));
    result.setProgress(progress(root.path("progress")));
    result.setRaw(root);
    if (status.equals("failed")) {
      result.setError(first(text(root, "error"), text(root.path("error"), "message"), "MiniMax H3 视频生成失败"));
    } else if (status.equals("completed")) {
      String url = text(root, "result_url");
      if (url.isBlank()) throw new ApiException(502, "MiniMax H3 已完成，成片地址尚未返回，请稍后继续查询");
      requireUrl(url);
      if (properties.isPersistGeneratedVideos()) {
        try {
          result.setVideoUrls(List.of(media.persistVideo(taskId, id, url, userId)));
        } catch (Exception error) {
          result.setStatus("persisting");
          result.setStage("正在保存成片，稍后自动重试");
          result.setProgress(null);
        }
      } else result.setVideoUrls(List.of(url));
    }
    return result;
  }

  private VideoGenerationDtos.CreateTaskResponse createConfiguredHailuoTask(
      VideoGenerationDtos.CreateTaskRequest request) throws Exception {
    ResolvedModelApiKey credential = resolveHailuoCredential()
        .orElseThrow(() -> new ApiException(503, "Mini H3 首尾帧模型管理密钥未配置或未绑定画布视频功能"));
    List<String> frames = hailuoFrames(request);
    if (frames.isEmpty() || frames.size() > 2)
      throw new ApiException(400, "Mini H3 首尾帧必须上传 1 至 2 张图片");
    Map<String, Object> params = new LinkedHashMap<>();
    params.put("duration", String.valueOf(request.durationSeconds()));
    params.put("resolution", resolution(request).toUpperCase(Locale.ROOT));
    params.put("images", frames);
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("model", CONFIGURED_MODEL);
    body.put("params", params);
    body.put("prompt", request.prompt().trim());
    long started = System.nanoTime();
    JsonNode root;
    try {
      root = sendUrl(credential.apiKey(), "POST", credential.generationEndpoint(), body);
      String id = text(root.path("data"), "task_id");
      if (!id.matches("[A-Za-z0-9_-]+"))
        throw new ApiException(502, "Mini H3 首尾帧未返回有效任务编号");
      recordConfiguredCall(credential, true, started, null);
      var result = new VideoGenerationDtos.CreateTaskResponse();
      result.setProvider(credential.provider());
      result.setModel(CONFIGURED_MODEL);
      result.setTaskId(CONFIGURED_PREFIX + "key:" + credential.id() + ":" + id);
      result.setStatus("queued");
      result.setRaw(root);
      return result;
    } catch (Exception error) {
      recordConfiguredCall(credential, false, started, error);
      throw error;
    }
  }

  private VideoGenerationDtos.TaskStatusResponse getConfiguredHailuoTask(String taskId, Long userId)
      throws Exception {
    if (!taskId.matches("hailuo-h3:key:[0-9]+:[A-Za-z0-9_-]+"))
      throw new ApiException(400, "Mini H3 首尾帧任务编号无效");
    int keyEnd = taskId.indexOf(':', CONFIGURED_PREFIX.length() + 4);
    long keyId = Long.parseLong(taskId.substring(CONFIGURED_PREFIX.length() + 4, keyEnd));
    String id = taskId.substring(keyEnd + 1);
    ResolvedModelApiKey credential = modelApiKeys.resolveById(keyId,
        com.youmi.api.image.ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION);
    JsonNode root = sendUrl(credential.apiKey(), "GET", configuredTaskEndpoint(credential, id), null);
    String state = text(root, "state").toLowerCase(Locale.ROOT);
    if (!Set.of("pending", "running", "success", "failed").contains(state))
      throw new ApiException(502, "Mini H3 首尾帧返回未知任务状态");
    boolean terminal = root.path("is_final").isBoolean() && root.path("is_final").booleanValue();
    if (terminal && !Set.of("success", "failed").contains(state))
      throw new ApiException(502, "Mini H3 首尾帧返回的终态不完整");
    String status = terminal ? (state.equals("success") ? "completed" : "failed")
        : state.equals("pending") ? "queued" : "processing";
    var result = new VideoGenerationDtos.TaskStatusResponse();
    result.setProvider(credential.provider());
    result.setTaskId(taskId);
    result.setStatus(status);
    result.setStage(first(text(root, "status"), status.equals("queued") ? "中转站排队中" : "中转站生成中"));
    result.setProgress(progress(root.path("progress")));
    result.setRaw(root);
    if (status.equals("failed")) {
      result.setError(first(text(root, "error"), text(root.path("error"), "message"), "Mini H3 首尾帧生成失败"));
    } else if (status.equals("completed")) {
      String url = text(root, "result_url");
      if (url.isBlank()) throw new ApiException(502, "Mini H3 首尾帧已完成，但未返回成片地址");
      requireUrl(url);
      if (properties.isPersistGeneratedVideos()) {
        try {
          result.setVideoUrls(List.of(media.persistVideo(taskId, id, url, userId)));
        } catch (Exception error) {
          result.setStatus("persisting");
          result.setStage("正在保存成片，稍后自动重试");
          result.setProgress(null);
        }
      } else result.setVideoUrls(List.of(url));
    }
    return result;
  }

  private List<String> hailuoFrames(VideoGenerationDtos.CreateTaskRequest request) {
    List<String> frames = new ArrayList<>(request.normalizedImageUrls());
    String first = request.normalizedFirstFrameUrl();
    if (frames.isEmpty() && !first.isBlank()) frames.add(first);
    String last = request.lastFrameUrl() == null ? "" : request.lastFrameUrl().trim();
    if (!last.isBlank() && !frames.contains(last)) frames.add(last);
    return frames.stream().distinct().toList();
  }

  private String configuredTaskEndpoint(ResolvedModelApiKey credential, String id) {
    String endpoint = credential.taskEndpoint();
    if (endpoint.contains("{task_id}")) return endpoint.replace("{task_id}", id);
    if (endpoint.contains("{id}")) return endpoint.replace("{id}", id);
    if (endpoint.matches(".*[?&]task_id=$")) return endpoint + id;
    if (endpoint.matches(".*[?&]task_id=[^&]+$"))
      return endpoint.replaceAll("([?&]task_id=)[^&]+$", "$1" + java.util.regex.Matcher.quoteReplacement(id));
    if (endpoint.contains("?")) return endpoint + "&task_id=" + id;
    if (endpoint.endsWith("/status")) return endpoint + "?task_id=" + id;
    return endpoint + "/" + id;
  }

  private java.util.Optional<ResolvedModelApiKey> resolveHailuoCredential() {
    if (modelApiKeys == null) return java.util.Optional.empty();
    return modelApiKeys.resolve(CONFIGURED_MODEL,
        com.youmi.api.image.ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video");
  }

  private boolean isConfiguredModel(String model) { return CONFIGURED_MODEL.equals(model); }

  private void recordConfiguredCall(ResolvedModelApiKey credential, boolean success, long started, Exception error) {
    if (aiCallLogService != null) aiCallLogService.record("canvas-video", "video_generate",
        credential.provider(), CONFIGURED_MODEL, credential.id(), "dropdown", success, null,
        (System.nanoTime() - started) / 1_000_000L,
        error == null ? null : error.getClass().getSimpleName());
  }

  private void validate(VideoGenerationDtos.CreateTaskRequest request) {
    if (request == null || !supportsModel(request.model())) throw new ApiException(400, "Mini H3 视频模型编号无效");
    boolean configuredHailuo = isConfiguredModel(request.model());
    if (request.prompt() == null || request.prompt().isBlank()) throw new ApiException(400, "视频提示词不能为空");
    if (request.durationSeconds() == null || request.durationSeconds() < 4 || request.durationSeconds() > 15)
      throw new ApiException(400, "Mini H3 时长必须为 4 至 15 的整数秒");
    if (!RESOLUTIONS.contains(resolution(request)))
      throw new ApiException(400, "Mini H3 画质仅支持 768P、1080P、2K 或 4K");
    if (configuredHailuo) {
      if (hailuoFrames(request).isEmpty() || hailuoFrames(request).size() > 2)
        throw new ApiException(400, "Mini H3 首尾帧必须上传 1 至 2 张图片");
      for (String url : hailuoFrames(request)) requireUrl(url);
      return;
    }
    List<String> frames = frames(request);
    List<String> references = request.normalizedImageUrls();
    if (!RATIOS.contains(ratio(request))) throw new ApiException(400, "MiniMax H3 不支持该成片比例");
    if (!frames.isEmpty() && references.stream().anyMatch(url -> !frames.contains(url)))
      throw new ApiException(400, "MiniMax H3 首尾帧不能与其他参考图混用");
    if (frames.isEmpty() && references.size() > 9) throw new ApiException(400, "MiniMax H3 最多支持 9 张参考图");
    for (String url : frames) requireUrl(url);
    for (String url : references) requireUrl(url);
  }

  private List<String> frames(VideoGenerationDtos.CreateTaskRequest request) {
    String start = request.firstFrameUrl() == null ? "" : request.firstFrameUrl().trim();
    String end = request.lastFrameUrl() == null ? "" : request.lastFrameUrl().trim();
    if (start.isEmpty() && !end.isEmpty()) throw new ApiException(400, "MiniMax H3 尾帧必须与首帧一起提供");
    List<String> result = new ArrayList<>();
    if (!start.isEmpty()) result.add(start);
    if (!end.isEmpty()) result.add(end);
    return result;
  }
  private String resolution(VideoGenerationDtos.CreateTaskRequest request) {
    return request.resolution() == null ? "" : request.resolution().trim().toLowerCase(Locale.ROOT);
  }
  private String ratio(VideoGenerationDtos.CreateTaskRequest request) {
    return request.ratio() == null || request.ratio().isBlank() ? "adaptive" : request.ratio();
  }
  private void requireUrl(String value) {
    try {
      URI uri = URI.create(value);
      if (Set.of("https", "http").contains(uri.getScheme()) && uri.getHost() != null) return;
    } catch (Exception ignored) { }
    throw new ApiException(400, "MiniMax H3 素材必须使用公网 HTTP(S) 地址");
  }
  private Integer progress(JsonNode value) {
    try {
      double amount = Double.parseDouble(value.asText().replace("%", "").trim());
      return Double.isFinite(amount) && amount >= 0 && amount <= 100 ? (int) Math.round(amount) : null;
    } catch (Exception ignored) { return null; }
  }
  private JsonNode send(String method, String path, Object body) throws Exception {
    if (!properties.hasKey()) throw new ApiException(503, "MiniMax H3 接口密钥待配置");
    long started = System.nanoTime();
    try {
      JsonNode root = sendUrl(properties.getApiKey(), method, properties.normalizedBaseUrl() + path, body);
      recordCall(method, true, 200, started, null);
      return root;
    } catch (Exception error) {
      recordCall(method, false, error instanceof ApiException ? ((ApiException) error).getCode() : null,
          started, error);
      throw error;
    }
  }

  private JsonNode sendUrl(String apiKey, String method, String endpoint, Object body) throws Exception {
    if (apiKey == null || apiKey.isBlank()) throw new ApiException(503, "Mini H3 接口密钥未配置");
    var request = HttpRequest.newBuilder(URI.create(endpoint))
        .timeout(Duration.ofSeconds(Math.max(5, properties.getTimeoutSeconds())))
        .header("Authorization", "Bearer " + apiKey.trim()).header("Accept", "application/json");
    if (body != null) request.header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)));
    else request.GET();
    java.net.http.HttpResponse<String> response = http.send(request.build(), HttpResponse.BodyHandlers.ofString());
    JsonNode root;
    try { root = mapper.readTree(response.body()); }
    catch (Exception error) { throw new ApiException(502, "Mini H3 返回无法解析的响应（HTTP " + response.statusCode() + "）", error); }
    if (root == null || !root.isObject()) throw new ApiException(502, "Mini H3 返回空响应");
    if (response.statusCode() < 200 || response.statusCode() >= 300
        || (root.has("code") && root.path("code").asInt(-1) != 200)) {
      int status = response.statusCode() >= 400 && response.statusCode() < 500 ? response.statusCode() : 502;
      throw new ApiException(status, "Mini H3 接口请求失败（HTTP " + response.statusCode() + "）："
          + first(text(root, "msg"), text(root, "error"), text(root.path("error"), "message"), "上游服务拒绝请求"));
    }
    return root;
  }

  private void recordCall(String operation, boolean success, Integer status, long started, Exception error) {
    if (aiCallLogService != null) aiCallLogService.record("minimax-video", operation,
        "lk888-minimax", MODEL, null, success, status,
        (System.nanoTime() - started) / 1_000_000L,
        error == null ? null : error.getClass().getSimpleName());
  }
  private String text(JsonNode node, String key) {
    JsonNode value = node.path(key);
    return value.isTextual() || value.isNumber() ? value.asText() : "";
  }
  private String first(String... values) {
    for (String value : values) if (value != null && !value.isBlank()) return value;
    return "";
  }
}
