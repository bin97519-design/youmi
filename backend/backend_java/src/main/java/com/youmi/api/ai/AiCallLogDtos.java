package com.youmi.api.ai;

import java.time.Instant;

public final class AiCallLogDtos {
  private AiCallLogDtos() {}

  public record Row(
      long id,
      String source,
      String operation,
      String provider,
      String model,
      Long apiKeyId,
      String apiKeyName,
      String selectionMode,
      String status,
      Integer httpStatus,
      long durationMs,
      String errorCode,
      Instant createdAt) {}
}
