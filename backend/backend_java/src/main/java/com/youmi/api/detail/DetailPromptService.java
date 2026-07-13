package com.youmi.api.detail;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.ai.AiChatDtos;
import com.youmi.api.ai.DashScopeClient;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class DetailPromptService {
  private final ObjectMapper objectMapper;
  private final DashScopeClient dashScopeClient;

  public DetailPromptService(ObjectMapper objectMapper, DashScopeClient dashScopeClient) {
    this.objectMapper = objectMapper;
    this.dashScopeClient = dashScopeClient;
  }

  public DetailPromptDtos.PromptResponse generatePrompts(DetailPromptDtos.PromptRequest request) {
    if (!dashScopeClient.isConfigured()) {
      return fallbackResponse(request, "fallback:no-api-key");
    }

    try {
      List<DetailPromptDtos.ScreenPrompt> prompts = requestPromptsFromLlm(request);
      if (prompts.isEmpty()) {
        return fallbackResponse(request, "fallback:empty-llm-result");
      }
      return new DetailPromptDtos.PromptResponse("dashscope", dashScopeClient.model(), prompts);
    } catch (Exception ignored) {
      return fallbackResponse(request, "fallback:llm-error");
    }
  }

  private List<DetailPromptDtos.ScreenPrompt> requestPromptsFromLlm(DetailPromptDtos.PromptRequest request)
      throws Exception {
    AiChatDtos.CompletionResult completion = dashScopeClient.complete(
        List.of(
            new AiChatDtos.Message(
                "system",
                """
            你是资深电商详情页视觉策划和 AI 生图提示词专家。
            你的任务是根据已完成的分屏规划，为每一屏写一套可直接给生图模型使用的提示词。
            逻辑参考成熟电商详情页生成流程：先建立整套详情页的全局视觉标准，再为每一屏生成独立的单屏 9:16 生图指令。
            只输出 JSON，不要 Markdown，不要解释。
            JSON 格式：
            {
              "prompts": [
                {
                  "id": "与输入 id 一致",
                  "index": 1,
                  "positive": "正向提示词",
                  "negative": "负向提示词",
                  "layout": "版式指令",
                  "text": "画面文案指令",
                  "modelInput": "正向提示词 + 负向提示词的完整输入"
                }
              ]
            }
            要求：
            1. positive 必须包含：全局执行标准、平台、页面第几屏、产品信息、页面目标、视觉布局、画面内容、标题/正文方向、光影材质、风格和转化目的。
            2. layout 必须说明画面结构，不要只写风格词。
            3. text 必须说明标题区、卖点文字区如何呈现，并要求文字短、清晰、可读，不要乱码。
            4. negative 必须约束：不要乱码、不要错字、不要伪文字、不要产品变形、不要多余品牌/logo、不要平台水印、不要价格标签、不要杂乱背景、不要低清晰度。
            5. 每屏提示词要互相区分，不能模板化重复；每屏只负责一个明确的电商信息任务。
            """),
            new AiChatDtos.Message("user", objectMapper.writeValueAsString(request))),
        0.35);

    String content = completion.content();
    JsonNode parsed = objectMapper.readTree(extractJsonObject(content));
    return objectMapper.convertValue(
        parsed.path("prompts"), new TypeReference<List<DetailPromptDtos.ScreenPrompt>>() {});
  }

  private DetailPromptDtos.PromptResponse fallbackResponse(
      DetailPromptDtos.PromptRequest request, String provider) {
    List<DetailPromptDtos.ScreenPrompt> prompts = new ArrayList<>();
    List<DetailPromptDtos.ScreenPlan> plans = request.plans() == null ? List.of() : request.plans();
    String globalStandard = buildGlobalStandard(request, plans.size());

    for (DetailPromptDtos.ScreenPlan plan : plans) {
      String layout = "视觉布局：" + safe(plan.visual(), "产品主体清晰展示，标题区、产品展示区、卖点说明区分层明确，阅读顺序从上到下顺畅");
      String text = "标题：" + safe(plan.title(), "详情页分屏") + "。正文：" + safe(plan.copy(), "用 1-2 行短句表达本屏核心卖点") + "。所有可见文字必须是短句简体中文，清晰可读，不堆满画面。";
      String positive = globalStandard
          + "\n\n【详情页第" + plan.index() + "屏】"
          + "\n页面主题：" + safe(plan.title(), "详情页分屏")
          + "\n页面目标：" + safe(plan.goal(), "提升用户理解和购买意愿")
          + "\n" + layout
          + "\n画面内容：" + safe(plan.copy(), "围绕产品核心价值做卖点说明")
          + "\n证明重点：" + safe(plan.proof(), "核心卖点与细节证明")
          + "\n" + text
          + "\n生图要求：使用参考白底图中的商品作为唯一产品外观来源，保持商品结构、颜色、材质和比例一致；生成完整电商详情页单屏，比例"
          + safe(request.ratio(), "9:16")
          + "，商业摄影质感，光影自然，背景干净，高完成度，适合移动端淘宝/天猫详情页。";
      String negative = "不要乱码文字，不要错误中文，不要伪文字，不要无意义符号，不要英文大段广告词，不要多余品牌 logo，不要平台水印，不要价格标签，不要产品变形，不要多主体混乱，不要低清晰度，不要脏乱背景，不要过度炫光，不要遮挡产品核心结构。";
      prompts.add(new DetailPromptDtos.ScreenPrompt(
          plan.id(), plan.index(), positive, negative, layout, text, positive + "\n\n负向提示词：" + negative));
    }

    return new DetailPromptDtos.PromptResponse(provider, dashScopeClient.model(), prompts);
  }

  private String buildGlobalStandard(DetailPromptDtos.PromptRequest request, int pageCount) {
    return "【全局画面执行标准】"
        + "\n产品信息：" + safe(request.productInfo(), "产品")
        + "\n目标平台：" + safe(request.platform(), "淘宝")
        + "\n目标页数：" + pageCount
        + "\n目标比例：" + safe(request.ratio(), "9:16")
        + "\n生图模型：" + safe(request.model(), "由前 img2")
        + "\n整套风格：" + safe(request.style(), "高端、干净、真实、有电商转化感")
        + "\n统一规则：整套详情页围绕产品信息建立统一视觉氛围，兼顾品牌感与转化感；每屏只讲一个明确卖点；标题短、稳、清晰；正文控制在 1-2 行；如果模型无法稳定渲染文字，宁可减少文字区域也不要生成伪文字。";
  }

  private String extractJsonObject(String content) {
    int start = content.indexOf('{');
    int end = content.lastIndexOf('}');
    if (start < 0 || end <= start) {
      throw new IllegalArgumentException("No JSON object in LLM content");
    }
    return content.substring(start, end + 1);
  }

  private String safe(String value, String fallback) {
    return StringUtils.hasText(value) ? value.trim() : fallback;
  }

}
