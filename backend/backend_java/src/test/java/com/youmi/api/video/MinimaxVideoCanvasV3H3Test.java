package com.youmi.api.video;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
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
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.mock.env.MockEnvironment;

class MinimaxVideoCanvasV3H3Test {
  private final ObjectMapper mapper = new ObjectMapper();
  private final MinimaxVideoProperties properties = new MinimaxVideoProperties();
  private final ModelApiKeyService keys = mock(ModelApiKeyService.class);
  private final AtomicReference<JsonNode> submitted = new AtomicReference<>();
  private final AtomicReference<String> response = new AtomicReference<>("{\"code\":200,\"data\":{\"task_id\":\"0009007199254740993100009\"}}");
  private final AtomicReference<String> authorization = new AtomicReference<>();
  private final AtomicReference<String> query = new AtomicReference<>();
  private final AtomicInteger calls = new AtomicInteger();
  private HttpServer server;
  private String base;
  private MinimaxVideoClient client;

  @BeforeEach void setup() throws Exception {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/v1/media/", exchange -> {
      calls.incrementAndGet();
      authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
      query.set(exchange.getRequestURI().getQuery());
      if (exchange.getRequestMethod().equals("POST")) submitted.set(mapper.readTree(exchange.getRequestBody()));
      byte[] bytes = response.get().getBytes(StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(200, bytes.length);
      exchange.getResponseBody().write(bytes);
      exchange.close();
    });
    server.start();
    base = "http://127.0.0.1:" + server.getAddress().getPort();
    properties.setBaseUrl(base);
    properties.setApiKey("environment-key");
    properties.setMiPerSecondByResolution(Map.of("768p", 5, "1080p", 10, "2k", 15, "4k", 30));
    properties.setPersistGeneratedVideos(false);
    client = new MinimaxVideoClient(properties, mock(VideoGenerationClient.class), mapper);
    client.setModelApiKeyService(keys);
  }

  @AfterEach void stop() { server.stop(0); }

  private ObjectNode input() {
    ObjectNode value = mapper.createObjectNode();
    value.put("prompt", "  白鹭掠过湖面  ");
    value.put("model", "minimax-h3");
    value.put("parameter_profile", MinimaxVideoClient.CANVAS_V3_PROFILE);
    value.put("feature_code", "canvas-video");
    value.put("durationSeconds", 5);
    value.put("resolution", "768P");
    value.put("ratio", "16:9");
    return value;
  }

  private VideoGenerationDtos.CreateTaskRequest request(ObjectNode value) throws Exception {
    return mapper.treeToValue(value, VideoGenerationDtos.CreateTaskRequest.class);
  }

  private ResolvedModelApiKey mapped(String nativeModel, String generationPath, String taskPath) {
    var credential = new ResolvedModelApiKey(73L, nativeModel, "Editable channel", base,
        generationPath, taskPath, "original-route-key", Map.of("seed", 99, "web_search", true));
    when(keys.resolveFeatureRouteOption("model-api-key:73", ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video"))
        .thenReturn(Optional.of(credential));
    when(keys.resolveById(73L, ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION)).thenReturn(credential);
    when(keys.isFeatureMappingConfigured("canvas-video")).thenReturn(true);
    return credential;
  }

  private ResolvedModelApiKey mapped() {
    return mapped("MiniMax-H3", "/v1/media/generate", "/v1/media/status?task_id={task_id}");
  }

  @Test void opaqueRouteUsesDocumentedMultimodalBodyAndDoesNotForwardLocalOrForeignOptions() throws Exception {
    mapped();
    properties.setApiKey("");
    properties.setMiPerSecondByResolution(Map.of());
    ObjectNode value = input();
    value.put("model", "model-api-key:73");
    value.put("mode", "cankaosheng");
    value.put("resolution", "2K");
    value.put("ratio", "adaptive");
    value.put("seed", 42);
    value.put("web_search", true);
    value.put("generate_audio", false);
    value.put("webhook_url", "https://our.example/callback");
    value.putArray("reference_image_urls").add("https://assets.example/ref.png");
    value.putArray("reference_videos").addObject().put("url", "https://assets.example/ref.mp4").put("durationSeconds", 4.5);
    value.putArray("reference_audios").add("https://assets.example/ref.mp3");
    var request = request(value);

    assertEquals(0, client.price(request));
    var created = client.createTask(request);

    assertEquals("minimax-h3:key:73:0009007199254740993100009", created.getTaskId());
    assertEquals("model-api-key:73", created.getModel());
    assertEquals("Bearer original-route-key", authorization.get());
    JsonNode body = submitted.get();
    assertEquals(4, body.size());
    assertEquals("minimax-h3", body.path("model").asText());
    assertEquals("白鹭掠过湖面", body.path("prompt").asText());
    assertEquals("https://our.example/callback", body.path("notify_url").asText());
    JsonNode params = body.path("params");
    assertEquals(7, params.size());
    assertEquals("cankaosheng", params.path("mode").asText());
    assertEquals("5", params.path("duration").textValue());
    assertEquals("2K", params.path("resolution").asText());
    assertEquals("adaptive", params.path("aspect_ratio").asText());
    assertEquals(mapper.valueToTree(List.of("https://assets.example/ref.png")), params.path("image_url"));
    assertEquals(mapper.valueToTree(List.of("https://assets.example/ref.mp4")), params.path("video_url"));
    assertEquals(mapper.valueToTree(List.of("https://assets.example/ref.mp3")), params.path("audio_url"));
    assertFalse(body.has("parameter_profile"));
    assertFalse(body.has("content"));
    for (String name : List.of("images", "seed", "generate_audio", "web_search", "notify_url", "reference_videos"))
      assertFalse(params.has(name), name);
    assertEquals(1, calls.get());
  }

  @Test void inputMediaOverridesStaleModesAndPreservesOrderedFrames() throws Exception {
    ObjectNode value = input();
    for (String mode : List.of("shouweizhen", "cankaosheng")) {
      value.put("mode", mode);
      client.createTask(request(value));
      JsonNode params = submitted.get().path("params");
      assertEquals("cankaosheng", params.path("mode").asText());
      assertFalse(params.has("images"));
      assertFalse(params.has("image_url"));
    }
    value.put("mode", "shouweizhen");
    value.put("first_frame_url", "https://assets.example/first.png");
    value.put("last_frame_url", "https://assets.example/last.png");
    client.createTask(request(value));
    assertEquals(mapper.valueToTree(List.of("https://assets.example/first.png", "https://assets.example/last.png")),
        submitted.get().path("params").path("images"));
    assertFalse(submitted.get().path("params").has("image_url"));
    value.remove(List.of("first_frame_url", "last_frame_url"));
    value.putArray("image_urls").add("https://assets.example/first.png").add("https://assets.example/last.png");
    client.createTask(request(value));
    assertEquals(2, submitted.get().path("params").path("images").size());
  }

  @Test void unassignedImageCountInfersFramesOrReferencesAndKeepsDuplicateFramePositions() throws Exception {
    for (int count : List.of(1, 2, 3)) {
      ObjectNode value = input().put("mode", "obsolete-manual-choice");
      var images = value.putArray("image_urls");
      for (int i = 0; i < count; i++) images.add("https://assets.example/same.png");
      client.createTask(request(value));
      var params = submitted.get().path("params");
      assertEquals(count > 2 ? "cankaosheng" : "shouweizhen", params.path("mode").asText());
      assertEquals(count, params.path(count > 2 ? "image_url" : "images").size());
      assertFalse(params.has(count > 2 ? "images" : "image_url"));
    }
  }

  @Test void mediaProtocolPreservesAllSevenRatiosForTextFramesAndReferences() throws Exception {
    for (String ratio : List.of("adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9")) {
      for (String inputKind : List.of("text", "first", "first-last", "reference", "multimodal")) {
        ObjectNode value = input().put("ratio", ratio);
        if (inputKind.equals("first") || inputKind.equals("first-last"))
          value.put("first_frame_url", "https://assets.example/first.png");
        if (inputKind.equals("first-last"))
          value.put("last_frame_url", "https://assets.example/last.png");
        if (inputKind.equals("reference") || inputKind.equals("multimodal"))
          value.putArray("reference_image_urls").add("https://assets.example/ref.png");
        if (inputKind.equals("multimodal"))
          value.putArray("reference_audios").add("https://assets.example/ref.mp3");
        client.createTask(request(value));
        assertEquals(ratio, submitted.get().path("params").path("aspect_ratio").asText(),
            inputKind + " must retain ratio " + ratio);
      }
    }
    ObjectNode noRatio = input();
    noRatio.remove("ratio");
    client.createTask(request(noRatio));
    assertEquals("adaptive", submitted.get().path("params").path("aspect_ratio").asText());
    assertEquals(36, calls.get());
  }

  @Test void audioAndVideoForceReferenceModeAndCarryEveryInputImageWithoutFrameMixing() throws Exception {
    mapped();
    ObjectNode value = input().put("model", "model-api-key:73").put("mode", "shouweizhen")
        .put("first_frame_url", "https://assets.example/same.png")
        .put("last_frame_url", "https://assets.example/same.png");
    value.putArray("reference_image_urls").add("https://assets.example/ref.png");
    value.putArray("reference_videos").addObject().put("url", "https://assets.example/ref.mp4").put("durationSeconds", 2.5);
    value.putArray("reference_audios").add("https://assets.example/ref.mp3");
    client.createTask(request(value));
    var params = submitted.get().path("params");
    assertEquals("cankaosheng", params.path("mode").asText());
    assertFalse(params.has("images"));
    assertEquals(mapper.valueToTree(List.of("https://assets.example/same.png", "https://assets.example/same.png", "https://assets.example/ref.png")), params.path("image_url"));
    assertEquals("https://assets.example/ref.mp4", params.path("video_url").get(0).asText());
    assertEquals("https://assets.example/ref.mp3", params.path("audio_url").get(0).asText());
  }

  @Test void supportsUsesNativeIdentityAndNeverEditableLabelsOrHailuoAliases() {
    assertTrue(client.supportsCanvasV3H3("minimax-h3", "canvas-video"));
    assertTrue(client.supportsCanvasV3H3("MiniMax-H3", null));
    assertFalse(client.supportsCanvasV3H3("hailuo-h3-shouweizhen", "canvas-video"));
    assertFalse(client.supportsCanvasV3H3("minimax-h3", "product-video-video"));
    assertFalse(client.supportsCanvasV3H3("model-api-key:73", "canvas-video"));
    mapped();
    assertTrue(client.supportsCanvasV3H3("model-api-key:73", "canvas-video"));
    assertFalse(client.supportsCanvasV3H3("minimax-h3", "canvas-video"));
    mapped("hailuo-h3-shouweizhen", "/v1/media/generate", "/v1/media/status?task_id={task_id}");
    assertFalse(client.supportsCanvasV3H3("model-api-key:73", "canvas-video"));
    mapped("seedance-2.5", "/v1/media/generate", "/v1/media/status?task_id={task_id}");
    assertFalse(client.supportsCanvasV3H3("model-api-key:73", "canvas-video"));
    assertEquals(0, calls.get());
  }

  @Test void referenceModeAcceptsTheDocumentedMaximumCountsAndHighestTier() throws Exception {
    mapped();
    ObjectNode value = input().put("model", "model-api-key:73").put("mode", "cankaosheng")
        .put("durationSeconds", 15).put("resolution", "4K").put("ratio", "21:9");
    var images = value.putArray("reference_image_urls");
    for (int index = 0; index < 9; index++) images.add("https://assets.example/" + index + ".png");
    var videos = value.putArray("reference_videos");
    var audios = value.putArray("reference_audios");
    for (int index = 0; index < 3; index++) {
      videos.addObject().put("url", "https://assets.example/" + index + ".mp4");
      audios.add("https://assets.example/" + index + ".mp3");
    }
    client.createTask(request(value));
    JsonNode params = submitted.get().path("params");
    assertEquals(9, params.path("image_url").size());
    assertEquals(3, params.path("video_url").size());
    assertEquals(3, params.path("audio_url").size());
    assertEquals("15", params.path("duration").textValue());
    assertEquals("4K", params.path("resolution").asText());
    assertEquals("21:9", params.path("aspect_ratio").asText());
  }

  @Test void allInvalidInputsFailBeforeAnUpstreamPost() throws Exception {
    for (ObjectNode value : List.of(
        input().put("prompt", " "), input().put("prompt", "字".repeat(7001)),
        input().put("durationSeconds", 3), input().put("durationSeconds", 16),
        input().put("resolution", "720P"), input().put("ratio", "2:1"),
        input().put("feature_code", "unmapped"),
        input().put("last_frame_url", "https://assets.example/last.png"),
        input().put("webhook_url", "javascript:alert(1)"))) {
      assertEquals(400, assertThrows(ApiException.class, () -> client.createTask(request(value))).getCode());
    }
    for (String name : List.of("reference_image_urls", "reference_audios", "image_urls")) {
      ObjectNode invalid = input();
      invalid.putArray(name).add("data:image/png;base64,AAAA");
      assertThrows(ApiException.class, () -> client.createTask(request(invalid)));
    }
    for (String name : List.of("reference_image_urls")) {
      ObjectNode mixed = input().put("mode", "shouweizhen").put("first_frame_url", "https://assets.example/first.png");
      if (name.equals("reference_videos")) mixed.putArray(name).addObject().put("url", "https://assets.example/ref.mp4");
      else mixed.putArray(name).add("https://assets.example/ref");
      assertThrows(ApiException.class, () -> client.createTask(request(mixed)));
    }
    for (String name : List.of("reference_image_urls", "reference_audios", "reference_videos", "image_urls")) {
      ObjectNode tooMany = input();
      var urls = tooMany.putArray(name);
      int count = name.equals("reference_image_urls") || name.equals("image_urls") ? 10 : 4;
      for (int index = 0; index < count; index++) {
        if (name.equals("reference_videos")) urls.addObject().put("url", "https://assets.example/" + index + ".mp4");
        else urls.add("https://assets.example/" + index);
      }
      assertThrows(ApiException.class, () -> client.createTask(request(tooMany)));
    }
    assertEquals(0, calls.get());
  }

  @Test void promotedFrameImagesCountTowardTheReferenceLimitWithoutDeduplication() throws Exception {
    mapped();
    ObjectNode value = input().put("model", "model-api-key:73")
        .put("first_frame_url", "https://assets.example/same.png")
        .put("last_frame_url", "https://assets.example/same.png");
    var images = value.putArray("reference_image_urls");
    for (int i = 0; i < 8; i++) images.add("https://assets.example/same.png");
    value.putArray("reference_audios").add("https://assets.example/audio.mp3");
    assertEquals(400, assertThrows(ApiException.class, () -> client.createTask(request(value))).getCode());
    assertEquals(0, calls.get());
  }

  @Test void wrongProtocolEndpointsAreRejectedRatherThanConverted() throws Exception {
    ObjectNode value = input().put("model", "model-api-key:73");
    for (String generation : List.of("/v2/video_generation", "/api/v3/contents/generations/tasks", "/v1/media/generate?native=true")) {
      mapped("MiniMax-H3", generation, "/v1/media/status?task_id={task_id}");
      assertEquals(503, assertThrows(ApiException.class, () -> client.createTask(request(value))).getCode());
    }
    for (String status : List.of("/v2/query/video_generation/{task_id}", "/v1/media/status/{task_id}",
        "/v1/media/status?wrong={task_id}", "/v1/media/status?task_id=123&other=unsupported")) {
      mapped("MiniMax-H3", "/v1/media/generate", status);
      assertEquals(503, assertThrows(ApiException.class, () -> client.createTask(request(value))).getCode());
    }
    assertEquals(0, calls.get());
  }

  @Test void queriesPinTheOriginalCredentialAndOnlyBooleanFinalAndStateReleaseTheResult() throws Exception {
    mapped();
    String taskId = client.createTask(request(input().put("model", "model-api-key:73"))).getTaskId();
    clearInvocations(keys);
    when(keys.resolveFeatureRouteOption(anyString(), anyString(), anyString()))
        .thenThrow(new ApiException(503, "mapping changed"));
    for (String finalValue : List.of("false", "\"true\"")) {
      response.set("{\"state\":\"success\",\"is_final\":" + finalValue + ",\"status\":\"已完成\",\"result_url\":\"https://assets.example/out.mp4\"}");
      assertEquals("processing", client.getTask(taskId, 9L).getStatus());
    }
    response.set("{\"state\":\"running\",\"is_final\":false,\"status\":\"已完成\",\"progress\":\"45%\"}");
    var running = client.getTask(taskId, 9L);
    assertEquals("processing", running.getStatus());
    assertEquals(45, running.getProgress());
    response.set("{\"state\":\"success\",\"is_final\":true}");
    assertThrows(ApiException.class, () -> client.getTask(taskId, 9L));
    response.set("{\"state\":\"success\",\"is_final\":true,\"status\":\"处理中\",\"result_url\":\"https://assets.example/out.mp4\",\"cost\":0.75}");
    var completed = client.getTask(taskId, 9L);
    assertEquals("completed", completed.getStatus());
    assertEquals(List.of("https://assets.example/out.mp4"), completed.getVideoUrls());
    assertEquals(0.75, completed.getRaw().path("cost").asDouble());
    assertEquals("task_id=0009007199254740993100009", query.get());
    assertEquals("Bearer original-route-key", authorization.get());
    response.set("{\"state\":\"failed\",\"is_final\":true,\"status\":\"已完成\",\"error\":\"provider reason\"}");
    assertEquals("provider reason", client.getTask(taskId, 9L).getError());
    verify(keys, never()).resolveFeatureRouteOption(anyString(), anyString(), anyString());
    verify(keys, never()).resolve(anyString(), anyString(), anyString());
  }

  @Test void directReferenceVideosRequireExplicitInputRateAndKnownDurations() throws Exception {
    ObjectNode value = input().put("mode", "cankaosheng");
    value.putArray("reference_videos").addObject().put("url", "https://assets.example/ref.mp4").put("durationSeconds", 2.5);
    assertEquals(503, assertThrows(ApiException.class, () -> client.createTask(request(value))).getCode());
    assertEquals(0, calls.get());
    properties.setInputVideoMiPerSecondByResolution(Map.of("768p", 7));
    value.withArray("reference_videos").addObject().put("url", "https://assets.example/ref2.mp4").put("durationSeconds", 3.1);
    assertEquals(67, client.price(request(value))); // 5 output sec * 5 + ceil(5.6 input sec) * 7.
    client.createTask(request(value));
    assertEquals(2, submitted.get().path("params").path("video_url").size());
    ObjectNode unknownDuration = input();
    unknownDuration.putArray("reference_videos").addObject().put("url", "https://assets.example/ref.mp4");
    assertEquals(400, assertThrows(ApiException.class, () -> client.createTask(request(unknownDuration))).getCode());
    assertEquals(1, calls.get());
  }

  @Test void inputRateHasNoImplicitDefaultAndBindsIndependentlyFromOutputRate() {
    var environment = new MockEnvironment().withProperty("youmi.minimax-video.mi-per-second-by-resolution.768p", "5")
        .withProperty("youmi.minimax-video.input-video-mi-per-second-by-resolution.768p", "7");
    var configured = Binder.get(environment).bind("youmi.minimax-video", Bindable.of(MinimaxVideoProperties.class)).get();
    assertEquals(5, configured.rate("768p"));
    assertEquals(7, configured.inputVideoRate("768p"));
    assertEquals(0, configured.inputVideoRate("2k"));
    configured.setInputVideoMiPerSecondByResolution(null);
    assertEquals(0, configured.inputVideoRate("768p"));
    assertEquals(5, configured.rate("768p"));
  }

  @Test void propertyFallbackAvailabilityRequiresAConfiguredKeyAndAtLeastOneOutputRate() {
    assertTrue(client.availableCanvasV3H3());
    properties.setApiKey("");
    assertFalse(client.availableCanvasV3H3());
    properties.setApiKey("environment-key");
    properties.setMiPerSecondByResolution(Map.of());
    assertFalse(client.availableCanvasV3H3());
  }

  @Test void anUpstreamErrorCannotExposeTheV3RouteApiKey() throws Exception {
    mapped();
    response.set("{\"code\":403,\"msg\":\"Invalid API key original-route-key\"}");
    var error = assertThrows(ApiException.class,
        () -> client.createTask(request(input().put("model", "model-api-key:73"))));
    assertFalse(error.getMessage().contains("original-route-key"));
    assertTrue(error.getMessage().contains("[redacted]"));
    assertNull(error.getCause());
    assertEquals(1, calls.get());
  }

  @Test void unmarkedLegacyCallsKeepTheirOldPayloadEvenWhenNewFieldsArePresent() throws Exception {
    ObjectNode value = input();
    value.remove("parameter_profile");
    value.put("mode", "invalid-new-mode");
    value.put("webhook_url", "https://our.example/ignored-legacy");
    value.putArray("reference_image_urls").add("https://assets.example/new-reference.png");
    value.putArray("reference_videos").addObject().put("url", "https://assets.example/ref.mp4");
    value.putArray("reference_audios").add("https://assets.example/ref.mp3");
    assertEquals(25, client.price(request(value)));
    client.createTask(request(value));
    JsonNode body = submitted.get();
    assertEquals(3, body.size());
    assertEquals(4, body.path("params").size());
    assertEquals("cankaosheng", body.path("params").path("mode").asText());
    assertEquals("Bearer environment-key", authorization.get());
    assertFalse(body.has("notify_url"));
    assertFalse(body.path("params").has("video_url"));
    assertFalse(body.path("params").has("audio_url"));
    assertFalse(body.path("params").has("image_url"));
  }
}
