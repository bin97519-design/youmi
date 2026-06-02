package com.youmi.api.admin;

import com.youmi.api.common.ApiResponse;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin")
public class AdminController {
  private final AdminAuthService adminAuthService;
  private final AdminService adminService;

  public AdminController(AdminAuthService adminAuthService, AdminService adminService) {
    this.adminAuthService = adminAuthService;
    this.adminService = adminService;
  }

  @GetMapping("/overview")
  public ApiResponse<AdminDtos.ConsoleOverview> overview(
      @RequestHeader(value = "Authorization", required = false) String authorization) {
    adminAuthService.requireAdmin(authorization);
    return ApiResponse.ok(adminService.overview());
  }

  @GetMapping("/users")
  public ApiResponse<List<AdminDtos.UserRow>> users(
      @RequestHeader(value = "Authorization", required = false) String authorization) {
    adminAuthService.requireAdmin(authorization);
    return ApiResponse.ok(adminService.listUsers());
  }

  @PostMapping("/users")
  public ApiResponse<AdminDtos.UserRow> createUser(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody AdminDtos.UserCreateRequest request) {
    adminAuthService.requireAdmin(authorization);
    return ApiResponse.ok("用户已创建", adminService.createUser(request));
  }

  @PutMapping("/users/{id}")
  public ApiResponse<AdminDtos.UserRow> updateUser(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable Long id,
      @RequestBody AdminDtos.UserUpdateRequest request) {
    adminAuthService.requireAdmin(authorization);
    return ApiResponse.ok("用户已更新", adminService.updateUser(id, request));
  }

  @GetMapping("/roles")
  public ApiResponse<List<AdminDtos.RoleRow>> roles(
      @RequestHeader(value = "Authorization", required = false) String authorization) {
    adminAuthService.requireAdmin(authorization);
    return ApiResponse.ok(adminService.listRoles());
  }

  @PostMapping("/roles")
  public ApiResponse<AdminDtos.RoleRow> createRole(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody AdminDtos.RoleCreateRequest request) {
    adminAuthService.requireAdmin(authorization);
    return ApiResponse.ok("角色已创建", adminService.createRole(request));
  }

  @PutMapping("/roles/{id}")
  public ApiResponse<AdminDtos.RoleRow> updateRole(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable Long id,
      @RequestBody AdminDtos.RoleUpdateRequest request) {
    adminAuthService.requireAdmin(authorization);
    return ApiResponse.ok("角色已更新", adminService.updateRole(id, request));
  }

  @GetMapping("/image-stats")
  public ApiResponse<AdminDtos.ImageStatsResponse> imageStats(
      @RequestHeader(value = "Authorization", required = false) String authorization) {
    adminAuthService.requireAdmin(authorization);
    return ApiResponse.ok(adminService.imageStats());
  }
}
