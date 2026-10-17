package com.youmi.api.common;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.HashMap;
import java.util.Map;

/** Prevent stale failed snapshots from erasing the result of the same video task. */
public final class VideoResultPreservation {
  private VideoResultPreservation() {}

  public static void preserve(JsonNode incoming, JsonNode saved, boolean messages) {
    if (incoming == null || saved == null || !incoming.isArray() || !saved.isArray()) return;
    String urlField = messages ? "videoUrl" : "url";
    Map<String, JsonNode> previous = new HashMap<>();
    saved.forEach(item -> previous.put(item.path("id").asText(), item));
    for (JsonNode item : incoming) {
      JsonNode old = previous.get(item.path("id").asText());
      if (!(item instanceof ObjectNode target) || old == null) continue;
      String task = item.path("taskId").asText();
      if (task.isBlank() || !task.equals(old.path("taskId").asText())) continue;
      if (!messages && !"video".equals(item.path("type").asText())) continue;
      boolean staleFailure = item.path("failed").asBoolean(false)
          || "failed".equals(item.path("status").asText());
      String oldUrl = old.path(urlField).asText("");
      if (!staleFailure || !item.path(urlField).asText("").isBlank() || oldUrl.isBlank()) continue;
      target.put(urlField, oldUrl);
      target.put("generating", false);
      target.put("failed", false);
      target.put("status", "completed");
      target.put("progress", 100);
      target.put("lastError", "");
      target.put(messages ? "text" : "statusText", "视频生成完成，已恢复成片");
    }
  }
}
