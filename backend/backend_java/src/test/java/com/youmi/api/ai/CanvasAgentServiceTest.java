package com.youmi.api.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.junit.jupiter.api.Test;

class CanvasAgentServiceTest {
  @Test
  void acceptsTrailingCommasInMultiPromptResponse() throws Exception {
    AgentChatClient agentChatClient = mock(AgentChatClient.class);
    when(agentChatClient.isConfigured()).thenReturn(true);
    when(agentChatClient.complete(anyList(), anyDouble()))
        .thenReturn(new AiChatDtos.CompletionResult(
            "teamorouter",
            "gpt-5.6-luna",
            """
                {
                  "reply": "已经整理好两条提示词。",
                  "draftPrompt": "第一条提示词",
                  "draftPrompts": [
                    "第一条提示词",
                    "第二条提示词",
                  ],
                  "referenceLayerIds": [],
                  "model": "banana2",
                  "ratio": "3:4",
                  "resolution": "2K",
                  "count": 1,
                  "readyToGenerate": true,
                }
                """));

    CanvasAgentService service = new CanvasAgentService(
        new ObjectMapper(), agentChatClient);
    CanvasAgentDtos.ChatResponse response = service.chat(new CanvasAgentDtos.ChatRequest(
        "canvas-1",
        "给我两条提示词",
        List.of(),
        List.of(),
        List.of(),
        List.of(),
        "banana2",
        "3:4",
        "2K",
        1));

    assertEquals(List.of("第一条提示词", "第二条提示词"), response.draftPrompts());
    assertTrue(response.readyToGenerate());
    verify(agentChatClient, times(1)).complete(anyList(), anyDouble());
  }

  @Test
  void retriesOnceWhenChatResponseStillCannotBeParsed() throws Exception {
    AgentChatClient agentChatClient = mock(AgentChatClient.class);
    when(agentChatClient.isConfigured()).thenReturn(true);
    when(agentChatClient.complete(anyList(), anyDouble()))
        .thenReturn(
            new AiChatDtos.CompletionResult(
                "teamorouter", "gpt-5.6-luna", "not-json"),
            new AiChatDtos.CompletionResult(
                "teamorouter",
                "gpt-5.6-luna",
                """
                    {
                      "reply": "已经修复并整理好提示词。",
                      "draftPrompt": "修复后的提示词",
                      "draftPrompts": ["修复后的提示词"],
                      "referenceLayerIds": [],
                      "model": "banana2",
                      "ratio": "auto",
                      "resolution": "2K",
                      "count": 1,
                      "readyToGenerate": true
                    }
                    """));

    CanvasAgentService service = new CanvasAgentService(
        new ObjectMapper(), agentChatClient);
    CanvasAgentDtos.ChatResponse response = service.chat(new CanvasAgentDtos.ChatRequest(
        "canvas-1",
        "帮我整理提示词",
        List.of(),
        List.of(),
        List.of(),
        List.of(),
        "banana2",
        "auto",
        "2K",
        1));

    assertEquals(List.of("修复后的提示词"), response.draftPrompts());
    assertTrue(response.readyToGenerate());
    verify(agentChatClient, times(2)).complete(anyList(), anyDouble());
  }

  @Test
  void enhancesPromptWithoutStartingAgentChatOrGeneration() throws Exception {
    AgentChatClient agentChatClient = mock(AgentChatClient.class);
    when(agentChatClient.isConfigured()).thenReturn(true);
    when(agentChatClient.complete(anyList(), anyDouble()))
        .thenReturn(new AiChatDtos.CompletionResult(
            "teamorouter",
            "gpt-5.6-luna",
            "保留床垫主体结构，置于明亮自然的现代卧室中，柔和晨光从侧窗进入。"));

    CanvasAgentService service = new CanvasAgentService(
        new ObjectMapper(), agentChatClient);
    CanvasAgentDtos.EnhancePromptResponse response = service.enhancePrompt(
        new CanvasAgentDtos.EnhancePromptRequest("床垫放在明亮卧室里"));

    assertEquals("teamorouter", response.provider());
    assertEquals("gpt-5.6-luna", response.model());
    assertEquals(
        "保留床垫主体结构，置于明亮自然的现代卧室中，柔和晨光从侧窗进入。",
        response.prompt());
    verify(agentChatClient).complete(anyList(), anyDouble());
    verify(agentChatClient, never())
        .completeVision(anyString(), anyString(), anyList(), anyDouble());
  }

