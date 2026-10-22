package com.youmi.api.ai;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.youmi.api.image.ModelApiKeyService;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** Exercises the semantic router through the real chat guards, with no external requests. */
class CanvasAgentTurnRoutingIntegrationTest {
  private final ObjectMapper mapper = new ObjectMapper();

  private AgentChatClient client() {
    var client = mock(AgentChatClient.class);
    when(client.isConfigured()).thenReturn(true);
    return client;
  }

  private CanvasAgentDtos.ChatRequest request(String instruction, String message,
      String taskType, String stage, String goal, List<CanvasAgentDtos.ChatMessage> history,
      List<CanvasAgentDtos.ClarificationQuestion> questions) {
    return new CanvasAgentDtos.ChatRequest("routing-canvas", instruction, history,
        List.of(), List.of(), List.of(), "", "16:9", "2K", 1, List.of(),
        "routing-conversation", "default", null, null, null,
        new CanvasAgentDtos.TurnContext(message, questions.isEmpty() ? "message" : "clarification",
            taskType, stage, goal, questions));
  }

  private CanvasAgentDtos.ChatRequest initial(String message) {
    return request(message, message, "unknown", "idle", "", List.of(), List.of());
  }

  private String route(String context, String relation, String turn, String task,
      String action) throws Exception {
    return mapper.writeValueAsString(Map.of("context", context, "relation", relation,
        "turn", turn, "task", task, "action", action));
  }

  private AiChatDtos.CompletionResult result(String json) {
    return new AiChatDtos.CompletionResult("test-provider", "test-reasoning-model", json);
  }

  private String draft(String type, String prompt, String reply) throws Exception {
    return mapper.writeValueAsString(Map.of("thinkingSummary", "正文模型提供的可见分析摘要",
        "reply", reply, "generationType", type, "durationSeconds", 15,
        "draftPrompts", List.of(prompt), "readyToGenerate", true,
        "referenceLayerIds", List.of()));
  }

  private void classify(AgentChatClient client, String route) throws Exception {
    when(client.completeCanvasAgentVision(anyString(), anyString(), eq(List.of()), eq(0.2), eq(2000)))
        .thenReturn(result(route));
  }

  private void write(AgentChatClient client, String json) throws Exception {
    when(client.completeCanvasAgent(anyList(), eq(0.2))).thenReturn(result(json));
  }

  private void assertNoDraft(CanvasAgentDtos.ChatResponse response) {
    assertFalse(response.readyToGenerate());
    assertEquals("", response.draftPrompt());
    assertEquals(List.of(), response.draftPrompts());
    assertEquals(List.of(), response.referenceLayerIds());
  }

  @Test void firstGreetingIsImmediateAndDoesNotCallAnyModel() throws Exception {
    var client = mock(AgentChatClient.class);
    var response = new CanvasAgentService(mapper, client).chat(initial("你好呀"));

    assertEquals("empty", response.routing().context());
    assertEquals("greeting", response.routing().turn());
    assertEquals("conversation", response.routing().task());
    assertEquals("reply", response.routing().action());
    assertEquals("idle", response.routing().stage());
    assertTrue(response.reply().contains("有米家居创作导演"));
    assertNoDraft(response);
    verifyNoInteractions(client);
  }

  @Test void greetingRetainsTheActualTaskAndEveryExistingStageWithoutCallingModels() throws Exception {
    for (String stage : List.of("awaiting_input", "discussing", "draft_ready", "running", "completed", "failed")) {
      var client = mock(AgentChatClient.class);
      var response = new CanvasAgentService(mapper, client).chat(request("你好", "你好",
          "video_script", stage, "窗帘15秒自然口播脚本", List.of(), List.of()));

      assertEquals("task", response.routing().context(), stage);
      assertEquals("continue", response.routing().relation(), stage);
      assertEquals("video_script", response.routing().task(), stage);
      assertEquals(stage, response.routing().stage());
      assertTrue(response.reply().contains("窗帘15秒自然口播脚本"));
      assertFalse(response.reply().contains("我可以帮你"));
      assertTrue(response.questions().isEmpty());
      assertNoDraft(response);
      verifyNoInteractions(client);
    }
  }

