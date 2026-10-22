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

/** The three Omni models use the documented open-media protocol, not native Kling APIs. */
@Service
public class KlingOmniVideoClient {
  public static final String CANKAO = "kling-v3-omni-cankao";
  public static final String VIDEOREF = "kling-v3-omni-videoref";
  public static final String FRAMES = "kling-v3-omni-shouweizhen";
  public static final String PROFILE = "canvas-v3-kling-omni";
  public static final String PREFIX = "kling-omni:key:";
  private static final Set<String> MODELS = Set.of(CANKAO, VIDEOREF, FRAMES);
  private static final Set<String> RATIOS = Set.of("16:9", "9:16", "1:1");
  private static final Set<String> DURATIONS = Set.of("5", "10", "15");
  private static final Set<String> VIDEO_DURATIONS = Set.of("5", "10");
  private final ModelApiKeyService keys;
  private final VideoGenerationClient media;
  private final ObjectMapper mapper;
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15))
      .followRedirects(HttpClient.Redirect.NEVER).build();
  private AiCallLogService callLog;

  public KlingOmniVideoClient(ModelApiKeyService keys, VideoGenerationClient media, ObjectMapper mapper) {
    this.keys = keys;
    this.media = media;
    this.mapper = mapper;
  }

  @Autowired(required = false)
  void setAiCallLogService(AiCallLogService callLog) { this.callLog = callLog; }

  public static boolean isModel(String model) {
    return model != null && MODELS.contains(model.trim().toLowerCase(Locale.ROOT));
  }

  public boolean supports(String model, String featureCode) {
    return "canvas-video".equals(feature(featureCode)) && credential(model).filter(this::nativeModel).isPresent();
  }

  /** Validate before the zero hold: no upstream POST or paid generation occurs here. */
  public void validate(VideoGenerationDtos.CreateTaskRequest request) { prepare(request); }

  private record Prepared(ResolvedModelApiKey credential, Map<String, Object> body) {}

  private Prepared prepare(VideoGenerationDtos.CreateTaskRequest request) {
    if (request == null || !PROFILE.equals(request.parameterProfile())
        || !"canvas-video".equals(feature(request.featureCode())))
      throw new ApiException(400, "可灵-Omni 仅支持对应的画布视频参数配置");
    var credential = credential(request.model()).filter(this::nativeModel)
        .orElseThrow(() -> new ApiException(503, "当前可灵-Omni 模式尚未配置模型密钥或绑定画布视频功能"));
    validateEndpoints(credential);
    // These generic/native adapter fields must never leak into the open-media payload.
    if (hasText(request.ratio()) || request.durationSeconds() != null || hasText(request.resolution())
        || request.imageUrls() != null && !request.imageUrls().isEmpty()
        || hasText(request.firstFrameUrl()) || hasText(request.lastFrameUrl())
        || hasText(request.negativePrompt()) || request.generateAudio() != null || request.seed() != null
        || request.webSearch() != null || hasText(request.mode()) || hasText(request.version()))
      throw new ApiException(400, "可灵-Omni 请使用 omni_params 和参考素材参数，不支持其他模型的参数");
    if (!request.referenceAudios().isEmpty())
      throw new ApiException(400, "可灵-Omni 不支持单独的参考音频，请移除音频连线");

    String model = credential.model().trim().toLowerCase(Locale.ROOT);
    Map<String, Object> source = request.omniParams();
    boolean videoReference = VIDEOREF.equals(model);
    String referType = videoReference ? required(source, "refer_type", Set.of("feature", "base"), "参考类型") : null;
    boolean featureReference = videoReference && "feature".equals(referType);
    Set<String> allowed = videoReference
        ? featureReference ? Set.of("mode", "refer_type", "duration", "aspect_ratio", "keep_original_sound")
            : Set.of("mode", "refer_type")
        : FRAMES.equals(model) ? Set.of("mode", "duration") : Set.of("mode", "duration", "aspect_ratio");
    for (var entry : source.entrySet()) {
      if (!allowed.contains(entry.getKey()) || !(entry.getValue() instanceof String))
        throw new ApiException(400, "当前可灵-Omni 模式包含无效参数，请重新确认参数设置");
    }
    Map<String, Object> params = new LinkedHashMap<>();
    params.put("mode", required(source, "mode", Set.of("std", "pro"), "画质模式"));
    if (videoReference) {
      params.put("refer_type", referType);
      if (featureReference) {
        optional(params, source, "duration", VIDEO_DURATIONS, "生成时长");
        optional(params, source, "aspect_ratio", RATIOS, "画面比例");
        optional(params, source, "keep_original_sound", Set.of("yes", "no"), "保留原声");
      }
    } else {
      params.put("duration", required(source, "duration", DURATIONS, "生成时长"));
      if (!FRAMES.equals(model)) optional(params, source, "aspect_ratio", RATIOS, "画面比例");
    }
    List<String> images = new ArrayList<>();
    // Do not deduplicate: two frame nodes can intentionally use the same image URL.
    int maximum = videoReference ? 4 : FRAMES.equals(model) ? 2 : 7;
    int minimum = FRAMES.equals(model) ? 1 : 0;
    if (request.referenceImageUrls().size() < minimum || request.referenceImageUrls().size() > maximum)
      throw new ApiException(400, "当前可灵-Omni 模式要求 " + minimum + " 至 " + maximum + " 张图片");
    for (String image : request.referenceImageUrls()) {
      if (!hasText(image)) throw new ApiException(400, "可灵-Omni 图片地址不能为空");
      String url = image.trim();
      requirePublicUrl(url, "参考图片");
      images.add(url);
    }
    if (!images.isEmpty()) params.put("images", images);
    if (videoReference) {
      if (request.referenceVideos().size() != 1)
        throw new ApiException(400, "可灵-Omni 视频参考模式必须传入 1 个参考视频");
      var video = request.referenceVideos().get(0);
      if (video == null || !hasText(video.url())) throw new ApiException(400, "可灵-Omni 参考视频地址不能为空");
      if (video.durationSeconds() != null && (!Double.isFinite(video.durationSeconds())
          || video.durationSeconds() < 3 || video.durationSeconds() > 10))
        throw new ApiException(400, "可灵-Omni 参考视频时长必须为 3 至 10 秒");
      String url = video.url().trim();
      requirePublicUrl(url, "参考视频");
      params.put("video", url);
    } else if (!request.referenceVideos().isEmpty()) {
      throw new ApiException(400, "当前可灵-Omni 模式不支持参考视频，请切换到视频参考模式");
    }
    if (!hasText(request.prompt()) && images.isEmpty() && !videoReference)
      throw new ApiException(400, "纯文生视频的提示词不能为空");
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("model", model);
    body.put("prompt", request.prompt() == null ? "" : request.prompt().trim());
    body.put("params", params);
    if (hasText(request.webhookUrl())) {
      String callback = request.webhookUrl().trim();
      requirePublicUrl(callback, "回调");
      body.put("notify_url", callback);
    }
    return new Prepared(credential, body);
  }

  private String required(Map<String, Object> source, String key, Set<String> options, String label) {
    Object value = source.get(key);
    if (value instanceof String text && options.contains(text)) return text;
    throw new ApiException(400, "可灵-Omni " + label + "参数无效或缺失");
  }

  private void optional(Map<String, Object> target, Map<String, Object> source, String key,
      Set<String> options, String label) {
    if (source.containsKey(key)) target.put(key, required(source, key, options, label));
  }

  public VideoGenerationDtos.CreateTaskResponse createTask(VideoGenerationDtos.CreateTaskRequest request)
      throws Exception {
    Prepared prepared = prepare(request);
    var credential = prepared.credential();
    JsonNode root = send(credential, "POST", credential.generationEndpoint(), prepared.body());
    String id = text(root.path("data"), "task_id");
    if (!id.matches("[0-9]+")) throw new ApiException(502, "可灵-Omni 未返回有效任务编号，请核对原任务后再重试");
    var result = new VideoGenerationDtos.CreateTaskResponse();
    result.setProvider(credential.provider());
    result.setModel(request.model());
    result.setTaskId(PREFIX + credential.id() + ":" + id);
    result.setStatus("queued");
    result.setRaw(root);
    return result;
  }

  public VideoGenerationDtos.TaskStatusResponse getTask(String taskId, Long userId) throws Exception {
    if (taskId == null || !taskId.matches("kling-omni:key:[1-9][0-9]*:[0-9]+"))
      throw new ApiException(400, "可灵-Omni 任务编号无效");
    int split = taskId.indexOf(':', PREFIX.length());
    ResolvedModelApiKey credential;
    try {
      credential = keys.resolveById(Long.parseLong(taskId.substring(PREFIX.length(), split)),
          ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION);
    } catch (NumberFormatException error) { throw new ApiException(400, "可灵-Omni 任务编号无效"); }
    if (credential == null || !nativeModel(credential))
      throw new ApiException(503, "可灵-Omni 原任务线路不可用，请检查原模型配置");
    validateEndpoints(credential);
    String id = taskId.substring(split + 1);
    JsonNode root = send(credential, "GET", taskEndpoint(credential, id), null);
    if (!id.equals(text(root, "task_id")))
      throw new ApiException(502, "可灵-Omni 未返回原任务的有效状态编号，请继续查询原任务");
    String state = text(root, "state");
    if (!Set.of("pending", "running", "success", "failed").contains(state))
      throw new ApiException(502, "可灵-Omni 返回未知任务状态，请继续查询原任务");
    if (!root.path("is_final").isBoolean())
      throw new ApiException(502, "可灵-Omni 未返回有效终态标记，请继续查询原任务");
    boolean terminal = root.path("is_final").booleanValue();
    if (terminal && !Set.of("success", "failed").contains(state))
      throw new ApiException(502, "可灵-Omni 返回的终态不完整，请继续查询原任务");
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
      result.setError(redact(first(text(root, "error"), text(root.path("error"), "message"), "可灵-Omni 视频生成失败"), credential));
    } else if (status.equals("completed")) {
      String url = text(root, "result_url");
      if (url.isBlank()) throw new ApiException(502, "可灵-Omni 已完成，但成片地址尚未返回，请继续查询");
      try { requirePublicUrl(url, "成片"); }
      catch (ApiException error) { throw new ApiException(502, "可灵-Omni 返回的成片地址无效，请继续查询原任务"); }
      if (!"video".equals(text(root, "result_type")))
        throw new ApiException(502, "可灵-Omni 返回的结果类型不是视频，请继续查询原任务");
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
    if (!isModel(model)) return Optional.empty();
    return keys.resolve(model.trim(), ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video")
        .filter(value -> model.trim().equalsIgnoreCase(value.model()));
  }

  private boolean nativeModel(ResolvedModelApiKey credential) { return credential != null && isModel(credential.model()); }

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
    throw new ApiException(503, "可灵-Omni 线路必须配置同一站点的 /v1/media/generate 和 /v1/media/status");
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
        var address = java.net.InetAddress.getByName(host); // Numeric IPv6 only; no DNS resolution.
        if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
            || address.isSiteLocalAddress() || address.isMulticastAddress())
          throw new IllegalArgumentException("Private IPv6 address");
      }
      if (value.length() <= 16384) return;
    } catch (Exception ignored) { }
    throw new ApiException(400, "可灵-Omni " + label + "必须使用公网 HTTP(S) 地址");
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
      catch (Exception error) { throw new ApiException(502, "可灵-Omni 返回无法解析的响应，请核对原任务"); }
      if (root == null || !root.isObject()) throw new ApiException(502, "可灵-Omni 返回空响应");
      if (response.statusCode() < 200 || response.statusCode() >= 300
          || root.has("code") && root.path("code").asInt(-1) != 200) {
        int code = response.statusCode() >= 400 && response.statusCode() < 500 ? response.statusCode() : 502;
        String reason = redact(first(text(root, "msg"), text(root, "error"), text(root.path("error"), "message"), "上游服务拒绝请求"), credential);
        throw new ApiException(code, "可灵-Omni 接口请求失败（HTTP " + response.statusCode() + "）：" + reason);
      }
      log(credential, method, true, started, null);
      return root;
    } catch (Exception error) {
      log(credential, method, false, started, error);
      throw error;
    }
  }

  private String redact(String value, ResolvedModelApiKey credential) {
    return value.replace(credential.apiKey().trim(), "[redacted]").replaceAll("sk-[A-Za-z0-9_-]+", "[redacted]");
  }

  private void log(ResolvedModelApiKey credential, String method, boolean success, long started, Exception error) {
    if (callLog != null) callLog.record("canvas-video", "POST".equals(method) ? "video_generate" : "video_query",
        credential.provider(), credential.model(), credential.id(), "dropdown", success,
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
