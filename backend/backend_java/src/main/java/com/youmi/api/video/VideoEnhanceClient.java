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
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.util.UriComponentsBuilder;

@Service
public class VideoEnhanceClient {
  private final VideoEnhanceProperties config;
  private final ObjectMapper mapper;
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build();
  private AiCallLogService aiCallLogService;
  private ModelApiKeyService modelApiKeys;

  public VideoEnhanceClient(VideoEnhanceProperties config, ObjectMapper mapper) {
    this.config = config;
    this.mapper = mapper;
  }

  @Autowired(required = false)
  void setAiCallLogService(AiCallLogService service) { this.aiCallLogService = service; }

  @Autowired(required = false)
  void setModelApiKeys(ModelApiKeyService service) { this.modelApiKeys = service; }

  public void requireConfigured() {
    if (!config.priceConfigured()) throw new ApiException(503, "视频超分价格尚未配置，暂不能提交");
    route(null);
  }
  public boolean isConfigured() {
    try { requireConfigured(); return true; }
    catch (RuntimeException error) { return false; }
  }

  static class Rejected extends ApiException {
    Rejected(String message) { super(502, message); }
  }

  public record Submission(String taskId, Long credentialId) { }

  public String create(String url, VideoEnhanceDtos.Settings settings) throws Exception {
    return createSubmission(url, settings).taskId();
  }

  public Submission createSubmission(String url, VideoEnhanceDtos.Settings settings) throws Exception {
    requireConfigured();
    Route route = route(null);
    String body = mapper.writeValueAsString(Map.of("model", route.model(), "params", settings.params(url)));
    JsonNode json = send(route, route.generationPath(), body);
    String id = json.path("data").path("task_id").asText("");
    if (!id.matches("[0-9]+")) throw new ApiException(502, "中转站未返回任务编号，请核对记录，不要重复提交");
    return new Submission(id, route.credentialId());
  }

  public record State(boolean terminal, String state, Integer progress, String stage, String url, String error) { }

  public State poll(String id) throws Exception { return poll(id, null); }

  public State poll(String id, Long credentialId) throws Exception {
    if (id == null || !id.matches("[0-9]+")) throw new ApiException(400, "无效的超分任务编号");
    Route route = route(credentialId);
    String path = taskPath(route.taskPath(), id);
    JsonNode json = send(route, path, null);
    if (json.has("data") && json.path("data").isObject()) json = json.path("data");
    String state = json.path("state").asText("");
    boolean terminal = json.path("is_final").isBoolean() && json.path("is_final").booleanValue();
    if (!Set.of("pending", "running", "success", "failed").contains(state)
        || terminal && !Set.of("success", "failed").contains(state)) throw new ApiException(502, "中转站状态暂不完整，将继续查询原任务");
    String url = json.path("result_url").asText("");
    if (terminal && "success".equals(state) && !url.matches("https?://.+")) throw new ApiException(502, "中转站尚未返回结果地址");
    String error = json.path("error").isObject() ? json.path("error").path("message").asText("") : json.path("error").asText("");
    return new State(terminal, state, progress(json.path("progress")), json.path("status").asText("处理中"), url, error);
  }

  static String taskPath(String endpoint, String id) {
    if (endpoint.contains("{task_id}") || endpoint.contains("{id}"))
      return endpoint.replace("{task_id}", id).replace("{id}", id);
    return UriComponentsBuilder.fromUriString(endpoint).replaceQueryParam("task_id", id)
        .build(true).toUriString();
  }

  static Integer progress(JsonNode value) {
    try {
      double number = Double.parseDouble(value.asText("").replace("%", "").trim());
      return Double.isFinite(number) && number >= 0 && number <= 100 ? (int) Math.round(number) : null;
    } catch (NumberFormatException error) { return null; }
  }

  private record Route(Long credentialId, String model, String baseUrl, String generationPath,
      String taskPath, String apiKey, String provider) { }

