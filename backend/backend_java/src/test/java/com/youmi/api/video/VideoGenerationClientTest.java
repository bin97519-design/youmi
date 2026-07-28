package com.youmi.api.video;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.youmi.api.common.ApiException;
import com.youmi.api.image.ImageGenerationProperties;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class VideoGenerationClientTest {
  private final ObjectMapper objectMapper = new ObjectMapper();
  private HttpServer server;

  @AfterEach
  void stopServer() {
    if (server != null) {
      server.stop(0);
    }
  }

  @Test
  void createsGetTokenVeoFastImageToVideoTask() throws Exception {
    AtomicReference<String> method = new AtomicReference<>();
    AtomicReference<String> authorization = new AtomicReference<>();
    AtomicReference<JsonNode> requestBody = new AtomicReference<>();
    startServer("/veo3.1-fast/image-to-video", exchange -> {
      method.set(exchange.getRequestMethod());
      authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
      requestBody.set(objectMapper.readTree(exchange.getRequestBody()));
      respond(exchange, 200, """
          {"taskId":"video-123","status":"RUNNING","results":null}
          """);
    });

    VideoGenerationClient client = client();
    VideoGenerationDtos.CreateTaskRequest request = new VideoGenerationDtos.CreateTaskRequest(
        "让参考图中的产品自然旋转展示",
        "ignored-model",
        "9:16",
        8,
        "1080P",
        List.of("https://example.com/product.png"),
        "https://example.com/webhook",
        "client-video-1");

    VideoGenerationDtos.CreateTaskResponse response = client.createTask(request);

    assertEquals("POST", method.get());
    assertEquals("Bearer test-gettoken-key", authorization.get());
    assertEquals("让参考图中的产品自然旋转展示", requestBody.get().path("prompt").asText());
    assertEquals("9:16", requestBody.get().path("aspectRatio").asText());
    assertEquals("8", requestBody.get().path("duration").asText());
    assertEquals("1080p", requestBody.get().path("resolution").asText());
    assertEquals("https://example.com/product.png", requestBody.get().path("imageUrls").get(0).asText());
    assertEquals("client-video-1", requestBody.get().path("clientTaskId").asText());
    assertEquals("gettoken", response.getProvider());
    assertEquals("veo31-fast-image2video", response.getModel());
    assertEquals("gettoken-video:video-123", response.getTaskId());
    assertEquals("processing", response.getStatus());
  }

  @Test
  void pollsGetTokenQueryAndReturnsVideoUrl() throws Exception {
    AtomicReference<String> method = new AtomicReference<>();
    AtomicReference<JsonNode> requestBody = new AtomicReference<>();
    startServer("/query", exchange -> {
      method.set(exchange.getRequestMethod());
      requestBody.set(objectMapper.readTree(exchange.getRequestBody()));
      respond(exchange, 200, """
          {
            "taskId":"video-123",
            "status":"SUCCESS",
            "errorCode":"",
            "errorMessage":"",
            "results":[
              {"url":"https://cdn.example.com/result.mp4","outputType":"mp4","text":null}
            ]
          }
          """);
    });

    VideoGenerationDtos.TaskStatusResponse response =
        client().getTask("gettoken-video:video-123");

    assertEquals("POST", method.get());
    assertEquals("video-123", requestBody.get().path("taskId").asText());
    assertEquals("gettoken", response.getProvider());
    assertEquals("completed", response.getStatus());
    assertEquals(100, response.getProgress());
    assertEquals(List.of("https://cdn.example.com/result.mp4"), response.getVideoUrls());
  }

  @Test
  void treatsSuccessfulImageOutputAsFailedVideoTask() throws Exception {
    startServer("/query", exchange -> respond(exchange, 200, """
        {
          "taskId":"video-image-result",
          "status":"SUCCESS",
          "results":[
            {"url":"https://cdn.example.com/not-a-video.png","outputType":"png"}
          ]
        }
        """));

    VideoGenerationDtos.TaskStatusResponse response =
        client().getTask("gettoken-video:video-image-result");

    assertEquals("failed", response.getStatus());
    assertEquals(100, response.getProgress());
    assertTrue(response.getVideoUrls().isEmpty());
    assertTrue(response.getError().contains("outputType=png"));
  }

  @Test
  void requiresExactlyOneReferenceImage() {
    VideoGenerationDtos.CreateTaskRequest request = new VideoGenerationDtos.CreateTaskRequest(
        "生成一个自然的产品运镜视频", null, "16:9", 8, "720p", List.of(), null, null);

    ApiException error = assertThrows(ApiException.class, () -> client().createTask(request));

    assertTrue(error.getMessage().contains("exactly one image URL"));
  }

  @Test
  void rejectsUnsupportedVideoParameters() {
    VideoGenerationDtos.CreateTaskRequest request = new VideoGenerationDtos.CreateTaskRequest(
        "生成一个自然的产品运镜视频",
        null,
        "4:3",
        5,
        "2K",
        List.of("https://example.com/product.png"),
        null,
        null);

    ApiException error = assertThrows(ApiException.class, () -> client().createTask(request));

    assertTrue(error.getMessage().contains("ratio must be"));
  }

  private VideoGenerationClient client() {
    ImageGenerationProperties properties = new ImageGenerationProperties();
    properties.setGetTokenApiKey("test-gettoken-key");
    if (server != null) {
      properties.setGetTokenBaseUrl("http://127.0.0.1:" + server.getAddress().getPort());
    }
    properties.setGetTokenQueryPath("/query");
    properties.setTimeoutSeconds(5);
    return new VideoGenerationClient(objectMapper, properties);
  }

  private void startServer(String path, ExchangeHandler handler) throws Exception {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext(path, exchange -> {
      try {
        handler.handle(exchange);
      } catch (Exception error) {
        respond(exchange, 500, "{\"error\":\"" + error.getClass().getSimpleName() + "\"}");
      }
    });
    server.start();
  }

  private void respond(HttpExchange exchange, int status, String body) throws IOException {
    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().set("Content-Type", "application/json;charset=UTF-8");
    exchange.sendResponseHeaders(status, bytes.length);
    exchange.getResponseBody().write(bytes);
    exchange.close();
  }

  @FunctionalInterface
  private interface ExchangeHandler {
    void handle(HttpExchange exchange) throws Exception;
  }
}
