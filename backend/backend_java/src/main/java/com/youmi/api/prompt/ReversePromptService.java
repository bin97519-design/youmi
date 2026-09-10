package com.youmi.api.prompt;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.ai.AiChatDtos;
import com.youmi.api.ai.DashScopeClient;
import com.youmi.api.ai.XfyunVisionClient;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class ReversePromptService {
  private static final Logger log = LoggerFactory.getLogger(ReversePromptService.class);
  private final ObjectMapper objectMapper;
  private final DashScopeClient dashScopeClient;
  private final XfyunVisionClient xfyunVisionClient;
  private final ReversePromptTemplateService templateService;

  public ReversePromptService(
      ObjectMapper objectMapper,
      DashScopeClient dashScopeClient,
      XfyunVisionClient xfyunVisionClient,
      ReversePromptTemplateService templateService) {
    this.objectMapper = objectMapper;
    this.dashScopeClient = dashScopeClient;
    this.xfyunVisionClient = xfyunVisionClient;
    this.templateService = templateService;
  }

  public List<ReversePromptDtos.CategoryMeta> categories() {
    return templateService.categories();
  }

  public ReversePromptDtos.AnalyzeImageResponse analyze(ReversePromptDtos.AnalyzeImageRequest request) throws Exception {
    ReversePromptTemplateService.Template template = templateService.get(request == null ? "" : request.category());
    List<String> images = new ArrayList<>();
    if (request != null && request.imageUrl() != null && !request.imageUrl().isBlank()) {
      images.add(request.imageUrl().trim());
    }
    if (request != null && request.imageBase64() != null && !request.imageBase64().isBlank()) {
      images.add(toDataUrl(request.imageBase64().trim()));
    }
    if (images.isEmpty()) {
      throw new IllegalArgumentException("请提供图片 URL 或图片 base64");
    }

    String systemPrompt =
        "你是电商图片视觉解析与生图提示词专家。必须严格输出合法 JSON，不输出 Markdown，不解释过程。";
    AiChatDtos.CompletionResult visionResult = analyzeWithFallback(
        systemPrompt,
        template.systemPrompt(),
        images.get(0));
    String provider = visionResult.provider();
    String model = visionResult.model();
    String raw = visionResult.content();
    raw = raw == null ? "" : raw.trim();
    JsonNode promptJson = parseJson(raw);
    String promptText = buildPromptText(promptJson, template.fieldLabels());
    return new ReversePromptDtos.AnalyzeImageResponse(
        provider,
        model,
        request == null || request.category() == null || request.category().isBlank() ? "general" : request.category(),
        template.label(),
        promptJson,
        promptText,
        template.groups(),
        template.fieldLabels(),
        raw);
  }

  public ReversePromptDtos.ReviewStyleCloneResponse reviewStyleClone(
      ReversePromptDtos.ReviewStyleCloneRequest request) throws Exception {
    if (request == null
        || isBlank(request.competitorImageUrl())
        || isBlank(request.generatedImageUrl())) {
      throw new IllegalArgumentException("请提供竞品参考图和生成结果图");
    }
    if (!dashScopeClient.isConfigured()) {
      throw new IllegalStateException("复刻质检服务暂不可用");
    }

    List<String> productImages = request.productImageUrls() == null
        ? List.of()
        : request.productImageUrls().stream()
            .filter(url -> !isBlank(url))
            .map(String::trim)
            .limit(6)
            .toList();
    if (productImages.isEmpty()) {
      throw new IllegalArgumentException("请提供至少一张我方产品图");
    }

    List<String> images = new ArrayList<>();
    images.add(request.competitorImageUrl().trim());
    images.addAll(productImages);
    images.add(request.generatedImageUrl().trim());
    int generatedImageIndex = images.size();
    int threshold = Math.max(80, Math.min(95, request.threshold() == null ? 90 : request.threshold()));
    String modeRule = "style".equalsIgnoreCase(String.valueOf(request.mode()))
        ? "跨类目关系映射：构图按合理关系映射评分，不要求复制不适配的使用动作。"
        : "同类目高保真复刻：严格比较构图、展示状态、人物动作、场景、光色和排版骨架。";
    String reviewPrompt = """
        你正在审核一张电商换品复刻结果。图片顺序：图1是竞品视觉参考；图2至图%d是同一款我方产品的外观事实参考；图%d是待审核生成结果。%s
        必须分别比较：
        产品身份是硬门槛，竞品商品外观绝不能作为我方产品事实。必须拆成四项逐项比较：
        1. silhouette：生成结果与我方产品图的外轮廓、产品类型、数量和整体形态一致性；
        2. proportion_thickness：长宽比例、厚薄体感、侧面高度和摆放/折叠状态一致性；
        3. surface_pattern：主辅色、色块位置、表面图案、绗缝/纹理及其尺度和走向一致性；
        4. edge_fold_markings：包边、侧墙、折痕/折叠结构、可见印花标记和配件一致性；
        5. composition：与竞品图的主体位置、占比、角度、裁切、镜头、留白和版式骨架一致性；当竞品产品姿态与我方真实形态冲突时，应以我方产品身份为准；
        6. color_temperature：只比较画面环境的主辅色、色温、饱和度、明暗与对比关系，不因我方产品保留自身颜色扣分；
        7. lighting：主光方向、软硬、阴影与景深一致性；
        8. scene：房间/背景、家具道具、前中后景和材质关系一致性；
        9. people_action：人物数量、非特定人群特征、位置、穿搭气质、姿态、动作、视线及人与产品关系一致性；竞品无人且结果无人时记100；
        10. typography：只比较信息块数量、位置、尺寸、对齐、层级和字体气质，不要求复制竞品原文；
        11. compliance：不得出现竞品品牌、Logo、原文、价格、认证、水印、乱码、自造品牌、虚构参数或错误结构。若生成结果出现我方产品图和已确认事实均未展示的分层、截面、内部材质、额外厚垫、错误配件或结构，compliance 必须记0。
        已确认产品事实：%s
        项目禁用内容：%s
        每项0-100整数打分。issues只列可观察且可修正的问题，最多6项。repair_instruction输出一段不超过180字的中文返修指令，只描述需要修正的视觉差异，不复述竞品文案或品牌。仅输出合法JSON：
        {"scores":{"silhouette":0,"proportion_thickness":0,"surface_pattern":0,"edge_fold_markings":0,"composition":0,"color_temperature":0,"lighting":0,"scene":0,"people_action":0,"typography":0,"compliance":0},"issues":[],"repair_instruction":""}
        """.formatted(
            productImages.size() + 1,
            generatedImageIndex,
            modeRule,
            safeText(request.productFacts(), "未提供，只以产品图可见事实为准"),
            safeText(request.forbiddenContent(), "竞品品牌与文案、虚假参数、虚假认证、乱码和错误结构"));

    AiChatDtos.CompletionResult result = dashScopeClient.completeVision(
        "你是严格的电商图片复刻质检员。必须逐图比较并只输出合法JSON。",
        reviewPrompt,
        images,
        0.1,
        3072);
    JsonNode json = parseJson(result.content() == null ? "" : result.content().trim());
    JsonNode scoresNode = json.path("scores");
    int silhouette = score(scoresNode, "silhouette");
    int proportionThickness = score(scoresNode, "proportion_thickness");
    int surfacePattern = score(scoresNode, "surface_pattern");
    int edgeFoldMarkings = score(scoresNode, "edge_fold_markings");
    int productConsistency = Math.round(
        silhouette * 0.35f
            + proportionThickness * 0.25f
            + surfacePattern * 0.25f
            + edgeFoldMarkings * 0.15f);
    int composition = score(scoresNode, "composition");
    int colorTemperature = score(scoresNode, "color_temperature");
    int lighting = score(scoresNode, "lighting");
    int scene = score(scoresNode, "scene");
    int peopleAction = score(scoresNode, "people_action");
    int typography = score(scoresNode, "typography");
    int compliance = score(scoresNode, "compliance");
    int overall = Math.round(
        productConsistency * 0.35f
            + composition * 0.15f
            + colorTemperature * 0.10f
            + lighting * 0.08f
            + scene * 0.10f
            + peopleAction * 0.08f
            + typography * 0.06f
            + compliance * 0.08f);
    boolean passed = overall >= threshold
        && silhouette >= 95
        && proportionThickness >= 92
        && surfacePattern >= 92
        && edgeFoldMarkings >= 90
        && compliance >= 98;
    List<String> issues = new ArrayList<>();
    JsonNode issuesNode = json.path("issues");
    if (issuesNode.isArray()) {
      issuesNode.forEach(item -> {
        String value = item.asText("").trim();
        if (!value.isBlank() && issues.size() < 6) issues.add(value);
      });
    }
    String repairInstruction = json.path("repair_instruction").asText("").trim();
    if (repairInstruction.length() > 240) repairInstruction = repairInstruction.substring(0, 240);
    ReversePromptDtos.CloneQualityScores scores = new ReversePromptDtos.CloneQualityScores(
        productConsistency,
        silhouette,
        proportionThickness,
        surfacePattern,
        edgeFoldMarkings,
        composition,
        colorTemperature,
        lighting,
        scene,
        peopleAction,
        typography,
        compliance,
        overall);
    return new ReversePromptDtos.ReviewStyleCloneResponse(
        result.provider(),
        result.model(),
        scores,
        passed,
        !passed && !repairInstruction.isBlank(),
        List.copyOf(issues),
        repairInstruction);
  }

  private boolean isBlank(String value) {
    return value == null || value.isBlank();
  }

  private String safeText(String value, String fallback) {
    return isBlank(value) ? fallback : value.trim();
  }

  private int score(JsonNode scoresNode, String field) {
    return Math.max(0, Math.min(100, scoresNode.path(field).asInt(0)));
  }

  private AiChatDtos.CompletionResult analyzeWithFallback(
      String systemPrompt,
      String prompt,
      String imageUrl) throws Exception {
    if (!xfyunVisionClient.isConfigured()) {
      return analyzeWithDashScope(systemPrompt, prompt, imageUrl);
    }

    try {
      String content = xfyunVisionClient.analyzeImage(systemPrompt, prompt, imageUrl);
      return new AiChatDtos.CompletionResult("xfyun", xfyunVisionClient.model(), content);
    } catch (InterruptedException exception) {
      Thread.currentThread().interrupt();
      throw exception;
    } catch (Exception exception) {
      if (!isTransientVisionFailure(exception)) throw exception;
      if (!dashScopeClient.isConfigured()) {
        throw new IllegalStateException("讯飞视觉服务繁忙，请稍后重试", exception);
      }
      log.warn(
          "Xfyun vision is temporarily unavailable; falling back to DashScope model {}",
          dashScopeClient.model());
      try {
        return analyzeWithDashScope(systemPrompt, prompt, imageUrl);
      } catch (Exception fallbackException) {
        fallbackException.addSuppressed(exception);
        throw fallbackException;
      }
    }
  }

  private AiChatDtos.CompletionResult analyzeWithDashScope(
      String systemPrompt,
      String prompt,
      String imageUrl) throws Exception {
    return dashScopeClient.completeVision(
        systemPrompt,
        prompt,
        List.of(imageUrl),
        0.15,
        4096);
  }

  private boolean isTransientVisionFailure(Exception exception) {
    Throwable current = exception;
    while (current != null) {
      String message = String.valueOf(current.getMessage()).toLowerCase(Locale.ROOT);
      if (message.contains("transient")
          || message.contains("system is busy")
          || message.contains("10310")
          || message.contains("authorization failed")
          || message.contains("authorizationfailed")
          || message.contains("11200")
          || message.contains("timeout")
          || message.contains("timed out")
          || message.contains("connection")
          || message.contains(" 401")
          || message.contains(" 403")
          || message.contains(" 429")
          || message.contains(" 500")
          || message.contains(" 502")
          || message.contains(" 503")
          || message.contains(" 504")) {
        return true;
      }
      current = current.getCause();
    }
    return false;
  }

  private String buildPromptText(JsonNode promptJson, Map<String, String> fieldLabels) {
    String structuredPrompt = buildStructuredPromptText(promptJson, fieldLabels);
    String generationPrompt = promptFieldText(promptJson, "generation_prompt");
    if (structuredPrompt.isBlank()) structuredPrompt = generationPrompt;
    String negativePrompt = promptFieldText(promptJson, "negative_prompt");
    if (negativePrompt.isBlank()) return structuredPrompt;
    return structuredPrompt + "\n避免出现：" + negativePrompt;
  }

  private String buildStructuredPromptText(JsonNode promptJson, Map<String, String> fieldLabels) {
    if (promptJson == null || !promptJson.isObject()) return "";
    List<String> fieldOrder = List.of(
        "content_role",
        "subject_and_elements",
        "product_identity",
        "mattress_surface",
        "mattress_structure",
        "curtain_detail",
        "curtain_drape",
        "curtain_scene",
        "bed_wood",
        "bed_structure",
        "composition_and_camera",
        "scene_and_environment",
        "people_and_actions",
        "lighting_and_color",
        "visual_style",
        "typography_layout");
    List<String> lines = new ArrayList<>();
    for (String fieldName : fieldOrder) {
      appendStructuredLine(lines, fieldName, promptJson.get(fieldName), fieldLabels);
    }
    Iterator<Map.Entry<String, JsonNode>> fields = promptJson.fields();
    while (fields.hasNext()) {
      Map.Entry<String, JsonNode> field = fields.next();
      if (fieldOrder.contains(field.getKey())
          || "generation_prompt".equals(field.getKey())
          || "negative_prompt".equals(field.getKey())) {
        continue;
      }
      appendStructuredLine(lines, field.getKey(), field.getValue(), fieldLabels);
    }
    if (lines.isEmpty()) return "";
    lines.set(0, "提示词：" + lines.get(0));
    return String.join("\n", lines);
  }

  private void appendStructuredLine(
      List<String> lines,
      String fieldName,
      JsonNode value,
      Map<String, String> fieldLabels) {
    String text = readableValue(value, fieldLabels);
    if (!text.isBlank()) {
      lines.add(fieldLabels.getOrDefault(fieldName, fieldName) + "：" + text);
    }
  }

  private String readableValue(JsonNode value, Map<String, String> fieldLabels) {
    if (value == null || value.isNull()) return "";
    if (value.isValueNode()) return value.asText().trim();
    List<String> parts = new ArrayList<>();
    if (value.isArray()) {
      value.forEach(item -> {
        String text = readableValue(item, fieldLabels);
        if (!text.isBlank()) parts.add(text);
      });
      return String.join("；", parts);
    }
    value.fields().forEachRemaining(field -> {
      String text = readableValue(field.getValue(), fieldLabels);
      if (!text.isBlank()) {
        parts.add(fieldLabels.getOrDefault(field.getKey(), field.getKey()) + "：" + text);
      }
    });
    return String.join("，", parts);
  }

  private String promptFieldText(JsonNode promptJson, String fieldName) {
    if (promptJson == null) return "";
    JsonNode value = promptJson.get(fieldName);
    if (value == null || value.isNull()) return "";
    if (value.isTextual()) return value.asText().trim();
    if (value.isArray()) {
      List<String> parts = new ArrayList<>();
      value.forEach(item -> {
        String text = item.isTextual() ? item.asText().trim() : item.toString();
        if (!text.isBlank()) parts.add(text);
      });
      return String.join("、", parts);
    }
    return value.toString();
  }

  private JsonNode parseJson(String raw) throws Exception {
    String json = extractJson(raw);
    if (json.isBlank()) {
      throw new IllegalStateException("模型没有返回可用 JSON");
    }
    return objectMapper.readTree(json);
  }

  private String extractJson(String raw) {
    if (raw == null) return "";
    String text = raw.trim();
    if (text.startsWith("```")) {
      int firstLine = text.indexOf('\n');
      int lastFence = text.lastIndexOf("```");
      if (firstLine >= 0 && lastFence > firstLine) {
        text = text.substring(firstLine + 1, lastFence).trim();
      }
    }
    if (text.startsWith("{") && text.endsWith("}")) return text;
    int start = text.indexOf('{');
    int end = text.lastIndexOf('}');
    return start >= 0 && end > start ? text.substring(start, end + 1) : "";
  }

  private String toDataUrl(String value) {
    if (value.startsWith("data:")) return value;
    return "data:image/jpeg;base64," + value;
  }
}
