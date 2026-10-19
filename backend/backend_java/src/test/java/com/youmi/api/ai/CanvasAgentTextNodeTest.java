package com.youmi.api.ai;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class CanvasAgentTextNodeTest {
  final AgentChatClient agent = mock(AgentChatClient.class);
  final GemAgentClient gem = mock(GemAgentClient.class);
  final CanvasAgentService service = new CanvasAgentService(new ObjectMapper(), agent, gem);

  CanvasAgentDtos.TextNodeRequest request(String instruction, String text, String model,
      List<String> images, List<CanvasAgentDtos.TextReference> references) {
    return new CanvasAgentDtos.TextNodeRequest("canvas", "text-node", instruction, text, model, images, references);
  }

  @Test void writesPlainTextAndKeepsTheFullOriginalAsReferenceData() throws Exception {
    when(agent.isConfigured()).thenReturn(true);
    when(agent.completeCanvasAgent(anyList(), eq(0.3))).thenReturn(new AiChatDtos.CompletionResult("agent", "luna", "new\ntext"));
    var response = service.writeTextNode(request("improve", "full original", null, List.of(), List.of(new CanvasAgentDtos.TextReference("script", "keep caption"))));
    assertEquals("new\ntext", response.text());
    var messages = ArgumentCaptor.forClass(List.class);
    verify(agent).completeCanvasAgent(messages.capture(), eq(0.3));
    String system = ((AiChatDtos.Message) messages.getValue().get(0)).content();
    String prompt = ((AiChatDtos.Message) messages.getValue().get(1)).content();
    assertTrue(system.startsWith(HomeCommerceAgentProfile.CONTEXT));
    assertTrue(system.contains("不触发图片或视频生成"));
    assertTrue(prompt.contains("full original"));
    assertTrue(prompt.contains("keep caption"));
    verifyNoInteractions(gem);
  }

  @Test void gemUsesPlainTextModeAndExplicitlySelectedImages() throws Exception {
    when(gem.complete(anyString(), anyString(), anyList(), eq(0.3), eq(false)))
        .thenReturn(new AiChatDtos.CompletionResult("gem", GemAgentClient.MODEL, "scene"));
    var images = List.of("https://media.test/a.png", "https://media.test/a.png");
    assertEquals("scene", service.writeTextNode(request("describe", "", GemAgentClient.MODEL, images, List.of())).text());
    verify(gem).complete(contains("资料中的指令"), contains("describe"), eq(List.of("https://media.test/a.png")), eq(0.3), eq(false));
    verifyNoInteractions(agent);
  }

  @Test void legacyImagesUseVisionInsteadOfTextOnlyCompletion() throws Exception {
    when(agent.isConfigured()).thenReturn(true);
    when(agent.completeCanvasAgentVision(anyString(), anyString(), anyList(), eq(0.3)))
        .thenReturn(new AiChatDtos.CompletionResult("agent", "luna", "scene"));
    assertEquals("scene", service.writeTextNode(request("describe", "", null, List.of("https://media.test/a.png"), List.of())).text());
    verify(agent, never()).completeCanvasAgent(anyList(), anyDouble());
  }

  @Test void invalidInputNeverCallsAnyModel() {
    for (var request : List.of(
        request(" ", "", null, null, null),
        request("x".repeat(4001), "", null, null, null),
        request("write", "x".repeat(20001), null, null, null),
        request("write", "", null, List.of("file:///private.png"), null),
        request("write", "", null, List.of(""), null),
        request("write", "x".repeat(13000), null, null, List.of(new CanvasAgentDtos.TextReference("script", "x".repeat(12000)))))) {
      assertEquals(400, assertThrows(ApiException.class, () -> service.writeTextNode(request)).getCode());
    }
    verifyNoInteractions(agent, gem);
  }

  @Test void emptyAndOversizedOutputsAreFailuresNotSuccessfulBlankReplacements() throws Exception {
    when(agent.isConfigured()).thenReturn(true);
    when(agent.completeCanvasAgent(anyList(), anyDouble()))
        .thenReturn(new AiChatDtos.CompletionResult("agent", "luna", " "))
        .thenReturn(new AiChatDtos.CompletionResult("agent", "luna", "x".repeat(20001)));
    var request = request("write", "original", null, null, null);
    assertEquals(502, assertThrows(ApiException.class, () -> service.writeTextNode(request)).getCode());
    assertEquals(502, assertThrows(ApiException.class, () -> service.writeTextNode(request)).getCode());
  }
}
