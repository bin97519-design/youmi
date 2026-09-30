package com.youmi.api.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import com.youmi.api.ai.GemAgentImagePreparer.ImageData;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class GemAgentClient {
  public static final String MODEL = "gem-3.8-flash";
  public static final int MAX_OUTPUT_TOKENS = 16000;
  private static final int MAX_IMAGE_BYTES = 20 * 1024 * 1024;
  private static final int MAX_INLINE_IMAGE_BYTES = 8 * 1024 * 1024;
  private static final int MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024;
  private static final Set<String> IMAGE_TYPES = Set.of(
      "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif");
  private final ObjectMapper mapper;
  private final GemAgentProperties properties;
  private final GemAgentImagePreparer imagePreparer;
  private final HttpClient http = HttpClient.newBuilder()
      .connectTimeout(Duration.ofSeconds(15)).build();

  public GemAgentClient(ObjectMapper mapper, GemAgentProperties properties) {
    this(mapper, properties, new GemAgentImagePreparer(mapper, "ffmpeg", "ffprobe"));
  }

  @Autowired
  public GemAgentClient(ObjectMapper mapper, GemAgentProperties properties, GemAgentImagePreparer imagePreparer) {
    this.mapper = mapper;
    this.properties = properties;
    this.imagePreparer = imagePreparer;
  }

  public boolean isConfigured() { return properties.isConfigured(); }

  public static final class OutputLimitException extends ApiException {
    public OutputLimitException() {
      super(502, "GEM 本次回复达到输出长度上限，内容未完整返回，请重试");
    }
  }

  public AiChatDtos.CompletionResult complete(
      String systemPrompt, String userPrompt, List<String> imageUrls,
      double temperature, boolean jsonResponse) throws Exception {
    return complete(systemPrompt, userPrompt, imageUrls, temperature, jsonResponse, null, null);
  }

  public AiChatDtos.CompletionResult complete(
      String systemPrompt, String userPrompt, List<String> imageUrls,
      double temperature, boolean jsonResponse, Integer maxTokens, Duration timeout) throws Exception {
    if (!isConfigured()) throw new ApiException(503, "GEM 3.8 flash 尚未配置专用密钥");
    List<Map<String, Object>> parts = new ArrayList<>();
    parts.add(Map.of("text", userPrompt == null ? "" : userPrompt));
    List<String> images = imageUrls == null ? List.of() : imageUrls.stream()
        .filter(value -> value != null && !value.isBlank()).map(String::trim).distinct().toList();
    if (images.size() > 8) throw new ApiException(400, "Agent 最多支持 8 张参考图");
    int imageBudget = Math.min(MAX_INLINE_IMAGE_BYTES, MAX_TOTAL_IMAGE_BYTES / Math.max(1, images.size()));
    List<ImageData> preparedImages = new ArrayList<>();
    int total = 0;
    for (String url : images) {
      ImageData image = readImage(url);
      if (image.bytes().length > MAX_INLINE_IMAGE_BYTES) image = imagePreparer.prepare(image, imageBudget);
      total += image.bytes().length;
      preparedImages.add(image);
    }
    // Keep existing small references byte-for-byte; only reduce the largest images when needed.
    while (total > MAX_TOTAL_IMAGE_BYTES) {
      int largest = 0;
      for (int index = 1; index < preparedImages.size(); index++) {
        if (preparedImages.get(index).bytes().length > preparedImages.get(largest).bytes().length) largest = index;
      }
      ImageData original = preparedImages.get(largest);
      ImageData compressed = imagePreparer.prepare(original, imageBudget);
      total -= original.bytes().length - compressed.bytes().length;
      preparedImages.set(largest, compressed);
    }
    for (ImageData image : preparedImages) {
      parts.add(Map.of("inlineData", Map.of(
          "mimeType", image.mimeType(), "data", Base64.getEncoder().encodeToString(image.bytes()))));
    }
    Map<String, Object> config = new LinkedHashMap<>();
    config.put("temperature", temperature);
    config.put("maxOutputTokens", Math.max(200, Math.min(MAX_OUTPUT_TOKENS,
        maxTokens == null ? properties.getMaxTokens() : maxTokens)));
    if (jsonResponse) config.put("responseMimeType", "application/json");
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("contents", List.of(Map.of("role", "user", "parts", parts)));
    if (systemPrompt != null && !systemPrompt.isBlank()) {
      body.put("systemInstruction", Map.of("parts", List.of(Map.of("text", systemPrompt))));
    }
    body.put("generationConfig", config);
    String base = properties.getBaseUrl().replaceAll("/+$", "");
    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(base + "/v1beta/models/" + MODEL + ":generateContent"))
        .timeout(timeout == null ? Duration.ofSeconds(Math.max(8, properties.getTimeoutSeconds())) : timeout)
        .header("x-goog-api-key", properties.getApiKey())
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))
        .build();
    // Do not retry generation automatically: a lost response may still be billable upstream.
    HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    JsonNode root;
    try { root = mapper.readTree(response.body()); }
    catch (Exception error) { throw new ApiException(502, "GEM 接口返回格式异常（HTTP " + response.statusCode() + "）"); }
    if (root == null || !root.isObject()) throw new ApiException(502, "GEM 接口未返回有效响应（HTTP " + response.statusCode() + "）");
    if (response.statusCode() < 200 || response.statusCode() >= 300 || root.hasNonNull("error")) {
      String detail = root.path("error").path("message").asText("请检查模型权限和中转站记录");
      detail = detail.replace(properties.getApiKey(), "[redacted]")
          .replaceAll("sk-[A-Za-z0-9_-]+", "[redacted]").replaceAll("\\s+", " ");
      throw new ApiException(502, "GEM 接口请求失败（HTTP " + response.statusCode() + "）："
          + detail.substring(0, Math.min(400, detail.length())));
    }
    String blocked = root.path("promptFeedback").path("blockReason").asText("");
    if (!blocked.isBlank()) throw new ApiException(502, "GEM 未返回内容：" + blocked);
    JsonNode candidate = root.path("candidates").path(0);
    String finish = candidate.path("finishReason").asText("");
    if ("MAX_TOKENS".equals(finish)) throw new OutputLimitException();
    if (!finish.isBlank() && !"STOP".equals(finish)) throw new ApiException(502, "GEM 未正常完成回复：" + finish);
    StringBuilder text = new StringBuilder();
    for (JsonNode part : candidate.path("content").path("parts")) {
      if (!part.path("thought").asBoolean(false) && part.path("text").isTextual()) {
        text.append(part.path("text").asText());
      }
    }
    if (text.toString().isBlank()) throw new ApiException(502, "GEM 返回内容为空，请检查中转站记录");
    return new AiChatDtos.CompletionResult("lk888", MODEL, text.toString().trim());
  }

  private ImageData readImage(String value) throws Exception {
    if (value.startsWith("data:")) {
      int comma = value.indexOf(',');
      if (comma < 0 || comma > 80 || !value.substring(0, comma).endsWith(";base64")
          || value.length() - comma - 1 > (MAX_IMAGE_BYTES + 2) / 3 * 4) {
        throw new ApiException(400, "参考图格式不正确或超过 20MB");
      }
      String mime = value.substring(5, comma - 7).toLowerCase(Locale.ROOT);
      requireImageType(mime);
      byte[] bytes;
      try { bytes = Base64.getDecoder().decode(value.substring(comma + 1)); }
      catch (IllegalArgumentException error) { throw new ApiException(400, "参考图编码不正确"); }
      if (bytes.length == 0 || bytes.length > MAX_IMAGE_BYTES) throw new ApiException(400, "参考图为空或超过 20MB");
      return new ImageData(mime, bytes);
    }
    URI uri = URI.create(value);
    for (int redirects = 0; redirects < 4; redirects++) {
      requirePublicImageUrl(uri);
      HttpURLConnection connection = (HttpURLConnection) uri.toURL().openConnection();
      connection.setInstanceFollowRedirects(false);
      connection.setConnectTimeout(10000);
      connection.setReadTimeout(10000);
      try {
        int status = connection.getResponseCode();
        if (status >= 300 && status < 400) {
          String location = connection.getHeaderField("Location");
          if (location == null) throw new ApiException(400, "参考图地址重定向异常");
          uri = uri.resolve(location);
          continue;
        }
        if (status != 200) throw new ApiException(400, "无法读取参考图（HTTP " + status + "）");
        String mime = String.valueOf(connection.getContentType()).split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        requireImageType(mime);
        if (connection.getContentLengthLong() > MAX_IMAGE_BYTES) throw new ApiException(400, "参考图超过 20MB");
        try (var input = connection.getInputStream()) {
          return new ImageData(mime, readImageBytes(input));
        }
      } finally { connection.disconnect(); }
    }
    throw new ApiException(400, "参考图重定向过多");
  }

  static byte[] readImageBytes(InputStream input) throws Exception {
    try (var output = new ByteArrayOutputStream()) {
      byte[] buffer = new byte[8192];
      long deadline = System.nanoTime() + Duration.ofSeconds(30).toNanos();
      for (int count; (count = input.read(buffer)) != -1;) {
        if (output.size() + count > MAX_IMAGE_BYTES) throw new ApiException(400, "参考图超过 20MB");
        if (System.nanoTime() > deadline) throw new ApiException(400, "参考图下载超时，请重试");
        output.write(buffer, 0, count);
      }
      if (output.size() == 0) throw new ApiException(400, "参考图为空");
      return output.toByteArray();
    }
  }

  private static void requireImageType(String mime) {
    if (!IMAGE_TYPES.contains(mime)) throw new ApiException(400, "GEM 参考图仅支持 JPG、PNG、WEBP、HEIC、HEIF");
  }

  static void requirePublicImageUrl(URI uri) throws Exception {
    if (!("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))
        || uri.getHost() == null || uri.getUserInfo() != null) throw new ApiException(400, "参考图须为公开图片地址");
    for (InetAddress address : InetAddress.getAllByName(uri.getHost())) {
      byte[] bytes = address.getAddress();
      if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
          || address.isSiteLocalAddress() || address.isMulticastAddress()
          || bytes.length == 16 && (bytes[0] & 0xfe) == 0xfc
          || bytes.length == 4 && (bytes[0] & 255) == 100 && (bytes[1] & 255) >= 64 && (bytes[1] & 255) <= 127) {
        throw new ApiException(400, "参考图不能使用本机或内网地址");
      }
    }
  }

}
