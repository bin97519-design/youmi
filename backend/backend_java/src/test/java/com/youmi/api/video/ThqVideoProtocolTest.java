package com.youmi.api.video;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import com.youmi.api.common.ApiException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.Test;

class ThqVideoProtocolTest {
  private final ObjectMapper mapper = new ObjectMapper();
  record Received(String method, String path, String authorization, String userAgent, String idempotencyKey,
      String contentType, JsonNode body, List<MultipartRequestTestSupport.FilePart> files) { }

  @Test void bothClientsUseTheSameCreateAndQueryContractWithoutMixingModelsOrKeys() throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    var received = new CopyOnWriteArrayList<Received>();
    server.createContext("/v1/videos", exchange -> {
      boolean create = "POST".equals(exchange.getRequestMethod());
      String contentType = exchange.getRequestHeaders().getFirst("Content-Type");
      var multipart = create && contentType.startsWith("multipart/")
          ? MultipartRequestTestSupport.parse(contentType, exchange.getRequestBody()) : null;
      JsonNode body = multipart != null ? mapper.valueToTree(multipart.fields()) : create ? mapper.readTree(exchange.getRequestBody()) : null;
      received.add(new Received(exchange.getRequestMethod(), exchange.getRequestURI().getPath(),
          exchange.getRequestHeaders().getFirst("Authorization"), exchange.getRequestHeaders().getFirst("User-Agent"),
          exchange.getRequestHeaders().getFirst("Idempotency-Key"), contentType, body, multipart == null ? List.of() : multipart.files()));
      String id = create && body.path("model").asText().equals(ChatVideoClient.MODEL) ? "whole-30" : "sd2-15";
      byte[] response = mapper.writeValueAsBytes(create
          ? Map.of("id", id, "status", "queued")
          : Map.of("status", "completed", "download_url", "https://result.test/video.mp4"));
      exchange.getResponseHeaders().add("Content-Type", "application/json");
      exchange.sendResponseHeaders(200, response.length);
      exchange.getResponseBody().write(response);
      exchange.close();
    });
    server.start();
    try {
      var config = new VideoGenerationProperties();
      String base = "http://127.0.0.1:" + server.getAddress().getPort() + "/v1";
      config.setBaseUrl(base);
      config.setChatBaseUrl(base + "/");
      config.setApiKey("original-15-key");
      config.setChatApiKey("dedicated-30-key");
      config.setPersistGeneratedVideos(false);
      var fifteen = new VideoGenerationClient(mapper, config, null);
      var media = mock(VideoGenerationClient.class);
      byte[] imageBytes = new byte[] {1, 2, 3, 0, (byte) 255};
      when(media.downloadReference(anyString())).thenReturn(new VideoGenerationClient.DownloadedAsset("image/png", imageBytes));
      var thirty = new ChatVideoClient(mapper, config, media);
      String originalReference = "data:image/png;base64,dGVzdA==";
      var fifteenInput = new VideoGenerationDtos.CreateTaskRequest("product", "seedance-2.0-fast-0826-720p",
          "16:9", 15, "720p", List.of(originalReference), originalReference, null, null, false, null, null, "fifteen-test");
      var fifteenTask = fifteen.createTask(fifteenInput);
      var thirtyInput = ChatVideoClientTest.request();
      var thirtyTask = thirty.taskState(thirty.generate(thirtyInput));
      assertEquals("queued", thirtyTask.status());
      assertEquals("completed", fifteen.getTask(fifteenTask.getTaskId(), 1L).getStatus());
      assertEquals("https://result.test/video.mp4", thirty.resultUrl(thirty.poll(thirtyTask.id())));

      assertEquals(4, received.size());
      for (Received request : received) assertEquals("Youmi-Canvas/1.0", request.userAgent());
      for (int i = 0; i < 2; i++) {
        Received request = received.get(i);
        assertEquals("POST", request.method());
        assertEquals("/v1/videos", request.path());
        assertEquals("16:9", request.body().path("aspect_ratio").asText());
        assertEquals("720p", request.body().path("resolution").asText());
        assertFalse(request.body().has("messages"));
      }
      assertEquals("15", received.get(0).body().path("seconds").textValue());
      assertEquals("30", received.get(1).body().path("seconds").textValue());
      assertEquals(fifteenInput.model(), received.get(0).body().path("model").asText());
      assertEquals(ChatVideoClient.MODEL, received.get(1).body().path("model").asText());
      assertEquals(originalReference, received.get(0).body().path("references").get(0).path("source").asText());
      assertEquals("application/json", received.get(0).contentType());
      assertTrue(received.get(0).body().path("generate_audio").isBoolean());
      assertFalse(received.get(0).body().path("generate_audio").asBoolean());
      assertTrue(received.get(1).contentType().startsWith("multipart/form-data;"));
      assertFalse(received.get(1).body().has("generate_audio"));
      assertFalse(received.get(1).body().has("references"));
      assertEquals(1, received.get(1).files().size());
      assertEquals("images[]", received.get(1).files().get(0).name());
      assertArrayEquals(imageBytes, received.get(1).files().get(0).bytes());
      verify(media).downloadReference(thirtyInput.firstFrameUrl());
      assertEquals("fifteen-test", received.get(0).idempotencyKey());
      assertEquals(thirtyInput.clientTaskId(), received.get(1).idempotencyKey());
      assertEquals("Bearer original-15-key", received.get(0).authorization());
      assertEquals("Bearer original-15-key", received.get(2).authorization());
      assertEquals("Bearer dedicated-30-key", received.get(1).authorization());
      assertEquals("Bearer dedicated-30-key", received.get(3).authorization());
      assertEquals("GET", received.get(2).method());
      assertEquals("GET", received.get(3).method());
      assertEquals("/v1/videos/sd2-15", received.get(2).path());
      assertEquals("/v1/videos/whole-30", received.get(3).path());
      assertEquals("original-15-key", config.getApiKey());
    } finally { server.stop(0); }
  }

  @Test void bodyKeepsOptionalFieldsAndFalseAudioConsistentWithTheExistingProtocol() throws Exception {
    var body = new ThqVideoProtocol.CreateBody("model", "prompt", "15", "3:4", "720p", false,
        List.of(), "avoid flicker", 0L);
    JsonNode json = mapper.valueToTree(body);
    assertFalse(json.has("references"));
    assertEquals("avoid flicker", json.path("negative_prompt").asText());
    assertEquals(0, json.path("seed").asLong());
    assertTrue(json.path("generate_audio").isBoolean());
    var empty = mapper.valueToTree(new ThqVideoProtocol.CreateBody("model", "prompt", "30", "3:4", "720p", false,
        List.of(), "", null));
    assertFalse(empty.has("negative_prompt"));
    assertFalse(empty.has("seed"));
    assertFalse(empty.has("duration"));
    assertEquals("30", empty.path("seconds").textValue());
    var request = ThqVideoProtocol.create(mapper, "https://provider.test/v1/", "test-key", 1200, "id-test", body);
    assertEquals("https://provider.test/v1/videos", request.uri().toString());
    assertEquals(Duration.ofSeconds(1200), request.timeout().orElseThrow());
    assertEquals("application/json", request.headers().firstValue("Content-Type").orElseThrow());
    assertEquals(mapper.writeValueAsString(body).getBytes(StandardCharsets.UTF_8).length,
        request.bodyPublisher().orElseThrow().contentLength());
  }

  @Test void queryEncodesTaskIdsAndRejectsMissingCredentialsWithoutSendingAnything() {
    var query = ThqVideoProtocol.query("https://provider.test/v1", "key", 5, "task/a b?#%");
    assertEquals("https://provider.test/v1/videos/task%2Fa%20b%3F%23%25", query.uri().toString());
    assertEquals(Duration.ofSeconds(30), query.timeout().orElseThrow());
    assertThrows(ApiException.class, () -> ThqVideoProtocol.query("https://provider.test/v1", "", 30, "task"));
  }

  @Test void omittedAudioIsDistinctFromFalseAndTrue() {
    for (Boolean audio : new Boolean[] {null, false, true}) {
      JsonNode json = mapper.valueToTree(new ThqVideoProtocol.CreateBody("model", "prompt", "30", "16:9", "720p",
          audio, List.of(), null, null));
      if (audio == null) assertFalse(json.has("generate_audio"));
      else {
        assertTrue(json.path("generate_audio").isBoolean());
        assertEquals(audio, json.path("generate_audio").booleanValue());
      }
    }
  }

  @Test void multipartCannotAccidentallyIncludeLegacyJsonReferences() {
    var body = new ThqVideoProtocol.CreateBody(ChatVideoClient.MODEL, "prompt", "30", "16:9", "720p", false,
        List.of(Map.of("type", "image", "role", "reference", "source", "https://assets.test/image.png")), null, null);
    var error = assertThrows(ApiException.class, () -> ThqVideoProtocol.createMultipart("https://provider.test/v1",
        "test-key", 1200, "mixed-format-test", body, List.of()));
    assertEquals(400, error.getCode());
    assertTrue(error.getMessage().contains("images[]"));
  }
}