  @Test
  void chatReturnsConfirmationDraftWithoutExecutingGeneration() throws Exception {
    AgentChatClient agentChatClient = mock(AgentChatClient.class);
    when(agentChatClient.isConfigured()).thenReturn(true);
    when(agentChatClient.completeVision(anyString(), anyString(), anyList(), anyDouble()))
        .thenReturn(new AiChatDtos.CompletionResult(
            "teamorouter",
            "gpt-5.6-luna",
            """
                {
                  "reply": "我已经按参考图整理好一版提示词，确认前不会生图。",
                  "draftPrompt": "保留产品结构，改为明亮的现代卧室场景",
                  "draftPrompts": [
                    "保留产品结构，改为明亮的现代卧室场景",
                    "保留产品结构，改为温暖的奶油风卧室场景"
                  ],
                  "referenceLayerIds": ["image-1", "missing", "text-1"],
                  "model": "unknown-model",
                  "ratio": "99:1",
                  "resolution": "8K",
                  "count": 9,
                  "readyToGenerate": true
                }
                """));

    CanvasAgentService service = new CanvasAgentService(
        new ObjectMapper(), agentChatClient);
    CanvasAgentDtos.ChatResponse response = service.chat(new CanvasAgentDtos.ChatRequest(
        "canvas-1",
        "帮我优化成明亮卧室",
        List.of(new CanvasAgentDtos.ChatMessage("user", "保留产品不变")),
        List.of(
            new CanvasAgentDtos.LayerContext(
                "image-1", "Product", "image", "https://example.com/product.png",
                600.0, 800.0, 10.0, 20.0),
            new CanvasAgentDtos.LayerContext(
                "text-1", "Title", "text", "", 300.0, 40.0, 10.0, 840.0)),
        List.of(),
        List.of("image-1"),
        "banana2",
        "3:4",
        "2K",
        2));

    assertEquals("保留产品结构，改为明亮的现代卧室场景", response.draftPrompt());
    assertEquals(2, response.draftPrompts().size());
    assertEquals(List.of("image-1"), response.referenceLayerIds());
    assertEquals("banana2", response.imageModel());
    assertEquals("3:4", response.ratio());
    assertEquals("2K", response.resolution());
    assertEquals(4, response.count());
    assertTrue(response.readyToGenerate());
  }

  @Test
  void chatDoesNotExposeConfirmationWhenModelResponseIsInvalid() throws Exception {
    AgentChatClient agentChatClient = mock(AgentChatClient.class);
    when(agentChatClient.isConfigured()).thenReturn(true);
    when(agentChatClient.complete(anyList(), anyDouble()))
        .thenReturn(new AiChatDtos.CompletionResult(
            "teamorouter", "gpt-5.6-luna", "invalid"));

    CanvasAgentService service = new CanvasAgentService(
        new ObjectMapper(), agentChatClient);
    CanvasAgentDtos.ChatResponse response = service.chat(new CanvasAgentDtos.ChatRequest(
        "canvas-1",
        "先聊聊怎么改",
        List.of(),
        List.of(),
        List.of(),
        List.of(),
        "banana2",
        "auto",
        "2K",
        1));

    assertEquals("", response.draftPrompt());
    assertFalse(response.readyToGenerate());
  }

  @Test
  void selectedCanvasImageDoesNotTriggerVisionWithoutSubmittedReference() throws Exception {
    AgentChatClient agentChatClient = mock(AgentChatClient.class);
    when(agentChatClient.isConfigured()).thenReturn(true);
    when(agentChatClient.complete(anyList(), anyDouble()))
        .thenReturn(new AiChatDtos.CompletionResult(
            "teamorouter",
            "gpt-5.6-luna",
            """
                {
                  "reply": "我会先根据你的文字需求整理方案。",
                  "draftPrompt": "",
                  "referenceLayerIds": ["image-1"],
                  "model": "banana2",
                  "ratio": "auto",
                  "resolution": "2K",
                  "count": 1,
                  "readyToGenerate": false
                }
                """));

    CanvasAgentService service = new CanvasAgentService(
        new ObjectMapper(), agentChatClient);
    CanvasAgentDtos.ChatResponse response = service.chat(new CanvasAgentDtos.ChatRequest(
        "canvas-1",
        "帮我想一个更温暖的画面方案",
        List.of(),
        List.of(new CanvasAgentDtos.LayerContext(
            "image-1", "Product", "image", "https://example.com/product.png",
            600.0, 800.0, 10.0, 20.0)),
        List.of("image-1"),
        List.of(),
        "banana2",
        "auto",
        "2K",
        1));

    assertEquals(List.of(), response.referenceLayerIds());
    verify(agentChatClient).complete(anyList(), anyDouble());
    verify(agentChatClient, never())
        .completeVision(anyString(), anyString(), anyList(), anyDouble());
  }

