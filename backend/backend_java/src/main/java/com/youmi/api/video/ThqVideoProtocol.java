package com.youmi.api.video;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpRequest;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpOutputMessage;
import org.springframework.http.MediaType;
import org.springframework.http.converter.FormHttpMessageConverter;
import org.springframework.util.LinkedMultiValueMap;

/** Shared endpoints with model-specific JSON and multipart request formats. */
final class ThqVideoProtocol {
  static final long MAX_MULTIPART_IMAGE_BYTES = 30L * 1024 * 1024;
  private ThqVideoProtocol() { }

  record CreateBody(
      String model,
      String prompt,
      String seconds,
      @JsonProperty("aspect_ratio") String ratio,
      String resolution,
      @JsonProperty("generate_audio") @JsonInclude(JsonInclude.Include.NON_NULL) Boolean generateAudio,
      @JsonInclude(JsonInclude.Include.NON_EMPTY) List<Map<String, String>> references,
      @JsonProperty("negative_prompt") @JsonInclude(JsonInclude.Include.NON_EMPTY) String negativePrompt,
      @JsonInclude(JsonInclude.Include.NON_NULL) Long seed) { }

  record ImageFile(String filename, String contentType, byte[] bytes) { }

  static HttpRequest create(ObjectMapper mapper, String baseUrl, String apiKey, int timeoutSeconds,
      String idempotencyKey, CreateBody body) throws Exception {
    return authorized(baseUrl, "/videos", apiKey, timeoutSeconds)
        .header("Content-Type", "application/json")
        .header("Idempotency-Key", idempotencyKey)
        .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))
        .build();
  }

  static HttpRequest createMultipart(String baseUrl, String apiKey, int timeoutSeconds,
      String idempotencyKey, CreateBody body, List<ImageFile> images) throws Exception {
    if (body.references() != null && !body.references().isEmpty())
      throw new ApiException(400, "30 秒视频需使用 images[] 文件上传，不能同时发送 references");
    long bytes = 0;
    for (ImageFile image : images) {
      bytes += image.bytes().length;
      if (bytes > MAX_MULTIPART_IMAGE_BYTES) throw new ApiException(400, "参考图文件合计不能超过 30MB");
    }
    var parts = new LinkedMultiValueMap<String, Object>();
    parts.add("model", body.model());
    parts.add("prompt", body.prompt());
    parts.add("seconds", body.seconds());
    parts.add("aspect_ratio", body.ratio());
    parts.add("resolution", body.resolution());
    if (body.generateAudio() != null) parts.add("generate_audio", String.valueOf(body.generateAudio()));
    if (body.negativePrompt() != null && !body.negativePrompt().isBlank()) parts.add("negative_prompt", body.negativePrompt());
    if (body.seed() != null) parts.add("seed", String.valueOf(body.seed()));
    for (ImageFile image : images) {
      var headers = new HttpHeaders();
      headers.setContentType(MediaType.parseMediaType(image.contentType()));
      var resource = new ByteArrayResource(image.bytes()) {
        @Override public String getFilename() { return image.filename(); }
      };
      parts.add("images[]", new HttpEntity<>(resource, headers));
    }
    var output = new ByteArrayOutputStream();
    var headers = new HttpHeaders();
    var converter = new FormHttpMessageConverter();
    converter.setCharset(StandardCharsets.UTF_8);
    converter.write(parts, MediaType.MULTIPART_FORM_DATA, new HttpOutputMessage() {
      @Override public OutputStream getBody() { return output; }
      @Override public HttpHeaders getHeaders() { return headers; }
    });
    return authorized(baseUrl, "/videos", apiKey, timeoutSeconds)
        .header("Content-Type", headers.getContentType().toString())
        .header("Idempotency-Key", idempotencyKey)
        .POST(HttpRequest.BodyPublishers.ofByteArray(output.toByteArray()))
        .build();
  }

  static HttpRequest query(String baseUrl, String apiKey, int timeoutSeconds, String taskId) {
    String path = "/videos/" + URLEncoder.encode(taskId, StandardCharsets.UTF_8).replace("+", "%20");
    return authorized(baseUrl, path, apiKey, timeoutSeconds).GET().build();
  }

  static HttpRequest.Builder authorized(String baseUrl, String path, String apiKey, int timeoutSeconds) {
    if (apiKey == null || apiKey.isBlank()) throw new ApiException(503, "THQ video API key is not configured");
    String base = baseUrl.trim().replaceAll("/+$", "");
    return HttpRequest.newBuilder(URI.create(base + path))
        .timeout(Duration.ofSeconds(Math.max(30, timeoutSeconds)))
        .header("Authorization", "Bearer " + apiKey)
        .header("Accept", "application/json")
        .header("User-Agent", "Youmi-Canvas/1.0");
  }
}
