package com.youmi.api.ai;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.youmi.api.common.ApiException;
import com.youmi.api.image.ModelApiKeyService;
import java.util.List;
import org.junit.jupiter.api.Test;

class CanvasAgentVideoReferenceTest {
  private final ObjectMapper mapper = new ObjectMapper();
  private final AgentChatClient agent = mock(AgentChatClient.class);
  private final GemAgentClient gem = mock(GemAgentClient.class);
  private final CanvasAgentService service = new CanvasAgentService(mapper, agent, gem);

  private ObjectNode body() throws Exception {
    return (ObjectNode) mapper.readTree("""
        {"instruction":"还原这个视频的提示词","agentModel":"gem-3.8-flash","model":"banana2",
         "layers":[{"id":"product","type":"image","url":"https://assets.example/product.png"},
                   {"id":"unselected","type":"image","url":"https://assets.example/private.png"},
                   {"id":"video","type":"video","url":"https://assets.example/source.mp4"}],
         "referenceLayerIds":["product","video"],
         "referenceVideo":{"url":"https://assets.example/source.mp4","name":"窗帘视频",
          "duration":105,"width":832,"height":1108,"audioSummary":"未分析原音轨",
          "frames":[{"url":"https://assets.example/frame0.jpg","time":0.03},
                    {"url":"https://assets.example/frame1.jpg","time":50},
                    {"url":"https://assets.example/frame2.jpg","time":104.96}]},
         "video":{"model":"minimax-h3","duration":15}}
        """);
  }

  private CanvasAgentDtos.ChatRequest request(ObjectNode body) throws Exception {
    return mapper.treeToValue(body, CanvasAgentDtos.ChatRequest.class);
  }

  private void gemReply(String prompt, int duration) throws Exception {
    String json = mapper.writeValueAsString(java.util.Map.of("reply", "已按视频画面整理提示词",
        "generationType", "video", "durationSeconds", duration, "draftPrompts", List.of(prompt),
        "readyToGenerate", true, "referenceLayerIds", List.of("product", "video", "frame0")));
    when(gem.complete(anyString(), anyString(), anyList(), eq(0.2), eq(true), eq(16000), isNull()))
        .thenReturn(new AiChatDtos.CompletionResult("lk888", GemAgentClient.MODEL, json));
  }

  @Test void sendsOrderedVideoFramesWithTimestampsAndOnlyExplicitImageReferences() throws Exception {
    gemReply("0-50秒：远景展示窗帘。50-105秒：轻抚布料，拉远收尾。", 105);
    var response = service.chat(request(body()));
    assertEquals(105, response.durationSeconds());
    assertEquals("video", response.generationType());
    assertEquals(List.of("product"), response.referenceLayerIds());
    assertFalse(response.readyToGenerate());
    assertTrue(response.draftPrompts().get(0).contains("105"));
    verify(gem).complete(contains("不能识别或虚构原片对白"),
        argThat(prompt -> prompt.contains("\"durationSeconds\":105.0")
            && prompt.contains("\"imageNumber\":2") && prompt.contains("\"videoTimeSeconds\":104.96")),
        eq(List.of("https://assets.example/product.png", "https://assets.example/frame0.jpg",
            "https://assets.example/frame1.jpg", "https://assets.example/frame2.jpg")), eq(0.2), eq(true), eq(16000), isNull());
    verifyNoInteractions(agent);
  }

  @Test void defaultAgentUsesVisionAndKeepsOriginalDurationWhenModelOmitsIt() throws Exception {
    var body = body();
    body.put("agentModel", "default");
    body.put("instruction", "");
    body.putArray("referenceLayerIds");
    when(agent.isConfigured()).thenReturn(true);
    when(agent.completeCanvasAgentVision(anyString(), anyString(), anyList(), eq(0.2), eq(16000)))
        .thenReturn(new AiChatDtos.CompletionResult("teamorouter", "gpt-5.6-luna",
            "{\"generationType\":\"video\",\"draftPrompts\":[\"完整105秒时间轴\"],\"readyToGenerate\":true}"));
    var response = service.chat(request(body));
    assertEquals(105, response.durationSeconds());
    assertFalse(response.readyToGenerate());
    verify(agent).completeCanvasAgentVision(anyString(), contains("反推出完整中文视频提示词"),
        eq(List.of("https://assets.example/frame0.jpg", "https://assets.example/frame1.jpg", "https://assets.example/frame2.jpg")),
        eq(0.2), eq(16000));
    verifyNoInteractions(gem);
  }

