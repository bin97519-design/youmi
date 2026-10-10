package com.youmi.api.video;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import com.youmi.api.common.ApiException;
import com.youmi.api.image.ModelApiKeyService;
import com.youmi.api.image.ModelApiKeyService.ResolvedModelApiKey;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class MinimaxVideoClientTest {
  final ObjectMapper mapper = new ObjectMapper();
  final VideoGenerationClient media = mock(VideoGenerationClient.class);
  final MinimaxVideoProperties properties = new MinimaxVideoProperties();
  final AtomicReference<JsonNode> submitted = new AtomicReference<>();
  final AtomicReference<String> response = new AtomicReference<>("{\"code\":200,\"data\":{\"task_id\":123456}}");
  final AtomicInteger calls = new AtomicInteger();
  HttpServer server;
  MinimaxVideoClient client;

  @BeforeEach void setup() throws Exception {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/v1/media/", exchange -> {
      calls.incrementAndGet();
      assertTrue(List.of("Bearer test-only", "Bearer configured-only")
          .contains(exchange.getRequestHeaders().getFirst("Authorization")));
      if (exchange.getRequestMethod().equals("POST")) {
        assertEquals("/v1/media/generate", exchange.getRequestURI().getPath());
        submitted.set(mapper.readTree(exchange.getRequestBody()));
      } else {
        assertEquals("/v1/media/status", exchange.getRequestURI().getPath());
        assertEquals("task_id=123456", exchange.getRequestURI().getQuery());
      }
      byte[] bytes = response.get().getBytes(StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(200, bytes.length);
      exchange.getResponseBody().write(bytes);
      exchange.close();
    });
    server.start();
    properties.setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort());
    properties.setApiKey("test-only");
    properties.setMiPerSecondByResolution(Map.of("768p", 5, "1080p", 10, "2k", 15, "4k", 30));
    client = new MinimaxVideoClient(properties, media, mapper);
    ModelApiKeyService modelApiKeys = mock(ModelApiKeyService.class);
    String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    ResolvedModelApiKey configuredKey = new ResolvedModelApiKey(9L,
        MinimaxVideoClient.CONFIGURED_MODEL, "lk888", baseUrl, "/v1/media/generate",
        "/v1/media/status?task_id={task_id}", "configured-only", Map.of());
    when(modelApiKeys.resolve(MinimaxVideoClient.CONFIGURED_MODEL,
        ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video"))
        .thenReturn(Optional.of(configuredKey));
    when(modelApiKeys.resolveById(9L, ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION))
        .thenReturn(configuredKey);
    client.setModelApiKeyService(modelApiKeys);
  }
  @AfterEach void stop() { server.stop(0); }

  static VideoGenerationDtos.CreateTaskRequest request(int duration, String resolution, List<String> images, String first, String last) {
    return new VideoGenerationDtos.CreateTaskRequest("camera move", MinimaxVideoClient.MODEL, "3:4", duration,
        resolution, images, first, last, null, true, null, null, "client-id");
  }

  @Test void removedModelIsRejectedBeforeCallingProvider() {
    assertFalse(MinimaxVideoClient.supportsModel("minimax-h3-max"));
    var request = new VideoGenerationDtos.CreateTaskRequest("test", "minimax-h3-max", "16:9", 5);
    assertThrows(ApiException.class, () -> client.createTask(request));
    assertEquals(0, calls.get());
  }

  @Test void textToVideoUsesMediaApiAndCanonicalResolutionWithoutUnsupportedFields() throws Exception {
    for (String resolution : List.of("768p", "1080p", "2k", "4k")) {
      var request = request(5, resolution, List.of(), null, null);
      assertEquals(5 * properties.rate(resolution), client.price(request));
      assertEquals("minimax-h3:123456", client.createTask(request).getTaskId());
      JsonNode body = submitted.get(), params = body.path("params");
      assertEquals(3, body.size());
      assertEquals("minimax-h3", body.path("model").asText());
      assertEquals("5", params.path("duration").textValue());
      assertEquals(resolution.toUpperCase(java.util.Locale.ROOT), params.path("resolution").asText());
      assertEquals("3:4", params.path("aspect_ratio").asText());
      assertFalse(params.has("generate_audio"));
      assertFalse(params.has("images"));
      assertFalse(params.has("image_url"));
    }
  }

  @Test void firstLastFramesAreOrderedAndDistinctFromReferenceImages() throws Exception {
    String first = "https://assets.example/first.png", last = "https://assets.example/last.png";
    client.createTask(request(15, "2k", List.of(first), first, last));
    JsonNode params = submitted.get().path("params");
    assertEquals("shouweizhen", params.path("mode").asText());
    assertEquals(mapper.valueToTree(List.of(first, last)), params.path("images"));
    assertFalse(params.has("image_url"));
    client.createTask(request(4, "768p", List.of(first), null, null));
    params = submitted.get().path("params");
    assertEquals("cankaosheng", params.path("mode").asText());
    assertEquals(mapper.valueToTree(List.of(first)), params.path("image_url"));
    assertFalse(params.has("images"));
    List<String> nine = java.util.stream.IntStream.range(0, 9).mapToObj(i -> "https://assets.example/" + i + ".png").toList();
    client.createTask(request(8, "1080p", nine, null, null));
    assertEquals(9, submitted.get().path("params").path("image_url").size());
  }

  @Test void configuredMiniH3UsesMappedCredentialAndDocumentedRequestAndStatusFormat() throws Exception {
    var request = new VideoGenerationDtos.CreateTaskRequest("slow camera move",
        MinimaxVideoClient.CONFIGURED_MODEL, "adaptive", 5, "768p",
        List.of("https://assets.example/first.png", "https://assets.example/last.png"),
        "https://assets.example/first.png", "https://assets.example/last.png",
        null, true, null, null, "client-id");
    properties.setMiPerSecondByResolution(Map.of());
    assertEquals(0, client.price(request));
    assertTrue(client.hasConfiguredHailuoModel());
    var created = client.createTask(request);
    assertEquals("hailuo-h3:key:9:123456", created.getTaskId());
    JsonNode body = submitted.get();
    assertEquals(3, body.size());
    assertEquals(MinimaxVideoClient.CONFIGURED_MODEL, body.path("model").asText());
    assertEquals("slow camera move", body.path("prompt").asText());
    assertEquals("5", body.path("params").path("duration").asText());
    assertEquals("768P", body.path("params").path("resolution").asText());
    assertEquals(2, body.path("params").path("images").size());
    properties.setPersistGeneratedVideos(false);
    response.set("{\"state\":\"success\",\"is_final\":true,\"progress\":\"100%\",\"result_url\":\"https://assets.example/out.mp4\"}");
    assertEquals("completed", client.getTask(created.getTaskId(), 7L).getStatus());
  }

  @Test void invalidParametersAndMissingConfigurationNeverReachProvider() {
    assertThrows(ApiException.class, () -> client.price(request(30, "768p", List.of(), null, null)));
    assertThrows(ApiException.class, () -> client.price(request(3, "768p", List.of(), null, null)));
    assertThrows(ApiException.class, () -> client.price(request(5, "720p", List.of(), null, null)));
    assertThrows(ApiException.class, () -> client.price(request(5, "768p", List.of("data:image/png;base64,abc"), null, null)));
    assertThrows(ApiException.class, () -> client.price(request(5, "768p", List.of(), null, "https://assets/last.png")));
    assertThrows(ApiException.class, () -> client.price(request(5, "768p", List.of("https://assets/other.png"), "https://assets/first.png", null)));
    List<String> ten = java.util.stream.IntStream.range(0, 10).mapToObj(i -> "https://assets.example/" + i).toList();
    assertThrows(ApiException.class, () -> client.price(request(5, "768p", ten, null, null)));
    properties.setMiPerSecondByResolution(Map.of());
    assertThrows(ApiException.class, () -> client.price(request(5, "768p", List.of(), null, null)));
    properties.setMiPerSecondByResolution(Map.of("768p", 5));
    properties.setApiKey("");
    assertFalse(properties.isAvailable());
    assertEquals(0, properties.availableRates().get("768p"));
    assertThrows(ApiException.class, () -> client.createTask(request(5, "768p", List.of(), null, null)));
    assertEquals(0, calls.get());
  }

  @Test void progressComesFromProviderAndOnlyBooleanFinalReleasesResult() throws Exception {
    response.set("{\"state\":\"running\",\"is_final\":false,\"status\":\"已完成\",\"progress\":\"45%\"}");
    var result = client.getTask("minimax-h3:123456", 7L);
    assertEquals("processing", result.getStatus());
    assertEquals(45, result.getProgress());
    for (String finalValue : List.of("false", "\"true\"")) {
      response.set("{\"state\":\"success\",\"is_final\":" + finalValue + ",\"result_url\":\"https://assets.example/result.mp4\"}");
      result = client.getTask("minimax-h3:123456", 7L);
      assertEquals("processing", result.getStatus());
      assertNull(result.getProgress());
    }
    verifyNoInteractions(media);
    response.set("{\"state\":\"failed\",\"is_final\":true,\"error\":\"supplier reason\"}");
    result = client.getTask("minimax-h3:123456", 7L);
    assertEquals("failed", result.getStatus());
    assertEquals("supplier reason", result.getError());
  }

  @Test void persistenceFailureRemainsRetryableWithoutRegenerating() throws Exception {
    response.set("{\"state\":\"success\",\"is_final\":true,\"progress\":\"100%\",\"result_url\":\"https://assets.example/result.mp4\"}");
    when(media.persistVideo("minimax-h3:123456", "123456", "https://assets.example/result.mp4", 7L))
        .thenThrow(new RuntimeException("storage unavailable")).thenReturn("https://own.example/saved.mp4");
    assertEquals("persisting", client.getTask("minimax-h3:123456", 7L).getStatus());
    var result = client.getTask("minimax-h3:123456", 7L);
    assertEquals("completed", result.getStatus());
    assertEquals(List.of("https://own.example/saved.mp4"), result.getVideoUrls());
    assertEquals(100, result.getProgress());
    assertNull(submitted.get());
  }

  @Test void businessErrorAndMissingResultAreNotReportedAsSuccessful() {
    response.set("{\"code\":403,\"msg\":\"permission denied\"}");
    assertTrue(assertThrows(ApiException.class, () -> client.createTask(request(5, "768p", List.of(), null, null)))
        .getMessage().contains("permission denied"));
    response.set("{\"state\":\"success\",\"is_final\":true}");
    assertThrows(ApiException.class, () -> client.getTask("minimax-h3:123456", 7L));
  }
}
