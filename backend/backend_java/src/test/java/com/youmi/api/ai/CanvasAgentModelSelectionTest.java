package com.youmi.api.ai;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import java.util.List;
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
    var request = mapper.readValue("{\"instruction\":\"hello\",\"agentModel\":\"gem-3.8-flash\"}", CanvasAgentDtos.ChatRequest.class);
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
    when(legacy.complete(anyList(), anyDouble())).thenReturn(new AiChatDtos.CompletionResult("teamorouter", "old-model", "old result"));
    assertEquals("old-model", service.enhancePrompt(new CanvasAgentDtos.EnhancePromptRequest("prompt")).model());
    verify(legacy).complete(anyList(), eq(0.3));
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
}