  @Test void configuredAgentRetainsVideoFramesAndTheLongResponseBudget() throws Exception {
    var keys = mock(ModelApiKeyService.class);
    var credential = new ModelApiKeyService.ResolvedModelApiKey(9, "gpt-5.6-luna", "teamorouter",
        "https://configured.example/v1", "/chat/completions", "", "test-only", java.util.Map.of());
    when(keys.resolve("gpt-5.6-luna", ModelApiKeyService.MODEL_TYPE_VISION_REASONING, "canvas-agent"))
        .thenReturn(java.util.Optional.of(credential));
    when(agent.completeConfiguredModel(eq(credential), anyString(), anyString(), anyList(), eq(0.2),
        eq("canvas-agent"), eq("dropdown"), eq(16000)))
        .thenReturn(new AiChatDtos.CompletionResult("teamorouter", "gpt-5.6-luna",
            "{\"generationType\":\"video\",\"draftPrompts\":[\"完整105秒时间轴\"],\"readyToGenerate\":true}"));
    var body = body();
    body.put("agentModel", "gpt-5.6-luna");
    var configuredService = new CanvasAgentService(mapper, agent, gem, keys);
    var response = configuredService.chat(request(body));
    assertEquals(105, response.durationSeconds());
    assertFalse(response.readyToGenerate());
    verify(agent).completeConfiguredModel(eq(credential), anyString(), anyString(),
        eq(List.of("https://assets.example/product.png", "https://assets.example/frame0.jpg",
            "https://assets.example/frame1.jpg", "https://assets.example/frame2.jpg")),
        eq(0.2), eq("canvas-agent"), eq("dropdown"), eq(16000));
    verifyNoInteractions(gem);
  }

  @Test void longReversePromptRemainsVisibleButCannotAuthorizeGeneration() throws Exception {
    String prompt = "视频还原提示词".repeat(450);
    gemReply(prompt, 30);
    var response = service.chat(request(body()));
    assertEquals(List.of(prompt), response.draftPrompts());
    assertFalse(response.readyToGenerate());
  }

  @Test void rejectsInvalidVideoMetadataBeforeAnyModelSubmission() throws Exception {
    for (String invalidUrl : List.of("blob:local-video", "file:///secret.mp4", "relative.mp4", "https://user:password@assets.example/v.mp4")) {
      var body = body();
      ((ObjectNode) body.get("referenceVideo")).put("url", invalidUrl);
      assertEquals(400, assertThrows(ApiException.class, () -> service.chat(request(body))).getCode());
    }
    var tooLong = body();
    ((ObjectNode) tooLong.get("referenceVideo")).put("duration", 121);
    assertEquals(400, assertThrows(ApiException.class, () -> service.chat(request(tooLong))).getCode());
    verifyNoInteractions(agent, gem);
  }

  @Test void rejectsUnorderedDuplicateOrNonHttpFramesBeforeCallingAgent() throws Exception {
    for (String problem : List.of("unordered", "duplicate", "blob", "image-collision", "short")) {
      var body = body();
      var frames = (com.fasterxml.jackson.databind.node.ArrayNode) body.path("referenceVideo").path("frames");
      var second = (ObjectNode) frames.get(1);
      if (problem.equals("unordered")) second.put("time", 0.01);
      if (problem.equals("duplicate")) second.put("url", frames.get(0).path("url").asText());
      if (problem.equals("blob")) second.put("url", "blob:frame");
      if (problem.equals("image-collision")) second.put("url", "https://assets.example/product.png");
      if (problem.equals("short")) { frames.remove(2); frames.remove(1); }
      assertEquals(400, assertThrows(ApiException.class, () -> service.chat(request(body))).getCode());
    }
    verifyNoInteractions(agent, gem);
  }

  @Test void rejectsVisualBudgetOverflowRatherThanSilentlyDroppingVideoFrames() throws Exception {
    var body = body();
    var frames = (com.fasterxml.jackson.databind.node.ArrayNode) body.path("referenceVideo").path("frames");
    frames.removeAll();
    for (int index = 0; index < 8; index++) {
      frames.addObject().put("url", "https://assets.example/frame" + index + ".jpg").put("time", index * 14);
    }
    assertEquals(400, assertThrows(ApiException.class, () -> service.chat(request(body))).getCode());
    verifyNoInteractions(agent, gem);
  }
}
