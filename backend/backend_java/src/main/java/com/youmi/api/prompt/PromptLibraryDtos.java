package com.youmi.api.prompt;

import java.util.List;

public final class PromptLibraryDtos {
  private PromptLibraryDtos() {}

  public record SaveRequest(
      String title,
      String content,
      String category,
      List<String> tags,
      String source) {}

  public record PromptResponse(
      Long id,
      String scope,
      String title,
      String content,
      String category,
      List<String> tags,
      String source,
      int useCount,
      Long lastUsedAt,
      long createdAt,
      long updatedAt) {}
}
