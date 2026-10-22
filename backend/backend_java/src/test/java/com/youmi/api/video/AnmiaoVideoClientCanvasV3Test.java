package com.youmi.api.video;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.youmi.api.common.ApiException;
import com.youmi.api.image.ModelApiKeyService;
import java.io.IOException;
import java.math.BigDecimal;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.IntStream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class AnmiaoVideoClientCanvasV3Test {
  final ObjectMapper mapper = new ObjectMapper();
  final VideoGenerationClient media = mock(VideoGenerationClient.class);
  final ModelApiKeyService keys = mock(ModelApiKeyService.class);
  final AtomicReference<JsonNode> body = new AtomicReference<>();
  final AtomicReference<String> authorization = new AtomicReference<>();
  final AtomicReference<String> path = new AtomicReference<>();
  final AtomicReference<String> statusResponse = new AtomicReference<>("{\"status\":\"running\"}");
  final AtomicReference<String> createResponse = new AtomicReference<>("{\"id\":\"009007199254740993123\"}");
  final AtomicInteger calls = new AtomicInteger();
  HttpServer server;
  AnmiaoVideoProperties properties;

  @BeforeEach void start() throws IOException {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/contents/generations/tasks", exchange -> {
      calls.incrementAndGet();
      authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
      path.set(exchange.getRequestURI().getPath());
      if ("POST".equals(exchange.getRequestMethod())) {
        body.set(mapper.readTree(exchange.getRequestBody()));
        respond(exchange, 200, createResponse.get());
      } else respond(exchange, 200, statusResponse.get());
    });
    server.start();
    properties = new AnmiaoVideoProperties();
    properties.setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort());
    properties.setApiKey25("test-only-25-key");
    properties.setMiPerSecond25ByResolution(Map.of("480p", 1, "720p", 2, "1080p", 3));
    properties.setPersistGeneratedVideos(false);
    properties.setTimeoutSeconds(5);
  }

  @AfterEach void stop() { server.stop(0); }

  AnmiaoVideoClient client() { return new AnmiaoVideoClient(properties, media, mapper, keys, null); }

  VideoGenerationDtos.CreateTaskRequest request(String prompt, String model, String ratio, int seconds,
      String resolution, String first, String last, List<String> images,
      List<VideoGenerationDtos.ReferenceVideo> videos, List<String> audios, Boolean search, String callback) {
    return new VideoGenerationDtos.CreateTaskRequest(prompt, model, ratio, seconds, resolution,
        List.of(), first, last, "ignored negative", false, 123L, callback, "client-25",
        "canvas-video", videos, AnmiaoVideoClient.CANVAS_V3_SEEDANCE25, images, audios, search);
  }

  VideoGenerationDtos.CreateTaskRequest textRequest(String ratio, int seconds, String resolution) {
    return request("  清晨的海边  ", AnmiaoVideoClient.MODEL25, ratio, seconds, resolution,
        null, null, List.of(), List.of(), List.of(), false, null);
  }

  @Test void nativeTextBodyIsAllowlistedAndLongNumericIdRemainsAStringAcrossPolls() throws Exception {
    var input = textRequest("16:9", 30, "1080P");
    assertEquals(new BigDecimal("90.00"), client().quoteCanvasV3Seedance25(input));
    var created = client().createTask(input);
    assertEquals("anmiao-video:v3-25:25:009007199254740993123", created.getTaskId());
    assertEquals("queued", created.getStatus());
    assertEquals("Bearer test-only-25-key", authorization.get());
    assertEquals(AnmiaoVideoClient.MODEL25, body.get().path("model").asText());
    assertEquals("1080p", body.get().path("resolution").asText());
    assertEquals("16:9", body.get().path("ratio").asText());
    assertEquals(30, body.get().path("duration").asInt());
    assertEquals(1, body.get().path("content").size());
    assertEquals("清晨的海边", body.get().path("content").get(0).path("text").asText());
    assertEquals(5, body.get().size());
    for (String name : List.of("parameter_profile", "prompt", "params", "web_search", "mode", "seed",
        "generate_audio", "negative_prompt", "tools", "omni_reference_task_type"))
      assertFalse(body.get().has(name), name);
    var running = client().getTask(created.getTaskId(), 5L);
    assertEquals("processing", running.getStatus());
    assertTrue(path.get().endsWith("/009007199254740993123"));
    assertEquals("Bearer test-only-25-key", authorization.get());
    assertEquals("1080P", input.resolution());
    verifyNoInteractions(media);
  }

  @Test void defaultRatioAndResolutionFollowNativeDefaultsAndSingleReferenceIsNotPromotedToFirstFrame() throws Exception {
    client().createTask(textRequest(null, 4, null));
    assertEquals("adaptive", body.get().path("ratio").asText());
    assertEquals("720p", body.get().path("resolution").asText());
    var input = request("", AnmiaoVideoClient.MODEL25, "3:4", 8, "720P", null, null,
        List.of(" https://assets.example/product.png "), List.of(), List.of(), true,
        " https://callback.example/task ");
    client().createTask(input);
    assertEquals(1, body.get().path("content").size());
    assertEquals("reference_image", body.get().path("content").get(0).path("role").asText());
    assertEquals("https://assets.example/product.png",
        body.get().path("content").get(0).path("image_url").path("url").asText());
    assertEquals("web_search", body.get().path("tools").get(0).path("type").asText());
    assertEquals("https://callback.example/task", body.get().path("callback_url").asText());
  }

  @Test void explicitFirstAndLastRolesAndAudioOnlyInputsDoNotRequireText() throws Exception {
    client().createTask(request(null, AnmiaoVideoClient.MODEL25, "adaptive", 4, "480p",
        "https://assets.example/first.png", "https://assets.example/last.png", List.of(), List.of(), List.of(), null, null));
    assertEquals(2, body.get().path("content").size());
    assertEquals("first_frame", body.get().path("content").get(0).path("role").asText());
    assertEquals("last_frame", body.get().path("content").get(1).path("role").asText());
    client().createTask(request("", AnmiaoVideoClient.MODEL25, "9:16", 5, "720p",
        null, null, List.of(), List.of(), List.of("https://assets.example/audio.mp3"), false, null));
    assertEquals("audio_url", body.get().path("content").get(0).path("type").asText());
    assertEquals("reference_audio", body.get().path("content").get(0).path("role").asText());
    assertFalse(body.get().has("tools"));
  }

  @Test void textAndReferenceInputsPreserveAllSevenDocumentedRatios() throws Exception {
    for (String ratio : List.of("adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9")) {
      client().createTask(textRequest(ratio, 4, "720p"));
      assertEquals(ratio, body.get().path("ratio").asText(), "text ratio");
      client().createTask(request("", AnmiaoVideoClient.MODEL25, ratio, 4, "720p", null, null,
          List.of("https://assets.example/ref.png"), List.of(), List.of(), false, null));
      assertEquals(ratio, body.get().path("ratio").asText(), "reference image ratio");
      client().createTask(request("", AnmiaoVideoClient.MODEL25, ratio, 4, "720p",
          "https://assets.example/first.png", "https://assets.example/last.png", List.of(), List.of(),
          List.of("https://assets.example/audio.mp3"), false, null));
      assertEquals(ratio, body.get().path("ratio").asText(), "audio makes this reference, not a frame-only task");
      assertEquals("reference_image", body.get().path("content").get(0).path("role").asText());
    }
    assertEquals(21, calls.get());
  }

  @Test void onlySingleFirstFrameIsRestrictedWhileFirstLastFramesPreserveAllSevenRatios() throws Exception {
    for (String ratio : List.of("16:9", "4:3", "1:1", "3:4", "9:16", "21:9")) {
      var error = assertThrows(ApiException.class, () -> client().createTask(request("", AnmiaoVideoClient.MODEL25,
          ratio, 4, "720p", "https://assets.example/first.png", null, List.of(), List.of(), List.of(), false, null)));
      assertEquals(400, error.getCode());
      assertTrue(error.getMessage().contains("自适应"));
    }
    assertEquals(0, calls.get(), "non-adaptive single-frame tasks must fail before any upstream POST");
    client().createTask(request("", AnmiaoVideoClient.MODEL25, "adaptive", 4, "720p",
        "https://assets.example/first.png", null, List.of(), List.of(), List.of(), false, null));
    assertEquals("adaptive", body.get().path("ratio").asText());
    for (String ratio : List.of("adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9")) {
      client().createTask(request("", AnmiaoVideoClient.MODEL25, ratio, 4, "720p",
          "https://assets.example/first.png", "https://assets.example/last.png", List.of(), List.of(), List.of(), false, null));
      assertEquals(ratio, body.get().path("ratio").asText(), "first-last frames must retain selected ratio");
      assertEquals("first_frame", body.get().path("content").get(0).path("role").asText());
      assertEquals("last_frame", body.get().path("content").get(1).path("role").asText());
    }
    assertEquals(8, calls.get());
  }

  @Test void inferredTwoImageFramesAlsoPreserveConcreteRatioInsteadOfForcingAdaptive() throws Exception {
    var tree = (com.fasterxml.jackson.databind.node.ObjectNode) mapper.valueToTree(textRequest("9:16", 4, "720p"));
    tree.putArray("image_urls").add("https://assets.example/first.png").add("https://assets.example/last.png");
    client().createTask(mapper.treeToValue(tree, VideoGenerationDtos.CreateTaskRequest.class));
    assertEquals("9:16", body.get().path("ratio").asText());
    assertEquals("first_frame", body.get().path("content").get(1).path("role").asText());
    assertEquals("last_frame", body.get().path("content").get(2).path("role").asText());
  }

  @Test void omniReferenceNormalizesAllImagesToReferencesWithoutOmittingFramesOrMedia() throws Exception {
    configureFreeInputReferenceLine();
    var input = request("镜头缓慢推进", AnmiaoVideoClient.MODEL25, "16:9", 12, "720p",
        "https://assets.example/first.png", "https://assets.example/last.png",
        List.of("https://assets.example/product.png"),
        List.of(new VideoGenerationDtos.ReferenceVideo("https://assets.example/movement.mp4", null)),
        List.of("https://assets.example/voice.mp3"), true, null);
    client().createTask(input);
    var roles = new ArrayList<String>();
    for (var item : body.get().path("content")) if (item.has("role")) roles.add(item.path("role").asText());
    assertEquals(List.of("reference_image", "reference_image", "reference_image", "reference_video", "reference_audio"), roles);
    assertEquals("https://assets.example/first.png", body.get().path("content").get(1).path("image_url").path("url").asText());
    assertEquals("https://assets.example/last.png", body.get().path("content").get(2).path("image_url").path("url").asText());
    assertFalse(body.get().has("generate_audio"));
    assertFalse(body.get().has("omni_reference_task_type"));
  }

  @Test void unassignedImagesInferOneOrTwoFramesAndLargerGroupsAsReferences() throws Exception {
    for (int count : List.of(1, 2, 3)) {
      var tree = (com.fasterxml.jackson.databind.node.ObjectNode) mapper.valueToTree(textRequest("adaptive", 4, "720p"));
      var urls = tree.putArray("image_urls");
      for (int i = 0; i < count; i++) urls.add("https://assets.example/" + i + ".png");
      tree.put("mode", "stale-manual-mode");
      client().createTask(mapper.treeToValue(tree, VideoGenerationDtos.CreateTaskRequest.class));
      var content = body.get().path("content");
      assertEquals(count + 1, content.size());
      for (int i = 0; i < count; i++) {
        assertEquals(count > 2 ? "reference_image" : i == 0 ? "first_frame" : "last_frame", content.get(i + 1).path("role").asText());
        assertEquals("https://assets.example/" + i + ".png", content.get(i + 1).path("image_url").path("url").asText());
      }
    }
  }

  @Test void duplicateFrameUrlsKeepBothRolesAndOmniCountCannotBeHiddenByDeduplication() throws Exception {
    String same = "https://assets.example/loop.png";
    client().createTask(request("", AnmiaoVideoClient.MODEL25, "adaptive", 4, "720p", same, same,
        List.of(), List.of(), List.of(), false, null));
    assertEquals("first_frame", body.get().path("content").get(0).path("role").asText());
    assertEquals("last_frame", body.get().path("content").get(1).path("role").asText());
    var tooMany = java.util.Collections.nCopies(29, same);
    var error = assertThrows(ApiException.class, () -> client().createTask(request("test", AnmiaoVideoClient.MODEL25,
        "adaptive", 4, "720p", same, same, tooMany, List.of(), List.of("https://assets.example/audio.mp3"), false, null)));
    assertEquals(400, error.getCode());
    assertEquals(1, calls.get());
  }

  @Test void unassignedImagesWithAudioBecomeReferencesAndRetainEveryPosition() throws Exception {
    var tree = (com.fasterxml.jackson.databind.node.ObjectNode) mapper.valueToTree(textRequest("16:9", 4, "720p"));
    tree.putArray("image_urls").add("https://assets.example/same.png").add("https://assets.example/same.png");
    tree.putArray("reference_audios").add("https://assets.example/audio.mp3");
    client().createTask(mapper.treeToValue(tree, VideoGenerationDtos.CreateTaskRequest.class));
    assertEquals(4, body.get().path("content").size());
    assertEquals("reference_image", body.get().path("content").get(1).path("role").asText());
    assertEquals("reference_image", body.get().path("content").get(2).path("role").asText());
    assertEquals("reference_audio", body.get().path("content").get(3).path("role").asText());
  }

  @Test void exactDocumentedAssetCountsPassAndAdditionalItemsRejectBeforeSubmit() throws Exception {
    configureFreeInputReferenceLine();
    var images = IntStream.range(0, 30).mapToObj(i -> "https://assets.example/" + i + ".png").toList();
    var videos = IntStream.range(0, 10).mapToObj(i ->
        new VideoGenerationDtos.ReferenceVideo("https://assets.example/" + i + ".mp4", null)).toList();
    var audios = IntStream.range(0, 10).mapToObj(i -> "https://assets.example/" + i + ".mp3").toList();
    client().createTask(request("", AnmiaoVideoClient.MODEL25, "1:1", 4, "480p", null, null,
        images, videos, audios, false, null));
    assertEquals(50, body.get().path("content").size());
    var tooManyImages = new ArrayList<>(images); tooManyImages.add("https://assets.example/extra.png");
    var tooManyVideos = new ArrayList<>(videos); tooManyVideos.add(videos.get(0));
    var tooManyAudios = new ArrayList<>(audios); tooManyAudios.add(audios.get(0));
    assertThrows(ApiException.class, () -> client().createTask(request("", AnmiaoVideoClient.MODEL25,
        "1:1", 4, "480p", null, null, tooManyImages, videos, audios, false, null)));
    assertThrows(ApiException.class, () -> client().createTask(request("", AnmiaoVideoClient.MODEL25,
        "1:1", 4, "480p", null, null, images, tooManyVideos, audios, false, null)));
    assertThrows(ApiException.class, () -> client().createTask(request("", AnmiaoVideoClient.MODEL25,
        "1:1", 4, "480p", null, null, images, videos, tooManyAudios, false, null)));
    assertEquals(1, calls.get());
  }

  @Test void rejectsUnsupportedOutputAndRoleCombinationsBeforeSubmitting() {
    for (int seconds : new int[] { -1, 3, 31 })
      assertThrows(ApiException.class, () -> client().createTask(textRequest("adaptive", seconds, "720p")));
    assertThrows(ApiException.class, () -> client().createTask(textRequest("16:9", 4, "4K")));
    assertThrows(ApiException.class, () -> client().createTask(textRequest("1:2", 4, "720p")));
    assertThrows(ApiException.class, () -> client().createTask(request("", AnmiaoVideoClient.MODEL25,
        "adaptive", 4, "720p", null, null, List.of(), List.of(), List.of(), false, null)));
    assertThrows(ApiException.class, () -> client().createTask(request("test", AnmiaoVideoClient.MODEL25,
        "adaptive", 4, "720p", null, "https://assets.example/last.png", List.of(), List.of(), List.of(), false, null)));
    assertThrows(ApiException.class, () -> client().createTask(request("test", AnmiaoVideoClient.MODEL25,
        "9:16", 4, "720p", "https://assets.example/first.png", null, List.of(), List.of(), List.of(), false, null)));
    assertThrows(ApiException.class, () -> client().createTask(request("test", AnmiaoVideoClient.MODEL25,
        "adaptive", 4, "720p", "https://assets.example/first.png", null,
        List.of("https://assets.example/ref.png"), List.of(), List.of(), false, null)));
    assertEquals(0, calls.get());
  }

  @Test void rejectsUnusableUrlsAndNullAssetsInsteadOfDroppingThem() {
    for (String url : Arrays.asList("", " ", null, "asset://id", "blob:x", "data:audio/mp3;base64,x", "file:///a.png")) {
      assertThrows(ApiException.class, () -> client().createTask(request("test", AnmiaoVideoClient.MODEL25,
          "16:9", 4, "720p", null, null, Arrays.asList(url), List.of(), List.of(), false, null)));
      assertThrows(ApiException.class, () -> client().createTask(request("test", AnmiaoVideoClient.MODEL25,
          "16:9", 4, "720p", null, null, List.of(), List.of(), Arrays.asList(url), false, null)));
      assertThrows(ApiException.class, () -> client().createTask(request("test", AnmiaoVideoClient.MODEL25,
          "16:9", 4, "720p", null, null, List.of(),
          List.of(new VideoGenerationDtos.ReferenceVideo(url, null)), List.of(), false, null)));
    }
    assertThrows(ApiException.class, () -> client().createTask(request("test", AnmiaoVideoClient.MODEL25,
        "16:9", 4, "720p", null, null, List.of(), List.of(), List.of(), false, "javascript:alert(1)")));
    assertEquals(0, calls.get());
  }

  @Test void opaqueConfiguredRouteUsesActualModelDedicatedCredentialAndCleanNativeBody() throws Exception {
    var credential = new ModelApiKeyService.ResolvedModelApiKey(17, "seedance-2.5-guanfang-anmiao", "灵科AI",
        properties.getBaseUrl(), "/contents/generations/tasks", "/contents/generations/tasks/{id}", "configured-25-key",
        Map.of("model", "wrong-model", "params", Map.of("resolution", "4k"), "generate_audio", false,
            "watermark", true, "tools", List.of(Map.of("type", "other"))));
    when(keys.resolveFeatureRouteOption("model-api-key:17", ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video"))
        .thenReturn(Optional.of(credential));
    when(keys.resolveById(17, ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION)).thenReturn(credential);
    var input = request("test", "model-api-key:17", "16:9", 4, "720p", null, null,
        List.of(), List.of(), List.of(), false, null);
    assertTrue(client().supportsCanvasV3Seedance25(input.model(), "canvas-video"));
    var result = client().createTask(input);
    assertEquals("anmiao-video:v3-25:key:17:009007199254740993123", result.getTaskId());
    assertEquals(AnmiaoVideoClient.MODEL25, body.get().path("model").asText());
    assertEquals("Bearer configured-25-key", authorization.get());
    assertEquals(5, body.get().size());
    client().getTask(result.getTaskId(), 5L);
    assertEquals("Bearer configured-25-key", authorization.get());
    var fourK = request("test", "model-api-key:17", "16:9", 4, "4k", null, null,
        List.of(), List.of(), List.of(), false, null);
    assertThrows(ApiException.class, () -> client().createTask(fourK));
    assertEquals(2, calls.get());
  }

  @Test void wrongCredentialIdentityAndMediaProtocolCannotUseTheSeedanceProfile() {
    var nativePath = "/contents/generations/tasks";
    var wrong = new ModelApiKeyService.ResolvedModelApiKey(18, "hailuo-h3", "灵科AI", properties.getBaseUrl(),
        nativePath, nativePath + "/{id}", "test");
    when(keys.resolveFeatureRouteOption("model-api-key:18", ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video"))
        .thenReturn(Optional.of(wrong));
    var mediaProtocol = new ModelApiKeyService.ResolvedModelApiKey(19, AnmiaoVideoClient.MODEL25,
        "灵科AI", properties.getBaseUrl(), "/v1/media/generate", "/v1/media/status?task_id={id}", "test");
    when(keys.resolveFeatureRouteOption("model-api-key:19", ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video"))
        .thenReturn(Optional.of(mediaProtocol));
    for (String model : List.of("model-api-key:18", "model-api-key:19", "model-api-key:999", AnmiaoVideoClient.MODEL))
      assertThrows(ApiException.class, () -> client().createTask(request("test", model, "16:9", 4, "720p",
          null, null, List.of(), List.of(), List.of(), false, null)));
    assertEquals(0, calls.get());
  }

  @Test void explicitFixedRatesAreRequiredEvenForAProviderThatNormallyReportsCost() {
    var credential = new ModelApiKeyService.ResolvedModelApiKey(17, AnmiaoVideoClient.MODEL25, "灵科AI",
        properties.getBaseUrl(), "/contents/generations/tasks", "/contents/generations/tasks/{id}", "test");
    when(keys.resolveFeatureRouteOption("model-api-key:17", ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video"))
        .thenReturn(Optional.of(credential));
    properties.setMiPerSecond25ByResolution(Map.of());
    assertEquals(503, assertThrows(ApiException.class, () -> client().createTask(request("test", "model-api-key:17",
        "16:9", 4, "720p", null, null, List.of(), List.of(), List.of(), false, null))).getCode());
    properties.setMiPerSecond25ByResolution(Map.of("720p", 2));
    var withVideo = request("test", "model-api-key:17", "16:9", 12, "720p", null, null,
        List.of(), List.of(new VideoGenerationDtos.ReferenceVideo("https://assets.example/ref.mp4", 3.0)),
        List.of(), false, null);
    assertEquals(503, assertThrows(ApiException.class, () -> client().createTask(withVideo)).getCode());
    assertEquals(0, calls.get());
  }

  @Test void configuredReferenceLineQuotesItsOwnOutputAndInputRatesWithoutInventedMultiplier() {
    var withVideo = request("test", AnmiaoVideoClient.MODEL25, "16:9", 12, "720p", null, null,
        List.of(), List.of(new VideoGenerationDtos.ReferenceVideo("https://assets.example/ref.mp4", 3.0)),
        List.of(), false, null);
    configureFreeInputReferenceLine();
    assertEquals(new BigDecimal("36.00"), client().quoteCanvasV3Seedance25(withVideo));
    properties.setMiPerSecond25WithVideoByResolution(Map.of("720p", new BigDecimal("1.25")));
    properties.setMiPerReferenceVideoSecond25ByResolution(Map.of("720p", new BigDecimal("0.45")));
    assertEquals(new BigDecimal("18.60"), client().quoteCanvasV3Seedance25(withVideo));
  }

  @Test void pollsTerminalStatesAndDoesNotTurnMissingOutputIntoSuccess() throws Exception {
    String task = "anmiao-video:v3-25:25:009007199254740993123";
    statusResponse.set("{\"status\":\"queued\"}");
    assertEquals("queued", client().getTask(task, 5L).getStatus());
    statusResponse.set("{\"status\":\"succeeded\",\"content\":{\"video_url\":\"https://videos.example/result.mp4\"},\"usage\":{\"output_seconds\":12}}");
    var complete = client().getTask(task, 5L);
    assertEquals("completed", complete.getStatus());
    assertEquals(List.of("https://videos.example/result.mp4"), complete.getVideoUrls());
    statusResponse.set("{\"status\":\"failed\",\"error\":{\"code\":\"SensitiveContentDetected\",\"message\":\"素材未通过审核\"}}");
    assertEquals("素材未通过审核", client().getTask(task, 5L).getError());
    statusResponse.set("{\"status\":\"succeeded\"}");
    assertEquals(502, assertThrows(ApiException.class, () -> client().getTask(task, 5L)).getCode());
    statusResponse.set("{\"status\":\"unknown\"}");
    assertEquals(502, assertThrows(ApiException.class, () -> client().getTask(task, 5L)).getCode());
  }

  @Test void oldRequestJsonFingerprintKeepsAllNewOptionalFieldsAbsent() throws Exception {
    var legacy = new VideoGenerationDtos.CreateTaskRequest("test", AnmiaoVideoClient.MODEL, "16:9", 6);
    var json = mapper.valueToTree(legacy);
    for (String field : List.of("parameter_profile", "reference_image_urls", "reference_audios", "web_search", "mode"))
      assertFalse(json.has(field), field);
    assertEquals(legacy, mapper.readValue(mapper.writeValueAsString(legacy), VideoGenerationDtos.CreateTaskRequest.class));
    var marked = request("test", AnmiaoVideoClient.MODEL25, "16:9", 4, "720p", null, null,
        List.of("https://assets.example/ref.png"), List.of(), List.of(), false, null);
    assertEquals(marked, mapper.readValue(mapper.writeValueAsString(marked), VideoGenerationDtos.CreateTaskRequest.class));
  }

  @Test void jsonOutputDurationCannotBeFractionalOrOverflowBeforeModelValidation() throws Exception {
    var tree = mapper.valueToTree(textRequest("16:9", 4, "720p"));
    for (var value : List.of("4.5", "4.0", "\"4.5\"", "2147483648", "true")) {
      ((com.fasterxml.jackson.databind.node.ObjectNode) tree).set("durationSeconds", mapper.readTree(value));
      assertThrows(com.fasterxml.jackson.core.JsonProcessingException.class,
          () -> mapper.treeToValue(tree, VideoGenerationDtos.CreateTaskRequest.class));
    }
    ((com.fasterxml.jackson.databind.node.ObjectNode) tree).put("durationSeconds", "6");
    assertEquals(6, mapper.treeToValue(tree, VideoGenerationDtos.CreateTaskRequest.class).durationSeconds());
    ((com.fasterxml.jackson.databind.node.ObjectNode) tree).remove("durationSeconds");
    ((com.fasterxml.jackson.databind.node.ObjectNode) tree).put("duration", 4);
    assertEquals(4, mapper.treeToValue(tree, VideoGenerationDtos.CreateTaskRequest.class).durationSeconds());
  }

  @Test void configuredNativeTaskIdPlaceholderIsSupportedWithoutChangingTheCredentialRoute() throws Exception {
    var credential = new ModelApiKeyService.ResolvedModelApiKey(17, AnmiaoVideoClient.MODEL25, "灵科AI",
        properties.getBaseUrl(), "/contents/generations/tasks", "/contents/generations/tasks/{task_id}", "configured-25-key");
    when(keys.resolveFeatureRouteOption("model-api-key:17", ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video"))
        .thenReturn(Optional.of(credential));
    when(keys.resolveById(17, ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION)).thenReturn(credential);
    var created = client().createTask(request("test", "model-api-key:17", "16:9", 4, "720p", null, null,
        List.of(), List.of(), List.of(), false, null));
    client().getTask(created.getTaskId(), 7L);
    assertEquals("/contents/generations/tasks/009007199254740993123", path.get());
    assertEquals("Bearer configured-25-key", authorization.get());
  }

  void configureFreeInputReferenceLine() {
    properties.setMiPerSecond25WithVideoByResolution(Map.of("480p", BigDecimal.valueOf(2), "720p", BigDecimal.valueOf(3)));
    properties.setMiPerReferenceVideoSecond25ByResolution(Map.of("480p", BigDecimal.ZERO, "720p", BigDecimal.ZERO));
  }

  void respond(HttpExchange exchange, int status, String value) throws IOException {
    byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().set("Content-Type", "application/json");
    exchange.sendResponseHeaders(status, bytes.length);
    exchange.getResponseBody().write(bytes);
    exchange.close();
  }
}
