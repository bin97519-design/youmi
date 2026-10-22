package com.youmi.api.ai;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class CanvasAgentContextMemoryTest {
  final CanvasAgentMemoryRepository repository = mock(CanvasAgentMemoryRepository.class);
  final CanvasAgentContextMemory memory = new CanvasAgentContextMemory(repository, new ObjectMapper());
  CanvasAgentDtos.ChatMessage user(String text) { return new CanvasAgentDtos.ChatMessage("user", text); }
  CanvasAgentDtos.ChatMessage assistant(String text) { return new CanvasAgentDtos.ChatMessage("assistant", text); }

  @Test void preparingContextPreservesExplicitRoutingAndScriptMaterialChoices() throws Exception {
    var mapper = new ObjectMapper();
    var client = mock(AgentChatClient.class);
    var service = new CanvasAgentService(mapper, client);
    service.setContextMemory(memory);
    var request = mapper.readValue("""
        {"canvasId":"canvas","conversationId":"conversation","instruction":"按这个方向继续",
         "history":[{"role":"user","content":"策划15秒窗帘视频"}],
         "scriptBrief":{"sourceMode":"text","referenceCandidates":[]},
         "turnContext":{"message":"按这个方向继续","source":"composer","taskType":"video_script",
           "taskStage":"clarifying","taskGoal":"窗帘卖点视频","pendingQuestions":[],
           "currentReferenceLayerIds":["product"]}}
        """, CanvasAgentDtos.ChatRequest.class);
    var prepared = service.prepareContext(1L, request, null);
    assertEquals(request.history(), prepared.history());
    assertEquals(request.scriptBrief(), prepared.scriptBrief());
    assertEquals(request.turnContext(), prepared.turnContext());
    verifyNoInteractions(client);
  }

  void persisted(AtomicReference<CanvasAgentMemoryRepository.Memory> saved) {
    when(repository.find(1L, "canvas", "conversation")).thenAnswer(call -> Optional.ofNullable(saved.get()));
    doAnswer(call -> { saved.set(call.getArgument(3)); return null; })
        .when(repository).save(eq(1L), eq("canvas"), eq("conversation"), any());
  }

  @Test void shortHistoryDoesNotCallAModelOrLoseMessages() throws Exception {
    var history = List.of(user("窗帘遮光"), assistant("请提供图片"));
    var result = memory.prepare(1L, "canvas", "conversation", history,
        (system, input) -> { fail("unnecessary model call"); return ""; }, null);
    assertEquals(history, result.history());
    assertFalse(result.status().compacted());
    verify(repository, never()).save(any(), anyString(), anyString(), any());
  }

  @Test void compactedHistoryIsSavedAndReusedAfterServiceRestartWithoutAnotherModelCall() throws Exception {
    var saved = new AtomicReference<CanvasAgentMemoryRepository.Memory>();
    persisted(saved);
    String rules = "用户完整创作规则".repeat(3000);
    var history = new ArrayList<>(List.of(user(rules), assistant("请提供商品资料"), user("图1绿色窗帘，图2人物")));
    var calls = new AtomicInteger();
    var first = memory.prepare(1L, "canvas", "conversation", history, (system, input) -> {
      calls.incrementAndGet();
      assertTrue(input.contains(rules));
      return "已确认：绿色遮光窗帘；图1商品、图2人物；不生成字幕；采用分镜和口播格式。";
    }, null);
    assertTrue(first.status().compacted());
    assertTrue(first.status().contextChars() < first.status().originalChars());
    assertEquals(1, saved.get().sourceCount());
    history.add(assistant("提示词草稿：完整脚本和具体动作"));
    history.add(user("换个卧室场景"));
    var restarted = new CanvasAgentContextMemory(repository, new ObjectMapper());
    var next = restarted.prepare(1L, "canvas", "conversation", history,
        (system, input) -> { fail("cached summary must not be regenerated"); return ""; }, null);
    assertTrue(next.status().reused());
    assertTrue(next.history().get(0).content().contains("图1商品、图2人物"));
    assertEquals(user("换个卧室场景"), next.history().get(next.history().size() - 1));
    assertEquals(1, calls.get());
  }

  @Test void changedEarlierMessageInvalidatesCachedSummary() throws Exception {
    var saved = new AtomicReference<CanvasAgentMemoryRepository.Memory>();
    persisted(saved);
    var history = new ArrayList<>(List.of(user("原有红色窗帘规则".repeat(3000)), assistant("了解")));
    memory.prepare(1L, "canvas", "conversation", history, (system, input) -> "原商品红色窗帘", null);
    history.set(0, user("修改为绿色窗帘规则".repeat(3000)));
    var result = memory.prepare(1L, "canvas", "conversation", history, (system, input) -> {
      assertFalse(input.contains("原商品红色窗帘"));
      return "最新商品绿色窗帘";
    }, null);
    assertFalse(result.status().reused());
    assertTrue(result.history().get(0).content().contains("最新商品绿色窗帘"));
  }

  @Test void updatesSummaryIncrementallyAndNeverSummarizesTheSamePrefixAgain() throws Exception {
    var saved = new AtomicReference<CanvasAgentMemoryRepository.Memory>();
    persisted(saved);
    var history = new ArrayList<>(List.of(user("旧规则".repeat(10000)), assistant("了解")));
    memory.prepare(1L, "canvas", "conversation", history, (system, input) -> "原摘要", null);
    for (int i = 0; i < 8; i++) history.add(user("新增要求".repeat(1000) + i));
    var result = memory.prepare(1L, "canvas", "conversation", history, (system, input) -> {
      assertTrue(input.contains("原摘要"));
      assertTrue(input.contains("新增要求"));
      assertFalse(input.contains("旧规则".repeat(10000)));
      return "合并新增要求后的摘要";
    }, null);
    assertTrue(result.status().compacted());
    assertTrue(saved.get().sourceCount() > 1);
  }

  @Test void failedCompressionKeepsOriginalHistoryAndDoesNotOverwriteSavedMemory() throws Exception {
    var history = List.of(user("完整要求".repeat(6000)), assistant("收到"));
    var result = memory.prepare(1L, "canvas", "conversation", history,
        (system, input) -> { throw new java.io.IOException("upstream failed"); }, null);
    assertEquals(history, result.history());
    assertFalse(result.status().compacted());
    verify(repository, never()).save(any(), anyString(), anyString(), any());
  }

  @Test void latestFullDraftIsNotCutOrReplacedWithASummary() throws Exception {
    String latestDraft = "提示词草稿：" + "逐镜详细动作".repeat(4000) + "末尾必须保留";
    var history = List.of(user("初始规则".repeat(5000)), assistant(latestDraft), user("请修改第三个镜头"));
    var result = memory.prepare(1L, "canvas", "conversation", history,
        (system, input) -> "初始规则摘要", null);
    assertEquals(assistant(latestDraft), result.history().get(result.history().size() - 2));
    assertEquals(1, result.status().sourceMessages());
  }

  @Test void summaryCacheIsScopedToAuthenticatedUserCanvasAndConversation() throws Exception {
    var history = List.of(user("长规则".repeat(7000)));
    memory.prepare(8L, "other-canvas", "other-conversation", history, (system, input) -> "隔离摘要", null);
    verify(repository).find(8L, "other-canvas", "other-conversation");
    verify(repository).save(eq(8L), eq("other-canvas"), eq("other-conversation"), any());
    verify(repository, never()).find(1L, "canvas", "conversation");
  }
}
