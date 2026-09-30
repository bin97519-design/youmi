package com.youmi.api.ai;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import com.youmi.api.common.ApiException;
import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Random;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

class GemAgentImagePreparerTest {
  private final ObjectMapper mapper = new ObjectMapper();
  private static final int MB = 1024 * 1024;

  private GemAgentImagePreparer preparer() {
    String ffmpeg = System.getenv("YOUMI_FFMPEG"), ffprobe = System.getenv("YOUMI_FFPROBE");
    Assumptions.assumeTrue(ffmpeg != null && ffprobe != null);
    return new GemAgentImagePreparer(mapper, ffmpeg, ffprobe);
  }

  @Test void smallReferencesRemainByteForByteWithoutNeedingMediaTools() throws Exception {
    var source = new GemAgentImagePreparer.ImageData("image/webp", new byte[] {1, 2, 3});
    var preparer = new GemAgentImagePreparer(mapper, "not-installed", "not-installed");
    assertSame(source, preparer.prepare(source, 100));
  }

  @Test void downloadedImagesAllowTwentyMegabytesButStillBoundUnknownLengthStreams() throws Exception {
    byte[] original = new byte[20 * MB];
    original[original.length - 1] = 42;
    assertArrayEquals(original, GemAgentClient.readImageBytes(new ByteArrayInputStream(original)));
    assertTrue(assertThrows(ApiException.class,
        () -> GemAgentClient.readImageBytes(new ByteArrayInputStream(new byte[20 * MB + 1])))
        .getMessage().contains("20MB"));
    assertTrue(assertThrows(ApiException.class,
        () -> GemAgentClient.readImageBytes(new ByteArrayInputStream(new byte[0])))
        .getMessage().contains("为空"));
  }

  @Test void largePngBecomesAFullFrameAnalysisCopyWithoutChangingTheOriginal() throws Exception {
    byte[] original = noisePng(1800, 1700, 7);
    assertTrue(original.length > 8 * MB);
    byte[] snapshot = original.clone();
    var result = preparer().prepare(new GemAgentImagePreparer.ImageData("image/png", original), 1536 * 1024);
    assertEquals("image/jpeg", result.mimeType());
    assertTrue(result.bytes().length <= 1536 * 1024);
    var decoded = ImageIO.read(new ByteArrayInputStream(result.bytes()));
    assertEquals(1800.0 / 1700, (double) decoded.getWidth() / decoded.getHeight(), .002);
    assertArrayEquals(snapshot, original);
  }

  @Test void transparentImagesUseWhiteInsteadOfTurningBlackAndAreNotUpscaled() throws Exception {
    var image = new BufferedImage(120, 240, BufferedImage.TYPE_INT_ARGB);
    var graphics = image.createGraphics();
    graphics.setColor(Color.RED);
    graphics.fillRect(40, 80, 40, 80);
    graphics.dispose();
    var bytes = new ByteArrayOutputStream();
    ImageIO.write(image, "png", bytes);
    byte[] padded = Arrays.copyOf(bytes.toByteArray(), 100_000);
    var result = preparer().prepare(new GemAgentImagePreparer.ImageData("image/png", padded), 16_000);
    var decoded = ImageIO.read(new ByteArrayInputStream(result.bytes()));
    assertEquals(120, decoded.getWidth());
    assertEquals(240, decoded.getHeight());
    var corner = new Color(decoded.getRGB(5, 5));
    assertTrue(corner.getRed() > 245 && corner.getGreen() > 245 && corner.getBlue() > 245);
    assertTrue(new Color(decoded.getRGB(60, 120)).getRed() > 200);
  }

  @Test void missingToolsAndInvalidImagesFailBeforeGeneration() throws Exception {
    var source = new GemAgentImagePreparer.ImageData("image/png", new byte[500]);
    var missing = new GemAgentImagePreparer(mapper, "not-installed", "not-installed");
    assertTrue(assertThrows(ApiException.class, () -> missing.prepare(source, 100)).getMessage().contains("组件不可用"));
    assertTrue(assertThrows(ApiException.class, () -> preparer().prepare(source, 100)).getMessage().contains("无法解码"));
  }

  @Test void clientAcceptsTwentyMegabytesAndBoundsEightImageRequests() throws Exception {
    var preparer = preparer();
    List<com.fasterxml.jackson.databind.JsonNode> requests = new ArrayList<>();
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/", exchange -> {
      requests.add(mapper.readTree(exchange.getRequestBody()));
      byte[] response = "{\"candidates\":[{\"finishReason\":\"STOP\",\"content\":{\"parts\":[{\"text\":\"ok\"}]}}]}".getBytes(StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(200, response.length);
      exchange.getResponseBody().write(response);
      exchange.close();
    });
    server.start();
    try {
      var properties = new GemAgentProperties();
      properties.setApiKey("isolated-test-key");
      properties.setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort());
      var client = new GemAgentClient(mapper, properties, preparer);
      byte[] png = noisePng(1800, 1700, 13);
      assertTrue(png.length > 8 * MB);
      assertEquals("ok", client.complete("", "large reference", List.of(dataUrl(png)), .2, false).content());
      assertEquals("image/jpeg", requests.get(0).at("/contents/0/parts/1/inlineData/mimeType").asText());
      assertEquals("ok", client.complete("", "20MB boundary", List.of(dataUrl(Arrays.copyOf(png, 20 * MB))), .2, false).content());
      int submitted = requests.size();
      var tooLarge = assertThrows(ApiException.class, () -> client.complete("", "over limit",
          List.of(dataUrl(new byte[20 * MB + 1])), .2, false));
      assertTrue(tooLarge.getMessage().contains("20MB"));
      assertEquals(submitted, requests.size());

      List<String> images = new ArrayList<>();
      for (int i = 0; i < 8; i++) images.add(dataUrl(noisePng(1100, 900, i)));
      assertEquals("ok", client.complete("", "eight references", images, .2, false).content());
      var parts = requests.get(requests.size() - 1).at("/contents/0/parts");
      assertEquals(9, parts.size());
      int total = 0;
      for (int i = 1; i < parts.size(); i++) {
        byte[] bytes = Base64.getDecoder().decode(parts.get(i).at("/inlineData/data").asText());
        total += bytes.length;
        assertTrue(bytes.length <= 8 * MB);
        var decoded = ImageIO.read(new ByteArrayInputStream(bytes));
        assertEquals(1100.0 / 900, (double) decoded.getWidth() / decoded.getHeight(), .002);
      }
      assertTrue(total <= 12 * MB);
      assertEquals(3, requests.size());
      assertTrue(assertThrows(ApiException.class, () -> client.complete("", "nine",
          java.util.stream.IntStream.range(0, 9).mapToObj(i -> "https://example.com/" + i + ".png").toList(), .2, false))
          .getMessage().contains("8 张"));
      assertEquals(3, requests.size());
    } finally { server.stop(0); }
  }

  private static String dataUrl(byte[] bytes) {
    return "data:image/png;base64," + Base64.getEncoder().encodeToString(bytes);
  }

  private static byte[] noisePng(int width, int height, int seed) throws Exception {
    var image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
    var random = new Random(seed);
    int[] row = new int[width];
    for (int y = 0; y < height; y++) {
      for (int x = 0; x < width; x++) row[x] = random.nextInt(0x1000000);
      image.setRGB(0, y, width, 1, row, 0, width);
    }
    try (var bytes = new ByteArrayOutputStream()) {
      ImageIO.write(image, "png", bytes);
      return bytes.toByteArray();
    } finally { image.flush(); }
  }
}
