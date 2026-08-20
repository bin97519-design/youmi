package com.youmi.api.image;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class ImageGenerationClientWaveSpeedTest {

  private final ObjectMapper objectMapper = new ObjectMapper();

  @Test
  void createsAndPollsDedicatedMultipleAngleTask() throws Exception {
    AtomicReference<String> createBody = new AtomicReference<>("");
    AtomicReference<String> authorization = new AtomicReference<>("");
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/", exchange -> {
      authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
      String path = exchange.getRequestURI().getPath();
      if (path.equals("/api/v3/wavespeed-ai/qwen-image/edit-multiple-angles")) {
        createBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
        send(exchange, 200, "{\"code\":200,\"data\":{\"id\":\"prediction-1\",\"status\":\"created\"}}");
        return;
      }
      if (path.equals("/api/v3/predictions/prediction-1/result")) {
        send(exchange, 200, "{\"code\":200,\"data\":{\"id\":\"prediction-1\",\"status\":\"completed\",\"outputs\":[\"https://cdn.example.com/angle.webp\"]}}");
        return;
      }
      send(exchange, 404, "{\"error\":\"not found\"}");
    });
    server.start();

    try {
      ImageGenerationProperties properties = new ImageGenerationProperties();
      properties.setPersistGeneratedImages(false);
      properties.setTimeoutSeconds(5);
      properties.setWaveSpeedApiKey("test-key");
      properties.setWaveSpeedBaseUrl(
          "http://127.0.0.1:" + server.getAddress().getPort() + "/api/v3");
      ImageGenerationClient client = new ImageGenerationClient(objectMapper, properties);

      ImageGenerationDtos.CreateTaskRequest request = new ImageGenerationDtos.CreateTaskRequest(
          "保持主体一致",
          "wavespeed-ai/qwen-image/edit-multiple-angles",
          "auto",
          "auto",
          "1K",
          1,
          null,
          null,
          List.of("https://example.com/reference.png"),
          null,
          "webp",
          null,
          null,
          null,
          null,
          "multi-angle-client",
          315,
          30,
          2,
          42);

      ImageGenerationDtos.CreateTaskResponse created = client.createTask(request);
      assertEquals("wavespeed", created.provider());
      assertEquals("wavespeed:prediction-1", created.tasks().get(0).taskId());
      assertEquals("Bearer test-key", authorization.get());

      JsonNode body = objectMapper.readTree(createBody.get());
      assertEquals(315, body.path("horizontal_angle").asInt());
      assertEquals(30, body.path("vertical_angle").asInt());
      assertEquals(2, body.path("distance").asInt());
      assertEquals(42, body.path("seed").asInt());
      assertEquals("webp", body.path("output_format").asText());
      assertEquals("https://example.com/reference.png", body.path("images").get(0).asText());

      ImageGenerationDtos.TaskStatusResponse status = client.getTask("wavespeed:prediction-1");
      assertEquals("wavespeed", status.provider());
      assertEquals("persisting", status.status());
      assertEquals("https://cdn.example.com/angle.webp", status.imageUrls().get(0));
      assertTrue(status.raw().path("data").path("outputs").isArray());
    } finally {
      server.stop(0);
    }
  }

  private static void send(HttpExchange exchange, int status, String body) throws IOException {
    byte[] payload = body.getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
    exchange.sendResponseHeaders(status, payload.length);
    exchange.getResponseBody().write(payload);
    exchange.close();
  }
}
