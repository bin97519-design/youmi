package com.youmi.api.ai;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import com.youmi.api.image.ModelApiKeyService.ResolvedModelApiKey;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class GeminiChatProtocolTest {
  @Test void originalVideoAndAudioAreSentThroughNativeTransportAndTruncatedRepliesAreRejected() throws Exception {
    var mapper = new ObjectMapper();
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    var requests = new java.util.concurrent.atomic.AtomicInteger();
    server.createContext("/v1beta/models/", exchange -> {
      int call = requests.incrementAndGet();
      var body = mapper.readTree(exchange.getRequestBody());
      var part = body.path("contents").path(0).path("parts").path(1);
      assertEquals("video/mp4", part.path("inlineData").path("mimeType").asText());
      assertEquals("AQIDBA==", part.path("inlineData").path("data").asText());
      assertEquals("30s", part.path("videoMetadata").path("startOffset").asText());
      assertEquals(5, part.path("videoMetadata").path("fps").asInt());
      assertEquals(16000, body.path("generationConfig").path("maxOutputTokens").asInt());
      assertEquals("application/json", body.path("generationConfig").path("responseMimeType").asText());
      byte[] bytes = ("{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"原片分析\"}]},\"finishReason\":\""
          + (call == 1 ? "STOP" : "MAX_TOKENS") + "\"}]}").getBytes(StandardCharsets.UTF_8);
      exchange.getResponseHeaders().set("Content-Type", "application/json");
      exchange.sendResponseHeaders(200, bytes.length); exchange.getResponseBody().write(bytes); exchange.close();
    });
    server.start();
    try {
      var key = new ResolvedModelApiKey(1L, "gem-3-pro", "test", "http://127.0.0.1:" + server.getAddress().getPort(),
          "/v1beta/models/gem-3-pro:generateContent", "", "test-key");
      var client = new AgentChatClient(mapper, new AgentChatProperties());
      Map<String,Object> video = Map.of("inlineData", Map.of("mimeType","video/mp4","data","AQIDBA=="),
          "videoMetadata",Map.of("startOffset","30s","endOffset","60s","fps",5));
      assertEquals("原片分析",client.completeConfiguredMedia(key,"rules","source",List.of(),.15,"product-video2-planning",
          "dropdown",16000,java.time.Duration.ofMinutes(30),video).content());
      var error = assertThrows(IllegalStateException.class, () -> client.completeConfiguredMedia(key,"rules","source",List.of(),.15,
          "product-video2-planning","dropdown",16000,java.time.Duration.ofMinutes(30),video));
      assertTrue(error.getMessage().contains("截断")); assertEquals(2,requests.get());
    } finally { server.stop(0); }
  }
  @Test void nativeRequestsAndStreamingResponsesWorkThroughConfiguredClient() throws Exception {
    var mapper = new ObjectMapper();
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    var paths = new ArrayList<String>();
    server.createContext("/v1beta/models/", exchange -> {
      paths.add(exchange.getRequestURI().toString());
      var body = mapper.readTree(exchange.getRequestBody());
      assertEquals("system", body.path("systemInstruction").path("parts").path(0).path("text").asText());
      assertEquals("image/png", body.path("contents").path(0).path("parts").path(1).path("fileData").path("mimeType").asText());
      assertEquals("https://example.com/a.png", body.path("contents").path(0).path("parts").path(1).path("fileData").path("fileUri").asText());
      assertEquals(4096, body.path("generationConfig").path("maxOutputTokens").asInt());
      assertFalse(body.has("messages"));
      assertEquals("Bearer test-key", exchange.getRequestHeaders().getFirst("Authorization"));
      boolean stream = exchange.getRequestURI().getPath().contains("streamGenerateContent");
      assertEquals(stream, body.path("stream").asBoolean(false));
      String payload = "{\"candidates\":[{\"content\":{\"parts\":[{\"thought\":true,\"text\":\"private\"},{\"text\":\"你好\"}]},\"finishReason\":\"STOP\"}]}";
      byte[] bytes = (stream ? "data: " + payload + "\n\n" : payload).getBytes(StandardCharsets.UTF_8);
      exchange.getResponseHeaders().set("Content-Type", stream ? "text/event-stream" : "application/json");
      exchange.sendResponseHeaders(200, bytes.length);
      exchange.getResponseBody().write(bytes);
      exchange.close();
    });
    server.start();
    try {
      var key = new ResolvedModelApiKey(1L, "gem-3-pro", "lk888", "http://127.0.0.1:" + server.getAddress().getPort(),
          "/v1beta/models/gem-3-pro:generateContent", "", "test-key");
      var client = new AgentChatClient(mapper, new AgentChatProperties());
      assertEquals("你好", client.completeConfiguredModel(key, "system", "hello", List.of("https://example.com/a.png"),
          0.2, "test", "test", 4096).content());
      var deltas = new ArrayList<String>();
      assertEquals("你好", client.completeConfiguredModelStream(key, "system", "hello", List.of("https://example.com/a.png"),
          0.2, "test", "test", 4096, deltas::add).content());
      assertEquals(List.of("你好"), deltas);
      assertTrue(paths.get(1).endsWith(":streamGenerateContent?alt=sse"));
    } finally { server.stop(0); }
  }

  @Test void inlineImagesAndNativeDefaultsArePreserved() {
    var key = new ResolvedModelApiKey(1L, "gem-3-pro", "lk888", "https://api.lk888.ai", "/v1/chat/completions", "", "test",
        Map.of("generationConfig", Map.of("responseMimeType", "application/json"), "tools", List.of(Map.of("googleSearch", Map.of()))));
    var body = GeminiChatProtocol.body(key, "rules", "prompt", List.of("data:image/png;base64,YQ=="), 0.2, 4096);
    String json = new ObjectMapper().valueToTree(body).toString();
    assertTrue(json.contains("inlineData"));
    assertTrue(json.contains("responseMimeType"));
    assertTrue(json.contains("googleSearch"));
    assertEquals("https://api.lk888.ai/v1beta/models/gem-3-pro:generateContent", GeminiChatProtocol.endpoint(key, false));
  }
}
