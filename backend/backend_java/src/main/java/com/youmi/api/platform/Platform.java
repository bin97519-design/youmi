package com.youmi.api.platform;

public record Platform(
    Long id,
    String name,
    String code,
    String status,
    Integer sortOrder,
    String createdAt,
    String updatedAt) {
}
