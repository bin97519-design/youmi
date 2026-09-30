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
import java.util.List;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;

/** Separate credentials and video-task transport for THQ's 30-second model. */
@Service
public class ChatVideoClient {
  public static final String MODEL = "ya-sd25-30s";
  private static final Pattern URL = Pattern.compile("https?://[^\\s<>\"'`]+");
  private final ObjectMapper mapper;
  private final VideoGenerationProperties config;
  private final VideoGenerationClient media;
  private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(ChatVideoClient.class);
  private final HttpClient http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1)
      .connectTimeout(Duration.ofSeconds(15)).build();

  public ChatVideoClient(ObjectMapper mapper, VideoGenerationProperties config, VideoGenerationClient media) {
    this.mapper = mapper;
    this.config = config;
    this.media = media;
  }

  void validate(VideoGenerationDtos.CreateTaskRequest input) {
    if (input == null || !MODEL.equals(input.model()) || input.durationSeconds() == null
        || input.durationSeconds() != 30 || !"720p".equals(input.resolution()))
      throw new ApiException(400, "ya-sd25-30s 需使用 30 秒、720p");
    if (input.prompt() == null || input.prompt().isBlank() || input.prompt().length() > 2500)
      throw new ApiException(400, "请填写 2500 字以内的视频提示词");
    VideoCompositionService.dimensions(input.ratio());
    if (input.lastFrameUrl() != null && !input.lastFrameUrl().isBlank())
      throw new ApiException(400, "30 秒模型尚未确认尾帧参数，暂不支持指定尾帧");
    if (input.seed() != null || input.webhookUrl() != null || input.negativePrompt() != null && !input.negativePrompt().isBlank())
      throw new ApiException(400, "30 秒模型暂不支持种子、回调或独立负面提示词");
    var images = references(input);
    if (images.size() > 6 || images.stream().anyMatch(url -> !validReferenceUrl(url) || url.length() > 4096))
      throw new ApiException(400, "请使用最多 6 张已上传的 HTTPS 参考图，链接不能包含账号密码");
    if (input.clientTaskId() == null || !input.clientTaskId().matches("[A-Za-z0-9._:-]{1,128}"))
      throw new ApiException(400, "30 秒生成请求缺少有效的任务编号");
  }

  void checkAccess() throws Exception {
    var response = http.send(authorized("/models", 30).GET().build(), HttpResponse.BodyHandlers.ofString());
    var root = jsonResponse(response, "模型权限查询", 503);
    for (JsonNode model : root.path("data")) if (MODEL.equals(model.path("id").asText())) return;
    throw new ApiException(503, "当前视频 Key 无 ya-sd25-30s 权限，请在中转站开通 sd2.5-30s-720p 分组，或配置 THQ_CHAT_VIDEO_API_KEY");
  }

  String generate(VideoGenerationDtos.CreateTaskRequest input) throws Exception {
    validate(input);
    var images = new ArrayList<ThqVideoProtocol.ImageFile>();
    long imageBytes = 0;
    for (String image : references(input)) {
      var asset = media.downloadReference(image);
      imageBytes += asset.bytes().length;
      if (imageBytes > ThqVideoProtocol.MAX_MULTIPART_IMAGE_BYTES)
        throw new ApiException(400, "参考图文件合计不能超过 30MB");
      String extension = switch (asset.contentType()) {
        case "image/png" -> ".png";
        case "image/jpeg" -> ".jpg";
        case "image/webp" -> ".webp";
        default -> throw new ApiException(400, "参考图必须为 PNG、JPEG 或 WebP 文件");
      };
      images.add(new ThqVideoProtocol.ImageFile("reference-" + (images.size() + 1) + extension, asset.contentType(), asset.bytes()));
    }
    // This model rejects generate_audio even when false; omit it for old requests too.
    var body = new ThqVideoProtocol.CreateBody(MODEL, input.prompt(), String.valueOf(input.durationSeconds()),
        input.ratio(), input.resolution(), null, List.of(), null, null);
    var request = ThqVideoProtocol.createMultipart(config.getChatBaseUrl(), config.getChatApiKey(),
        config.getChatTimeoutSeconds(), input.clientTaskId(), body, images);
    log.info("THQ chat video submit: task={}, endpoint={}, model={}, references={}, bytes={}",
        input.clientTaskId(), safeEndpoint(request.uri()), MODEL, references(input).size(),
        request.bodyPublisher().orElseThrow().contentLength());
    var response = http.send(request, HttpResponse.BodyHandlers.ofString());
    log.info("THQ chat video response: task={}, status={}, requestId={}",
        input.clientTaskId(), response.statusCode(), requestId(response));
    if (response.statusCode() < 200 || response.statusCode() >= 300) jsonResponse(response, "提交视频", 502);
    return response.body();
  }

  String poll(String taskId) throws Exception {
    if (taskId == null || !taskId.matches("[A-Za-z0-9._:-]{1,256}"))
      throw new ApiException(502, "中转站返回的视频任务编号无效");
    var request = ThqVideoProtocol.query(config.getChatBaseUrl(), config.getChatApiKey(), 60, taskId);
    var response = http.send(request, HttpResponse.BodyHandlers.ofString());
    if (response.statusCode() < 200 || response.statusCode() >= 300) jsonResponse(response, "查询视频", 502);
    var root = mapper.readTree(response.body());
    // Save terminal failure responses before interpreting them in the job runner.
    if (root != null && root.isObject() && root.path("id").asText("").isBlank()
        && root.path("task_id").asText("").isBlank() && root.path("data").path("id").asText("").isBlank()
        && root.path("data").path("task_id").asText("").isBlank())
      ((com.fasterxml.jackson.databind.node.ObjectNode) root).put("id", taskId);
    return mapper.writeValueAsString(root);
  }

  record TaskState(String id, String status, Integer progress) {
    boolean pending() { return "queued".equals(status) || "processing".equals(status); }
  }

  String persistVideo(String taskId, String id, String url, Long userId) throws Exception {
    return media.persistVideo(taskId, id, userId, () -> download(url));
  }

  HttpResponse<java.io.InputStream> download(String url) throws Exception {
    URI endpoint = authorized("/videos/", 60).build().uri();
    URI uri = URI.create(url);
    for (int redirects = 0; redirects <= 4; redirects++) {
      if (!validUrl(uri.toString())) throw new ApiException(502, "中转站返回的视频下载地址无效");
      var request = HttpRequest.newBuilder(uri)
          .timeout(Duration.ofSeconds(Math.max(120, config.getDownloadTimeoutSeconds())))
          .header("Accept", "video/*,application/octet-stream").GET();
      // Only the provider's video endpoint receives its key, never a redirected asset host.
      if (endpoint.getScheme().equalsIgnoreCase(uri.getScheme()) && endpoint.getRawAuthority().equalsIgnoreCase(uri.getRawAuthority())
          && uri.normalize().getPath().startsWith(endpoint.getPath()))
        request.header("Authorization", "Bearer " + config.getChatApiKey());
      var response = http.send(request.build(), HttpResponse.BodyHandlers.ofInputStream());
      if (List.of(301, 302, 303, 307, 308).contains(response.statusCode())) {
        response.body().close();
        String location = response.headers().firstValue("Location").orElse("");
        if (location.isBlank()) throw new java.io.IOException("Video download redirect is missing Location");
        URI next = uri.resolve(location);
        if ("https".equalsIgnoreCase(uri.getScheme()) && !"https".equalsIgnoreCase(next.getScheme()))
          throw new ApiException(502, "视频下载地址不允许降级为非 HTTPS");
        uri = next;
        continue;
      }
      String type = response.headers().firstValue("Content-Type").orElse("").toLowerCase(java.util.Locale.ROOT);
      if (response.statusCode() < 200 || response.statusCode() >= 300 || !(type.startsWith("video/") || type.startsWith("application/octet-stream"))) {
        response.body().close();
        throw new java.io.IOException("Video download is not ready: HTTP " + response.statusCode());
      }
      return response;
    }
    throw new java.io.IOException("Too many video download redirects");
  }

  TaskState taskState(String response) throws Exception {
    // Previously saved Chat Completions results must still be readable after this migration.
    if (response.stripLeading().startsWith("data:")) return new TaskState("", "completed", 100);
    JsonNode root = mapper.readTree(response);
    requireSuccess(root);
    JsonNode task = root.path("data").isObject() ? root.path("data") : root;
    String id = task.path("id").asText(task.path("task_id").asText(""));
    if (id.isBlank()) id = root.path("id").asText(root.path("task_id").asText(""));
    String status = task.path("status").asText(root.path("status").asText("")).trim().toLowerCase(java.util.Locale.ROOT);
    status = switch (status) {
      case "queued", "pending", "submitted", "waiting" -> "queued";
      case "running", "processing", "in_progress" -> "processing";
      case "success", "succeeded", "completed", "done", "finished", "ready" -> "completed";
      case "" -> !structuredUrl(root).isBlank() || root.has("choices") || id.isBlank() ? "completed" : "queued";
      default -> throw new ApiException(502, "中转站返回未知视频状态，请核对任务记录，勿重复提交");
    };
    String progress = task.path("progress").asText(root.path("progress").asText(""));
    Integer value = "completed".equals(status) ? 100 : null;
    try {
      int parsed = Integer.parseInt(progress.replace("%", "").trim());
      if (parsed >= 0 && parsed <= 100) value = parsed;
    } catch (NumberFormatException ignored) { }
    return new TaskState(id, status, value);
  }

  String resultUrl(String response) throws Exception {
    if (response == null || response.isBlank()) throw new ApiException(502, "30 秒视频接口返回为空");
    if (response.stripLeading().startsWith("data:")) {
      StringBuilder text = new StringBuilder();
      for (String line : response.split("\\R")) {
        if (!line.startsWith("data:")) continue;
        String data = line.substring(5).trim();
        if (data.isBlank() || "[DONE]".equals(data)) continue;
        JsonNode event = mapper.readTree(data);
        requireSuccess(event);
        text.append(event.path("choices").path(0).path("delta").path("content").asText(""));
      }
      return textUrl(text.toString());
    }
    JsonNode root = mapper.readTree(response);
    requireSuccess(root);
    String direct = structuredUrl(root);
    if (!direct.isBlank()) return direct;
    JsonNode message = root.path("choices").path(0).path("message");
    direct = structuredUrl(message);
    if (!direct.isBlank()) return direct;
    JsonNode content = message.path("content");
    if (content.isArray()) {
      for (JsonNode part : content) {
        direct = structuredUrl(part);
        if (!direct.isBlank()) return direct;
      }
      StringBuilder text = new StringBuilder();
      for (JsonNode part : content) text.append(part.path("text").asText(""));
      return textUrl(text.toString());
    }
    return textUrl(content.asText(""));
  }

  private String structuredUrl(JsonNode node) {
    for (String key : List.of("video_url", "download_url")) {
      JsonNode value = node.path(key);
      String url = value.isTextual() ? value.asText() : value.path("url").asText("");
      if (url.startsWith("/")) url = authorized("/videos", 60).build().uri().resolve(url).toString();
      if (validUrl(url)) return url;
    }
    JsonNode data = node.path("data");
    return data.isObject() ? structuredUrl(data) : "";
  }

  private String textUrl(String text) throws Exception {
    String clean = text.trim();
    if (validUrl(clean) && !clean.contains(" ")) return clean;
    if (clean.startsWith("{") || clean.startsWith("```json")) {
      try {
        String url = structuredUrl(mapper.readTree(clean.replaceFirst("^```json\\s*", "").replaceFirst("\\s*```$", "")));
        if (!url.isBlank()) return url;
      } catch (com.fasterxml.jackson.core.JsonProcessingException ignored) { }
    }
    var matches = URL.matcher(clean);
    while (matches.find()) {
      String url = matches.group().replaceAll("[)\\],.;]+$", "").replace("&amp;", "&");
      if (validUrl(url) && URI.create(url).getPath().toLowerCase(java.util.Locale.ROOT).matches(".*\\.(mp4|webm|mov)$")) return url;
    }
    throw new ApiException(502, "30 秒模型未返回可识别的视频地址，原始响应已保留；请核对中转站结果，勿重复提交");
  }

  private boolean validUrl(String value) {
    try {
      URI uri = URI.create(value);
      return List.of("https", "http").contains(uri.getScheme()) && uri.getHost() != null && uri.getUserInfo() == null;
    } catch (Exception ignored) { return false; }
  }

  private List<String> references(VideoGenerationDtos.CreateTaskRequest input) {
    var urls = new ArrayList<String>();
    if (!input.normalizedFirstFrameUrl().isBlank()) urls.add(input.normalizedFirstFrameUrl());
    for (String url : input.normalizedImageUrls()) if (!urls.contains(url)) urls.add(url);
    return urls;
  }

  private boolean validReferenceUrl(String value) {
    try {
      URI uri = URI.create(value);
      return validUrl(value) && "https".equalsIgnoreCase(uri.getScheme()) && uri.getFragment() == null;
    } catch (Exception ignored) { return false; }
  }

  private HttpRequest.Builder authorized(String path, int seconds) {
    String key = config.getChatApiKey();
    if (key == null || key.isBlank()) throw new ApiException(503, "请配置 THQ_CHAT_VIDEO_API_KEY 或 THQ_VIDEO_API_KEY");
    return ThqVideoProtocol.authorized(config.getChatBaseUrl(), path, key, seconds);
  }

  record ProviderFailure(String phase, String method, String endpoint, int httpStatus, String requestId, String contentType) {}

  static class ProviderException extends ApiException {
    private final ProviderFailure details;
    private final String responseBody;
    ProviderException(int code, String message, ProviderFailure details, String responseBody) {
      super(code, message);
      this.details = details;
      this.responseBody = responseBody;
    }
    ProviderFailure details() { return details; }
    String responseBody() { return responseBody; }
  }

  private JsonNode jsonResponse(HttpResponse<String> response, String phase, int apiCode) throws Exception {
    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      String body = redact(response.body());
      String summary = "";
      try {
        JsonNode error = mapper.readTree(body);
        summary = providerErrorSummary(error);
      } catch (Exception ignored) { }
      if (summary.isBlank()) summary = body.stripLeading().startsWith("<")
          ? "中转站返回 HTML 错误页面" : body.isBlank() ? "中转站未返回错误正文" : body;
      summary = redact(summary).replaceAll("\\s+", " ").trim();
      if (summary.length() > 300) summary = summary.substring(0, 300) + "...";
      var details = new ProviderFailure(phase, response.request().method(), safeEndpoint(response.request().uri()),
          response.statusCode(), requestId(response), response.headers().firstValue("content-type").orElse(""));
      String message = "THQ 30 秒视频" + phase + "失败（HTTP " + response.statusCode() + "，"
          + details.method() + " " + response.request().uri().getPath() + "）：" + summary
          + (details.requestId().isBlank() ? "" : "；请求编号：" + details.requestId());
      throw new ProviderException(apiCode, message, details, body.length() > 65536 ? body.substring(0, 65536) : body);
    }
    JsonNode root = mapper.readTree(response.body());
    requireSuccess(root);
    return root;
  }

  private String providerErrorSummary(JsonNode error) {
    String summary = "";
    String code = "";
    for (int depth = 0; error != null && depth < 5; depth++) {
      String nextCode = error.path("error").path("code").asText(error.path("code").asText(""));
      if (!nextCode.isBlank()) code = nextCode;
      String message = "";
      for (JsonNode value : List.of(error.path("error").path("message"), error.path("message"), error.path("detail"), error.path("error"))) {
        if (value.isTextual() && !value.asText().isBlank()) { message = value.asText(); break; }
      }
      if (message.isBlank()) break;
      summary = message;
      if (!message.stripLeading().startsWith("{") || message.length() > 65536) break;
      try { error = mapper.readTree(message); }
      catch (Exception ignored) { break; }
    }
    return summary.isBlank() ? code : summary + (code.isBlank() || summary.contains(code) ? "" : " (" + code + ")");
  }

  private String safeEndpoint(URI uri) {
    return uri.getScheme() + "://" + uri.getHost() + (uri.getPort() < 0 ? "" : ":" + uri.getPort()) + uri.getPath();
  }

  private String requestId(HttpResponse<String> response) {
    for (String header : List.of("x-request-id", "x-oneapi-request-id", "x-new-api-request-id")) {
      String value = redact(response.headers().firstValue(header).orElse(""));
      if (value.matches("[A-Za-z0-9_.:-]{1,160}")) return value;
    }
    var match = Pattern.compile("(?i)request[ _-]?id[\\s:\\x22=]+([A-Za-z0-9_.:-]{1,160})").matcher(redact(response.body()));
    return match.find() ? match.group(1) : "";
  }

  private String redact(String value) {
    String safe = value == null ? "" : value;
    for (String key : new String[]{config.getChatApiKey(), config.getApiKey()})
      if (key != null && !key.isBlank()) safe = safe.replace(key, "[redacted]");
    return safe.replaceAll("sk-[A-Za-z0-9_-]+", "[redacted]")
        .replaceAll("(?i)Bearer\\s+[^\\s\\\"\\\\]+", "Bearer [redacted]")
        .replaceAll("(?i)(\\\"(?:api[_-]?key|authorization|access_token|token)\\\"\\s*:\\s*\\\")[^\\\"]*", "$1[redacted]")
        .replaceAll("data:image/[^;\\s]+;base64,[A-Za-z0-9+/=]+", "[image data redacted]");
  }

  private void requireSuccess(JsonNode root) {
    if (root == null) throw new ApiException(502, "THQ 30 秒视频接口返回为空");
    for (JsonNode node : List.of(root, root.path("data"))) {
      String status = node.path("status").asText("").trim();
      String code = node.path("code").asText("").trim();
      if (node.hasNonNull("error") || node.path("success").isBoolean() && !node.path("success").asBoolean()
          || status.matches("(?i)failure|failed|error|cancelled|canceled|expired|aborted|timeout")
          || code.matches("(?i).*(fail|error|invalid|denied|expired|cancel|insufficient|not_found).*$")) {
        String reason = node.path("error").path("message").asText(node.path("message").asText(
            node.path("error_message").asText(node.path("error").asText(code.isBlank() ? status : code))));
        reason = redact(reason).replaceAll("\\s+", " ").trim();
        if (reason.length() > 500) reason = reason.substring(0, 500);
        throw new ApiException(502, "THQ 30 秒视频生成失败：" + (reason.isBlank() ? "请核对中转站生成记录" : reason));
      }
    }
  }
}
