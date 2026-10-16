package com.youmi.api.ai;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import com.youmi.api.image.ModelApiKeyService;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class CanvasAgentFaceDetectionTest {
  private final AgentChatClient client = mock(AgentChatClient.class);
  private final ModelApiKeyService keys = mock(ModelApiKeyService.class);
  private final ModelApiKeyService.ResolvedModelApiKey configured = new ModelApiKeyService.ResolvedModelApiKey(
      18L, "configured-vision-model", "test-router", "https://vision.example.test", "/chat", "/models", "fixture-key-only");
  private final CanvasAgentService service = new CanvasAgentService(new ObjectMapper(), client,
      mock(GemAgentClient.class), keys);

  @BeforeEach void configuredVisionRoute() {
    when(keys.preferredEnabledModel(ModelApiKeyService.MODEL_TYPE_VISION_REASONING,
        CanvasAgentService.FACE_DETECTION_FEATURE)).thenReturn(Optional.of(configured));
  }

  @Test void detectsFaceRegionsNotWholePeopleAndConvertsCoordinates() throws Exception {
    when(client.completeConfiguredModel(eq(configured), anyString(), anyString(), anyList(), anyDouble(),
        eq(CanvasAgentService.FACE_DETECTION_FEATURE), eq("system_default")))
        .thenReturn(new AiChatDtos.CompletionResult("test", "test", """
          {"elements":[{"object_name":"面部1","box_2d":[0.12,0.3,0.35,0.48]}]}
          """));
    assertEquals(List.of(0.3, 0.12, 0.48, 0.35), service.detectImageFaces("https://example.test/face.png").get(0).box2d());
    verify(client).completeConfiguredModel(eq(configured),
        contains("不要完整人物框"), contains("脸部"), eq(List.of("https://example.test/face.png")), eq(0.0),
        eq(CanvasAgentService.FACE_DETECTION_FEATURE), eq("system_default"));
    verify(client, never()).completeVisionForModel(anyString(), anyString(), anyString(), anyList(), anyDouble());
    verify(keys, never()).resolve(anyString(), anyString(), anyString());
  }

  @Test void noFacesIsAnEmptyResultNotAnInventedRole() throws Exception {
    when(client.completeConfiguredModel(eq(configured), anyString(), anyString(), anyList(), anyDouble(),
        anyString(), anyString()))
        .thenReturn(new AiChatDtos.CompletionResult("test", "test", "{\"elements\":[]}"));
    assertTrue(service.detectImageFaces("https://example.test/landscape.png").isEmpty());
  }

  @Test void missingModelConfigurationIsAnErrorNotAnEmptyDetection() throws Exception {
    when(keys.preferredEnabledModel(anyString(), anyString())).thenReturn(Optional.empty());
    when(client.isConfigured()).thenReturn(true); // Even a configured legacy key must not be used.
    assertEquals(503, assertThrows(ApiException.class,
        () -> service.detectImageFaces("https://example.test/face.png")).getCode());
    verify(client, never()).completeVisionForModel(anyString(), anyString(), anyString(), anyList(), anyDouble());
    verify(client, never()).completeConfiguredModel(any(), anyString(), anyString(), anyList(), anyDouble(), anyString(), anyString());
  }

  @Test void providerAuthenticationErrorIsActionableAndNeverFallsBackOrLeaksResponse() throws Exception {
    when(client.completeConfiguredModel(eq(configured), anyString(), anyString(), anyList(), anyDouble(),
        anyString(), anyString())).thenThrow(new IllegalStateException(
            "识图推理模型请求失败（HTTP 401）: {\"api_key\":\"fixture-secret-must-not-leak\"}"));
    var error = assertThrows(ApiException.class, () -> service.detectImageFaces("https://example.test/face.png"));
    assertEquals(503, error.getCode());
    assertTrue(error.getMessage().contains("后台识图推理模型鉴权失败"));
    assertFalse(error.getMessage().contains("fixture-secret"));
    verify(client, never()).completeVisionForModel(anyString(), anyString(), anyString(), anyList(), anyDouble());
    verify(client, times(1)).completeConfiguredModel(eq(configured), anyString(), anyString(), anyList(), anyDouble(), anyString(), anyString());
  }

  @Test void configuredModelTimeoutIsNotMisreportedAsNoFaces() throws Exception {
    when(client.completeConfiguredModel(eq(configured), anyString(), anyString(), anyList(), anyDouble(),
        anyString(), anyString())).thenThrow(new java.net.http.HttpTimeoutException("fixture timeout"));
    assertEquals(504, assertThrows(ApiException.class,
        () -> service.detectImageFaces("https://example.test/face.png")).getCode());
  }

  @Test void malformedVisionResponseIsNotMisreportedAsNoFaces() throws Exception {
    when(client.completeConfiguredModel(eq(configured), anyString(), anyString(), anyList(), anyDouble(),
        anyString(), anyString())).thenReturn(new AiChatDtos.CompletionResult("test", "configured-vision-model", "not json"));
    assertEquals(502, assertThrows(ApiException.class,
        () -> service.detectImageFaces("https://example.test/face.png")).getCode());
  }
}
