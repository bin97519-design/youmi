package com.youmi.api.video;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import com.youmi.api.common.ApiException;
import com.youmi.api.image.ModelApiKeyService;
import java.util.Optional;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import static org.junit.jupiter.api.Assertions.*;

class VideoEnhanceClientTest {
  final ObjectMapper mapper = new ObjectMapper();
  final VideoEnhanceProperties config = new VideoEnhanceProperties();
  final AtomicReference<String> response = new AtomicReference<>("{\"code\":200,\"data\":{\"task_id\":123456}}");
  final AtomicReference<String> expectedAuthorization = new AtomicReference<>("Bearer test-only");
  JsonNode submitted;
  HttpServer server;
  VideoEnhanceClient client;
  @BeforeEach void setup() throws Exception {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/v1/media/", exchange -> {
      assertEquals(expectedAuthorization.get(), exchange.getRequestHeaders().getFirst("Authorization"));
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
  @Test void mappedEnhancementCredentialRoutesSubmissionAndPolling() throws Exception {
    var keys = org.mockito.Mockito.mock(ModelApiKeyService.class);
    var mapped = new ModelApiKeyService.ResolvedModelApiKey(42L, "video-enhance", "lk888",
        config.getBaseUrl(), "/v1/media/generate", "/v1/media/status", "mapped-secret");
    org.mockito.Mockito.when(keys.preferredEnabledModel(ModelApiKeyService.MODEL_TYPE_VIDEO_ENHANCEMENT, "video-enhancement"))
        .thenReturn(Optional.of(mapped));
    org.mockito.Mockito.when(keys.resolveById(42L, ModelApiKeyService.MODEL_TYPE_VIDEO_ENHANCEMENT)).thenReturn(mapped);
    client.setModelApiKeys(keys);
    expectedAuthorization.set("Bearer mapped-secret");

    var submission = client.createSubmission("https://example.test/source.mp4", settings("standard"));
    assertEquals("123456", submission.taskId());
    assertEquals(42L, submission.credentialId());
    assertEquals("video-enhance", submitted.path("model").asText());

    response.set("{\"state\":\"running\",\"is_final\":false}");
    assertEquals("running", client.poll(submission.taskId(), submission.credentialId()).state());
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
  @ParameterizedTest
  @ValueSource(strings = {
      "/v1/media/status?task_id={task_id}",
      "/v1/media/status?task_id={id}",
      "/v1/media/status?task_id=",
      "/v1/media/status?task_id=old"
  })
  void mappedTaskPathsQueryTheOriginalTaskExactlyOnce(String taskPath) throws Exception {
    var keys = org.mockito.Mockito.mock(ModelApiKeyService.class);
    var mapped = new ModelApiKeyService.ResolvedModelApiKey(42L, "video-enhance", "lk888",
        config.getBaseUrl(), "/v1/media/generate", taskPath, "mapped-secret");
    org.mockito.Mockito.when(keys.resolveById(42L, ModelApiKeyService.MODEL_TYPE_VIDEO_ENHANCEMENT))
        .thenReturn(mapped);
    client.setModelApiKeys(keys);
    expectedAuthorization.set("Bearer mapped-secret");
    response.set("{\"state\":\"running\",\"is_final\":false}");

    assertEquals("running", client.poll("123456", 42L).state());
    assertNull(submitted);
    org.mockito.Mockito.verify(keys).resolveById(42L, ModelApiKeyService.MODEL_TYPE_VIDEO_ENHANCEMENT);
  }
  @Test void taskPathPreservesOtherQueryParametersWithoutDuplicatingTaskIds() {
    assertEquals("/v1/media/status?format=json&task_id=123456", VideoEnhanceClient.taskPath(
        "/v1/media/status?task_id=old&format=json&task_id=other", "123456"));
    assertEquals("/v1/media/tasks/123456?format=json", VideoEnhanceClient.taskPath(
        "/v1/media/tasks/{task_id}?format=json", "123456"));
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