  @Test void bareContinueOrConfirmationWithoutAnObjectClarifiesWithoutCallingModels() throws Exception {
    for (String message : List.of("继续", "确认", "生成吧", "开始吧", "可以")) {
      var client = mock(AgentChatClient.class);
      var response = new CanvasAgentService(mapper, client).chat(initial(message));

      assertEquals("clarify", response.routing().action(), message);
      assertEquals("awaiting_input", response.routing().stage(), message);
      assertFalse(response.questions().isEmpty());
      assertNoDraft(response);
      verifyNoInteractions(client);
    }
  }

  @Test void legacyCallerKeepsItsSingleWriterCallAndDoesNotPayForClassification() throws Exception {
    var client = client();
    write(client, draft("image", "完整商品场景提示词", "方案已经整理。"));
    var legacy = new CanvasAgentDtos.ChatRequest("canvas", "做一张床垫卧室图", List.of(),
        List.of(), List.of(), List.of(), "banana2", "16:9", "2K", 1);
    var response = new CanvasAgentService(mapper, client).chat(legacy);

    assertNull(response.routing());
    assertEquals(List.of("完整商品场景提示词"), response.draftPrompts());
    verify(client, times(1)).completeCanvasAgent(anyList(), eq(0.2));
    verify(client, never()).completeCanvasAgentVision(anyString(), anyString(), anyList(), anyDouble(), anyInt());
  }

  @Test void nonGreetingCreationUsesARealClassifierThenASeparateWriter() throws Exception {
    var client = client();
    classify(client, route("empty", "standalone", "request", "video_script", "prepare_draft"));
    String script = "床垫15秒脚本\n分镜1（0秒-7秒）：手掌轻压床面。\n分镜2（7秒-15秒）：人物放松躺下。\n口播设计：今晚，躺下来就慢一点。";
    write(client, draft("video", script, "完整脚本已经整理。"));
    var response = new CanvasAgentService(mapper, client).chat(initial("帮我写床垫15秒脚本"));

    assertEquals("video_script", response.routing().task());
    assertEquals("draft_ready", response.routing().stage());
    assertEquals("video", response.generationType());
    assertEquals(List.of(script), response.draftPrompts());
    assertFalse(response.reply().contains("standalone"));
    var order = inOrder(client);
    order.verify(client).completeCanvasAgentVision(anyString(), anyString(), eq(List.of()), eq(0.2), eq(2000));
    order.verify(client).completeCanvasAgent(anyList(), eq(0.2));
    verify(client, times(1)).completeCanvasAgent(anyList(), eq(0.2));
  }

  @Test void ordinaryKnowledgeQuestionCannotBecomeMediaEvenWhenWriterReturnsReady() throws Exception {
    var client = client();
    classify(client, route("task", "continue", "question", "video_script", "reply"));
    write(client, draft("video", "不应成为执行草稿的错误脚本", "脚本中的运镜是摄影机的移动方式。"));
    var response = new CanvasAgentService(mapper, client).chat(request("运镜是什么意思？", "运镜是什么意思？",
        "video_script", "discussing", "床垫15秒短视频", List.of(), List.of()));

    assertEquals("question", response.routing().turn());
    assertEquals("reply", response.routing().action());
    assertTrue(response.reply().contains("摄影机"));
    assertNoDraft(response);
    verify(client).completeCanvasAgent(anyList(), eq(0.2));
  }

  @Test void analysisPositioningAndImagePlanningRemainNonExecutableDespiteWriterReadyFlag() throws Exception {
    for (String task : List.of("product_analysis", "product_positioning", "image_planning")) {
      var client = client();
      classify(client, route("empty", "standalone", "request", task, "reply"));
      write(client, draft("image", "仅供阅读的策划内容", "以下是本轮商品分析或视觉策划。"));
      var response = new CanvasAgentService(mapper, client).chat(initial("先帮我分析这款床垫的商品资料"));

      assertEquals(task, response.routing().task());
      assertEquals("reply", response.routing().action());
      assertEquals("completed", response.routing().stage());
      assertNoDraft(response);
      verify(client).completeCanvasAgent(anyList(), eq(0.2));
    }
  }

