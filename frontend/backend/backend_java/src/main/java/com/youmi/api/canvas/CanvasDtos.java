package com.youmi.api.canvas;

import java.util.List;

public class CanvasDtos {

  public record SaveRequest(
      String docId,
      String title,
      CanvasPayload payload,
      String thumbnailUrl,
      boolean isReversePrompt) {
  }

  public record CanvasSummary(
      String docId,
      String title,
      String thumbnailUrl,
      boolean isReversePrompt,
      long updatedAt) {
  }

  public record CanvasDetail(
      String docId,
      String title,
      CanvasPayload payload,
      String thumbnailUrl,
      boolean isReversePrompt,
      long createdAt,
      long updatedAt) {
  }
}
