package com.youmi.api.video;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import com.youmi.api.common.ApiException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.*;
import static org.junit.jupiter.api.Assertions.*;

class VideoEnhanceClientTest {
  final ObjectMapper mapper = new ObjectMapper();
  final VideoEnhanceProperties config = new VideoEnhanceProperties();
  final AtomicReference<String> response = new AtomicReference<>("{\"code\":200,\"data\":{\"task_id\":123456}}");
  JsonNode submitted;
  HttpServer server;
  VideoEnhanceClient client;
  @BeforeEach void setup() throws Exception {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/v1/media/", exchange -> {
      assertEquals("Bearer test-only", exchange.getRequestHeaders().getFirst("Authorization"));
      if ("POST".equals(exchange.getRequestMethod())) {
        assertEquals("/v1/media/generate", exchange.getRequestURI().getPath());
        submitted = mapper.readTree(exchange.getRequestBody());
      } else assertEquals("/v1/media/status?task_id=123456", exchange.getRequestURI().toString());
      byte[] bytes = response.get().getBytes(StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(200, bytes.length);
      exchange.getResponseBody().write(bytes); exchange.close();
    });
    server.start();
    config.setApiKey("test-only");
    config.setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort());
    client = new VideoEnhanceClient(config, mapper);
  }
  @AfterEach void stop() { server.stop(0); }
  static VideoEnhanceDtos.Settings settings(String version) {
    return new VideoEnhanceDtos.Settings("1080p", "keep", version, "aigc", "natural");
  }
  @Test void submitsVideoUrlAsStringWithoutPromptDurationOrGenerationParameters() throws Exception {
    assertEquals("123456", client.create("https://example.test/source.mp4", settings("standard")));
    assertEquals("video-enhance", submitted.path("model").asText());
    assertEquals(2, submitted.size());
    JsonNode params = submitted.path("params");
    assertEquals(6, params.size());
    assertEquals("https://example.test/source.mp4", params.path("video_url").textValue());
    assertEquals("1080p", params.path("resolution").asText());
    assertEquals("keep", params.path("fps").asText());
    assertEquals("natural", params.path("enhance_style").asText());
    assertEquals("aigc", params.path("scene").asText());
  }
  @Test void professionalOmitsSceneAndSupportsStringTaskId() throws Exception {
    response.set("{\"code\":200,\"data\":{\"task_id\":\"123456\"}}");
    client.create("https://example.test/source.mp4", settings("professional"));
    assertFalse(submitted.path("params").has("scene"));
    assertEquals("professional", submitted.path("params").path("tool_version").asText());
  }
  @Test void onlyBooleanFinalAndMachineStateControlCompletion() throws Exception {
    response.set("{\"state\":\"success\",\"is_final\":false,\"status\":\"已完成\",\"progress\":\"45%\"}");
    var state = client.poll("123456");
    assertFalse(state.terminal()); assertEquals(45, state.progress());
    response.set("{\"state\":\"failed\",\"is_final\":\"true\",\"progress\":\"invalid\"}");
    assertFalse(client.poll("123456").terminal()); assertNull(client.poll("123456").progress());
    response.set("{\"state\":\"success\",\"is_final\":true,\"progress\":\"100%\",\"result_url\":\"https://example.test/result.mp4\"}");
    assertTrue(client.poll("123456").terminal());
    response.set("{\"state\":\"failed\",\"is_final\":true,\"error\":{\"message\":\"source expired\"}}");
    assertEquals("source expired", client.poll("123456").error());
    response.set("{\"state\":\"running\",\"is_final\":true}");
    assertThrows(ApiException.class, () -> client.poll("123456"));
  }
  @Test void rejectsMissingKeyInvalidSettingsAndMalformedAcceptedTask() {
    config.setApiKey("");
    assertThrows(ApiException.class, () -> client.create("https://example.test/a.mp4", settings("standard")));
    assertNull(submitted);
    config.setApiKey("test-only");
    response.set("{\"code\":200,\"data\":{}}");
    assertThrows(ApiException.class, () -> client.create("https://example.test/a.mp4", settings("standard")));
    assertThrows(ApiException.class, () -> client.poll("../other"));
  }
}
