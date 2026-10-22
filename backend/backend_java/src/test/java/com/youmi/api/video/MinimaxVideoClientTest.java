package com.youmi.api.video;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import com.youmi.api.common.ApiException;
import com.youmi.api.ai.AiCallLogService;
import com.youmi.api.image.ModelApiKeyService;
import com.youmi.api.image.ModelApiKeyDtos;
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
  final AtomicReference<String> authorization = new AtomicReference<>();
  ModelApiKeyService modelApiKeys;
  HttpServer server;
  MinimaxVideoClient client;

  @BeforeEach void setup() throws Exception {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/v1/media/", exchange -> {
      calls.incrementAndGet();
      authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
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
    modelApiKeys = mock(ModelApiKeyService.class);
    when(modelApiKeys.enabledModelOptions(ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video"))
        .thenReturn(List.of(new ModelApiKeyDtos.ModelOption(MinimaxVideoClient.CONFIGURED_MODEL, "Mini H3", "test")));
    when(modelApiKeys.enabledModelOptions(ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "product-video-video"))
        .thenReturn(List.of(new ModelApiKeyDtos.ModelOption(MinimaxVideoClient.MODEL, "MiniMax H3", "test")));
    String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    ResolvedModelApiKey configuredKey = new ResolvedModelApiKey(9L,
        MinimaxVideoClient.CONFIGURED_MODEL, "开放 API", baseUrl, "/v1/media/generate",
        "/v1/media/status?task_id={task_id}", "configured-only", Map.of());
    when(modelApiKeys.resolve(MinimaxVideoClient.CONFIGURED_MODEL,
        ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video"))
        .thenReturn(Optional.of(configuredKey));
    when(modelApiKeys.resolve(MinimaxVideoClient.MODEL,
        ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "product-video-video"))
        .thenReturn(Optional.of(new ResolvedModelApiKey(10L,
            MinimaxVideoClient.MODEL, "开放 API", baseUrl, "/v1/media/generate",
            "/v1/media/status?task_id={task_id}", "configured-only", Map.of())));
    when(modelApiKeys.resolveById(9L, ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION))
        .thenReturn(configuredKey);
    client.setModelApiKeyService(modelApiKeys);
  }
  @AfterEach void stop() { server.stop(0); }

  static VideoGenerationDtos.CreateTaskRequest request(int duration, String resolution, List<String> images, String first, String last) {
    return new VideoGenerationDtos.CreateTaskRequest("camera move", MinimaxVideoClient.MODEL, "3:4", duration,
        resolution, images, first, last, null, true, null, null, "client-id");
  }

  ResolvedModelApiKey mapCanvasMinimax() {
    var credential = new ResolvedModelApiKey(10L, MinimaxVideoClient.MODEL, "Mapped channel",
        "http://127.0.0.1:" + server.getAddress().getPort(), "/v1/media/generate",
        "/v1/media/status?task_id={task_id}", "configured-only", Map.of());
    when(modelApiKeys.resolve(MinimaxVideoClient.MODEL,
        ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video"))
        .thenReturn(Optional.of(credential));
    when(modelApiKeys.resolveById(10L, ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION))
        .thenReturn(credential);
    when(modelApiKeys.isFeatureMappingConfigured("canvas-video")).thenReturn(true);
    return credential;
  }

  @Test void canvasSixReferenceImagesUseMappedKeyAndEndpointWithoutSwitchingToHailuo() throws Exception {
    mapCanvasMinimax();
    properties.setApiKey("wrong-default");
    properties.setBaseUrl("http://127.0.0.1:1");
    properties.setMiPerSecondByResolution(Map.of());
    var logs = mock(AiCallLogService.class);
    client.setAiCallLogService(logs);
    List<String> images = java.util.stream.IntStream.range(0, 6)
        .mapToObj(i -> "https://assets.example/ref-" + i + ".png").toList();
    var request = request(15, "768p", images, null, null);

    assertEquals(0, client.price(request));
    var created = client.createTask(request);

    assertEquals("minimax-h3:key:10:123456", created.getTaskId());
    assertEquals(MinimaxVideoClient.MODEL, created.getModel());
    assertEquals("Mapped channel", created.getProvider());
    assertEquals("Bearer configured-only", authorization.get());
    JsonNode body = submitted.get(), params = body.path("params");
    assertEquals(MinimaxVideoClient.MODEL, body.path("model").asText());
    assertEquals("cankaosheng", params.path("mode").asText());
    assertEquals(mapper.valueToTree(images), params.path("image_url"));
    assertEquals("3:4", params.path("aspect_ratio").asText());
    assertEquals("15", params.path("duration").asText());
    assertEquals("768P", params.path("resolution").asText());
    assertFalse(params.has("images"));
    verify(logs).record(eq("canvas-video"), eq("video_generate"), eq("Mapped channel"),
        eq(MinimaxVideoClient.MODEL), eq(10L), eq("dropdown"), eq(true), isNull(), anyLong(), isNull());
  }

  @Test void mappedMinimaxKeepsTextReferenceAndFirstLastFrameProtocols() throws Exception {
    mapCanvasMinimax();
    client.createTask(request(5, "1080p", List.of(), null, null));
    JsonNode params = submitted.get().path("params");
    assertEquals("cankaosheng", params.path("mode").asText());
    assertFalse(params.has("images"));
    assertFalse(params.has("image_url"));
    String first = "https://assets.example/first.png", last = "https://assets.example/last.png";
    client.createTask(request(5, "2k", List.of(first), first, last));
    params = submitted.get().path("params");
    assertEquals("shouweizhen", params.path("mode").asText());
    assertEquals(mapper.valueToTree(List.of(first, last)), params.path("images"));
    assertFalse(params.has("image_url"));
    List<String> nine = java.util.stream.IntStream.range(0, 9)
        .mapToObj(i -> "https://assets.example/" + i + ".png").toList();
    client.createTask(request(5, "768p", nine, null, null));
    assertEquals(9, submitted.get().path("params").path("image_url").size());
    assertThrows(ApiException.class, () -> client.createTask(request(5, "720p", nine, null, null)));
    assertEquals(3, calls.get());
  }

  @Test void mappedQueriesPinTheOriginalKeyEvenIfFeatureMappingChanges() throws Exception {
    mapCanvasMinimax();
    var created = client.createTask(request(5, "768p", List.of(), null, null));
    clearInvocations(modelApiKeys);
    when(modelApiKeys.resolve(MinimaxVideoClient.MODEL,
        ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video"))
        .thenThrow(new ApiException(503, "changed mapping must not be used"));
    properties.setApiKey("wrong-default");
    properties.setBaseUrl("http://127.0.0.1:1");
    response.set("{\"state\":\"running\",\"is_final\":false,\"progress\":\"45%\"}");

    var status = client.getTask(created.getTaskId(), 7L);

    assertEquals("processing", status.getStatus());
    assertEquals(45, status.getProgress());
    assertEquals("Mapped channel", status.getProvider());
    assertEquals("Bearer configured-only", authorization.get());
    verify(modelApiKeys).resolveById(10L, ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION);
    verify(modelApiKeys, never()).resolve(anyString(), anyString(), anyString());
    when(modelApiKeys.resolveById(10L, ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION))
        .thenThrow(new ApiException(503, "original key unavailable"));
    assertThrows(ApiException.class, () -> client.getTask(created.getTaskId(), 7L));
    assertEquals(2, calls.get());
  }

  @Test void missingOrUnreadableMappedKeyDoesNotFallBackToEnvironmentKey() {
    when(modelApiKeys.isFeatureMappingConfigured("canvas-video")).thenReturn(true);
    assertEquals(400, assertThrows(ApiException.class,
        () -> client.createTask(request(5, "768p", List.of(), null, null))).getCode());
    when(modelApiKeys.resolve(MinimaxVideoClient.MODEL,
        ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video"))
        .thenThrow(new ApiException(503, "vault unavailable"));
    assertTrue(assertThrows(ApiException.class,
        () -> client.createTask(request(5, "768p", List.of(), null, null)))
        .getMessage().contains("vault unavailable"));
    assertEquals(0, calls.get());
  }

  @Test void mappedProviderBusinessErrorIsRecordedAgainstSelectedKeyWithoutFallback() {
    mapCanvasMinimax();
    var logs = mock(AiCallLogService.class);
    client.setAiCallLogService(logs);
    response.set("{\"code\":403,\"msg\":\"insufficient provider quota\"}");
    assertTrue(assertThrows(ApiException.class,
        () -> client.createTask(request(5, "768p", List.of(), null, null)))
        .getMessage().contains("insufficient provider quota"));
    assertEquals(1, calls.get());
    assertEquals("Bearer configured-only", authorization.get());
    verify(logs).record(eq("canvas-video"), eq("video_generate"), eq("Mapped channel"),
        eq(MinimaxVideoClient.MODEL), eq(10L), eq("dropdown"), eq(false), eq(502), anyLong(), eq("ApiException"));
  }

  @Test void legacyTaskQueriesKeepEnvironmentCredentialsEvenWhenModelMappingExists() throws Exception {
    mapCanvasMinimax();
    response.set("{\"state\":\"running\",\"is_final\":false,\"progress\":\"45%\"}");
    assertEquals("processing", client.getTask("minimax-h3:123456", 7L).getStatus());
    assertEquals("Bearer test-only", authorization.get());
    verify(modelApiKeys, never()).resolveById(anyLong(), anyString());
  }

  @Test void removedModelIsRejectedBeforeCallingProvider() {
    assertFalse(MinimaxVideoClient.supportsModel("minimax-h3-max"));
    var request = new VideoGenerationDtos.CreateTaskRequest("test", "minimax-h3-max", "16:9", 5);
    assertThrows(ApiException.class, () -> client.createTask(request));
    assertEquals(0, calls.get());
  }

  @Test void configuredModelDiscoveryDoesNotDecryptCredentialsOrCallProvider() {
    var keys = mock(ModelApiKeyService.class);
    when(keys.enabledModelOptions(ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "product-video-video"))
        .thenReturn(List.of(new ModelApiKeyDtos.ModelOption(MinimaxVideoClient.MODEL, "MiniMax H3", "test")));
    when(keys.resolve(anyString(), anyString(), anyString()))
        .thenThrow(new ApiException(503, "vault unavailable"));
    client.setModelApiKeyService(keys);
    assertTrue(client.hasConfiguredHailuoModel("product-video-video"));
    assertTrue(client.usesMappedHailuoAlias(MinimaxVideoClient.MODEL, "product-video-video"));
    assertFalse(client.hasConfiguredHailuoModel("canvas-video"));
    verify(keys, never()).resolve(anyString(), anyString(), anyString());
    var request = new VideoGenerationDtos.CreateTaskRequest("camera move", MinimaxVideoClient.MODEL,
        "adaptive", 5, "768p", List.of("https://assets.example/first.png"),
        "https://assets.example/first.png", null, null, false, null, null, "test", "product-video-video");
    assertThrows(ApiException.class, () -> client.createTask(request));
    assertEquals(0, calls.get());
  }

  @Test void configuredModelDiscoveryRespectsFeatureMappingAndModelAliases() {
    var keys = mock(ModelApiKeyService.class);
    client.setModelApiKeyService(keys);
    assertFalse(client.hasConfiguredHailuoModel("product-video-video"));
    when(keys.enabledModelOptions(ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video"))
        .thenReturn(List.of(new ModelApiKeyDtos.ModelOption("custom-model", MinimaxVideoClient.CONFIGURED_MODEL, "test")));
    assertTrue(client.supportsConfiguredHailuoModel(MinimaxVideoClient.CONFIGURED_MODEL));
    assertFalse(client.supportsConfiguredHailuoModel("other-model"));
    assertFalse(client.hasConfiguredHailuoModel("product-video-video"));
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

  @Test void productVideoReferenceGenerationPreservesAllOriginalImagesAndItsMappedCredential() throws Exception {
    var images = java.util.stream.IntStream.range(1, 6)
        .mapToObj(index -> "https://assets.example/original-" + index + ".png").toList();
    var request = new VideoGenerationDtos.CreateTaskRequest("Full 15-second storyboard",
        MinimaxVideoClient.MODEL, "3:4", 15, "768p", images, null, null,
        null, null, null, null, "references-test", "product-video-video");
    properties.setMiPerSecondByResolution(Map.of());
    assertEquals(0, client.price(request));
    var created = client.createTask(request);
    assertEquals("minimax-h3:key:10:123456", created.getTaskId());
    assertEquals(MinimaxVideoClient.MODEL, submitted.get().path("model").asText());
    var params = submitted.get().path("params");
    assertEquals("cankaosheng", params.path("mode").asText());
    assertEquals("3:4", params.path("aspect_ratio").asText());
    assertEquals("15", params.path("duration").asText());
    assertEquals(mapper.valueToTree(images), params.path("image_url"));
    assertFalse(params.has("images"));
    assertEquals(1, calls.get());
    var credential = modelApiKeys.resolve(MinimaxVideoClient.MODEL,
        ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "product-video-video").orElseThrow();
    when(modelApiKeys.resolveById(10L, ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION)).thenReturn(credential);
    properties.setPersistGeneratedVideos(false);
    response.set("{\"state\":\"success\",\"is_final\":true,\"result_url\":\"https://assets.example/out.mp4\"}");
    assertEquals("completed", client.getTask(created.getTaskId(), 7L).getStatus());
  }

  @Test void productVideoReferenceModeDoesNotFallBackToOtherFeatureCredentials() {
    when(modelApiKeys.resolve(MinimaxVideoClient.MODEL, ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION,
        "product-video-video")).thenReturn(Optional.empty());
    when(modelApiKeys.isFeatureMappingConfigured("product-video-video")).thenReturn(true);
    var request = new VideoGenerationDtos.CreateTaskRequest("whole video", MinimaxVideoClient.MODEL, "3:4", 15,
        "768p", List.of("https://assets.example/1.png", "https://assets.example/2.png"), null, null,
        null, null, null, null, "scoped-test", "product-video-video");
    assertThrows(ApiException.class, () -> client.createTask(request));
    assertEquals(0, calls.get());
  }

  @Test void legacyProductVideoModelUsesMappedMiniH3AndReportedCost() throws Exception {
    var request = new VideoGenerationDtos.CreateTaskRequest("slow camera move",
        MinimaxVideoClient.MODEL, "adaptive", 5, "768p",
        List.of("https://assets.example/first.png"), "https://assets.example/first.png", null,
        null, false, null, null, "client-id", "product-video-video");
    properties.setMiPerSecondByResolution(Map.of());

    assertTrue(client.usesMappedHailuoAlias(request.model(), request.featureCode()));
    assertEquals(0, client.price(request));
    var created = client.createTask(request);

    assertEquals("hailuo-h3:key:10:123456", created.getTaskId());
    assertEquals(MinimaxVideoClient.CONFIGURED_MODEL, submitted.get().path("model").asText());
    assertEquals("slow camera move", submitted.get().path("prompt").asText());
    assertEquals(1, submitted.get().path("params").path("images").size());
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
