package com.youmi.api.ecommerce;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.ai.XfyunVisionClient;
import com.youmi.api.common.ApiException;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * 电商套图 AI 策划服务。
 * 调用讯飞视觉模型生成结构化策划方案。
 */
@Service
public class EcommercePlanningService {
  private static final Logger log = LoggerFactory.getLogger(EcommercePlanningService.class);

  private final ObjectMapper objectMapper;
  private final XfyunVisionClient xfyunVisionClient;
  private final EcommerceSetProperties ecommerceSetProperties;

  public EcommercePlanningService(
      ObjectMapper objectMapper,
      XfyunVisionClient xfyunVisionClient,
      EcommerceSetProperties ecommerceSetProperties) {
    this.objectMapper = objectMapper;
    this.xfyunVisionClient = xfyunVisionClient;
    this.ecommerceSetProperties = ecommerceSetProperties;
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
    if (!xfyunVisionClient.isConfigured()) {
      log.warn("[planning] Xfyun vision is not configured, using local ecommerce planning");
      return buildFallbackPlanning(productDescription);
    }

    try {
      EcommerceSetDtos.PlanningData planning = generateAiPlanning(productImageUrl, productDescription);
      log.info("[planning] Xfyun vision analysis succeeded, model={}", xfyunVisionClient.model());
      return planning;
    } catch (Exception e) {
      log.warn("[planning] Xfyun vision analysis failed, using local ecommerce planning: {}", e.getMessage());
      return buildFallbackPlanning(productDescription);
    }
  }

  private EcommerceSetDtos.PlanningData generateAiPlanning(
      String productImageUrl,
      String productDescription) throws Exception {

    String systemPrompt = ecommerceSetProperties.getPlanningSystemPrompt();
    StringBuilder textBuilder = new StringBuilder();
    if (productDescription != null && !productDescription.isBlank()) {
      textBuilder.append("请先仔细识别产品图片中的产品外观、颜色、材质、结构、配件和可见文字，再结合以下产品描述生成策划。\n")
          .append("产品描述：").append(productDescription.trim());
    } else {
      textBuilder.append("请仔细识别产品图片中的产品外观、颜色、材质、结构、配件和可见文字，并据此生成策划方案。");
    }

    String responseText = xfyunVisionClient.analyzeImage(
        systemPrompt, textBuilder.toString(), productImageUrl);
    log.info("[planning] Xfyun raw response (first 800 chars): {}",
        responseText.length() > 800 ? responseText.substring(0, 800) + "..." : responseText);

    // 提取纯 JSON（去除 markdown 代码块包裹）
    String json = extractJsonObject(responseText);
    if (json == null || json.isBlank()) {
      throw new ApiException(502, "AI 返回的内容无法解析为 JSON: " + compact(responseText));
    }

    // 解析为 PlanningData
    return parsePlanningData(json);
  }

  private EcommerceSetDtos.PlanningData buildFallbackPlanning(String productDescription) {
    String description = productDescription == null ? "" : productDescription.trim();
    String productName = description.isBlank() ? "电商商品" : description.split("[，。,.;；\n]", 2)[0].trim();
    if (productName.length() > 24) {
      productName = productName.substring(0, 24);
    }

    List<EcommerceSetDtos.SellingPoint> sellingPoints = List.of(
        new EcommerceSetDtos.SellingPoint(
            "核心卖点", "产品核心价值", "突出产品主体和最重要的用户价值", "主体居中，高对比展示"),
        new EcommerceSetDtos.SellingPoint(
            "材质工艺", "材质与细节", "用近景展示材质、边缘和工艺细节", "局部特写，真实质感"),
        new EcommerceSetDtos.SellingPoint(
            "使用场景", "场景化展示", "结合目标用户的日常使用场景展示效果", "自然光场景，保持产品清晰"),
        new EcommerceSetDtos.SellingPoint(
            "品质保障", "专业品质", "传达可靠、专业和易于信任的品牌感", "简洁版式，克制文字信息"));

    return new EcommerceSetDtos.PlanningData(
        productName,
        "电商商品",
        "",
        "",
        sellingPoints,
        "注重品质、功能和购买效率的电商用户",
        List.of("商品主图", "详情页展示", "社交电商推广"));
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
