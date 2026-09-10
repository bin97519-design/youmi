package com.youmi.api.prompt;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
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
import java.util.List;
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
  void fallsBackToDashScopeWhenXfyunAuthorizationExpires() throws Exception {
    DashScopeClient dashScopeClient = mock(DashScopeClient.class);
    XfyunVisionClient xfyunVisionClient = mock(XfyunVisionClient.class);
    when(xfyunVisionClient.isConfigured()).thenReturn(true);
    when(xfyunVisionClient.analyzeImage(anyString(), anyString(), anyString()))
        .thenThrow(new IllegalStateException(
            "Xfyun vision request failed: 403 code 11200 authorization failed"));
    when(dashScopeClient.isConfigured()).thenReturn(true);
    when(dashScopeClient.model()).thenReturn("qwen3.7-plus");
    when(dashScopeClient.completeVision(
        anyString(), anyString(), anyList(), anyDouble(), anyInt()))
        .thenReturn(new AiChatDtos.CompletionResult(
            "dashscope", "qwen3.7-plus", VALID_RESULT));

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

  @Test
  void reviewsCloneQualityWithWeightedScoresAndRetryInstruction() throws Exception {
    DashScopeClient dashScopeClient = mock(DashScopeClient.class);
    XfyunVisionClient xfyunVisionClient = mock(XfyunVisionClient.class);
    when(dashScopeClient.isConfigured()).thenReturn(true);
    when(dashScopeClient.completeVision(
        anyString(), anyString(), anyList(), anyDouble(), anyInt()))
        .thenReturn(new AiChatDtos.CompletionResult(
            "dashscope",
            "qwen3.7-plus",
            """
                {
                  "scores": {
                    "silhouette": 90,
                    "proportion_thickness": 90,
                    "surface_pattern": 95,
                    "edge_fold_markings": 95,
                    "composition": 70,
                    "color_temperature": 80,
                    "lighting": 80,
                    "scene": 65,
                    "people_action": 60,
                    "typography": 75,
                    "compliance": 100
                  },
                  "issues": ["模特动作未保持", "场景道具缺失"],
                  "repair_instruction": "恢复参考图的人物位置、动作和卧室道具，保持我方产品结构。"
                }
                """));

    ReversePromptService service = new ReversePromptService(
        new ObjectMapper(),
        dashScopeClient,
        xfyunVisionClient,
        new ReversePromptTemplateService());

    ReversePromptDtos.ReviewStyleCloneResponse response = service.reviewStyleClone(
        new ReversePromptDtos.ReviewStyleCloneRequest(
            "layout",
            "https://example.com/competitor.png",
            List.of("https://example.com/product.png"),
            "https://example.com/generated.png",
            "蓝白床垫",
            "不得出现竞品品牌",
            80));

    assertEquals(81, response.scores().overall());
    assertEquals(92, response.scores().productConsistency());
    assertEquals(90, response.scores().silhouette());
    assertFalse(response.passed());
    assertTrue(response.retryRecommended());
    assertEquals(2, response.issues().size());
  }

  @Test
  void visualFingerprintTemplatesIncludePeopleSceneGeometryAndColorTemperature() {
    ReversePromptTemplateService service = new ReversePromptTemplateService();
    String prompt = service.get("mattress").systemPrompt();

    assertTrue(prompt.contains("people_and_actions"));
    assertTrue(prompt.contains("scene_and_environment"));
    assertTrue(prompt.contains("product_bbox"));
    assertTrue(prompt.contains("color_temperature"));
    assertTrue(prompt.contains("product_identity"));
    assertTrue(prompt.contains("unknown_facts"));
  }
}
