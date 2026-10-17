package com.youmi.api.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.image.ModelApiKeyService;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class AgentChatClientTest {
  @Test void configuredModelStreamsSseDeltasAndSendsStreamFlag() throws Exception {
    var mapper = new ObjectMapper();
    List<JsonNode> bodies = new ArrayList<>();
    List<String> acceptHeaders = new ArrayList<>();
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/v1/chat/completions", exchange -> {
      bodies.add(mapper.readTree(exchange.getRequestBody()));
      acceptHeaders.add(exchange.getRequestHeaders().getFirst("Accept"));
      exchange.getResponseHeaders().set("Content-Type", "text/event-stream");
      exchange.sendResponseHeaders(200, 0);
      String first = "data: " + mapper.writeValueAsString(java.util.Map.of(
          "choices", List.of(java.util.Map.of("delta", java.util.Map.of(
              "content", "{\"reply\":\"你"))))) + "\n\n";
      String second = "data: " + mapper.writeValueAsString(java.util.Map.of(
          "choices", List.of(java.util.Map.of("delta", java.util.Map.of(
              "content", "好\"}"))))) + "\n\n";
      exchange.getResponseBody().write(first.getBytes(StandardCharsets.UTF_8));
      exchange.getResponseBody().flush();
      exchange.getResponseBody().write(second.getBytes(StandardCharsets.UTF_8));
      exchange.getResponseBody().write("data: [DONE]\n\n".getBytes(StandardCharsets.UTF_8));
      exchange.close();
    });
    server.start();
    try {
      var properties = new AgentChatProperties();
      properties.setTimeoutSeconds(10);
      var client = new AgentChatClient(mapper, properties);
      var credential = new ModelApiKeyService.ResolvedModelApiKey(
          9, "database-agent", "database-router",
          "http://127.0.0.1:" + server.getAddress().getPort() + "/v1",
          "/chat/completions", "", "local-test-only", java.util.Map.of());
      List<String> deltas = new ArrayList<>();

      var result = client.completeConfiguredModelStream(
          credential, "system", "Hello", List.of(), 0.2,
          "canvas-agent", "dropdown", null, deltas::add);

      assertTrue(bodies.get(0).path("stream").asBoolean());
      assertEquals("text/event-stream", acceptHeaders.get(0));
      assertEquals(List.of("{\"reply\":\"你", "好\"}"), deltas);
      assertEquals("{\"reply\":\"你好\"}", result.content());
    } finally {
      server.stop(0);
    }
  }

  @Test void configuredModelForwardsDefaultDataToItsConfiguredEndpoint() throws Exception {
    var mapper = new ObjectMapper();
    List<JsonNode> bodies = new ArrayList<>();
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/v1/chat/completions", exchange -> {
      bodies.add(mapper.readTree(exchange.getRequestBody()));
      byte[] response = "{\"choices\":[{\"message\":{\"content\":\"ok\"}}]}"
          .getBytes(StandardCharsets.UTF_8);
      exchange.getResponseHeaders().set("Content-Type", "application/json");
      exchange.sendResponseHeaders(200, response.length);
      exchange.getResponseBody().write(response);
      exchange.close();
    });
    server.start();
    try {
      var properties = new AgentChatProperties();
      properties.setTimeoutSeconds(10);
      properties.setMaxTokens(1111);
      var client = new AgentChatClient(mapper, properties);
      var credential = new ModelApiKeyService.ResolvedModelApiKey(
          9,
          "gpt-5.6-luna",
          "teamorouter",
          "http://127.0.0.1:" + server.getAddress().getPort() + "/v1",
          "/chat/completions",
          "",
          "local-test-only",
          java.util.Map.of("service_tier", "fast"));

      var result = client.completeConfiguredModel(credential, "system", "Hello", List.of(), null);

      assertEquals("ok", result.content());
      assertEquals("gpt-5.6-luna", bodies.get(0).path("model").asText());
      assertEquals("fast", bodies.get(0).path("service_tier").asText());
      assertEquals(1111, bodies.get(0).path("max_tokens").asInt());
      client.completeConfiguredModel(credential, "system", "video frames", List.of(), 0.2,
          "canvas-agent", "dropdown", 8000);
      client.completeConfiguredModel(credential, "system", "regular chat", List.of(), 0.2);
      assertEquals(8000, bodies.get(1).path("max_tokens").asInt());
      assertEquals(1111, bodies.get(2).path("max_tokens").asInt());
      client.completeConfiguredModel(credential, "system", "storyboard", List.of(), 0.35,
          "product-video-planning", "dropdown", 5500, Duration.ofSeconds(300));
      assertEquals(5500, bodies.get(3).path("max_tokens").asInt());
    } finally {
      server.stop(0);
    }
  }

  @Test void configuredPlanningTimeoutDoesNotChangeRegularAgentTimeout() throws Exception {
    var properties = new AgentChatProperties();
    properties.setTimeoutSeconds(90);
    var client = new AgentChatClient(new ObjectMapper(), properties);
    var http = mock(HttpClient.class);
    @SuppressWarnings("unchecked")
    HttpResponse<String> response = mock(HttpResponse.class);
    when(response.statusCode()).thenReturn(200);
    when(response.body()).thenReturn("{\"choices\":[{\"message\":{\"content\":\"ok\"}}]}");
    when(http.send(any(HttpRequest.class), org.mockito.ArgumentMatchers.<HttpResponse.BodyHandler<String>>any()))
        .thenReturn(response);
    ReflectionTestUtils.setField(client, "httpClient", http);
    var credential = new ModelApiKeyService.ResolvedModelApiKey(
        9, "gemini-3.8-flash", "test-provider", "http://127.0.0.1/v1",
        "/chat/completions", "", "local-test-only", java.util.Map.of());

    client.completeConfiguredModel(credential, "system", "storyboard", List.of(), 0.35,
        "product-video-planning", "dropdown", 4400, Duration.ofSeconds(300));
    client.completeConfiguredModel(credential, "system", "regular chat", List.of(), 0.2);
    client.completeConfiguredModel(credential, "system", "video frames", List.of(), 0.2,
        "canvas-agent", "dropdown", 8000);

    var requests = ArgumentCaptor.forClass(HttpRequest.class);
    verify(http, times(3)).send(requests.capture(), org.mockito.ArgumentMatchers.<HttpResponse.BodyHandler<String>>any());
    assertEquals(Duration.ofSeconds(300), requests.getAllValues().get(0).timeout().orElseThrow());
    assertEquals(Duration.ofSeconds(90), requests.getAllValues().get(1).timeout().orElseThrow());
    assertEquals(Duration.ofSeconds(90), requests.getAllValues().get(2).timeout().orElseThrow());
    assertEquals(90, properties.getTimeoutSeconds());
  }

  @Test void fixedVisionModelDoesNotChangeRegularAgentConfiguration() throws Exception {
    var mapper = new ObjectMapper();
    List<JsonNode> bodies = new ArrayList<>();
    List<String> authorizations = new ArrayList<>();
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/v1/chat/completions", exchange -> {
      bodies.add(mapper.readTree(exchange.getRequestBody()));
      authorizations.add(exchange.getRequestHeaders().getFirst("Authorization"));
      byte[] response = "{\"choices\":[{\"message\":{\"content\":\"ok\"}}]}".getBytes(StandardCharsets.UTF_8);
      exchange.getResponseHeaders().set("Content-Type", "application/json");
      exchange.sendResponseHeaders(200, response.length);
      exchange.getResponseBody().write(response);
      exchange.close();
    });
    server.start();
    try {
      var properties = new AgentChatProperties();
      properties.setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/v1");
      properties.setApiKey("local-test-only");
      properties.setModel("another-agent-model");
      var client = new AgentChatClient(mapper, properties);
      var detection = client.completeVisionForModel("gpt-5.6-luna", "system", "locate elements",
          List.of("data:image/png;base64,dGVzdA=="), 0.2);
      var vision = client.completeVision("system", "question", List.of("https://assets.example/product.png"), 0.2);
      var chat = client.complete(List.of(new AiChatDtos.Message("user", "hello")), 0.2);
      assertEquals(List.of("gpt-5.6-luna", "another-agent-model", "another-agent-model"),
          bodies.stream().map(body -> body.path("model").asText()).toList());
      assertEquals("gpt-5.6-luna", detection.model());
      assertEquals("another-agent-model", vision.model());
      assertEquals("another-agent-model", chat.model());
      assertEquals("another-agent-model", properties.getModel());
      assertEquals(List.of("Bearer local-test-only", "Bearer local-test-only", "Bearer local-test-only"), authorizations);
      assertEquals("data:image/png;base64,dGVzdA==", bodies.get(0).path("messages").get(1)
          .path("content").get(1).path("image_url").path("url").asText());
    } finally { server.stop(0); }
  }

  @Test void storyboardTokenBudgetDoesNotChangeRegularAgentRequests() throws Exception {
    var mapper = new ObjectMapper();
    List<JsonNode> bodies = new ArrayList<>();
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/v1/chat/completions", exchange -> {
      bodies.add(mapper.readTree(exchange.getRequestBody()));
      byte[] response = "{\"choices\":[{\"message\":{\"content\":\"ok\"}}]}".getBytes(StandardCharsets.UTF_8);
      exchange.getResponseHeaders().set("Content-Type", "application/json");
      exchange.sendResponseHeaders(200, response.length);
      exchange.getResponseBody().write(response);
      exchange.close();
    });
    server.start();
    try {
      var properties = new AgentChatProperties();
      properties.setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/v1");
      properties.setApiKey("local-test-only");
      properties.setMaxTokens(1111);
      properties.setTimeoutSeconds(90);
      var client = new AgentChatClient(mapper, properties);
      client.completeVision("system", "brief", List.of("https://assets.example/product.png"), 0.35, 12800, Duration.ofSeconds(180));
      client.completeVision("system", "brief", List.of(), 0.2);
      client.complete(List.of(new AiChatDtos.Message("user", "hello")), 0.2);
      assertEquals(12800, bodies.get(0).path("max_tokens").asInt());
      assertEquals(1111, bodies.get(1).path("max_tokens").asInt());
      assertEquals(1111, bodies.get(2).path("max_tokens").asInt());
      assertEquals(1111, properties.getMaxTokens());
      assertEquals(90, properties.getTimeoutSeconds());
      assertEquals("https://assets.example/product.png", bodies.get(0).path("messages").get(1)
          .path("content").get(1).path("image_url").path("url").asText());
    } finally { server.stop(0); }
  }

  @Test void requestTimeoutOverrideIsAppliedOnlyToThatCallWithoutRetry() throws Exception {
    var requests = new AtomicInteger();
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/v1/chat/completions", exchange -> {
      requests.incrementAndGet();
      exchange.getRequestBody().readAllBytes();
      try {
        Thread.sleep(1400);
        byte[] response = "{\"choices\":[{\"message\":{\"content\":\"ok\"}}]}".getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(200, response.length);
        exchange.getResponseBody().write(response);
      } catch (InterruptedException error) {
        Thread.currentThread().interrupt();
      } finally { exchange.close(); }
    });
    server.start();
    try {
      var properties = new AgentChatProperties();
      properties.setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/v1");
      properties.setApiKey("local-test-only");
      properties.setTimeoutSeconds(90);
      var client = new AgentChatClient(new ObjectMapper(), properties);
      assertThrows(HttpTimeoutException.class, () -> client.completeVision("system", "brief", List.of(),
          0.35, 4000, Duration.ofMillis(800)));
      assertEquals("ok", client.completeVision("system", "brief", List.of(), 0.2).content());
      assertEquals(2, requests.get());
      assertEquals(90, properties.getTimeoutSeconds());
    } finally { server.stop(0); }
  }
}
