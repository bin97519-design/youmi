package com.youmi.api.ai;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.junit.jupiter.api.Test;

class CanvasAgentVideoDraftTest {
  private final ObjectMapper mapper = new ObjectMapper();
  private final AgentChatClient legacy = mock(AgentChatClient.class);
  private final GemAgentClient gem = mock(GemAgentClient.class);
  private final CanvasAgentService service = new CanvasAgentService(mapper, legacy, gem);

  private CanvasAgentDtos.ChatRequest request() throws Exception {
    return mapper.readValue("""
        {"instruction":"按脚本给我视频方案", "agentModel":"gem-3.8-flash", "model":"banana2",
         "layers":[{"id":"chosen","type":"image","url":"https://example.com/chosen.png"},
                   {"id":"other","type":"image","url":"https://example.com/other.png"}],
         "referenceLayerIds":["chosen"],
         "video":{"model":"doubao-seedance-2-5-260628","duration":30,"ratio":"3:4","resolution":"720p","generateAudio":true}}
        """, CanvasAgentDtos.ChatRequest.class);
  }

  private void reply(String json) throws Exception {
    when(gem.complete(anyString(), anyString(), anyList(), anyDouble(), eq(true)))
        .thenReturn(new AiChatDtos.CompletionResult("lk888", GemAgentClient.MODEL, json));
  }

  @Test void multiShotScriptRemainsOneVideoDraftWithOnlyExplicitReferences() throws Exception {
    String script = "1. 0-10秒 窗边远景。\n2. 10-20秒 拉帘特写。\n3. 20-30秒 全景收尾。";
    reply(mapper.writeValueAsString(java.util.Map.of("generationType", "video", "draftPrompts", List.of(script),
        "durationSeconds", 30, "readyToGenerate", true, "referenceLayerIds", List.of("chosen", "other"))));
    var response = service.chat(request());
    assertEquals("video", response.generationType());
    assertEquals(30, response.durationSeconds());
    assertEquals(List.of(script), response.draftPrompts());
    assertEquals(List.of("chosen"), response.referenceLayerIds());
    assertEquals("banana2", response.imageModel());
    assertTrue(response.readyToGenerate());
    verify(gem).complete(contains("文字回复不算生成授权"), contains("doubao-seedance-2-5-260628"),
        eq(List.of("https://example.com/chosen.png")), eq(0.2), eq(true));
    verifyNoInteractions(legacy);
  }

  @Test void missingVideoDurationUsesUserSettingsAndImageResponsesStayCompatible() throws Exception {
    reply("{\"generationType\":\"video\",\"draftPrompts\":[\"script\"],\"readyToGenerate\":true}");
    assertEquals(30, service.chat(request()).durationSeconds());
    reply("{\"draftPrompts\":[\"image prompt\"],\"readyToGenerate\":true}");
    var image = service.chat(request());
    assertEquals("image", image.generationType());
    assertNull(image.durationSeconds());
    assertTrue(image.readyToGenerate());
  }

  @Test void questionsUnknownTypesAndInvalidVideosCannotBecomeConfirmable() throws Exception {
    for (String json : List.of(
        "{\"generationType\":\"video\",\"draftPrompts\":[\"draft\"],\"readyToGenerate\":false}",
        "{\"generationType\":\"execute\",\"draftPrompts\":[\"draft\"],\"readyToGenerate\":true}",
        "{\"generationType\":\"video\",\"durationSeconds\":90,\"draftPrompts\":[\"draft\"],\"readyToGenerate\":true}",
        mapper.writeValueAsString(java.util.Map.of("generationType", "video", "draftPrompts", List.of("x".repeat(2501)), "readyToGenerate", true)))) {
      reply(json);
      assertFalse(service.chat(request()).readyToGenerate());
    }
  }
}
