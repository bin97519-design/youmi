package com.youmi.api.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class DashScopeClient {
  private static final Logger log = LoggerFactory.getLogger(DashScopeClient.class);
  private final ObjectMapper objectMapper;
  private final DashScopeProperties properties;
  private final HttpClient httpClient;

  public DashScopeClient(ObjectMapper objectMapper, DashScopeProperties properties) {
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
    String system = """
        你是一个专业的图像元素检测专家。请精确分析用户上传的图片，识别图中所有主要可见元素和所有文字内容。

        检测要求：
        1. 检测画面中所有轮廓清晰、辨识度高的实体元素（人物、物体、家具、产品等）
        2. 特别重要：检测图片中所有可见的文字内容，包括：
           - 大标题文字、副标题文字
           - 正文说明文字
           - 标签文字（如"高品质原料""简约设计"等）
           - 按钮文字
           - 品牌名、LOGO文字
           - 装饰性文字
           - 英文文字
           - 无论文字大小，只要能看清就必须框出
        3. 每个文字区域作为一个整体框出，不要把多行文字拆开
        4. 边界框必须精确：上边缘对齐元素/文字最上端，下边缘对齐最下端，左边缘对齐最左端，右边缘对齐最右端
        5. 不要把多个不同元素框在一起，每个元素单独一个框
        6. 不要给整个图片或大面积背景画框

        坐标计算规则（非常重要）：
        - 图片左上角坐标是 [0.0, 0.0, ?, ?]，右下角是 [?, ?, 1.0, 1.0]
        - 输出格式 box_2d = [top, left, bottom, right]
        - top: 元素最上端距离图片顶部的比例（0~1）
        - left: 元素最左端距离图片左侧的比例（0~1）
        - bottom: 元素最下端距离图片顶部的比例（必须 > top）
        - right: 元素最右端距离图片左侧的比例（必须 > left）
        - 估算时先看元素在图片中约占几成高度和宽度，再确定位置

        只输出 JSON 数组格式，不要输出任何其他文字。格式示例：
        [
          {"object_name": "女士 (Woman)", "box_2d": [0.352, 0.248, 0.783, 0.921]},
          {"object_name": "标题文字 (Title Text)", "box_2d": [0.120, 0.150, 0.220, 0.850]},
          {"object_name": "品质标签文字 (Quality Label)", "box_2d": [0.548, 0.302, 0.585, 0.652]},
          {"object_name": "英文副标题 (English Subtitle)", "box_2d": [0.250, 0.200, 0.290, 0.700]},
          {"object_name": "品牌标识 (Brand Logo)", "box_2d": [0.048, 0.302, 0.085, 0.452]}
        ]
        """;

    String prompt = """
        请仔细检测这张图片中的所有元素和文字。

        关键要求：
        1. 检测所有实体元素（人物、物体、家具、产品等）
        2. 重点检测所有文字内容，无论大小，只要清晰可见就必须框出：
           - 所有标题文字
           - 所有说明文字
           - 所有标签文字
           - 所有英文文字
           - 所有装饰性文字
        3. 估算每个元素的 top/left/bottom/right 坐标值（0~1之间的比例）
        4. 确保坐标精确，框的大小要与元素实际大小一致
        5. 不要框整个背景

        返回标准JSON数组格式。
        """;

    List<Map<String, Object>> content = new ArrayList<>();
    content.add(Map.of("type", "text", "text", prompt));
    content.add(Map.of("type", "image_url", "image_url", Map.of("url", imageUrl)));

    Map<String, Object> userMessage = new LinkedHashMap<>();
    userMessage.put("role", "user");
    userMessage.put("content", content);

    Map<String, Object> systemMessage = new LinkedHashMap<>();
    systemMessage.put("role", "system");
    systemMessage.put("content", system);

    Map<String, Object> body = new LinkedHashMap<>();
    body.put("model", properties.getModel());
    body.put("max_tokens", Math.max(200, properties.getMaxTokens()));
    body.put("temperature", properties.getTemperature());
    body.put("messages", List.of(systemMessage, userMessage));

    String text = sendChat(body);

    // 提取 JSON 数组
    String json = extractJsonArray(text);
    if (json == null || json.isBlank()) {
      return List.of();
    }

    JsonNode array = objectMapper.readTree(json);
    List<MiniMaxM3Client.ImageElement> elements = new ArrayList<>();
    if (array.isArray()) {
      for (JsonNode node : array) {
        String name = node.path("object_name").asText("");
        JsonNode box = node.path("box_2d");
        List<Double> coords = new ArrayList<>();
        if (box.isArray()) {
          for (JsonNode b : box) {
            coords.add(b.asDouble(0.0));
          }
        }
        if (!name.isEmpty() && coords.size() == 4 && isValidBox(coords)) {
          elements.add(new MiniMaxM3Client.ImageElement(name, coords));
        }
      }
    }
    return elements;
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

    HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
    log.info("DashScope response status: {}", response.statusCode());
    if (response.statusCode() >= 300) {
      log.error("DashScope error body: {}", compact(response.body()));
    } else {
      log.debug("DashScope response body: {}", compact(response.body()));
    }
    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      throw new IllegalStateException(
          "DashScope request failed: " + response.statusCode() + " " + compact(response.body()));
    }

    JsonNode root = objectMapper.readTree(response.body());
    String content = readContent(root);
    if (content.isBlank()) {
      throw new IllegalStateException("DashScope returned empty content");
    }
    return content;
  }

  private String readContent(JsonNode root) {
    JsonNode choices = root.path("choices");
    if (choices.isArray() && choices.size() > 0) {
      JsonNode message = choices.get(0).path("message");
      if (!message.isMissingNode()) {
        return message.path("content").asText("").trim();
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

  private boolean isValidBox(List<Double> coords) {
    double top = coords.get(0);
    double left = coords.get(1);
    double bottom = coords.get(2);
    double right = coords.get(3);
    if (top < -0.01 || left < -0.01 || bottom < -0.01 || right < -0.01) return false;
    if (top > 1.01 || left > 1.01 || bottom > 1.01 || right > 1.01) return false;
    top = Math.max(0, Math.min(1, top));
    left = Math.max(0, Math.min(1, left));
    bottom = Math.max(0, Math.min(1, bottom));
    right = Math.max(0, Math.min(1, right));
    if (bottom <= top + 0.0005 || right <= left + 0.0005) return false;
    double width = right - left;
    double height = bottom - top;
    double area = width * height;
    // 面积下限放宽：文字可能很小（0.005%），上限仍保持 99%
    if (area < 0.00005 || area > 0.99) return false;
    // 宽高比大幅放宽：文字可能是很长的单行（100:1）或很短的竖排（1:100）
    double ratio = width / Math.max(height, 0.0001);
    if (ratio > 100 || ratio < 0.01) return false;
    return true;
  }

  private String compact(String body) {
    if (body == null || body.isBlank()) return "";
    String compacted = body.replaceAll("\\s+", " ").trim();
    return compacted.length() > 400 ? compacted.substring(0, 400) + "..." : compacted;
  }
}
