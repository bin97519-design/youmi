package com.youmi.api.ai;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/** Checks completeness separately from permissive JSON format repair. */
final class AgentReplyIntegrity {
  private AgentReplyIntegrity() {}

  static final class IncompleteReply extends IllegalStateException {
    IncompleteReply(String message) { super(message); }
  }

  static final class BlockedReply extends IllegalStateException {
    BlockedReply() {
      super("模型通道的内容审核拦截了本次请求，没有返回分析结果。原输入和素材已保留；通道未说明具体触发原因。");
    }
  }

  private static final Set<String> BLOCKED_REASONS = Set.of("SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT",
      "RECITATION", "SPII", "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT", "CONTENT_FILTER");

  static void requireNotBlocked(String content) {
    String text = content == null ? "" : content.strip().toLowerCase(Locale.ROOT);
    if (text.startsWith("error:")) text = text.substring(6).strip();
    if (text.startsWith("the prompt could not be submitted")
        && (text.contains("sensitive words") || text.contains("generative ai prohibited use policy")))
      throw new BlockedReply();
  }

  static void requireCompleteOutput(JsonNode response) {
    String reason = response.path("choices").path(0).path("finish_reason").asText("");
    String nativeReason = response.path("candidates").path(0).path("finishReason").asText("");
    String blockReason = response.path("promptFeedback").path("blockReason").asText("");
    JsonNode choice = response.path("choices").path(0);
    if (BLOCKED_REASONS.contains(reason.toUpperCase(Locale.ROOT))
        || BLOCKED_REASONS.contains(nativeReason.toUpperCase(Locale.ROOT))
        || (!blockReason.isBlank() && !"BLOCK_REASON_UNSPECIFIED".equals(blockReason))
        || !choice.path("message").path("refusal").asText("").isBlank()
        || !choice.path("delta").path("refusal").asText("").isBlank())
      throw new BlockedReply();
    if ("length".equalsIgnoreCase(reason) || "MAX_TOKENS".equalsIgnoreCase(nativeReason))
      throw new IncompleteReply("模型回复被输出额度截断，尚未返回完整内容");
  }

  static void requireClosedJson(String content) {
    if (content == null) return;
    int start = content.indexOf('{');
    if (start < 0) return; // Non-JSON formatting errors may still be repaired.
    int depth = 0;
    char quote = 0;
    boolean escaped = false;
    for (int index = start; index < content.length(); index++) {
      char value = content.charAt(index);
      if (quote != 0) {
        if (escaped) escaped = false;
        else if (value == '\\') escaped = true;
        else if (value == quote) quote = 0;
      } else if (value == '"' || value == '\'') quote = value;
      else if (value == '{' || value == '[') depth++;
      else if (value == '}' || value == ']') {
        if (--depth == 0) return;
      }
    }
    throw new IncompleteReply("模型回复在正文结束前中断，不能把半截内容修复为完整方案");
  }

  private static final Pattern SHOT_TIME = Pattern.compile(
      "(?:分镜|镜头)\\s*\\d+\\s*[（(]\\s*(\\d+(?:\\.\\d+)?)\\s*(?:秒|s)?\\s*[-—–~～至到]\\s*"
          + "(\\d+(?:\\.\\d+)?)\\s*(?:秒|s)?\\s*[）)]", Pattern.CASE_INSENSITIVE);

  static void requireVideoCoverage(List<String> prompts, double duration, boolean sourceVideo) {
    if (duration <= 0) return;
    for (String prompt : prompts) {
      var matches = SHOT_TIME.matcher(prompt);
      double end = -1;
      while (matches.find()) end = Double.parseDouble(matches.group(2));
      // Older/unstructured formats do not expose a reliably machine-readable timeline.
      if (end >= 0 && end < duration - (sourceVideo ? 1.0 : 0.1))
        throw new IncompleteReply("视频提示词只写到" + end + "秒，尚未覆盖" + duration + "秒完整时间轴");
    }
  }
}
