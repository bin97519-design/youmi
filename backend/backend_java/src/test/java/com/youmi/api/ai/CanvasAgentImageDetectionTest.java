package com.youmi.api.ai;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import com.youmi.api.image.ModelApiKeyService;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class CanvasAgentImageDetectionTest {
  private static final String IMAGE = "data:image/png;base64,dGVzdA==";
  private static final String RESULT = """
      {"elements":[{"object_name":"绿色窗帘","box_2d":[0.1,0.2,0.9,0.8]}]}
      """;
  private final AgentChatClient agent = mock(AgentChatClient.class);
  private final GemAgentClient gem = mock(GemAgentClient.class);
  private final CanvasAgentService service = new CanvasAgentService(new ObjectMapper(), agent, gem);

  @Test void fixedLunaCanUseStoredCredentialsWithoutChangingTheModel() throws Exception {
    var keys = mock(ModelApiKeyService.class);
    var credential = new ModelApiKeyService.ResolvedModelApiKey(9, "gpt-5.6-luna", "teamorouter",
        "https://configured.example/v1", "/chat/completions", "", "test-only", Map.of());
    when(keys.resolve("gpt-5.6-luna", ModelApiKeyService.MODEL_TYPE_VISION_REASONING, "canvas-layering"))
        .thenReturn(Optional.of(credential));
    when(agent.completeConfiguredModel(eq(credential), anyString(), anyString(), anyList(), eq(0.2),
        eq("canvas-layering"), eq("system_default")))
        .thenReturn(new AiChatDtos.CompletionResult("teamorouter", "gpt-5.6-luna", RESULT));
    var configuredService = new CanvasAgentService(new ObjectMapper(), agent, gem, keys);
    assertEquals("绿色窗帘", configuredService.detectImageElements(IMAGE).get(0).objectName());
    verify(keys).resolve("gpt-5.6-luna", ModelApiKeyService.MODEL_TYPE_VISION_REASONING, "canvas-layering");
    verify(agent, never()).completeVisionForModel(anyString(), anyString(), anyString(), anyList(), anyDouble());
    verifyNoInteractions(gem);
  }

  @Test void detectionUsesFixedLunaEvenWhenTheRegularAgentModelChanges() throws Exception {
    when(agent.isConfigured()).thenReturn(true);
    when(agent.completeVisionForModel(anyString(), anyString(), anyString(), anyList(), anyDouble()))
        .thenReturn(new AiChatDtos.CompletionResult("teamorouter", "gpt-5.6-luna", RESULT));
    for (String configuredModel : new String[] {"gpt-5.6-luna", "another-agent-model"}) {
      when(agent.model()).thenReturn(configuredModel);
      var elements = service.detectImageElements(IMAGE);
      assertEquals("绿色窗帘", elements.get(0).objectName());
      assertEquals(List.of(0.2, 0.1, 0.8, 0.9), elements.get(0).box2d());
    }
    verify(agent, times(2)).completeVisionForModel(eq("gpt-5.6-luna"), contains("[top,left,bottom,right]"),
        anyString(), eq(List.of(IMAGE)), eq(0.2));
    verify(agent, never()).completeVision(anyString(), anyString(), anyList(), anyDouble());
    verifyNoInteractions(gem);
  }

  @Test void providerFailureDoesNotSwitchToAnotherModel() throws Exception {
    when(agent.isConfigured()).thenReturn(true);
    when(agent.completeVisionForModel(anyString(), anyString(), anyString(), anyList(), anyDouble()))
        .thenThrow(new ApiException(502, "upstream failure"));
    assertEquals(502, assertThrows(ApiException.class,
        () -> service.detectImageElements(IMAGE)).getCode());
    verify(agent, times(1)).completeVisionForModel(eq("gpt-5.6-luna"), anyString(), anyString(), anyList(), eq(0.2));
    verifyNoInteractions(gem);
  }

  @Test void missingImageFailsWithoutSubmittingDetection() throws Exception {
    assertEquals(400, assertThrows(ApiException.class,
        () -> service.detectImageElements(" ")).getCode());
    verifyNoInteractions(agent);
    verifyNoInteractions(gem);
  }

  @Test void missingDefaultKeyDoesNotReturnAnEmptySuccess() throws Exception {
    assertEquals(503, assertThrows(ApiException.class, () -> service.detectImageElements(IMAGE)).getCode());
    verify(agent, never()).completeVisionForModel(anyString(), anyString(), anyString(), anyList(), anyDouble());
    verifyNoInteractions(gem);
  }

  @Test void malformedResponseDoesNotRetryOrReturnAnEmptySuccess() throws Exception {
    when(agent.isConfigured()).thenReturn(true);
    when(agent.completeVisionForModel(anyString(), anyString(), anyString(), anyList(), anyDouble()))
        .thenReturn(new AiChatDtos.CompletionResult("teamorouter", "default", "cannot analyze image"));
    assertEquals(502, assertThrows(ApiException.class,
        () -> service.detectImageElements(IMAGE)).getCode());
    verify(agent, times(1)).completeVisionForModel(eq("gpt-5.6-luna"), anyString(), anyString(), anyList(), eq(0.2));
    verifyNoInteractions(gem);
  }
}