  @Test void planningOnlyMainImageRequestCanCollectMissingFactsWithoutEnteringImageGeneration() throws Exception {
    var client = client();
    // The fixture tests the selected route's writer contract and guards, not classifier accuracy.
    classify(client, route("empty", "standalone", "request", "image_planning", "clarify"));
    write(client, mapper.writeValueAsString(Map.of(
        "reply", "先补充会影响主图表达的商品依据和优先目标。",
        "generationType", "image", "readyToGenerate", true,
        "draftPrompts", List.of("不应提前成为媒体草稿的内容"),
        "questions", List.of(
            Map.of("id", "product-evidence", "kind", "choice", "question", "本次商品依据有哪些？",
                "options", List.of("我来补充商品资料", "先按已确认文字策划")),
            Map.of("id", "visual-goal", "kind", "choice", "question", "这张主图优先突出什么？",
                "options", List.of("完整商品外观", "已确认核心卖点", "使用场景"))))));

    var response = new CanvasAgentService(mapper, client).chat(
        initial("我想做一张商品主图，先帮我梳理需求，不要生成图片。"));

    assertEquals("image_planning", response.routing().task());
    assertEquals("clarify", response.routing().action());
    assertEquals("awaiting_input", response.routing().stage());
    assertEquals(List.of("product-evidence", "visual-goal"), response.questions().stream()
        .map(CanvasAgentDtos.ClarificationQuestion::id).toList());
    assertTrue(response.questions().stream().allMatch(question -> "choice".equals(question.kind())));
    assertNoDraft(response);
    var writerInput = ArgumentCaptor.forClass(List.class);
    verify(client).completeCanvasAgent(writerInput.capture(), eq(0.2));
    String sent = writerInput.getValue().toString();
    assertTrue(sent.contains("商品与事实依据"));
    assertTrue(sent.contains("尚未知的1至2项"));
    assertTrue(sent.contains("不固定四题或固定顺序"));
    assertTrue(sent.contains("不得借收集资料或交付方案进入生成确认流程"));
    assertTrue(sent.contains("只有应用提供可核验的真实状态"));
    assertTrue(sent.contains("不编造加载过程"));
  }

  @Test void completeImagePlanningStaysReadableAndRatioSuggestionsDoNotBecomeMediaDrafts() throws Exception {
    var client = client();
    classify(client, route("empty", "standalone", "request", "image_planning", "reply"));
    String brief = "创意简报：淘宝商品主图，以已确认的白色床面和黑色包边为身份约束；"
        + "纯净卧室场景，不加文字。建议方形画幅供后续确认，不代表已更改生成参数。";
    write(client, draft("image", brief, "图片策划已经整理，这里只交付文字方案。"));

    var response = new CanvasAgentService(mapper, client).chat(initial(
        "先策划一张淘宝床垫主图，白色床面、黑色包边是我确认的外观。纯净卧室场景，不要文字，不生成图片。"));

    assertEquals("image_planning", response.routing().task());
    assertEquals("reply", response.routing().action());
    assertTrue(response.questions().isEmpty());
    assertTrue(response.reply().contains(brief));
    assertNoDraft(response);
    var writerInput = ArgumentCaptor.forClass(List.class);
    verify(client).completeCanvasAgent(writerInput.capture(), eq(0.2));
    String sent = writerInput.getValue().toString();
    assertTrue(sent.contains("只作为创意简报建议，不是付费执行参数确认"));
    assertTrue(sent.contains("不修改界面参数"));
    assertTrue(sent.contains("资料足够就交付简洁完整的创意简报或逐图方案"));
  }

  @Test void contentApprovalWithAnExplicitNoMediaBoundaryRepliesWithoutAnExecutionDraft() throws Exception {
    var client = client();
    classify(client, route("task", "continue", "confirmation", "video_script", "reply"));
    write(client, mapper.writeValueAsString(Map.of("reply", "已确认这版脚本内容，先保留原稿，不生成图片或视频。",
        "generationType", "video", "draftPrompts", List.of(), "readyToGenerate", false)));
    String message = "这版脚本内容确认，先保留着。今天不要生成任何图片或视频，也不要重复出稿。";

    var response = new CanvasAgentService(mapper, client).chat(request(message, message,
        "video_script", "draft_ready", "床垫15秒商品脚本",
        List.of(new CanvasAgentDtos.ChatMessage("assistant", "已有完整脚本，等待内容反馈。")), List.of()));

    assertEquals("confirmation", response.routing().turn());
    assertEquals("reply", response.routing().action());
    assertEquals("video_script", response.routing().task());
    assertTrue(response.questions().isEmpty());
    assertNoDraft(response);
    var writerInput = ArgumentCaptor.forClass(List.class);
    verify(client).completeCanvasAgent(writerInput.capture(), eq(0.2));
    String sent = writerInput.getValue().toString();
    assertTrue(sent.contains("只回应内容确认并保留该限制"));
    assertTrue(sent.contains("不引导生成确认、不改参数、不重发稿件"));
  }

