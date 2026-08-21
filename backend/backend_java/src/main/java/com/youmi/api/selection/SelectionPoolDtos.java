package com.youmi.api.selection;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

public final class SelectionPoolDtos {
  private SelectionPoolDtos() {}

  public record ProductUpsertRequest(
      String sourcePlatform,
      String sourceProductId,
      String sourceUrl,
      String title,
      String coverImageUrl,
      JsonNode productData,
      JsonNode rawSnapshot,
      String collectSource,
      String collectStatus,
      Integer qualityScore,
      Long originProductRowId,
      String originProductId) {}

  public record BulkUpsertRequest(List<ProductUpsertRequest> products) {}

  public record ProductPatchRequest(
      String title,
      String coverImageUrl,
      String sourceUrl,
      JsonNode productData,
      Boolean hasAiEdit) {}

  public record ProductView(
      Long id,
      String sourcePlatform,
      String sourceProductId,
      String sourceUrl,
      String title,
      String coverImageUrl,
      JsonNode productData,
      JsonNode rawSnapshot,
      String collectSource,
      String collectStatus,
      String publishStatus,
      boolean hasAiEdit,
      int qualityScore,
      Long originProductRowId,
      String originProductId,
      String lastCollectError,
      String lastCollectedAt,
      String createdAt,
      String updatedAt,
      List<TagView> tags) {}

  public record ProductPage(List<ProductView> items, long total, int page, int pageSize) {}

  public record BulkUpsertResult(int created, int updated, List<ProductView> items) {}

  public record TagSaveRequest(String name, String color) {}

  public record TagAssignRequest(List<Long> productRowIds, List<Long> tagIds) {}

  public record TagView(Long id, String name, String color, long productCount) {}

  public record BatchDeleteRequest(List<Long> productRowIds) {}

  public record MigrationCreateRequest(
      List<Long> productRowIds,
      String targetPlatform,
      String targetShopRef,
      JsonNode options) {}

  public record MigrationTaskView(
      String taskId,
      String targetPlatform,
      String targetShopRef,
      String status,
      int totalCount,
      int successCount,
      int failedCount,
      JsonNode options,
      String createdAt,
      String updatedAt) {}

  public record MigrationItemHandoff(
      Long productRowId,
      Integer sequenceNo,
      String status,
      JsonNode sourceSnapshot) {}

  public record MigrationHandoffView(
      MigrationTaskView task,
      List<MigrationItemHandoff> items) {}

  public record MigrationItemResultRequest(
      Integer sequenceNo,
      String status,
      String targetProductId,
      String targetUrl,
      String errorCode,
      String errorMessage) {}
}

