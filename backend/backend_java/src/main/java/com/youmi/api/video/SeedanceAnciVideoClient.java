package com.youmi.api.video;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.ai.AiCallLogService;
import com.youmi.api.common.ApiException;
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
import java.util.Optional;
import java.util.Set;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/** The per-call media protocol is deliberately separate from native per-second Seedance. */
@Service
public class SeedanceAnciVideoClient {
  public static final String MODEL = "seedance-2.0-anci";
  public static final String PROFILE = "canvas-v3-seedance20-anci";
  public static final String PREFIX = "seedance-2.0-anci:key:";
  private static final Set<String> RATIOS = Set.of("16:9", "9:16", "1:1", "4:3", "3:4");
  private static final Set<String> VERSIONS = Set.of("快速", "标准");
  private final ModelApiKeyService keys;
  private final VideoGenerationClient media;
  private final ObjectMapper mapper;
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15))
      .followRedirects(HttpClient.Redirect.NEVER).build();
  private AiCallLogService callLog;

  public SeedanceAnciVideoClient(ModelApiKeyService keys, VideoGenerationClient media, ObjectMapper mapper) {
    this.keys = keys;
    this.media = media;
    this.mapper = mapper;
  }

  @Autowired(required = false)
  void setAiCallLogService(AiCallLogService callLog) { this.callLog = callLog; }

  public boolean supports(String model, String featureCode) {
    return "canvas-video".equals(feature(featureCode)) && credential(model).filter(this::nativeModel).isPresent();
  }

  /** Called before billing. Model-managed per-call tasks settle the provider's real final cost. */
  public void validate(VideoGenerationDtos.CreateTaskRequest request) { prepare(request); }

  private record Prepared(ResolvedModelApiKey credential, Map<String, Object> body) {}

  private Prepared prepare(VideoGenerationDtos.CreateTaskRequest request) {
    if (request == null || !PROFILE.equals(request.parameterProfile())
        || !"canvas-video".equals(feature(request.featureCode())))
      throw new ApiException(400, "Seedance 2.0 按次仅支持画布视频参数配置");
    var credential = credential(request.model()).filter(this::nativeModel)
        .orElseThrow(() -> new ApiException(503, "Seedance 2.0 按次尚未配置模型密钥或绑定画布视频功能"));
    validateEndpoints(credential);
    if (request.prompt() == null || request.prompt().isBlank())
      throw new ApiException(400, "Seedance 2.0 按次提示词不能为空");
    if (request.durationSeconds() == null || request.durationSeconds() < 4 || request.durationSeconds() > 15)
      throw new ApiException(400, "Seedance 2.0 按次时长必须为 4 至 15 的整数秒");
    if (request.version() == null || !VERSIONS.contains(request.version()))
      throw new ApiException(400, "Seedance 2.0 按次速度版本仅支持快速或标准");
    if (request.resolution() == null || !"720p".equalsIgnoreCase(request.resolution().trim()))
      throw new ApiException(400, "Seedance 2.0 按次仅支持 720p 分辨率");
    String ratio = request.ratio() == null || request.ratio().isBlank() ? "16:9" : request.ratio().trim();
    if (!RATIOS.contains(ratio)) throw new ApiException(400, "Seedance 2.0 按次仅支持 16:9、9:16、1:1、4:3 或 3:4");
    if (request.mode() != null && !request.mode().isBlank() && !"cankaosheng".equals(request.mode()))
      throw new ApiException(400, "Seedance 2.0 按次仅支持参考生模式，不支持首尾帧");
    if (hasText(request.firstFrameUrl()) || hasText(request.lastFrameUrl())
        || !request.referenceVideos().isEmpty() || !request.referenceAudios().isEmpty())
      throw new ApiException(400, "Seedance 2.0 按次仅支持 0 至 9 张参考图片，不支持首尾帧、参考视频或音频");
    if (request.webSearch() != null || request.generateAudio() != null || request.seed() != null
        || hasText(request.negativePrompt()))
      throw new ApiException(400, "Seedance 2.0 按次不支持联网搜索、音频开关、随机种子或负面提示词参数");
    List<String> images = new ArrayList<>();
    if (request.imageUrls() != null) images.addAll(request.imageUrls());
    images.addAll(request.referenceImageUrls());
    if (images.size() > 9) throw new ApiException(400, "Seedance 2.0 按次最多支持 9 张参考图片");
    List<String> validated = new ArrayList<>();
    for (String image : images) {
      if (image == null || image.isBlank()) throw new ApiException(400, "Seedance 2.0 按次参考图片地址不能为空");
      String url = image.trim();
      requirePublicUrl(url, "参考图片");
      validated.add(url);
    }
    Map<String, Object> params = new LinkedHashMap<>();
    params.put("mode", "cankaosheng");
    params.put("version", request.version());
    params.put("duration", String.valueOf(request.durationSeconds()));
    params.put("aspect_ratio", ratio);
    params.put("resolution", "720p");
    if (!validated.isEmpty()) params.put("images", validated);
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("model", MODEL);
    body.put("prompt", request.prompt().trim());
    body.put("params", params);
    if (hasText(request.webhookUrl())) {
      String callback = request.webhookUrl().trim();
      requirePublicUrl(callback, "回调");
      body.put("notify_url", callback);
    }
    return new Prepared(credential, body);
  }

  public VideoGenerationDtos.CreateTaskResponse createTask(VideoGenerationDtos.CreateTaskRequest request)
      throws Exception {
    Prepared prepared = prepare(request);
    var credential = prepared.credential();
    JsonNode root = send(credential, "POST", credential.generationEndpoint(), prepared.body());
    String id = text(root.path("data"), "task_id");
    if (!id.matches("[0-9]+")) throw new ApiException(502, "Seedance 2.0 按次未返回有效任务编号，请核对原任务后再重试");
    var result = new VideoGenerationDtos.CreateTaskResponse();
    result.setProvider(credential.provider());
    result.setModel(request.model());
    result.setTaskId(PREFIX + credential.id() + ":" + id);
    result.setStatus("queued");
    result.setRaw(root);
    return result;
  }

  public VideoGenerationDtos.TaskStatusResponse getTask(String taskId, Long userId) throws Exception {
    if (taskId == null || !taskId.matches("seedance-2\\.0-anci:key:[1-9][0-9]*:[0-9]+"))
      throw new ApiException(400, "Seedance 2.0 按次任务编号无效");
    int split = taskId.indexOf(':', PREFIX.length());
    ResolvedModelApiKey credential;
    try {
      credential = keys.resolveById(Long.parseLong(taskId.substring(PREFIX.length(), split)),
          ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION);
    } catch (NumberFormatException error) { throw new ApiException(400, "Seedance 2.0 按次任务编号无效"); }
    if (credential == null || !nativeModel(credential))
      throw new ApiException(503, "Seedance 2.0 按次原任务线路不可用，请检查原模型配置");
    validateEndpoints(credential);
    String id = taskId.substring(split + 1);
    JsonNode root = send(credential, "GET", taskEndpoint(credential, id), null);
    if (root.hasNonNull("task_id") && !id.equals(text(root, "task_id")))
      throw new ApiException(502, "Seedance 2.0 按次返回了其他任务的状态，请继续查询原任务");
    String state = text(root, "state");
    if (!Set.of("pending", "running", "success", "failed").contains(state))
      throw new ApiException(502, "Seedance 2.0 按次返回未知任务状态，请继续查询原任务");
    if (!root.path("is_final").isBoolean())
      throw new ApiException(502, "Seedance 2.0 按次未返回有效终态标记，请继续查询原任务");
    boolean terminal = root.path("is_final").booleanValue();
    if (terminal && !Set.of("success", "failed").contains(state))
      throw new ApiException(502, "Seedance 2.0 按次返回的终态不完整，请继续查询原任务");
    String status = terminal ? (state.equals("success") ? "completed" : "failed")
        : state.equals("pending") ? "queued" : "processing";
    var result = new VideoGenerationDtos.TaskStatusResponse();
    result.setTaskId(taskId);
    result.setProvider(credential.provider());
    result.setStatus(status);
    result.setStage(first(text(root, "status"), terminal ? "成片生成完成" : "中转站生成中"));
    result.setProgress(progress(root.path("progress")));
    result.setRaw(root);
    if (status.equals("failed")) {
      result.setError(first(text(root, "error"), text(root.path("error"), "message"), "Seedance 2.0 按次视频生成失败"));
    } else if (status.equals("completed")) {
      String url = text(root, "result_url");
      if (url.isBlank()) throw new ApiException(502, "Seedance 2.0 按次已完成，但成片地址尚未返回，请继续查询");
      try { requirePublicUrl(url, "成片"); }
      catch (ApiException error) {
        throw new ApiException(502, "Seedance 2.0 按次返回的成片地址无效，请继续查询原任务");
      }
      String type = text(root, "result_type");
      if (!type.isBlank() && !type.equals("video"))
        throw new ApiException(502, "Seedance 2.0 按次返回的结果不是视频，请继续查询原任务");
      try {
        result.setVideoUrls(List.of(media.persistVideoAsync(taskId, id, url, userId)));
      } catch (Exception error) {
        result.setStatus("persisting");
        result.setStage("正在保存成片，稍后自动重试");
        result.setProgress(null);
      }
    }
    return result;
  }

  private Optional<ResolvedModelApiKey> credential(String model) {
    if (model == null || model.isBlank()) return Optional.empty();
    var route = keys.resolveFeatureRouteOption(model, ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video");
    if (route.isPresent() || model.startsWith(ModelApiKeyService.FEATURE_ROUTE_OPTION_PREFIX)) return route;
    if (!MODEL.equalsIgnoreCase(model.trim())) return Optional.empty();
    return keys.resolve(model.trim(), ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video");
  }

  private boolean nativeModel(ResolvedModelApiKey credential) {
    return credential != null && MODEL.equalsIgnoreCase(credential.model());
  }

  private void validateEndpoints(ResolvedModelApiKey credential) {
    try {
      URI generation = httpEndpoint(credential.generationEndpoint());
      URI status = httpEndpoint(credential.taskEndpoint().replace("{task_id}", "1").replace("{id}", "1"));
      boolean query = status.getRawQuery() == null || status.getRawQuery().matches("task_id=[0-9]*");
      if (generation.getPath().endsWith("/v1/media/generate") && generation.getRawQuery() == null
          && status.getPath().endsWith("/v1/media/status") && query
          && generation.getScheme().equals(status.getScheme()) && generation.getHost().equals(status.getHost())
          && generation.getPort() == status.getPort() && hasText(credential.apiKey())) return;
    } catch (Exception ignored) { }
    throw new ApiException(503, "Seedance 2.0 按次线路必须配置开放 API /v1/media/generate 和 /v1/media/status");
  }

  private URI httpEndpoint(String value) {
    URI uri = URI.create(value);
    if (!Set.of("https", "http").contains(uri.getScheme()) || uri.getHost() == null
        || uri.getRawUserInfo() != null || uri.getRawFragment() != null)
      throw new IllegalArgumentException("Invalid media endpoint");
    return uri;
  }

  private String taskEndpoint(ResolvedModelApiKey credential, String id) {
    String endpoint = credential.taskEndpoint();
    if (endpoint.contains("{task_id}")) return endpoint.replace("{task_id}", id);
    if (endpoint.contains("{id}")) return endpoint.replace("{id}", id);
    int question = endpoint.indexOf('?');
    return (question < 0 ? endpoint : endpoint.substring(0, question)) + "?task_id=" + id;
  }

  private void requirePublicUrl(String value, String label) {
    try {
      URI uri = httpEndpoint(value);
      String host = uri.getHost().toLowerCase(Locale.ROOT).replaceAll("^\\[|\\]$", "");
      if (host.endsWith(".")) host = host.substring(0, host.length() - 1);
      if (host.equals("localhost") || host.endsWith(".localhost") || host.endsWith(".local")
          || host.endsWith(".internal") || host.endsWith(".lan")
          || !host.contains(".") && !host.contains(":")
          || host.equals("::") || host.equals("::1") || host.startsWith("fc") && host.contains(":")
          || host.startsWith("fd") && host.contains(":") || host.startsWith("fe80:")
          || host.startsWith("::ffff:")) throw new IllegalArgumentException("Private address");
      if (host.matches("[0-9.]+")) {
        String[] pieces = host.split("\\.");
        if (pieces.length != 4) throw new IllegalArgumentException("Ambiguous address");
        int a = Integer.parseInt(pieces[0]);
        int b = Integer.parseInt(pieces[1]);
        for (String piece : pieces) if (Integer.parseInt(piece) > 255 || piece.length() > 1 && piece.startsWith("0"))
          throw new IllegalArgumentException("Invalid or ambiguous address");
        if (a == 0 || a == 10 || a == 127 || a >= 224 || a == 169 && b == 254
            || a == 172 && b >= 16 && b <= 31 || a == 192 && b == 168 || a == 100 && b >= 64 && b <= 127)
          throw new IllegalArgumentException("Private address");
      }
      if (host.contains(":")) {
        // Numeric IPv6 parsing only: this never resolves a user-supplied DNS name.
        var address = java.net.InetAddress.getByName(host);
        if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
            || address.isSiteLocalAddress() || address.isMulticastAddress())
          throw new IllegalArgumentException("Private IPv6 address");
      }
      if (value.length() <= 16384) return;
    } catch (Exception ignored) { }
    throw new ApiException(400, "Seedance 2.0 按次" + label + "必须使用公网 HTTP(S) 地址");
  }

  private JsonNode send(ResolvedModelApiKey credential, String method, String endpoint, Object body) throws Exception {
    long started = System.nanoTime();
    try {
      var request = HttpRequest.newBuilder(URI.create(endpoint)).timeout(Duration.ofSeconds(120))
          .header("Authorization", "Bearer " + credential.apiKey().trim()).header("Accept", "application/json");
      if (body != null) request.header("Content-Type", "application/json")
          .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)));
      else request.GET();
      HttpResponse<String> response = http.send(request.build(), HttpResponse.BodyHandlers.ofString());
      JsonNode root;
      try { root = mapper.readTree(response.body()); }
      catch (Exception error) { throw new ApiException(502, "Seedance 2.0 按次返回无法解析的响应，请核对原任务"); }
      if (root == null || !root.isObject()) throw new ApiException(502, "Seedance 2.0 按次返回空响应");
      if (response.statusCode() < 200 || response.statusCode() >= 300
          || root.has("code") && root.path("code").asInt(-1) != 200) {
        int code = response.statusCode() >= 400 && response.statusCode() < 500 ? response.statusCode() : 502;
        String reason = first(text(root, "msg"), text(root, "error"), text(root.path("error"), "message"), "上游服务拒绝请求")
            .replace(credential.apiKey().trim(), "[redacted]").replaceAll("sk-[A-Za-z0-9_-]+", "[redacted]");
        throw new ApiException(code, "Seedance 2.0 按次接口请求失败（HTTP " + response.statusCode() + "）：" + reason);
      }
      log(credential, method, true, started, null);
      return root;
    } catch (Exception error) {
      log(credential, method, false, started, error);
      throw error;
    }
  }

  private void log(ResolvedModelApiKey credential, String method, boolean success, long started, Exception error) {
    if (callLog != null) callLog.record("canvas-video", "POST".equals(method) ? "video_generate" : "video_query",
        credential.provider(), MODEL, credential.id(), "dropdown", success,
        error instanceof ApiException api ? api.getCode() : null,
        (System.nanoTime() - started) / 1_000_000L, error == null ? null : error.getClass().getSimpleName());
  }

  private Integer progress(JsonNode value) {
    try {
      double number = Double.parseDouble(value.asText().replace("%", "").trim());
      return Double.isFinite(number) && number >= 0 && number <= 100 ? (int) Math.round(number) : null;
    } catch (Exception ignored) { return null; }
  }
  private String feature(String value) { return value == null || value.isBlank() ? "canvas-video" : value; }
  private boolean hasText(String value) { return value != null && !value.isBlank(); }
  private String text(JsonNode node, String key) {
    JsonNode value = node.path(key);
    return value.isTextual() || value.isNumber() ? value.asText() : "";
  }
  private String first(String... values) {
    for (String value : values) if (hasText(value)) return value;
    return "";
  }
}
