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

/** Documented Wanxiang 3.0 open-media protocol; never route to native Kling or Seedance APIs. */
@Service
public class WanxiangVideoClient {
  public static final String MODEL = "wan3.0-video-quannengcankao";
  public static final String LEGACY_UI_MODEL = "万相 3.0";
  public static final String PROFILE = "canvas-v3-wanxiang30";
  public static final String PREFIX = "wanxiang30:key:";
  private static final Set<String> RATIOS = Set.of("adaptive", "16:9", "9:16", "1:1", "4:3", "3:4");
  private static final Set<String> ALLOWED = Set.of("image_url", "video_url", "audio_url", "version",
      "resolution", "duration", "ratio", "audio", "prompt_extend");
  private final ModelApiKeyService keys;
  private final VideoGenerationClient media;
  private final ObjectMapper mapper;
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15))
      .followRedirects(HttpClient.Redirect.NEVER).build();
  private AiCallLogService callLog;

  public WanxiangVideoClient(ModelApiKeyService keys, VideoGenerationClient media, ObjectMapper mapper) {
    this.keys = keys;
    this.media = media;
    this.mapper = mapper;
  }

  @Autowired(required = false)
  void setAiCallLogService(AiCallLogService callLog) { this.callLog = callLog; }

  public static boolean isModel(String model) {
    return model != null && (MODEL.equalsIgnoreCase(model.trim()) || LEGACY_UI_MODEL.equals(model.trim()));
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
      throw new ApiException(400, "万相 3.0 全能仅支持对应的画布视频参数配置");
    var credential = credential(request.model()).filter(this::nativeModel)
        .orElseThrow(() -> new ApiException(503, "万相 3.0 全能尚未配置模型密钥或绑定画布视频功能"));
    validateEndpoints(credential);
    if (hasText(request.ratio()) || request.durationSeconds() != null || hasText(request.resolution())
        || request.imageUrls() != null && !request.imageUrls().isEmpty()
        || hasText(request.firstFrameUrl()) || hasText(request.lastFrameUrl())
        || hasText(request.negativePrompt()) || request.generateAudio() != null || request.seed() != null
        || request.webSearch() != null || hasText(request.mode()) || hasText(request.version())
        || !request.omniParams().isEmpty())
      throw new ApiException(400, "万相 3.0 全能请使用 wanxiang_params，不支持其他视频模型参数");
    Map<String, Object> source = request.wanxiangParams();
    if (!ALLOWED.containsAll(source.keySet()))
      throw new ApiException(400, "万相 3.0 全能包含未知参数，请按模型文档重新设置");
    Map<String, Object> params = new LinkedHashMap<>();
    params.put("version", required(source, "version", Set.of("standard", "prime"), "版本"));
    params.put("resolution", required(source, "resolution", Set.of("480P", "720P", "1080P"), "分辨率"));
    Object durationValue = source.get("duration");
    String duration = durationValue instanceof String value ? value : "";
    if (!duration.equals("auto") && !duration.matches("(?:[2-9]|[12][0-9]|30)"))
      throw new ApiException(400, "万相 3.0 全能时长必须为 auto 或 2 至 30 的整数秒");
    params.put("duration", duration);
    if (source.containsKey("ratio")) params.put("ratio", required(source, "ratio", RATIOS, "比例"));
    for (String key : List.of("audio", "prompt_extend")) {
      if (source.containsKey(key)) {
        if (!(source.get(key) instanceof Boolean))
          throw new ApiException(400, "万相 3.0 全能 " + key + " 必须为布尔值");
        params.put(key, source.get(key));
      }
    }
    List<String> images = mediaUrls(source, "image_url", 10, "参考图片");
    List<String> videos = mediaUrls(source, "video_url", 5, "参考视频");
    List<String> audios = mediaUrls(source, "audio_url", 5, "参考音频");
    if (!request.referenceImageUrls().isEmpty() && !request.referenceImageUrls().equals(images)
        || !request.referenceAudios().isEmpty() && !request.referenceAudios().equals(audios))
      throw new ApiException(400, "万相 3.0 全能重复素材参数必须与 wanxiang_params 同序一致");
    if (!images.isEmpty()) params.put("image_url", images);
    if (!videos.isEmpty()) params.put("video_url", videos);
    if (!audios.isEmpty()) params.put("audio_url", audios);
    double videoSeconds = metadataSeconds(videos, request.referenceVideos(), "参考视频");
    metadataSeconds(audios, request.referenceAudioMedia(), "参考音频");
    // Smart duration is provider constrained to the remaining 30-second budget.
    // Do not turn auto + a valid reference video into an artificial 30 + N failure.
    if (!duration.equals("auto") && Integer.parseInt(duration) + videoSeconds > 30 + 1e-9)
      throw new ApiException(400, "万相 3.0 全能成片时长与参考视频总时长合计不能超过 30 秒");
    if (!hasText(request.prompt()) && images.isEmpty() && videos.isEmpty() && audios.isEmpty())
      throw new ApiException(400, "请输入视频提示词或连接参考素材");
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("model", MODEL);
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
    throw new ApiException(400, "万相 3.0 全能" + label + "参数无效或缺失");
  }

  private List<String> mediaUrls(Map<String, Object> source, String key, int maximum, String label) {
    if (!source.containsKey(key)) return List.of();
    if (!(source.get(key) instanceof List<?> values) || values.size() > maximum)
      throw new ApiException(400, "万相 3.0 全能" + label + "最多 " + maximum + " 个，且必须为 URL 数组");
    List<String> result = new ArrayList<>();
    for (Object value : values) {
      if (!(value instanceof String text) || text.isBlank())
        throw new ApiException(400, "万相 3.0 全能" + label + "地址不能为空");
      String url = ((String) value).trim();
      requirePublicUrl(url, label);
      result.add(url);
    }
    return List.copyOf(result);
  }

  private double metadataSeconds(List<String> urls, List<VideoGenerationDtos.ReferenceVideo> media, String label) {
    if (urls.size() != media.size())
      throw new ApiException(400, "万相 3.0 全能" + label + "缺少对应时长，请等待素材读取完成");
    double total = 0;
    for (int index = 0; index < urls.size(); index++) {
      var item = media.get(index);
      if (item == null || !urls.get(index).equals(item.url()) || item.durationSeconds() == null
          || !Double.isFinite(item.durationSeconds()) || item.durationSeconds() <= 0)
        throw new ApiException(400, "万相 3.0 全能" + label + "时长或地址无效，请重新读取素材");
      total += item.durationSeconds();
    }
    if (total > 15 + 1e-9)
      throw new ApiException(400, "万相 3.0 全能" + label + "总时长不能超过 15 秒");
    return total;
  }

  public VideoGenerationDtos.CreateTaskResponse createTask(VideoGenerationDtos.CreateTaskRequest request)
      throws Exception {
    Prepared prepared = prepare(request);
    var credential = prepared.credential();
    JsonNode root = send(credential, "POST", credential.generationEndpoint(), prepared.body());
    String id = text(root.path("data"), "task_id");
    if (!id.matches("[0-9]+")) throw new ApiException(502, "万相 3.0 全能 未返回有效任务编号，请核对原任务后再重试");
    var result = new VideoGenerationDtos.CreateTaskResponse();
    result.setProvider(credential.provider());
    result.setModel(request.model());
    result.setTaskId(PREFIX + credential.id() + ":" + id);
    result.setStatus("queued");
    result.setRaw(sanitized(root, credential));
    return result;
  }

  public VideoGenerationDtos.TaskStatusResponse getTask(String taskId, Long userId) throws Exception {
    if (taskId == null || !taskId.matches("wanxiang30:key:[1-9][0-9]*:[0-9]+"))
      throw new ApiException(400, "万相 3.0 全能 任务编号无效");
    int split = taskId.indexOf(':', PREFIX.length());
    ResolvedModelApiKey credential;
    try {
      credential = keys.resolveById(Long.parseLong(taskId.substring(PREFIX.length(), split)),
          ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION);
    } catch (NumberFormatException error) { throw new ApiException(400, "万相 3.0 全能 任务编号无效"); }
    if (credential == null || !nativeModel(credential))
      throw new ApiException(503, "万相 3.0 全能 原任务线路不可用，请检查原模型配置");
    validateEndpoints(credential);
    String id = taskId.substring(split + 1);
    JsonNode root = send(credential, "GET", taskEndpoint(credential, id), null);
    if (!id.equals(text(root, "task_id")))
      throw new ApiException(502, "万相 3.0 全能 未返回原任务的有效状态编号，请继续查询原任务");
    String state = text(root, "state");
    if (!Set.of("pending", "running", "success", "failed").contains(state))
      throw new ApiException(502, "万相 3.0 全能 返回未知任务状态，请继续查询原任务");
    if (!root.path("is_final").isBoolean())
      throw new ApiException(502, "万相 3.0 全能 未返回有效终态标记，请继续查询原任务");
    boolean terminal = root.path("is_final").booleanValue();
    if (terminal && !Set.of("success", "failed").contains(state))
      throw new ApiException(502, "万相 3.0 全能 返回的终态不完整，请继续查询原任务");
    String status = terminal ? (state.equals("success") ? "completed" : "failed")
        : state.equals("pending") ? "queued" : "processing";
    var result = new VideoGenerationDtos.TaskStatusResponse();
    result.setTaskId(taskId);
    result.setProvider(credential.provider());
    result.setStatus(status);
    result.setStage(first(text(root, "status"), terminal ? "成片生成完成" : "中转站生成中"));
    result.setProgress(progress(root.path("progress")));
    result.setRaw(sanitized(root, credential));
    if (status.equals("failed")) {
      result.setError(redact(first(text(root, "error"), text(root.path("error"), "message"), "万相 3.0 全能 视频生成失败"), credential));
    } else if (status.equals("completed")) {
      String url = text(root, "result_url");
      if (url.isBlank()) throw new ApiException(502, "万相 3.0 全能 已完成，但成片地址尚未返回，请继续查询");
      try { requirePublicUrl(url, "成片"); }
      catch (ApiException error) { throw new ApiException(502, "万相 3.0 全能 返回的成片地址无效，请继续查询原任务"); }
      if (!"video".equals(text(root, "result_type")))
        throw new ApiException(502, "万相 3.0 全能 返回的结果类型不是视频，请继续查询原任务");
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
    return keys.resolve(MODEL, ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video")
        .filter(this::nativeModel);
  }

  private boolean nativeModel(ResolvedModelApiKey credential) { return credential != null && MODEL.equalsIgnoreCase(credential.model()); }

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
    throw new ApiException(503, "万相 3.0 全能 线路必须配置同一站点的 /v1/media/generate 和 /v1/media/status");
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
    throw new ApiException(400, "万相 3.0 全能 " + label + "必须使用公网 HTTP(S) 地址");
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
      catch (Exception error) { throw new ApiException(502, "万相 3.0 全能 返回无法解析的响应，请核对原任务"); }
      if (root == null || !root.isObject()) throw new ApiException(502, "万相 3.0 全能 返回空响应");
      if (response.statusCode() < 200 || response.statusCode() >= 300
          || root.has("code") && root.path("code").asInt(-1) != 200) {
        int code = response.statusCode() >= 400 && response.statusCode() < 500 ? response.statusCode() : 502;
        String reason = redact(first(text(root, "msg"), text(root, "error"), text(root.path("error"), "message"), "上游服务拒绝请求"), credential);
        throw new ApiException(code, "万相 3.0 全能 接口请求失败（HTTP " + response.statusCode() + "）：" + reason);
      }
      log(credential, method, true, started, null);
      return root;
    } catch (Exception error) {
      log(credential, method, false, started, error);
      throw error;
    }
  }

  private JsonNode sanitized(JsonNode root, ResolvedModelApiKey credential) {
    try { return mapper.readTree(redact(mapper.writeValueAsString(root), credential)); }
    catch (Exception ignored) { return mapper.createObjectNode(); }
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
