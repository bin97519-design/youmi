package com.youmi.api.video;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;

@Service
public class VideoEnhanceClient {
  private final VideoEnhanceProperties config;
  private final ObjectMapper mapper;
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build();
  public VideoEnhanceClient(VideoEnhanceProperties config, ObjectMapper mapper) { this.config = config; this.mapper = mapper; }
  public void requireConfigured() {
    if (!config.configured()) throw new ApiException(503, "视频超分尚未配置密钥或价格，暂不能提交");
  }
  static class Rejected extends ApiException {
    Rejected(String message) { super(502, message); }
  }
  public String create(String url, VideoEnhanceDtos.Settings settings) throws Exception {
    requireConfigured();
    String body = mapper.writeValueAsString(Map.of("model", "video-enhance", "params", settings.params(url)));
    JsonNode json = send("/v1/media/generate", body);
    String id = json.path("data").path("task_id").asText("");
    if (!id.matches("[0-9]+")) throw new ApiException(502, "中转站未返回任务编号，请核对记录，不要重复提交");
    return id;
  }
  public record State(boolean terminal, String state, Integer progress, String stage, String url, String error) { }
  public State poll(String id) throws Exception {
    requireConfigured();
    if (id == null || !id.matches("[0-9]+")) throw new ApiException(400, "无效的超分任务编号");
    JsonNode json = send("/v1/media/status?task_id=" + id, null);
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
  static Integer progress(JsonNode value) {
    try {
      double number = Double.parseDouble(value.asText("").replace("%", "").trim());
      return Double.isFinite(number) && number >= 0 && number <= 100 ? (int) Math.round(number) : null;
    } catch (NumberFormatException error) { return null; }
  }
  private JsonNode send(String path, String body) throws Exception {
    String base = config.getBaseUrl().replaceAll("/+$", "");
    HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(base + path)).timeout(Duration.ofSeconds(120))
        .header("Authorization", "Bearer " + config.getApiKey().trim());
    if (body == null) builder.GET();
    else builder.header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(body));
    var response = http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    // Only explicit rejections are safe to fail. Timeouts/5xx may have accepted the submission.
    if (response.statusCode() >= 400 && response.statusCode() < 500) throw new Rejected("中转站拒绝视频超分请求（HTTP " + response.statusCode() + "）：" + failureMessage(response.body()));
    if (response.statusCode() < 200 || response.statusCode() >= 300) throw new ApiException(502, "中转站响应异常，请核对原任务记录");
    JsonNode json = mapper.readTree(response.body());
    if (json == null) throw new ApiException(502, "中转站返回空响应");
    if (json.has("code") && json.path("code").asInt() != 200) {
      int code = json.path("code").asInt();
      if (code >= 400 && code < 500) throw new Rejected("中转站拒绝视频超分请求：" + failureMessage(response.body()));
      throw new ApiException(502, "中转站提交结果不明确，请核对原任务记录");
    }
    return json;
  }
  private String failureMessage(String body) {
    try {
      JsonNode json = mapper.readTree(body);
      String message = json.path("msg").asText(json.path("message").asText(""));
      if (message.isBlank()) message = json.path("error").isTextual() ? json.path("error").asText()
          : json.path("error").path("message").asText("");
      if (!message.isBlank()) {
        message = message.replace(config.getApiKey().trim(), "[redacted]");
        return message.substring(0, Math.min(message.length(), 600));
      }
    } catch (Exception ignored) { }
    return "请核对密钥、额度和参数";
  }
}
