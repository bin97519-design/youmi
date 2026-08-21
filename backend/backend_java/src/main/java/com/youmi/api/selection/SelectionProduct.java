package com.youmi.api.selection;

import java.time.LocalDateTime;

public record SelectionProduct(
    Long id,
    Long userId,
    String sourcePlatform,
    String sourceProductId,
    String sourceUrl,
    String title,
    String coverImageUrl,
    String productData,
    String rawSnapshot,
    String collectSource,
    String collectStatus,
    String publishStatus,
    boolean hasAiEdit,
    int qualityScore,
    Long originProductRowId,
    String originProductId,
    String lastCollectError,
    LocalDateTime lastCollectedAt,
    LocalDateTime createdAt,
    LocalDateTime updatedAt) {}

