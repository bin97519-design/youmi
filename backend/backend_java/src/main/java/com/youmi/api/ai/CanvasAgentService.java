package com.youmi.api.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.core.json.JsonReadFeature;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class CanvasAgentService {
  private static final Logger log = LoggerFactory.getLogger(CanvasAgentService.class);
  private static final Set<String> ALLOWED_MODELS = Set.of(
      "banana2", "banana-pro", "gpt-image-2", "agnes-image-2.1-flash");
  private static final Set<String> ALLOWED_RATIOS = Set.of(
      "auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9");
  private static final Set<String> ALLOWED_RESOLUTIONS = Set.of("1K", "2K", "4K");
  private static final int MAX_LAYERS = 80;
  private static final int MAX_STEPS = 6;
  private static final String CHAT_PARSE_FALLBACK_TEXT = "我这次没有正确整理出提示词";

  private final ObjectMapper objectMapper;
  private final ObjectMapper agentResponseMapper;
  private final AgentChatClient agentChatClient;

  public CanvasAgentService(
      ObjectMapper objectMapper,
      AgentChatClient agentChatClient) {
    this.objectMapper = objectMapper;
    this.agentResponseMapper = objectMapper.copy()
        .enable(JsonReadFeature.ALLOW_TRAILING_COMMA.mappedFeature())
        .enable(JsonReadFeature.ALLOW_UNESCAPED_CONTROL_CHARS.mappedFeature())
        .enable(JsonReadFeature.ALLOW_SINGLE_QUOTES.mappedFeature());
    this.agentChatClient = agentChatClient;
  }

  public CanvasAgentDtos.EnhancePromptResponse enhancePrompt(
      CanvasAgentDtos.EnhancePromptRequest request) throws Exception {
    String prompt = clean(request == null ? null : request.prompt(), 4000);
    if (prompt.isBlank()) {
      throw new IllegalArgumentException("请先输入需要增强的提示词");
    }
    if (!agentChatClient.isConfigured()) {
      throw new IllegalStateException("Canvas Agent language model is not configured");
    }

    String systemPrompt = """
        你是有米 AI 画布的提示词润色助手。请把用户输入润色为更清晰、更完整、可执行的中文生图提示词。
        必须保留用户原意、数量、主体、产品特征和所有明确限制，不得擅自改变需求。
        可以补充合理的画面结构、构图、光线、材质、色彩和摄影表达，但不得虚构品牌、Logo、文字或用户没有要求的关键内容。
        只输出润色后的提示词正文，不要解释，不要标题，不要 Markdown，不要引号，也不要触发生图。
        """;
    AiChatDtos.CompletionResult result = agentChatClient.complete(
        List.of(
            new AiChatDtos.Message("system", systemPrompt),
            new AiChatDtos.Message("user", prompt)),
        0.3);
    String enhancedPrompt = clean(result.content(), 8000);
    if (enhancedPrompt.isBlank()) {
      throw new IllegalStateException("Agent model returned empty enhanced prompt");
    }
    return new CanvasAgentDtos.EnhancePromptResponse(
        result.provider(), result.model(), enhancedPrompt);
  }

  public CanvasAgentDtos.ChatResponse chat(CanvasAgentDtos.ChatRequest request) throws Exception {
    String instruction = clean(request == null ? null : request.instruction(), 4000);
    if (instruction.isBlank()) {
      throw new IllegalArgumentException("请输入希望与 Agent 讨论的内容");
    }

    List<CanvasAgentDtos.LayerContext> layers = cleanLayers(request.layers());
    Set<String> validImageLayerIds = new LinkedHashSet<>();
    for (CanvasAgentDtos.LayerContext layer : layers) {
      if (isImageLayer(layer)) validImageLayerIds.add(layer.id());
    }
    List<String> requestedReferences = cleanLayerIds(
        request.referenceLayerIds(), validImageLayerIds);
    List<String> defaultReferences = usableReferenceLayerIds(layers, requestedReferences);
    Set<String> submittedReferenceLayerIds = new LinkedHashSet<>(defaultReferences);
    List<String> referenceImageUrls = referenceImageUrls(layers, defaultReferences);
    String visualAnalysis = "";

    String defaultModel = allowedOrDefault(request.model(), ALLOWED_MODELS, "banana2");
    String defaultRatio = allowedOrDefault(request.ratio(), ALLOWED_RATIOS, "auto");
    String defaultResolution = allowedOrDefault(
        normalizeResolution(request.resolution()), ALLOWED_RESOLUTIONS, "2K");
    int defaultCount = clampCount(request.count());

    String systemPrompt = """
        你是有米 AI 画布中的视觉创作顾问。你只负责正常对话、看图分析、澄清需求和优化生图提示词。

        重要规则：
        1. 你绝对不能开始生图、提交任务或声称图片正在生成。
        2. 即使用户说“确认”“开始”“生成吧”，也只能整理好草稿并提醒用户点击界面中的“确认生图”。
        3. 信息不足时继续提问，draftPrompt 留空，readyToGenerate=false。
        4. 信息充分时给出可直接用于生图的完整中文提示词，readyToGenerate=true，但仍需用户点击确认按钮。
        5. 只有请求明确附带参考图时才能看图。没有参考图时，不得声称看过、识别过或分析过图片，只根据文字正常沟通。
        6. 有参考图时，要围绕用户当前提出的问题识别图片，给出针对性的分析和创作方案，不要输出与问题无关的泛泛描述。
        7. 参考图只能使用请求中明确提交且真实可用的图层 ID，不能自行选择画布中的其他图片。
        8. 要结合对话上下文持续修改上一版草稿，回复自然、简洁，像正常的创作沟通。
        9. 不得执行删除、移动、下载、付款、修改账号等画布操作。
        10. 用户明确要求 N 条或 N 个提示词时，draftPrompts 必须返回 N 个彼此独立、可单独生图的完整提示词，不能把多条堆进一个字符串。未要求多条时也用数组返回一条。

        只输出 JSON 对象，不要 Markdown，不要附加说明：
        {
          "reply": "给用户的自然语言回复",
          "draftPrompt": "兼容字段，填写第一条提示词；尚未明确时为空字符串",
          "draftPrompts": ["第一条完整提示词", "第二条完整提示词"],
          "referenceLayerIds": ["真实图层ID"],
          "model": "banana2",
          "ratio": "3:4",
          "resolution": "2K",
          "count": 1,
          "readyToGenerate": true
        }
        """;

    String userPrompt = buildChatPrompt(
        instruction,
        cleanHistory(request.history()),
        layers,
        defaultReferences,
        visualAnalysis,
        defaultModel,
        defaultRatio,
        defaultResolution,
        defaultCount);
    AiChatDtos.CompletionResult result = completePlan(
        systemPrompt, userPrompt, referenceImageUrls);
    ParsedChat parsed = parseChat(
        result.content(),
        defaultReferences,
        submittedReferenceLayerIds,
        defaultModel,
        defaultRatio,
        defaultResolution,
        defaultCount);
    if (!parsed.valid()) {
      try {
        AiChatDtos.CompletionResult repairedResult = repairChatResponse(result.content());
        ParsedChat repaired = parseChat(
            repairedResult.content(),
            defaultReferences,
            submittedReferenceLayerIds,
            defaultModel,
            defaultRatio,
            defaultResolution,
            defaultCount);
        if (repaired.valid()) {
          result = repairedResult;
          parsed = repaired;
          log.info("Canvas Agent recovered malformed chat response with one format retry");
        }
      } catch (Exception error) {
        log.warn("Canvas Agent format retry failed: {}", error.getMessage());
      }
    }

    return new CanvasAgentDtos.ChatResponse(
        result.provider(),
        result.model(),
        parsed.reply(),
        visualAnalysis,
        parsed.draftPrompt(),
        parsed.draftPrompts(),
        parsed.referenceLayerIds(),
        parsed.imageModel(),
        parsed.ratio(),
        parsed.resolution(),
        parsed.count(),
        parsed.readyToGenerate());
  }

  public CanvasAgentDtos.PlanResponse plan(CanvasAgentDtos.PlanRequest request) throws Exception {
    String instruction = clean(request == null ? null : request.instruction(), 4000);
    if (instruction.isBlank()) {
      throw new IllegalArgumentException("请输入希望 Agent 完成的任务");
    }

    List<CanvasAgentDtos.LayerContext> layers = cleanLayers(request.layers());
    Set<String> validImageLayerIds = new LinkedHashSet<>();
    for (CanvasAgentDtos.LayerContext layer : layers) {
      if (isImageLayer(layer)) validImageLayerIds.add(layer.id());
    }
    List<String> requestedReferences = cleanLayerIds(
        request.referenceLayerIds(), validImageLayerIds);
    List<String> defaultReferences = usableReferenceLayerIds(layers, requestedReferences);
    Set<String> submittedReferenceLayerIds = new LinkedHashSet<>(defaultReferences);
    List<String> referenceImageUrls = referenceImageUrls(layers, defaultReferences);
    String visualAnalysis = "";

    String defaultModel = allowedOrDefault(request.model(), ALLOWED_MODELS, "banana2");
    String defaultRatio = allowedOrDefault(request.ratio(), ALLOWED_RATIOS, "auto");
    String defaultResolution = allowedOrDefault(
        normalizeResolution(request.resolution()), ALLOWED_RESOLUTIONS, "2K");
    int defaultCount = clampCount(request.count());

    String systemPrompt = """
        你是有米 AI 画布的任务规划 Agent。你的职责是把用户目标拆成可执行步骤，不直接生成图片。

        只能使用以下动作：
        1. generate：调用现有生图接口。必须给出完整、可直接用于生图的中文 prompt。
        2. arrange：整理本次参考图和新生成图的位置。无需 prompt。

        严禁输出删除、覆盖、上传、下载、付款、修改账号或任意未列出的动作。
        只有请求明确附带参考图时才能看图。没有参考图时，不得声称已经看过或分析过图片。
        有参考图时，要围绕用户当前任务分析图片并制定方案。
        参考图只能使用请求中明确提交且真实可用的图层 ID，不能自行选择画布中的其他图片。
        单个 generate 的 count 只能是 1 到 4。总步骤不超过 6 个。
        用户要求多种方案时，可拆成多个 generate；否则优先一个 generate。

        只输出 JSON 对象，不要 Markdown，不要解释：
        {
          "summary": "一句话说明执行方案",
          "steps": [
            {
              "action": "generate",
              "title": "步骤标题",
              "prompt": "完整生图提示词",
              "referenceLayerIds": ["真实图层ID"],
              "model": "banana2",
              "ratio": "3:4",
              "resolution": "2K",
              "count": 1
            },
            { "action": "arrange", "title": "整理生成结果" }
          ]
        }
        """;

    String userPrompt = buildPlanningPrompt(
        instruction,
        layers,
        defaultReferences,
        visualAnalysis,
        defaultModel,
        defaultRatio,
        defaultResolution,
        defaultCount);

    AiChatDtos.CompletionResult result = completePlan(
        systemPrompt, userPrompt, referenceImageUrls);

    ParsedPlan parsed = parsePlan(
        result.content(),
        instruction,
        defaultReferences,
        submittedReferenceLayerIds,
        defaultModel,
        defaultRatio,
        defaultResolution,
        defaultCount);
    return new CanvasAgentDtos.PlanResponse(
        result.provider(), result.model(), parsed.summary(), visualAnalysis, parsed.steps());
  }

  private AiChatDtos.CompletionResult completePlan(
      String systemPrompt,
      String userPrompt,
      List<String> referenceImageUrls) throws Exception {
    if (!agentChatClient.isConfigured()) {
      throw new IllegalStateException("Canvas Agent language model is not configured");
    }
    if (referenceImageUrls != null && !referenceImageUrls.isEmpty()) {
      return agentChatClient.completeVision(
          systemPrompt, userPrompt, referenceImageUrls, 0.2);
    }
    return agentChatClient.complete(
        List.of(
            new AiChatDtos.Message("system", systemPrompt),
            new AiChatDtos.Message("user", userPrompt)),
        0.2);
  }

  private AiChatDtos.CompletionResult repairChatResponse(String malformedContent) throws Exception {
    String repairPrompt = """
        请把下面内容修复为一个合法 JSON 对象。只修复格式，不删除、合并或改写任何提示词内容。
        draftPrompts 必须是字符串数组，每条提示词保持独立；删除数组和对象末尾多余逗号。
        只输出修复后的 JSON，不要 Markdown，不要解释。

        待修复内容：
        """ + clean(malformedContent, 20000);
    return agentChatClient.complete(
        List.of(
            new AiChatDtos.Message("system", "你是严格的 JSON 格式修复器。"),
            new AiChatDtos.Message("user", repairPrompt)),
        0.0);
  }

  private List<String> referenceImageUrls(
      List<CanvasAgentDtos.LayerContext> layers,
      List<String> referenceLayerIds) {
    if (layers == null || referenceLayerIds == null || referenceLayerIds.isEmpty()) {
      return List.of();
    }
    Set<String> referenceIds = new LinkedHashSet<>(referenceLayerIds);
    return layers.stream()
        .filter(layer -> referenceIds.contains(layer.id()))
        .map(CanvasAgentDtos.LayerContext::url)
        .filter(url -> url != null && !url.isBlank() && !url.startsWith("blob:"))
        .map(String::trim)
        .distinct()
        .limit(8)
        .toList();
  }

  private List<String> usableReferenceLayerIds(
      List<CanvasAgentDtos.LayerContext> layers,
      List<String> requestedReferenceLayerIds) {
    if (layers == null
        || requestedReferenceLayerIds == null
        || requestedReferenceLayerIds.isEmpty()) {
      return List.of();
    }
    Set<String> requestedIds = new LinkedHashSet<>(requestedReferenceLayerIds);
    return layers.stream()
        .filter(this::isImageLayer)
        .filter(layer -> requestedIds.contains(layer.id()))
        .filter(layer -> layer.url() != null
            && !layer.url().isBlank()
            && !layer.url().startsWith("blob:"))
        .map(CanvasAgentDtos.LayerContext::id)
        .distinct()
        .limit(8)
        .toList();
  }

  private String buildPlanningPrompt(
      String instruction,
      List<CanvasAgentDtos.LayerContext> layers,
      List<String> references,
      String visualAnalysis,
      String model,
      String ratio,
      String resolution,
      int count) {
    StringBuilder prompt = new StringBuilder();
    prompt.append("用户任务：").append(instruction).append('\n');
    prompt.append("默认生成参数：模型=").append(model)
        .append("，比例=").append(ratio)
        .append("，分辨率=").append(resolution)
        .append("，数量=").append(count).append('\n');
    prompt.append("当前参考图层ID：").append(references).append('\n');
    if (!visualAnalysis.isBlank()) {
      prompt.append("讯飞视觉分析：").append(visualAnalysis).append('\n');
    }
    prompt.append("当前画布图层：\n");
    for (CanvasAgentDtos.LayerContext layer : layers) {
      prompt.append("- id=").append(layer.id())
          .append("，名称=").append(clean(layer.name(), 80))
          .append("，类型=").append(clean(layer.type(), 30))
          .append("，尺寸=").append(number(layer.width())).append('x').append(number(layer.height()))
          .append("，位置=").append(number(layer.x())).append(',').append(number(layer.y()))
          .append('\n');
    }
    return prompt.toString();
  }

  private String buildChatPrompt(
      String instruction,
      List<CanvasAgentDtos.ChatMessage> history,
      List<CanvasAgentDtos.LayerContext> layers,
      List<String> references,
      String visualAnalysis,
      String model,
      String ratio,
      String resolution,
      int count) {
    StringBuilder prompt = new StringBuilder();
    prompt.append("当前用户消息：").append(instruction).append('\n');
    prompt.append("界面当前参数：模型=").append(model)
        .append("，比例=").append(ratio)
        .append("，分辨率=").append(resolution)
        .append("，数量=").append(count).append('\n');
    prompt.append("当前参考图层ID：").append(references).append('\n');
    if (!visualAnalysis.isBlank()) {
      prompt.append("参考图视觉分析：").append(visualAnalysis).append('\n');
    }
    if (!history.isEmpty()) {
      prompt.append("最近对话（按时间顺序）：\n");
      for (CanvasAgentDtos.ChatMessage message : history) {
        prompt.append(message.role()).append("：").append(message.content()).append('\n');
      }
    }
    prompt.append("当前画布图层：\n");
    for (CanvasAgentDtos.LayerContext layer : layers) {
      prompt.append("- id=").append(layer.id())
          .append("，名称=").append(clean(layer.name(), 80))
          .append("，类型=").append(clean(layer.type(), 30))
          .append("，尺寸=").append(number(layer.width())).append('x').append(number(layer.height()))
          .append("，位置=").append(number(layer.x())).append(',').append(number(layer.y()))
          .append('\n');
    }
    prompt.append("请继续沟通并更新提示词草稿。无论如何都不要开始生图。");
    return prompt.toString();
  }

  private ParsedChat parseChat(
      String content,
      List<String> defaultReferences,
      Set<String> validImageLayerIds,
      String defaultModel,
      String defaultRatio,
      String defaultResolution,
      int defaultCount) {
    try {
      JsonNode root = agentResponseMapper.readTree(extractJsonObject(content));
      String draftPrompt = clean(root.path("draftPrompt").asText(""), 8000);
      List<String> draftPrompts = readStringArray(root.path("draftPrompts")).stream()
          .map(value -> clean(value, 8000))
          .filter(value -> !value.isBlank())
          .distinct()
          .limit(10)
          .toList();
      if (draftPrompts.isEmpty() && !draftPrompt.isBlank()) {
        draftPrompts = List.of(draftPrompt);
      }
      if (draftPrompt.isBlank() && !draftPrompts.isEmpty()) {
        draftPrompt = draftPrompts.get(0);
      }
      boolean readyToGenerate = root.path("readyToGenerate").asBoolean(false)
          && !draftPrompts.isEmpty();
      String reply = clean(root.path("reply").asText(""), 2000);
      if (reply.isBlank()) {
        reply = readyToGenerate
            ? "我已经整理好一版提示词。你可以继续告诉我怎么改，满意后再点“确认生图”。"
            : "请再告诉我一些画面要求，我会继续帮你完善提示词。";
      }
      List<String> references = cleanLayerIds(
          readStringArray(root.path("referenceLayerIds")), validImageLayerIds);
      if (references.isEmpty()) references = defaultReferences;
      return new ParsedChat(
          reply,
          draftPrompt,
          draftPrompts,
          references,
          allowedOrDefault(root.path("model").asText(""), ALLOWED_MODELS, defaultModel),
          allowedOrDefault(root.path("ratio").asText(""), ALLOWED_RATIOS, defaultRatio),
          allowedOrDefault(
              normalizeResolution(root.path("resolution").asText("")),
              ALLOWED_RESOLUTIONS,
              defaultResolution),
          clampCount(root.path("count").asInt(defaultCount)),
          readyToGenerate,
          true);
    } catch (Exception error) {
      log.warn("Canvas Agent returned invalid chat response: {}", error.getMessage());
      return new ParsedChat(
          "我这次没有正确整理出提示词。请再发一次要求，我不会在你确认前开始生图。",
          "",
          List.of(),
          defaultReferences,
          defaultModel,
          defaultRatio,
          defaultResolution,
          defaultCount,
          false,
          false);
    }
  }

  private ParsedPlan parsePlan(
      String content,
      String instruction,
      List<String> defaultReferences,
      Set<String> validImageLayerIds,
      String defaultModel,
      String defaultRatio,
      String defaultResolution,
      int defaultCount) {
    List<CanvasAgentDtos.PlanStep> steps = new ArrayList<>();
    String summary = "已根据当前画布整理执行计划";
    try {
      String json = extractJsonObject(content);
      JsonNode root = agentResponseMapper.readTree(json);
      summary = clean(root.path("summary").asText(summary), 240);
      JsonNode rawSteps = root.path("steps");
      int remainingImages = 4;
      if (rawSteps.isArray()) {
        for (JsonNode rawStep : rawSteps) {
          if (steps.size() >= MAX_STEPS) break;
          String action = clean(rawStep.path("action").asText(""), 30).toLowerCase(Locale.ROOT);
          String title = clean(rawStep.path("title").asText(""), 120);
          if ("arrange".equals(action)) {
            steps.add(new CanvasAgentDtos.PlanStep(
                "arrange",
                title.isBlank() ? "整理本次生成结果" : title,
                "",
                List.of(),
                defaultModel,
                defaultRatio,
                defaultResolution,
                1));
            continue;
          }
          if (!"generate".equals(action)) continue;
          String prompt = clean(rawStep.path("prompt").asText(""), 6000);
          if (prompt.isBlank() || remainingImages <= 0) continue;
          List<String> references = cleanLayerIds(readStringArray(
              rawStep.path("referenceLayerIds")), validImageLayerIds);
          if (references.isEmpty()) references = defaultReferences;
          int count = Math.min(
              clampCount(rawStep.path("count").asInt(defaultCount)), remainingImages);
          remainingImages -= count;
          steps.add(new CanvasAgentDtos.PlanStep(
              "generate",
              title.isBlank() ? "生成图片" : title,
              prompt,
              references,
              allowedOrDefault(rawStep.path("model").asText(""), ALLOWED_MODELS, defaultModel),
              allowedOrDefault(rawStep.path("ratio").asText(""), ALLOWED_RATIOS, defaultRatio),
              allowedOrDefault(
                  normalizeResolution(rawStep.path("resolution").asText("")),
                  ALLOWED_RESOLUTIONS,
                  defaultResolution),
              count));
        }
      }
    } catch (Exception error) {
      log.warn("Canvas Agent returned invalid plan, using safe fallback: {}", error.getMessage());
    }

    if (steps.isEmpty()) {
      steps.add(new CanvasAgentDtos.PlanStep(
          "generate",
          "根据需求生成图片",
          instruction,
          defaultReferences,
          defaultModel,
          defaultRatio,
          defaultResolution,
          defaultCount));
      summary = "按原始需求生成图片";
    }
    return new ParsedPlan(summary, List.copyOf(steps));
  }

  private List<CanvasAgentDtos.LayerContext> cleanLayers(
      List<CanvasAgentDtos.LayerContext> layers) {
    if (layers == null) return List.of();
    List<CanvasAgentDtos.LayerContext> result = new ArrayList<>();
    for (CanvasAgentDtos.LayerContext layer : layers) {
      if (layer == null || layer.id() == null || layer.id().isBlank()) continue;
      result.add(layer);
      if (result.size() >= MAX_LAYERS) break;
    }
    return List.copyOf(result);
  }

  private List<CanvasAgentDtos.ChatMessage> cleanHistory(
      List<CanvasAgentDtos.ChatMessage> history) {
    if (history == null || history.isEmpty()) return List.of();
    List<CanvasAgentDtos.ChatMessage> result = new ArrayList<>();
    for (int index = 0; index < history.size(); index++) {
      CanvasAgentDtos.ChatMessage message = history.get(index);
      if (message == null) continue;
      String role = clean(message.role(), 20).toLowerCase(Locale.ROOT);
      if (!"user".equals(role) && !"assistant".equals(role)) continue;
      String messageContent = clean(message.content(), 5000);
      if ("assistant".equals(role) && messageContent.contains(CHAT_PARSE_FALLBACK_TEXT)) {
        continue;
      }
      if (!messageContent.isBlank()) {
        result.add(new CanvasAgentDtos.ChatMessage(role, messageContent));
      }
    }
    int start = Math.max(0, result.size() - 12);
    return List.copyOf(result.subList(start, result.size()));
  }

  private boolean isImageLayer(CanvasAgentDtos.LayerContext layer) {
    if (layer == null) return false;
    String type = clean(layer.type(), 30).toLowerCase(Locale.ROOT);
    return !"text".equals(type) && !"video".equals(type);
  }

  private List<String> cleanLayerIds(List<String> values, Set<String> allowed) {
    if (values == null || allowed == null || allowed.isEmpty()) return List.of();
    LinkedHashSet<String> result = new LinkedHashSet<>();
    for (String value : values) {
      String id = clean(value, 160);
      if (!id.isBlank() && allowed.contains(id)) result.add(id);
    }
    return List.copyOf(result);
  }

  private List<String> readStringArray(JsonNode node) {
    if (node == null || !node.isArray()) return List.of();
    List<String> values = new ArrayList<>();
    for (JsonNode item : node) values.add(item.asText(""));
    return values;
  }

  private String extractJsonObject(String content) {
    if (content == null) throw new IllegalArgumentException("Agent returned empty content");
    int start = content.indexOf('{');
    int end = content.lastIndexOf('}');
    if (start < 0 || end <= start) throw new IllegalArgumentException("Agent returned invalid JSON");
    String json = VisionJsonSupport.normalizeNumbersOutsideStrings(
        content.substring(start, end + 1));
    return removeTrailingCommas(json);
  }

  private String removeTrailingCommas(String json) {
    if (json == null || json.isBlank()) return json;
    StringBuilder repaired = new StringBuilder(json.length());
    boolean inString = false;
    boolean escaped = false;
    for (int index = 0; index < json.length(); index++) {
      char current = json.charAt(index);
      if (inString) {
        repaired.append(current);
        if (escaped) {
          escaped = false;
        } else if (current == '\\') {
          escaped = true;
        } else if (current == '"') {
          inString = false;
        }
        continue;
      }
      if (current == '"') {
        inString = true;
        repaired.append(current);
        continue;
      }
      if (current == ',') {
        int next = index + 1;
        while (next < json.length() && Character.isWhitespace(json.charAt(next))) next++;
        if (next < json.length() && (json.charAt(next) == ']' || json.charAt(next) == '}')) {
          continue;
        }
      }
      repaired.append(current);
    }
    return repaired.toString();
  }

  private String normalizeResolution(String value) {
    return clean(value, 10).toUpperCase(Locale.ROOT);
  }

  private String allowedOrDefault(String value, Set<String> allowed, String fallback) {
    String cleaned = clean(value, 80);
    return allowed.contains(cleaned) ? cleaned : fallback;
  }

  private int clampCount(Integer count) {
    int value = count == null ? 1 : count;
    return Math.max(1, Math.min(4, value));
  }

  private String clean(String value, int maxLength) {
    if (value == null) return "";
    String cleaned = value.trim();
    return cleaned.length() > maxLength ? cleaned.substring(0, maxLength) : cleaned;
  }

  private long number(Double value) {
    return value == null || !Double.isFinite(value) ? 0 : Math.round(value);
  }

  private record ParsedPlan(String summary, List<CanvasAgentDtos.PlanStep> steps) {}

  private record ParsedChat(
      String reply,
      String draftPrompt,
      List<String> draftPrompts,
      List<String> referenceLayerIds,
      String imageModel,
      String ratio,
      String resolution,
      int count,
      boolean readyToGenerate,
      boolean valid) {}
}
