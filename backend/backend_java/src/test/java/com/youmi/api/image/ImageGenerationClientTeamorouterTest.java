package com.youmi.api.image;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class ImageGenerationClientTeamorouterTest {

  @ParameterizedTest
  @ValueSource(strings = {"gpt-image-2.5-sunburst", "gpt-image-2.5-flare"})
  void generationUsesJsonEndpointAndConstrainedPixelSize(String model) throws Exception {
    ObjectMapper mapper = new ObjectMapper();
    AtomicReference<JsonNode> requestBody = new AtomicReference<>();
    AtomicReference<String> authorization = new AtomicReference<>();
    AtomicReference<String> contentType = new AtomicReference<>();
    AtomicReference<String> method = new AtomicReference<>();
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/v1/images/generations", exchange -> {
      requestBody.set(mapper.readTree(exchange.getRequestBody()));
      authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
      contentType.set(exchange.getRequestHeaders().getFirst("Content-Type"));
      method.set(exchange.getRequestMethod());
      respondJson(exchange, "{\"data\":[{\"b64_json\":\"aGVsbG8=\"}]}");
    });
    server.start();

    try {
      ImageGenerationClient client = createClient(server);
      ImageGenerationDtos.CreateTaskRequest request = request(
          model, "21:9", "4K", List.of());

      ImageGenerationDtos.CreateTaskResponse created = client.createTask(request, 7L);
      ImageGenerationDtos.TaskStatusResponse status = awaitTerminal(client, created.tasks().get(0).taskId());

      assertEquals("teamorouter", created.provider());
      assertEquals("completed", status.status());
      assertEquals("data:image/png;base64,aGVsbG8=", status.imageUrls().get(0));
      assertEquals("POST", method.get());
      assertEquals("Bearer test-key", authorization.get());
      assertEquals("application/json", contentType.get());
      JsonNode body = requestBody.get();
      assertEquals(model, body.path("model").asText());
      assertEquals("a product", body.path("prompt").asText());
      assertEquals(1, body.path("n").asInt());
      assertEquals("high", body.path("quality").asText());
      assertValidPixelSize(body.path("size").asText());
    } finally {
      server.stop(0);
    }
  }

  @Test
  void editUsesMultipartEndpointWithOriginalReferenceImage() throws Exception {
    AtomicInteger generationCalls = new AtomicInteger();
    AtomicReference<String> editContentType = new AtomicReference<>();
    AtomicReference<String> editBody = new AtomicReference<>();
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/source.png", exchange -> {
      byte[] bytes = new byte[] {(byte) 0x89, 0x50, 0x4e, 0x47};
      exchange.getResponseHeaders().set("Content-Type", "image/png");
      exchange.sendResponseHeaders(200, bytes.length);
      exchange.getResponseBody().write(bytes);
      exchange.close();
    });
    server.createContext("/v1/images/generations", exchange -> {
      generationCalls.incrementAndGet();
      respondJson(exchange, "{\"data\":[]}");
    });
    server.createContext("/v1/images/edits", exchange -> {
      editContentType.set(exchange.getRequestHeaders().getFirst("Content-Type"));
      editBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.ISO_8859_1));
      respondJson(exchange, "{\"data\":[{\"b64_json\":\"aGVsbG8=\"}]}");
    });
    server.start();

    try {
      ImageGenerationClient client = createClient(server);
      String referenceUrl = "http://127.0.0.1:" + server.getAddress().getPort() + "/source.png";
      ImageGenerationDtos.CreateTaskRequest request = request(
          "gpt-image-2.5-flare", "3:4", "2K", List.of(referenceUrl));

      ImageGenerationDtos.CreateTaskResponse created = client.createTask(request, 8L);
      ImageGenerationDtos.TaskStatusResponse status = awaitTerminal(client, created.tasks().get(0).taskId());

      assertEquals("completed", status.status());
      assertEquals(0, generationCalls.get());
      assertTrue(editContentType.get().startsWith("multipart/form-data; boundary="));
      assertTrue(editBody.get().contains("name=\"model\""));
      assertTrue(editBody.get().contains("gpt-image-2.5-flare"));
      assertTrue(editBody.get().contains("name=\"image\"; filename="));
      assertTrue(editBody.get().contains("name=\"size\""));
    } finally {
      server.stop(0);
    }
  }

  private ImageGenerationClient createClient(HttpServer server) {
    ImageGenerationProperties properties = new ImageGenerationProperties();
    properties.setTeamorouterApiKey("test-key");
    properties.setTeamorouterBaseUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/v1");
    properties.setPersistGeneratedImages(false);
    return new ImageGenerationClient(new ObjectMapper(), properties);
  }

  private ImageGenerationDtos.CreateTaskRequest request(
      String model, String ratio, String resolution, List<String> imageUrls) {
    return new ImageGenerationDtos.CreateTaskRequest(
        "a product", model, ratio, ratio, resolution,
        1, null, null, imageUrls, null, "png", null, null, null, null, "client-test");
  }

  private ImageGenerationDtos.TaskStatusResponse awaitTerminal(
      ImageGenerationClient client, String taskId) throws Exception {
    ImageGenerationDtos.TaskStatusResponse status = client.getTask(taskId);
    for (int i = 0; i < 50 && "processing".equals(status.status()); i++) {
      Thread.sleep(20);
      status = client.getTask(taskId);
    }
    return status;
  }

  private void assertValidPixelSize(String size) {
    assertFalse(size.isBlank());
    String[] dimensions = size.split("x");
    assertEquals(2, dimensions.length);
    int width = Integer.parseInt(dimensions[0]);
    int height = Integer.parseInt(dimensions[1]);
    long pixels = (long) width * height;
    assertEquals(0, width % 16);
    assertEquals(0, height % 16);
    assertTrue(Math.max(width, height) <= 3840);
    assertTrue((double) Math.max(width, height) / Math.min(width, height) <= 3.0);
    assertTrue(pixels >= 655_360L);
    assertTrue(pixels <= 8_294_400L);
  }

  private void respondJson(com.sun.net.httpserver.HttpExchange exchange, String json) throws java.io.IOException {
    byte[] body = json.getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().set("Content-Type", "application/json");
    exchange.sendResponseHeaders(200, body.length);
    exchange.getResponseBody().write(body);
    exchange.close();
  }
}
