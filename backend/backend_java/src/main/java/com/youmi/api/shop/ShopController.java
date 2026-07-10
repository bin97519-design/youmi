package com.youmi.api.shop;

import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiResponse;
import java.util.List;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 店铺接口。
 *
 * <ul>
 *   <li>后台 CRUD：{@code /api/admin/shops}（需 ADMIN 权限）</li>
 *   <li>公开列表：{@code /api/shops}（无需登录，仅返回 ACTIVE 店铺，供注册页下拉）</li>
 * </ul>
 */
@RestController
@RequestMapping("/api")
public class ShopController {
  private final AdminAuthService adminAuthService;
  private final ShopService shopService;

  public ShopController(AdminAuthService adminAuthService, ShopService shopService) {
    this.adminAuthService = adminAuthService;
    this.shopService = shopService;
  }

  @PostMapping("/admin/shops")
  public ApiResponse<ShopDtos.ShopView> createShop(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody ShopDtos.ShopCreateRequest request) {
    adminAuthService.requireAdmin(authorization);
    return ApiResponse.ok("店铺创建成功", shopService.createShop(request));
  }

  @PutMapping("/admin/shops/{id}")
  public ApiResponse<ShopDtos.ShopView> updateShop(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable Long id,
      @RequestBody ShopDtos.ShopUpdateRequest request) {
    adminAuthService.requireAdmin(authorization);
    return ApiResponse.ok("店铺已更新", shopService.updateShop(id, request));
  }

  @GetMapping("/admin/shops")
  public ApiResponse<List<ShopDtos.ShopView>> listShops(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestParam(value = "status", required = false) String status) {
    adminAuthService.requireAdmin(authorization);
    return ApiResponse.ok(shopService.listShops(status));
  }

  @DeleteMapping("/admin/shops/{id}")
  public ApiResponse<Void> deleteShop(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable Long id) {
    adminAuthService.requireAdmin(authorization);
    shopService.deleteShop(id);
    return ApiResponse.ok("店铺已删除", null);
  }

  /** 公开接口：注册页下拉取数，返回 ACTIVE 店铺的 id/name/code。 */
  @GetMapping("/shops")
  public ApiResponse<List<ShopDtos.ShopPublicView>> publicShops() {
    return ApiResponse.ok(shopService.listActiveShops());
  }
}