  @Test void removingVoiceoverWithoutCancellingTheTaskKeepsTheWholeRevisedTextScript() throws Exception {
    var client = client();
    classify(client, route("task", "continue", "revision", "video_script", "prepare_draft"));
    String revisedScript = "床垫15秒脚本：0–6秒展示完整商品，6–12秒手掌按压，12–15秒完整商品定帧。"
        + "保留原字幕和背景音乐，无口播；白色床面和黑色包边保持不变。";
    write(client, draft("video", revisedScript, "仅移除口播，保留其他已确认安排，以下为完整修订脚本。"));
    String message = "取消口播，不是取消这个任务；保留字幕和背景音乐，其余不变，只修改脚本文字。";
    String facts = "白色床面、黑色包边；15秒，字幕和背景音乐保留。";

    var response = new CanvasAgentService(mapper, client).chat(request(message, message,
        "video_script", "draft_ready", "床垫15秒商品脚本",
        List.of(new CanvasAgentDtos.ChatMessage("user", facts)), List.of()));

    assertEquals("revision", response.routing().turn());
    assertEquals("continue", response.routing().relation());
    assertEquals("video_script", response.routing().task());
    assertEquals("draft_ready", response.routing().stage());
    assertEquals(List.of(revisedScript), response.draftPrompts());
    assertEquals(15, response.durationSeconds());
    assertTrue(response.questions().isEmpty());
    var writerInput = ArgumentCaptor.forClass(List.class);
    verify(client).completeCanvasAgent(writerInput.capture(), eq(0.2));
    String sent = writerInput.getValue().toString();
    assertTrue(sent.contains(message));
    assertTrue(sent.contains(facts));
    assertTrue(sent.contains("不是提交视频任务"));
    verify(client, times(1)).completeCanvasAgentVision(anyString(), anyString(), eq(List.of()), eq(0.2), eq(2000));
  }

  @Test void classificationUsesTheRawLatestClarificationAnswerNotTheFlattenedOldInstruction() throws Exception {
    var client = client();
    classify(client, route("task", "continue", "answer", "video_script", "prepare_draft"));
    write(client, draft("video", "完整15秒无口播脚本", "已保留商品信息，改为纯画面版本。"));
    var response = new CanvasAgentService(mapper, client).chat(request(
        "原始需求：床垫商品主图。旧答案：纯文字生图、16:9。最新回答：不要口播。", "不要口播",
        "video_script", "awaiting_input", "床垫15秒视频脚本", List.of(),
        List.of(new CanvasAgentDtos.ClarificationQuestion("voice", "声音形式？", List.of("纯画面", "自然口播")))));

    var classificationInput = ArgumentCaptor.forClass(String.class);
    verify(client).completeCanvasAgentVision(anyString(), classificationInput.capture(), eq(List.of()), eq(0.2), eq(2000));
    String sent = classificationInput.getValue();
    var json = mapper.readTree(sent.substring(sent.indexOf('\n') + 1));
    assertEquals("不要口播", json.path("currentMessage").asText());
    assertEquals("clarification", json.path("source").asText());
    assertEquals("video_script", json.path("taskType").asText());
    assertFalse(sent.contains("原始需求：床垫商品主图"));
    assertEquals("continue", response.routing().relation());
    assertEquals(List.of("完整15秒无口播脚本"), response.draftPrompts());
  }

  @Test void explicitTaskSwitchDoesNotSendTheOldProductOrDraftHistoryToTheWriter() throws Exception {
    var client = client();
    classify(client, route("task", "switch", "request", "image_generation", "prepare_draft"));
    write(client, draft("image", "儿童床新方案", "新商品方案已经整理。"));
    String privateOldContext = "旧床垫商品与旧草稿唯一标记-DO-NOT-MIGRATE-7319";
    var response = new CanvasAgentService(mapper, client).chat(request("换一个任务，做儿童床的场景图", "换一个任务，做儿童床的场景图",
        "video_script", "draft_ready", privateOldContext,
        List.of(new CanvasAgentDtos.ChatMessage("user", privateOldContext),
            new CanvasAgentDtos.ChatMessage("assistant", "旧脚本-DO-NOT-MIGRATE-7319")), List.of()));

    var writerInput = ArgumentCaptor.forClass(List.class);
    verify(client).completeCanvasAgent(writerInput.capture(), eq(0.2));
    String written = writerInput.getValue().toString();
    assertTrue(written.contains("儿童床"));
    assertFalse(written.contains("DO-NOT-MIGRATE-7319"));
    verify(client).completeCanvasAgentVision(anyString(), contains("DO-NOT-MIGRATE-7319"), eq(List.of()), eq(0.2), eq(2000));
    assertEquals("switch", response.routing().relation());
    assertEquals("image_generation", response.routing().task());
  }

