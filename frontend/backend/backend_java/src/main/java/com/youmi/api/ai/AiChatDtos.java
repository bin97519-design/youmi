package com.youmi.api.ai;

import java.util.List;

public final class AiChatDtos {
  private AiChatDtos() {}

  public record Message(String role, String content) {}

  public record CompletionRequest(List<Message> messages, Double temperature) {}

  public record CompletionResult(String provider, String model, String content) {}

  public record OptimizeProductInfoRequest(String productInfo, List<String> productImages) {}

  public record OptimizeProductInfoResponse(String provider, String model, String productInfo) {}

  public record StatusResponse(
      boolean configured,
      String baseUrl,
      String chatPath,
      String model,
      double temperature,
      int timeoutSeconds) {}
}
