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

/** 管理后台米值消费查询兼容接口。 */
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

  /** 查询指定用户的累计米值消费与套餐名。 */
  @GetMapping("/{id}/mi-value")
  public ApiResponse<MiValueDtos.MiValueConsumptionView> getMiValue(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable Long id) {
    adminAuthService.requireAdmin(authorization);
    UserAccount user = userRepository.findById(id)
        .orElseThrow(() -> new ApiException(404, "用户不存在"));
    return ApiResponse.ok(new MiValueDtos.MiValueConsumptionView(
        miValueService.getConsumedMi(id), user.planName()));
  }

  /** 旧调账接口已停用。 */
  @PostMapping("/{id}/mi-value")
  public ApiResponse<MiValueDtos.MiValueConsumptionView> adjustMiValue(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable Long id,
      @RequestBody MiValueDtos.MiValueAdjustRequest body) {
    adminAuthService.requireAdmin(authorization);
    throw new ApiException(410, "米值余额账户已取消，仅记录实际消费");
  }
}
