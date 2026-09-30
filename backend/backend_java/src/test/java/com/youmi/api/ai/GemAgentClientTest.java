package com.youmi.api.ai;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import com.youmi.api.common.ApiException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class GemAgentClientTest {
  private final ObjectMapper mapper = new ObjectMapper();
  private static final String IMAGE = "data:image/png;base64,iVBORw0KGgo=";

  @Test void usesNativeGeminiBodyAndKeepsThoughtsOutOfReply() throws Exception {
    List<JsonNode> bodies = new ArrayList<>();
    List<String> keys = new ArrayList<>();
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/v1beta/models/gem-3.8-flash:generateContent", exchange -> {
      bodies.add(mapper.readTree(exchange.getRequestBody()));
      keys.add(exchange.getRequestHeaders().getFirst("x-goog-api-key"));
      byte[] response = """
          {"candidates":[{"finishReason":"STOP","content":{"role":"model","parts":[
          {"thought":true,"text":"private reasoning"},{"text":"hello "},{"text":"world"}]}}]}
          """.getBytes(StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(200, response.length);
      exchange.getResponseBody().write(response);
      exchange.close();
    });
    server.start();
    try {
      var client = client(server);
      var result = client.complete("system rules", "question and history", List.of(IMAGE), 0.2, true);
      client.complete("polish", "prompt", List.of(), 0.3, false);
      client.complete("plan", "long plan", List.of(), 0.3, true, 12800, Duration.ofSeconds(180));
      assertEquals("hello world", result.content());
      assertEquals("lk888", result.provider());
      assertEquals(GemAgentClient.MODEL, result.model());
      assertEquals(List.of("test-gem-key", "test-gem-key", "test-gem-key"), keys);
      JsonNode body = bodies.get(0);
      assertFalse(body.has("messages"));
      assertFalse(body.has("model"));
      assertFalse(body.has("stream"));
      assertEquals("system rules", body.at("/systemInstruction/parts/0/text").asText());
      assertEquals("user", body.at("/contents/0/role").asText());
      assertEquals("question and history", body.at("/contents/0/parts/0/text").asText());
      assertEquals("image/png", body.at("/contents/0/parts/1/inlineData/mimeType").asText());
      assertEquals("iVBORw0KGgo=", body.at("/contents/0/parts/1/inlineData/data").asText());
      assertEquals("application/json", body.at("/generationConfig/responseMimeType").asText());
      assertTrue(bodies.get(1).at("/generationConfig/responseMimeType").isMissingNode());
      assertEquals(8000, bodies.get(1).at("/generationConfig/maxOutputTokens").asInt());
      assertEquals(12800, bodies.get(2).at("/generationConfig/maxOutputTokens").asInt());
    } finally { server.stop(0); }
  }

  @Test void rejectsMissingKeyBeforeSendingAnyRequest() {
    var client = new GemAgentClient(mapper, new GemAgentProperties());
    assertFalse(client.isConfigured());
    assertTrue(assertThrows(ApiException.class,
        () -> client.complete("", "hello", List.of(), 0.2, false)).getMessage().contains("密钥"));
  }

  @Test void rejectsPrivateAndNonHttpImageSources() {
    for (String url : List.of("http://127.0.0.1/a.png", "http://192.168.1.2/a.png",
        "http://169.254.169.254/a.png", "http://[::1]/a.png", "file:///c:/secret.png")) {
      assertThrows(ApiException.class, () -> GemAgentClient.requirePublicImageUrl(URI.create(url)));
    }
  }

  @Test void rejectsMalformedInlineImagesWithoutSubmitting() {
    var properties = new GemAgentProperties();
    properties.setApiKey("test-gem-key");
    properties.setBaseUrl("http://127.0.0.1:1");
    var client = new GemAgentClient(mapper, properties);
    for (String image : List.of("data:image/png;base64,???", "data:text/html;base64,YQ==", "data:image/png;base64,")) {
      assertThrows(ApiException.class, () -> client.complete("", "question", List.of(image), 0.2, true));
    }
  }

  @Test void reportsUpstreamErrorsWithoutRetryingOrLeakingKey() throws Exception {
    var calls = new AtomicInteger();
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/", exchange -> {
      calls.incrementAndGet();
      exchange.getRequestBody().readAllBytes();
      byte[] response = "{\"error\":{\"message\":\"denied test-gem-key sk-private-secret\"}}".getBytes(StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(403, response.length);
      exchange.getResponseBody().write(response);
      exchange.close();
    });
    server.start();
    try {
      var error = assertThrows(ApiException.class, () -> client(server).complete("", "hello", List.of(), 0.2, true));
      assertTrue(error.getMessage().contains("403"));
      assertFalse(error.getMessage().contains("test-gem-key"));
      assertFalse(error.getMessage().contains("sk-private-secret"));
      assertEquals(1, calls.get());
    } finally { server.stop(0); }
  }

  @Test void rejectsTruncatedBlockedAndEmptyResponses() throws Exception {
    var responses = List.of(
        "{\"candidates\":[{\"finishReason\":\"MAX_TOKENS\",\"content\":{\"parts\":[{\"text\":\"partial\"}]}}]}",
        "{\"promptFeedback\":{\"blockReason\":\"SAFETY\"}}",
        "{\"candidates\":[{\"finishReason\":\"STOP\",\"content\":{\"parts\":[{\"thought\":true,\"text\":\"hidden\"}]}}]}",
        "not json");
    var calls = new AtomicInteger();
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/", exchange -> {
      exchange.getRequestBody().readAllBytes();
      byte[] response = responses.get(calls.getAndIncrement()).getBytes(StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(200, response.length);
      exchange.getResponseBody().write(response);
      exchange.close();
    });
    server.start();
    try {
      var client = client(server);
      for (int index = 0; index < responses.size(); index++) {
        var error = assertThrows(ApiException.class, () -> client.complete("", "hello", List.of(), 0.2, true));
        if (index == 0) {
          assertInstanceOf(GemAgentClient.OutputLimitException.class, error);
          assertFalse(error.getMessage().contains("partial"));
          assertFalse(error.getMessage().contains("缩小本次需求"));
        } else assertFalse(error instanceof GemAgentClient.OutputLimitException);
      }
      assertEquals(responses.size(), calls.get());
    } finally { server.stop(0); }
  }

  private GemAgentClient client(HttpServer server) {
    var properties = new GemAgentProperties();
    properties.setApiKey("test-gem-key");
    properties.setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/");
    return new GemAgentClient(mapper, properties);
  }
}