  @Test void taskRevisionKeepsConfirmedProductFactsAndWritesTheWholeRevisedScript() throws Exception {
    var client = client();
    classify(client, route("task", "continue", "revision", "video_script", "prepare_draft"));
    String fullScript = "完整30秒窗帘脚本，保留既有商品身份与卖点，取消口播。";
    var writer = (ObjectNode) mapper.readTree(draft("video", fullScript, "已改为30秒纯画面版本。"));
    writer.put("durationSeconds", 30);
    write(client, writer.toString());
    String knownProduct = "CONFIRMED-PRODUCT-5731：浅米色落地窗帘，用户确认可定制。";
    var response = new CanvasAgentService(mapper, client).chat(request("改成30秒，不要口播", "改成30秒，不要口播",
        "video_script", "draft_ready", "浅米色窗帘电商视频脚本",
        List.of(new CanvasAgentDtos.ChatMessage("user", knownProduct),
            new CanvasAgentDtos.ChatMessage("assistant", "前稿为15秒自然口播版本。")), List.of()));

    var writerInput = ArgumentCaptor.forClass(List.class);
    verify(client).completeCanvasAgent(writerInput.capture(), eq(0.2));
    String sent = writerInput.getValue().toString();
    assertTrue(sent.contains(knownProduct));
    assertTrue(sent.contains("改成30秒，不要口播"));
    assertEquals("revision", response.routing().turn());
    assertEquals("continue", response.routing().relation());
    assertEquals("draft_ready", response.routing().stage());
    assertEquals(30, response.durationSeconds());
    assertEquals(List.of(fullScript), response.draftPrompts());
  }

  @Test void clarificationRemainsAnInteractiveQuestionAndNeverProducesAnExecutionDraft() throws Exception {
    var client = client();
    classify(client, route("empty", "standalone", "request", "image_generation", "clarify"));
    write(client, mapper.writeValueAsString(Map.of("reply", "先确认本次图片来源。",
        "generationType", "image", "draftPrompts", List.of("错误的提前生图草稿"), "readyToGenerate", true,
        "questions", List.of(Map.of("id", "source", "kind", "image_source", "question", "依据参考图还是纯文字创作？",
            "options", List.of("模型不应改写系统选项"))))));
    var response = new CanvasAgentService(mapper, client).chat(initial("帮我生成一张床垫图"));

    assertEquals("clarify", response.routing().action());
    assertEquals("awaiting_input", response.routing().stage());
    assertEquals(1, response.questions().size());
    assertEquals("image_source", response.questions().get(0).kind());
    assertEquals(List.of("参考图生图", "纯文字生图"), response.questions().get(0).options());
    assertNoDraft(response);
  }

  @Test void clarificationWithoutWriterQuestionsSuppressesPrematureDraftAndAddsASafeQuestion() throws Exception {
    var client = client();
    classify(client, route("empty", "standalone", "request", "image_generation", "clarify"));
    String prematurePrompt = "PREMATURE-DRAFT-7723：未确认商品依据就提前生成的完整提示词";
    write(client, draft("image", prematurePrompt, "方案已经整理，可以立即开始。"));

    var response = new CanvasAgentService(mapper, client).chat(initial("帮我生成床垫的图片"));

    assertEquals("clarify", response.routing().action());
    assertEquals("awaiting_input", response.routing().stage());
    assertFalse(response.questions().isEmpty(), "Clarification must remain actionable when the writer omits questions.");
    assertFalse(response.questions().get(0).question().isBlank());
    assertFalse(response.reply().contains("PREMATURE-DRAFT-7723"));
    assertNoDraft(response);
  }

