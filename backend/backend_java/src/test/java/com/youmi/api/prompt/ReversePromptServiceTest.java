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
  void usesLunaForEveryPromptCategoryWithoutFallback() throws Exception {
    var agent = mock(com.youmi.api.ai.AgentChatClient.class);
    var keys = mock(com.youmi.api.image.ModelApiKeyService.class);
    var credential = new com.youmi.api.image.ModelApiKeyService.ResolvedModelApiKey(
        5L, "gpt-5.6-luna", "test", "https://example.com", "/v1/chat/completions", "", "test-key");
    when(keys.resolve("gpt-5.6-luna", "vision_reasoning")).thenReturn(java.util.Optional.of(credential));
    when(agent.completeConfiguredModel(org.mockito.ArgumentMatchers.eq(credential), anyString(),
        anyString(), anyList(), org.mockito.ArgumentMatchers.eq(0.15),
        org.mockito.ArgumentMatchers.eq("reverse-prompt"), org.mockito.ArgumentMatchers.eq("fixed_model"),
        org.mockito.ArgumentMatchers.eq(4096)))
        .thenReturn(new AiChatDtos.CompletionResult("test", "gpt-5.6-luna", VALID_RESULT));
    var dash = mock(DashScopeClient.class);
    var xfyun = mock(XfyunVisionClient.class);
    var templates = new ReversePromptTemplateService();
    var service = new ReversePromptService(new ObjectMapper(), dash, xfyun, templates);
    service.setPromptModelClients(agent, keys);
    for (var category : templates.categories()) {
      var response = service.analyze(new ReversePromptDtos.AnalyzeImageRequest(
          category.value(), "https://example.com/reference.png", null, false));
      assertEquals("gpt-5.6-luna", response.model());
      assertEquals("清爽", response.promptJson().path("visual_style").path("overall_tone").asText());
    }
    org.mockito.Mockito.verifyNoInteractions(xfyun, dash);
  }

  @Test
  void missingLunaConfigurationDoesNotSilentlyUseAnotherModel() {
    var service = new ReversePromptService(new ObjectMapper(), mock(DashScopeClient.class),
        mock(XfyunVisionClient.class), new ReversePromptTemplateService());
    service.setPromptModelClients(mock(com.youmi.api.ai.AgentChatClient.class),
        mock(com.youmi.api.image.ModelApiKeyService.class));
    var error = assertThrows(com.youmi.api.common.ApiException.class, () -> service.analyze(
        new ReversePromptDtos.AnalyzeImageRequest("general", "https://example.com/reference.png", null, false)));
    assertTrue(error.getMessage().contains("gpt-5.6-luna"));
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
