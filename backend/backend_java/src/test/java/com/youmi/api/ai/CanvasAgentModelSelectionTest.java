package com.youmi.api.ai;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import com.youmi.api.image.ModelApiKeyDtos;
import com.youmi.api.image.ModelApiKeyService;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class CanvasAgentModelSelectionTest {
  private final AgentChatClient legacy = mock(AgentChatClient.class);
  private final GemAgentClient gem = mock(GemAgentClient.class);
  private final ObjectMapper mapper = new ObjectMapper();
  private final CanvasAgentService service = new CanvasAgentService(mapper, legacy, gem);
  private static final String REPLY = "{\"reply\":\"ok\",\"draftPrompts\":[],\"readyToGenerate\":false}";

  @Test void selectedGemUsesImagesHistoryAndNeverCallsLegacy() throws Exception {
    when(gem.complete(anyString(), anyString(), anyList(), anyDouble(), eq(true)))
        .thenReturn(new AiChatDtos.CompletionResult("lk888", GemAgentClient.MODEL, REPLY));
    var request = mapper.readValue("""
        {"canvasId":"canvas-1","instruction":"question","agentModel":"gem-3.8-flash",
         "history":[{"role":"user","content":"earlier question"}],
         "layers":[{"id":"image-1","type":"image","url":"https://assets.example/reference.png"}],
         "referenceLayerIds":["image-1"],"model":"banana2"}
        """, CanvasAgentDtos.ChatRequest.class);
    var response = service.chat(request);
    assertEquals(GemAgentClient.MODEL, response.model());
    assertEquals("banana2", response.imageModel());
    verify(gem).complete(anyString(), contains("earlier question"), eq(List.of("https://assets.example/reference.png")), eq(0.2), eq(true));
    verifyNoInteractions(legacy);
  }

  @Test void jsonRepairStaysOnSelectedModel() throws Exception {
    when(gem.complete(anyString(), anyString(), anyList(), anyDouble(), eq(true)))
        .thenReturn(new AiChatDtos.CompletionResult("lk888", GemAgentClient.MODEL, "invalid"))
        .thenReturn(new AiChatDtos.CompletionResult("lk888", GemAgentClient.MODEL, REPLY));
    var request = mapper.readValue("{\"instruction\":\"帮我分析窗帘的卖点\",\"agentModel\":\"gem-3.8-flash\"}", CanvasAgentDtos.ChatRequest.class);
    assertEquals("ok", service.chat(request).reply());
    verify(gem, times(2)).complete(anyString(), anyString(), anyList(), anyDouble(), eq(true));
    verifyNoInteractions(legacy);
  }

  @Test void enhancementUsesGemPlainTextAndDoesNotReplaceDefault() throws Exception {
    when(gem.complete(anyString(), anyString(), anyList(), eq(0.3), eq(false)))
        .thenReturn(new AiChatDtos.CompletionResult("lk888", GemAgentClient.MODEL, "enhanced"));
    var response = service.enhancePrompt(new CanvasAgentDtos.EnhancePromptRequest("canvas-1", "conv-1", "prompt", GemAgentClient.MODEL));
    assertEquals("enhanced", response.prompt());
    verifyNoInteractions(legacy);
    when(legacy.isConfigured()).thenReturn(true);
    when(legacy.completeCanvasAgent(anyList(), anyDouble())).thenReturn(new AiChatDtos.CompletionResult("teamorouter", "old-model", "old result"));
    assertEquals("old-model", service.enhancePrompt(new CanvasAgentDtos.EnhancePromptRequest("prompt")).model());
    verify(legacy).completeCanvasAgent(anyList(), eq(0.3));
  }

  @Test void missingGemKeyDoesNotFallbackToLegacy() throws Exception {
    when(gem.complete(anyString(), anyString(), anyList(), anyDouble(), anyBoolean()))
        .thenThrow(new ApiException(503, "missing key"));
    assertThrows(ApiException.class, () -> service.enhancePrompt(
        new CanvasAgentDtos.EnhancePromptRequest("", "", "prompt", GemAgentClient.MODEL)));
    verifyNoInteractions(legacy);
  }

  @Test void listsModelsWithoutExposingCredentialsAndRejectsUnknownSelection() throws Exception {
    when(legacy.model()).thenReturn("gpt-5.6-luna");
    when(legacy.isConfigured()).thenReturn(true);
    var options = service.models();
    assertEquals(List.of("default", GemAgentClient.MODEL), options.stream().map(CanvasAgentDtos.AgentModelOption::value).toList());
    assertFalse(options.get(1).configured());
    assertThrows(ApiException.class, () -> service.enhancePrompt(
        new CanvasAgentDtos.EnhancePromptRequest("", "", "prompt", "untrusted-model")));
    verify(gem).isConfigured();
    verify(gem, never()).complete(anyString(), anyString(), anyList(), anyDouble(), anyBoolean());
  }

  @Test void defaultConversationAndReasoningUsePreferredDatabaseCredential() throws Exception {
    var keys = mock(ModelApiKeyService.class);
    var credential = new ModelApiKeyService.ResolvedModelApiKey(
        19, "database-agent", "database-router", "https://models.example.test/v1",
        "/chat/completions", "", "database-key", java.util.Map.of());
    when(keys.preferredEnabledModel(
        ModelApiKeyService.MODEL_TYPE_VISION_REASONING, CanvasAgentService.CANVAS_AGENT_FEATURE))
        .thenReturn(Optional.of(credential));
    when(keys.enabledModelOptions(
        ModelApiKeyService.MODEL_TYPE_VISION_REASONING, CanvasAgentService.CANVAS_AGENT_FEATURE))
        .thenReturn(List.of(new ModelApiKeyDtos.ModelOption(
            "database-agent", "数据库 Agent", "database-router")));
    when(legacy.completeConfiguredModel(
        eq(credential), anyString(), anyString(), anyList(), eq(0.2)))
        .thenReturn(new AiChatDtos.CompletionResult("database-router", "database-agent", REPLY));
    when(legacy.completeConfiguredModel(
        eq(credential), anyString(), anyString(), anyList(), eq(0.3)))
        .thenReturn(new AiChatDtos.CompletionResult("database-router", "database-agent", "enhanced"));
    var databaseService = new CanvasAgentService(mapper, legacy, gem, keys);

    var response = databaseService.chat(mapper.readValue(
        "{\"instruction\":\"帮我分析窗帘的卖点\",\"agentModel\":\"default\"}",
        CanvasAgentDtos.ChatRequest.class));
    assertEquals("database-agent", response.model());
    assertEquals("enhanced", databaseService.enhancePrompt(
        new CanvasAgentDtos.EnhancePromptRequest("prompt")).prompt());
    var options = databaseService.models();
    assertEquals("数据库默认 · database-agent", options.get(0).label());
    assertTrue(options.get(0).configured());
    assertEquals(List.of("default", "database-agent"),
        options.stream().map(CanvasAgentDtos.AgentModelOption::value).toList());
    verify(legacy, never()).completeCanvasAgent(anyList(), anyDouble());
    verify(legacy, never()).completeCanvasAgentVision(
        anyString(), anyString(), anyList(), anyDouble());
    verifyNoInteractions(gem);
  }

  @Test void databaseConversationStreamsOnlyTheUserVisibleReplyField() throws Exception {
    var keys = mock(ModelApiKeyService.class);
    var credential = new ModelApiKeyService.ResolvedModelApiKey(
        19, "database-agent", "database-router", "https://models.example.test/v1",
        "/chat/completions", "", "database-key", java.util.Map.of());
    when(keys.preferredEnabledModel(
        ModelApiKeyService.MODEL_TYPE_VISION_REASONING, CanvasAgentService.CANVAS_AGENT_FEATURE))
        .thenReturn(Optional.of(credential));
    String streamedJson = "{\"thinkingSummary\":\"已核对需求\",\"reply\":\"你好\",\"draftPrompts\":[],\"readyToGenerate\":false}";
    doAnswer(invocation -> {
      @SuppressWarnings("unchecked")
      java.util.function.Consumer<String> consumer = invocation.getArgument(8);
      consumer.accept("{\"thinkingSummary\":\"已核");
      consumer.accept("对需求\",\"reply\":\"你");
      consumer.accept("好\",\"draftPrompts\":[],\"readyToGenerate\":false}");
      return new AiChatDtos.CompletionResult("database-router", "database-agent", streamedJson);
    }).when(legacy).completeConfiguredModelStream(
        eq(credential), anyString(), anyString(), anyList(), eq(0.2),
        eq("canvas-agent"), eq("dropdown"), isNull(), any());
    var databaseService = new CanvasAgentService(mapper, legacy, gem, keys);
    List<String> replyDeltas = new java.util.ArrayList<>();
    List<String> thinkingDeltas = new java.util.ArrayList<>();

    var response = databaseService.chatStream(
        mapper.readValue("{\"instruction\":\"帮我分析窗帘的卖点\",\"agentModel\":\"default\"}",
            CanvasAgentDtos.ChatRequest.class),
        thinkingDeltas::add,
        replyDeltas::add);

    assertEquals("你好", response.reply());
    assertEquals(List.of("已核", "对需求"), thinkingDeltas);
    assertEquals(List.of("你", "好"), replyDeltas);
    verify(legacy).completeConfiguredModelStream(
        eq(credential), anyString(), anyString(), anyList(), eq(0.2),
        eq("canvas-agent"), eq("dropdown"), isNull(), any());
    verifyNoInteractions(gem);
  }

  @Test void defaultAgentNeverFallsBackToEnvironmentWhenDatabaseHasNoEnabledModel() throws Exception {
    var keys = mock(ModelApiKeyService.class);
    when(keys.preferredEnabledModel(
        ModelApiKeyService.MODEL_TYPE_VISION_REASONING, CanvasAgentService.CANVAS_AGENT_FEATURE))
        .thenReturn(Optional.empty());
    var databaseService = new CanvasAgentService(mapper, legacy, gem, keys);

    ApiException failure = assertThrows(ApiException.class, () -> databaseService.enhancePrompt(
        new CanvasAgentDtos.EnhancePromptRequest("prompt")));
    assertEquals(503, failure.getCode());
    assertTrue(failure.getMessage().contains("数据库"));
    verify(legacy, never()).completeCanvasAgent(anyList(), anyDouble());
    verifyNoInteractions(gem);
  }
}