  @Test void textualCancellationOfARunningTaskDoesNotFalselyReportExternalCancellation() throws Exception {
    var client = client();
    classify(client, route("task", "continue", "cancel", "image_generation", "reply"));
    write(client, mapper.writeValueAsString(Map.of("reply", "这轮先不继续。已经运行的生成任务请在任务界面单独停止。",
        "draftPrompts", List.of(), "readyToGenerate", false)));

    var response = new CanvasAgentService(mapper, client).chat(request("先别做了", "先别做了",
        "image_generation", "running", "床垫卧室场景图", List.of(), List.of()));

    assertEquals("cancel", response.routing().turn());
    assertEquals("reply", response.routing().action());
    assertEquals("running", response.routing().stage(), "A chat intent is not evidence that the provider cancelled a job.");
    assertNoDraft(response);
  }

  @Test void taskSwitchDropsInheritedReferencesSelectionAndOldProductCandidatesBeforeWriting() throws Exception {
    var client = client();
    classify(client, route("task", "switch", "request", "image_generation", "prepare_draft"));
    write(client, mapper.writeValueAsString(Map.of("reply", "儿童床新方案已经整理。", "generationType", "image",
        "draftPrompts", List.of("儿童床的新场景方案"), "readyToGenerate", true,
        "referenceLayerIds", List.of("old-product-reference"))));
    var body = switchReferencesBody();
    // No currentReferenceLayerIds: all prior selections/references are inherited, not new attachments.
    var response = new CanvasAgentService(mapper, client).chat(mapper.treeToValue(body, CanvasAgentDtos.ChatRequest.class));

    var writerInput = ArgumentCaptor.forClass(List.class);
    verify(client).completeCanvasAgent(writerInput.capture(), eq(0.2));
    String sent = writerInput.getValue().toString();
    assertFalse(sent.contains("OLD-PRODUCT-MUST-NOT-MIGRATE-8881"));
    assertFalse(sent.contains("old-product-reference"));
    assertFalse(sent.contains("old-selected-reference"));
    assertFalse(sent.contains("old-history-candidate"));
    assertEquals(List.of(), response.referenceLayerIds());
    verify(client, never()).completeCanvasAgentVision(anyString(), anyString(), anyList(), anyDouble());
    assertEquals("switch", response.routing().relation());
  }

  @Test void taskSwitchOnlyRetainsNewAttachmentIdsThatAreAlsoRealSubmittedReferences() throws Exception {
    var client = client();
    classify(client, route("task", "switch", "request", "image_generation", "prepare_draft"));
    var body = switchReferencesBody();
    ((ObjectNode) body.path("turnContext")).putArray("currentReferenceLayerIds")
        .add("new-product-reference").add("unsubmitted-image").add("forged-reference");
    ((com.fasterxml.jackson.databind.node.ArrayNode) body.path("referenceLayerIds")).add("new-product-reference");
    var layers = (com.fasterxml.jackson.databind.node.ArrayNode) body.path("layers");
    layers.addObject().put("id", "new-product-reference").put("type", "image")
        .put("name", "本轮新上传的儿童床.jpg").put("url", "https://assets.example/new-child-bed.jpg");
    layers.addObject().put("id", "unsubmitted-image").put("type", "image")
        .put("name", "未提交的画布图片.jpg").put("url", "https://assets.example/not-submitted.jpg");
    when(client.completeCanvasAgentVision(anyString(), anyString(), eq(List.of("https://assets.example/new-child-bed.jpg")), eq(0.2)))
        .thenReturn(result(mapper.writeValueAsString(Map.of("reply", "已按本轮新图整理儿童床方案。",
            "generationType", "image", "draftPrompts", List.of("保留新儿童床身份的场景提示词"),
            "readyToGenerate", true,
            "referenceLayerIds", List.of("new-product-reference", "old-product-reference", "unsubmitted-image", "forged-reference")))));

    var response = new CanvasAgentService(mapper, client).chat(mapper.treeToValue(body, CanvasAgentDtos.ChatRequest.class));

    var writerInput = ArgumentCaptor.forClass(String.class);
    verify(client).completeCanvasAgentVision(anyString(), writerInput.capture(),
        eq(List.of("https://assets.example/new-child-bed.jpg")), eq(0.2));
    assertFalse(writerInput.getValue().contains("OLD-PRODUCT-MUST-NOT-MIGRATE-8881"));
    assertFalse(writerInput.getValue().contains("old-history-candidate"));
    assertFalse(writerInput.getValue().contains("old-product-reference"));
    assertEquals(List.of("new-product-reference"), response.referenceLayerIds());
    verify(client, never()).completeCanvasAgent(anyList(), anyDouble());
  }

