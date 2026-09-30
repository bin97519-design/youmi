package com.youmi.api.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class AgentChatClientTest {
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
