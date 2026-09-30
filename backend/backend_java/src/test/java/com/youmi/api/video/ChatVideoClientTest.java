package com.youmi.api.video;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import com.youmi.api.common.ApiException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class ChatVideoClientTest {
  private final ObjectMapper mapper = new ObjectMapper();
  private final VideoGenerationProperties config = new VideoGenerationProperties();
  private final VideoGenerationClient media = mock(VideoGenerationClient.class);
  private final ChatVideoClient client = new ChatVideoClient(mapper, config, media);
  private static final byte[] IMAGE_BYTES = new byte[] {(byte) 137, 80, 78, 71, 13, 10, 0, (byte) 255};

  @BeforeEach void prepareImageDownload() throws Exception {
    when(media.downloadReference(anyString())).thenReturn(new VideoGenerationClient.DownloadedAsset("image/png", IMAGE_BYTES));
  }

  static VideoGenerationDtos.CreateTaskRequest request() {
    return new VideoGenerationDtos.CreateTaskRequest("0-10 秒开场，10-25 秒展示，25-30 秒收尾", ChatVideoClient.MODEL,
        "16:9", 30, "720p", List.of("https://assets.test/ref.png"), "https://assets.test/ref.png", null,
        null, false, null, null, "chat-video-test-1");
  }

  @Test void usesMultipartImagesWithOriginalBytesAndDoesNotChangeOldConfig() throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    var received = new AtomicReference<MultipartRequestTestSupport.Parsed>();
    var auth = new AtomicReference<String>();
    server.createContext("/v1/models", exchange -> {
      byte[] body = "{\"data\":[{\"id\":\"ya-sd25-30s\"}]}".getBytes(StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(200, body.length);
      exchange.getResponseBody().write(body);
      exchange.close();
    });
    server.createContext("/v1/videos", exchange -> {
      received.set(MultipartRequestTestSupport.parse(exchange.getRequestHeaders().getFirst("Content-Type"), exchange.getRequestBody()));
      auth.set(exchange.getRequestHeaders().getFirst("Authorization"));
      byte[] body = "{\"id\":\"video-test\",\"status\":\"queued\"}".getBytes(StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(200, body.length);
      exchange.getResponseBody().write(body);
      exchange.close();
    });
    server.start();
    try {
      config.setApiKey("legacy-test-key");
      config.setChatApiKey("new-test-key");
      config.setChatBaseUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/v1");
      client.checkAccess();
      var state = client.taskState(client.generate(request()));
      assertTrue(state.pending());
      assertEquals("video-test", state.id());
      var body = received.get().fields();
      assertEquals("ya-sd25-30s", body.get("model"));
      assertFalse(body.containsKey("messages"));
      assertFalse(body.containsKey("references"));
      assertFalse(body.containsKey("images[]"), "Images must be file parts, not text fields");
      assertEquals("30", body.get("seconds"));
      assertEquals("720p", body.get("resolution"));
      assertEquals("16:9", body.get("aspect_ratio"));
      assertEquals(request().prompt(), body.get("prompt"));
      assertEquals(1, received.get().files().size());
      var reference = received.get().files().get(0);
      assertEquals("images[]", reference.name());
      assertEquals("image/png", reference.contentType());
      assertEquals("reference-1.png", reference.filename());
      assertArrayEquals(IMAGE_BYTES, reference.bytes());
      assertEquals("Bearer new-test-key", auth.get());
      assertEquals("legacy-test-key", config.getApiKey());
      assertEquals("https://new.thqllm.com/v1", config.normalizedBaseUrl());
      verify(media, times(1)).downloadReference("https://assets.test/ref.png");
      verify(media, never()).prepareReferenceSource(anyString());
      assertFalse(body.containsKey("generate_audio"));
      var input = request();
      client.generate(new VideoGenerationDtos.CreateTaskRequest(input.prompt(), input.model(), input.ratio(),
          input.durationSeconds(), input.resolution(), input.imageUrls(), input.firstFrameUrl(), null,
          null, true, null, null, "audio-test"));
      assertFalse(received.get().fields().containsKey("generate_audio"), "Old requests with audio enabled must also omit the unsupported field");
      assertEquals(input.prompt(), received.get().fields().get("prompt"));
    } finally { server.stop(0); }
  }

  @Test void missingModelPermissionIsExplicitAndDoesNotGenerate() throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/v1/models", exchange -> {
      byte[] body = "{\"data\":[{\"id\":\"seedance-2.0-fast-0826-720p\"}]}".getBytes(StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(200, body.length);
      exchange.getResponseBody().write(body);
      exchange.close();
    });
    server.start();
    try {
      config.setApiKey("test-key");
      config.setChatBaseUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/v1");
      var error = assertThrows(ApiException.class, client::checkAccess);
      assertEquals(503, error.getCode());
      assertTrue(error.getMessage().contains("sd2.5-30s-720p"));
      verifyNoInteractions(media);
    } finally { server.stop(0); }
  }

  @Test void preservesFullPromptAndUploadsAllImagesInFirstFrameOrder() throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    var received = new AtomicReference<MultipartRequestTestSupport.Parsed>();
    server.createContext("/v1/videos", exchange -> {
      received.set(MultipartRequestTestSupport.parse(exchange.getRequestHeaders().getFirst("Content-Type"), exchange.getRequestBody()));
      byte[] body = "{\"id\":\"video-test\",\"status\":\"queued\"}".getBytes(StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(200, body.length);
      exchange.getResponseBody().write(body);
      exchange.close();
    });
    server.start();
    try {
      config.setChatApiKey("new-test-key");
      config.setChatBaseUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/v1");
      var urls = java.util.stream.IntStream.range(0, 6)
          .mapToObj(i -> "https://assets.test/image-" + i + ".png?signature=a%2Bb%2Fc%3D&expires=9999999999").toList();
      for (int i = 0; i < urls.size(); i++) when(media.downloadReference(urls.get(i)))
          .thenReturn(new VideoGenerationClient.DownloadedAsset(i == 5 ? "image/webp" : "image/jpeg", new byte[] {(byte) i, 0, (byte) 255}));
      String prompt = "画".repeat(2500);
      client.generate(new VideoGenerationDtos.CreateTaskRequest(prompt, ChatVideoClient.MODEL,
          "3:4", 30, "720p", urls, urls.get(5), null, null, true, null, null, "signed-images-test"));
      var body = received.get();
      assertEquals(prompt, body.fields().get("prompt"));
      assertFalse(body.fields().containsKey("references"));
      assertFalse(body.fields().containsKey("generate_audio"));
      assertEquals(6, body.files().size());
      assertEquals("reference-1.webp", body.files().get(0).filename());
      assertEquals("image/webp", body.files().get(0).contentType());
      assertArrayEquals(new byte[] {5, 0, (byte) 255}, body.files().get(0).bytes());
      for (int i = 0; i < 5; i++) {
        assertArrayEquals(new byte[] {(byte) i, 0, (byte) 255}, body.files().get(i + 1).bytes());
        assertEquals("image/jpeg", body.files().get(i + 1).contentType());
      }
      for (var file : body.files()) assertEquals("images[]", file.name());
      var order = inOrder(media);
      order.verify(media).downloadReference(urls.get(5));
      for (int i = 0; i < 5; i++) order.verify(media).downloadReference(urls.get(i));
      order.verifyNoMoreInteractions();
    } finally { server.stop(0); }
  }

  @Test void rejectsNonHttpsOrCredentialBearingReferencesBeforeNetwork() {
    for (String url : List.of("http://assets.test/a.png", "https://name:secret@assets.test/a.png",
        "https:///a.png", "file:///tmp/a.png", "data:image/png;base64,dGVzdA==", "https://assets.test/a.png#fragment")) {
      var request = new VideoGenerationDtos.CreateTaskRequest("test", ChatVideoClient.MODEL,
          "16:9", 30, "720p", List.of(url), url, null, null, false, null, null, "invalid-reference-test");
      var error = assertThrows(ApiException.class, () -> client.validate(request));
      assertEquals(400, error.getCode());
      assertTrue(error.getMessage().contains("HTTPS"));
      assertFalse(error.getMessage().contains("secret"));
    }
    verifyNoInteractions(media);
  }

  @Test void downloadFailureStopsBeforeSubmittingThePaidRequest() throws Exception {
    config.setChatBaseUrl("http://127.0.0.1:1/v1");
    config.setChatApiKey("test-key");
    var failure = new ApiException(502, "reference image download failed: 404");
    when(media.downloadReference(anyString())).thenThrow(failure);
    assertSame(failure, assertThrows(ApiException.class, () -> client.generate(request())));
    verify(media).downloadReference(request().firstFrameUrl());
  }

  @Test void rejectsCombinedImageSizeBeforeSubmittingThePaidRequest() throws Exception {
    config.setChatBaseUrl("http://127.0.0.1:1/v1");
    config.setChatApiKey("test-key");
    when(media.downloadReference(anyString())).thenReturn(new VideoGenerationClient.DownloadedAsset("image/png", new byte[16 * 1024 * 1024]));
    var input = request();
    var oversized = new VideoGenerationDtos.CreateTaskRequest(input.prompt(), input.model(), input.ratio(),
        30, "720p", List.of(input.firstFrameUrl(), "https://assets.test/second.png"), input.firstFrameUrl(),
        null, null, false, null, null, "oversized-images-test");
    var error = assertThrows(ApiException.class, () -> client.generate(oversized));
    assertEquals(400, error.getCode());
    assertTrue(error.getMessage().contains("30MB"));
    verify(media, times(2)).downloadReference(anyString());
  }

  @Test void textOnlyRequestStillUsesMultipartWithoutReferenceFields() throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    var received = new AtomicReference<MultipartRequestTestSupport.Parsed>();
    server.createContext("/v1/videos", exchange -> {
      received.set(MultipartRequestTestSupport.parse(exchange.getRequestHeaders().getFirst("Content-Type"), exchange.getRequestBody()));
      byte[] response = "{\"id\":\"text-video\",\"status\":\"queued\"}".getBytes(StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(200, response.length);
      exchange.getResponseBody().write(response);
      exchange.close();
    });
    server.start();
    try {
      config.setChatBaseUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/v1");
      config.setChatApiKey("test-key");
      var input = request();
      client.generate(new VideoGenerationDtos.CreateTaskRequest(input.prompt(), input.model(), input.ratio(),
          30, "720p", List.of(), null, null, null, false, null, null, "text-only-test"));
      assertTrue(received.get().files().isEmpty());
      assertFalse(received.get().fields().containsKey("references"));
      assertFalse(received.get().fields().containsKey("generate_audio"));
      assertEquals(input.prompt(), received.get().fields().get("prompt"));
      verifyNoInteractions(media);
    } finally { server.stop(0); }
  }

  @Test void nested413ShowsTheUnderlyingReasonAndRetainsOriginalDiagnostics() throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    String inner = mapper.writeValueAsString(java.util.Map.of("error", java.util.Map.of(
        "code", "request_too_large", "message", "请求参数或参考素材无效")));
    String middle = mapper.writeValueAsString(java.util.Map.of("code", "fail_to_fetch_task", "message", inner));
    String outer = mapper.writeValueAsString(java.util.Map.of("code", "fail_to_fetch_task", "message", middle));
    server.createContext("/v1/videos", exchange -> {
      exchange.getRequestBody().readAllBytes();
      byte[] body = outer.getBytes(StandardCharsets.UTF_8);
      exchange.getResponseHeaders().add("X-Request-Id", "req-413-test");
      exchange.sendResponseHeaders(413, body.length);
      exchange.getResponseBody().write(body);
      exchange.close();
    });
    server.start();
    try {
      config.setChatApiKey("new-test-key");
      config.setChatBaseUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/v1");
      var error = assertThrows(ChatVideoClient.ProviderException.class, () -> client.generate(request()));
      assertTrue(error.getMessage().contains("请求参数或参考素材无效 (request_too_large)"));
      assertFalse(error.getMessage().contains("fail_to_fetch_task"));
      assertEquals("req-413-test", error.details().requestId());
      assertEquals(413, error.details().httpStatus());
      assertEquals(outer, error.responseBody());
      verify(media, times(1)).downloadReference(request().firstFrameUrl());
    } finally { server.stop(0); }
  }

  @Test void upstream404KeepsRequestStageDetailsAndRedactsSecrets() throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/v1/videos", exchange -> {
      exchange.getRequestBody().readAllBytes();
      byte[] body = "{\"error\":{\"message\":\"Upstream route not found sk-secret-test Bearer token-secret\"},\"api_key\":\"sk-secret-test\",\"token\":\"private-value\"}"
          .getBytes(StandardCharsets.UTF_8);
      exchange.getResponseHeaders().add("Content-Type", "application/json");
      exchange.getResponseHeaders().add("X-Request-Id", "req-404-test");
      exchange.sendResponseHeaders(404, body.length);
      exchange.getResponseBody().write(body);
      exchange.close();
    });
    server.start();
    try {
      config.setChatApiKey("sk-secret-test");
      config.setChatBaseUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/v1");
      var error = assertThrows(ChatVideoClient.ProviderException.class, () -> client.generate(request()));
      assertEquals(502, error.getCode());
      assertEquals(404, error.details().httpStatus());
      assertEquals("提交视频", error.details().phase());
      assertEquals("POST", error.details().method());
      assertEquals(config.getChatBaseUrl() + "/videos", error.details().endpoint());
      assertEquals("req-404-test", error.details().requestId());
      assertTrue(error.getMessage().contains("Upstream route not found"));
      assertTrue(error.getMessage().contains("POST /v1/videos"));
      for (String secret : List.of("sk-secret-test", "token-secret", "private-value")) {
        assertFalse(error.getMessage().contains(secret));
        assertFalse(error.responseBody().contains(secret));
      }
      assertTrue(error.responseBody().contains("[redacted]"));
    } finally { server.stop(0); }
  }

  @Test void accessQueryFailureIsAConfigurationRejectionAndHtmlIsNotShownToUsers() throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/v1/models", exchange -> {
      byte[] body = "<html><body><h1>404 Not Found</h1></body></html>".getBytes(StandardCharsets.UTF_8);
      exchange.getResponseHeaders().add("Content-Type", "text/html");
      exchange.sendResponseHeaders(404, body.length);
      exchange.getResponseBody().write(body);
      exchange.close();
    });
    server.start();
    try {
      config.setChatApiKey("test-key");
      config.setChatBaseUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/v1");
      var error = assertThrows(ChatVideoClient.ProviderException.class, client::checkAccess);
      assertEquals(503, error.getCode());
      assertEquals("模型权限查询", error.details().phase());
      assertEquals("GET", error.details().method());
      assertTrue(error.getMessage().contains("HTML 错误页面"));
      assertFalse(error.getMessage().contains("<html>"));
      assertTrue(error.responseBody().contains("404 Not Found"));
      verifyNoInteractions(media);
    } finally { server.stop(0); }
  }

  @Test void readsStructuredMarkdownAndStreamingVideoResultsButRejectsPlainChatAndErrors() throws Exception {
    assertEquals("https://result.test/download?id=1", client.resultUrl("{\"download_url\":\"https://result.test/download?id=1\"}"));
    assertEquals("https://result.test/a.mp4", client.resultUrl("{\"choices\":[{\"message\":{\"content\":[{\"type\":\"video_url\",\"video_url\":{\"url\":\"https://result.test/a.mp4\"}}]}}]}"));
    assertEquals("https://result.test/a.mp4", client.resultUrl("data: {\"choices\":[{\"delta\":{\"content\":\"[video](https://result.test/\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"a.mp4)\"}}]}\n\ndata: [DONE]\n"));
    for (String bad : List.of("{\"choices\":[{\"message\":{\"content\":\"正在生成，请稍等\"}}]}",
        "{\"error\":{\"message\":\"failed\"}}", "{\"id\":\"chatcmpl-test\"}",
        "data: {\"error\":{\"message\":\"failed\"}}\n", "{\"video_url\":\"file:///etc/passwd\"}"))
      assertThrows(ApiException.class, () -> client.resultUrl(bad));
  }

  @Test void validatesBeforeNetworkAndFallsBackToExistingVideoKeyOnly() {
    config.setApiKey("test-legacy");
    assertEquals("test-legacy", config.getChatApiKey());
    assertDoesNotThrow(() -> client.validate(request()));
    assertThrows(ApiException.class, () -> client.validate(new VideoGenerationDtos.CreateTaskRequest("hello", ChatVideoClient.MODEL, "16:9", 15)));
    assertThrows(ApiException.class, () -> client.validate(new VideoGenerationDtos.CreateTaskRequest("hello", "seedance-2.0-fast-0826-720p", "16:9", 30)));
  }

  @Test void pollsNestedTaskStatusWithDedicatedCredentialsAndPreservesTaskId() throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    var auth = new AtomicReference<String>();
    var method = new AtomicReference<String>();
    server.createContext("/v1/videos/task-1", exchange -> {
      auth.set(exchange.getRequestHeaders().getFirst("Authorization"));
      method.set(exchange.getRequestMethod());
      byte[] body = "{\"data\":{\"status\":\"PROCESSING\",\"progress\":\"52%\"}}".getBytes(StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(200, body.length);
      exchange.getResponseBody().write(body);
      exchange.close();
    });
    server.start();
    try {
      config.setChatApiKey("dedicated-key");
      config.setChatBaseUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/v1");
      var state = client.taskState(client.poll("task-1"));
      assertEquals("task-1", state.id());
      assertTrue(state.pending());
      assertEquals(52, state.progress());
      assertEquals("GET", method.get());
      assertEquals("Bearer dedicated-key", auth.get());
      assertEquals("queued", client.taskState("{\"task_id\":\"task-1\"}").status());
      assertEquals("http://127.0.0.1:" + server.getAddress().getPort() + "/v1/videos/task-1/content",
          client.resultUrl("{\"status\":\"completed\",\"download_url\":\"/v1/videos/task-1/content\"}"));
    } finally { server.stop(0); }
  }

  @Test void detectsNestedTerminalFailuresInsteadOfShowingGeneratingForever() {
    for (String response : List.of(
        "{\"data\":{\"status\":\"failed\",\"error\":{\"message\":\"render failed\"}}}",
        "{\"data\":{\"status\":\"expired\"}}",
        "{\"data\":{\"status\":\"canceled\"}}",
        "{\"code\":\"fail_to_fetch_task\",\"message\":\"render failed\"}"))
      assertThrows(ApiException.class, () -> client.taskState(response));
    var error = assertThrows(ApiException.class, () -> client.taskState("{\"data\":{\"status\":\"failed\",\"error\":{\"message\":\"render failed\"}}}"));
    assertTrue(error.getMessage().contains("render failed"));
  }

  @Test void preservesProviderProgressWithoutCappingOrInventingPercentages() throws Exception {
    for (int progress : new int[] {0, 42, 98, 100}) {
      var state = client.taskState(mapper.writeValueAsString(java.util.Map.of("id", "task-1", "status", "processing", "progress", progress)));
      assertEquals(progress, state.progress());
      assertTrue(state.pending(), "100% without terminal success must keep polling");
    }
    assertEquals(99, client.taskState("{\"data\":{\"id\":\"task-1\",\"status\":\"processing\",\"progress\":\"99%\"}}").progress());
    for (String progress : List.of("null", "\"\"", "\"unknown\"", "-1", "101"))
      assertNull(client.taskState("{\"id\":\"task-1\",\"status\":\"processing\",\"progress\":" + progress + "}").progress());
    assertNull(client.taskState("{\"id\":\"task-1\",\"status\":\"queued\"}").progress());
  }

  @Test void terminalPollResponseIsReturnedForPersistenceBeforeItIsInterpreted() throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/v1/videos/task-1", exchange -> {
      byte[] body = "{\"status\":\"failed\",\"progress\":71,\"error\":{\"message\":\"render failed\"}}".getBytes(StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(200, body.length);
      exchange.getResponseBody().write(body);
      exchange.close();
    });
    server.start();
    try {
      config.setChatApiKey("test-key");
      config.setChatBaseUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/v1");
      String raw = client.poll("task-1");
      assertEquals("failed", mapper.readTree(raw).path("status").asText());
      assertEquals("task-1", mapper.readTree(raw).path("id").asText());
      assertTrue(assertThrows(ApiException.class, () -> client.taskState(raw)).getMessage().contains("render failed"));
    } finally { server.stop(0); }
  }

  @Test void authenticatedVideoDownloadDoesNotLeakKeyToRedirectedAssetHost() throws Exception {
    var provider = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    var asset = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    var providerAuth = new AtomicReference<String>();
    var assetAuth = new AtomicReference<String>("not requested");
    asset.createContext("/video.mp4", exchange -> {
      assetAuth.set(exchange.getRequestHeaders().getFirst("Authorization"));
      exchange.getResponseHeaders().add("Content-Type", "video/mp4");
      exchange.sendResponseHeaders(200, 4);
      exchange.getResponseBody().write(new byte[] {1, 2, 3, 4});
      exchange.close();
    });
    provider.createContext("/v1/videos/task-1/content", exchange -> {
      providerAuth.set(exchange.getRequestHeaders().getFirst("Authorization"));
      exchange.getResponseHeaders().add("Location", "http://127.0.0.1:" + asset.getAddress().getPort() + "/video.mp4");
      exchange.sendResponseHeaders(302, -1);
      exchange.close();
    });
    provider.start();
    asset.start();
    try {
      config.setChatApiKey("download-key");
      config.setChatBaseUrl("http://127.0.0.1:" + provider.getAddress().getPort() + "/v1");
      var response = client.download(config.getChatBaseUrl() + "/videos/task-1/content");
      try (var input = response.body()) { assertArrayEquals(new byte[] {1, 2, 3, 4}, input.readAllBytes()); }
      assertEquals("Bearer download-key", providerAuth.get());
      assertNull(assetAuth.get());
    } finally { provider.stop(0); asset.stop(0); }
  }
}
