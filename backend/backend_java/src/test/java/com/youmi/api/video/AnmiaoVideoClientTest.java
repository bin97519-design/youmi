package com.youmi.api.video;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.youmi.api.common.ApiException;
import com.youmi.api.image.ModelApiKeyDtos;
import com.youmi.api.image.ModelApiKeyService;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class AnmiaoVideoClientTest {
  private final ObjectMapper mapper = new ObjectMapper();
  private final VideoGenerationClient media = mock(VideoGenerationClient.class);
  private HttpServer server;

  @AfterEach void stop() { if (server != null) server.stop(0); }

  @Test void dedicatedKeysAreUsedForCreationAndPollingAfterRestart() throws Exception {
    start();
    AtomicReference<String> authorization = new AtomicReference<>();
    server.createContext("/contents/generations/tasks", exchange -> {
      authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
      respond(exchange, 200, "POST".equals(exchange.getRequestMethod())
          ? "{\"id\":\"123\"}" : "{\"status\":\"running\"}");
    });
    var properties = new AnmiaoVideoProperties();
    properties.setApiKey("legacy-shared-key");
    properties.setApiKey20("test-sd20-key");
    properties.setApiKey25("test-sd25-key");
    properties.setMiPerSecond(5);
    properties.setMiPerSecond25ByResolution(Map.of("720p", 7));

    var created20 = client(properties).createTask(request(6));
    assertEquals("Bearer test-sd20-key", authorization.get());
    assertEquals("anmiao-video:20:123", created20.getTaskId());
    client(properties).getTask(created20.getTaskId(), 7L);
    assertEquals("Bearer test-sd20-key", authorization.get());

    var request25 = new VideoGenerationDtos.CreateTaskRequest("商品视频", AnmiaoVideoClient.MODEL25,
        "adaptive", 30, "720p", List.of(), null, null, null, true, null, null, null);
    var created25 = client(properties).createTask(request25);
    assertEquals("Bearer test-sd25-key", authorization.get());
    assertEquals("anmiao-video:25:123", created25.getTaskId());
    client(properties).getTask(created25.getTaskId(), 7L);
    assertEquals("Bearer test-sd25-key", authorization.get());

    client(properties).getTask("anmiao-video:123", 7L);
    assertEquals("Bearer legacy-shared-key", authorization.get());
  }

  @Test void sd20KeyCannotBeBorrowedForSd25OrLegacyTasks() {
    var properties = new AnmiaoVideoProperties();
    properties.setApiKey20("test-sd20-key");
    properties.setMiPerSecond(5);
    properties.setMiPerSecond25ByResolution(Map.of("720p", 7));
    var client = client(properties);
    assertEquals(30, client.price(request(6)));
    var request25 = new VideoGenerationDtos.CreateTaskRequest("商品视频", AnmiaoVideoClient.MODEL25,
        "adaptive", 30, "720p", List.of(), null, null, null, true, null, null, null);
    assertThrows(ApiException.class, () -> client.createTask(request25));
    assertThrows(ApiException.class, () -> client.getTask("anmiao-video:25:123", 7L));
    assertThrows(ApiException.class, () -> client.getTask("anmiao-video:123", 7L));
    verifyNoInteractions(media);
  }

  @Test void submitsPerSecondFirstFrameRequestWithoutChangingThqFormat() throws Exception {
    start();
    AtomicReference<String> authorization = new AtomicReference<>();
    AtomicReference<JsonNode> body = new AtomicReference<>();
    server.createContext("/contents/generations/tasks", exchange -> {
      authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
      body.set(mapper.readTree(exchange.getRequestBody()));
      respond(exchange, 200, "{\"id\":\"99936297\"}");
    });
    var client = client(3);
    var response = client.createTask(request(6));

    assertEquals(18, client.price(request(6)));
    assertEquals("Bearer test-anmiao-key", authorization.get());
    assertEquals(AnmiaoVideoClient.MODEL, body.get().path("model").asText());
    assertEquals(6, body.get().path("duration").asInt());
    assertEquals("720p", body.get().path("resolution").asText());
    assertEquals("9:16", body.get().path("ratio").asText());
    assertEquals("first_frame", body.get().path("content").path(1).path("role").asText());
    assertEquals("https://assets.example/frame.png",
        body.get().path("content").path(1).path("image_url").path("url").asText());
    assertTrue(body.get().path("generate_audio").isMissingNode());
    assertEquals("anmiao-video:99936297", response.getTaskId());
    assertEquals("queued", response.getStatus());
    verifyNoInteractions(media);
  }

  @Test void configuredSeedanceAliasesUseDocumentedProviderModelIds() throws Exception {
    start();
    AtomicReference<JsonNode> body = new AtomicReference<>();
    server.createContext("/contents/generations/tasks", exchange -> {
      body.set(mapper.readTree(exchange.getRequestBody()));
      respond(exchange, 200, body.get().path("model").asText().equals(AnmiaoVideoClient.MODEL25)
          ? "{\"data\":{\"task_id\":\"task_123\"}}"
          : "{\"id\":\"123\"}");
    });
    var keys = mock(ModelApiKeyService.class);
    var properties = new AnmiaoVideoProperties();
    properties.setMiPerSecondByResolution(Map.of("480p", 1));
    properties.setMiPerSecond25ByResolution(Map.of("480p", 1));
    var client = client(properties, keys);

    Map<String, String> models = Map.of(
        "seedance-2.0-guanfang-anmiao", AnmiaoVideoClient.MODEL,
        "seedance-2.5-guanfang-anmiao", AnmiaoVideoClient.MODEL25);
    for (var entry : models.entrySet()) {
      String configuredModel = entry.getKey();
      var credential = new ModelApiKeyService.ResolvedModelApiKey(31, configuredModel, "灵科AI",
          "http://127.0.0.1:" + server.getAddress().getPort(),
          "/contents/generations/tasks", "/contents/generations/tasks/{id}", "test-key");
      when(keys.resolve(configuredModel, ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video"))
          .thenReturn(Optional.of(credential));
      var request = new VideoGenerationDtos.CreateTaskRequest("测试视频", configuredModel,
          "16:9", 4, "480p", List.of(), null, null, null, true, null, null, null);

      var created = client.createTask(request);

      assertEquals(entry.getValue(), body.get().path("model").asText());
      if (AnmiaoVideoClient.MODEL25.equals(entry.getValue()))
        assertEquals("anmiao-video:key:31:task_123", created.getTaskId());
    }
  }

  @Test void readsTaskIdFromNestedProviderResponse() throws Exception {
    start();
    server.createContext("/contents/generations/tasks", exchange ->
        respond(exchange, 200, "{\"data\":{\"task\":{\"id\":\"task_nested_123\"}}}"));

    var response = client(3).createTask(request(4));

    assertEquals("anmiao-video:task_nested_123", response.getTaskId());
  }

  @Test void capabilitiesRecognizeConfiguredProviderModelIdsAndAliases() throws Exception {
    start();
    var keys = mock(ModelApiKeyService.class);
    var client = client(new AnmiaoVideoProperties(), keys);
    when(keys.enabledModelOptions(ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video"))
        .thenReturn(List.of(
            new ModelApiKeyDtos.ModelOption("doubao-seedance-2-0-260128", "SD2", "灵科AI"),
            new ModelApiKeyDtos.ModelOption("seedance-2.5-guanfang-anmiao", "SD2.5", "灵科AI")));

    assertTrue(client.hasConfiguredModelVersion(false));
    assertTrue(client.hasConfiguredModelVersion(true));
  }

  @Test void allStandardResolutionsUseTheirOwnPerSecondRateAndRequestValue() throws Exception {
    start();
    AtomicReference<JsonNode> body = new AtomicReference<>();
    server.createContext("/contents/generations/tasks", exchange -> {
      body.set(mapper.readTree(exchange.getRequestBody()));
      respond(exchange, 200, "{\"id\":\"99936297\"}");
    });
    var client = client(Map.of("480p", 1, "720p", 2, "1080p", 3, "4k", 4));
    for (var entry : Map.of("480p", 1, "720p", 2, "1080p", 3, "4k", 4).entrySet()) {
      var request = request(6, entry.getKey());
      assertEquals(6 * entry.getValue(), client.price(request));
      client.createTask(request);
      assertEquals(entry.getKey(), body.get().path("resolution").asText());
    }
    verifyNoInteractions(media);
  }

  @Test void seedance25SubmitsThirtySecondsWithItsOwnModelAndRate() throws Exception {
    start();
    AtomicReference<JsonNode> body = new AtomicReference<>();
    server.createContext("/contents/generations/tasks", exchange -> {
      body.set(mapper.readTree(exchange.getRequestBody()));
      respond(exchange, 200, "{\"id\":\"99936297\"}");
    });
    var properties = new AnmiaoVideoProperties();
    properties.setApiKey("test-anmiao-key");
    properties.setMiPerSecondByResolution(Map.of("720p", 5));
    properties.setMiPerSecond25ByResolution(Map.of("1080p", 14));
    var client = client(properties);
    var request = new VideoGenerationDtos.CreateTaskRequest("整片视频", AnmiaoVideoClient.MODEL25,
        "adaptive", 30, "1080p", List.of("https://assets.example/frame.png"),
        "https://assets.example/frame.png", null, null, true, null, null, null);

    assertEquals(420, client.price(request));
    client.createTask(request);
    assertEquals(AnmiaoVideoClient.MODEL25, body.get().path("model").asText());
    assertEquals(30, body.get().path("duration").asInt());
    assertEquals("1080p", body.get().path("resolution").asText());
    assertEquals("adaptive", body.get().path("ratio").asText());
    assertTrue(body.get().path("generate_audio").isMissingNode());
  }

  @Test void seedance25RejectsFourKAndFixedFirstFrameRatioBeforeCharge() {
    var properties = new AnmiaoVideoProperties();
    properties.setApiKey("test-anmiao-key");
    properties.setMiPerSecond25ByResolution(Map.of("720p", 7));
    var client = client(properties);
    var request = new VideoGenerationDtos.CreateTaskRequest("商品视频", AnmiaoVideoClient.MODEL25,
        "adaptive", 30, "4k", List.of("https://assets.example/frame.png"),
        "https://assets.example/frame.png", null, null, true, null, null, null);
    assertTrue(assertThrows(ApiException.class, () -> client.price(request)).getMessage().contains("1080p"));
    var wrongRatio = new VideoGenerationDtos.CreateTaskRequest("商品视频", AnmiaoVideoClient.MODEL25,
        "9:16", 30, "720p", List.of("https://assets.example/frame.png"),
        "https://assets.example/frame.png", null, null, true, null, null, null);
    assertTrue(assertThrows(ApiException.class, () -> client.price(wrongRatio)).getMessage().contains("自适应"));
  }

  @Test void seedance25AllowsMultipleReferencesWithAnExplicitRatio() throws Exception {
    start();
    AtomicReference<JsonNode> body = new AtomicReference<>();
    server.createContext("/contents/generations/tasks", exchange -> {
      body.set(mapper.readTree(exchange.getRequestBody()));
      respond(exchange, 200, "{\"id\":\"99936297\"}");
    });
    var properties = new AnmiaoVideoProperties();
    properties.setApiKey("test-anmiao-key");
    properties.setMiPerSecond25ByResolution(Map.of("720p", 7));
    var request = new VideoGenerationDtos.CreateTaskRequest("商品视频", AnmiaoVideoClient.MODEL25,
        "9:16", 6, "720p", List.of("https://assets.example/a.png", "https://assets.example/b.png"),
        null, null, null, true, null, null, null);

    client(properties).createTask(request);
    assertEquals("9:16", body.get().path("ratio").asText());
    assertEquals("reference_image", body.get().path("content").path(1).path("role").asText());
    assertEquals("reference_image", body.get().path("content").path(2).path("role").asText());
  }

  @Test void chatImagesBecomeReferencesWithoutReplacingTheFirstFrameWorkflow() throws Exception {
    start();
    AtomicReference<JsonNode> body = new AtomicReference<>();
    server.createContext("/contents/generations/tasks", exchange -> {
      body.set(mapper.readTree(exchange.getRequestBody()));
      respond(exchange, 200, "{\"id\":\"99936297\"}");
    });
    var client = client(5);
    var request = new VideoGenerationDtos.CreateTaskRequest("商品视频", AnmiaoVideoClient.MODEL,
        "9:16", 6, "720p", List.of("https://assets.example/a.png", "https://assets.example/b.png"),
        null, null, null, true, null, null, null);

    client.createTask(request);
    assertEquals("reference_image", body.get().path("content").path(1).path("role").asText());
    assertEquals("reference_image", body.get().path("content").path(2).path("role").asText());
    assertEquals("https://assets.example/b.png",
        body.get().path("content").path(2).path("image_url").path("url").asText());
  }

  @Test void rejectsTooManyChatReferenceImagesBeforeCharging() {
    var images = java.util.stream.IntStream.range(0, 10)
        .mapToObj(index -> "https://assets.example/" + index + ".png").toList();
    var request = new VideoGenerationDtos.CreateTaskRequest("商品视频", AnmiaoVideoClient.MODEL,
        "9:16", 6, "720p", images, null, null, null, true, null, null, null);
    assertTrue(assertThrows(ApiException.class, () -> client(5).price(request))
        .getMessage().contains("最多支持 9 张"));
  }

  @Test void anUnpricedResolutionCannotBeSubmittedUsingAnotherTierPrice() {
    var client = client(Map.of("720p", 3));
    assertTrue(client.available());
    assertTrue(assertThrows(ApiException.class, () -> client.price(request(6, "4k")))
        .getMessage().contains("所选画质"));
  }

  @Test void pollsActualProviderStatusAndPersistsSuccessfulVideoForComposition() throws Exception {
    start();
    AtomicReference<String> body = new AtomicReference<>("{\"status\":\"running\"}");
    server.createContext("/contents/generations/tasks/99936297", exchange -> respond(exchange, 200, body.get()));
    var client = client(3);

    var running = client.getTask("anmiao-video:99936297", 7L);
    assertEquals("processing", running.getStatus());
    assertNull(running.getProgress());

    body.set("{\"status\":\"succeeded\",\"content\":{\"video_url\":\"https://videos.example/result.mp4\"}}");
    when(media.persistVideo("anmiao-video:99936297", "99936297", "https://videos.example/result.mp4", 7L))
        .thenReturn("https://oss.example/users/7/result.mp4");
    var completed = client.getTask("anmiao-video:99936297", 7L);
    assertEquals("completed", completed.getStatus());
    assertEquals(List.of("https://oss.example/users/7/result.mp4"), completed.getVideoUrls());
    assertEquals(100, completed.getProgress());
    verify(media).persistVideo("anmiao-video:99936297", "99936297", "https://videos.example/result.mp4", 7L);

    body.set("{\"status\":\"failed\",\"error\":{\"code\":\"SensitiveContentDetected\","
        + "\"message\":\"输入未通过审核\"}}");
    var failed = client.getTask("anmiao-video:99936297", 7L);
    assertEquals("failed", failed.getStatus());
    assertEquals("输入未通过审核", failed.getError());
  }

  @Test void completedVideoRemainsPersistingWhenOssDownloadFails() throws Exception {
    start();
    server.createContext("/contents/generations/tasks/99936297", exchange -> respond(exchange, 200,
        "{\"status\":\"succeeded\",\"content\":{\"video_url\":\"https://videos.example/result.mp4\"}}"));
    when(media.persistVideo("anmiao-video:99936297", "99936297", "https://videos.example/result.mp4", 7L))
        .thenThrow(new IOException("temporary download failure"));
    var result = client(3).getTask("anmiao-video:99936297", 7L);
    assertEquals("persisting", result.getStatus());
    assertEquals(List.of(), result.getVideoUrls());
    assertNull(result.getProgress());
  }

  @Test void rejectsInvalidDurationAndMixedReferencesBeforeSending() {
    var client = client(3);
    assertThrows(ApiException.class, () -> client.price(request(3)));
    assertThrows(ApiException.class, () -> client.price(request(16)));
    var mixed = new VideoGenerationDtos.CreateTaskRequest("生成商品视频", AnmiaoVideoClient.MODEL,
        "9:16", 6, "720p", List.of("https://assets.example/frame.png", "https://assets.example/other.png"),
        "https://assets.example/frame.png", null, null, true, null, null, null);
    assertTrue(assertThrows(ApiException.class, () -> client.price(mixed)).getMessage().contains("不能混用"));
  }

  @Test void unconfiguredTransportCannotChargeOrSubmit() {
    var client = client(0);
    assertTrue(assertThrows(ApiException.class, () -> client.price(request(6))).getMessage().contains("尚未配置"));
  }

  private VideoGenerationDtos.CreateTaskRequest request(int duration) {
    return request(duration, "720p");
  }

  private VideoGenerationDtos.CreateTaskRequest request(int duration, String resolution) {
    return new VideoGenerationDtos.CreateTaskRequest("窗帘自然展开", AnmiaoVideoClient.MODEL,
        "9:16", duration, resolution, List.of("https://assets.example/frame.png"),
        "https://assets.example/frame.png", null, null, true, null, null, "canvas-1");
  }

  private AnmiaoVideoClient client(int rate) {
    var properties = new AnmiaoVideoProperties();
    properties.setApiKey("test-anmiao-key");
    properties.setMiPerSecond(rate);
    return client(properties);
  }

  private AnmiaoVideoClient client(Map<String, Integer> rates) {
    var properties = new AnmiaoVideoProperties();
    properties.setApiKey("test-anmiao-key");
    properties.setMiPerSecondByResolution(rates);
    return client(properties);
  }

  private AnmiaoVideoClient client(AnmiaoVideoProperties properties) {
    properties.setBaseUrl(server == null ? "http://127.0.0.1:1" : "http://127.0.0.1:" + server.getAddress().getPort());
    properties.setTimeoutSeconds(5);
    return new AnmiaoVideoClient(properties, media, mapper);
  }

  private AnmiaoVideoClient client(AnmiaoVideoProperties properties, ModelApiKeyService keys) {
    properties.setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort());
    properties.setTimeoutSeconds(5);
    return new AnmiaoVideoClient(properties, media, mapper, keys, null);
  }

  private void start() throws IOException {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.start();
  }

  private void respond(HttpExchange exchange, int status, String body) throws IOException {
    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().set("Content-Type", "application/json");
    exchange.sendResponseHeaders(status, bytes.length);
    exchange.getResponseBody().write(bytes);
    exchange.close();
  }
}
