package com.youmi.api.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.image.ModelApiKeyService;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class CanvasAgentClarificationTest {
  private final ObjectMapper mapper = new ObjectMapper();

  @Test
  void serializesStructuredQuestionsAndKeepsLegacyResponseConstructionCompatible() throws Exception {
    var legacy = new CanvasAgentDtos.ChatResponse(
        "test", "test", "方案已整理", "", "完整提示词", List.of("完整提示词"), List.of(),
        "banana2", List.of("banana2"), "1:1", "2K", 1, true, "image", null);
    assertTrue(legacy.questions().isEmpty());
    assertTrue(legacy.readyToGenerate());
    assertTrue(mapper.readTree(mapper.writeValueAsString(legacy)).path("questions").isArray());

    var legacyJson = mapper.valueToTree(legacy);
    ((com.fasterxml.jackson.databind.node.ObjectNode) legacyJson).remove("questions");
    var restored = mapper.treeToValue(legacyJson, CanvasAgentDtos.ChatResponse.class);
    assertTrue(restored.questions().isEmpty());
    assertEquals(legacy.draftPrompts(), restored.draftPrompts());

    var response = chat(Map.of("questions", List.of(Map.of(
        "id", "image-purpose", "question", "本次图片主要用在哪里？",
        "options", List.of("商品主图", "家居场景图", "详情页卖点图")))));
    var json = mapper.readTree(mapper.writeValueAsString(response));
    assertEquals("image-purpose", json.path("questions").get(0).path("id").asText());
    assertEquals("本次图片主要用在哪里？", json.path("questions").get(0).path("question").asText());
    assertEquals("家居场景图", json.path("questions").get(0).path("options").get(1).asText());
    assertEquals("choice", json.path("questions").get(0).path("kind").asText());
  }

  @Test
  void typedImageQuestionsUseCanonicalOptionsAndPreserveUploadWithoutChoices() throws Exception {
    var response = chat(Map.of("readyToGenerate", true, "draftPrompts", List.of("不应生成"),
        "questions", List.of(
            Map.of("id", "source", "question", "根据参考图还是纯文字生图？", "kind", "image_source",
                "options", List.of("随意改写的图生图文案", "任意其他文案")),
            Map.of("id", "upload", "question", "请上传参考商品图片。", "kind", "image_upload"))));

    assertEquals(2, response.questions().size());
    assertEquals("image_source", response.questions().get(0).kind());
    assertEquals(List.of("参考图生图", "纯文字生图"), response.questions().get(0).options());
    assertEquals("image_upload", response.questions().get(1).kind());
    assertTrue(response.questions().get(1).options().isEmpty());
    assertTrue(response.draftPrompts().isEmpty());
    assertFalse(response.readyToGenerate());
    var json = mapper.readTree(mapper.writeValueAsString(response));
    assertEquals("image_upload", json.path("questions").get(1).path("kind").asText());
    assertTrue(json.path("questions").get(1).path("options").isEmpty());
  }

  @Test
  void questionConstructionAndLegacyJsonNormalizeTypedContracts() throws Exception {
    var legacy = new CanvasAgentDtos.ClarificationQuestion("old", "用途？", List.of("主图", "场景图"));
    assertEquals("choice", legacy.kind());
    var restored = mapper.readValue("""
        {"id":"old","question":"用途？","options":["主图","场景图"]}
        """, CanvasAgentDtos.ClarificationQuestion.class);
    assertEquals(legacy, restored);
    var source = new CanvasAgentDtos.ClarificationQuestion("source", "方式？", null, "image_source");
    assertEquals(List.of("参考图生图", "纯文字生图"), source.options());
    var upload = new CanvasAgentDtos.ClarificationQuestion(
        "upload", "请上传", List.of("跳过上传", "声称已上传"), "image_upload");
    assertTrue(upload.options().isEmpty());
    var unknown = new CanvasAgentDtos.ClarificationQuestion("unknown", "用途？", legacy.options(), "unknown");
    assertEquals("choice", unknown.kind());
  }

  @Test
  void unknownKindsKeepOrdinaryChoiceValidationAndTypedQuestionsIgnoreMalformedOptions() throws Exception {
    var raw = mapper.readTree("""
        [{"id":"bad","question":"无效普通题","kind":"not-supported","options":[]},
         {"id":"choice","question":"用途？","kind":"not-supported","options":["主图","场景图"]},
         {"id":"source","question":"生图方式？","kind":"image_source","options":"invalid"},
         {"id":"upload","question":"上传商品图","kind":"image_upload","options":["跳过"]}]
        """);
    var response = chat(Map.of("questions", raw));
    assertEquals(List.of("choice", "image_source", "image_upload"), response.questions().stream()
        .map(CanvasAgentDtos.ClarificationQuestion::kind).toList());
    assertEquals(List.of("主图", "场景图"), response.questions().get(0).options());
    assertEquals(List.of("参考图生图", "纯文字生图"), response.questions().get(1).options());
    assertTrue(response.questions().get(2).options().isEmpty());
  }

  @Test
  void imageWorkflowPromptRequiresExplicitModeRealUploadsAndParameterConfirmation() throws Exception {
    var client = mock(AgentChatClient.class);
    when(client.isConfigured()).thenReturn(true);
    when(client.completeCanvasAgent(anyList(), anyDouble())).thenReturn(
        new AiChatDtos.CompletionResult("test", "test", "{\"reply\":\"先确认本次生图方式。\"}"));
    new CanvasAgentService(mapper, client).chat(request());
    var sentMessages = ArgumentCaptor.forClass(List.class);
    verify(client).completeCanvasAgent(sentMessages.capture(), anyDouble());
    String system = ((AiChatDtos.Message) sentMessages.getValue().get(0)).content();
    String sent = sentMessages.getValue().toString();
    assertTrue(system.contains("kind=\"image_source\""));
    assertTrue(system.contains("kind=\"image_upload\""));
    assertTrue(system.contains("不能根据画布存在图片"));
    assertTrue(system.contains("不能把一句“已上传”当成真实素材"));
    assertTrue(system.contains("界面当前值或默认值不等于用户已确认"));
    assertTrue(system.contains("仅问候、分析或文字策划/视频脚本任务不强制"));
    assertTrue(system.contains("不能臆造模型选项"));
    assertTrue(system.contains("不使用普通questions询问这些执行参数"));
    assertTrue(system.contains("尚未选择执行模型不能阻止完整图片草稿交付"));
    assertTrue(system.contains("不得声称节点已创建、图片已生成"));
    assertTrue(system.contains("自动模式也必须由界面记录明确授权"));
    assertTrue(sent.contains("这些当前参数可能是界面默认值，不代表用户已经确认"));
    assertFalse(system.contains("用户或界面已提供的比例、数量、模型、分辨率等执行参数不重复追问"));
  }

  @Test
  void missingImageModelIsNotPresentedAsSelectedAndDoesNotDiscardReadyImageContent() throws Exception {
    var client = mock(AgentChatClient.class);
    when(client.isConfigured()).thenReturn(true);
    when(client.completeCanvasAgent(anyList(), anyDouble())).thenReturn(
        new AiChatDtos.CompletionResult("test", "test", """
            {"reply":"图片方案已整理，请在界面确认参数。","generationType":"image",
             "draftPrompts":["一张灰色床垫的卧室家居场景图，纯文字创作，不虚构材质性能。"],
             "model":"gpt-image-2","models":["gpt-image-2"],"readyToGenerate":true}
            """));
    var request = new CanvasAgentDtos.ChatRequest("canvas-1", "纯文字做一张灰色床垫卧室场景图",
        List.of(), List.of(), List.of(), List.of(), "", "16:9", "2K", 1);

    var response = new CanvasAgentService(mapper, client).chat(request);

    var sentMessages = ArgumentCaptor.forClass(List.class);
    verify(client).completeCanvasAgent(sentMessages.capture(), anyDouble());
    String userPrompt = ((AiChatDtos.Message) sentMessages.getValue().get(1)).content();
    assertTrue(userPrompt.contains("模型=未选择"));
    assertFalse(userPrompt.contains("banana2"));
    assertTrue(userPrompt.contains("由前端最终真实参数确认表单处理，不在questions中询问"));
    assertTrue(response.readyToGenerate());
    assertEquals(1, response.draftPrompts().size());
    // The compatibility response fallback is not a paid selection, and model-written keys
    // cannot replace actual user controls. The frontend must still collect real execution config.
    assertEquals(List.of("banana2"), response.imageModels());
  }

  @Test
  void explicitRequestImageModelRemainsAuthoritativeOverLanguageModelSuggestions() throws Exception {
    var client = mock(AgentChatClient.class);
    when(client.isConfigured()).thenReturn(true);
    when(client.completeCanvasAgent(anyList(), anyDouble())).thenReturn(
        new AiChatDtos.CompletionResult("test", "test", """
            {"reply":"图片方案已整理。","generationType":"image",
             "draftPrompts":["一张家居商品场景图。"],"model":"banana2",
             "models":["banana2","banana-pro"],"readyToGenerate":true}
            """));
    var request = new CanvasAgentDtos.ChatRequest("canvas-1", "纯文字做一张灰色床垫卧室场景图",
        List.of(), List.of(), List.of(), List.of(), "gpt-image-2", "16:9", "2K", 1);

    var response = new CanvasAgentService(mapper, client).chat(request);

    var sentMessages = ArgumentCaptor.forClass(List.class);
    verify(client).completeCanvasAgent(sentMessages.capture(), anyDouble());
    String userPrompt = ((AiChatDtos.Message) sentMessages.getValue().get(1)).content();
    assertTrue(userPrompt.contains("模型=[gpt-image-2]"));
    assertEquals("gpt-image-2", response.imageModel());
    assertEquals(List.of("gpt-image-2"), response.imageModels());
    assertTrue(response.readyToGenerate());
  }

  @Test
  void validQuestionsSuppressImageAndVideoDraftsDespiteContradictoryModelOutput() throws Exception {
    for (String type : List.of("image", "video")) {
      var response = chat(Map.of(
          "generationType", type, "durationSeconds", 15,
          "draftPrompt", "不应可提交的兼容草稿", "draftPrompts", List.of("不应可提交的完整草稿"),
          "readyToGenerate", true,
          "questions", List.of(Map.of("id", "product", "question", "这次要做哪款商品？",
              "options", List.of("窗帘", "床垫", "实木床", "儿童床")))));

      assertEquals(1, response.questions().size());
      assertEquals("", response.draftPrompt());
      assertTrue(response.draftPrompts().isEmpty());
      assertFalse(response.readyToGenerate());
      assertEquals(type, response.generationType());
      assertEquals("先确认下面几个关键点，我再继续。", response.reply());
    }
  }

  @Test
  void responseConstructorAlsoPreventsQuestionsAndGenerationFromCoexisting() {
    var question = new CanvasAgentDtos.ClarificationQuestion(
        "purpose", "图片的用途？", List.of("商品主图", "家居场景图"));
    var response = new CanvasAgentDtos.ChatResponse(
        "test", "test", "补充信息", "", "提示词", List.of("提示词"), List.of(),
        "banana2", List.of("banana2"), "1:1", "2K", 1, true, "image", null,
        List.of(question));

    assertEquals("", response.draftPrompt());
    assertTrue(response.draftPrompts().isEmpty());
    assertFalse(response.readyToGenerate());
  }

  @Test
  void normalizesQuestionBoundsAndAssignsDeterministicUniqueIds() throws Exception {
    var raw = List.of(
        Map.of("id", " question-2 ", "question", " 图片用途？ ",
            "options", List.of(" 商品主图 ", "商品主图", "", "家居场景图", "详情页卖点图",
                "视频关键帧", "品牌海报", "超出上限")),
        Map.of("id", "question-2", "question", " 使用空间？ ",
            "options", List.of("卧室", "客厅")),
        Map.of("question", "图".repeat(240), "options", List.of("选".repeat(140), "不加文案")),
        Map.of("id", "x".repeat(90), "question", "视觉方向？", "options", List.of("自然", "复古")),
        Map.of("id", "ignored", "question", "不应出现的第五个问题？", "options", List.of("一", "二")));
    var first = chat(Map.of("questions", raw));
    var second = chat(Map.of("questions", raw));

    assertEquals(first.questions(), second.questions());
    assertEquals(4, first.questions().size());
    assertEquals(List.of("question-2", "question-2-2", "question-3", "x".repeat(64)),
        first.questions().stream().map(CanvasAgentDtos.ClarificationQuestion::id).toList());
    assertEquals("图片用途？", first.questions().get(0).question());
    assertEquals(List.of("商品主图", "家居场景图", "详情页卖点图", "视频关键帧", "品牌海报"),
        first.questions().get(0).options());
    assertEquals(200, first.questions().get(2).question().length());
    assertEquals(100, first.questions().get(2).options().get(0).length());
  }

  @Test
  void skipsMalformedQuestionsWithoutCoercingValuesOrLosingValidQuestions() throws Exception {
    var raw = mapper.readTree("""
        [null, 12, "文字", {},
          {"question":" ","options":["一","二"]},
          {"question":123,"options":["一","二"]},
          {"question":"格式错误","options":"不是数组"},
          {"question":"答案重复","options":["相同","相同",null,12,{}]},
          {"id":42,"question":"图的用途？","options":[null,12,"主图",{},"场景图"]},
          {"id":"duplicate","question":"图的用途？","options":["详情页","海报"]}]
        """);
    var response = chat(Map.of("questions", raw));

    assertEquals(List.of(new CanvasAgentDtos.ClarificationQuestion(
        "question-9", "图的用途？", List.of("主图", "场景图"))), response.questions());
  }

  @Test
  void invalidOrAbsentQuestionsPreserveExistingDraftBehavior() throws Exception {
    List<Object> rawValues = List.of(
        "not-an-array", Map.of("question", "不是数组"), List.of(),
        List.of(Map.of("question", "只有一个有效选项", "options", List.of("唯一", "唯一"))));
    for (Object value : rawValues) {
      var response = chat(Map.of("draftPrompts", List.of("完整主图提示词"),
          "readyToGenerate", true, "questions", value));
      assertTrue(response.questions().isEmpty());
      assertEquals(List.of("完整主图提示词"), response.draftPrompts());
      assertTrue(response.readyToGenerate());
    }
    assertTrue(chat(Map.of("reply", "无需追问")).questions().isEmpty());
  }

  @Test
  void finalStructuredQuestionsDoNotChangeThinkingAndReplyStreaming() throws Exception {
    var keys = mock(ModelApiKeyService.class);
    var client = mock(AgentChatClient.class);
    var credential = new ModelApiKeyService.ResolvedModelApiKey(
        19, "database-agent", "database-router", "https://models.example.test/v1",
        "/chat/completions", "", "test-only", Map.of());
    when(keys.preferredEnabledModel(
        ModelApiKeyService.MODEL_TYPE_VISION_REASONING, CanvasAgentService.CANVAS_AGENT_FEATURE))
        .thenReturn(Optional.of(credential));
    List<String> chunks = List.of("{\"thinkingSummary\":\"已确认是", "生图需求\",\"reply\":\"请补充",
        "图片用途\",\"questions\":[{\"id\":\"purpose\",\"question\":\"图片用在哪里？\","
            + "\"options\":[\"主图\",\"场景图\"]}],\"readyToGenerate\":false}");
    doAnswer(invocation -> {
      Consumer<String> consumer = invocation.getArgument(8);
      chunks.forEach(consumer);
      return new AiChatDtos.CompletionResult("test", "test", String.join("", chunks));
    }).when(client).completeConfiguredModelStream(
        eq(credential), anyString(), anyString(), anyList(), eq(0.2),
        eq("canvas-agent"), eq("dropdown"), isNull(), any());
    var service = new CanvasAgentService(mapper, client, mock(GemAgentClient.class), keys);
    List<String> thinking = new ArrayList<>();
    List<String> replies = new ArrayList<>();

    var response = service.chatStream(request(), thinking::add, replies::add);

    assertEquals(List.of("已确认是", "生图需求"), thinking);
    assertEquals(List.of("请补充", "图片用途"), replies);
    assertEquals(1, response.questions().size());
    assertEquals("图片用在哪里？", response.questions().get(0).question());
    assertFalse(response.readyToGenerate());
  }

  private CanvasAgentDtos.ChatResponse chat(Map<String, ?> response) throws Exception {
    var client = mock(AgentChatClient.class);
    when(client.isConfigured()).thenReturn(true);
    when(client.completeCanvasAgent(anyList(), anyDouble())).thenReturn(
        new AiChatDtos.CompletionResult("test", "test", mapper.writeValueAsString(response)));
    return new CanvasAgentService(mapper, client).chat(request());
  }

  private CanvasAgentDtos.ChatRequest request() {
    return new CanvasAgentDtos.ChatRequest("canvas-1", "帮我生个图吧", List.of(), List.of(),
        List.of(), List.of(), "banana2", "1:1", "2K", 1);
  }
}
