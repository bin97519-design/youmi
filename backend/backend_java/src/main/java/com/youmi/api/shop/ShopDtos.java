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

  /** 新建店铺请求：name、code 必填，platform 可选。 */
  public record ShopCreateRequest(String name, String code, String platform) {
  }

  /** 更新店铺请求：可改 name 与 status。 */
  public record ShopUpdateRequest(String name, String status) {
  }

  /** 后台店铺视图（含完整字段）。 */
  public record ShopView(
      Long id,
      String name,
      String code,
      String platform,
      String status,
      String createdAt,
      String updatedAt) {
  }

  /** 公开店铺视图（注册页下拉取数，仅暴露 id/name/code）。 */
  public record ShopPublicView(Long id, String name, String code) {
  }
}
