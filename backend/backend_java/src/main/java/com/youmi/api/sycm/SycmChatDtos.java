package com.youmi.api.sycm;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

public final class SycmChatDtos {
  private SycmChatDtos() {}

  public record ImportRequest(String batchId, String shopId, String shopName,
      List<JsonNode> consultations, List<JsonNode> messages) {}

  public record ImportResult(String batchId, String shopId, int consultationsProcessed,
      int messagesProcessed, boolean replayed) {}

  public record Page(long total, int page, int pageSize, List<JsonNode> items) {}
}
