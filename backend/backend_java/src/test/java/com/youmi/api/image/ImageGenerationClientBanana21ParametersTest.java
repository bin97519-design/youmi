package com.youmi.api.image;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpServer;
import com.youmi.api.common.ApiException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class ImageGenerationClientBanana21ParametersTest {
  private static final ObjectMapper MAPPER = new ObjectMapper();

  @Test
  void v3SendsSelectedThinkingAndWebSearchUsingNativeBanana21Fields() throws Exception {
    try (Fixture fixture = new Fixture("banana-2.1")) {
      fixture.client.createTask(request(Map.of("thinking_level", "high", "web_search", false,
          "size", "1:8", "resolution", "4K")), 7L);

      assertEquals(MAPPER.readTree("""
          {"aspectRatio":"1:8","imageSize":"4K","thinkingLevel":"high","web_search":false}
          """), fixture.body.get().path("params"));
      assertEquals("banana-2.1", fixture.body.get().path("model").asText());
      assertTrue(fixture.body.get().path("parameter_profile").isMissingNode());
      assertTrue(fixture.body.get().path("thinking_level").isMissingNode());
    }
  }

  @Test
  void v3MissingBanana21OptionsKeepExistingMinimalAndSearchDefaults() throws Exception {
    try (Fixture fixture = new Fixture("banana-2.1")) {
      fixture.client.createTask(request(Map.of()), 7L);
      JsonNode params = fixture.body.get().path("params");
      assertEquals("minimal", params.path("thinkingLevel").asText());
      assertTrue(params.path("web_search").asBoolean());
    }
  }

  @Test
  void v3AcceptsEveryDocumentedBanana21RatioAndResolution() throws Exception {
    List<String> ratios = List.of("1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16",
        "16:9", "21:9", "1:4", "4:1", "1:8", "8:1");
    List<String> resolutions = List.of("1K", "2K", "4K");
    try (Fixture fixture = new Fixture("banana-2.1")) {
      for (int index = 0; index < ratios.size(); index++) {
        String ratio = ratios.get(index);
        String resolution = resolutions.get(index % resolutions.size());
        fixture.client.createTask(request(Map.of("size", ratio, "resolution", resolution)), 7L);
        assertEquals(ratio, fixture.body.get().path("params").path("aspectRatio").asText());
        assertEquals(resolution, fixture.body.get().path("params").path("imageSize").asText());
      }
      assertEquals(ratios.size(), fixture.requests.get());
    }
  }

  @Test
  void v3RejectsUnsupportedParametersBeforeAnyProviderRequest() throws Exception {
    List<Map<String, Object>> unsupported = List.of(
        Map.of("size", "auto"), Map.of("size", "1:2"), Map.of("size", "2:1"),
        Map.of("size", "9:21"), Map.of("size", "3:5"), Map.of("resolution", "8K"),
        Map.of("resolution", "auto"), Map.of("thinking_level", "medium"));
    try (Fixture fixture = new Fixture("banana-2.1")) {
      for (Map<String, Object> options : unsupported) {
        ApiException error = assertThrows(ApiException.class,
            () -> fixture.client.createTask(request(options), 7L));
        assertEquals(400, error.getCode());
      }
      assertEquals(0, fixture.requests.get());
    }
  }

  @Test
  void oldAndV2Banana21IgnoreNewSelectionsAndKeepPreviousUnvalidatedProtocol() throws Exception {
    try (Fixture fixture = new Fixture("banana-2.1")) {
      for (String profile : List.of("", "canvas-v2-image")) {
        fixture.client.createTask(request(Map.of("parameter_profile", profile,
            "size", "auto", "resolution", "legacy-size", "thinking_level", "not-supported",
            "web_search", false)), 7L);
        assertEquals(MAPPER.readTree("""
            {"aspectRatio":"auto","imageSize":"LEGACY-SIZE","thinkingLevel":"minimal","web_search":true}
            """), fixture.body.get().path("params"));
      }
    }
  }

  @Test
  void bananaProAndOtherModelsDoNotGainBanana21OrTtSelections() throws Exception {
    for (String model : List.of("banana-pro", "custom-model")) {
      try (Fixture fixture = new Fixture(model)) {
        fixture.client.createTask(request(Map.of("version", "sunburst", "quality", "max",
            "background", "transparent", "thinking_level", "not-supported", "web_search", false)), 7L);
        JsonNode params = fixture.body.get().path("params");
        assertTrue(params.path("version").isMissingNode());
        assertTrue(params.path("quality").isMissingNode());
        assertTrue(params.path("background").isMissingNode());
        assertEquals("16:9", params.path("aspectRatio").asText());
        assertEquals("2K", params.path("imageSize").asText());
        if (model.equals("banana-pro")) {
          assertEquals(1, params.path("n").asInt());
          assertTrue(params.path("thinkingLevel").isMissingNode());
          assertTrue(params.path("web_search").isMissingNode());
        } else {
          assertEquals("minimal", params.path("thinkingLevel").asText());
          assertTrue(params.path("web_search").asBoolean());
        }
      }
    }
  }

  @Test
  void selectedMinimalAndSearchTrueAlsoRemainExplicitBooleanValues() throws Exception {
    try (Fixture fixture = new Fixture("banana-2.1")) {
      fixture.client.createTask(request(Map.of("thinking_level", " MINIMAL ", "web_search", true)), 7L);
      assertEquals("minimal", fixture.body.get().path("params").path("thinkingLevel").asText());
      assertTrue(fixture.body.get().path("params").path("web_search").isBoolean());
      assertTrue(fixture.body.get().path("params").path("web_search").asBoolean());
      assertFalse(fixture.body.get().path("params").has("thinking_level"));
    }
  }

  @Test
  void bananaProUsesDocumentedRatiosAndNativeFieldsWithAtMostFourteenReferences() throws Exception {
    List<String> ratios = List.of("1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16",
        "16:9", "21:9");
    List<String> references = java.util.stream.IntStream.range(0, 16)
        .mapToObj(index -> "https://cdn.example.com/reference-" + index + ".png").toList();
    List<String> resolutions = List.of("1K", "2K", "4K");
    try (Fixture fixture = new Fixture("banana-pro")) {
      for (int index = 0; index < ratios.size(); index++) {
        String ratio = ratios.get(index);
        String resolution = resolutions.get(index % resolutions.size());
        fixture.client.createTask(request(Map.of("size", ratio, "resolution", resolution,
            "image_urls", references, "thinking_level", "high", "web_search", true,
            "quality", "max", "background", "transparent", "version", "sunburst")), 7L);
        JsonNode nativeBody = fixture.body.get();
        JsonNode params = nativeBody.path("params");
        assertEquals("banana-pro", nativeBody.path("model").asText());
        assertEquals(ratio, params.path("aspectRatio").asText());
        assertEquals(resolution, params.path("imageSize").asText());
        assertEquals(1, params.path("n").asInt());
        assertEquals(MAPPER.valueToTree(references.subList(0, 14)), params.path("images"));
        assertEquals(4, params.size());
        assertTrue(params.path("thinkingLevel").isMissingNode());
        assertTrue(params.path("web_search").isMissingNode());
        assertTrue(params.path("quality").isMissingNode());
        assertTrue(params.path("background").isMissingNode());
        assertTrue(params.path("version").isMissingNode());
      }
      assertEquals(ratios.size(), fixture.requests.get());
    }
  }

  private ImageGenerationDtos.CreateTaskRequest request(Map<String, Object> options) throws Exception {
    ObjectNode json = MAPPER.createObjectNode();
    json.put("prompt", "一张产品场景图");
    json.put("model", "model-api-key:65");
    json.put("size", "16:9");
    json.put("resolution", "2K");
    json.put("n", 1);
    json.put("feature_code", "canvas-image");
    json.put("parameter_profile", "canvas-v3-image");
    options.forEach((key, value) -> json.set(key, MAPPER.valueToTree(value)));
    return MAPPER.treeToValue(json, ImageGenerationDtos.CreateTaskRequest.class);
  }

  private static final class Fixture implements AutoCloseable {
    final HttpServer server;
    final AtomicReference<JsonNode> body = new AtomicReference<>();
    final AtomicInteger requests = new AtomicInteger();
    final ImageGenerationClient client;

    Fixture(String model) throws Exception {
      server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
      server.createContext("/v1/media/generate", exchange -> {
        body.set(MAPPER.readTree(exchange.getRequestBody()));
        requests.incrementAndGet();
        byte[] response = "{\"data\":{\"task_id\":\"banana21-params\"}}"
            .getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(200, response.length);
        exchange.getResponseBody().write(response);
        exchange.close();
      });
      server.start();
      ModelApiKeyService.ResolvedModelApiKey credential = new ModelApiKeyService.ResolvedModelApiKey(
          65L, model, "youmi888", "http://127.0.0.1:" + server.getAddress().getPort(),
          "/v1/media/generate", "/v1/media/status", "test-key");
      ModelApiKeyService keyService = mock(ModelApiKeyService.class);
      when(keyService.resolveFeatureRouteOption("model-api-key:65",
          ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION, "canvas-image"))
          .thenReturn(Optional.of(credential));
      ImageGenerationProperties properties = new ImageGenerationProperties();
      properties.setPersistGeneratedImages(false);
      client = new ImageGenerationClient(MAPPER, properties);
      client.setModelApiKeyService(keyService);
    }

    @Override
    public void close() {
      server.stop(0);
    }
  }
}
