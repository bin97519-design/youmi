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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;

/** LK888's per-video Seedance branch uses the media API, not the per-second task API. */
@Service
public class SeedanceAnciVideoClient {
  public static final String MODEL = "seedance-2.0-anci";
  public static final String PREFIX = "seedance-anci:key:";
  private static final Set<String> RATIOS = Set.of("16:9", "9:16", "1:1", "4:3", "3:4");
  private final ModelApiKeyService keys;
  private final VideoGenerationClient media;
  private final AnmiaoVideoProperties properties;
  private final ObjectMapper mapper;
  private final AiCallLogService logs;
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build();

  public SeedanceAnciVideoClient(ModelApiKeyService keys, VideoGenerationClient media,
      AnmiaoVideoProperties properties, ObjectMapper mapper, AiCallLogService logs) {
    this.keys = keys;
    this.media = media;
    this.properties = properties;
    this.mapper = mapper;
    this.logs = logs;
  }

  public int price(VideoGenerationDtos.CreateTaskRequest request) {
    validate(request);
    credential(request);
    // The media status response reports one flat charge. Never multiply it by duration.
    return 0;
  }

  public VideoGenerationDtos.CreateTaskResponse createTask(VideoGenerationDtos.CreateTaskRequest request) throws Exception {
    validate(request);
    var key = credential(request);
    Map<String, Object> params = new LinkedHashMap<>();
    params.put("mode", "cankaosheng");
    params.put("version", request.version());
    params.put("duration", String.valueOf(request.durationSeconds()));
    params.put("aspect_ratio", request.ratio());
    params.put("resolution", "720p");
    if (!request.normalizedImageUrls().isEmpty()) params.put("images", request.normalizedImageUrls());
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("model", MODEL);
    body.put("prompt", request.prompt().trim());
    body.put("params", params);
    if (request.webhookUrl() != null && !request.webhookUrl().isBlank())
      body.put("notify_url", request.webhookUrl().trim());
    long started = System.nanoTime();
    try {
      JsonNode root = send(key, key.generationEndpoint(), body);
      String id = root.path("data").path("task_id").asText("");
      if (!id.matches("[0-9]+")) throw new ApiException(502, "SD 2.0 按次未返回有效任务编号，请核对中转站记录");
      var result = new VideoGenerationDtos.CreateTaskResponse();
      result.setModel(MODEL);
      result.setProvider(key.provider());
      result.setTaskId(PREFIX + key.id() + ":" + id);
      result.setStatus("queued");
      result.setRaw(root);
      record(request, key, started, null);
      return result;
    } catch (Exception error) {
      record(request, key, started, error);
      throw error;
    }
  }

  public VideoGenerationDtos.TaskStatusResponse getTask(String taskId, Long userId) throws Exception {
    if (taskId == null || !taskId.matches("seedance-anci:key:[0-9]+:[0-9]+"))
      throw new ApiException(400, "SD 2.0 按次任务编号无效");
    int separator = taskId.indexOf(':', PREFIX.length());
    long keyId;
    try { keyId = Long.parseLong(taskId.substring(PREFIX.length(), separator)); }
    catch (NumberFormatException error) { throw new ApiException(400, "SD 2.0 按次任务编号无效"); }
    var key = keys.resolveById(keyId, ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION);
    if (key == null || !MODEL.equals(key.model())) throw new ApiException(503, "SD 2.0 按次原任务密钥不可用");
    String id = taskId.substring(separator + 1);
    JsonNode response = send(key, taskEndpoint(key, id), null);
    JsonNode root = response.has("state") ? response : response.path("data");
    String state = root.path("state").asText("");
    if (!Set.of("pending", "running", "success", "failed").contains(state))
      throw new ApiException(502, "SD 2.0 按次返回未知任务状态，请稍后继续查询");
    if (!root.path("is_final").isBoolean())
      throw new ApiException(502, "SD 2.0 按次未返回终态标记，请稍后继续查询");
    boolean terminal = root.path("is_final").booleanValue();
    if (terminal && !Set.of("success", "failed").contains(state))
      throw new ApiException(502, "SD 2.0 按次返回的终态不完整，请稍后继续查询");
    String status = terminal ? ("success".equals(state) ? "completed" : "failed")
        : "pending".equals(state) ? "queued" : "processing";
    var result = new VideoGenerationDtos.TaskStatusResponse();
    result.setProvider(key.provider());
    result.setTaskId(taskId);
    result.setStatus(status);
    result.setStage(root.path("status").asText("视频处理中"));
    String progress = root.path("progress").asText("").replace("%", "").trim();
    try { result.setProgress(Math.max(0, Math.min(100, (int) Double.parseDouble(progress)))); }
    catch (NumberFormatException ignored) { }
    result.setRaw(response);
    if ("failed".equals(status)) {
      result.setError(root.path("error").isObject() ? root.path("error").path("message").asText("视频生成失败")
          : root.path("error").asText("视频生成失败"));
    } else if ("completed".equals(status)) {
      String url = root.path("result_url").asText("");
      try { requireUrl(url, "成片地址无效"); }
      catch (ApiException error) { throw new ApiException(502, "SD 2.0 按次已完成，但成片地址尚不可用，请稍后继续查询"); }
      if (properties.isPersistGeneratedVideos()) {
        try {
          String stored = media.persistVideoAsync(taskId, id, url, userId);
          if (stored == null) result.setStatus("persisting");
          else result.setVideoUrls(List.of(stored));
        } catch (Exception error) { result.setStatus("persisting"); }
        if ("persisting".equals(result.getStatus())) result.setStage("正在保存成片，稍后自动重试");
      } else result.setVideoUrls(List.of(url));
    }
    return result;
  }

