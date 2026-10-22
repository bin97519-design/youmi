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

/** Local HTTP mock only: no provider credentials, billing DB or paid generation. */
class WanxiangVideoClientTest {
  private static final String ID = "0009007199254740993100009";
  private static final String TASK = WanxiangVideoClient.PREFIX + "73:" + ID;
  private final ObjectMapper mapper = new ObjectMapper();
  private final ModelApiKeyService keys = mock(ModelApiKeyService.class);
  private final VideoGenerationClient media = mock(VideoGenerationClient.class);
  private final AtomicReference<JsonNode> submitted = new AtomicReference<>();
  private final AtomicReference<String> reply = new AtomicReference<>("{\"code\":200,\"data\":{\"task_id\":\"" + ID + "\"}}");
  private final AtomicReference<String> authorization = new AtomicReference<>();
  private final AtomicReference<String> query = new AtomicReference<>();
  private final AtomicInteger calls = new AtomicInteger();
  private final AtomicInteger httpStatus = new AtomicInteger(200);
  private HttpServer server;
  private String base;
  private WanxiangVideoClient client;

  @BeforeEach void setup() throws Exception {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/v1/media/", exchange -> {
      calls.incrementAndGet();
      authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
      query.set(exchange.getRequestURI().getRawQuery());
      if (exchange.getRequestMethod().equals("POST")) submitted.set(mapper.readTree(exchange.getRequestBody()));
      byte[] bytes = reply.get().getBytes(StandardCharsets.UTF_8);
      exchange.getResponseHeaders().set("Content-Type", "application/json");
      exchange.sendResponseHeaders(httpStatus.get(), bytes.length);
      exchange.getResponseBody().write(bytes);
      exchange.close();
    });
    server.start();
    base = "http://127.0.0.1:" + server.getAddress().getPort();
    client = new WanxiangVideoClient(keys, media, mapper);
    managed(WanxiangVideoClient.MODEL, "/v1/media/generate", "/v1/media/status?task_id={task_id}");
    when(media.persistVideoAsync(eq(TASK), eq(ID), anyString(), eq(7L)))
        .thenReturn("https://oss.example/users/7/result.mp4");
  }

  @AfterEach void stop() { server.stop(0); }

  private ResolvedModelApiKey managed(String model, String generation, String status) {
    var value = new ResolvedModelApiKey(73L, model, "Editable channel", base, generation,
        status, "original-route-key", Map.of("n", 50, "duration", 99, "seed", 42));
    when(keys.resolveFeatureRouteOption("model-api-key:73", ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video"))
        .thenReturn(Optional.of(value));
    when(keys.resolve(WanxiangVideoClient.MODEL, ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video"))
        .thenReturn(Optional.of(value));
    when(keys.resolveById(73L, ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION)).thenReturn(value);
    return value;
  }
  private ObjectNode input() {
    ObjectNode value = mapper.createObjectNode();
    value.put("model", "model-api-key:73").put("prompt", " 图1人物参考视频1动作 ")
        .put("feature_code", "canvas-video").put("parameter_profile", WanxiangVideoClient.PROFILE);
    value.putObject("wanxiang_params").put("version", "standard").put("resolution", "720P")
        .put("duration", "5").put("ratio", "adaptive").put("audio", true).put("prompt_extend", false);
    return value;
  }
  private ObjectNode params(ObjectNode input) { return (ObjectNode) input.path("wanxiang_params"); }
  private VideoGenerationDtos.CreateTaskRequest request(ObjectNode input) throws Exception {
    return mapper.treeToValue(input, VideoGenerationDtos.CreateTaskRequest.class);
  }
  private void addMedia(ObjectNode input, String kind, int count, double seconds) {
    String ext = kind.equals("image") ? ".png" : kind.equals("video") ? ".mp4" : ".mp3";
    for (int index = 0; index < count; index++) {
      String url = "https://assets.example/" + kind + index + ext;
      params(input).withArray(kind + "_url").add(url);
      if (!kind.equals("image")) input.withArray(kind.equals("video") ? "reference_videos" : "reference_audio_media")
          .addObject().put("url", url).put("durationSeconds", seconds);
    }
  }
  private void status(String state, boolean terminal) throws Exception {
    reply.set(mapper.writeValueAsString(mapper.createObjectNode().put("task_id", ID)
        .put("state", state).put("is_final", terminal).put("status", "中文展示不决定状态")
        .put("progress", "45%").put("result_url", "https://cdn.example/result.mp4")
        .put("result_type", "video").put("cost", 0.23)));
  }

  @Test void submitsExactDocumentedPayloadWithOnlyTopLevelCallbackAndOwnRouteKey() throws Exception {
    ObjectNode input = input().put("notify_url", "https://our.example/callback");
    addMedia(input, "image", 10, 0);
    addMedia(input, "video", 5, 2.5);
    addMedia(input, "audio", 5, 3);
    input.set("reference_image_urls", params(input).path("image_url"));
    input.set("reference_audios", params(input).path("audio_url"));
    var request = request(input);
    client.validate(request);
    assertEquals(0, calls.get());
    var result = client.createTask(request);
    assertEquals(TASK, result.getTaskId());
    assertEquals("model-api-key:73", result.getModel());
    assertEquals("queued", result.getStatus());
    assertEquals("Bearer original-route-key", authorization.get());
    JsonNode body = submitted.get();
    assertEquals(4, body.size());
    assertEquals(WanxiangVideoClient.MODEL, body.path("model").asText());
    assertEquals("图1人物参考视频1动作", body.path("prompt").asText());
    assertEquals("https://our.example/callback", body.path("notify_url").asText());
    assertEquals(params(input), body.path("params"));
    assertFalse(body.path("params").has("reference_videos"));
    assertFalse(body.path("params").has("reference_audio_media"));
    assertFalse(body.path("params").has("notify_url"));
    assertFalse(body.path("params").has("n"));
    assertFalse(body.path("params").has("seed"));
    verifyNoInteractions(media);
  }

  @Test void validatesEveryDocumentedEnumAndFixedDurationAndSmartDuration() throws Exception {
    for (int duration = 2; duration <= 30; duration++) {
      ObjectNode input = input(); params(input).put("duration", String.valueOf(duration));
      client.validate(request(input));
    }
    for (String version : List.of("standard", "prime")) for (String resolution : List.of("480P", "720P", "1080P"))
      for (String ratio : List.of("adaptive", "16:9", "9:16", "1:1", "4:3", "3:4")) {
        ObjectNode input = input(); params(input).put("version", version).put("resolution", resolution).put("ratio", ratio);
        client.validate(request(input));
      }
    ObjectNode smart = input(); params(smart).put("duration", "auto").put("audio", false).put("prompt_extend", true);
    addMedia(smart, "video", 1, 15);
    client.createTask(request(smart));
    assertEquals("auto", submitted.get().path("params").path("duration").asText());
    assertTrue(submitted.get().path("params").path("prompt_extend").isBoolean());
    assertFalse(submitted.get().path("params").path("audio").booleanValue());
    ObjectNode minimal = input(); params(minimal).remove(List.of("ratio", "audio", "prompt_extend"));
    client.validate(request(minimal));
  }

  @Test void invalidScalarsUnknownKeysAndNativeParametersFailBeforeDispatch() throws Exception {
    for (String duration : List.of("1", "31", "2.5", "5.0", "05", "AUTO", "")) {
      ObjectNode input = input(); params(input).put("duration", duration);
      assertThrows(ApiException.class, () -> client.validate(request(input)), duration);
    }
    for (String name : List.of("version", "resolution", "duration")) {
      ObjectNode input = input(); params(input).remove(name);
      assertThrows(ApiException.class, () -> client.validate(request(input)), name);
    }
    for (String name : List.of("audio", "prompt_extend")) {
      ObjectNode input = input(); params(input).put(name, "true");
      assertThrows(ApiException.class, () -> client.validate(request(input)), name);
    }
    for (String name : List.of("n", "count", "seed", "notify_url", "mode", "aspect_ratio")) {
      ObjectNode input = input(); params(input).put(name, "1");
      assertThrows(ApiException.class, () -> client.validate(request(input)), name);
    }
    for (String name : List.of("version", "resolution", "ratio", "first_frame_url", "negative_prompt")) {
      ObjectNode input = input().put(name, "invalid");
      assertThrows(ApiException.class, () -> client.validate(request(input)), name);
    }
    ObjectNode badRatio = input(); params(badRatio).put("ratio", "21:9");
    assertThrows(ApiException.class, () -> client.validate(request(badRatio)));
    ObjectNode badType = input(); params(badType).put("duration", 5);
    assertThrows(ApiException.class, () -> client.validate(request(badType)));
    assertEquals(0, calls.get());
  }

  @Test void rejectsReferenceCountsBadUrlsAndMissingOrMismatchedDurationMetadata() throws Exception {
    for (String kind : List.of("image", "video", "audio")) {
      ObjectNode excess = input(); addMedia(excess, kind, kind.equals("image") ? 11 : 6, 1);
      assertThrows(ApiException.class, () -> client.validate(request(excess)), kind);
      for (String url : List.of("data:image/png;base64,AA", "blob:x", "http://localhost/a", "http://127.0.0.1/a",
          "http://10.0.0.1/a", "https://user:pass@assets.example/a", "http://[::1]/a")) {
        ObjectNode invalid = input(); params(invalid).putArray(kind + "_url").add(url);
        assertThrows(ApiException.class, () -> client.validate(request(invalid)), url);
      }
    }
    for (String kind : List.of("video", "audio")) {
      for (double seconds : List.of(0d, -1d, 15.01d, Double.NaN, Double.POSITIVE_INFINITY)) {
        ObjectNode invalid = input(); addMedia(invalid, kind, 1, seconds);
        assertThrows(ApiException.class, () -> client.validate(request(invalid)), String.valueOf(seconds));
      }
      ObjectNode absent = input(); params(absent).putArray(kind + "_url").add("https://assets.example/a.mp4");
      assertThrows(ApiException.class, () -> client.validate(request(absent)));
      ObjectNode mismatch = input(); addMedia(mismatch, kind, 1, 1);
      ((ObjectNode) mismatch.path(kind.equals("video") ? "reference_videos" : "reference_audio_media").get(0))
          .put("url", "https://assets.example/other.mp4");
      assertThrows(ApiException.class, () -> client.validate(request(mismatch)));
    }
    ObjectNode duplicate = input(); addMedia(duplicate, "image", 1, 0);
    duplicate.putArray("reference_image_urls").add("https://assets.example/different.png");
    assertThrows(ApiException.class, () -> client.validate(request(duplicate)));
    assertEquals(0, calls.get());
  }

  @Test void enforcesIndependentFifteenSecondBudgetsAndThirtySecondCombinedVideoBudget() throws Exception {
    ObjectNode valid = input(); params(valid).put("duration", "15");
    addMedia(valid, "video", 5, 3); addMedia(valid, "audio", 5, 3);
    client.validate(request(valid));
    for (String kind : List.of("video", "audio")) {
      ObjectNode invalid = input(); addMedia(invalid, kind, 2, 8);
      assertThrows(ApiException.class, () -> client.validate(request(invalid)));
    }
    params(valid).put("duration", "16");
    assertThrows(ApiException.class, () -> client.validate(request(valid)));
    ObjectNode orphan = input(); orphan.putArray("reference_audio_media").addObject()
        .put("url", "https://assets.example/a.mp3").put("durationSeconds", 1);
    assertThrows(ApiException.class, () -> client.validate(request(orphan)));
  }

  @Test void supportsOnlyItsMappedModelAndProfileAndDoesNotFallBackFromAnExplicitRoute() throws Exception {
    assertTrue(client.supports(WanxiangVideoClient.MODEL, "canvas-video"));
    assertTrue(client.supports(WanxiangVideoClient.LEGACY_UI_MODEL, "canvas-video"));
    assertFalse(client.supports(WanxiangVideoClient.MODEL, "product-video-video"));
    assertFalse(client.supports("model-api-key:999", "canvas-video"));
    assertFalse(client.supports("kling-v3-omni-cankao", "canvas-video"));
    ObjectNode wrongProfile = input().put("parameter_profile", "canvas-v3-kling-omni");
    assertThrows(ApiException.class, () -> client.validate(request(wrongProfile)));
    managed("kling-v3-omni-cankao", "/v1/media/generate", "/v1/media/status");
    assertFalse(client.supports("model-api-key:73", "canvas-video"));
    assertThrows(ApiException.class, () -> client.validate(request(input())));
    assertEquals(0, calls.get());
  }

  @Test void validatesSameOriginOpenMediaEndpointsBeforeAnyDispatch() throws Exception {
    for (String generation : List.of("/v1/videos", "/v1/media/generate?key=bad")) {
      managed(WanxiangVideoClient.MODEL, generation, "/v1/media/status");
      assertThrows(ApiException.class, () -> client.validate(request(input())));
    }
    managed(WanxiangVideoClient.MODEL, "/v1/media/generate", "https://different.example/v1/media/status");
    assertThrows(ApiException.class, () -> client.validate(request(input())));
    assertEquals(0, calls.get());
  }

  @Test void pollingUsesStrictFinalMarkerAndStateRatherThanChineseDisplayStatus() throws Exception {
    for (String state : List.of("pending", "running", "success", "failed")) {
      status(state, false);
      assertEquals(state.equals("pending") ? "queued" : "processing", client.getTask(TASK, 7L).getStatus());
    }
    status("failed", true);
    assertEquals("failed", client.getTask(TASK, 7L).getStatus());
    assertEquals("task_id=" + ID, query.get());
    assertEquals("Bearer original-route-key", authorization.get());
    verifyNoInteractions(media);
  }

  @Test void onlyValidFinalVideoIsPersistedAndPersistenceFailureRemainsRetryable() throws Exception {
    status("success", true);
    var success = client.getTask(TASK, 7L);
    assertEquals("completed", success.getStatus());
    assertEquals(List.of("https://oss.example/users/7/result.mp4"), success.getVideoUrls());
    verify(media).persistVideoAsync(TASK, ID, "https://cdn.example/result.mp4", 7L);
    when(media.persistVideoAsync(TASK, ID, "https://cdn.example/result.mp4", 7L)).thenThrow(new RuntimeException("temporary"));
    assertEquals("persisting", client.getTask(TASK, 7L).getStatus());
    ObjectNode wrong = (ObjectNode) mapper.readTree(reply.get()); wrong.put("result_type", "image");
    reply.set(mapper.writeValueAsString(wrong));
    assertThrows(ApiException.class, () -> client.getTask(TASK, 7L));
  }

  @Test void invalidOrForeignTaskResponsesCannotCompleteOrPersist() throws Exception {
    for (String json : List.of("{\"state\":\"success\",\"is_final\":true}",
        "{\"task_id\":\"wrong\",\"state\":\"success\",\"is_final\":true}",
        "{\"task_id\":\"" + ID + "\",\"state\":\"unknown\",\"is_final\":false}",
        "{\"task_id\":\"" + ID + "\",\"state\":\"success\",\"is_final\":\"true\"}",
        "{\"task_id\":\"" + ID + "\",\"state\":\"running\",\"is_final\":true}")) {
      reply.set(json);
      assertThrows(ApiException.class, () -> client.getTask(TASK, 7L));
    }
    verifyNoInteractions(media);
    for (String id : List.of("wanxiang30:key:73:not-number", "wanxiang30:key:0:123", "kling-omni:key:73:123"))
      assertThrows(ApiException.class, () -> client.getTask(id, 7L));
  }

  @Test void providerErrorsAndRawStatusNeverExposeCredentialText() throws Exception {
    reply.set("{\"code\":500,\"msg\":\"original-route-key sk-testcredential\"}");
    String message = assertThrows(ApiException.class, () -> client.createTask(request(input()))).getMessage();
    assertFalse(message.contains("original-route-key"));
    assertFalse(message.contains("sk-testcredential"));
    status("failed", true);
    ObjectNode value = (ObjectNode) mapper.readTree(reply.get()); value.put("error", "original-route-key sk-testcredential");
    reply.set(mapper.writeValueAsString(value));
    var status = client.getTask(TASK, 7L);
    assertFalse(status.getRaw().toString().contains("original-route-key"));
    assertFalse(status.getError().contains("sk-testcredential"));
  }
}
