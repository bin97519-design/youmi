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
public class AdminTaskListController {
  private final AdminAuthService auth;
  private final AdminTaskListService service;

  public AdminTaskListController(AdminAuthService auth, AdminTaskListService service) {
    this.auth = auth;
    this.service = service;
  }

  @GetMapping("/tasks")
  public ApiResponse<AdminTaskListService.TaskPage> tasks(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestParam(defaultValue = "all") String kind,
      @RequestParam(required = false) String dateFrom,
      @RequestParam(required = false) String dateTo,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) String model,
      @RequestParam(required = false) Long userId,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int pageSize) {
    UserAccount user = auth.requireLogin(authorization);
    return ApiResponse.ok(service.tasks(auth.isAdmin(user) ? null : user.id(), kind,
        dateFrom, dateTo, status, model, userId, page, pageSize));
  }
}
