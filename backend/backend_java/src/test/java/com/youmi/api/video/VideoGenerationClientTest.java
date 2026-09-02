package com.youmi.api.video;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.youmi.api.common.ApiException;
import com.youmi.api.file.OssStorageService;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class VideoGenerationClientTest {
  private final ObjectMapper objectMapper = new ObjectMapper();
  private final OssStorageService ossStorageService = mock(OssStorageService.class);
  private HttpServer server;

  @AfterEach
  void stopServer() {
    if (server != null) server.stop(0);
  }

  @Test
  void createsThqTextToVideoTaskAsJson() throws Exception {
    AtomicReference<String> authorization = new AtomicReference<>();
    AtomicReference<String> idempotencyKey = new AtomicReference<>();
    AtomicReference<JsonNode> requestBody = new AtomicReference<>();
    startServer();
    addContext("/videos", exchange -> {
      authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
      idempotencyKey.set(exchange.getRequestHeaders().getFirst("Idempotency-Key"));
      requestBody.set(objectMapper.readTree(exchange.getRequestBody()));
      respondJson(exchange, 200, "{\"task_id\":\"video-123\",\"status\":\"queued\"}");
    });

    VideoGenerationDtos.CreateTaskResponse response = client().createTask(request(List.of()));

    assertEquals("Bearer test-thq-key", authorization.get());
    assertEquals("canvas-video-123", idempotencyKey.get());
    assertEquals("seedance-2.0-fast-0826-720p", requestBody.get().path("model").asText());
    assertEquals("16:9", requestBody.get().path("aspect_ratio").asText());
    assertEquals("15", requestBody.get().path("seconds").asText());
    assertTrue(requestBody.get().path("duration").isMissingNode());
    assertEquals("720p", requestBody.get().path("resolution").asText());
    assertTrue(requestBody.get().path("generate_audio").asBoolean());
    assertEquals("thq", response.getProvider());
    assertEquals("thq-video:video-123", response.getTaskId());
    assertEquals("queued", response.getStatus());
  }

  @Test
  void createsJsonReferenceTaskWhenReferenceImageExists() throws Exception {
    AtomicReference<String> contentType = new AtomicReference<>();
    AtomicReference<JsonNode> body = new AtomicReference<>();
    startServer();
    addContext("/reference.png", exchange -> respond(exchange, 200, "image/png", new byte[] {1, 2, 3}));
    addContext("/videos", exchange -> {
      contentType.set(exchange.getRequestHeaders().getFirst("Content-Type"));
      body.set(objectMapper.readTree(exchange.getRequestBody()));
      respondJson(exchange, 200, "{\"id\":\"video-ref\",\"status\":\"processing\"}");
    });
    String referenceUrl = baseUrl() + "/reference.png";

    VideoGenerationDtos.CreateTaskResponse response = client().createTask(request(List.of(referenceUrl)));

    assertEquals("application/json", contentType.get());
    JsonNode reference = body.get().path("references").path(0);
    assertEquals("image", reference.path("type").asText());
    assertEquals("reference", reference.path("role").asText());
    assertTrue(reference.path("source").asText().startsWith("data:image/png;base64,"));
    assertTrue(body.get().path("prompt").asText().startsWith("必须以参考图中的主体为视频核心"));
    assertTrue(body.get().path("prompt").asText().contains("让产品缓慢旋转并自然推进镜头"));
    assertEquals("thq-video:video-ref", response.getTaskId());
  }

  @Test
  void rejectsResolutionThatDoesNotMatchOfficialModel() {
    VideoGenerationDtos.CreateTaskRequest request = new VideoGenerationDtos.CreateTaskRequest(
        "让产品缓慢旋转并自然推进镜头", "seedance-2.0-0826-720p", "3:4", 15, "480p",
        List.of(), null, null, null, true, null, null, null);

    ApiException error = assertThrows(ApiException.class, () -> client().createTask(request));

    assertTrue(error.getMessage().contains("resolution must match"));
  }

  @Test
  void persistsCompletedVideoToUserOssAndReturnsPermanentUrl() throws Exception {
    byte[] videoBytes = "fake-mp4".getBytes(StandardCharsets.UTF_8);
    AtomicReference<byte[]> uploaded = new AtomicReference<>();
    AtomicReference<String> downloadAuthorization = new AtomicReference<>();
    startServer();
    addContext("/videos/video-123/content", exchange -> {
      downloadAuthorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
      respond(exchange, 200, "video/mp4", videoBytes);
    });
    addContext("/videos/video-123", exchange ->
        respondJson(exchange, 200, "{\"task_id\":\"video-123\",\"status\":\"completed\","
            + "\"download_url\":\"" + baseUrl() + "/videos/video-123/content\"}"));
    when(ossStorageService.isConfigured()).thenReturn(true);
    when(ossStorageService.scopeUserDir(42L, "generated-videos"))
        .thenReturn("users/42/generated-videos");
    when(ossStorageService.uploadStream(any(InputStream.class), anyString(), eq("video/mp4")))
        .thenAnswer(invocation -> {
          uploaded.set(invocation.<InputStream>getArgument(0).readAllBytes());
          return invocation.getArgument(1);
        });
    when(ossStorageService.getFileUrl(anyString())).thenReturn("https://oss.example/video-123.mp4");

    VideoGenerationDtos.TaskStatusResponse response = client().getTask("thq-video:video-123", 42L);

    assertEquals("completed", response.getStatus());
    assertEquals(100, response.getProgress());
    assertEquals(List.of("https://oss.example/video-123.mp4"), response.getVideoUrls());
    assertArrayEquals(videoBytes, uploaded.get());
    assertEquals(null, downloadAuthorization.get());
    verify(ossStorageService).scopeUserDir(42L, "generated-videos");
  }

  @Test
  void treatsSuccessfulHttpFailureEnvelopeAsFailedTask() throws Exception {
    startServer();
    addContext("/videos/video-failed", exchange -> respondJson(exchange, 200,
        "{\"code\":\"fail_to_fetch_task\",\"message\":\"invalid_aspect_ratio\",\"data\":null}"));

    VideoGenerationDtos.TaskStatusResponse response =
        client().getTask("thq-video:video-failed", 42L);

    assertEquals("failed", response.getStatus());
    assertEquals(100, response.getProgress());
    assertEquals("invalid_aspect_ratio", response.getError());
  }

  @Test
  void rejectsUnsupportedModelBeforeCallingProvider() {
    VideoGenerationDtos.CreateTaskRequest invalid = new VideoGenerationDtos.CreateTaskRequest(
        "生成产品展示视频", "unknown-video", "16:9", 15, "480p", List.of(),
        null, null, null, true, null, null, null);

    ApiException error = assertThrows(ApiException.class, () -> client().createTask(invalid));

    assertTrue(error.getMessage().contains("unsupported THQ video model"));
  }

  private VideoGenerationDtos.CreateTaskRequest request(List<String> imageUrls) {
    return new VideoGenerationDtos.CreateTaskRequest(
        "让产品缓慢旋转并自然推进镜头", null, "16:9", 15, null,
        imageUrls, null, null, "避免闪烁", true, 12L, null, "canvas-video-123");
  }

  private VideoGenerationClient client() {
    VideoGenerationProperties properties = new VideoGenerationProperties();
    properties.setApiKey("test-thq-key");
    properties.setBaseUrl(server == null ? "http://127.0.0.1:1" : baseUrl());
    properties.setTimeoutSeconds(5);
    properties.setDownloadTimeoutSeconds(5);
    return new VideoGenerationClient(objectMapper, properties, ossStorageService);
  }

  private void startServer() throws IOException {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.start();
  }

  private void addContext(String path, ExchangeHandler handler) {
    server.createContext(path, exchange -> {
      try {
        handler.handle(exchange);
      } catch (Exception error) {
        respondJson(exchange, 500, "{\"error\":\"" + error.getClass().getSimpleName() + "\"}");
      }
    });
  }

  private String baseUrl() {
    return "http://127.0.0.1:" + server.getAddress().getPort();
  }

  private void respondJson(HttpExchange exchange, int status, String body) throws IOException {
    respond(exchange, status, "application/json;charset=UTF-8", body.getBytes(StandardCharsets.UTF_8));
  }

  private void respond(HttpExchange exchange, int status, String contentType, byte[] bytes) throws IOException {
    exchange.getResponseHeaders().set("Content-Type", contentType);
    exchange.sendResponseHeaders(status, bytes.length);
    exchange.getResponseBody().write(bytes);
    exchange.close();
  }

  @FunctionalInterface
  private interface ExchangeHandler {
    void handle(HttpExchange exchange) throws Exception;
  }
}
