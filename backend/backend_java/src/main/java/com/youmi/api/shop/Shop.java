package com.youmi.api.shop;

/**
 * 店铺领域实体。
 *
 * <p>对应数据库表 {@code ym_shop}，字段与 schema.sql 中定义保持一致。
 */
public record Shop(
    Long id,
    String name,
    String code,
    Long platformId,
    String platformCode,
    String platformName,
    String status,
    String createdAt,
    String updatedAt) {
}
