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
import java.util.ArrayList;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class SeedanceAnciVideoProductCompatibilityTest {
  final ObjectMapper mapper = new ObjectMapper();

  VideoGenerationDtos.CreateTaskRequest request(String patch) throws Exception {
    var value = mapper.readTree("""
        {"prompt":"商品在阳光中缓慢旋转","model":"seedance-2.0-anci","ratio":"3:4",
         "durationSeconds":15,"resolution":"720p","version":"快速","image_urls":[]}
        """);
    ((com.fasterxml.jackson.databind.node.ObjectNode) value).setAll((com.fasterxml.jackson.databind.node.ObjectNode) mapper.readTree(patch));
    return mapper.treeToValue(value, VideoGenerationDtos.CreateTaskRequest.class);
  }

  @Test void mediaContractVersionsReferencesAndTerminalStatesArePreserved() throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    var bodies = new ArrayList<JsonNode>();
    var status = new AtomicReference<>("""
        {"state":"running","status":"已完成","is_final":false,"progress":"100%","result_url":"https://assets.example/early.mp4","cost":0}
        """);
    server.createContext("/v1/media/generate", exchange -> {
      assertEquals("Bearer test-secret", exchange.getRequestHeaders().getFirst("Authorization"));
      bodies.add(mapper.readTree(exchange.getRequestBody()));
      byte[] bytes = "{\"code\":200,\"data\":{\"task_id\":123456}}".getBytes(StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(200, bytes.length); exchange.getResponseBody().write(bytes); exchange.close();
    });
    server.createContext("/v1/media/status", exchange -> {
      assertEquals("task_id=123456", exchange.getRequestURI().getQuery());
      byte[] bytes = status.get().getBytes(StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(200, bytes.length); exchange.getResponseBody().write(bytes); exchange.close();
    });
    server.start();
    try {
      var keys = mock(ModelApiKeyService.class);
      var key = new ResolvedModelApiKey(43L, SeedanceAnciVideoClient.MODEL, "arbitrary-provider-label",
          "http://127.0.0.1:" + server.getAddress().getPort(), "/v1/media/generate",
          "/v1/media/status?task_id={task_id}", "test-secret", Map.of("generate_audio", false, "duration", 30));
      when(keys.resolve(SeedanceAnciVideoClient.MODEL, "video_generation", "canvas-video")).thenReturn(Optional.of(key));
      when(keys.resolveById(43L, "video_generation")).thenReturn(key);
      var properties = new AnmiaoVideoProperties(); properties.setPersistGeneratedVideos(false);
      var media = mock(VideoGenerationClient.class);
      var client = new SeedanceAnciVideoClient(keys, media, properties, mapper, null);
      for (String version : java.util.List.of("快速", "标准")) {
        var images = mapper.createArrayNode();
        for (int i = 0; i < 9; i++) images.add("https://assets.example/" + i + ".png");
        var input = request("{\"version\":\"" + version + "\",\"image_urls\":" + images
            + ",\"notify_url\":\"https://app.example/video-callback\"}");
        assertEquals(0, client.price(input));
        assertEquals("seedance-anci:key:43:123456", client.createTask(input).getTaskId());
        JsonNode body = bodies.get(bodies.size() - 1);
        assertEquals(4, body.size());
        assertEquals(SeedanceAnciVideoClient.MODEL, body.path("model").asText());
        assertEquals("cankaosheng", body.path("params").path("mode").asText());
        assertEquals(version, body.path("params").path("version").asText());
        assertTrue(body.path("params").path("duration").isTextual());
        assertEquals("15", body.path("params").path("duration").asText());
        assertEquals("720p", body.path("params").path("resolution").asText());
        assertEquals("3:4", body.path("params").path("aspect_ratio").asText());
        assertEquals(images, body.path("params").path("images"));
        assertEquals("https://app.example/video-callback", body.path("notify_url").asText());
        assertFalse(body.path("params").has("notify_url"));
        assertFalse(body.has("generate_audio"));
      }
      assertEquals(0, client.price(request("{\"durationSeconds\":4}")));
      client.createTask(request("{\"durationSeconds\":4}"));
      assertFalse(bodies.get(2).path("params").has("images"));
      assertEquals(3, bodies.get(2).size());
      var running = client.getTask("seedance-anci:key:43:123456", 7L);
      assertEquals("processing", running.getStatus()); assertTrue(running.getVideoUrls().isEmpty());
      status.set("{\"state\":\"success\",\"is_final\":false,\"progress\":\"100%\"}");
      assertEquals("processing", client.getTask("seedance-anci:key:43:123456", 7L).getStatus());
      status.set("{\"state\":\"success\",\"status\":\"失败\",\"is_final\":true,\"result_url\":\"https://assets.example/final.mp4\",\"cost\":0.23}");
      when(keys.resolve(anyString(), anyString(), anyString())).thenReturn(Optional.empty());
      var complete = client.getTask("seedance-anci:key:43:123456", 7L);
      assertEquals("completed", complete.getStatus());
      assertEquals(java.util.List.of("https://assets.example/final.mp4"), complete.getVideoUrls());
      assertEquals(0.23, complete.getRaw().path("cost").asDouble());
      status.set("{\"state\":\"failed\",\"status\":\"已完成\",\"is_final\":true,\"error\":\"任务失败已退款\"}");
      assertEquals("failed", client.getTask("seedance-anci:key:43:123456", 7L).getStatus());
      status.set("{\"state\":\"running\",\"is_final\":true}");
      assertEquals(502, assertThrows(ApiException.class, () -> client.getTask("seedance-anci:key:43:123456", 7L)).getCode());
      verifyNoInteractions(media);
    } finally { server.stop(0); }
  }

  @Test void unsupportedInputsAreRejectedBeforeResolvingCredentialsOrCreatingBillableTasks() throws Exception {
    var keys = mock(ModelApiKeyService.class);
    var client = new SeedanceAnciVideoClient(keys, mock(VideoGenerationClient.class), new AnmiaoVideoProperties(), mapper, null);
    for (String patch : java.util.List.of("{\"version\":null}", "{\"version\":\"fast\"}", "{\"durationSeconds\":3}",
        "{\"durationSeconds\":16}", "{\"resolution\":\"1080p\"}", "{\"ratio\":\"21:9\"}", "{\"ratio\":\"adaptive\"}",
        "{\"first_frame_url\":\"https://a.example/a.png\"}", "{\"last_frame_url\":\"https://a.example/a.png\"}",
        "{\"generate_audio\":false}", "{\"image_urls\":[\"data:image/png;base64,AA==\"]}",
        "{\"reference_videos\":[{\"url\":\"https://a.example/a.mp4\",\"durationSeconds\":5}]}", "{\"prompt\":\" \"}")) {
      var input = request(patch);
      assertEquals(400, assertThrows(ApiException.class, () -> client.price(input), patch).getCode());
    }
    var images = mapper.createArrayNode(); for (int i = 0; i < 10; i++) images.add("https://a.example/" + i + ".png");
    var input = request("{\"image_urls\":" + images + "}");
    assertEquals(400, assertThrows(ApiException.class, () -> client.price(input)).getCode());
    verifyNoInteractions(keys);
  }

  @Test void productFeatureUsesItsOwnCredentialPreservesVersionAndLegacyTaskPolling() throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    var submitted = new AtomicReference<JsonNode>();
    server.createContext("/v1/media/", exchange -> {
      assertEquals("Bearer product-only-test", exchange.getRequestHeaders().getFirst("Authorization"));
      boolean post = exchange.getRequestMethod().equals("POST");
      if (post) submitted.set(mapper.readTree(exchange.getRequestBody()));
      String body = post ? "{\"code\":0,\"data\":{\"task_id\":\"00090071992547409931\"}}"
          : "{\"code\":200,\"data\":{\"task_id\":\"00090071992547409931\",\"state\":\"success\",\"is_final\":true,\"cost\":0.23,\"result_url\":\"https://cdn.example/product.mp4\",\"result_type\":\"video\"}}";
      byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(200, bytes.length); exchange.getResponseBody().write(bytes); exchange.close();
    });
    server.start();
    try {
      var keys = mock(ModelApiKeyService.class); var media = mock(VideoGenerationClient.class);
      var key = new ResolvedModelApiKey(43L, SeedanceAnciVideoClient.MODEL, "product channel",
          "http://127.0.0.1:" + server.getAddress().getPort(), "/v1/media/generate", "/v1/media/status", "product-only-test");
      when(keys.resolve(SeedanceAnciVideoClient.MODEL, "video_generation", "product-video-video")).thenReturn(Optional.of(key));
      when(keys.resolveById(43L, "video_generation")).thenReturn(key);
      var properties = new AnmiaoVideoProperties(); properties.setPersistGeneratedVideos(false);
      var client = new SeedanceAnciVideoClient(keys, media, properties, mapper, null);
      var input = request("{\"feature_code\":\"product-video-video\",\"version\":\"标准\",\"generate_audio\":true}");
      assertTrue(client.supports(input.model(), "product-video-video"));
      assertEquals(0, client.price(input));
      var created = client.createTask(input);
      assertEquals("seedance-anci:key:43:00090071992547409931", created.getTaskId());
      assertEquals("标准", submitted.get().path("params").path("version").asText());
      assertEquals("15", submitted.get().path("params").path("duration").asText());
      assertFalse(submitted.get().path("params").has("generate_audio"));
      var result = client.getTask(created.getTaskId(), 7L);
      assertEquals("completed", result.getStatus());
      assertEquals(java.util.List.of("https://cdn.example/product.mp4"), result.getVideoUrls());
      assertEquals(0.23, result.getRaw().path("cost").asDouble());
      verify(keys, never()).resolve(anyString(), anyString(), eq("canvas-video"));
      verifyNoInteractions(media);
    } finally { server.stop(0); }
  }

  @Test void productWithoutItsOwnBindingNeverBorrowsCanvasCredential() throws Exception {
    var keys = mock(ModelApiKeyService.class); var media = mock(VideoGenerationClient.class);
    var canvasKey = new ResolvedModelApiKey(43L, SeedanceAnciVideoClient.MODEL, "canvas only", "https://api.example",
        "/v1/media/generate", "/v1/media/status", "not-used");
    when(keys.resolve(SeedanceAnciVideoClient.MODEL, "video_generation", "canvas-video")).thenReturn(Optional.of(canvasKey));
    var client = new SeedanceAnciVideoClient(keys, media, new AnmiaoVideoProperties(), mapper, null);
    var input = request("{\"feature_code\":\"product-video-video\"}");
    assertFalse(client.supports(input.model(), "product-video-video"));
    assertEquals(503, assertThrows(ApiException.class, () -> client.price(input)).getCode());
    verify(keys, never()).resolve(anyString(), anyString(), eq("canvas-video"));
    verifyNoInteractions(media);
  }

  @Test void legacyVersionConstructorDoesNotCollideWithCanvasProfileConstructor() {
    var input = new VideoGenerationDtos.CreateTaskRequest("商品展示", SeedanceAnciVideoClient.MODEL, "3:4", 15,
        "720p", java.util.List.of("https://assets.example/a.png"), null, null, null, true,
        null, null, "product-video-id", "product-video-video", java.util.List.of(), "标准");
    assertEquals("标准", input.version()); assertNull(input.parameterProfile());
    assertTrue(input.omniParams().isEmpty()); assertTrue(input.wanxiangParams().isEmpty());
  }
}
