package com.youmi.api.detail;

import java.util.List;

public final class DetailPromptDtos {
  private DetailPromptDtos() {}

  public record PromptRequest(
      String productInfo,
      String platform,
      String ratio,
      String model,
      String style,
      String screens,
      List<ScreenPlan> plans) {}

  public record ScreenPlan(
      String id,
      int index,
      String title,
      String goal,
      String copy,
      String visual,
      String category,
      String proof) {}

  public record PromptResponse(String provider, String model, List<ScreenPrompt> prompts) {}

  public record ScreenPrompt(
      String id,
      int index,
      String positive,
      String negative,
      String layout,
      String text,
      String modelInput) {}
}
