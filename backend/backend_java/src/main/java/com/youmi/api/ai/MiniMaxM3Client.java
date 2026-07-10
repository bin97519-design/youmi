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
public class MiniMaxM3Client {
  private static final Logger log = LoggerFactory.getLogger(MiniMaxM3Client.class);
  private final ObjectMapper objectMapper;
  private final MiniMaxProperties properties;
  private final HttpClient httpClient;

  public MiniMaxM3Client(ObjectMapper objectMapper, MiniMaxProperties properties) {
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

  public AiChatDtos.CompletionResult completeVision(
      String system,
      String prompt,
      List<String> imageUrls,
      Double temperature,
      Integer maxTokens) throws Exception {
    if (!properties.isConfigured()) {
      throw new IllegalStateException("MiniMax api key is not configured");
    }

    List<Map<String, Object>> content = new ArrayList<>();
    content.add(Map.of("type", "text", "text", prompt == null ? "" : prompt));
    for (String imageUrl : cleanImageUrls(imageUrls)) {
      content.add(imageContentBlock(imageUrl));
    }

    Map<String, Object> message = new LinkedHashMap<>();
    message.put("role", "user");
    message.put("content", content);

    Map<String, Object> body = new LinkedHashMap<>();
    body.put("model", properties.getModel());
    body.put("max_tokens", Math.max(200, maxTokens == null ? properties.getMaxTokens() : maxTokens));
    body.put("temperature", temperature == null ? properties.getTemperature() : temperature);
    if (system != null && !system.isBlank()) {
      body.put("system", system);
    }
    body.put("messages", List.of(message));

    String text = sendMessages(body);
    return new AiChatDtos.CompletionResult("minimax-anthropic", properties.getModel(), text);
  }

  public AiChatDtos.OptimizeProductInfoResponse optimizeProductInfo(
      String productInfo,
      List<String> productImages) throws Exception {
    if (!properties.isConfigured()) {
      throw new IllegalStateException("MiniMax api key is not configured");
    }

    List<String> images = cleanImageUrls(productImages).stream().limit(6).toList();
    if (images.isEmpty()) {
      throw new IllegalArgumentException("请先上传至少一张产品图片");
    }

    List<Map<String, Object>> content = new ArrayList<>();
    content.add(Map.of(
        "type", "text",
        "text", buildOptimizePrompt(productInfo, images.size())));
    for (String imageUrl : images) {
      content.add(Map.of(
          "type", "image",
          "source", Map.of(
              "type", "url",
              "url", imageUrl)));
    }

    Map<String, Object> message = new LinkedHashMap<>();
    message.put("role", "user");
    message.put("content", content);

    Map<String, Object> body = new LinkedHashMap<>();
    body.put("model", properties.getModel());
    body.put("max_tokens", Math.max(200, properties.getMaxTokens()));
    body.put("temperature", properties.getTemperature());
    body.put("system", "你是资深电商商品信息分析师和高转化详情页策划，擅长根据商品图片提取可用于详情页生成的完整产品参数、卖点、人群和场景。只输出可直接放入产品信息输入框的中文 Markdown。");
    body.put("messages", List.of(message));

    String optimized = sendMessages(body);
    if (optimized.isBlank()) {
      throw new IllegalStateException("MiniMax returned empty content");
    }
    return new AiChatDtos.OptimizeProductInfoResponse("minimax-anthropic", properties.getModel(), optimized);
  }

  private String sendMessages(Map<String, Object> body) throws Exception {
    String endpoint = properties.normalizedBaseUrl() + properties.normalizedMessagesPath();
    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(endpoint))
        .timeout(Duration.ofSeconds(Math.max(8, properties.getTimeoutSeconds())))
        .header("Authorization", "Bearer " + properties.getApiKey())
        .header("x-api-key", properties.getApiKey())
        .header("anthropic-version", "2023-06-01")
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
        .build();

    HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    log.info("MiniMax response status: {}", response.statusCode());
    if (response.statusCode() >= 300) {
      log.error("MiniMax error body: {}", compact(response.body()));
    } else {
      log.debug("MiniMax response body: {}", compact(response.body()));
    }
    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      throw new IllegalStateException(
          "MiniMax request failed: " + response.statusCode() + " " + compact(response.body()));
    }

