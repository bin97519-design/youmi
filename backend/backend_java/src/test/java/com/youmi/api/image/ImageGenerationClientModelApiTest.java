package com.youmi.api.image;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
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

  private void respondJson(com.sun.net.httpserver.HttpExchange exchange, String json)
      throws java.io.IOException {
    byte[] body = json.getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().set("Content-Type", "application/json");
    exchange.sendResponseHeaders(200, body.length);
    exchange.getResponseBody().write(body);
    exchange.close();
  }
}
