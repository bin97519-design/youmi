package com.youmi.api.platform;

public final class PlatformDtos {
  private PlatformDtos() {
  }

  public record PlatformCreateRequest(String name, String code, Integer sortOrder) {
  }

  public record PlatformUpdateRequest(String name, String status, Integer sortOrder) {
  }

  public record PlatformView(
      Long id,
      String name,
      String code,
      String status,
      Integer sortOrder,
      String createdAt,
      String updatedAt) {
  }

  public record PlatformPublicView(Long id, String name, String code) {
  }
}
