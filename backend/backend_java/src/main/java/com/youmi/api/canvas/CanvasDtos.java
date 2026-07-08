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

  /** 管理员全局列表视图：附带 ownerId 以标识画布归属 */
  public record AdminCanvasSummary(
      Long ownerId,
      String docId,
      String title,
      String thumbnailUrl,
      boolean isReversePrompt,
      long updatedAt) {
  }

  /** 管理员全局详情视图：附带 ownerId 以标识画布归属 */
  public record AdminCanvasDetail(
      Long ownerId,
      String docId,
      String title,
      CanvasPayload payload,
      String thumbnailUrl,
      boolean isReversePrompt,
      long createdAt,
      long updatedAt) {
  }
}
