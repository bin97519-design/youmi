package com.youmi.api.ecommerce;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.ai.DashScopeProperties;
import com.youmi.api.common.ApiException;
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

/**
 * 电商套图 AI 策划服务。
 * 调用 DashScope API（兼容 OpenAI 格式）生成结构化策划方案。
 */
@Service
public class EcommercePlanningService {
  private static final Logger log = LoggerFactory.getLogger(EcommercePlanningService.class);

  private final ObjectMapper objectMapper;
  private final DashScopeProperties dashScopeProperties;
  private final EcommerceSetProperties ecommerceSetProperties;
  private final HttpClient httpClient;

  public EcommercePlanningService(
      ObjectMapper objectMapper,
      DashScopeProperties dashScopeProperties,
      EcommerceSetProperties ecommerceSetProperties) {
    this.objectMapper = objectMapper;
    this.dashScopeProperties = dashScopeProperties;
    this.ecommerceSetProperties = ecommerceSetProperties;
    this.httpClient = HttpClient.newBuilder()
        .version(HttpClient.Version.HTTP_1_1)
        .connectTimeout(Duration.ofSeconds(Math.max(3, dashScopeProperties.getTimeoutSeconds())))
        .build();
  }

  /**
   * 根据产品图片和描述生成策划方案。
   *
   * @param productImageUrl   产品图片 URL（可为 null）
   * @param productDescription 产品描述（可为 null）
   * @return 结构化策划数据
   * @throws Exception 调用失败时抛出
   */
  public EcommerceSetDtos.PlanningData generatePlanning(
      String productImageUrl,
      String productDescription) throws Exception {
    if (!dashScopeProperties.isConfigured()) {
      throw new ApiException(400, "DashScope API key is not configured");
    }

    String systemPrompt = ecommerceSetProperties.getPlanningSystemPrompt();
    String model = ecommerceSetProperties.getPlanningModel();

    // 构造 user message
    List<Map<String, Object>> userContent = new ArrayList<>();

    // 如果有图片 URL，构造多模态消息
    if (productImageUrl != null && !productImageUrl.isBlank()) {
      Map<String, Object> imagePart = new LinkedHashMap<>();
      imagePart.put("type", "image_url");
      imagePart.put("image_url", Map.of("url", productImageUrl.trim()));
      userContent.add(imagePart);
    }

    // 文本部分
    StringBuilder textBuilder = new StringBuilder();
    if (productDescription != null && !productDescription.isBlank()) {
      textBuilder.append("产品描述：").append(productDescription.trim());
    } else {
      textBuilder.append("请根据产品图片生成策划方案。");
    }
    Map<String, Object> textPart = new LinkedHashMap<>();
    textPart.put("type", "text");
    textPart.put("text", textBuilder.toString());
    userContent.add(textPart);

    Map<String, Object> userMessage = new LinkedHashMap<>();
    userMessage.put("role", "user");
    userMessage.put("content", userContent);

    Map<String, Object> systemMessage = new LinkedHashMap<>();
    systemMessage.put("role", "system");
    systemMessage.put("content", systemPrompt);

    Map<String, Object> body = new LinkedHashMap<>();
    body.put("model", model);
    body.put("messages", List.of(systemMessage, userMessage));
    body.put("max_tokens", dashScopeProperties.getMaxTokens());
    body.put("temperature", dashScopeProperties.getTemperature());

    String responseText = sendChat(body);
    log.info("[planning] DashScope raw response (first 800 chars): {}",
        responseText.length() > 800 ? responseText.substring(0, 800) + "..." : responseText);

    // 提取纯 JSON（去除 markdown 代码块包裹）
    String json = extractJsonObject(responseText);
    if (json == null || json.isBlank()) {
      throw new ApiException(502, "AI 返回的内容无法解析为 JSON: " + compact(responseText));
    }

    // 解析为 PlanningData
    return parsePlanningData(json);
  }

  /**
   * 发送 chat 请求到 DashScope API。
   */
  private String sendChat(Map<String, Object> body) throws Exception {
    String endpoint = dashScopeProperties.normalizedBaseUrl() + dashScopeProperties.normalizedChatPath();
    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(endpoint))
        .timeout(Duration.ofSeconds(Math.max(8, dashScopeProperties.getTimeoutSeconds())))
        .header("Authorization", "Bearer " + dashScopeProperties.getApiKey())
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
        .build();

    HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
    log.info("[planning] DashScope response status: {}", response.statusCode());

    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      log.error("[planning] DashScope error body: {}", compact(response.body()));
      throw new ApiException(502, "DashScope request failed: " + response.statusCode() + " " + compact(response.body()));
    }

    JsonNode root = objectMapper.readTree(response.body());
    String content = readContent(root);
    if (content.isBlank()) {
      throw new ApiException(502, "DashScope returned empty content");
    }
    return content;
  }

  /**
   * 从 OpenAI 兼容格式的响应中提取 message content。
   */
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

  /**
   * 从 AI 返回的文本中提取 JSON 对象。
   * 支持纯 JSON 和 markdown 代码块包裹（```json ... ```）两种格式。
   */
  private String extractJsonObject(String text) {
    if (text == null || text.isBlank()) return null;

    // 尝试提取 markdown 代码块中的 JSON
    String stripped = text.trim();
    if (stripped.startsWith("```")) {
      // 去除开头的 ```json 或 ```
      int firstNewline = stripped.indexOf('\n');
      if (firstNewline >= 0) {
        stripped = stripped.substring(firstNewline + 1);
      }
      // 去除结尾的 ```
      if (stripped.endsWith("```")) {
        stripped = stripped.substring(0, stripped.length() - 3);
      }
      stripped = stripped.trim();
    }

    // 查找 JSON 对象的起止位置
    int start = stripped.indexOf('{');
    int end = stripped.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return stripped.substring(start, end + 1);
    }
    return null;
  }

  /**
   * 将 JSON 字符串解析为 PlanningData 对象。
   */
  private EcommerceSetDtos.PlanningData parsePlanningData(String json) throws Exception {
    JsonNode root = objectMapper.readTree(json);

    String productName = root.path("productName").asText("");
    String category = root.path("category").asText("");
    String material = root.path("material").asText("");
    String craftsmanship = root.path("craftsmanship").asText("");
    String audienceProfile = root.path("audienceProfile").asText("");

    List<String> usageScenarios = new ArrayList<>();
    JsonNode scenariosNode = root.path("usageScenarios");
    if (scenariosNode.isArray()) {
      for (JsonNode item : scenariosNode) {
        usageScenarios.add(item.asText(""));
      }
    }

    List<EcommerceSetDtos.SellingPoint> sellingPoints = new ArrayList<>();
    JsonNode spNode = root.path("sellingPoints");
    if (spNode.isArray()) {
      for (JsonNode item : spNode) {
        sellingPoints.add(new EcommerceSetDtos.SellingPoint(
            item.path("type").asText("core"),
            item.path("title").asText(""),
            item.path("description").asText(""),
            item.path("visualDirection").asText("")
        ));
      }
    }

    return new EcommerceSetDtos.PlanningData(
        productName, category, material, craftsmanship,
        sellingPoints, audienceProfile, usageScenarios);
  }

  private String compact(String body) {
    if (body == null || body.isBlank()) return "";
    String compacted = body.replaceAll("\\s+", " ").trim();
    return compacted.length() > 400 ? compacted.substring(0, 400) + "..." : compacted;
  }
}
