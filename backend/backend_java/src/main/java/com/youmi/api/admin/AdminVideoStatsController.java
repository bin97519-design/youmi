package com.youmi.api.admin;

import com.youmi.api.auth.UserAccount;
import com.youmi.api.common.ApiResponse;
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
      @RequestParam(required = false) String dateTo) {
    UserAccount user = auth.requireLogin(authorization);
    return ApiResponse.ok(stats.stats(auth.isAdmin(user) ? null : user.id(), taskType, dateFrom, dateTo));
  }
}