  @Test
  void sanitizesPlannerStepsAndLimitsGeneratedImages() throws Exception {
    AgentChatClient agentChatClient = mock(AgentChatClient.class);
    when(agentChatClient.isConfigured()).thenReturn(true);
    when(agentChatClient.completeVision(anyString(), anyString(), anyList(), anyDouble()))
        .thenReturn(new AiChatDtos.CompletionResult(
            "teamorouter",
            "gpt-5.6-luna",
            """
                {
                  "summary": "Create two product variants",
                  "steps": [
                    {
                      "action": "generate",
                      "title": "First batch",
                      "prompt": "Create a clean product image",
                      "referenceLayerIds": ["missing", "text-1"],
                      "model": "untrusted-model",
                      "ratio": "99:1",
                      "resolution": "8K",
                      "count": 4
                    },
                    {
                      "action": "generate",
                      "title": "Second batch",
                      "prompt": "Create another product image",
                      "count": 4
                    },
                    {"action": "delete", "title": "Delete all layers"},
                    {"action": "arrange", "title": "Arrange results"}
                  ]
                }
                """));

    CanvasAgentService service = new CanvasAgentService(
        new ObjectMapper(), agentChatClient);
    CanvasAgentDtos.PlanResponse response = service.plan(new CanvasAgentDtos.PlanRequest(
        "canvas-1",
        "Create product variants",
        List.of(
            new CanvasAgentDtos.LayerContext(
                "image-1", "Product", "image", "https://example.com/product.png",
                600.0, 800.0, 10.0, 20.0),
            new CanvasAgentDtos.LayerContext(
                "text-1", "Title", "text", "", 300.0, 40.0, 10.0, 840.0)),
        List.of("text-1"),
        List.of("image-1", "text-1", "missing"),
        "banana2",
        "auto",
        "2K",
        2));

    assertEquals(2, response.steps().size());
    CanvasAgentDtos.PlanStep generate = response.steps().get(0);
    assertEquals("generate", generate.action());
    assertEquals(4, generate.count());
    assertEquals("banana2", generate.model());
    assertEquals("auto", generate.ratio());
    assertEquals("2K", generate.resolution());
    assertEquals(List.of("image-1"), generate.referenceLayerIds());
    assertEquals("arrange", response.steps().get(1).action());
  }

  @Test
  void fallsBackToOriginalInstructionWhenPlannerResponseIsInvalid() throws Exception {
    AgentChatClient agentChatClient = mock(AgentChatClient.class);
    when(agentChatClient.isConfigured()).thenReturn(true);
    when(agentChatClient.complete(anyList(), anyDouble()))
        .thenReturn(new AiChatDtos.CompletionResult(
            "teamorouter", "gpt-5.6-luna", "not-json"));

    CanvasAgentService service = new CanvasAgentService(
        new ObjectMapper(), agentChatClient);
    CanvasAgentDtos.PlanResponse response = service.plan(new CanvasAgentDtos.PlanRequest(
        "canvas-1",
        "Create a clean hero image",
        List.of(),
        List.of(),
        List.of(),
        "banana-pro",
        "3:4",
        "1K",
        2));

    assertEquals(1, response.steps().size());
    CanvasAgentDtos.PlanStep fallback = response.steps().get(0);
    assertEquals("generate", fallback.action());
    assertEquals("Create a clean hero image", fallback.prompt());
    assertEquals("banana-pro", fallback.model());
    assertEquals("3:4", fallback.ratio());
    assertEquals("1K", fallback.resolution());
    assertEquals(2, fallback.count());
  }

  @Test
  void rejectsAgentRequestWhenDedicatedLanguageModelIsNotConfigured() {
    AgentChatClient agentChatClient = mock(AgentChatClient.class);
    when(agentChatClient.isConfigured()).thenReturn(false);

    CanvasAgentService service = new CanvasAgentService(
        new ObjectMapper(), agentChatClient);

    org.junit.jupiter.api.Assertions.assertThrows(
        IllegalStateException.class,
        () -> service.plan(new CanvasAgentDtos.PlanRequest(
            "canvas-1",
            "Create a premium hero image",
            List.of(),
            List.of(),
            List.of(),
            "banana2",
            "1:1",
            "2K",
            1)));
  }
}
