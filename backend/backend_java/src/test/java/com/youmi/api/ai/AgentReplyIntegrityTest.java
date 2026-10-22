package com.youmi.api.ai;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.junit.jupiter.api.Test;

class AgentReplyIntegrityTest {
  private final ObjectMapper mapper = new ObjectMapper();

  @Test void providerContentBlocksAreFailuresEvenWhenTheHttpRequestSucceeded() throws Exception {
    for (String json : List.of(
        "{\"promptFeedback\":{\"blockReason\":\"SAFETY\"}}",
        "{\"candidates\":[{\"finishReason\":\"PROHIBITED_CONTENT\"}]}",
        "{\"choices\":[{\"finish_reason\":\"content_filter\"}]}",
        "{\"choices\":[{\"message\":{\"refusal\":\"This request was blocked\"}}]}"))
      assertThrows(AgentReplyIntegrity.BlockedReply.class,
          () -> AgentReplyIntegrity.requireCompleteOutput(mapper.readTree(json)));
  }

  @Test void routerPolicyNoticesAreNotDraftsAndNormalDescriptionsRemainAllowed() {
    assertThrows(AgentReplyIntegrity.BlockedReply.class, () -> AgentReplyIntegrity.requireNotBlocked(
        "The prompt could not be submitted. The prompt contains sensitive words that violate Google's "
            + "[Generative AI Prohibited Use policy](https://policies.google.com/terms/generative-ai/use-policy)."));
    assertDoesNotThrow(() -> AgentReplyIntegrity.requireNotBlocked("小女孩在卧室床边揉眼睛，母亲整理枕头。"));
    assertDoesNotThrow(() -> AgentReplyIntegrity.requireNotBlocked("Explain the Generative AI Prohibited Use policy."));
  }

  @Test void rejectsBothProviderOutputLimitSignalsEvenWhenSomeTextWasReturned() throws Exception {
    for (String json : List.of(
        "{\"choices\":[{\"finish_reason\":\"length\",\"delta\":{\"content\":\"分镜1\"}}]}",
        "{\"candidates\":[{\"finishReason\":\"MAX_TOKENS\",\"content\":{\"parts\":[{\"text\":\"分镜1\"}]}}]}"))
      assertThrows(AgentReplyIntegrity.IncompleteReply.class,
          () -> AgentReplyIntegrity.requireCompleteOutput(mapper.readTree(json)));
    assertDoesNotThrow(() -> AgentReplyIntegrity.requireCompleteOutput(mapper.readTree(
        "{\"candidates\":[{\"finishReason\":\"STOP\"}]}")));
  }

  @Test void unfinishedStringsAndObjectsCannotBePatchedClosedAsSuccessfulReplies() {
    for (String json : List.of("{\"draftPrompt\":\"小女孩揉", "{\"draftPrompts\":[\"完整句子\"]",
        "{\"draftPrompts\":[\"句子结尾\\"))
      assertThrows(AgentReplyIntegrity.IncompleteReply.class, () -> AgentReplyIntegrity.requireClosedJson(json));
    for (String json : List.of("```json\n{\"reply\":\"花纹像 {树叶}，保留\\\"文字\\\"\",}\n```",
        "{'reply':'完成','draftPrompts':['保留图1']}"))
      assertDoesNotThrow(() -> AgentReplyIntegrity.requireClosedJson(json));
  }

  @Test void timedSourceVideoPromptMustReachTheEndOfTheSource() {
    assertThrows(AgentReplyIntegrity.IncompleteReply.class, () -> AgentReplyIntegrity.requireVideoCoverage(
        List.of("分镜1（0秒-9秒）：身穿碎花睡衣的小女孩揉"), 57.68, true));
    assertDoesNotThrow(() -> AgentReplyIntegrity.requireVideoCoverage(
        List.of("分镜1（0秒-9秒）：开场。\n分镜2（9秒-57.7秒）：后续至结束。"), 57.68, true));
    assertDoesNotThrow(() -> AgentReplyIntegrity.requireVideoCoverage(
        List.of("分镜1（0秒-15秒）：完整的15秒版本。"), 15, false));
  }
}