  private ResolvedModelApiKey credential(VideoGenerationDtos.CreateTaskRequest request) {
    String feature = request.featureCode() == null || request.featureCode().isBlank() ? "canvas-video" : request.featureCode();
    return keys.resolve(MODEL, ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, feature)
        .orElseThrow(() -> new ApiException(503, "SD 2.0 按次密钥未配置或未绑定当前视频功能"));
  }

  void validate(VideoGenerationDtos.CreateTaskRequest request) {
    if (request == null || !MODEL.equals(request.model()) || request.prompt() == null || request.prompt().isBlank())
      throw new ApiException(400, "请填写 SD 2.0 按次视频提示词");
    if (!Set.of("快速", "标准").contains(request.version() == null ? "" : request.version()))
      throw new ApiException(400, "请选择 SD 2.0 按次的快速版或标准版");
    if (request.durationSeconds() == null || request.durationSeconds() < 4 || request.durationSeconds() > 15)
      throw new ApiException(400, "SD 2.0 按次时长需为 4 至 15 的整数秒");
    if (!"720p".equalsIgnoreCase(request.resolution())) throw new ApiException(400, "SD 2.0 按次仅支持 720p");
    if (!RATIOS.contains(request.ratio() == null ? "" : request.ratio())) throw new ApiException(400, "SD 2.0 按次不支持所选比例");
    if (request.normalizedImageUrls().size() > 9) throw new ApiException(400, "SD 2.0 按次最多支持 9 张参考图");
    if ((request.firstFrameUrl() != null && !request.firstFrameUrl().isBlank())
        || (request.lastFrameUrl() != null && !request.lastFrameUrl().isBlank()))
      throw new ApiException(400, "SD 2.0 按次不支持首尾帧，请使用参考图");
    if (!request.normalizedReferenceVideos().isEmpty()) throw new ApiException(400, "SD 2.0 按次不支持参考视频输入");
    if (Boolean.FALSE.equals(request.generateAudio())) throw new ApiException(400, "SD 2.0 按次固定生成有声视频");
    for (String image : request.normalizedImageUrls()) requireUrl(image, "参考图片需为公网 HTTP(S) 直链");
    if (request.webhookUrl() != null && !request.webhookUrl().isBlank()) requireUrl(request.webhookUrl(), "回调地址需为公网 HTTP(S) 地址");
  }

  private void requireUrl(String value, String message) {
    try {
      URI uri = URI.create(value);
      if (Set.of("http", "https").contains(uri.getScheme()) && uri.getHost() != null && uri.getUserInfo() == null) return;
    } catch (Exception ignored) { }
    throw new ApiException(400, message);
  }

  private String taskEndpoint(ResolvedModelApiKey key, String id) {
    String url = key.taskEndpoint();
    if (url.contains("{task_id}")) return url.replace("{task_id}", id);
    if (url.contains("{id}")) return url.replace("{id}", id);
    return url + (url.contains("?") ? "&" : "?") + "task_id=" + id;
  }

  private JsonNode send(ResolvedModelApiKey key, String endpoint, Object body) throws Exception {
    var request = HttpRequest.newBuilder(URI.create(endpoint)).timeout(Duration.ofSeconds(90))
        .header("Authorization", "Bearer " + key.apiKey()).header("Accept", "application/json");
    if (body == null) request.GET();
    else request.header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)));
    var response = http.send(request.build(), HttpResponse.BodyHandlers.ofString());
    JsonNode root;
    try { root = mapper.readTree(response.body()); }
    catch (Exception error) { throw new ApiException(502, "SD 2.0 按次接口返回了无法解析的响应"); }
    if (root == null) throw new ApiException(502, "SD 2.0 按次接口返回为空");
    int code = root.path("code").asInt(200);
    if (response.statusCode() < 200 || response.statusCode() >= 300 || (code != 0 && code != 200)) {
      String reason = root.path("msg").asText(root.path("error").path("message").asText("上游请求失败"));
      reason = reason.replace(key.apiKey(), "[redacted]").replaceAll("sk-[A-Za-z0-9_-]+", "[redacted]");
      throw new ApiException(response.statusCode() >= 400 && response.statusCode() < 500 ? response.statusCode() : 502,
          "SD 2.0 按次接口请求失败：" + reason);
    }
    return root;
  }

  private void record(VideoGenerationDtos.CreateTaskRequest request, ResolvedModelApiKey key, long started, Exception error) {
    if (logs != null) logs.record("product-video-video".equals(request.featureCode()) ? "product-video-video" : "canvas-video",
        "video_generate", key.provider(), MODEL, key.id(), "dropdown", error == null, null,
        (System.nanoTime() - started) / 1_000_000L, error == null ? null : error.getClass().getSimpleName());
  }
}
