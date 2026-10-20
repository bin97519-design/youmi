package com.youmi.api.ai;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class CanvasAgentScriptBasisTest {
  private final ObjectMapper mapper = new ObjectMapper();
  private final AgentChatClient client = mock(AgentChatClient.class);
  private final CanvasAgentService service = new CanvasAgentService(mapper, client);
  private static final String VIDEO = """
      {"reply":"已根据历史床垫整理好15秒商品主图视频稿。","generationType":"video",
       "durationSeconds":15,"draftPrompts":["# 床垫15秒脚本\\n0-5秒：卧室全景，5-15秒：商品细节。"],
       "referenceLayerIds":["historical","chosen","unselected"],"readyToGenerate":true}
      """;

  private void modelResponse(String response) throws Exception {
    when(client.isConfigured()).thenReturn(true);
    when(client.completeCanvasAgent(anyList(), anyDouble()))
        .thenReturn(new AiChatDtos.CompletionResult("test", "test", response));
    when(client.completeCanvasAgentVision(anyString(), anyString(), anyList(), anyDouble()))
        .thenReturn(new AiChatDtos.CompletionResult("test", "test", response));
  }

  private CanvasAgentDtos.ChatRequest request(String mode, String instruction,
      List<CanvasAgentDtos.LayerContext> layers, List<String> references) {
    return new CanvasAgentDtos.ChatRequest("canvas", instruction,
        List.of(new CanvasAgentDtos.ChatMessage("user", "床垫商品主图视频，15秒，快节奏")),
        layers, List.of(), references, "banana2", "16:9", "2K", 1, List.of("banana2"),
        "conversation", null, null, null, mode == null ? null : new CanvasAgentDtos.ScriptBriefContext(
            mode, List.of(new CanvasAgentDtos.ScriptReferenceCandidate(
                "historical", "在树下.jpg", "product"))));
  }

  private CanvasAgentDtos.LayerContext image(String id, String url) {
    return new CanvasAgentDtos.LayerContext(id, id + ".jpg", "image", url,
        1024.0, 1024.0, 0.0, 0.0);
  }

  @Test void unconfirmedBasisCannotTurnHistoricalDescriptionIntoAProductScript() throws Exception {
    modelResponse(VIDEO);
    var response = service.chat(request("unconfirmed", "帮我写视频脚本", List.of(), List.of()));
    assertEquals("video", response.generationType());
    assertEquals(15, response.durationSeconds());
    assertFalse(response.readyToGenerate());
    assertTrue(response.draftPrompts().isEmpty());
    assertEquals("", response.draftPrompt());
    assertTrue(response.referenceLayerIds().isEmpty());
    assertEquals(1, response.questions().size());
    var question = response.questions().get(0);
    assertEquals("script_source", question.kind());
    assertTrue(question.question().contains("在树下.jpg"));
    assertEquals(List.of("沿用历史商品图", "上传或选择其他商品图", "仅根据文字策划"), question.options());
    assertTrue(response.reply().contains("已确认的用途、成片时长"));
    verify(client, never()).completeCanvasAgentVision(anyString(), anyString(), anyList(), anyDouble());
  }

  @Test void historicalMetadataIsNotAnImageAndNamesAreOnlyOfferedForExplicitSelection() throws Exception {
    modelResponse(VIDEO);
    service.chat(request("unconfirmed", "帮我写视频脚本", List.of(), List.of()));
    var messages = ArgumentCaptor.forClass(List.class);
    verify(client).completeCanvasAgent(messages.capture(), anyDouble());
    String prompt = ((AiChatDtos.Message) messages.getValue().get(1)).content();
    assertTrue(prompt.contains("sourceMode=unconfirmed"));
    assertTrue(prompt.contains("在树下.jpg"));
    assertTrue(prompt.contains("不代表图片已读、外观已校准或素材已绑定"));
    assertTrue(prompt.contains("\"referenceRole\":\"product\""));
    assertFalse(prompt.contains("\"url\""));
    assertTrue(prompt.contains("床垫商品主图视频，15秒，快节奏"));
    String system = ((AiChatDtos.Message) messages.getValue().get(0)).content();
    assertTrue(system.contains("kind=\"script_source\""));
    assertTrue(system.contains("核心卖点仍需可见外观或用户确认资料支持"));
    assertTrue(system.contains("原创脚本不强制参考视频"));
  }

  @Test void claimedHistoryUploadOrCurrentStillRequiresActuallySubmittedUsableImages() throws Exception {
    modelResponse(VIDEO);
    for (String mode : List.of("history", "upload", "current")) {
      var response = service.chat(request(mode, "继续写15秒脚本",
          List.of(image("chosen", "blob:expired"), image("unselected", "https://example.test/other.jpg")),
          List.of("chosen", "missing")));
      assertEquals("script_source", response.questions().get(0).kind(), mode);
      assertTrue(response.draftPrompts().isEmpty(), mode);
      assertFalse(response.readyToGenerate(), mode);
    }
  }

  @Test void explicitReferenceIsReadAndUnselectedCanvasLayersNeverBecomeReferences() throws Exception {
    modelResponse(VIDEO);
    var response = service.chat(request("history", "沿用选中的商品图写15秒脚本",
        List.of(image("chosen", "https://example.test/chosen.jpg"),
            image("unselected", "https://example.test/other.jpg")), List.of("chosen")));
    assertTrue(response.questions().isEmpty());
    assertFalse(response.draftPrompts().isEmpty());
    assertTrue(response.readyToGenerate());
    assertEquals(List.of("chosen"), response.referenceLayerIds());
    verify(client).completeCanvasAgentVision(anyString(), contains("实际随请求提交的参考图层ID=[chosen]"),
        eq(List.of("https://example.test/chosen.jpg")), eq(0.2));
  }

  @Test void authoritativeTextChoiceClearsEvenResidualSubmittedImageIdsAndUrls() throws Exception {
    modelResponse(VIDEO);
    var response = service.chat(request("text", "继续写15秒脚本",
        List.of(image("chosen", "https://example.test/stale.jpg")), List.of("chosen")));
    assertTrue(response.questions().isEmpty());
    assertFalse(response.draftPrompts().isEmpty());
    assertTrue(response.referenceLayerIds().isEmpty());
    var messages = ArgumentCaptor.forClass(List.class);
    verify(client).completeCanvasAgent(messages.capture(), eq(0.2));
    String prompt = ((AiChatDtos.Message) messages.getValue().get(1)).content();
    assertTrue(prompt.contains("sourceMode=text"));
    assertTrue(prompt.contains("当前参考图层ID：[]"));
    assertTrue(prompt.contains("说明未按原图校准"));
    assertFalse(prompt.contains("https://example.test/stale.jpg"));
    verify(client, never()).completeCanvasAgentVision(anyString(), anyString(), anyList(), anyDouble());
  }

  @Test void documentsAndAudioDoNotMasqueradeAsProductImagesInTheTypedScriptProtocol() throws Exception {
    modelResponse(VIDEO);
    var attachments = List.of(
        new CanvasAgentDtos.LayerContext("brief", "商品资料.pdf", "file",
            "https://example.test/brief.pdf", null, null, null, null),
        new CanvasAgentDtos.LayerContext("voice", "参考口播.mp3", "audio",
            "https://example.test/voice.mp3", null, null, null, null));
    for (String mode : List.of("unconfirmed", "current", "history", "upload")) {
      var response = service.chat(request(mode, "帮我写商品视频脚本", attachments, List.of("brief", "voice")));
      assertEquals("script_source", response.questions().get(0).kind(), mode);
      assertTrue(response.referenceLayerIds().isEmpty(), mode);
      assertTrue(response.draftPrompts().isEmpty(), mode);
      assertFalse(response.readyToGenerate(), mode);
    }
    verify(client, never()).completeCanvasAgentVision(anyString(), anyString(), anyList(), anyDouble());
  }

  @Test void onlyExplicitActualImagesReachVisionWhenMixedWithDocumentsAndAudio() throws Exception {
    modelResponse(VIDEO);
    var response = service.chat(request("current", "根据这张商品图和已确认文字写视频脚本",
        List.of(image("chosen", "https://example.test/chosen.jpg"),
            new CanvasAgentDtos.LayerContext("brief", "商品资料.pdf", "file",
                "https://example.test/brief.pdf", null, null, null, null),
            new CanvasAgentDtos.LayerContext("voice", "参考口播.mp3", "audio",
                "https://example.test/voice.mp3", null, null, null, null)),
        List.of("chosen", "brief", "voice")));
    assertTrue(response.questions().isEmpty());
    assertEquals(List.of("chosen"), response.referenceLayerIds());
    verify(client).completeCanvasAgentVision(anyString(), anyString(),
        eq(List.of("https://example.test/chosen.jpg")), eq(0.2));
  }

  @Test void textBasisRetainsDocumentMetadataButNeverSendsDocumentsOrStaleImagesToVision() throws Exception {
    modelResponse(VIDEO);
    var response = service.chat(request("text", "仅根据文字策划15秒床垫脚本，沿用已确认卖点",
        List.of(image("chosen", "https://example.test/stale.jpg"),
            new CanvasAgentDtos.LayerContext("brief", "商品资料.pdf", "file",
                "https://example.test/brief.pdf", null, null, null, null)), List.of("chosen", "brief")));
    assertTrue(response.questions().isEmpty());
    assertTrue(response.referenceLayerIds().isEmpty());
    var messages = ArgumentCaptor.forClass(List.class);
    verify(client).completeCanvasAgent(messages.capture(), eq(0.2));
    String prompt = ((AiChatDtos.Message) messages.getValue().get(1)).content();
    assertTrue(prompt.contains("商品资料.pdf"));
    assertTrue(prompt.contains("类型=file"));
    assertTrue(prompt.contains("当前参考图层ID：[]"));
    assertFalse(prompt.contains("https://example.test/brief.pdf"));
    assertFalse(prompt.contains("https://example.test/stale.jpg"));
    verify(client, never()).completeCanvasAgentVision(anyString(), anyString(), anyList(), anyDouble());
  }

  @Test void nullScriptContextPreservesLegacyLayerTypeConventions() throws Exception {
    modelResponse(VIDEO);
    var response = service.chat(request(null, "帮我写视频脚本",
        List.of(new CanvasAgentDtos.LayerContext("chosen", "旧画布素材", "reference",
            "https://example.test/legacy.jpg", null, null, null, null)), List.of("chosen")));
    assertTrue(response.questions().isEmpty());
    assertEquals(List.of("chosen"), response.referenceLayerIds());
    verify(client).completeCanvasAgentVision(anyString(), anyString(),
        eq(List.of("https://example.test/legacy.jpg")), eq(0.2));
  }

  @Test void explicitDeclarativeTextPlanningDoesNotRequireAnExtraSourceQuestion() throws Exception {
    modelResponse(VIDEO);
    for (String instruction : List.of("仅根据文字策划", "只按文字描述写床垫15秒脚本",
        "不需要参考图，直接按描述写15秒脚本")) {
      var response = service.chat(request("unconfirmed", instruction, List.of(), List.of()));
      assertTrue(response.questions().isEmpty(), instruction);
      assertFalse(response.draftPrompts().isEmpty(), instruction);
    }
  }

  @Test void latestTypedImageSourceOverridesOldTextOnlyWordsInAComposedClarificationBrief() throws Exception {
    modelResponse(VIDEO);
    for (String mode : List.of("history", "upload")) {
      var response = service.chat(request(mode,
          "原始需求：仅根据文字策划床垫视频脚本。此前选择纯文字；本轮用户已改为使用所选商品图，继续同一脚本。",
          List.of(image("chosen", "https://example.test/chosen.jpg")), List.of("chosen")));
      assertTrue(response.questions().isEmpty(), mode);
      assertEquals(List.of("chosen"), response.referenceLayerIds(), mode);
    }
    verify(client, times(2)).completeCanvasAgentVision(anyString(), contains("以本轮明确提交的真实附件为商品外观依据"),
        eq(List.of("https://example.test/chosen.jpg")), eq(0.2));
  }

  @Test void questionAboutMissingReferencesNeverCountsAsTextOnlyPermission() throws Exception {
    modelResponse(VIDEO);
    for (String instruction : List.of("你这个不需要参考图吗", "不需要参考图吗？", "你是不是仅根据文字策划的",
        "要不要按文字描述写脚本？")) {
      var response = service.chat(request("unconfirmed", instruction, List.of(), List.of()));
      assertEquals("script_source", response.questions().get(0).kind(), instruction);
      assertTrue(response.draftPrompts().isEmpty(), instruction);
    }
  }

  @Test void ordinaryQuestionsCannotSkipProductBasisAndDiscardKnownDuration() throws Exception {
    modelResponse("""
        {"reply":"请问需要什么图？","generationType":"video","durationSeconds":15,
         "draftPrompts":["不应保留"],"readyToGenerate":true,
         "questions":[{"id":"image-source","question":"参考图还是纯文字生图？","kind":"image_source"}]}
        """);
    var response = service.chat(request("unconfirmed", "写视频脚本", List.of(), List.of()));
    assertEquals(1, response.questions().size());
    assertEquals("script_source", response.questions().get(0).kind());
    assertEquals(15, response.durationSeconds());
    assertFalse(response.questions().get(0).question().contains("时长"));
  }

  @Test void concreteScriptRequestCannotHideAnUnconfirmedScriptInPlainReply() throws Exception {
    modelResponse("""
        {"reply":"# 15秒床垫脚本\\n0-5秒展示床垫，5-15秒展示内部乳胶结构。"}
        """);
    for (String instruction : List.of("你能帮我做视频脚本吗", "写视频脚本", "帮我写个脚本")) {
      var response = service.chat(request("unconfirmed", instruction, List.of(), List.of()));
      assertEquals("video", response.generationType(), instruction);
      assertEquals("script_source", response.questions().get(0).kind(), instruction);
      assertFalse(response.reply().contains("乳胶结构"), instruction);
      assertTrue(response.draftPrompts().isEmpty(), instruction);
    }
  }

  @Test void ordinaryScriptKnowledgeQuestionDoesNotStartAProductCreationGate() throws Exception {
    modelResponse("{\"reply\":\"视频脚本通常需要明确目的、商品事实和创作方向。\"}");
    for (String instruction : List.of("视频脚本需要哪些资料", "你这个不需要参考图吗", "什么是电商视频脚本")) {
      var response = service.chat(request("unconfirmed", instruction, List.of(), List.of()));
      assertTrue(response.questions().isEmpty(), instruction);
    }
  }

  @Test void typedScriptQuestionsCanonicalizeOptionsWithoutNeedingModelChoices() throws Exception {
    modelResponse("""
        {"generationType":"video","questions":[{"id":"basis","question":"商品依据？",
         "kind":"script_source","options":"model returned wrong format"}]}
        """);
    var response = service.chat(request(null, "写脚本", List.of(), List.of()));
    assertEquals("script_source", response.questions().get(0).kind());
    assertEquals(List.of("沿用历史商品图", "上传或选择其他商品图", "仅根据文字策划"),
        response.questions().get(0).options());
    var restored = mapper.readValue("""
        {"id":"basis","question":"商品依据？","kind":"script_source","options":null}
        """, CanvasAgentDtos.ClarificationQuestion.class);
    assertEquals(response.questions().get(0).options(), restored.options());
  }

  @Test void legacyRequestsAndUnrelatedImageDraftsKeepPriorBehavior() throws Exception {
    modelResponse(VIDEO);
    var legacy = service.chat(request(null, "帮我写视频脚本", List.of(), List.of()));
    assertTrue(legacy.readyToGenerate());
    assertFalse(legacy.draftPrompts().isEmpty());
    assertTrue(legacy.questions().isEmpty());
    modelResponse("{\"generationType\":\"image\",\"draftPrompts\":[\"纯文字图片稿\"],\"readyToGenerate\":true}");
    var image = service.chat(request("unconfirmed", "纯文字生成床垫图片", List.of(), List.of()));
    assertTrue(image.questions().isEmpty());
    assertTrue(image.readyToGenerate());
  }

  @Test void noDraftNoQuestionVideoAnalysisDoesNotInventAnUploadGate() throws Exception {
    modelResponse("{\"generationType\":\"video\",\"reply\":\"可以先讨论脚本结构。\"}");
    var response = service.chat(request("unconfirmed", "什么是商品视频脚本", List.of(), List.of()));
    assertTrue(response.questions().isEmpty());
    assertTrue(response.draftPrompts().isEmpty());
  }

  @Test void newRequestJsonAndPreviousCanonicalConstructorStayCompatible() throws Exception {
    var request = mapper.readValue("""
        {"instruction":"写脚本","scriptBrief":{"sourceMode":"invalid","referenceCandidates":[
          {"id":"a","name":"床垫.jpg","referenceRole":"product"},null]}}
        """, CanvasAgentDtos.ChatRequest.class);
    assertEquals("unconfirmed", request.scriptBrief().sourceMode());
    assertEquals(1, request.scriptBrief().referenceCandidates().size());
    var old = new CanvasAgentDtos.ChatRequest("canvas", "写脚本", List.of(), List.of(), List.of(),
        List.of(), "banana2", "16:9", "2K", 1, List.of(), "conversation", null, null, null);
    assertNull(old.scriptBrief());
    assertNull(mapper.readValue("{\"instruction\":\"写脚本\"}", CanvasAgentDtos.ChatRequest.class).scriptBrief());
    String json = mapper.writeValueAsString(request.scriptBrief());
    assertFalse(json.contains("url"));
  }
}
