package com.youmi.api.shop;

/**
 * 店铺相关请求/响应 DTO。
 *
 * <p>字段命名遵循团队约定：入参/出参店铺主键为 {@code shopId}（Long），
 * 仅出参的店铺名称为 {@code shopName}（String）。
 */
public final class ShopDtos {
  private ShopDtos() {
  }

  /** 新建店铺请求：平台 ID 优先，platform 保留用于兼容旧客户端。 */
  public record ShopCreateRequest(String name, String code, Long platformId, String platform) {
    public ShopCreateRequest(String name, String code, String platform) {
      this(name, code, null, platform);
    }
  }

  public record ShopUpdateRequest(String name, Long platformId, String status) {
    public ShopUpdateRequest(String name, String status) {
      this(name, null, status);
    }
  }

  /** 后台店铺视图（含完整字段）。 */
  public record ShopView(
      Long id,
      String name,
      String code,
      Long platformId,
      String platformCode,
      String platformName,
      /** 兼容旧客户端，值与 platformName 相同。 */
      String platform,
      String status,
      String createdAt,
      String updatedAt) {
  }

  public record ShopPublicView(
      Long id,
      String name,
      String code,
      Long platformId,
      String platformCode,
      String platformName) {
  }
}