  private ObjectNode switchReferencesBody() throws Exception {
    var body = (ObjectNode) mapper.valueToTree(request("换一个商品，做儿童床场景图", "换一个商品，做儿童床场景图",
        "image_generation", "draft_ready", "OLD-PRODUCT-MUST-NOT-MIGRATE-8881：旧床垫方案",
        List.of(new CanvasAgentDtos.ChatMessage("user", "OLD-PRODUCT-MUST-NOT-MIGRATE-8881：旧床垫资料")), List.of()));
    body.putArray("selectedLayerIds").add("old-selected-reference");
    body.putArray("referenceLayerIds").add("old-product-reference").add("old-selected-reference");
    var layers = body.putArray("layers");
    layers.addObject().put("id", "old-product-reference").put("type", "image")
        .put("name", "OLD-PRODUCT-MUST-NOT-MIGRATE-8881.jpg").put("url", "https://assets.example/old-mattress.jpg");
    layers.addObject().put("id", "old-selected-reference").put("type", "image")
        .put("name", "旧商品画布选中图.jpg").put("url", "https://assets.example/old-selection.jpg");
    body.set("scriptBrief", mapper.readTree("""
        {"sourceMode":"unconfirmed","referenceCandidates":[
          {"id":"old-history-candidate","name":"OLD-PRODUCT-MUST-NOT-MIGRATE-8881.jpg","referenceRole":"product"}]}
        """));
    return body;
  }

  @Test void invalidClassificationFailsClosedAndNeverInvokesTheWriter() throws Exception {
    for (String raw : List.of("not-json", "{}", "{\"reply\":\"错误的主回复\",\"readyToGenerate\":true}",
        "{\"context\":\"empty\",\"relation\":\"standalone\",\"turn\":\"request\",\"task\":\"image_generation\",\"action\":\"submit_paid_task\"}")) {
      var client = client();
      classify(client, raw);
      var response = new CanvasAgentService(mapper, client).chat(initial("为床垫做图"));

      assertEquals("clarify", response.routing().action(), raw);
      assertEquals("unclear", response.routing().turn(), raw);
      assertFalse(response.questions().isEmpty());
      assertNoDraft(response);
      verify(client, never()).completeCanvasAgent(anyList(), anyDouble());
      verify(client, times(1)).completeCanvasAgentVision(anyString(), anyString(), eq(List.of()), eq(0.2), eq(2000));
    }
  }

  @Test void textualConfirmationOnlyPointsAtTheExistingDraftAndCannotRecreateIt() throws Exception {
    var client = client();
    classify(client, route("task", "continue", "confirmation", "image_generation", "await_confirmation"));
    var response = new CanvasAgentService(mapper, client).chat(request("确认，开始生成", "确认，开始生成",
        "image_generation", "draft_ready", "床垫卧室场景图", List.of(), List.of()));

    assertEquals("await_confirmation", response.routing().action());
    assertEquals("draft_ready", response.routing().stage());
    assertFalse(response.reply().isBlank(), "The user must receive the real existing-interface next step.");
    assertTrue(response.questions().isEmpty());
    assertNoDraft(response);
    verify(client, never()).completeCanvasAgent(anyList(), anyDouble());
  }

  @Test void referenceAnalysisKeepsTheFullReadonlyPromptButNeverAuthorizesGeneration() throws Exception {
    var client = client();
    classify(client, route("empty", "standalone", "request", "reference_analysis", "prepare_draft"));
    String completePrompt = "原片连续动作与运镜还原细节。".repeat(350) + "最后一镜原片结束位置";
    var body = (ObjectNode) mapper.valueToTree(initial("分析这个视频并给我完整还原提示词"));
    body.set("referenceVideo", mapper.readTree("""
        {"url":"https://assets.example/source.mp4","name":"窗帘参考视频","duration":15,
         "audioSummary":"未提供原音轨","frames":[
           {"url":"https://assets.example/frame0.jpg","time":0.03},
           {"url":"https://assets.example/frame1.jpg","time":14.96}]}
        """));
    when(client.completeCanvasAgentVision(anyString(), anyString(),
        eq(List.of("https://assets.example/frame0.jpg", "https://assets.example/frame1.jpg")), eq(0.2), eq(16000)))
        .thenReturn(result(draft("video", completePrompt, "已按抽样关键帧整理只读还原提示词。")));

    var response = new CanvasAgentService(mapper, client).chat(mapper.treeToValue(body, CanvasAgentDtos.ChatRequest.class));
    assertEquals("reference_analysis", response.routing().task());
    assertEquals("draft_ready", response.routing().stage());
    assertEquals("video", response.generationType());
    assertEquals(List.of(completePrompt), response.draftPrompts());
    assertFalse(response.readyToGenerate());
    verify(client, never()).completeCanvasAgent(anyList(), anyDouble());
  }