    JsonNode root = objectMapper.readTree(response.body());
    String optimized = readTextContent(root);
    if (optimized.isBlank()) {
      throw new IllegalStateException("MiniMax returned empty content");
    }
    return optimized;
  }

  private List<String> cleanImageUrls(List<String> imageUrls) {
    if (imageUrls == null) return List.of();
    return imageUrls.stream()
        .filter(url -> url != null && !url.isBlank())
        .map(String::trim)
        .distinct()
        .toList();
  }

  private Map<String, Object> imageContentBlock(String imageUrl) {
    if (imageUrl != null && imageUrl.startsWith("data:")) {
      int commaIndex = imageUrl.indexOf(',');
      String header = commaIndex > 0 ? imageUrl.substring(0, commaIndex) : "";
      String data = commaIndex > 0 ? imageUrl.substring(commaIndex + 1) : imageUrl;
      String mediaType = "image/jpeg";
      int colonIndex = header.indexOf(':');
      int semicolonIndex = header.indexOf(';');
      if (colonIndex >= 0 && semicolonIndex > colonIndex) {
        mediaType = header.substring(colonIndex + 1, semicolonIndex);
      }
      return Map.of(
          "type", "image",
          "source", Map.of(
              "type", "base64",
              "media_type", mediaType,
              "data", data));
    }
    return Map.of(
        "type", "image",
        "source", Map.of(
            "type", "url",
            "url", imageUrl));
  }

  public List<ImageElement> detectImageElements(String imageUrl) throws Exception {
    String system = """
        你是一个专业的图像元素检测专家。请精确分析用户上传的图片，识别图中所有主要可见元素，包括：人物、物体、家具、产品、背景物品、文字内容（标题、标语、品牌名等）。

        检测要求：
        1. 只检测画面中轮廓清晰、辨识度高的主要元素
        2. 边界框必须精确：上边缘对齐元素最上端，下边缘对齐元素最下端，左边缘对齐元素最左端，右边缘对齐元素最右端
        3. 不要把多个元素框在一起，每个元素单独一个框
        4. 不要给整个图片或大面积背景画框

        坐标计算规则（非常重要）：
        - 图片左上角坐标是 [0.0, 0.0, ?, ?]，右下角是 [?, ?, 1.0, 1.0]
        - 输出格式 box_2d = [top, left, bottom, right]
        - top: 元素最上端距离图片顶部的比例（0~1）
        - left: 元素最左端距离图片左侧的比例（0~1）
        - bottom: 元素最下端距离图片顶部的比例（必须 > top）
        - right: 元素最右端距离图片左侧的比例（必须 > left）
        - 例如一个位于图片中央的人，可能在 [0.3, 0.2, 0.8, 0.7]
        - 估算时先看元素在图片中约占几成高度和宽度，再确定位置

        只输出 JSON 数组格式，不要输出任何其他文字。格式示例：
        [
          {"object_name": "女士 (Woman)", "box_2d": [0.352, 0.248, 0.783, 0.921]},
          {"object_name": "标题文字 (Title Text)", "box_2d": [0.120, 0.150, 0.220, 0.850]},
          {"object_name": "品牌标识 (Brand Logo)", "box_2d": [0.548, 0.302, 0.652, 0.585]}
        ]
        """;;

    String prompt = """
        请仔细检测这张图片中的所有主要元素。

        关键要求：
        1. 先观察每个元素在图片中的具体位置（约占图片的几分之几）
        2. 估算每个元素的 top/left/bottom/right 坐标值（0~1之间的比例）
        3. 确保坐标精确：上边缘就是元素最上方，不要留空白
        4. 框的大小要与元素实际大小一致
        5. 只框主要元素，不要框整个背景

        返回标准JSON数组格式。
        """;
    AiChatDtos.CompletionResult result = completeVision(system, prompt, List.of(imageUrl), 0.2, 4000);

    String text = result.content();
    // 提取 JSON 数组
    String json = extractJsonArray(text);
    if (json == null || json.isBlank()) {
      return List.of();
    }

    JsonNode array = objectMapper.readTree(json);
    List<ImageElement> elements = new ArrayList<>();
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
          elements.add(new ImageElement(name, coords));
        }
      }
    }
    return elements;
  }

  private boolean isValidBox(List<Double> coords) {
    double top = coords.get(0);
    double left = coords.get(1);
    double bottom = coords.get(2);
    double right = coords.get(3);
    // 必须在 0-1 范围内（允许极小的浮点误差）
    if (top < -0.01 || left < -0.01 || bottom < -0.01 || right < -0.01) return false;
    if (top > 1.01 || left > 1.01 || bottom > 1.01 || right > 1.01) return false;
    // 裁剪到 0-1
    top = Math.max(0, Math.min(1, top));
    left = Math.max(0, Math.min(1, left));
    bottom = Math.max(0, Math.min(1, bottom));
    right = Math.max(0, Math.min(1, right));
    // 必须形成有效的矩形
    if (bottom <= top + 0.001 || right <= left + 0.001) return false;
    double width = right - left;
    double height = bottom - top;
    double area = width * height;
    // 面积不能太小（0.05%）也不能太大（99%）
    if (area < 0.0005 || area > 0.99) return false;
    // 宽高比：文字可能很细长
    double ratio = width / Math.max(height, 0.0001);
    if (ratio > 50 || ratio < 0.02) return false;
    return true;
  }

  public record ImageElement(String objectName, List<Double> box2d) {}

  private String extractJsonArray(String text) {
    if (text == null || text.isBlank()) return null;
    int start = text.indexOf('[');
    int end = text.lastIndexOf(']');
    if (start >= 0 && end > start) {
      return text.substring(start, end + 1);
    }
    return null;
  }

  private String buildOptimizePrompt(String productInfo, int imageCount) {
    String extra = productInfo == null || productInfo.isBlank()
        ? "用户没有填写补充信息，请完全基于产品图片识别。"
        : "用户已填写的原始信息如下，请结合图片优化，不要编造图片中无法确认的信息：\n" + productInfo.trim();
    return """
        请根据后续 %d 张产品图片，提取并优化电商详情页生成用的“产品信息”。

        输出要求：
        1. 用中文 Markdown 输出，内容完整，适合直接作为详情页生成提示词。
        2. 必须包含以下 Markdown 二级标题，标题名不要省略：产品名称、产品品类、产品材质、收纳容量、产品尺寸、产品重量、产品工艺、核心卖点（高转化 6 大）、人群画像、产品使用场景和用途。
        3. 核心卖点必须给 6 条，使用有序列表，高转化表达，围绕用户利益、痛点解决、使用便利、质感、安全/稳定、场景价值展开。
        4. 如果图片无法确认某个参数，不要编造具体数值，请写“图片未明确，可结合实际参数补充”，但字段必须保留。
        5. 语气要具体、可执行，便于后续 AI 生成详情页画面和文案。
        6. 不要输出 Markdown 表格，不要解释分析过程，不要出现“根据图片可见”等过程描述。

        输出格式：
        ## 产品名称
        ...
        ## 产品品类
        ...
        ## 产品材质
        ...
        ## 收纳容量
        ...
        ## 产品尺寸
        ...
        ## 产品重量
        ...
        ## 产品工艺
        ...
        ## 核心卖点（高转化 6 大）
        1.
        2.
        3.
        4.
        5.
        6.
        ## 人群画像
        ...
        ## 产品使用场景和用途
        ...

        %s
        """.formatted(imageCount, extra);
  }

  private String readTextContent(JsonNode root) {
    JsonNode content = root.path("content");
    if (content.isArray()) {
      StringBuilder builder = new StringBuilder();
      for (JsonNode block : content) {
        if ("text".equals(block.path("type").asText())) {
          String text = block.path("text").asText("");
          if (!text.isBlank()) {
            if (!builder.isEmpty()) builder.append("\n");
            builder.append(text.trim());
          }
        }
      }
      return builder.toString().trim();
    }
    return root.path("content").asText("").trim();
  }

  private String compact(String body) {
    if (body == null || body.isBlank()) return "";
    String compacted = body.replaceAll("\\s+", " ").trim();
    return compacted.length() > 400 ? compacted.substring(0, 400) + "..." : compacted;
  }
}
