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

class ImageGenerationClientTtCustomSizeTest {
  private static final ObjectMapper MAPPER = new ObjectMapper();

  @Test
  void v3SendsNativePixelSizeWithoutRatioOrResolutionAndKeepsOtherSelections() throws Exception {
    try (Fixture fixture = new Fixture("tt-image-2.5")) {
      var response = fixture.client.createTask(request(Map.of(
          "custom_size", "1536x864", "size", "9:21", "resolution", "4K",
          "version", "sunburst", "quality", "max", "background", "transparent")), 7L);

      assertEquals(MAPPER.readTree("""
          {"size":"1536x864","version":"sunburst","quality":"max","background":"transparent"}
          """), fixture.body.get().path("params"));
      assertEquals("1536x864", response.size());
      assertEquals("4K", response.resolution());
      assertEquals("tt-image-2.5", fixture.body.get().path("model").asText());
      assertFalse(fixture.body.get().has("custom_size"));
      assertFalse(fixture.body.get().has("parameter_profile"));
      assertFalse(fixture.body.get().path("params").has("custom_size"));
    }
  }

  @Test
  void customSizeAcceptsAutoCanonicalNumbersAndInclusivePixelAndRatioBounds() throws Exception {
    Map<String, String> sizes = Map.of(
        "AUTO", "auto", "  auto  ", "auto", "01536X00864", "1536x864",
        "1280x512", "1280x512", "3840x2160", "3840x2160",
        "480x1440", "480x1440", "1440x480", "1440x480");
    try (Fixture fixture = new Fixture("GPT-image2.5")) {
      for (var size : sizes.entrySet()) {
        fixture.client.createTask(request(Map.of("custom_size", size.getKey())), 7L);
        JsonNode params = fixture.body.get().path("params");
        assertEquals(size.getValue(), params.path("size").asText());
        assertFalse(params.has("aspect_ratio"));
        assertFalse(params.has("resolution"));
      }
      assertEquals(sizes.size(), fixture.requests.get());
    }
  }

  @Test
  void explicitCustomSizeOverridesConflictingCredentialDefaults() throws Exception {
    try (Fixture fixture = new Fixture("tt-image-2.5", Map.of(
        "size", "1024x1024", "aspect_ratio", "1:1", "resolution", "1K",
        "version", "sunburst", "quality", "low", "background", "opaque"))) {
      fixture.client.createTask(request(Map.of("custom_size", "1536x864",
          "version", "flare", "quality", "high", "background", "auto")), 7L);
      assertEquals(MAPPER.readTree("""
          {"size":"1536x864","version":"flare","quality":"high","background":"auto"}
          """), fixture.body.get().path("params"));
    }
  }

  @Test
  void malformedOrOutOfRangeSizesFailBeforeAnyUpstreamPost() throws Exception {
    List<String> invalid = List.of(
        "1536:864", "1536×864", "1536 x 864", "1536.0x864", "-1536x864", "1536x+864",
        "0x864", "1536x0", "1535x864", "1536x865", "1280x496", "4096x2160",
        "3200x800", "800x3200", "1K", "999999999999999999999999x864",
        "9223372036854775807x9223372036854775807");
    try (Fixture fixture = new Fixture("tt-image-2.5")) {
      for (String size : invalid) {
        ApiException error = assertThrows(ApiException.class,
            () -> fixture.client.createTask(request(Map.of("custom_size", size)), 7L), size);
        assertEquals(400, error.getCode(), size);
        assertTrue(error.getMessage().contains("自定义尺寸"), size);
      }
      assertEquals(0, fixture.requests.get());
    }
  }

  @Test
  void absentAndBlankCustomSizeKeepTheNormalV3TtProtocol() throws Exception {
    try (Fixture fixture = new Fixture("tt-image-2.5")) {
      for (Map<String, Object> options : List.of(Map.<String, Object>of(), Map.<String, Object>of("custom_size", " "))) {
        fixture.client.createTask(request(options), 7L);
        assertEquals(MAPPER.readTree("""
            {"version":"flare","aspect_ratio":"16:9","resolution":"2K","quality":"high","background":"auto"}
            """), fixture.body.get().path("params"));
      }
    }
  }

  @Test
  void oldAndV2TtIgnoreEvenInvalidCustomSizeAndKeepLegacyDefaults() throws Exception {
    try (Fixture fixture = new Fixture("tt-image-2.5")) {
      for (String profile : List.of("", "canvas-v2-image")) {
        fixture.client.createTask(request(Map.of("parameter_profile", profile,
            "custom_size", "invalid", "quality", "max", "background", "transparent")), 7L);
        assertEquals(MAPPER.readTree("""
            {"version":"flare","aspect_ratio":"16:9","resolution":"2K","quality":"high","background":"auto"}
            """), fixture.body.get().path("params"));
      }
    }
  }

  @Test
  void otherV3ModelsIgnoreCustomSizeAndDoNotLeakTheNewField() throws Exception {
    for (String model : List.of("banana-2.1", "banana-pro", "custom-model")) {
      try (Fixture fixture = new Fixture(model)) {
        fixture.client.createTask(request(Map.of("custom_size", "invalid")), 7L);
        JsonNode params = fixture.body.get().path("params");
        assertEquals("16:9", params.path("aspectRatio").asText());
        assertEquals("2K", params.path("imageSize").asText());
        assertFalse(params.has("size"));
        assertFalse(params.has("custom_size"));
        assertFalse(fixture.body.get().has("custom_size"));
      }
    }
  }

  @Test
  void presetExpansionRetainsCustomSizeThroughRealClientDispatch() throws Exception {
    try (Fixture fixture = new Fixture("tt-image-2.5")) {
      fixture.client.createTask(request(Map.of("custom_size", "1536x864", "prompt", "@风格迁移 不要文字")), 7L);
      assertEquals("1536x864", fixture.body.get().path("params").path("size").asText());
      assertTrue(fixture.body.get().path("prompt").asText().startsWith("最高优先级硬约束"));
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
      this(model, Map.of());
    }

    Fixture(String model, Map<String, Object> defaultData) throws Exception {
      server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
      server.createContext("/v1/media/generate", exchange -> {
        body.set(MAPPER.readTree(exchange.getRequestBody()));
        requests.incrementAndGet();
        byte[] response = "{\"data\":{\"task_id\":\"tt-custom-size\"}}"
            .getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(200, response.length);
        exchange.getResponseBody().write(response);
        exchange.close();
      });
      server.start();
      ModelApiKeyService.ResolvedModelApiKey credential = new ModelApiKeyService.ResolvedModelApiKey(
          65L, model, "youmi888", "http://127.0.0.1:" + server.getAddress().getPort(),
          "/v1/media/generate", "/v1/media/status", "test-key", defaultData);
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
