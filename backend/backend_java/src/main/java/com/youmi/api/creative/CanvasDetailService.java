package com.youmi.api.creative;

import com.youmi.api.common.ApiException;
import com.youmi.api.detail.DetailCloneDtos;
import com.youmi.api.detail.DetailCloneService;
import com.youmi.api.detail.DetailPromptDtos;
import com.youmi.api.detail.DetailPromptService;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class CanvasDetailService {
  private static final int DEFAULT_SCREEN_COUNT = 6;
  private static final int MAX_SCREEN_COUNT = 12;
  private static final List<ScreenSeed> SCREEN_SEEDS = List.of(
      new ScreenSeed(
          "首屏主视觉",
          "用一句核心利益点建立第一印象",
          "产品主视觉与核心利益点",
          "大标题、产品主体、一个核心卖点，留白充足",
          "产品真实外观与核心价值"),
      new ScreenSeed(
          "痛点共鸣",
          "让用户快速识别自己的问题",
          "从用户日常问题切入，引出产品价值",
          "真实场景与痛点信息上下分区，产品自然进入画面",
          "用户问题与使用前状态"),
      new ScreenSeed(
          "核心卖点",
          "集中解释最重要的购买理由",
          "一个核心卖点配一条简洁说明",
          "产品主体居中，卖点标签围绕但不遮挡产品",
          "产品信息中可确认的核心卖点"),
      new ScreenSeed(
          "细节证明",
          "用材质、结构或工艺建立可信度",
          "放大一个能够支撑卖点的真实细节",
          "局部特写、标注线和简短说明，画面干净",
          "材质、结构、工艺或使用细节"),
      new ScreenSeed(
          "场景体验",
          "帮助用户想象真实使用体验",
          "产品进入具体人群与使用场景",
          "自然光生活场景，产品始终是视觉主体",
          "适用人群、使用空间与体验变化"),
      new ScreenSeed(
          "优势说明",
          "把产品价值讲得更清楚",
          "用同维度信息解释产品的优势",
          "左右或上下对照结构，不出现贬低性竞品表达",
          "已提供且可验证的产品差异"),
      new ScreenSeed(
          "使用方法",
          "降低理解和使用门槛",
          "用简洁步骤说明如何使用或搭配",
          "三步以内的流程卡片，图标简洁，阅读顺序明确",
          "真实使用方式和注意点"),
      new ScreenSeed(
          "规格选择",
          "帮助用户完成购买决策",
          "整理已提供的尺寸、款式或适配信息",
          "清晰参数卡与产品展示并置，不填未知参数",
          "产品信息中已有的规格与适配范围"),
      new ScreenSeed(
          "品质感知",
          "强化整体质感与品牌印象",
          "通过光影、材质和细节呈现产品品质",
          "克制高级的棚拍或生活方式构图，文字极少",
          "外观、触感、材质与做工"),
      new ScreenSeed(
          "人群适配",
          "说明产品适合哪些明确人群",
          "用不同使用者的真实需要组织信息",
          "人物与产品关系自然，避免夸张效果演示",
          "产品信息中明确的适用人群"),
      new ScreenSeed(
          "维护与耐用",
          "回应长期使用顾虑",
          "说明清洁、收纳、保养或耐用价值",
          "细节图与简短说明卡组合，信息清晰",
          "已提供的维护方式和长期价值"),
      new ScreenSeed(
          "收尾转化",
          "总结价值并给出自然的行动引导",
          "回扣核心卖点和使用体验",
          "产品英雄图、价值总结和克制的行动文案",
          "整套详情页已经确认的产品价值"));

  private final DetailCloneService detailCloneService;
  private final DetailPromptService detailPromptService;

  public CanvasDetailService(
      DetailCloneService detailCloneService,
      DetailPromptService detailPromptService) {
    this.detailCloneService = detailCloneService;
    this.detailPromptService = detailPromptService;
  }

  public CanvasCreativeDtos.DetailResponse generateDetailPlan(
      CanvasCreativeDtos.DetailRequest request) {
    validate(request);
    int count = normalizedCount(request.count());
    List<ScreenDraft> drafts = baseDrafts(request, count);
    String structureProvider = "native";
    String structureModel = "";

    List<String> references = cleanImages(request.referenceImages(), MAX_SCREEN_COUNT);
    if (!references.isEmpty()) {
      DetailCloneDtos.DeconstructResponse deconstruction = detailCloneService.deconstruct(
          new DetailCloneDtos.DeconstructRequest(
              references,
              request.productInfo(),
              safe(request.cloneStrength(), "balanced")));
      DetailCloneDtos.MappingResponse mapping = detailCloneService.map(
          new DetailCloneDtos.MappingRequest(
              request.productInfo(),
              cleanImages(request.productImages(), 6),
              safe(request.cloneStrength(), "balanced"),
              deconstruction.sliceContracts()));
      drafts = applyMappings(drafts, mapping.mappingContracts(), references.size());
      structureProvider = mapping.provider();
      structureModel = mapping.model();
    }

    List<DetailPromptDtos.ScreenPlan> plans = drafts.stream()
        .map(draft -> new DetailPromptDtos.ScreenPlan(
            draft.id(),
            draft.index(),
            draft.title(),
            draft.goal(),
            draft.copy(),
            draft.visual(),
            "电商详情页",
            draft.proof()))
        .toList();
    DetailPromptDtos.PromptResponse promptResponse = detailPromptService.generatePrompts(
        new DetailPromptDtos.PromptRequest(
            request.productInfo(),
            safe(request.platform(), "淘宝/天猫"),
            safe(request.ratio(), "9:16"),
            "",
            safe(request.style(), "真实、清晰、有品质感"),
            count + " 屏",
            plans));
    Map<String, DetailPromptDtos.ScreenPrompt> prompts = promptResponse.prompts().stream()
        .collect(Collectors.toMap(
            DetailPromptDtos.ScreenPrompt::id,
            prompt -> prompt,
            (left, right) -> left,
            LinkedHashMap::new));

    List<CanvasCreativeDtos.DetailScreen> screens = new ArrayList<>();
    for (ScreenDraft draft : drafts) {
      DetailPromptDtos.ScreenPrompt generated = prompts.get(draft.id());
      String prompt = generated == null ? draft.generationHint() : generated.modelInput();
      screens.add(new CanvasCreativeDtos.DetailScreen(
          draft.id(),
          draft.index(),
          draft.title(),
          draft.goal(),
          draft.copy(),
          draft.visual(),
          draft.proof(),
          draft.referenceIndex(),
          strengthenPrompt(request, draft, prompt, draft.referenceIndex() != null)));
    }

    String provider = references.isEmpty()
        ? promptResponse.provider()
        : structureProvider + "+" + promptResponse.provider();
    String model = StringUtils.hasText(promptResponse.model())
        ? promptResponse.model()
        : structureModel;
    return new CanvasCreativeDtos.DetailResponse(provider, model, screens);
  }

  static List<ScreenDraft> baseDrafts(
      CanvasCreativeDtos.DetailRequest request, int count) {
    List<ScreenDraft> drafts = new ArrayList<>();
    for (int index = 1; index <= count; index += 1) {
      ScreenSeed seed = SCREEN_SEEDS.get(index - 1);
      drafts.add(new ScreenDraft(
          "detail-" + index,
          index,
          seed.title(),
          seed.goal(),
          seed.copy(),
          seed.visual(),
          seed.proof(),
          null,
          ""));
    }
    return drafts;
  }

  private List<ScreenDraft> applyMappings(
      List<ScreenDraft> drafts,
      List<DetailCloneDtos.MappingContract> mappings,
      int referenceCount) {
    if (mappings == null || mappings.isEmpty()) return drafts;
    Map<Integer, DetailCloneDtos.MappingContract> byIndex = mappings.stream()
        .filter(item -> item != null && item.sliceIndex() != null)
        .collect(Collectors.toMap(
            DetailCloneDtos.MappingContract::sliceIndex,
            item -> item,
            (left, right) -> left));

    List<ScreenDraft> mapped = new ArrayList<>();
    for (ScreenDraft draft : drafts) {
      int referenceIndex = Math.min(draft.index() - 1, referenceCount - 1);
      DetailCloneDtos.MappingContract contract = byIndex.get(draft.index());
      if (contract == null) {
        mapped.add(draft.withReferenceIndex(referenceIndex));
        continue;
      }
      Map<String, Object> slots = contract.variableSlots() == null
          ? Map.of()
          : contract.variableSlots();
      String title = slot(slots, "headline", draft.title());
      String copy = slot(
          slots,
          "subheadline",
          slot(slots, "body", draft.copy()));
      String visual = joinParts(
          draft.visual(),
          listText(contract.keepFromA()),
          "产品角色：" + safe(contract.newProductRole(), draft.proof()));
      String proof = joinParts(
          draft.proof(),
          listText(contract.replaceWithProduct()));
      mapped.add(new ScreenDraft(
          draft.id(),
          draft.index(),
          title,
          safe(contract.aRole(), draft.goal()),
          copy,
          visual,
          proof,
          referenceIndex,
          safe(contract.generationHint(), draft.generationHint())));
    }
    return mapped;
  }

  private String strengthenPrompt(
      CanvasCreativeDtos.DetailRequest request,
      ScreenDraft draft,
      String generated,
      boolean hasReference) {
    String referenceRule = hasReference
        ? "图1是产品图，图2是本屏版式与视觉参考图。图2只提供布局、构图、色彩、光影和信息节奏，不复制其中的商品、品牌、文字、价格、销量、证书、型号、功效承诺或水印。"
        : "图1是产品图，也是本屏商品外观的唯一来源。";
    return """
        %s
        使用图1中的商品作为唯一产品外观来源，保持形状、结构、材质、颜色、纹理、比例和标识准确，不替换、不变形、不混入其他商品特征。
        产品信息：%s
        详情页第%d屏：%s
        页面目标：%s
        画面文案：%s
        视觉方向：%s
        证明重点：%s
        %s
        生成完整的%s竖版电商详情页单屏，整套风格为%s。构图有层次、产品清晰、光影自然、移动端阅读顺畅。
        只表达已提供且可确认的事实，不添加未经提供的数字、功效、资质、价格、销量或承诺。
        所有可见文字使用简体中文短句，清晰可读；无法稳定呈现时减少文字，不得生成错字、乱码或伪文字。只输出最终图片。
        """.formatted(
        referenceRule,
        request.productInfo().trim(),
        draft.index(),
        draft.title(),
        draft.goal(),
        draft.copy(),
        draft.visual(),
        draft.proof(),
        safe(generated, draft.generationHint()),
        safe(request.ratio(), "9:16"),
        safe(request.style(), "真实、清晰、有品质感")).trim();
  }

  private void validate(CanvasCreativeDtos.DetailRequest request) {
    if (request == null || !StringUtils.hasText(request.productInfo())) {
      throw new ApiException(400, "productInfo is required");
    }
    if (cleanImages(request.productImages(), 6).isEmpty()) {
      throw new ApiException(400, "productImages is required");
    }
  }

  private int normalizedCount(Integer count) {
    if (count == null) return DEFAULT_SCREEN_COUNT;
    return Math.max(3, Math.min(MAX_SCREEN_COUNT, count));
  }

  private List<String> cleanImages(List<String> images, int limit) {
    if (images == null) return List.of();
    return images.stream()
        .filter(StringUtils::hasText)
        .map(String::trim)
        .distinct()
        .limit(limit)
        .toList();
  }

  private String slot(Map<String, Object> slots, String key, String fallback) {
    Object value = slots.get(key);
    return value == null ? fallback : safe(String.valueOf(value), fallback);
  }

  private String listText(List<String> values) {
    if (values == null) return "";
    return values.stream()
        .filter(StringUtils::hasText)
        .map(String::trim)
        .distinct()
        .collect(Collectors.joining("、"));
  }

  private String joinParts(String... parts) {
    return List.of(parts).stream()
        .filter(StringUtils::hasText)
        .map(String::trim)
        .distinct()
        .collect(Collectors.joining("；"));
  }

  private String safe(String value, String fallback) {
    return StringUtils.hasText(value) ? value.trim() : fallback;
  }

  static record ScreenDraft(
      String id,
      int index,
      String title,
      String goal,
      String copy,
      String visual,
      String proof,
      Integer referenceIndex,
      String generationHint) {
    ScreenDraft withReferenceIndex(Integer nextReferenceIndex) {
      return new ScreenDraft(
          id,
          index,
          title,
          goal,
          copy,
          visual,
          proof,
          nextReferenceIndex,
          generationHint);
    }
  }

  private record ScreenSeed(
      String title,
      String goal,
      String copy,
      String visual,
      String proof) {}
}