  @Test void actualStreamDoesNotPublishWrongTypeContentBeforeTheRouteGuard() throws Exception {
    var client = mock(AgentChatClient.class);
    var keys = mock(ModelApiKeyService.class);
    var credential = new ModelApiKeyService.ResolvedModelApiKey(71, "test-reasoning-model", "test-provider",
        "https://unit-test.invalid/v1", "/chat/completions", "", "unit-test-only", Map.of());
    when(keys.resolve("test-reasoning-model", ModelApiKeyService.MODEL_TYPE_VISION_REASONING, "canvas-agent"))
        .thenReturn(Optional.of(credential));
    when(client.completeConfiguredModel(eq(credential), anyString(), anyString(), eq(List.of()), eq(0.2),
        eq("canvas-agent"), eq("dropdown"), eq(2000)))
        .thenReturn(result(route("empty", "standalone", "request", "video_script", "prepare_draft")));
    String wrongDraft = mapper.writeValueAsString(Map.of("thinkingSummary", "WRONG-WRITER-THINKING-7492",
        "reply", "WRONG-WRITER-REPLY-7492：图片节点已建好并正在生成。", "generationType", "image",
        "draftPrompts", List.of("错误类型的图片草稿"), "readyToGenerate", true));
    var visibleThinking = new StringBuilder();
    var visibleReply = new StringBuilder();
    when(client.completeConfiguredModelStream(eq(credential), anyString(), anyString(), eq(List.of()), eq(0.2),
        eq("canvas-agent"), eq("dropdown"), isNull(), any()))
        .thenAnswer(invocation -> {
          Consumer<String> providerDelta = invocation.getArgument(8);
          providerDelta.accept(wrongDraft.substring(0, wrongDraft.length() / 2));
          assertEquals("", visibleReply.toString(), "Unsafe provider text must be guarded before publication.");
          providerDelta.accept(wrongDraft.substring(wrongDraft.length() / 2));
          assertEquals("", visibleReply.toString());
          assertFalse(visibleThinking.toString().contains("WRONG-WRITER-THINKING-7492"));
          return result(wrongDraft);
        });
    var body = (ObjectNode) mapper.valueToTree(initial("帮我写一个床垫视频脚本"));
    body.put("agentModel", "test-reasoning-model");
    var service = new CanvasAgentService(mapper, client, mock(GemAgentClient.class), keys);
    var response = service.chatStream(mapper.treeToValue(body, CanvasAgentDtos.ChatRequest.class),
        visibleThinking::append, visibleReply::append);

    assertNoDraft(response);
    assertEquals(response.reply(), visibleReply.toString());
    assertFalse(visibleReply.toString().contains("WRONG-WRITER-REPLY-7492"));
    assertFalse(visibleThinking.toString().contains("WRONG-WRITER-THINKING-7492"));
    assertFalse(visibleReply.toString().contains("图片节点已建好"));
    verify(client).completeConfiguredModelStream(eq(credential), anyString(), anyString(), eq(List.of()), eq(0.2),
        eq("canvas-agent"), eq("dropdown"), isNull(), any());
  }

  @Test void invalidRoutingStreamNeverLeaksTheClassifierJsonOrCreatesAMediaDraft() throws Exception {
    var client = client();
    classify(client, "{\"reply\":\"CLASSIFIER-BODY-MUST-NOT-REACH-UI\",\"readyToGenerate\":true}");
    var thinking = new StringBuilder();
    var reply = new StringBuilder();
    var response = new CanvasAgentService(mapper, client).chatStream(initial("为床垫做图"), thinking::append, reply::append);

    assertNoDraft(response);
    assertEquals(response.reply(), reply.toString());
    assertFalse(reply.toString().contains("CLASSIFIER-BODY-MUST-NOT-REACH-UI"));
    assertFalse(thinking.toString().contains("CLASSIFIER-BODY-MUST-NOT-REACH-UI"));
    verify(client, never()).completeCanvasAgent(anyList(), anyDouble());
  }
}
