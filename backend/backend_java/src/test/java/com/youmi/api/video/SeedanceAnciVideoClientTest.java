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

class SeedanceAnciVideoClientTest {
  private static final String ID = "0009007199254740993100009";
  private static final String TASK = SeedanceAnciVideoClient.PREFIX + "73:" + ID;
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
  private SeedanceAnciVideoClient client;

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
    client = new SeedanceAnciVideoClient(keys, media, mapper);
    managed(SeedanceAnciVideoClient.MODEL, "/v1/media/generate", "/v1/media/status?task_id={task_id}");
    when(media.persistVideoAsync(eq(TASK), eq(ID), anyString(), eq(7L)))
        .thenReturn("https://oss.example/users/7/result.mp4");
  }

  @AfterEach void stop() { server.stop(0); }

  private ResolvedModelApiKey managed(String model, String generation, String status) {
    var value = new ResolvedModelApiKey(73L, model, "Editable channel", base,
        generation, status, "original-route-key", Map.of("version", "fake", "n", 20, "duration", 99));
    when(keys.resolveFeatureRouteOption("model-api-key:73", ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video"))
        .thenReturn(Optional.of(value));
    when(keys.resolve(SeedanceAnciVideoClient.MODEL, ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video"))
        .thenReturn(Optional.of(value));
    when(keys.resolveById(73L, ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION)).thenReturn(value);
    return value;
  }

  private ObjectNode input() {
    ObjectNode value = mapper.createObjectNode();
    value.put("model", "model-api-key:73");
    value.put("prompt", "  参考中的人物在海边漫步  ");
    value.put("feature_code", "canvas-video");
    value.put("parameter_profile", SeedanceAnciVideoClient.PROFILE);
    value.put("ratio", "16:9");
    value.put("durationSeconds", 5);
    value.put("resolution", "720p");
    value.put("mode", "cankaosheng");
    value.put("version", "快速");
    return value;
  }
  private VideoGenerationDtos.CreateTaskRequest request(ObjectNode value) throws Exception {
    return mapper.treeToValue(value, VideoGenerationDtos.CreateTaskRequest.class);
  }

  @Test void exactDocumentedBodyKeepsTwoImagesAsReferencesAndNotifyAtTopLevel() throws Exception {
    ObjectNode value = input().put("notify_url", "https://our.example/callback");
    value.putArray("reference_image_urls").add("https://assets.example/first.png").add("https://assets.example/last.png");
    var request = request(value);
    client.validate(request);
    var result = client.createTask(request);
    assertEquals(TASK, result.getTaskId());
    assertEquals("model-api-key:73", result.getModel());
    assertEquals("queued", result.getStatus());
    assertEquals("Bearer original-route-key", authorization.get());
    JsonNode body = submitted.get();
    assertEquals(4, body.size());
    assertEquals(SeedanceAnciVideoClient.MODEL, body.path("model").asText());
    assertEquals("参考中的人物在海边漫步", body.path("prompt").asText());
    assertEquals("https://our.example/callback", body.path("notify_url").asText());
    JsonNode params = body.path("params");
    assertEquals(6, params.size());
    assertEquals("cankaosheng", params.path("mode").asText());
    assertEquals("快速", params.path("version").asText());
    assertEquals("5", params.path("duration").textValue());
    assertEquals("16:9", params.path("aspect_ratio").asText());
    assertEquals("720p", params.path("resolution").asText());
    assertEquals(value.path("reference_image_urls"), params.path("images"));
    for (String name : List.of("first_frame_url", "last_frame_url", "image_url", "audio_url", "video_url",
        "seed", "web_search", "generate_audio", "n", "count", "notify_url")) assertFalse(params.has(name), name);
    assertEquals(1, calls.get());
  }

  @Test void bothVersionsAllIntegerDurationsAndAllFiveRatiosAreAcceptedWithoutPerSecondPricing() throws Exception {
    for (String version : List.of("快速", "标准")) {
      for (int duration = 4; duration <= 15; duration++) {
        for (String ratio : List.of("16:9", "9:16", "1:1", "4:3", "3:4")) {
          client.createTask(request(input().put("version", version).put("durationSeconds", duration).put("ratio", ratio)));
          JsonNode params = submitted.get().path("params");
          assertEquals(version, params.path("version").asText());
          assertEquals(String.valueOf(duration), params.path("duration").textValue());
          assertEquals(ratio, params.path("aspect_ratio").asText());
          assertFalse(params.has("images"));
        }
      }
    }
    verifyNoInteractions(media);
  }

  @Test void zeroToNineImagesAreOrderedIncludingSinglePairAndDuplicateReferences() throws Exception {
    for (int count = 0; count <= 9; count++) {
      ObjectNode value = input();
      var images = value.putArray("image_urls");
      for (int i = 0; i < count; i++) images.add("https://assets.example/same.png");
      client.createTask(request(value));
      var params = submitted.get().path("params");
      assertEquals("cankaosheng", params.path("mode").asText());
      assertEquals(count, params.path("images").size());
      assertFalse(params.has("first_frame_url"));
      assertFalse(params.has("last_frame_url"));
    }
  }

  @Test void outOfSpecParametersAreRejectedBeforeDispatch() throws Exception {
    for (String field : List.of("prompt", "version", "resolution", "durationSeconds", "parameter_profile")) {
      ObjectNode value = input();
      value.remove(field);
      assertThrows(ApiException.class, () -> client.validate(request(value)), field);
    }
    for (String resolution : List.of("480p", "1080p", "2K", "4K"))
      assertThrows(ApiException.class, () -> client.validate(request(input().put("resolution", resolution))));
    for (String version : List.of("fast", "standard", "seedance-2.0-fast", ""))
      assertThrows(ApiException.class, () -> client.validate(request(input().put("version", version))));
    for (String ratio : List.of("adaptive", "Auto", "21:9", "2:3"))
      assertThrows(ApiException.class, () -> client.validate(request(input().put("ratio", ratio))));
    for (int duration : List.of(0, 3, 16, 30))
      assertThrows(ApiException.class, () -> client.validate(request(input().put("durationSeconds", duration))));
    assertThrows(Exception.class, () -> request(input().put("durationSeconds", 4.9)));
    assertThrows(ApiException.class, () -> client.validate(request(input().put("prompt", "   "))));
    assertThrows(ApiException.class, () -> client.validate(request(input().put("mode", "shouweizhen"))));
    assertThrows(ApiException.class, () -> client.validate(request(input().put("first_frame_url", "https://assets.example/a.png"))));
    assertThrows(ApiException.class, () -> client.validate(request(input().put("last_frame_url", "https://assets.example/a.png"))));
    assertThrows(ApiException.class, () -> client.validate(request(input().put("web_search", false))));
    assertThrows(ApiException.class, () -> client.validate(request(input().put("generate_audio", true))));
    assertThrows(ApiException.class, () -> client.validate(request(input().put("seed", 3))));
    ObjectNode audio = input(); audio.putArray("reference_audios").add("https://assets.example/a.mp3");
    assertThrows(ApiException.class, () -> client.validate(request(audio)));
    ObjectNode video = input(); video.putArray("reference_videos").addObject().put("url", "https://assets.example/a.mp4");
    assertThrows(ApiException.class, () -> client.validate(request(video)));
    ObjectNode excess = input(); for (int i = 0; i < 10; i++) excess.withArray("reference_image_urls").add("https://assets.example/a.png");
    assertThrows(ApiException.class, () -> client.validate(request(excess)));
    assertEquals(0, calls.get());
  }

  @Test void nonPublicOrCredentialedReferencesAndCallbacksFailBeforeDispatch() throws Exception {
    for (String url : List.of("", "data:image/png;base64,eA==", "blob:local", "file:///a.png", "ftp://a.example/a.png",
        "https://user:password@assets.example/a.png", "http://localhost/a.png", "http://127.0.0.1/a.png",
        "http://10.1.2.3/a.png", "http://192.168.1.1/a.png", "http://[::1]/a.png", "http://[fe80::1]/a.png",
        "http://localhost./a.png", "http://[0:0:0:0:0:0:0:1]/a.png", "http://0177.0.0.1/a.png", "http://2130706433/a.png")) {
      ObjectNode value = input(); value.putArray("reference_image_urls").add(url);
      assertThrows(ApiException.class, () -> client.validate(request(value)), url);
      if (!url.isBlank())
        assertThrows(ApiException.class, () -> client.validate(request(input().put("webhook_url", url))), url);
    }
    assertEquals(0, calls.get());
  }

  @Test void routesMustResolveAnExactNativeModelAndMediaProtocolBeforeDispatch() throws Exception {
    assertTrue(client.supports("model-api-key:73", "canvas-video"));
    assertTrue(client.supports(SeedanceAnciVideoClient.MODEL, "canvas-video"));
    assertFalse(client.supports("Seedance 2.0 按次", "canvas-video"));
    assertFalse(client.supports("model-api-key:73", "product-video-video"));
    managed("doubao-seedance-2-0-260128", "/v1/media/generate", "/v1/media/status");
    assertFalse(client.supports("model-api-key:73", "canvas-video"));
    assertThrows(ApiException.class, () -> client.createTask(request(input())));
    for (String endpoint : List.of("/api/v3/anmiao/contents/generations/tasks", "/v1/chat/completions", "/v1/media/generate?key=secret")) {
      managed(SeedanceAnciVideoClient.MODEL, endpoint, "/v1/media/status");
      assertThrows(ApiException.class, () -> client.createTask(request(input())));
    }
    managed(SeedanceAnciVideoClient.MODEL, "/v1/media/generate", "/v1/media/status?other=1");
    assertThrows(ApiException.class, () -> client.createTask(request(input())));
    reset(keys);
    assertFalse(client.supports("model-api-key:73", "canvas-video"));
    assertEquals(503, assertThrows(ApiException.class, () -> client.createTask(request(input()))).getCode());
    assertEquals(0, calls.get());
  }

  @Test void pollingUsesOriginalKeyAndStrictIsFinalRatherThanChineseDisplayOrStateAlone() throws Exception {
    when(keys.resolveFeatureRouteOption(anyString(), anyString(), anyString())).thenReturn(Optional.empty());
    for (String state : List.of("pending", "running", "success", "failed")) {
      response.set("{\"state\":\"" + state + "\",\"is_final\":false,\"status\":\"已完成\",\"progress\":\"45%\",\"result_url\":\"https://cdn.example/a.mp4\"}");
      var result = client.getTask(TASK, 7L);
      assertEquals(state.equals("pending") ? "queued" : "processing", result.getStatus());
      assertEquals(45, result.getProgress());
      assertTrue(result.getVideoUrls().isEmpty());
      assertEquals("task_id=" + ID, query.get());
      assertEquals("Bearer original-route-key", authorization.get());
    }
    verifyNoInteractions(media);
  }

  @Test void finalSuccessPersistsRealVideoAndPersistenceErrorsStayRetryable() throws Exception {
    response.set("{\"state\":\"success\",\"is_final\":true,\"result_url\":\"https://cdn.example/a.mp4\",\"result_type\":\"video\",\"cost\":0.23}");
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

  @Test void finalFailureReportsFailureAndNeverPersists() throws Exception {
    response.set("{\"state\":\"failed\",\"is_final\":true,\"status\":\"已完成\",\"error\":\"素材失效\"}");
    var result = client.getTask(TASK, 7L);
    assertEquals("failed", result.getStatus());
    assertEquals("素材失效", result.getError());
    verifyNoInteractions(media);
  }

  @Test void malformedStatusCannotBecomeFalseCompletionOrFailure() throws Exception {
    for (String body : List.of("{\"state\":\"success\",\"is_final\":\"true\"}",
        "{\"state\":\"success\"}", "{\"state\":\"succeeded\",\"is_final\":true}",
        "{\"state\":\"pending\",\"is_final\":true}", "{\"state\":\"running\",\"is_final\":true}",
        "{\"state\":\"success\",\"is_final\":true}",
        "{\"task_id\":\"other-task\",\"state\":\"failed\",\"is_final\":true}",
        "{\"state\":\"success\",\"is_final\":true,\"result_url\":\"https://cdn.example/a.mp4\",\"result_type\":\"image\"}",
        "{\"state\":\"success\",\"is_final\":true,\"result_url\":\"http://127.0.0.1/a.mp4\"}")) {
      response.set(body);
      assertThrows(ApiException.class, () -> client.getTask(TASK, 7L), body);
    }
    verifyNoInteractions(media);
  }

  @Test void malformedCreationAndUpstreamErrorsAreHonestAndSecretsAreRedacted() throws Exception {
    for (String body : List.of("{}", "{\"code\":200,\"data\":{\"task_id\":\"abc\"}}", "null", "<html>error</html>")) {
      response.set(body);
      assertThrows(ApiException.class, () -> client.createTask(request(input())));
    }
    response.set("{\"code\":403,\"msg\":\"original-route-key sk-secret-echo invalid\"}");
    httpStatus.set(403);
    var error = assertThrows(ApiException.class, () -> client.createTask(request(input())));
    assertEquals(403, error.getCode());
    assertFalse(error.getMessage().contains("original-route-key"));
    assertFalse(error.getMessage().contains("sk-secret-echo"));
  }

  @Test void taskEndpointSupportsDocumentedPlaceholderAndBareStatusPathWithoutDroppingOriginalId() throws Exception {
    response.set("{\"state\":\"running\",\"is_final\":false}");
    for (String path : List.of("/v1/media/status", "/v1/media/status?task_id=", "/v1/media/status?task_id={id}")) {
      managed(SeedanceAnciVideoClient.MODEL, "/v1/media/generate", path);
      client.getTask(TASK, 7L);
      assertEquals("task_id=" + ID, query.get());
    }
  }
}
