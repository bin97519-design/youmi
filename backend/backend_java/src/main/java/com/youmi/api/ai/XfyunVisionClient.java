package com.youmi.api.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class XfyunVisionClient {
  private static final Logger log = LoggerFactory.getLogger(XfyunVisionClient.class);
  private final ObjectMapper objectMapper;
  private final XfyunVisionProperties properties;
  private final HttpClient httpClient;

  public XfyunVisionClient(ObjectMapper objectMapper, XfyunVisionProperties properties) {
    this.objectMapper = objectMapper;
    this.properties = properties;
    this.httpClient = HttpClient.newBuilder()
        .version(HttpClient.Version.HTTP_1_1)
        .connectTimeout(Duration.ofSeconds(Math.max(3, properties.getTimeoutSeconds())))
        .build();
  }

  public boolean isConfigured() {
    return properties.isConfigured();
  }

  public String model() {
    return properties.getModel();
  }

  public List<MiniMaxM3Client.ImageElement> detectImageElements(String imageUrl) throws Exception {
    if (!properties.isConfigured()) {
      throw new IllegalStateException("Xfyun vision api key is not configured");
    }

    String system = """
        You are a professional image element detection expert.
        Detect the main visible elements in the image, including people, products, furniture,
        important objects, background objects, and visible text.
        Only detect clear, meaningful elements. Ignore tiny noise and pure blank background.
        Each bounding box must tightly fit the visible edge of the element.
        Output only a JSON array. Do not output markdown or explanations.
        Each item must be:
        {"object_name":"Simplified Chinese object name","box_2d":[top,left,bottom,right]}
        The object_name must be concise Simplified Chinese, such as "床", "台灯", "窗帘", "枕头", "地毯".
        Do not output English names unless the object is an English logo or English text in the image.
        Coordinates must be normalized floating point numbers from 0.0 to 1.0.
        top and bottom are relative to image height. left and right are relative to image width.
        bottom must be greater than top, and right must be greater than left.
        """;

    String prompt = """
        Analyze this image and return the main detectable elements.
        Include visible text lines when they are important and readable.
        Return strict JSON array only, for example:
        [
          {"object_name":"女士","box_2d":[0.352,0.248,0.783,0.921]},
          {"object_name":"沙发","box_2d":[0.548,0.302,0.952,0.985]}
        ]
        """;

    List<Map<String, Object>> content = new ArrayList<>();
    content.add(Map.of("type", "text", "text", prompt));
    content.add(Map.of("type", "image_url", "image_url", Map.of("url", imageUrl)));

    Map<String, Object> systemMessage = new LinkedHashMap<>();
    systemMessage.put("role", "system");
    systemMessage.put("content", system);

    Map<String, Object> userMessage = new LinkedHashMap<>();
    userMessage.put("role", "user");
    userMessage.put("content", content);

    Map<String, Object> body = new LinkedHashMap<>();
    body.put("model", properties.getModel());
    body.put("max_tokens", Math.max(200, properties.getMaxTokens()));
    body.put("temperature", properties.getTemperature());
    body.put("stream", false);
    body.put("messages", List.of(systemMessage, userMessage));

    String text = sendChat(body);
    log.info("[detect] Xfyun raw response (first 500 chars): {}",
        text.length() > 500 ? text.substring(0, 500) + "..." : text);

    String json = extractJsonArray(text);
    if (json == null || json.isBlank()) {
      return List.of();
    }

    JsonNode array = objectMapper.readTree(json);
    List<MiniMaxM3Client.ImageElement> elements = new ArrayList<>();
    if (!array.isArray()) {
      return elements;
    }

    for (JsonNode node : array) {
      String name = node.path("object_name").asText(
          node.path("name").asText(
              node.path("object").asText("")));
      JsonNode box = firstArray(node, List.of("box_2d", "box.2d", "bbox_2d", "box2d", "bbox"));
      List<Double> coords = readCoords(box);
      if (name.isBlank() || coords.size() != 4) continue;

      name = name.replaceAll("\\s*\\([^)]*\\)\\s*", "").trim();
      List<Double> fixed = topLeftBottomRightToLeftTopRightBottom(coords);
      if (isValidBox(fixed)) {
        elements.add(new MiniMaxM3Client.ImageElement(name, fixed));
      }
    }

    return dedupeNames(elements);
  }

  private String sendChat(Map<String, Object> body) throws Exception {
    String endpoint = properties.normalizedBaseUrl() + properties.normalizedChatPath();
    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(endpoint))
        .timeout(Duration.ofSeconds(Math.max(8, properties.getTimeoutSeconds())))
        .header("Authorization", "Bearer " + properties.getApiKey())
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
        .build();

    HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    log.info("Xfyun vision response status: {}", response.statusCode());
    if (response.statusCode() >= 300) {
      log.error("Xfyun vision error body: {}", compact(response.body()));
    } else {
      log.debug("Xfyun vision response body: {}", compact(response.body()));
    }
    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      throw new IllegalStateException(
          "Xfyun vision request failed: " + response.statusCode() + " " + compact(response.body()));
    }

    JsonNode root = objectMapper.readTree(response.body());
    String content = readContent(root);
    if (content.isBlank()) {
      throw new IllegalStateException("Xfyun vision returned empty content");
    }
    return content;
  }

  private String readContent(JsonNode root) {
    JsonNode choices = root.path("choices");
    if (choices.isArray() && choices.size() > 0) {
      JsonNode message = choices.get(0).path("message");
      if (!message.isMissingNode()) {
        String content = message.path("content").asText("");
        if (!content.isBlank()) return content.trim();
      }
    }
    return root.path("content").asText("").trim();
  }

  private String extractJsonArray(String text) {
    if (text == null || text.isBlank()) return null;
    int start = text.indexOf('[');
    int end = text.lastIndexOf(']');
    if (start >= 0 && end > start) {
      return text.substring(start, end + 1);
    }
    return null;
  }

  private JsonNode firstArray(JsonNode node, List<String> keys) {
    for (String key : keys) {
      JsonNode candidate = node.get(key);
      if (candidate != null && candidate.isArray()) return candidate;
    }
    return null;
  }

  private List<Double> readCoords(JsonNode box) {
    List<Double> coords = new ArrayList<>();
    if (box != null && box.isArray()) {
      for (JsonNode value : box) {
        coords.add(value.asDouble(0.0));
      }
    }
    return coords;
  }

  private List<Double> topLeftBottomRightToLeftTopRightBottom(List<Double> coords) {
    double top = normalizeCoord(coords.get(0));
    double left = normalizeCoord(coords.get(1));
    double bottom = normalizeCoord(coords.get(2));
    double right = normalizeCoord(coords.get(3));
    double x1 = Math.min(left, right);
    double y1 = Math.min(top, bottom);
    double x2 = Math.max(left, right);
    double y2 = Math.max(top, bottom);
    return List.of(round3(x1), round3(y1), round3(x2), round3(y2));
  }

  private double normalizeCoord(double value) {
    double normalized = Math.abs(value) > 1.05 ? value / 1000.0 : value;
    return clamp01(normalized);
  }

  private double clamp01(double value) {
    return Math.max(0.0, Math.min(1.0, value));
  }

  private double round3(double value) {
    return Math.round(value * 1000.0) / 1000.0;
  }

  private boolean isValidBox(List<Double> coords) {
    if (coords == null || coords.size() != 4) return false;
    double x1 = coords.get(0);
    double y1 = coords.get(1);
    double x2 = coords.get(2);
    double y2 = coords.get(3);
    if (x2 <= x1 + 0.0005 || y2 <= y1 + 0.0005) return false;
    double area = (x2 - x1) * (y2 - y1);
    if (area < 0.00005 || area > 0.99) return false;
    double ratio = (x2 - x1) / Math.max(y2 - y1, 0.0001);
    return ratio <= 100 && ratio >= 0.01;
  }

  private List<MiniMaxM3Client.ImageElement> dedupeNames(List<MiniMaxM3Client.ImageElement> elements) {
    Map<String, Integer> counts = new LinkedHashMap<>();
    for (MiniMaxM3Client.ImageElement element : elements) {
      counts.merge(element.objectName(), 1, Integer::sum);
    }

    Map<String, Integer> seq = new LinkedHashMap<>();
    List<MiniMaxM3Client.ImageElement> deduped = new ArrayList<>();
    for (MiniMaxM3Client.ImageElement element : elements) {
      String name = element.objectName();
      if (counts.getOrDefault(name, 0) > 1) {
        int next = seq.merge(name, 1, Integer::sum);
        deduped.add(new MiniMaxM3Client.ImageElement(name + next, element.box2d()));
      } else {
        deduped.add(element);
      }
    }
    return deduped;
  }

  private String compact(String body) {
    if (body == null || body.isBlank()) return "";
    String compacted = body.replaceAll("\\s+", " ").trim();
    return compacted.length() > 400 ? compacted.substring(0, 400) + "..." : compacted;
  }
}
