package com.youmi.api.admin;

import com.youmi.api.auth.UserAccount;
import com.youmi.api.auth.UserRepository;
import com.youmi.api.common.ApiException;
import com.youmi.api.common.ApiResponse;
import com.youmi.api.credit.MiValueDtos;
import com.youmi.api.credit.MiValueService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 管理后台：查询 / 调整用户米值。所有接口需 ADMIN 权限（复用 {@link AdminAuthService#requireAdmin}）。
 */
@RestController
@RequestMapping("/api/admin/user")
public class AdminMiValueController {
  private final AdminAuthService adminAuthService;
  private final UserRepository userRepository;
  private final MiValueService miValueService;

  public AdminMiValueController(
      AdminAuthService adminAuthService,
      UserRepository userRepository,
      MiValueService miValueService) {
    this.adminAuthService = adminAuthService;
    this.userRepository = userRepository;
    this.miValueService = miValueService;
  }

  /** 查询指定用户的米值余额与套餐名 */
  @GetMapping("/{id}/mi-value")
  public ApiResponse<MiValueDtos.MiValueAdminView> getMiValue(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable Long id) {
    adminAuthService.requireAdmin(authorization);
    UserAccount user = userRepository.findById(id)
        .orElseThrow(() -> new ApiException(404, "用户不存在"));
    return ApiResponse.ok(new MiValueDtos.MiValueAdminView(
        user.miValue() != null ? user.miValue() : 0, user.planName()));
  }

  /** 调整指定用户的米值（正为充值，负为扣减；不允许负余额），返回最新余额 */
  @PostMapping("/{id}/mi-value")
  public ApiResponse<MiValueDtos.MiValueAdminView> adjustMiValue(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable Long id,
      @RequestBody MiValueDtos.MiValueAdjustRequest body) {
    adminAuthService.requireAdmin(authorization);
    miValueService.adjustByAdmin(id, body.delta(), body.reason());
    UserAccount user = userRepository.findById(id)
        .orElseThrow(() -> new ApiException(404, "用户不存在"));
    return ApiResponse.ok(new MiValueDtos.MiValueAdminView(
        user.miValue() != null ? user.miValue() : 0, user.planName()));
  }
}
