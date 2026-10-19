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
  void returnsOneStableWelcomeForGreetingWithoutCallingThePaidModel() throws Exception {
    AgentChatClient client = mock(AgentChatClient.class);
    CanvasAgentService service = new CanvasAgentService(new ObjectMapper(), client);
    StringBuilder thinking = new StringBuilder();
    StringBuilder reply = new StringBuilder();

    CanvasAgentDtos.ChatResponse response = service.chatStream(
        new CanvasAgentDtos.ChatRequest(
            "canvas-1", "你好呀", List.of(), List.of(), List.of(), List.of(),
            "banana2", "auto", "2K", 1),
        thinking::append,
        reply::append);

    assertTrue(thinking.toString().contains("中文问候"));
    assertFalse(thinking.toString().matches(".*[A-Za-z]{4,}.*"));
    assertEquals(response.reply(), reply.toString());
    assertTrue(response.reply().contains("有米家居创作导演"));
    assertTrue(response.reply().contains("窗帘、床垫、实木床和儿童床"));
    assertFalse(response.readyToGenerate());
    assertTrue(response.draftPrompts().isEmpty());
    verify(client, never()).completeCanvasAgent(anyList(), anyDouble());
  }

  @Test
  void greetingDuringAnExistingConversationDoesNotReplayTheWelcomeMenu() throws Exception {
    AgentChatClient client = mock(AgentChatClient.class);
    CanvasAgentService service = new CanvasAgentService(new ObjectMapper(), client);
    var response = service.chat(new CanvasAgentDtos.ChatRequest(
        "canvas-1", "你好", List.of(new CanvasAgentDtos.ChatMessage("user", "想做一款窗帘的主图")),
        List.of(), List.of(), List.of(), "banana2", "auto", "2K", 1));

    assertTrue(response.reply().length() < 80);
    assertFalse(response.reply().contains("我可以帮你"));
    assertFalse(response.readyToGenerate());
    assertTrue(response.draftPrompts().isEmpty());
    org.mockito.Mockito.verifyNoInteractions(client);
  }

  @Test
  void retainsFullScriptRulesAndDetailedVideoDraftAcrossProductInformationFollowup() throws Exception {
    AgentChatClient client = mock(AgentChatClient.class);
    when(client.isConfigured()).thenReturn(true);
    String rules = "脚本规则".repeat(5000) + "完整规则结尾";
    String script = "根据以下分镜描述生成：图1【地台床】【产品展示】真实短视频，不生成任何字幕\n分镜设计：\n"
        + "分镜1：具体生活事件、产品细节及连续动作。".repeat(500)
        + "\n口播设计：\n口播1（对应分镜1，时间：0秒-6秒）：贴地好清理。";
    String response = new ObjectMapper().writeValueAsString(java.util.Map.of(
        "reply", "脚本已整理", "generationType", "video", "durationSeconds", 15,
        "draftPrompts", List.of(script), "readyToGenerate", true));
    when(client.completeCanvasAgent(anyList(), anyDouble())).thenReturn(
        new AiChatDtos.CompletionResult("test", "test", response));
    var service = new CanvasAgentService(new ObjectMapper(), client);
    var history = List.of(new CanvasAgentDtos.ChatMessage("user", rules));
    String instruction = "产品详细资料".repeat(1000) + "可定制已确认";
    var result = service.chat(new CanvasAgentDtos.ChatRequest("canvas-1", instruction,
        history, List.of(), List.of(), List.of(), "banana2", "3:4", "2K", 1));
    var messages = org.mockito.ArgumentCaptor.forClass(List.class);
    verify(client).completeCanvasAgent(messages.capture(), anyDouble());
    String sent = messages.getValue().toString();
    assertTrue(sent.contains(rules));
    assertTrue(sent.contains(instruction));
    assertTrue(sent.contains(HomeCommerceAgentProfile.CONTEXT));
    assertTrue(sent.contains(HomeCommerceAgentProfile.CHAT_GUIDANCE));
    assertTrue(sent.contains("口播设计"));
    assertTrue(sent.contains("每秒3至4字"));
    assertTrue(sent.contains("分镜1（0秒-4秒）："));
    assertTrue(sent.contains("最后一镜结束秒数必须等于durationSeconds"));
    assertTrue(sent.contains("时长必须由提示词中的具体内容推导"));
    assertTrue(sent.contains("按并行关系计时"));
    assertTrue(sent.contains("独立观看价值"));
    assertTrue(sent.contains("起点、发展、变化与切出状态"));
    assertTrue(sent.contains("可说话时间=该段区间秒数"));
    assertTrue(sent.contains("台词实际进入与结束时间"));
    assertTrue(sent.contains("至少有一个完整使用事件"));
    assertTrue(sent.contains("允许根据用户卖点和创意需要安排夹层、内部剖面"));
    assertTrue(sent.contains("不因用户只提供外观图而禁止这些镜头"));
    assertFalse(sent.contains("没有明确结构资料时，禁止安排剖面"));
    assertTrue(sent.contains("返回前在内部执行一次成稿复核"));
    assertTrue(sent.contains("任一项缺失就直接在本次答案中补写或改写对应镜头"));
    assertEquals(script, result.draftPrompts().get(0));
    // Planning may exceed the provider's submission limit without silently losing text.
    assertFalse(result.readyToGenerate());
  }

  @Test
  void acceptsTrailingCommasInMultiPromptResponse() throws Exception {
    AgentChatClient agentChatClient = mock(AgentChatClient.class);
    when(agentChatClient.isConfigured()).thenReturn(true);
    when(agentChatClient.completeCanvasAgent(anyList(), anyDouble()))
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
    assertEquals(List.of("banana2"), response.imageModels());
    assertTrue(response.readyToGenerate());
    verify(agentChatClient, times(1)).completeCanvasAgent(anyList(), anyDouble());
  }

  @Test
  void preservesMultipleUserSelectedImageModelsForConfirmation() throws Exception {
    AgentChatClient agentChatClient = mock(AgentChatClient.class);
    when(agentChatClient.isConfigured()).thenReturn(true);
    when(agentChatClient.completeCanvasAgent(anyList(), anyDouble()))
        .thenReturn(new AiChatDtos.CompletionResult(
            "teamorouter",
            "gpt-5.6-luna",
            """
                {
                  "reply": "提示词已经整理好。",
                  "draftPrompts": ["明亮自然的卧室产品主图"],
                  "referenceLayerIds": [],
                  "model": "banana2",
                  "ratio": "3:4",
                  "resolution": "2K",
                  "count": 2,
                  "readyToGenerate": true
                }
                """));

    CanvasAgentService service = new CanvasAgentService(
        new ObjectMapper(), agentChatClient);
    CanvasAgentDtos.ChatResponse response = service.chat(new CanvasAgentDtos.ChatRequest(
        "canvas-1",
        "用两个模型生成",
        List.of(),
        List.of(),
        List.of(),
        List.of(),
        "banana2",
        "3:4",
        "2K",
        2,
        List.of("banana2", "gpt-image-2"),
        "agent-1"));

    assertEquals(List.of("banana2", "gpt-image-2"), response.imageModels());
    assertEquals(2, response.count());
    assertTrue(response.readyToGenerate());
  }

  @Test
  void retriesOnceWhenChatResponseStillCannotBeParsed() throws Exception {
    AgentChatClient agentChatClient = mock(AgentChatClient.class);
    when(agentChatClient.isConfigured()).thenReturn(true);
    when(agentChatClient.completeCanvasAgent(anyList(), anyDouble()))
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
    verify(agentChatClient, times(2)).completeCanvasAgent(anyList(), anyDouble());
  }

  @Test
  void enhancesPromptWithoutStartingAgentChatOrGeneration() throws Exception {
    AgentChatClient agentChatClient = mock(AgentChatClient.class);
    when(agentChatClient.isConfigured()).thenReturn(true);
    when(agentChatClient.completeCanvasAgent(anyList(), anyDouble()))
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
    var messages = org.mockito.ArgumentCaptor.forClass(List.class);
    verify(agentChatClient).completeCanvasAgent(messages.capture(), anyDouble());
    String system = ((AiChatDtos.Message) messages.getValue().get(0)).content();
    assertTrue(system.startsWith(HomeCommerceAgentProfile.CONTEXT));
    assertTrue(system.contains("只输出润色后的提示词正文"));
    verify(agentChatClient, never())
        .completeCanvasAgentVision(anyString(), anyString(), anyList(), anyDouble());
  }

  @Test
  void chatReturnsConfirmationDraftWithoutExecutingGeneration() throws Exception {
    AgentChatClient agentChatClient = mock(AgentChatClient.class);
    when(agentChatClient.isConfigured()).thenReturn(true);
    when(agentChatClient.completeCanvasAgentVision(anyString(), anyString(), anyList(), anyDouble()))
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
    when(agentChatClient.completeCanvasAgent(anyList(), anyDouble()))
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
    when(agentChatClient.completeCanvasAgent(anyList(), anyDouble()))
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
    verify(agentChatClient).completeCanvasAgent(anyList(), anyDouble());
    verify(agentChatClient, never())
        .completeCanvasAgentVision(anyString(), anyString(), anyList(), anyDouble());
  }

  @Test
  void sanitizesPlannerStepsAndLimitsGeneratedImages() throws Exception {
    AgentChatClient agentChatClient = mock(AgentChatClient.class);
    when(agentChatClient.isConfigured()).thenReturn(true);
    when(agentChatClient.completeCanvasAgentVision(anyString(), anyString(), anyList(), anyDouble()))
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
    var system = org.mockito.ArgumentCaptor.forClass(String.class);
    verify(agentChatClient).completeCanvasAgentVision(
        system.capture(), anyString(), anyList(), anyDouble());
    assertTrue(system.getValue().startsWith(HomeCommerceAgentProfile.CONTEXT));
    assertTrue(system.getValue().contains("只能使用以下动作"));
  }

  @Test
  void fallsBackToOriginalInstructionWhenPlannerResponseIsInvalid() throws Exception {
    AgentChatClient agentChatClient = mock(AgentChatClient.class);
    when(agentChatClient.isConfigured()).thenReturn(true);
    when(agentChatClient.completeCanvasAgent(anyList(), anyDouble()))
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
