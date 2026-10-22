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

/** Every HTTP request in this class goes to an ephemeral localhost mock, never a paid API. */
class KlingOmniVideoClientTest {
  private static final String ID = "0009007199254740993100009";
  private static final String TASK = KlingOmniVideoClient.PREFIX + "73:" + ID;
  private final ObjectMapper mapper = new ObjectMapper();
  private final ModelApiKeyService keys = mock(ModelApiKeyService.class);
  private final VideoGenerationClient media = mock(VideoGenerationClient.class);
  private final AtomicReference<JsonNode> submitted = new AtomicReference<>();
  private final AtomicReference<String> response = new AtomicReference<>("{\"code\":200,\"data\":{\"task_id\":\"" + ID + "\"}}");
  private final AtomicReference<String> authorization = new AtomicReference<>();
  private final AtomicReference<String> query = new AtomicReference<>();
  private final AtomicInteger calls = new AtomicInteger();
  private final AtomicInteger httpStatus = new AtomicInteger(200);
  private HttpServer server;
  private String base;
  private KlingOmniVideoClient client;

  @BeforeEach void setup() throws Exception {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/v1/media/", exchange -> {
      calls.incrementAndGet();
      authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
      query.set(exchange.getRequestURI().getRawQuery());
      if (exchange.getRequestMethod().equals("POST")) submitted.set(mapper.readTree(exchange.getRequestBody()));
      byte[] bytes = response.get().getBytes(StandardCharsets.UTF_8);
      exchange.getResponseHeaders().set("Content-Type", "application/json");
      exchange.sendResponseHeaders(httpStatus.get(), bytes.length);
      exchange.getResponseBody().write(bytes);
      exchange.close();
    });
    server.start();
    base = "http://127.0.0.1:" + server.getAddress().getPort();
    client = new KlingOmniVideoClient(keys, media, mapper);
    managed(KlingOmniVideoClient.CANKAO, "/v1/media/generate", "/v1/media/status?task_id={task_id}");
    when(media.persistVideoAsync(eq(TASK), eq(ID), anyString(), eq(7L)))
        .thenReturn("https://oss.example/users/7/result.mp4");
  }

  @AfterEach void stop() { server.stop(0); }

  private ResolvedModelApiKey managed(String model, String generation, String status) {
    var value = new ResolvedModelApiKey(73L, model, "Editable channel", base,
        generation, status, "original-route-key", Map.of("mode", "bad", "n", 20, "duration", 99));
    when(keys.resolveFeatureRouteOption("model-api-key:73", ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video"))
        .thenReturn(Optional.of(value));
    when(keys.resolve(model, ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video"))
        .thenReturn(Optional.of(value));
    when(keys.resolveById(73L, ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION)).thenReturn(value);
    return value;
  }

  private ObjectNode input(String model) {
    managed(model, "/v1/media/generate", "/v1/media/status?task_id={task_id}");
    ObjectNode value = mapper.createObjectNode();
    value.put("model", "model-api-key:73");
    value.put("prompt", "  参考中的人物在海边漫步  ");
    value.put("feature_code", "canvas-video");
    value.put("parameter_profile", KlingOmniVideoClient.PROFILE);
    ObjectNode params = value.putObject("omni_params").put("mode", "std");
    if (KlingOmniVideoClient.VIDEOREF.equals(model)) {
      params.put("refer_type", "feature").put("duration", "5").put("aspect_ratio", "16:9").put("keep_original_sound", "yes");
      value.putArray("reference_videos").addObject().put("url", "https://assets.example/input.mp4").put("durationSeconds", 7.5);
    } else {
      params.put("duration", "5");
      if (KlingOmniVideoClient.FRAMES.equals(model)) value.putArray("reference_image_urls").add("https://assets.example/first.png");
      else params.put("aspect_ratio", "16:9");
    }
    return value;
  }
  private ObjectNode params(ObjectNode value) { return (ObjectNode) value.path("omni_params"); }
  private VideoGenerationDtos.CreateTaskRequest request(ObjectNode value) throws Exception {
    return mapper.treeToValue(value, VideoGenerationDtos.CreateTaskRequest.class);
  }
  private void statusResponse(String value) throws Exception {
    ObjectNode status = (ObjectNode) mapper.readTree(value);
    if (!status.has("task_id")) status.put("task_id", ID);
    response.set(mapper.writeValueAsString(status));
  }

  @Test void allThreeModelsSendOnlyDocumentedFieldsAndUseOwnManagedKeyAndTopLevelCallback() throws Exception {
    for (String model : List.of(KlingOmniVideoClient.CANKAO, KlingOmniVideoClient.VIDEOREF, KlingOmniVideoClient.FRAMES)) {
      ObjectNode value = input(model).put("notify_url", "https://our.example/callback");
      value.withArray("reference_image_urls").add("https://assets.example/second.png");
      var request = request(value);
      client.validate(request);
      var result = client.createTask(request);
      assertEquals(TASK, result.getTaskId());
      assertEquals("model-api-key:73", result.getModel());
      assertEquals("queued", result.getStatus());
      assertEquals("Bearer original-route-key", authorization.get());
      JsonNode body = submitted.get();
      assertEquals(4, body.size());
      assertEquals(model, body.path("model").asText());
      assertEquals("参考中的人物在海边漫步", body.path("prompt").asText());
      assertEquals("https://our.example/callback", body.path("notify_url").asText());
      JsonNode sent = body.path("params");
      ObjectNode expected = params(value).deepCopy();
      expected.set("images", value.path("reference_image_urls"));
      if (model.equals(KlingOmniVideoClient.VIDEOREF)) expected.put("video", "https://assets.example/input.mp4");
      assertEquals(expected, sent);
      for (String name : List.of("notify_url", "resolution", "count", "n", "seed", "generate_audio", "first_frame_url",
          "last_frame_url", "reference_videos", "reference_audios", "web_search", "negative_prompt", "version"))
        assertFalse(sent.has(name), name);
    }
    assertEquals(3, calls.get());
    verifyNoInteractions(media);
  }

  @Test void referenceModeSupportsAllDocumentedScalarsAndZeroToSevenOrderedPictures() throws Exception {
    for (String quality : List.of("std", "pro")) for (String duration : List.of("5", "10", "15")) {
      for (String ratio : List.of("16:9", "9:16", "1:1")) {
        ObjectNode value = input(KlingOmniVideoClient.CANKAO);
        params(value).put("mode", quality).put("duration", duration).put("aspect_ratio", ratio);
        client.createTask(request(value));
        assertEquals(params(value), submitted.get().path("params"));
      }
    }
    for (int count = 0; count <= 7; count++) {
      ObjectNode value = input(KlingOmniVideoClient.CANKAO);
      for (int i = 0; i < count; i++) value.withArray("reference_image_urls").add("https://assets.example/same.png");
      params(value).remove("aspect_ratio");
      client.createTask(request(value));
      assertEquals(count, submitted.get().path("params").path("images").size());
      assertFalse(submitted.get().path("params").has("aspect_ratio"));
    }
  }

  @Test void firstLastFramesPreserveOrderAndIdenticalUrlsWithoutRatioAndRequireOneOrTwoFrames() throws Exception {
    for (String duration : List.of("5", "10", "15")) for (String quality : List.of("std", "pro")) {
      ObjectNode value = input(KlingOmniVideoClient.FRAMES);
      params(value).put("duration", duration).put("mode", quality);
      value.withArray("reference_image_urls").add("https://assets.example/first.png");
      client.createTask(request(value));
      JsonNode sent = submitted.get().path("params");
      assertEquals(2, sent.path("images").size());
      assertEquals(value.path("reference_image_urls"), sent.path("images"));
      assertFalse(sent.has("aspect_ratio"));
    }
    ObjectNode zero = input(KlingOmniVideoClient.FRAMES); zero.remove("reference_image_urls");
    assertThrows(ApiException.class, () -> client.validate(request(zero)));
    ObjectNode excess = input(KlingOmniVideoClient.FRAMES);
    excess.withArray("reference_image_urls").add("https://assets.example/second.png").add("https://assets.example/third.png");
    assertThrows(ApiException.class, () -> client.validate(request(excess)));
    ObjectNode ratio = input(KlingOmniVideoClient.FRAMES); params(ratio).put("aspect_ratio", "16:9");
    assertThrows(ApiException.class, () -> client.validate(request(ratio)));
  }

  @Test void videoFeatureAcceptsOptionalSettingsButBaseRejectsEveryHiddenParameter() throws Exception {
    for (String sound : List.of("yes", "no")) for (String duration : List.of("5", "10")) {
      ObjectNode value = input(KlingOmniVideoClient.VIDEOREF);
      params(value).put("duration", duration).put("keep_original_sound", sound);
      client.createTask(request(value));
      assertEquals(duration, submitted.get().path("params").path("duration").textValue());
      assertEquals(sound, submitted.get().path("params").path("keep_original_sound").textValue());
    }
    ObjectNode minimal = input(KlingOmniVideoClient.VIDEOREF);
    params(minimal).remove(List.of("duration", "aspect_ratio", "keep_original_sound"));
    client.createTask(request(minimal));
    assertEquals(3, submitted.get().path("params").size());
    params(minimal).put("refer_type", "base");
    client.createTask(request(minimal));
    assertEquals(3, submitted.get().path("params").size());
    for (String hidden : List.of("duration", "aspect_ratio", "keep_original_sound")) {
      ObjectNode stale = minimal.deepCopy(); params(stale).put(hidden, "5");
      assertThrows(ApiException.class, () -> client.validate(request(stale)), hidden);
    }
    for (int count = 0; count <= 4; count++) {
      ObjectNode value = minimal.deepCopy();
      for (int i = 0; i < count; i++) value.withArray("reference_image_urls").add("https://assets.example/ref.png");
      client.createTask(request(value));
      assertEquals(count, submitted.get().path("params").path("images").size());
    }
  }

  @Test void videoCountsKnownDurationBoundsAndModeSpecificMaterialRulesAreValidatedBeforeDispatch() throws Exception {
    ObjectNode value = input(KlingOmniVideoClient.VIDEOREF);
    value.remove("reference_videos");
    assertThrows(ApiException.class, () -> client.validate(request(value)));
    ObjectNode duplicate = input(KlingOmniVideoClient.VIDEOREF);
    duplicate.withArray("reference_videos").addObject().put("url", "https://assets.example/input.mp4");
    assertThrows(ApiException.class, () -> client.validate(request(duplicate)));
    for (double duration : List.of(0., 2.9, 10.1, 100.)) {
      ObjectNode wrong = input(KlingOmniVideoClient.VIDEOREF);
      ((ObjectNode) wrong.path("reference_videos").get(0)).put("durationSeconds", duration);
      assertThrows(ApiException.class, () -> client.validate(request(wrong)));
    }
    for (double duration : List.of(3., 10.)) {
      ObjectNode valid = input(KlingOmniVideoClient.VIDEOREF);
      ((ObjectNode) valid.path("reference_videos").get(0)).put("durationSeconds", duration);
      client.validate(request(valid));
    }
    ObjectNode unknownMetadata = input(KlingOmniVideoClient.VIDEOREF);
    ((ObjectNode) unknownMetadata.path("reference_videos").get(0)).remove("durationSeconds");
    client.validate(request(unknownMetadata)); // It is upstream, not a fabricated local media probe.
    ObjectNode five = input(KlingOmniVideoClient.VIDEOREF);
    for (int i = 0; i < 5; i++) five.withArray("reference_image_urls").add("https://assets.example/ref.png");
    assertThrows(ApiException.class, () -> client.validate(request(five)));
    for (String model : List.of(KlingOmniVideoClient.CANKAO, KlingOmniVideoClient.FRAMES)) {
      ObjectNode wrong = input(model);
      wrong.putArray("reference_videos").addObject().put("url", "https://assets.example/input.mp4");
      assertThrows(ApiException.class, () -> client.validate(request(wrong)));
    }
    assertEquals(0, calls.get());
  }

  @Test void invalidOrNonScalarOmniFieldsAndUnrelatedGenericParametersFailBeforeDispatch() throws Exception {
    for (String model : List.of(KlingOmniVideoClient.CANKAO, KlingOmniVideoClient.VIDEOREF, KlingOmniVideoClient.FRAMES)) {
      for (String field : List.of("mode", model.equals(KlingOmniVideoClient.VIDEOREF) ? "refer_type" : "duration")) {
        ObjectNode value = input(model); params(value).remove(field);
        assertThrows(ApiException.class, () -> client.validate(request(value)), field);
      }
      for (String field : List.of("n", "count", "resolution", "images", "video", "notify_url", "generate_audio", "seed", "version")) {
        ObjectNode value = input(model); params(value).put(field, "5");
        assertThrows(ApiException.class, () -> client.validate(request(value)), field);
      }
      for (String field : List.of("ratio", "resolution", "mode", "version", "negative_prompt", "first_frame_url", "last_frame_url")) {
        ObjectNode value = input(model).put(field, "unrelated");
        assertThrows(ApiException.class, () -> client.validate(request(value)), field);
      }
      for (String field : List.of("web_search", "generate_audio")) {
        ObjectNode value = input(model).put(field, false);
        assertThrows(ApiException.class, () -> client.validate(request(value)), field);
      }
      ObjectNode seed = input(model).put("seed", 123); assertThrows(ApiException.class, () -> client.validate(request(seed)));
      ObjectNode duration = input(model).put("durationSeconds", 5); assertThrows(ApiException.class, () -> client.validate(request(duration)));
      ObjectNode genericImage = input(model); genericImage.putArray("image_urls").add("https://assets.example/ref.png");
      assertThrows(ApiException.class, () -> client.validate(request(genericImage)));
      ObjectNode audio = input(model); audio.putArray("reference_audios").add("https://assets.example/a.mp3");
      assertThrows(ApiException.class, () -> client.validate(request(audio)));
    }
    for (String duration : List.of("4", "6", "5.0", " 5", "")) {
      ObjectNode value = input(KlingOmniVideoClient.CANKAO); params(value).put("duration", duration);
      assertThrows(ApiException.class, () -> client.validate(request(value)));
    }
    ObjectNode number = input(KlingOmniVideoClient.CANKAO); params(number).put("duration", 5);
    assertThrows(ApiException.class, () -> client.validate(request(number)));
    ObjectNode nested = input(KlingOmniVideoClient.CANKAO); params(nested).putObject("mode").put("value", "std");
    assertThrows(ApiException.class, () -> client.validate(request(nested)));
    ObjectNode invalid = input(KlingOmniVideoClient.VIDEOREF); params(invalid).put("duration", "15");
    assertThrows(ApiException.class, () -> client.validate(request(invalid)));
    assertEquals(0, calls.get());
  }

  @Test void promptCanBeOmittedOnlyWhenMediaExistsAndDtosKeepLegacyConstructorsCompatible() throws Exception {
    for (String model : List.of(KlingOmniVideoClient.VIDEOREF, KlingOmniVideoClient.FRAMES, KlingOmniVideoClient.CANKAO)) {
      ObjectNode value = input(model); value.remove("prompt");
      if (model.equals(KlingOmniVideoClient.CANKAO)) value.putArray("reference_image_urls").add("https://assets.example/ref.png");
      client.createTask(request(value));
      assertEquals("", submitted.get().path("prompt").asText());
    }
    ObjectNode empty = input(KlingOmniVideoClient.CANKAO).put("prompt", " ");
    assertThrows(ApiException.class, () -> client.validate(request(empty)));
    assertTrue(new VideoGenerationDtos.CreateTaskRequest("old", "old", "16:9", 5).omniParams().isEmpty());
    ObjectNode alias = input(KlingOmniVideoClient.CANKAO);
    alias.set("omniParams", alias.remove("omni_params"));
    assertEquals("std", request(alias).omniParams().get("mode"));
    assertThrows(UnsupportedOperationException.class, () -> request(alias).omniParams().put("mode", "pro"));
  }

  @Test void nonPublicOrCredentialedReferencesAndCallbacksFailBeforeDispatch() throws Exception {
    for (String url : List.of("", "data:image/png;base64,eA==", "blob:local", "file:///a.png", "ftp://a.example/a.png",
        "https://user:password@assets.example/a.png", "http://localhost/a.png", "http://127.0.0.1/a.png",
        "http://10.1.2.3/a.png", "http://192.168.1.1/a.png", "http://[::1]/a.png", "http://[fe80::1]/a.png",
        "http://localhost./a.png", "http://[0:0:0:0:0:0:0:1]/a.png", "http://0177.0.0.1/a.png", "http://2130706433/a.png")) {
      ObjectNode value = input(KlingOmniVideoClient.CANKAO); value.putArray("reference_image_urls").add(url);
      assertThrows(ApiException.class, () -> client.validate(request(value)), url);
      ObjectNode video = input(KlingOmniVideoClient.VIDEOREF);
      ((ObjectNode) video.path("reference_videos").get(0)).put("url", url);
      assertThrows(ApiException.class, () -> client.validate(request(video)), url);
      if (!url.isBlank()) assertThrows(ApiException.class,
          () -> client.validate(request(input(KlingOmniVideoClient.CANKAO).put("webhook_url", url))), url);
    }
    assertEquals(0, calls.get());
  }

  @Test void nativeAndOpaqueRoutesMustMatchKlingIdentityAndHaveSameOriginMediaEndpoints() throws Exception {
    ObjectNode value = input(KlingOmniVideoClient.CANKAO);
    assertTrue(client.supports("model-api-key:73", "canvas-video"));
    assertTrue(client.supports(KlingOmniVideoClient.CANKAO, "canvas-video"));
    assertFalse(client.supports("可灵-Omni", "canvas-video"));
    assertFalse(client.supports("Kling 3.0", "canvas-video"));
    assertFalse(client.supports("model-api-key:73", "product-video-video"));
    managed("seedance-2.0-anci", "/v1/media/generate", "/v1/media/status");
    assertFalse(client.supports("model-api-key:73", "canvas-video"));
    assertThrows(ApiException.class, () -> client.createTask(request(value)));
    var wrongMode = managed(KlingOmniVideoClient.FRAMES, "/v1/media/generate", "/v1/media/status");
    when(keys.resolve(KlingOmniVideoClient.CANKAO, ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video"))
        .thenReturn(Optional.of(wrongMode));
    assertFalse(client.supports(KlingOmniVideoClient.CANKAO, "canvas-video"));
    for (String endpoint : List.of("/api/v3/contents/generations/tasks", "/v1/chat/completions", "/v1/media/generate?key=secret")) {
      managed(KlingOmniVideoClient.CANKAO, endpoint, "/v1/media/status");
      assertThrows(ApiException.class, () -> client.createTask(request(value)));
    }
    for (String status : List.of("/v1/media/status?other=1", "https://other.example/v1/media/status")) {
      managed(KlingOmniVideoClient.CANKAO, "/v1/media/generate", status);
      assertThrows(ApiException.class, () -> client.createTask(request(value)));
    }
    reset(keys);
    assertEquals(503, assertThrows(ApiException.class, () -> client.createTask(request(value))).getCode());
    assertEquals(0, calls.get());
  }

  @Test void pollingUsesOriginalKeyAndStrictFinalFlagInsteadOfDisplayStatusOrStateAlone() throws Exception {
    when(keys.resolveFeatureRouteOption(anyString(), anyString(), anyString())).thenReturn(Optional.empty());
    for (String state : List.of("pending", "running", "success", "failed")) {
      statusResponse("{\"state\":\"" + state + "\",\"is_final\":false,\"status\":\"已完成\",\"progress\":\"45%\",\"result_url\":\"https://cdn.example/a.mp4\"}");
      var result = client.getTask(TASK, 7L);
      assertEquals(state.equals("pending") ? "queued" : "processing", result.getStatus());
      assertEquals(45, result.getProgress());
      assertTrue(result.getVideoUrls().isEmpty());
      assertEquals("task_id=" + ID, query.get());
      assertEquals("Bearer original-route-key", authorization.get());
    }
    verifyNoInteractions(media);
  }

  @Test void finalSuccessPersistsTheRealVideoAndSaveFailuresRemainRetryable() throws Exception {
    statusResponse("{\"state\":\"success\",\"is_final\":true,\"result_url\":\"https://cdn.example/a.mp4\",\"result_type\":\"video\",\"cost\":0.23}");
    var result = client.getTask(TASK, 7L);
    assertEquals("completed", result.getStatus());
    assertEquals(List.of("https://oss.example/users/7/result.mp4"), result.getVideoUrls());
    assertEquals(0.23, result.getRaw().path("cost").asDouble());
    verify(media).persistVideoAsync(TASK, ID, "https://cdn.example/a.mp4", 7L);
    when(media.persistVideoAsync(TASK, ID, "https://cdn.example/a.mp4", 7L)).thenThrow(new IllegalStateException("pending"));
    result = client.getTask(TASK, 7L);
    assertEquals("persisting", result.getStatus());
    assertTrue(result.getVideoUrls().isEmpty());
    assertNull(result.getProgress());
  }

  @Test void finalFailureNeverPersistsAndMalformedStatusCannotFalselyFinishOrFailTheTask() throws Exception {
    statusResponse("{\"state\":\"failed\",\"is_final\":true,\"status\":\"已完成\",\"error\":\"素材失效\"}");
    assertEquals("failed", client.getTask(TASK, 7L).getStatus());
    for (String body : List.of("{\"state\":\"success\",\"is_final\":\"true\"}", "{\"state\":\"success\"}",
        "{\"state\":\"succeeded\",\"is_final\":true}", "{\"state\":\"pending\",\"is_final\":true}",
        "{\"state\":\"running\",\"is_final\":true}", "{\"state\":\"success\",\"is_final\":true}",
        "{\"task_id\":\"other-task\",\"state\":\"failed\",\"is_final\":true}",
        "{\"state\":\"success\",\"is_final\":true,\"result_url\":\"https://cdn.example/a.mp4\"}",
        "{\"state\":\"success\",\"is_final\":true,\"result_url\":\"https://cdn.example/a.mp4\",\"result_type\":\"image\"}",
        "{\"state\":\"success\",\"is_final\":true,\"result_url\":\"http://127.0.0.1/a.mp4\",\"result_type\":\"video\"}")) {
      statusResponse(body);
      assertThrows(ApiException.class, () -> client.getTask(TASK, 7L), body);
    }
    verifyNoInteractions(media);
  }

  @Test void statusMustCarryItsExactTaskIdBeforePersistenceOrAnyTerminalStatusCanBeAccepted() throws Exception {
    for (String taskId : List.of("", "null", "123", "0009007199254740993100008")) {
      ObjectNode status = mapper.createObjectNode().put("state", "success").put("is_final", true)
          .put("result_url", "https://cdn.example/a.mp4").put("result_type", "video").put("cost", 0.23);
      if (taskId.equals("null")) status.putNull("task_id");
      else if (!taskId.isEmpty()) status.put("task_id", taskId);
      response.set(mapper.writeValueAsString(status));
      assertEquals(502, assertThrows(ApiException.class, () -> client.getTask(TASK, 7L)).getCode());
    }
    verifyNoInteractions(media);
  }

  @Test void malformedTaskIdsUnknownRoutesAndMalformedCreateRepliesNeverInventReceipts() throws Exception {
    for (String id : List.of("", "other:key:73:123", KlingOmniVideoClient.PREFIX + "0:123",
        KlingOmniVideoClient.PREFIX + "73:abc", KlingOmniVideoClient.PREFIX + "99999999999999999999999:123"))
      assertThrows(ApiException.class, () -> client.getTask(id, 7L));
    assertEquals(0, calls.get());
    for (String body : List.of("{}", "{\"code\":200,\"data\":{\"task_id\":\"abc\"}}", "null", "<html>error</html>")) {
      response.set(body);
      assertThrows(ApiException.class, () -> client.createTask(request(input(KlingOmniVideoClient.CANKAO))));
    }
    response.set("{\"code\":403,\"msg\":\"original-route-key sk-secret-echo invalid\"}");
    httpStatus.set(403);
    var error = assertThrows(ApiException.class, () -> client.createTask(request(input(KlingOmniVideoClient.CANKAO))));
    assertEquals(403, error.getCode());
    assertFalse(error.getMessage().contains("original-route-key"));
    assertFalse(error.getMessage().contains("sk-secret-echo"));
  }

  @Test void taskEndpointAcceptsBarePathAndBothDocumentedPlaceholdersPreservingExactTaskId() throws Exception {
    statusResponse("{\"state\":\"running\",\"is_final\":false}");
    for (String path : List.of("/v1/media/status", "/v1/media/status?task_id=", "/v1/media/status?task_id={id}")) {
      managed(KlingOmniVideoClient.CANKAO, "/v1/media/generate", path);
      client.getTask(TASK, 7L);
      assertEquals("task_id=" + ID, query.get());
    }
  }
}
