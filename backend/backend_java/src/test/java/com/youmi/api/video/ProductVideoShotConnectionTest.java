package com.youmi.api.video;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.youmi.api.ai.AgentChatClient;
import com.youmi.api.ai.AiChatDtos;
import com.youmi.api.common.ApiException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class ProductVideoShotConnectionTest {
  private final ObjectMapper mapper = new ObjectMapper();
  private final AgentChatClient client = mock(AgentChatClient.class);
  private final ProductVideoPlanService service = new ProductVideoPlanService(client, mapper, 180);

  @Test void persistsStructuredStartEndAndTransitionWithoutRewritingGeneratedPrompts() throws Exception {
    var outline = outline(3);
    var result = service.parseDetails(details(3).toString(), outline);
    assertEquals("opening", result.get(0).connection().type());
    assertEquals("continue", result.get(1).connection().type());
    assertEquals("纱帘闭合，右手仍握住帘边", result.get(1).connection().startState());
    assertEquals("右手轻抚，纱帘仍闭合", result.get(1).connection().endState());
    assertEquals("从上一镜结束位置延续动作", result.get(1).connection().transition());
    assertEquals("已生成的镜头动作1", result.get(1).motion());
    assertEquals(result.get(1), mapper.readValue(mapper.writeValueAsString(result.get(1)), ProductVideoDtos.ShotPlan.class));
  }

  @Test void eachBatchReceivesExplicitNeighborsIncludingTheNextBatchAndCompletedPreviousBatch() throws Exception {
    when(client.isConfigured()).thenReturn(true);
    var inputs = new ArrayList<JsonNode>();
    var prompts = new ArrayList<String>();
    when(client.completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class)))
        .thenAnswer(invocation -> {
          var input = mapper.readTree(invocation.getArgument(1, String.class));
          inputs.add(input);
          prompts.add(invocation.getArgument(0));
          return new AiChatDtos.CompletionResult("mock", "test",
              input.has("outline") ? details(input.path("outline").path("shots").size()).toString() : outline(6).toString());
        });
    var request = new ProductVideoDtos.PlanRequest("同一客厅内拉合纱帘，触摸后全景收尾", List.of("https://media.example/product.jpg"),
        6, "9:16", null, List.of());
    assertEquals(6, service.plan(request).shots().size());
    var first = inputs.get(1).path("shotConnections");
    assertFalse(first.get(0).has("previous"));
    assertEquals("镜头1", first.get(0).path("next").path("title").asText());
    assertEquals("镜头2", first.get(1).path("next").path("title").asText());
    assertEquals("纱帘闭合，右手仍握住帘边", first.get(1).path("previous").path("endState").asText());
    var second = inputs.get(2).path("shotConnections").get(0);
    assertEquals(5, second.path("shotNumber").asInt());
    assertEquals("镜头3", second.path("previous").path("title").asText());
    assertEquals("镜头5", second.path("next").path("title").asText());
    assertFalse(inputs.get(2).path("shotConnections").get(1).has("next"));
    assertEquals(4, inputs.get(2).path("completedShots").size());
    assertTrue(prompts.get(0).contains("不是互不相干的卖点合集"));
    assertTrue(prompts.get(0).contains("相邻镜头在动作或连续运镜中交接"));
    assertTrue(prompts.get(0).contains("屏幕运动方向和速度"));
    assertTrue(prompts.get(0).contains("不只匹配两张静态画面"));
    assertTrue(prompts.get(0).contains("参考视频原有的停顿和转场须忠实保留"));
    assertTrue(prompts.get(1).contains("即使跨批次也必须执行"));
    for (var prompt : prompts.subList(1, prompts.size())) {
      assertTrue(prompt.contains("从第0秒接上前镜的动作阶段、屏幕运动方向与速度"));
      assertTrue(prompt.contains("有 next 时，裁剪点落在可接续的动作或已规划的连续运镜中"));
      assertTrue(prompt.contains("切出/切入写明连接对象、屏幕位置、方向与速度"));
      assertTrue(prompt.contains("只有整片末镜或明确的叙事停顿可自然停稳"));
      assertTrue(prompt.contains("参考视频的原有停顿及转场除外"));
    }
    assertTrue(prompts.get(1).contains("每镜时长采用对应 outline.duration"));
    assertTrue(prompts.get(1).contains("本镜时长：N秒"));
    assertFalse(prompts.get(1).contains("原片 15 秒，核心动作"));
  }

  @Test void refinementUsesTheExplicitCurrentMarkerNotAnAmbiguousRepeatedTitle() throws Exception {
    when(client.isConfigured()).thenReturn(true);
    var connection = new ProductVideoDtos.ShotConnection("开始", "结束", "match_cut", "动作匹配切换");
    var current = new ProductVideoDtos.ShotPlan("同名镜头", "首帧", "动作", "", 4, "目的", "设计", null, null, connection);
    var context = List.of(
        new ProductVideoDtos.ShotContext("同名镜头", "前镜", "设计", "故事线", new ProductVideoDtos.ShotConnection("开始", "前镜结束", "opening", "开场"), false),
        new ProductVideoDtos.ShotContext("同名镜头", "本镜", "设计", "故事线", connection, true),
        new ProductVideoDtos.ShotContext("同名镜头", "后镜", "设计", "故事线", new ProductVideoDtos.ShotConnection("后镜开始", "结束", "match_cut", "切换"), false));
    var inputs = new ArrayList<JsonNode>();
    when(client.completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class)))
        .thenAnswer(invocation -> {
          var input = mapper.readTree(invocation.getArgument(1, String.class));
          inputs.add(input);
          return new AiChatDtos.CompletionResult("mock", "test", input.has("outline") ? details(1).toString() : outline(1).toString());
        });
    service.plan(new ProductVideoDtos.PlanRequest("完善当前镜，不改其他镜", List.of("https://media.example/product.jpg"),
        1, "9:16", current, context));
    var link = inputs.get(1).path("shotConnections").get(0);
    assertEquals("前镜结束", link.path("previous").path("connection").path("endState").asText());
    assertEquals("后镜开始", link.path("next").path("connection").path("startState").asText());
  }

  @Test void legacyOutlineAndDtoRemainCompatibleButInvalidTransitionTypesAreRejected() throws Exception {
    var outline = outline(3);
    for (var shot : outline.path("shots")) ((ObjectNode) shot).remove("transitionType");
    var results = service.parseDetails(details(3).toString(), outline);
    assertEquals("opening", results.get(0).connection().type());
    assertEquals("match_cut", results.get(1).connection().type());
    assertNull(mapper.readValue("{\"title\":\"旧镜头\",\"imagePrompt\":\"首帧\",\"motion\":\"动作\",\"duration\":4}", ProductVideoDtos.ShotPlan.class).connection());
    ((ObjectNode) outline.path("shots").get(1)).put("transitionType", "random-reset");
    assertThrows(ApiException.class, () -> service.parseOutline(outline.toString(), 3));
  }

  @Test void boundsClientSuppliedConnectionMetadataBeforeAnyModelRequest() {
    var connection = new ProductVideoDtos.ShotConnection("x".repeat(201), "结束", "continue", "延续");
    var current = new ProductVideoDtos.ShotPlan("镜头", "首帧", "动作", "", 4, "目的", "设计", null, null, connection);
    assertThrows(ApiException.class, () -> service.validate(new ProductVideoDtos.PlanRequest("商品资料", List.of(), 1, "9:16", current, List.of())));
    verifyNoInteractions(client);
  }

  private ObjectNode outline(int count) {
    var result = mapper.createObjectNode().put("analysis", "白色纱帘").put("concept", "拉合、触摸、收尾");
    var shots = result.putArray("shots");
    for (int i = 0; i < count; i++) {
      var shot = shots.addObject().put("title", "镜头" + i).put("purpose", "目的" + i)
          .put("evidence", "商品参考图").put("scene", "同一客厅").put("action", "动作" + i)
          .put("startState", i == 0 ? "纱帘打开" : "纱帘闭合，右手仍握住帘边")
          .put("endState", i == 0 ? "纱帘闭合，右手仍握住帘边" : "右手轻抚，纱帘仍闭合")
          .put("transitionType", i == 0 ? "opening" : i == 1 ? "continue" : "match_cut")
          .put("transition", i == 0 ? "建立开场" : "从上一镜结束位置延续动作").put("duration", 4);
      shot.putObject("people").put("mode", "hands").put("reason", "保持同一右手");
    }
    return result;
  }

  private ObjectNode details(int count) {
    var result = mapper.createObjectNode();
    var shots = result.putArray("shots");
    for (int i = 0; i < count; i++) shots.addObject().put("shotIndex", i + 1).put("peopleMode", "hands")
        .put("imagePrompt", "首帧" + i).put("motion", "已生成的镜头动作" + i).put("caption", "");
    return result;
  }
}
