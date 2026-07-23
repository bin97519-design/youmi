package com.youmi.api.creative;

import java.util.List;

public final class CanvasCreativeDtos {
  private CanvasCreativeDtos() {}

  public record DemandRequest(
      String productInfo,
      List<String> productImages,
      Integer count,
      String platform,
      String style) {}

  public record DemandCard(
      String id,
      int index,
      String dimension,
      String title,
      String audience,
      String scene,
      String need,
      String sellingPoint,
      String copy,
      String visualDirection,
      String imagePrompt) {}

  public record DemandResponse(
      String provider,
      String model,
      List<DemandCard> cards) {}
}
