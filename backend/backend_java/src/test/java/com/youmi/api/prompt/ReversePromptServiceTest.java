package com.youmi.api.prompt;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.ai.AiChatDtos;
import com.youmi.api.ai.DashScopeClient;
import com.youmi.api.ai.XfyunVisionClient;
import java.io.IOException;
import org.junit.jupiter.api.Test;

class ReversePromptServiceTest {
  private static final String VALID_RESULT = """
      {
        "visual_style": {"overall_tone": "清爽"},
        "generation_prompt": "生成清爽电商主图",
        "negative_prompt": "避免变形"
      }
      """;

  @Test
  void fallsBackToDashScopeWhenXfyunIsBusy() throws Exception {
    DashScopeClient dashScopeClient = mock(DashScopeClient.class);
    XfyunVisionClient xfyunVisionClient = mock(XfyunVisionClient.class);
    when(xfyunVisionClient.isConfigured()).thenReturn(true);
    when(xfyunVisionClient.analyzeImage(anyString(), anyString(), anyString()))
        .thenThrow(new IOException("Xfyun vision transient response: 503 code 10310"));
    when(dashScopeClient.isConfigured()).thenReturn(true);
    when(dashScopeClient.model()).thenReturn("qwen3.7-plus");
    when(dashScopeClient.completeVision(
        anyString(), anyString(), anyList(), anyDouble(), anyInt()))
        .thenReturn(new AiChatDtos.CompletionResult("dashscope", "qwen3.7-plus", VALID_RESULT));

    ReversePromptService service = new ReversePromptService(
        new ObjectMapper(),
        dashScopeClient,
        xfyunVisionClient,
        new ReversePromptTemplateService());

    ReversePromptDtos.AnalyzeImageResponse response = service.analyze(
        new ReversePromptDtos.AnalyzeImageRequest(
            "general",
            "https://example.com/reference.png",
            null,
            false));

    assertEquals("dashscope", response.provider());
    assertEquals("qwen3.7-plus", response.model());
    assertEquals("清爽", response.promptJson().path("visual_style").path("overall_tone").asText());
  }

  @Test
  void returnsFriendlyMessageWhenBusyAndFallbackIsUnavailable() throws Exception {
    DashScopeClient dashScopeClient = mock(DashScopeClient.class);
    XfyunVisionClient xfyunVisionClient = mock(XfyunVisionClient.class);
    when(xfyunVisionClient.isConfigured()).thenReturn(true);
    when(xfyunVisionClient.analyzeImage(anyString(), anyString(), anyString()))
        .thenThrow(new IOException("Xfyun vision transient response: 503 code 10310"));
    when(dashScopeClient.isConfigured()).thenReturn(false);

    ReversePromptService service = new ReversePromptService(
        new ObjectMapper(),
        dashScopeClient,
        xfyunVisionClient,
        new ReversePromptTemplateService());

    IllegalStateException error = assertThrows(
        IllegalStateException.class,
        () -> service.analyze(new ReversePromptDtos.AnalyzeImageRequest(
            "mattress",
            "https://example.com/reference.png",
            null,
            false)));

    assertEquals("讯飞视觉服务繁忙，请稍后重试", error.getMessage());
  }
}