  private Route route(Long pinnedId) {
    if (pinnedId != null && pinnedId == 0L) return legacyRoute();
    if (modelApiKeys != null) {
      if (pinnedId != null) return from(modelApiKeys.resolveById(pinnedId, ModelApiKeyService.MODEL_TYPE_VIDEO_ENHANCEMENT));
      var selected = modelApiKeys.preferredEnabledModel(ModelApiKeyService.MODEL_TYPE_VIDEO_ENHANCEMENT, "video-enhancement");
      if (selected.isPresent()) return from(selected.get());
      if (modelApiKeys.isFeatureMappingConfigured("video-enhancement")) {
        throw new ApiException(503, "视频超分未指定可用的默认超分密钥，请到 AI 功能映射中配置");
      }
    } else if (pinnedId != null) {
      throw new ApiException(503, "视频超分密钥服务暂不可用，无法继续查询原任务");
    }
    return legacyRoute();
  }

  private Route legacyRoute() {
    if (!config.legacyKeyConfigured()) throw new ApiException(503, "视频超分尚未配置密钥，请在模型密钥或 application.yml 中配置");
    return new Route(null, "video-enhance", config.getBaseUrl(), "/v1/media/generate", "/v1/media/status",
        config.getApiKey().trim(), "lk888");
  }

  private Route from(ResolvedModelApiKey key) {
    return new Route(key.id(), key.model(), key.baseUrl(), key.generationPath(), key.taskPath(), key.apiKey(), key.provider());
  }

  private JsonNode send(Route route, String path, String body) throws Exception {
    String base = route.baseUrl().replaceAll("/+$", "");
    HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(base + path)).timeout(Duration.ofSeconds(120))
        .header("Authorization", "Bearer " + route.apiKey().trim());
    if (body == null) builder.GET();
    else builder.header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(body));
    long started = System.nanoTime();
    HttpResponse<String> response;
    try {
      response = http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    } catch (Exception error) {
      recordCall(route, path, false, null, started, error);
      throw error;
    }
    recordCall(route, path, response.statusCode() >= 200 && response.statusCode() < 300,
        response.statusCode(), started, null);
    // Only explicit rejections are safe to fail. Timeouts/5xx may have accepted the submission.
    if (response.statusCode() >= 400 && response.statusCode() < 500) {
      throw new Rejected("中转站拒绝视频超分请求（HTTP " + response.statusCode() + "）：" + failureMessage(response.body(), route.apiKey()));
    }
    if (response.statusCode() < 200 || response.statusCode() >= 300) throw new ApiException(502, "中转站响应异常，请核对原任务记录");
    JsonNode json = mapper.readTree(response.body());
    if (json == null) throw new ApiException(502, "中转站返回空响应");
    if (json.has("code") && json.path("code").asInt() != 200) {
      int code = json.path("code").asInt();
      if (code >= 400 && code < 500) throw new Rejected("中转站拒绝视频超分请求：" + failureMessage(response.body(), route.apiKey()));
      throw new ApiException(502, "中转站提交结果不明确，请核对原任务记录");
    }
    return json;
  }

  private void recordCall(Route route, String path, boolean success, Integer status, long started, Exception error) {
    if (aiCallLogService != null) aiCallLogService.record("video-enhance", path.contains("status") ? "video_query" : "video_enhance",
        route.provider(), route.model(), route.credentialId(), success, status,
        (System.nanoTime() - started) / 1_000_000L,
        error == null ? null : error.getClass().getSimpleName());
  }

  private String failureMessage(String body, String apiKey) {
    try {
      JsonNode json = mapper.readTree(body);
      String message = json.path("msg").asText(json.path("message").asText(""));
      if (message.isBlank()) message = json.path("error").isTextual() ? json.path("error").asText()
          : json.path("error").path("message").asText("");
      if (!message.isBlank()) {
        if (apiKey != null && !apiKey.isBlank()) message = message.replace(apiKey.trim(), "[redacted]");
        return message.substring(0, Math.min(message.length(), 600));
      }
    } catch (Exception ignored) { }
    return "请核对密钥、额度和参数";
  }
}
