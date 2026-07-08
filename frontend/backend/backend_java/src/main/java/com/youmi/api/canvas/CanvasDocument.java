package com.youmi.api.canvas;

import java.util.ArrayList;
import java.util.List;

public record CanvasDocument(
    Long id,
    String docId,
    Long userId,
    String title,
    CanvasPayload payload,
    String thumbnailUrl,
    boolean isReversePrompt,
    long createdAt,
    long updatedAt) {
}
