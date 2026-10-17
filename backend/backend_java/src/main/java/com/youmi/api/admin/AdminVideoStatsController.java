package com.youmi.api.admin;

import com.youmi.api.auth.UserAccount;
import com.youmi.api.common.ApiResponse;
import com.youmi.api.common.ApiException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin")
public class AdminVideoStatsController {
  private final AdminAuthService auth;
  private final AdminVideoStatsService stats;
  public AdminVideoStatsController(AdminAuthService auth, AdminVideoStatsService stats) {
    this.auth = auth;
    this.stats = stats;
  }
  @GetMapping("/video-stats")
  public ApiResponse<AdminVideoStatsService.Response> videoStats(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestParam(defaultValue = "VIDEO") String taskType,
      @RequestParam(required = false) String dateFrom,
      @RequestParam(required = false) String dateTo,
      @RequestParam(required = false) String scope) {
    UserAccount user = auth.requireLogin(authorization);
    if ("shop".equalsIgnoreCase(scope) && !auth.isStoreManager(user)) {
      throw new ApiException(403, "没有店铺统计权限");
    }
    if (auth.isStoreManager(user) && (!auth.isAdmin(user) || "shop".equalsIgnoreCase(scope))) {
      return ApiResponse.ok(stats.statsForShop(auth.requireStoreManagerShopId(authorization), taskType, dateFrom, dateTo));
    }
    return ApiResponse.ok(stats.stats(auth.isAdmin(user) ? null : user.id(), taskType, dateFrom, dateTo));
  }
}
