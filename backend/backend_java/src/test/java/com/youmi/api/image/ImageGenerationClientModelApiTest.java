package com.youmi.api.image;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class ImageGenerationClientModelApiTest {
  @Test
  void routesBanana21ThroughDatabaseCredentialAndPollsSameCredential() throws Exception {
    ObjectMapper mapper = new ObjectMapper();
    AtomicReference<JsonNode> requestBody = new AtomicReference<>();
    AtomicReference<String> authorization = new AtomicReference<>();
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/v1/media/generate", exchange -> {
      requestBody.set(mapper.readTree(exchange.getRequestBody()));
      authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
      respondJson(exchange, "{\"code\":200,\"data\":{\"task_id\":\"upstream-1\",\"status\":\"pending\"}}");
    });
    server.createContext("/v1/media/status", exchange -> {
      assertEquals("task_id=upstream-1", exchange.getRequestURI().getQuery());
      respondJson(exchange, "{\"state\":\"success\",\"is_final\":true,\"progress\":100,"
          + "\"result_url\":\"https://cdn.example.com/output.png\",\"cost\":0.07}");
    });
    server.start();

    try {
      String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
      ModelApiKeyService.ResolvedModelApiKey credential =
          new ModelApiKeyService.ResolvedModelApiKey(
              42L, "banana-2.1", "youmi888", baseUrl,
              "/v1/media/generate", "/v1/media/status", "test-key",
              Map.of("custom_parameter", "configured-value", "imageSize", "default-size"));
      ModelApiKeyService keyService = mock(ModelApiKeyService.class);
      when(keyService.resolve("banana-2.1")).thenReturn(Optional.of(credential));
      when(keyService.resolveById(42L)).thenReturn(credential);

      ImageGenerationProperties properties = new ImageGenerationProperties();
      properties.setPersistGeneratedImages(false);
      ImageGenerationClient client = new ImageGenerationClient(mapper, properties);
      client.setModelApiKeyService(keyService);

      ImageGenerationDtos.CreateTaskRequest request = new ImageGenerationDtos.CreateTaskRequest(
          "一张产品场景图", "banana-2.1", "auto", "auto", "2K",
          1, null, null, List.of("https://cdn.example.com/reference.png"),
          null, "png", null, null, null, null, "client-model-api-test");
      ImageGenerationDtos.CreateTaskResponse created = client.createTask(request, 7L);

      assertEquals("youmi888", created.provider());
      assertEquals("model-api:42:upstream-1", created.tasks().get(0).taskId());
      assertEquals("Bearer test-key", authorization.get());
      assertEquals("banana-2.1", requestBody.get().path("model").asText());
      assertEquals("auto", requestBody.get().path("params").path("aspectRatio").asText());
      assertEquals("2K", requestBody.get().path("params").path("imageSize").asText());
      assertEquals("configured-value", requestBody.get().path("params").path("custom_parameter").asText());
      assertTrue(requestBody.get().path("params").path("web_search").asBoolean());
      assertEquals(1, requestBody.get().path("params").path("images").size());

      ImageGenerationDtos.TaskStatusResponse status =
          client.getTask(created.tasks().get(0).taskId());
      assertEquals("completed", status.status());
      assertEquals(List.of("https://cdn.example.com/output.png"), status.imageUrls());
      assertEquals(0.07, status.raw().path("cost").asDouble());
    } finally {
      server.stop(0);
    }
  }

  @Test
  void mapsGptImage25VersionsToTtImage25Protocol() throws Exception {
    ObjectMapper mapper = new ObjectMapper();
    AtomicReference<JsonNode> requestBody = new AtomicReference<>();
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/v1/media/generate", exchange -> {
      requestBody.set(mapper.readTree(exchange.getRequestBody()));
      respondJson(exchange, "{\"code\":200,\"data\":{\"task_id\":123456}}");
    });
    server.start();

    try {
      String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
      ModelApiKeyService.ResolvedModelApiKey credential =
          new ModelApiKeyService.ResolvedModelApiKey(
              43L, "GPT-image2.5", "youmi888", baseUrl,
              "/v1/media/generate", "/v1/media/status", "test-key");
      ModelApiKeyService keyService = mock(ModelApiKeyService.class);
      when(keyService.resolve("GPT-image2.5")).thenReturn(Optional.of(credential));

      ImageGenerationProperties properties = new ImageGenerationProperties();
      properties.setPersistGeneratedImages(false);
      ImageGenerationClient client = new ImageGenerationClient(mapper, properties);
      client.setModelApiKeyService(keyService);

      ImageGenerationDtos.CreateTaskRequest request = new ImageGenerationDtos.CreateTaskRequest(
          "一张产品场景图", "GPT-image2.5", "3:4", "3:4", "4K",
          1, null, null, List.of("https://cdn.example.com/reference.png"),
          null, "png", null, null, null, null, "client-tt-image-test");
      ImageGenerationDtos.CreateTaskResponse created = client.createTask(request, 7L);

      assertEquals("model-api:43:123456", created.tasks().get(0).taskId());
      assertEquals("tt-image-2.5", created.model());
      assertEquals("tt-image-2.5", requestBody.get().path("model").asText());
      assertEquals("flare", requestBody.get().path("params").path("version").asText());
      assertEquals("3:4", requestBody.get().path("params").path("aspect_ratio").asText());
      assertEquals("4K", requestBody.get().path("params").path("resolution").asText());
      assertEquals("high", requestBody.get().path("params").path("quality").asText());
      assertEquals("auto", requestBody.get().path("params").path("background").asText());
      assertEquals(1, requestBody.get().path("params").path("images").size());
      assertTrue(requestBody.get().path("params").path("aspectRatio").isMissingNode());
      assertTrue(requestBody.get().path("params").path("imageSize").isMissingNode());

      ImageGenerationDtos.CreateTaskRequest sunburstRequest =
          new ImageGenerationDtos.CreateTaskRequest(
              "一张高质产品场景图", "gpt-image2.5-sunburst-api", "3:4", "3:4", "4K",
              1, null, null, List.of(), null, "png", null, null, null, null,
              "client-tt-image-sunburst-test");
      ImageGenerationDtos.CreateTaskResponse sunburstCreated =
          client.createTask(sunburstRequest, 7L);

      assertEquals("gpt-image2.5-sunburst-api", sunburstCreated.requestedModel());
      assertEquals("tt-image-2.5", requestBody.get().path("model").asText());
      assertEquals("sunburst", requestBody.get().path("params").path("version").asText());
      assertEquals("high", requestBody.get().path("params").path("quality").asText());
      assertEquals("auto", requestBody.get().path("params").path("background").asText());
    } finally {
      server.stop(0);
    }
  }

  @Test
  void routesBananaProApiOptionThroughConfiguredCredential() throws Exception {
    ObjectMapper mapper = new ObjectMapper();
    AtomicReference<JsonNode> requestBody = new AtomicReference<>();
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/v1/media/generate", exchange -> {
      requestBody.set(mapper.readTree(exchange.getRequestBody()));
      respondJson(exchange, "{\"code\":200,\"data\":{\"task_id\":\"banana-pro-task\"}}");
    });
    server.start();

    try {
      String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
      ModelApiKeyService.ResolvedModelApiKey credential =
          new ModelApiKeyService.ResolvedModelApiKey(
              44L, "banana-pro", "youmi888", baseUrl,
              "/v1/media/generate", "/v1/media/status", "test-key");
      ModelApiKeyService keyService = mock(ModelApiKeyService.class);
      when(keyService.resolve("banana-pro")).thenReturn(Optional.of(credential));

      ImageGenerationProperties properties = new ImageGenerationProperties();
      properties.setPersistGeneratedImages(false);
      ImageGenerationClient client = new ImageGenerationClient(mapper, properties);
      client.setModelApiKeyService(keyService);

      ImageGenerationDtos.CreateTaskRequest request = new ImageGenerationDtos.CreateTaskRequest(
          "一张产品场景图", "banana-pro-api", "1:1", "1:1", "2K",
          1, null, null, List.of(), null, "png", null, null, null, null,
          "client-banana-pro-test");
      ImageGenerationDtos.CreateTaskResponse created = client.createTask(request, 7L);

      assertEquals("banana-pro-api", created.requestedModel());
      assertEquals("banana-pro", created.model());
      assertEquals("banana-pro", requestBody.get().path("model").asText());
      assertEquals("1:1", requestBody.get().path("params").path("aspectRatio").asText());
      assertEquals("2K", requestBody.get().path("params").path("imageSize").asText());
      assertEquals(1, requestBody.get().path("params").path("n").asInt());
      assertTrue(requestBody.get().path("params").path("web_search").isMissingNode());
      assertTrue(requestBody.get().path("params").path("thinkingLevel").isMissingNode());
      assertEquals("model-api:44:banana-pro-task", created.tasks().get(0).taskId());
    } finally {
      server.stop(0);
    }
  }

  @Test
  void resolvesPersistedFeatureRouteOptionToItsMappedCredential() throws Exception {
    ObjectMapper mapper = new ObjectMapper();
    AtomicReference<JsonNode> requestBody = new AtomicReference<>();
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/v1/media/generate", exchange -> {
      requestBody.set(mapper.readTree(exchange.getRequestBody()));
      respondJson(exchange, "{\"code\":200,\"data\":{\"task_id\":\"mapped-route-task\"}}");
    });
    server.start();

    try {
      String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
      ModelApiKeyService.ResolvedModelApiKey credential =
          new ModelApiKeyService.ResolvedModelApiKey(
              44L, "banana-pro", "youmi888", baseUrl,
              "/v1/media/generate", "/v1/media/status", "test-key");
      ModelApiKeyService keyService = mock(ModelApiKeyService.class);
      when(keyService.resolveFeatureRouteOption("model-api-key:44",
          ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION, "canvas-creation-image"))
          .thenReturn(Optional.of(credential));

      ImageGenerationProperties properties = new ImageGenerationProperties();
      properties.setPersistGeneratedImages(false);
      ImageGenerationClient client = new ImageGenerationClient(mapper, properties);
      client.setModelApiKeyService(keyService);
      ImageGenerationDtos.CreateTaskRequest request = new ImageGenerationDtos.CreateTaskRequest(
          "一张产品场景图", "model-api-key:44", "1:1", "1:1", "2K",
          1, null, null, List.of(), null, "png", null, null, null, null,
          "client-mapped-route-test", null, null, null, null, "canvas-creation-image");

      ImageGenerationDtos.CreateTaskResponse created = client.createTask(request, 7L);

      assertEquals("banana-pro", requestBody.get().path("model").asText());
      assertEquals("youmi888", created.provider());
      assertEquals("banana-pro", created.requestedModel());
      assertEquals("model-api:44:mapped-route-task", created.tasks().get(0).taskId());
    } finally {
      server.stop(0);
    }
  }

  @Test
  void explicitTtVersionOverridesConfiguredVersionAndLegacyAlias() throws Exception {
    assertEquals("flare", submittedTtVersion("gpt-image2.5-sunburst-api", "GPT-image2.5",
        Map.of("version", "sunburst"), "flare"));
    assertEquals("sunburst", submittedTtVersion("model-api-key:45", "tt-image-2.5",
        Map.of("version", "flare"), "sunburst"));
  }

  @Test
  void mappedTtRouteRetainsValidConfiguredOrUnderlyingAliasVersion() throws Exception {
    assertEquals("sunburst", submittedTtVersion("model-api-key:45", "tt-image-2.5",
        Map.of("version", "sunburst"), null));
    assertEquals("sunburst", submittedTtVersion("model-api-key:45", "tt-image-2.5-sunburst",
        Map.of(), null));
    assertEquals("flare", submittedTtVersion("model-api-key:45", "tt-image-2.5-flare",
        Map.of("version", "unrecognized"), null));
    assertEquals("sunburst", submittedTtVersion("gpt-image2.5-sunburst-api", "GPT-image2.5",
        Map.of("version", "unrecognized"), null));
  }

  @Test
  void sendsActualSelectedTtParametersInsteadOfHardcodedQualityAndBackground() throws Exception {
    JsonNode params = submittedTtParameters(Map.of(
        "quality", "low", "background", "opaque", "version", "sunburst"),
        "max", "auto", "flare");

    assertEquals(new ObjectMapper().readTree("""
        {"aspect_ratio":"3:4","background":"auto","quality":"max",
         "resolution":"4K","version":"flare"}
        """), params);
  }

  @Test
  void forwardsEverySupportedTtQualityIncludingStandardMedium() throws Exception {
    for (String quality : List.of("auto", "low", "medium", "high", "xhigh", "max")) {
      JsonNode params = submittedTtParameters(Map.of("quality", "max"), quality, "auto", "flare");
      assertEquals(quality, params.path("quality").asText());
    }
  }

  @Test
  void forwardsEverySupportedTtBackgroundAndNormalizesWireValues() throws Exception {
    for (String background : List.of("auto", "opaque", "transparent")) {
      JsonNode params = submittedTtParameters(Map.of("background", "opaque"), "medium",
          " " + background.toUpperCase(java.util.Locale.ROOT) + " ", "flare");
      assertEquals(background, params.path("background").asText());
      assertEquals("medium", params.path("quality").asText());
    }
    assertEquals("xhigh", submittedTtParameters(Map.of(), " XHIGH ", "auto", "flare")
        .path("quality").asText());
  }

  @Test
  void omittedTtParametersRetainLegacyDefaults() throws Exception {
    JsonNode params = submittedTtParameters(Map.of("quality", "low", "background", "opaque"),
        null, null, "flare");
    assertEquals("high", params.path("quality").asText());
    assertEquals("auto", params.path("background").asText());
  }

  @Test
  void oldAndV2CanvasJsonKeepsOriginalParametersWithoutV3OptIn() throws Exception {
    ObjectMapper mapper = new ObjectMapper();
    for (String marker : List.of("", ",\"parameter_profile\":\"canvas-v2-image\"")) {
      ImageGenerationDtos.CreateTaskRequest request = mapper.readValue("""
          {"prompt":"旧版画布请求","model":"model-api-key:45","size":"3:4","ratio":"3:4",
           "resolution":"4K","n":1,"background":"transparent","quality":"max",
           "version":"flare","feature_code":"canvas-image"%s}
          """.formatted(marker), ImageGenerationDtos.CreateTaskRequest.class);
      JsonNode params = submittedTtRequest(Map.of(), request);
      assertEquals(mapper.readTree("""
          {"aspect_ratio":"3:4","background":"auto","quality":"high",
           "resolution":"4K","version":"flare"}
          """), params);
    }
    ImageGenerationDtos.CreateTaskRequest request = mapper.readValue("""
        {"prompt":"旧版兼容请求","model":"model-api-key:45","size":"1:1","resolution":"2K",
         "quality":"legacy-unvalidated-value","background":"legacy-unvalidated-value",
         "feature_code":"canvas-image"}
        """, ImageGenerationDtos.CreateTaskRequest.class);
    JsonNode params = submittedTtRequest(Map.of(), request);
    assertEquals("high", params.path("quality").asText());
    assertEquals("auto", params.path("background").asText());
  }

  @Test
  void legacyTtVersionStillUsesRequestedAliasWithoutV3OptIn() throws Exception {
    ObjectMapper mapper = new ObjectMapper();
    for (String requestedModel : List.of("model-api-key:45", "gpt-image2.5-sunburst-api")) {
      ImageGenerationDtos.CreateTaskRequest request = mapper.readValue("""
          {"prompt":"旧版版本兼容","model":"%s","size":"3:4","resolution":"4K","n":1,
           "version":"invalid-version-is-ignored-on-legacy","quality":"max","background":"transparent",
           "feature_code":"canvas-image"}
          """.formatted(requestedModel), ImageGenerationDtos.CreateTaskRequest.class);
      JsonNode params = submittedTtRequest(Map.of("version", "sunburst", "quality", "low",
          "background", "opaque"), request);
      assertEquals(requestedModel.contains("sunburst") ? "sunburst" : "flare",
          params.path("version").asText());
      assertEquals("high", params.path("quality").asText());
      assertEquals("auto", params.path("background").asText());
    }
  }

  @Test
  void rejectsInvalidExplicitTtQualityAndBackgroundBeforeAnyProviderRequest() throws Exception {
    AtomicInteger requests = new AtomicInteger();
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/v1/media/generate", exchange -> {
      requests.incrementAndGet();
      respondJson(exchange, "{\"data\":{\"task_id\":\"unexpected\"}}");
    });
    server.start();
    try {
      ModelApiKeyService.ResolvedModelApiKey credential = new ModelApiKeyService.ResolvedModelApiKey(
          45L, "tt-image-2.5", "youmi888", "http://127.0.0.1:" + server.getAddress().getPort(),
          "/v1/media/generate", "/v1/media/status", "test-key");
      ImageGenerationClient client = mappedTtClient(credential);
      ApiException qualityError = assertThrows(ApiException.class,
          () -> client.createTask(ttParametersRequest("unrecognized", "auto", "flare"), 7L));
      ApiException backgroundError = assertThrows(ApiException.class,
          () -> client.createTask(ttParametersRequest("max", "unrecognized", "flare"), 7L));
      assertEquals(400, qualityError.getCode());
      assertEquals(400, backgroundError.getCode());
      assertEquals(0, requests.get());
    } finally {
      server.stop(0);
    }
  }

  @Test
  void invalidExplicitTtVersionIsRejectedWithoutProviderRequest() throws Exception {
    AtomicInteger requests = new AtomicInteger();
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/v1/media/generate", exchange -> {
      requests.incrementAndGet();
      respondJson(exchange, "{\"data\":{\"task_id\":\"unexpected\"}}");
    });
    server.start();
    try {
      ModelApiKeyService.ResolvedModelApiKey credential = new ModelApiKeyService.ResolvedModelApiKey(
          45L, "tt-image-2.5", "youmi888", "http://127.0.0.1:" + server.getAddress().getPort(),
          "/v1/media/generate", "/v1/media/status", "test-key");
      ImageGenerationClient client = mappedTtClient(credential);
      ApiException error = assertThrows(ApiException.class,
          () -> client.createTask(ttVersionRequest("model-api-key:45", "unknown"), 7L));
      assertEquals(400, error.getCode());
      assertEquals(0, requests.get());
    } finally {
      server.stop(0);
    }
  }

  @Test
  void versionSurvivesJsonAndPromptPresetExpansion() throws Exception {
    ObjectMapper mapper = new ObjectMapper();
    ImageGenerationDtos.CreateTaskRequest request = mapper.readValue("""
        {"prompt":"@风格迁移 不要文字","model":"model-api-key:45","version":"sunburst",
         "feature_code":"canvas-image","client_task_id":"version-preset"}
        """, ImageGenerationDtos.CreateTaskRequest.class);
    ImageGenerationDtos.CreateTaskRequest expanded = ImagePromptPresets.expand(request);
    assertEquals("sunburst", expanded.version());
    assertEquals("canvas-image", expanded.featureCode());
    assertEquals("version-preset", expanded.clientTaskId());
    assertTrue(expanded.prompt().contains("共有两张参考图"));
    assertEquals("sunburst", mapper.valueToTree(expanded).path("version").asText());
  }

  @Test
  void nonTtModelDoesNotGainVersionParameter() throws Exception {
    ObjectMapper mapper = new ObjectMapper();
    AtomicReference<JsonNode> requestBody = new AtomicReference<>();
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/v1/media/generate", exchange -> {
      requestBody.set(mapper.readTree(exchange.getRequestBody()));
      respondJson(exchange, "{\"data\":{\"task_id\":\"banana-version-test\"}}");
    });
    server.start();
    try {
      ModelApiKeyService.ResolvedModelApiKey credential = new ModelApiKeyService.ResolvedModelApiKey(
          45L, "banana-2.1", "youmi888", "http://127.0.0.1:" + server.getAddress().getPort(),
          "/v1/media/generate", "/v1/media/status", "test-key");
      mappedTtClient(credential).createTask(
          ttParametersRequest("not-a-tt-quality", "not-a-tt-background", "sunburst"), 7L);
      assertTrue(requestBody.get().path("params").path("version").isMissingNode());
      assertTrue(requestBody.get().path("params").path("quality").isMissingNode());
      assertTrue(requestBody.get().path("params").path("background").isMissingNode());
      assertEquals("banana-2.1", requestBody.get().path("model").asText());
    } finally {
      server.stop(0);
    }
  }

  private String submittedTtVersion(String requestedModel, String credentialModel,
      Map<String, Object> defaults, String explicitVersion) throws Exception {
    ObjectMapper mapper = new ObjectMapper();
    AtomicReference<JsonNode> requestBody = new AtomicReference<>();
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/v1/media/generate", exchange -> {
      requestBody.set(mapper.readTree(exchange.getRequestBody()));
      respondJson(exchange, "{\"data\":{\"task_id\":\"tt-version-test\"}}");
    });
    server.start();
    try {
      ModelApiKeyService.ResolvedModelApiKey credential = new ModelApiKeyService.ResolvedModelApiKey(
          45L, credentialModel, "youmi888", "http://127.0.0.1:" + server.getAddress().getPort(),
          "/v1/media/generate", "/v1/media/status", "test-key", defaults);
      ImageGenerationClient client = mappedTtClient(credential);
      client.createTask(ttVersionRequest(requestedModel, explicitVersion), 7L);
      assertEquals("tt-image-2.5", requestBody.get().path("model").asText());
      assertEquals("high", requestBody.get().path("params").path("quality").asText());
      assertEquals("auto", requestBody.get().path("params").path("background").asText());
      return requestBody.get().path("params").path("version").asText();
    } finally {
      server.stop(0);
    }
  }

  private ImageGenerationClient mappedTtClient(ModelApiKeyService.ResolvedModelApiKey credential) {
    ModelApiKeyService keyService = mock(ModelApiKeyService.class);
    when(keyService.resolveFeatureRouteOption("model-api-key:45",
        ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION, "canvas-image"))
        .thenReturn(Optional.of(credential));
    when(keyService.resolve("gpt-image2.5-sunburst-api",
        ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION, "canvas-image"))
        .thenReturn(Optional.of(credential));
    ImageGenerationProperties properties = new ImageGenerationProperties();
    properties.setPersistGeneratedImages(false);
    ImageGenerationClient client = new ImageGenerationClient(new ObjectMapper(), properties);
    client.setModelApiKeyService(keyService);
    return client;
  }

  private JsonNode submittedTtParameters(Map<String, Object> defaults, String quality,
      String background, String version) throws Exception {
    return submittedTtRequest(defaults, ttParametersRequest(quality, background, version));
  }

  private JsonNode submittedTtRequest(Map<String, Object> defaults,
      ImageGenerationDtos.CreateTaskRequest request) throws Exception {
    ObjectMapper mapper = new ObjectMapper();
    AtomicReference<JsonNode> requestBody = new AtomicReference<>();
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/v1/media/generate", exchange -> {
      requestBody.set(mapper.readTree(exchange.getRequestBody()));
      respondJson(exchange, "{\"data\":{\"task_id\":\"actual-params-test\"}}");
    });
    server.start();
    try {
      ModelApiKeyService.ResolvedModelApiKey credential = new ModelApiKeyService.ResolvedModelApiKey(
          45L, "tt-image-2.5", "youmi888", "http://127.0.0.1:" + server.getAddress().getPort(),
          "/v1/media/generate", "/v1/media/status", "test-key", defaults);
      mappedTtClient(credential).createTask(request, 7L);
      assertEquals("tt-image-2.5", requestBody.get().path("model").asText());
      assertTrue(requestBody.get().path("parameter_profile").isMissingNode());
      assertTrue(requestBody.get().path("params").path("parameter_profile").isMissingNode());
      return requestBody.get().path("params");
    } finally {
      server.stop(0);
    }
  }

  private ImageGenerationDtos.CreateTaskRequest ttParametersRequest(String quality,
      String background, String version) {
    return new ImageGenerationDtos.CreateTaskRequest(
        "一张产品场景图", "model-api-key:45", "3:4", "3:4", "4K", 1,
        null, null, List.of(), background, "png", null, null, null, null, "actual-params-test",
        null, null, null, null, "canvas-image", version, quality, "canvas-v3-image");
  }

  private ImageGenerationDtos.CreateTaskRequest ttVersionRequest(String model, String version) {
    return new ImageGenerationDtos.CreateTaskRequest("一张产品场景图", model, "3:4", "3:4", "2K",
        1, null, null, List.of(), null, "png", null, null, null, null, "version-test",
        null, null, null, null, "canvas-image", version, null, "canvas-v3-image");
  }

  private void respondJson(com.sun.net.httpserver.HttpExchange exchange, String json)
      throws java.io.IOException {
    byte[] body = json.getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().set("Content-Type", "application/json");
    exchange.sendResponseHeaders(200, body.length);
    exchange.getResponseBody().write(body);
    exchange.close();
  }
}
