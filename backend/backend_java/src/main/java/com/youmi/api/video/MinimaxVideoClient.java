package com.youmi.api.video;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
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

@Service
public class MinimaxVideoClient {
  public static final String MODEL = "minimax-h3";
  public static final String PREFIX = "minimax-h3:";
  public static final Set<String> RESOLUTIONS = Set.of("768p", "1080p", "2k", "4k");
  private static final Set<String> RATIOS = Set.of("adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9");
  private final MinimaxVideoProperties properties;
  private final VideoGenerationClient media;
  private final ObjectMapper mapper;
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build();

  public MinimaxVideoClient(MinimaxVideoProperties properties, VideoGenerationClient media, ObjectMapper mapper) {
    this.properties = properties;
    this.media = media;
    this.mapper = mapper;
  }

  public int price(VideoGenerationDtos.CreateTaskRequest request) {
    validate(request);
    int rate = properties.rate(resolution(request));
    if (!properties.hasKey() || rate == 0)
      throw new ApiException(503, "MiniMax H3 所选画质尚未配置密钥和每秒米值单价");
    return Math.multiplyExact(rate, request.durationSeconds());
  }

  public static boolean supportsModel(String model) {
    return MODEL.equals(model);
  }

  public VideoGenerationDtos.CreateTaskResponse createTask(VideoGenerationDtos.CreateTaskRequest request) throws Exception {
    price(request);
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

  private void validate(VideoGenerationDtos.CreateTaskRequest request) {
    if (request == null || !supportsModel(request.model())) throw new ApiException(400, "MiniMax H3 模型编号无效");
    if (request.prompt() == null || request.prompt().isBlank()) throw new ApiException(400, "视频提示词不能为空");
    if (request.durationSeconds() == null || request.durationSeconds() < 4 || request.durationSeconds() > 15)
      throw new ApiException(400, "MiniMax H3 时长必须为 4 至 15 的整数秒");
    if (!RESOLUTIONS.contains(resolution(request)))
      throw new ApiException(400, "MiniMax H3 画质仅支持 768P、1080P、2K 或 4K");
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
    var request = HttpRequest.newBuilder(URI.create(properties.normalizedBaseUrl() + path))
        .timeout(Duration.ofSeconds(Math.max(5, properties.getTimeoutSeconds())))
        .header("Authorization", "Bearer " + properties.getApiKey().trim()).header("Accept", "application/json");
    if (body != null) request.header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)));
    else request.GET();
    var response = http.send(request.build(), HttpResponse.BodyHandlers.ofString());
    JsonNode root;
    try { root = mapper.readTree(response.body()); }
    catch (Exception error) { throw new ApiException(502, "MiniMax H3 返回无法解析的响应（HTTP " + response.statusCode() + "）", error); }
    if (root == null || !root.isObject()) throw new ApiException(502, "MiniMax H3 返回空响应");
    if (response.statusCode() < 200 || response.statusCode() >= 300
        || (root.has("code") && root.path("code").asInt(-1) != 200)) {
      int status = response.statusCode() >= 400 && response.statusCode() < 500 ? response.statusCode() : 502;
      throw new ApiException(status, "MiniMax H3 接口请求失败（HTTP " + response.statusCode() + "）："
          + first(text(root, "msg"), text(root, "error"), text(root.path("error"), "message"), "上游服务拒绝请求"));
    }
    return root;
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
