package com.youmi.api.image;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class ImageGenerationClientLk888Test {

  private final ObjectMapper objectMapper = new ObjectMapper();

  @Test
  void getTokenCreateFailureFallsBackToLk888Banana2() throws Exception {
    AtomicReference<String> lk888Body = new AtomicReference<>("");
    HttpServer server = server(exchange -> {
      if (exchange.getRequestURI().getPath().startsWith("/gettoken/")) {
        send(exchange, 500, "{\"error\":\"gettoken unavailable\"}");
        return;
      }
      if (exchange.getRequestURI().getPath().equals("/v1/media/generate")) {
        lk888Body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
        send(exchange, 200, "{\"task_id\":\"lk-create\",\"state\":\"pending\"}");
        return;
      }
      send(exchange, 404, "{\"error\":\"not found\"}");
    });

    try {
      ImageGenerationClient client = new ImageGenerationClient(
          objectMapper, properties(server, true, false));
      ImageGenerationDtos.CreateTaskResponse response = client.createTask(
          request("banana2", "9:16", "2K", "https://example.com/reference.png"));

      assertEquals("lk888", response.provider());
      assertEquals("gemini-3.1-flash-image-preview", response.model());
      assertEquals("lk888:lk-create", response.tasks().get(0).taskId());

      JsonNode body = objectMapper.readTree(lk888Body.get());
      assertEquals("gemini-3.1-flash-image-preview", body.path("model").asText());
      assertEquals("9:16", body.path("params").path("aspectRatio").asText());
      assertEquals("2K", body.path("params").path("imageSize").asText());
      assertEquals("minimal", body.path("params").path("thinkingLevel").asText());
      assertEquals(
          "https://example.com/reference.png",
          body.path("params").path("images").get(0).asText());
    } finally {
      server.stop(0);
    }
  }

  @Test
  void getTokenPollFailureSwitchesTransparentlyToLk888() throws Exception {
    HttpServer server = server(exchange -> {
      String path = exchange.getRequestURI().getPath();
      if (path.startsWith("/gettoken/") && path.endsWith("/query")) {
        send(exchange, 500, "{\"error\":\"poll unavailable\"}");
        return;
      }
      if (path.startsWith("/gettoken/")) {
        send(exchange, 200, "{\"taskId\":\"gettoken-primary\",\"status\":\"submitted\"}");
        return;
      }
      if (path.equals("/v1/media/generate")) {
        send(exchange, 200, "{\"task_id\":\"lk-backup\",\"state\":\"pending\"}");
        return;
      }
      if (path.equals("/v1/media/status")) {
        send(exchange, 200, """
            {
              "task_id":"lk-backup",
              "state":"success",
              "is_final":true,
              "progress":"100%",
              "result_url":"https://cdn.example.com/final.png",
              "error":""
            }
            """);
        return;
      }
      send(exchange, 404, "{\"error\":\"not found\"}");
    });

    try {
      ImageGenerationClient client = new ImageGenerationClient(
          objectMapper, properties(server, true, false));
      ImageGenerationDtos.CreateTaskRequest request = request("banana2", "1:1", "1K", null);
      ImageGenerationDtos.CreateTaskResponse created =
          client.createTask(request);
      ageFailoverState(client, created.tasks().get(0).taskId(), request, "gettoken");
      ImageGenerationDtos.TaskStatusResponse status =
          client.getTask(created.tasks().get(0).taskId());

      assertEquals("gettoken:gettoken-primary", status.taskId());
      assertEquals("lk888", status.provider());
      assertEquals("persisting", status.status());
      assertEquals(100, status.progress());
      assertEquals("PENDING", status.persistStatus());
      assertEquals("https://cdn.example.com/final.png", status.imageUrls().get(0));
    } finally {
      server.stop(0);
    }
  }

  @SuppressWarnings("unchecked")
  private void ageFailoverState(
      ImageGenerationClient client,
      String taskId,
      ImageGenerationDtos.CreateTaskRequest request,
      String provider) throws Exception {
    Class<?> stateClass = Class.forName(
        "com.youmi.api.image.ImageGenerationClient$FailoverState");
    Constructor<?> constructor = stateClass.getDeclaredConstructor(
        long.class, ImageGenerationDtos.CreateTaskRequest.class, String.class);
    constructor.setAccessible(true);
    Object state = constructor.newInstance(
        System.currentTimeMillis() - 181_000L, request, provider);

    Field statesField = ImageGenerationClient.class.getDeclaredField("failoverStates");
    statesField.setAccessible(true);
    ((Map<String, Object>) statesField.get(client)).put(taskId, state);
  }

  @Test
  void apimartGptFailureDowngradesToLk888Banana2() throws Exception {
    AtomicReference<String> lk888Body = new AtomicReference<>("");
    HttpServer server = server(exchange -> {
      String path = exchange.getRequestURI().getPath();
      if (path.equals("/apimart/v1/images/generations")) {
        send(exchange, 500, "{\"error\":\"apimart unavailable\"}");
        return;
      }
      if (path.equals("/v1/media/generate")) {
        lk888Body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
        send(exchange, 200, "{\"task_id\":\"lk-gpt-fallback\",\"state\":\"pending\"}");
        return;
      }
      send(exchange, 404, "{\"error\":\"not found\"}");
    });

    try {
      ImageGenerationProperties properties = properties(server, false, true);
      ImageGenerationClient client = new ImageGenerationClient(objectMapper, properties);
      ImageGenerationDtos.CreateTaskResponse response =
          client.createTask(request("gpt-image-2", "3:4", "4K", null));

      assertEquals("lk888", response.provider());
      assertEquals("gemini-3.1-flash-image-preview", response.model());
      JsonNode body = objectMapper.readTree(lk888Body.get());
      assertEquals("3:4", body.path("params").path("aspectRatio").asText());
      assertEquals("4K", body.path("params").path("imageSize").asText());
      assertFalse(body.path("params").path("thinkingLevel").asText().isBlank());
    } finally {
      server.stop(0);
    }
  }

  @Test
  void bananaProUsesProModelWithoutFlashThinkingParameter() throws Exception {
    AtomicReference<String> lk888Body = new AtomicReference<>("");
    HttpServer server = server(exchange -> {
      if (exchange.getRequestURI().getPath().equals("/v1/media/generate")) {
        lk888Body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
        send(exchange, 200, "{\"task_id\":\"lk-pro\",\"state\":\"pending\"}");
        return;
      }
      send(exchange, 404, "{\"error\":\"not found\"}");
    });

    try {
      ImageGenerationClient client = new ImageGenerationClient(
          objectMapper, properties(server, false, false));
      ImageGenerationDtos.CreateTaskResponse response =
          client.createTask(request("banana-pro", "16:9", "4K", null));

      assertEquals("gemini-3-pro-image-preview", response.model());
      JsonNode params = objectMapper.readTree(lk888Body.get()).path("params");
      assertTrue(params.path("thinkingLevel").isMissingNode());
    } finally {
      server.stop(0);
    }
  }

  private ImageGenerationProperties properties(
      HttpServer server, boolean getTokenConfigured, boolean apimartConfigured) {
    String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    ImageGenerationProperties properties = new ImageGenerationProperties();
    properties.setPersistGeneratedImages(false);
    properties.setTimeoutSeconds(5);
    properties.setProxyApiKey("");
    properties.setGetTokenApiKey(getTokenConfigured ? "gettoken-key" : "");
    properties.setGetTokenBaseUrl(baseUrl + "/gettoken");
    properties.setGetTokenQueryPath("/query");
    properties.setLk888ApiKey("lk888-key");
    properties.setLk888BaseUrl(baseUrl);
    properties.setLk888GenerationPath("/v1/media/generate");
    properties.setLk888TaskPath("/v1/media/status");
    properties.setApimartDirectApiKey(apimartConfigured ? "apimart-key" : "");
    properties.setApimartDirectBaseUrl(baseUrl + "/apimart");
    properties.setApimartDirectGenerationPath("/v1/images/generations");
    return properties;
  }

  private ImageGenerationDtos.CreateTaskRequest request(
      String model, String ratio, String resolution, String imageUrl) {
    return new ImageGenerationDtos.CreateTaskRequest(
        "生成一张电商图片",
        model,
        ratio,
        ratio,
        resolution,
        null,
        null,
        null,
        imageUrl == null ? null : java.util.List.of(imageUrl),
        null,
        null,
        null,
        null,
        null,
        null,
        null);
  }

  private HttpServer server(ExchangeHandler handler) throws IOException {
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/", exchange -> handler.handle(exchange));
    server.start();
    return server;
  }

  private void send(HttpExchange exchange, int status, String body) throws IOException {
    byte[] payload = body.getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
    exchange.sendResponseHeaders(status, payload.length);
    exchange.getResponseBody().write(payload);
    exchange.close();
  }

  @FunctionalInterface
  private interface ExchangeHandler {
    void handle(HttpExchange exchange) throws IOException;
  }
}
