package com.youmi.api.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class CanvasAgentScriptCollaborationTest {
  private final ObjectMapper mapper = new ObjectMapper();

  @Test
  void preservesCompleteReadableScriptAndCreativeDurationBeyondPaidSingleSegment() throws Exception {
    var client = mock(AgentChatClient.class);
    when(client.isConfigured()).thenReturn(true);
    String script = """
        # 把日常拉回舒服的节奏

        ## 创作方向
        窗帘电商情景广告，成片60秒。用回家后的客厅生活表达柔和氛围，不承诺未经确认的遮光性能。

        ## 分镜设计
        | 镜号 | 时间 | 画面与动作 | 景别/运镜 | 声音/字幕 |
        | --- | --- | --- | --- | --- |
        | 1 | 0–12秒 | 主人回到客厅，把包放下 | 全景缓慢推进 | 门锁与脚步环境声 |
        | 2 | 12–27秒 | 手轻轻拉动窗帘，保留原款颜色与褶皱 | 中景跟随手部 | 布料摩擦声 |
        | 3 | 27–45秒 | 主人坐下读书，窗帘成为生活背景 | 中景转近景 | 克制的背景音乐 |
        | 4 | 45–60秒 | 窗边全景自然收尾 | 镜头缓慢后拉 | 旁白与音乐渐弱 |

        ## 旁白/口播设计
        15–25秒：“回到家，把节奏放慢一点。”自然语气，给动作保留停顿。
        47–56秒：“把喜欢的日常，留在窗边。”不夸张叫卖。

        ## 设计要点
        延续已确认的温暖自然风格，保持同款窗帘外观和客厅空间连续，不用AI光线演绎证明商品性能。
        """.strip();
    when(client.completeCanvasAgent(anyList(), anyDouble())).thenReturn(
        new AiChatDtos.CompletionResult("test", "test", mapper.writeValueAsString(Map.of(
            "reply", "按60秒情景叙事整理了完整脚本；生成时需另行确认单段安排。",
            "generationType", "video", "durationSeconds", 60,
            "draftPrompts", List.of(script), "readyToGenerate", true, "questions", List.of()))));
    var history = List.of(
        new CanvasAgentDtos.ChatMessage("user", "想做产品广告，主体是客厅窗帘，温暖自然风格。"),
        new CanvasAgentDtos.ChatMessage("assistant", "这条成片预计多长？更偏情景叙事还是直接展示？"));
    var request = new CanvasAgentDtos.ChatRequest(
        "canvas-1", "60秒，情景叙事，旁白你来定", history,
        List.of(), List.of(), List.of(), "banana2", "1:1", "2K", 1,
        List.of("banana2"), "conversation-1", null,
        new CanvasAgentDtos.VideoDraftSettings("seedance", "9:16", "720p", 15, true, "image"));

    var response = new CanvasAgentService(mapper, client).chat(request);

    assertEquals(List.of(script), response.draftPrompts());
    assertEquals(script, response.draftPrompt());
    assertEquals(60, response.durationSeconds());
    assertFalse(response.readyToGenerate());
    assertTrue(response.questions().isEmpty());
    var sentMessages = ArgumentCaptor.forClass(List.class);
    verify(client).completeCanvasAgent(sentMessages.capture(), anyDouble());
    String sent = sentMessages.getValue().toString();
    assertTrue(sent.contains("主体是客厅窗帘，温暖自然风格"));
    assertTrue(sent.contains("60秒，情景叙事，旁白你来定"));
    assertTrue(sent.contains("当前付费视频生成单段参数"));
    assertTrue(sent.contains("不是用户已选的创意成片时长"));
  }

  @Test
  void scriptPromptAllowsProgressiveClarificationRecommendationsAndFullMarkdownDelivery() throws Exception {
    var client = mock(AgentChatClient.class);
    when(client.isConfigured()).thenReturn(true);
    when(client.completeCanvasAgent(anyList(), anyDouble())).thenReturn(
        new AiChatDtos.CompletionResult("test", "test", mapper.writeValueAsString(Map.of(
            "reply", "再确认成片节奏就能展开脚本。",
            "questions", List.of(Map.of("id", "story-duration", "question", "希望成片多长？",
                "options", List.of("15秒精简展示", "30秒场景故事", "60秒完整叙事")))))));
    var response = new CanvasAgentService(mapper, client).chat(new CanvasAgentDtos.ChatRequest(
        "canvas-1", "继续写", List.of(new CanvasAgentDtos.ChatMessage(
            "user", "为儿童床做一条亲子生活故事，床型是低床，风格自然。")),
        List.of(), List.of(), List.of(), "banana2", "1:1", "2K", 1));

    assertEquals("story-duration", response.questions().get(0).id());
    assertFalse(response.readyToGenerate());
    var sentMessages = ArgumentCaptor.forClass(List.class);
    verify(client).completeCanvasAgent(sentMessages.capture(), anyDouble());
    String system = ((AiChatDtos.Message) sentMessages.getValue().get(0)).content();
    assertTrue(system.contains("不强制固定轮数"));
    assertTrue(system.contains("你来定"));
    assertTrue(system.contains("完整稿默认按“标题 → 创作方向 → 分镜设计Markdown表格"));
    assertTrue(system.contains("字符串内允许Markdown标题、列表与分镜表格"));
    assertFalse(system.contains("默认采用“固定前缀 → 分镜设计 → 口播设计”"));
    assertFalse(system.contains("不额外输出产品分析、策略解释、表格或推荐参数"));
    assertFalse(system.contains("有明确时长时遵从要求，否则使用当前视频时长"));
  }
}
