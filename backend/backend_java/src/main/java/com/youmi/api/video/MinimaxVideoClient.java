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
  public static final String MAPPED_PREFIX = PREFIX + "key:";
  public static final String CANVAS_V3_PROFILE = "canvas-v3-minimax-h3";
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
    return hasConfiguredHailuoModel("canvas-video");
  }

  public boolean hasConfiguredHailuoModel(String featureCode) {
    if (modelApiKeys == null) return false;
    return modelApiKeys.enabledModelOptions(ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, featureCode)
        .stream().anyMatch(option -> MODEL.equalsIgnoreCase(option.value())
            || CONFIGURED_MODEL.equalsIgnoreCase(option.value())
            || MODEL.equalsIgnoreCase(option.label())
            || CONFIGURED_MODEL.equalsIgnoreCase(option.label()));
  }

  public boolean usesMappedHailuoAlias(String model, String featureCode) {
    return MODEL.equals(model) && "product-video-video".equals(featureCode)
        && hasConfiguredHailuoModel(featureCode);
  }

  public int price(VideoGenerationDtos.CreateTaskRequest request) {
    if (usesCanvasV3H3(request)) return prepareCanvasV3H3(request).price();
    validate(request);
    int rate = properties.rate(resolution(request));
    boolean configuredModel = usesConfiguredHailuo(request);
    java.util.Optional<ResolvedModelApiKey> credential = configuredModel
        ? resolveHailuoCredential(featureCode(request)) : java.util.Optional.empty();
    if (configuredModel && credential.isEmpty())
      throw new ApiException(503, "Mini H3 首尾帧模型管理密钥未配置或未绑定画布视频功能");
    // Model-managed Mini H3 reports its actual cost in the status response;
    // channel labels are user-defined and must not gate task submission.
    if (configuredModel) return 0;
    if (resolveMappedMinimaxCredential(request).isPresent()) return 0;
    if ((!configuredModel && !properties.hasKey()) || rate == 0)
      throw new ApiException(503, "Mini H3 首尾帧所选画质尚未配置模型密钥和每秒米值单价");
    return Math.multiplyExact(rate, request.durationSeconds());
  }

  public static boolean supportsModel(String model) {
    return MODEL.equals(model) || CONFIGURED_MODEL.equals(model);
  }

  public boolean supportsConfiguredHailuoModel(String model) {
    return CONFIGURED_MODEL.equals(model) && hasConfiguredHailuoModel();
  }

  public boolean availableCanvasV3H3() { return properties.isAvailable(); }

  /** Opaque route values must be resolved; editable names never identify an H3 model. */
  public boolean supportsCanvasV3H3(String model, String featureCode) {
    String feature = featureCode == null || featureCode.isBlank() ? "canvas-video" : featureCode;
    if (!"canvas-video".equals(feature) || model == null || model.isBlank()) return false;
    var credential = resolveCanvasV3H3Credential(model, feature);
    if (credential.isPresent()) return isNativeH3(credential.get().model());
    return isNativeH3(model) && (modelApiKeys == null || !modelApiKeys.isFeatureMappingConfigured(feature));
  }

  public VideoGenerationDtos.CreateTaskResponse createTask(VideoGenerationDtos.CreateTaskRequest request) throws Exception {
    if (usesCanvasV3H3(request)) return createCanvasV3H3Task(request);
    price(request);
    if (usesConfiguredHailuo(request)) return createConfiguredHailuoTask(request);
    Map<String, Object> params = new LinkedHashMap<>();
    params.put("duration", String.valueOf(request.durationSeconds()));
    params.put("resolution", resolution(request).toUpperCase(Locale.ROOT));
    List<String> frames = frames(request);
    params.put("aspect_ratio", ratio(request));
    params.put("mode", frames.isEmpty() ? "cankaosheng" : "shouweizhen");
    if (!frames.isEmpty()) params.put("images", frames);
    else if (!request.normalizedImageUrls().isEmpty()) params.put("image_url", request.normalizedImageUrls());
    Map<String, Object> body = Map.of(
        "model", request.model(), "prompt", request.prompt().trim(), "params", params);
    var credential = resolveMappedMinimaxCredential(request);
    JsonNode root = credential.isPresent()
        ? sendMappedMinimax(credential.get(), "POST", credential.get().generationEndpoint(), body)
        : send("POST", "/v1/media/generate", body);
    String id = text(root.path("data"), "task_id");
    if (!id.matches("[0-9]+")) throw new ApiException(502, "MiniMax H3 未返回有效任务编号，请核对中转站记录后再重试");
    var result = new VideoGenerationDtos.CreateTaskResponse();
    result.setProvider(credential.map(ResolvedModelApiKey::provider).orElse("lk888-minimax"));
    result.setModel(request.model());
    result.setTaskId(credential.map(key -> MAPPED_PREFIX + key.id() + ":" + id).orElse(PREFIX + id));
    result.setStatus("queued");
    result.setRaw(root);
    return result;
  }

  private boolean usesCanvasV3H3(VideoGenerationDtos.CreateTaskRequest request) {
    return request != null && CANVAS_V3_PROFILE.equals(request.parameterProfile());
  }

  private boolean isNativeH3(String model) {
    return model != null && MODEL.equalsIgnoreCase(model.trim());
  }

  private java.util.Optional<ResolvedModelApiKey> resolveCanvasV3H3Credential(String model, String feature) {
    if (modelApiKeys == null || model == null) return java.util.Optional.empty();
    var routed = modelApiKeys.resolveFeatureRouteOption(model,
        ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, feature);
    if (routed.isPresent() || model.startsWith(ModelApiKeyService.FEATURE_ROUTE_OPTION_PREFIX)) return routed;
    if (!isNativeH3(model)) return java.util.Optional.empty();
    return modelApiKeys.resolve(model.trim(), ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, feature);
  }

  private record CanvasV3H3Request(ResolvedModelApiKey credential, Map<String, Object> body, int price) {}

  private CanvasV3H3Request prepareCanvasV3H3(VideoGenerationDtos.CreateTaskRequest request) {
    String feature = request.featureCode() == null || request.featureCode().isBlank()
        ? "canvas-video" : request.featureCode();
    var credential = resolveCanvasV3H3Credential(request.model(), feature).orElse(null);
    if (!"canvas-video".equals(feature) || (credential != null ? !isNativeH3(credential.model())
        : !isNativeH3(request.model()) || modelApiKeys != null && modelApiKeys.isFeatureMappingConfigured(feature)))
      throw new ApiException(400, "所选线路不是画布 V3 MiniMax H3 模型，或未绑定到画布视频功能");
    if (request.prompt() == null || request.prompt().isBlank())
      throw new ApiException(400, "视频提示词不能为空");
    String prompt = request.prompt().trim();
    if (prompt.codePointCount(0, prompt.length()) > 7000)
      throw new ApiException(400, "MiniMax H3 提示词最多支持 7000 字");
    if (request.durationSeconds() == null || request.durationSeconds() < 4 || request.durationSeconds() > 15)
      throw new ApiException(400, "MiniMax H3 时长必须为 4 至 15 的整数秒");
    String resolution = resolution(request);
    if (!RESOLUTIONS.contains(resolution))
      throw new ApiException(400, "MiniMax H3 分辨率仅支持 768P、1080P、2K 或 4K");
    String ratio = request.ratio() == null || request.ratio().isBlank() ? "adaptive" : request.ratio().trim();
    if (!RATIOS.contains(ratio)) throw new ApiException(400, "MiniMax H3 不支持该画面比例");
    List<String> frames = frames(request);
    List<String> genericImages = validatedMediaUrls(request.imageUrls(), 9, "图片");
    List<String> referenceImages = validatedMediaUrls(request.referenceImageUrls(), 9, "参考图片");
    List<String> audios = validatedMediaUrls(request.referenceAudios(), 3, "参考音频");
    List<VideoGenerationDtos.ReferenceVideo> videos = request.referenceVideos() == null
        ? List.of() : request.referenceVideos();
    if (videos.size() > 3) throw new ApiException(400, "MiniMax H3 最多支持 3 个参考视频");
    List<String> videoUrls = new ArrayList<>();
    for (var video : videos) {
      if (video == null || video.url() == null) throw new ApiException(400, "MiniMax H3 参考视频地址不能为空");
      String url = video.url().trim();
      requireUrl(url);
      if (video.durationSeconds() != null && (!Double.isFinite(video.durationSeconds()) || video.durationSeconds() <= 0))
        throw new ApiException(400, "MiniMax H3 参考视频时长须为正数");
      videoUrls.add(url);
    }
    // Saved UI mode is no longer authoritative: actual media defines the wire mode.
    // Explicit reference fields remain references, while unassigned 1-2 images
    // are positional frames. Audio/video always uses multimodal reference mode.
    boolean multimodal = !videos.isEmpty() || !audios.isEmpty();
    boolean referenceMode = multimodal || !referenceImages.isEmpty()
        || genericImages.size() > 2 || frames.isEmpty() && genericImages.isEmpty();
    String mode = referenceMode ? "cankaosheng" : "shouweizhen";
    if ("shouweizhen".equals(mode)) {
      if (frames.isEmpty()) frames = genericImages;
      else if (!genericImages.isEmpty())
        throw new ApiException(400, "MiniMax H3 首尾帧不能同时使用未分配角色的图片字段");
      if (frames.size() > 2) throw new ApiException(400, "MiniMax H3 首尾帧最多支持 2 张图片");
    } else {
      if (!multimodal && !frames.isEmpty())
        throw new ApiException(400, "MiniMax H3 参考图片不能与首尾帧混用");
      List<String> combined = new ArrayList<>(frames);
      combined.addAll(referenceImages);
      combined.addAll(genericImages);
      // Do not silently drop positional duplicates or hide excess references.
      referenceImages = validatedMediaUrls(combined, 9, "参考图片");
      frames = List.of();
    }
    for (String url : frames) requireUrl(url);
    if (credential != null) validateCanvasV3H3Endpoints(credential);
    Map<String, Object> params = new LinkedHashMap<>();
    params.put("mode", mode);
    params.put("duration", String.valueOf(request.durationSeconds()));
    params.put("resolution", resolution.toUpperCase(Locale.ROOT));
    params.put("aspect_ratio", ratio);
    if (!frames.isEmpty()) params.put("images", frames);
    if (!referenceImages.isEmpty()) params.put("image_url", referenceImages);
    if (!videoUrls.isEmpty()) params.put("video_url", videoUrls);
    if (!audios.isEmpty()) params.put("audio_url", audios);
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("model", MODEL);
    body.put("prompt", prompt);
    body.put("params", params);
    if (request.webhookUrl() != null && !request.webhookUrl().isBlank()) {
      String callback = request.webhookUrl().trim();
      requireUrl(callback);
      body.put("notify_url", callback);
    }
    if (credential != null) return new CanvasV3H3Request(credential, body, 0);
    int rate = properties.rate(resolution);
    if (!properties.hasKey() || rate == 0)
      throw new ApiException(503, "MiniMax H3 所选分辨率尚未配置接口密钥和输出秒费率");
    try {
      int price = Math.multiplyExact(rate, request.durationSeconds());
      if (!videos.isEmpty()) {
        int inputRate = properties.inputVideoRate(resolution);
        if (inputRate == 0) throw new ApiException(503, "MiniMax H3 参考视频输入秒费率尚未配置，不能忽略输入费用");
        double seconds = 0;
        for (var video : videos) {
          if (video.durationSeconds() == null)
            throw new ApiException(400, "MiniMax H3 参考视频需要提供准确时长以计算输入费用");
          seconds += video.durationSeconds();
        }
        if (!Double.isFinite(seconds) || Math.ceil(seconds) > Integer.MAX_VALUE)
          throw new ApiException(400, "MiniMax H3 参考视频总时长无效");
        price = Math.addExact(price, Math.multiplyExact(inputRate, (int) Math.ceil(seconds)));
      }
      return new CanvasV3H3Request(null, body, price);
    } catch (ArithmeticException error) {
      throw new ApiException(400, "MiniMax H3 视频费用超出可支持范围");
    }
  }

  private List<String> validatedMediaUrls(List<String> values, int maximum, String label) {
    if (values == null) return List.of();
    if (values.size() > maximum) throw new ApiException(400, "MiniMax H3 " + label + "最多支持 " + maximum + " 个");
    List<String> result = new ArrayList<>();
    for (String value : values) {
      if (value == null || value.isBlank()) throw new ApiException(400, "MiniMax H3 " + label + "地址不能为空");
      String url = value.trim();
      requireUrl(url);
      result.add(url);
    }
    return result;
  }

  private void validateCanvasV3H3Endpoints(ResolvedModelApiKey credential) {
    try {
      URI generation = URI.create(credential.generationEndpoint());
      URI status = URI.create(credential.taskEndpoint().replace("{task_id}", "1").replace("{id}", "1"));
      requireUrl(generation.toString());
      requireUrl(status.toString());
      if (generation.getPath().endsWith("/v1/media/generate") && generation.getQuery() == null
          && status.getPath().endsWith("/v1/media/status")
          && (status.getQuery() == null || status.getQuery().matches("(?:[^&]+&)*task_id=[0-9]*(?:&[^&]+)*"))
          && (credential.taskEndpoint().contains("{task_id}") || credential.taskEndpoint().contains("{id}")
              || status.getQuery() == null || status.getQuery().matches("(?:[^&]+&)*task_id=[0-9]*"))) return;
    } catch (Exception ignored) { }
    throw new ApiException(503, "MiniMax H3 画布 V3 线路必须配置开放 API /v1/media/generate 和 /v1/media/status，不能使用其他协议端点");
  }

  private VideoGenerationDtos.CreateTaskResponse createCanvasV3H3Task(
      VideoGenerationDtos.CreateTaskRequest request) throws Exception {
    var prepared = prepareCanvasV3H3(request);
    var credential = prepared.credential();
    JsonNode root;
    try {
      root = credential == null ? send("POST", "/v1/media/generate", prepared.body())
          : sendMappedMinimax(credential, "POST", credential.generationEndpoint(), prepared.body());
    } catch (ApiException error) {
      String key = credential == null ? properties.getApiKey() : credential.apiKey();
      if (key != null && !key.isBlank() && error.getMessage() != null && error.getMessage().contains(key.trim()))
        throw new ApiException(error.getCode(), error.getMessage().replace(key.trim(), "[redacted]"));
      throw error;
    }
    String id = text(root.path("data"), "task_id");
    if (!id.matches("[0-9]+"))
      throw new ApiException(502, "MiniMax H3 未返回有效任务编号，请核对中转站记录后再重试");
    var result = new VideoGenerationDtos.CreateTaskResponse();
    result.setProvider(credential == null ? "lk888-minimax" : credential.provider());
    result.setModel(request.model());
    result.setTaskId(credential == null ? PREFIX + id : MAPPED_PREFIX + credential.id() + ":" + id);
    result.setStatus("queued");
    result.setRaw(root);
    return result;
  }

  public VideoGenerationDtos.TaskStatusResponse getTask(String taskId, Long userId) throws Exception {
    if (taskId != null && taskId.startsWith(CONFIGURED_PREFIX))
      return getConfiguredHailuoTask(taskId, userId);
    ResolvedModelApiKey credential = null;
    String id;
    // Keep polling with the task's original key, even after feature mappings change.
    if (taskId != null && taskId.startsWith(MAPPED_PREFIX)) {
      if (!taskId.matches("minimax-h3:key:[0-9]+:[0-9]+") || modelApiKeys == null)
        throw new ApiException(400, "MiniMax H3 任务编号无效");
      int keyEnd = taskId.indexOf(':', MAPPED_PREFIX.length());
      try {
        long keyId = Long.parseLong(taskId.substring(MAPPED_PREFIX.length(), keyEnd));
        credential = modelApiKeys.resolveById(keyId, ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION);
      } catch (NumberFormatException error) {
        throw new ApiException(400, "MiniMax H3 任务编号无效");
      }
      if (credential == null) throw new ApiException(503, "MiniMax H3 原任务密钥不可用");
      id = taskId.substring(keyEnd + 1);
    } else {
      if (taskId == null || !taskId.matches("minimax-h3:[0-9]+"))
        throw new ApiException(400, "MiniMax H3 任务编号无效");
      id = taskId.substring(PREFIX.length());
    }
    JsonNode root = credential != null
        ? sendMappedMinimax(credential, "GET", configuredTaskEndpoint(credential, id), null)
        : send("GET", "/v1/media/status?task_id=" + id, null);
    String state = text(root, "state");
    if (!Set.of("pending", "running", "success", "failed").contains(state))
      throw new ApiException(502, "MiniMax H3 返回未知任务状态，请稍后继续查询");
    boolean terminal = root.path("is_final").isBoolean() && root.path("is_final").booleanValue();
    if (terminal && !Set.of("success", "failed").contains(state))
      throw new ApiException(502, "MiniMax H3 返回的终态不完整，请稍后继续查询");
    String status = terminal ? (state.equals("success") ? "completed" : "failed")
        : state.equals("pending") ? "queued" : "processing";
    var result = new VideoGenerationDtos.TaskStatusResponse();
    result.setProvider(credential != null ? credential.provider() : "lk888-minimax");
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
    ResolvedModelApiKey credential = resolveHailuoCredential(featureCode(request))
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
      recordConfiguredCall(credential, true, started, null, featureCode(request));
      var result = new VideoGenerationDtos.CreateTaskResponse();
      result.setProvider(credential.provider());
      result.setModel(CONFIGURED_MODEL);
      result.setTaskId(CONFIGURED_PREFIX + "key:" + credential.id() + ":" + id);
      result.setStatus("queued");
      result.setRaw(root);
      return result;
    } catch (Exception error) {
      recordConfiguredCall(credential, false, started, error, featureCode(request));
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
    return resolveHailuoCredential("canvas-video");
  }

  private java.util.Optional<ResolvedModelApiKey> resolveHailuoCredential(String featureCode) {
    if (modelApiKeys == null) return java.util.Optional.empty();
    String modelType = com.youmi.api.image.ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION;
    return modelApiKeys.resolve(CONFIGURED_MODEL, modelType, featureCode)
        .or(() -> modelApiKeys.resolve(MODEL, modelType, featureCode));
  }

  private java.util.Optional<ResolvedModelApiKey> resolveMappedMinimaxCredential(
      VideoGenerationDtos.CreateTaskRequest request) {
    if (modelApiKeys == null || !MODEL.equals(request.model())
        || !"canvas-video".equals(featureCode(request))) return java.util.Optional.empty();
    var credential = modelApiKeys.resolve(MODEL, ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video");
    if (credential.isEmpty() && modelApiKeys.isFeatureMappingConfigured("canvas-video"))
      throw new ApiException(400, "MiniMax H3 未绑定到画布视频功能，请检查模型映射");
    return credential;
  }

  private JsonNode sendMappedMinimax(ResolvedModelApiKey credential, String method,
      String endpoint, Object body) throws Exception {
    long started = System.nanoTime();
    try {
      JsonNode root = sendUrl(credential.apiKey(), method, endpoint, body);
      recordMappedMinimaxCall(credential, method, true, started, null);
      return root;
    } catch (Exception error) {
      recordMappedMinimaxCall(credential, method, false, started, error);
      throw error;
    }
  }

  private void recordMappedMinimaxCall(ResolvedModelApiKey credential, String method,
      boolean success, long started, Exception error) {
    if (aiCallLogService != null) aiCallLogService.record("canvas-video",
        "POST".equals(method) ? "video_generate" : "video_query", credential.provider(), MODEL,
        credential.id(), "dropdown", success,
        error instanceof ApiException ? ((ApiException) error).getCode() : null,
        (System.nanoTime() - started) / 1_000_000L,
        error == null ? null : error.getClass().getSimpleName());
  }

  private String featureCode(VideoGenerationDtos.CreateTaskRequest request) {
    return request != null && "product-video-video".equals(request.featureCode())
        ? request.featureCode() : "canvas-video";
  }

  private boolean isConfiguredModel(String model) { return CONFIGURED_MODEL.equals(model); }

  private boolean usesConfiguredHailuo(VideoGenerationDtos.CreateTaskRequest request) {
    return isConfiguredModel(request.model())
        || usesMappedHailuoAlias(request.model(), featureCode(request));
  }

  private void recordConfiguredCall(ResolvedModelApiKey credential, boolean success, long started, Exception error,
      String featureCode) {
    if (aiCallLogService != null) aiCallLogService.record(featureCode, "video_generate",
        credential.provider(), CONFIGURED_MODEL, credential.id(), "dropdown", success, null,
        (System.nanoTime() - started) / 1_000_000L,
        error == null ? null : error.getClass().getSimpleName());
  }

  private void validate(VideoGenerationDtos.CreateTaskRequest request) {
    if (request == null || !supportsModel(request.model())) throw new ApiException(400, "Mini H3 视频模型编号无效");
    boolean configuredHailuo = usesConfiguredHailuo(request);
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
