package com.youmi.api.creative;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.ai.AiChatClient;
import com.youmi.api.ai.AiChatDtos;
import com.youmi.api.ai.MiniMaxM3Client;
import com.youmi.api.common.ApiException;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class CanvasCreativeService {
  private static final int DEFAULT_DEMAND_COUNT = 6;
  private static final int MAX_DEMAND_COUNT = 12;
  private static final List<DemandSeed> DEMAND_SEEDS = List.of(
      new DemandSeed("人群", "核心人群", "让目标用户一眼确认这是为自己设计的"),
      new DemandSeed("场景", "高频场景", "把产品放进真实、具体、容易代入的使用时刻"),
      new DemandSeed("需求", "首要问题", "直接回应购买前最迫切、最常出现的问题"),
      new DemandSeed("人群", "进阶人群", "覆盖对品质、体验或审美有更高要求的人群"),
      new DemandSeed("场景", "决策场景", "呈现用户对比和下单时最在意的信息"),
      new DemandSeed("需求", "情绪价值", "表达产品带来的安心、轻松、体面或愉悦感"),
      new DemandSeed("人群", "细分人群", "补充一个明确且有差异的细分使用者"),
      new DemandSeed("场景", "延展场景", "扩展产品在季节、空间或时间上的使用可能"),
      new DemandSeed("需求", "体验升级", "把功能优势转化为用户能感知的体验变化"),
      new DemandSeed("人群", "送礼人群", "说明送给谁、为什么合适以及情感表达"),
      new DemandSeed("场景", "细节证明", "用产品细节支撑用户的信任和判断"),
      new DemandSeed("需求", "长期价值", "呈现耐用、易维护或持续使用价值"));

  private final ObjectMapper objectMapper;
  private final AiChatClient aiChatClient;
  private final MiniMaxM3Client miniMaxM3Client;

  public CanvasCreativeService(
      ObjectMapper objectMapper,
      AiChatClient aiChatClient,
      MiniMaxM3Client miniMaxM3Client) {
    this.objectMapper = objectMapper;
    this.aiChatClient = aiChatClient;
    this.miniMaxM3Client = miniMaxM3Client;
  }

  public CanvasCreativeDtos.DemandResponse generateDemands(
      CanvasCreativeDtos.DemandRequest request) {
    validateDemandRequest(request);
    int count = normalizedCount(request.count());

    try {
      ProviderResult providerResult = requestDemands(request, count);
      List<CanvasCreativeDtos.DemandCard> cards =
          normalizeCards(providerResult.cards(), request, count);
      if (!cards.isEmpty()) {
        return new CanvasCreativeDtos.DemandResponse(
            providerResult.provider(), providerResult.model(), cards);
      }
    } catch (Exception ignored) {
      // A stable local plan keeps the canvas workflow usable when a planning model is unavailable.
    }

    return new CanvasCreativeDtos.DemandResponse(
        "fallback",
        "",
        fallbackCards(request, count));
  }

  private ProviderResult requestDemands(
      CanvasCreativeDtos.DemandRequest request, int count) throws Exception {
    String system = """
        你是资深电商需求洞察、视觉策略和转化文案专家。
        请把用户已经提供的产品信息分裂为互不重复、可直接转化为电商创意图片的需求方向。
        只能使用输入中能够确认的产品事实；不得补写未经提供的数字、功效、资质、成分、价格、销量、适用范围或承诺。
        每张卡只解决一个明确问题，并同时给出人群、场景、需求、卖点、短文案和视觉方向。
        imagePrompt 必须可直接给生图模型使用，明确要求参考图中的产品是唯一产品外观来源，保持形状、结构、材质、颜色、纹理、比例和标识准确。
        所有可见文字应为简体中文短句；不确定的信息省略，不得生成错字、乱码或伪文字。
        只输出 JSON，不要 Markdown，不要解释。
        """;
    String prompt = """
        输出格式：
        {
          "cards": [
            {
              "id": "demand-1",
              "index": 1,
              "dimension": "人群|场景|需求",
              "title": "8字以内",
              "audience": "明确人群",
              "scene": "具体使用场景",
              "need": "用户想解决的问题",
              "sellingPoint": "由已知产品信息支撑的卖点",
              "copy": "可放在图片上的简体中文短句",
              "visualDirection": "构图、背景、光线、色彩、信息层级",
              "imagePrompt": "完整生图提示词"
            }
          ]
        }

        平台：%s
        整体风格：%s
        需要方向数：%d
        产品信息：
        %s
        """.formatted(
        safe(request.platform(), "淘宝/天猫"),
        safe(request.style(), "真实、清晰、有品质感"),
        count,
        request.productInfo().trim());

    if (miniMaxM3Client.isConfigured() && !cleanImages(request.productImages()).isEmpty()) {
      AiChatDtos.CompletionResult result = miniMaxM3Client.completeVision(
          system, prompt, cleanImages(request.productImages()), 0.35, 6000);
      return new ProviderResult(
          result.provider(), result.model(), parseCards(result.content()));
    }
    if (aiChatClient.isConfigured()) {
      AiChatDtos.CompletionResult result = aiChatClient.complete(
          List.of(
              new AiChatDtos.Message("system", system),
              new AiChatDtos.Message("user", prompt)),
          0.35);
      return new ProviderResult(
          result.provider(), result.model(), parseCards(result.content()));
    }
    throw new IllegalStateException("No planning provider configured");
  }

  private List<CanvasCreativeDtos.DemandCard> parseCards(String content) throws Exception {
    JsonNode root = objectMapper.readTree(extractJsonObject(content));
    return objectMapper.convertValue(
        root.path("cards"),
        new TypeReference<List<CanvasCreativeDtos.DemandCard>>() {});
  }

  private List<CanvasCreativeDtos.DemandCard> normalizeCards(
      List<CanvasCreativeDtos.DemandCard> source,
      CanvasCreativeDtos.DemandRequest request,
      int count) {
    List<CanvasCreativeDtos.DemandCard> cards = new ArrayList<>();
    if (source == null) return cards;

    for (CanvasCreativeDtos.DemandCard card : source) {
      if (card == null || cards.size() >= count) continue;
      int index = cards.size() + 1;
      String dimension = normalizedDimension(card.dimension(), index);
      String title = safe(card.title(), dimension + "方向 " + index);
      String audience = safe(card.audience(), "目标用户");
      String scene = safe(card.scene(), "真实使用场景");
      String need = safe(card.need(), "更轻松地完成当前任务");
      String sellingPoint = safe(card.sellingPoint(), "围绕已提供的产品信息展示核心价值");
      String copy = safe(card.copy(), title);
      String visual = safe(
          card.visualDirection(),
          "产品主体清晰，场景真实，层级明确，保留充足留白");
      String prompt = StringUtils.hasText(card.imagePrompt())
          ? card.imagePrompt().trim()
          : buildImagePrompt(request, title, audience, scene, need, sellingPoint, copy, visual);
      cards.add(new CanvasCreativeDtos.DemandCard(
          "demand-" + index,
          index,
          dimension,
          title,
          audience,
          scene,
          need,
          sellingPoint,
          copy,
          visual,
          strengthenImagePrompt(request, prompt)));
    }
    return cards;
  }

  private List<CanvasCreativeDtos.DemandCard> fallbackCards(
      CanvasCreativeDtos.DemandRequest request, int count) {
    List<CanvasCreativeDtos.DemandCard> cards = new ArrayList<>();
    for (int index = 1; index <= count; index += 1) {
      DemandSeed seed = DEMAND_SEEDS.get(index - 1);
      String title = seed.title();
      String audience = seed.dimension().equals("人群") ? seed.guidance() : "目标用户";
      String scene = seed.dimension().equals("场景") ? seed.guidance() : "与该方向匹配的真实使用场景";
      String need = seed.dimension().equals("需求") ? seed.guidance() : "围绕该方向解决用户的核心问题";
      String sellingPoint = "从已提供的产品信息中选择一个能够支撑该方向的真实卖点";
      String copy = title + "，让产品价值更容易被看见";
      String visual = "产品主体清晰，围绕" + title + "组织场景、光线与信息层级，画面真实并保留呼吸感";
      cards.add(new CanvasCreativeDtos.DemandCard(
          "demand-" + index,
          index,
          seed.dimension(),
          title,
          audience,
          scene,
          need,
          sellingPoint,
          copy,
          visual,
          buildImagePrompt(
              request, title, audience, scene, need, sellingPoint, copy, visual)));
    }
    return cards;
  }

  private String buildImagePrompt(
      CanvasCreativeDtos.DemandRequest request,
      String title,
      String audience,
      String scene,
      String need,
      String sellingPoint,
      String copy,
      String visual) {
    return strengthenImagePrompt(
        request,
        """
        创意方向：%s
        目标人群：%s
        使用场景：%s
        用户需求：%s
        核心卖点：%s
        画面文案：%s
        视觉方向：%s
        """.formatted(title, audience, scene, need, sellingPoint, copy, visual).trim());
  }

  private String strengthenImagePrompt(
      CanvasCreativeDtos.DemandRequest request, String prompt) {
    return """
        使用参考图中的商品作为唯一产品外观来源，保持商品形状、结构、材质、颜色、纹理、比例和标识准确，不替换商品，不混入其他商品特征。
        产品信息：%s
        目标平台：%s
        整体风格：%s
        %s
        生成一张完成度高、主体明确、构图有层次、适合电商展示的创意图片。
        画面只表达已提供且可确认的事实，不添加未经提供的数字、功效、资质、价格、销量、承诺、品牌或水印。
        所有可见文字使用简体中文短句，清晰可读；无法稳定呈现时减少文字，不得生成错字、乱码或伪文字。只输出最终图片。
        """.formatted(
        request.productInfo().trim(),
        safe(request.platform(), "淘宝/天猫"),
        safe(request.style(), "真实、清晰、有品质感"),
        prompt).trim();
  }

  private void validateDemandRequest(CanvasCreativeDtos.DemandRequest request) {
    if (request == null || !StringUtils.hasText(request.productInfo())) {
      throw new ApiException(400, "productInfo is required");
    }
    if (cleanImages(request.productImages()).isEmpty()) {
      throw new ApiException(400, "productImages is required");
    }
  }

  private List<String> cleanImages(List<String> images) {
    if (images == null) return List.of();
    return images.stream()
        .filter(StringUtils::hasText)
        .map(String::trim)
        .distinct()
        .limit(6)
        .toList();
  }

  private int normalizedCount(Integer count) {
    if (count == null) return DEFAULT_DEMAND_COUNT;
    return Math.max(1, Math.min(MAX_DEMAND_COUNT, count));
  }

  private String normalizedDimension(String dimension, int index) {
    if ("人群".equals(dimension) || "场景".equals(dimension) || "需求".equals(dimension)) {
      return dimension;
    }
    return List.of("人群", "场景", "需求").get((index - 1) % 3);
  }

  private String extractJsonObject(String content) {
    if (content == null) throw new IllegalArgumentException("Empty content");
    int start = content.indexOf('{');
    int end = content.lastIndexOf('}');
    if (start < 0 || end <= start) {
      throw new IllegalArgumentException("No JSON object in content");
    }
    return content.substring(start, end + 1);
  }

  private String safe(String value, String fallback) {
    return StringUtils.hasText(value) ? value.trim() : fallback;
  }

  private record ProviderResult(
      String provider,
      String model,
      List<CanvasCreativeDtos.DemandCard> cards) {}

  private record DemandSeed(String dimension, String title, String guidance) {}
}
