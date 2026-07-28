package com.youmi.api.platform;

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
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class PlatformController {
  private final AdminAuthService adminAuthService;
  private final PlatformService platformService;

  public PlatformController(AdminAuthService adminAuthService, PlatformService platformService) {
    this.adminAuthService = adminAuthService;
    this.platformService = platformService;
  }

  @GetMapping("/platforms")
  public ApiResponse<List<PlatformDtos.PlatformPublicView>> publicPlatforms() {
    return ApiResponse.ok(platformService.listActive());
  }

  @GetMapping("/admin/platforms")
  public ApiResponse<List<PlatformDtos.PlatformView>> adminPlatforms(
      @RequestHeader(value = "Authorization", required = false) String authorization) {
    adminAuthService.requireAdmin(authorization);
    return ApiResponse.ok(platformService.list());
  }

  @PostMapping("/admin/platforms")
  public ApiResponse<PlatformDtos.PlatformView> create(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody PlatformDtos.PlatformCreateRequest request) {
    adminAuthService.requireAdmin(authorization);
    return ApiResponse.ok("平台创建成功", platformService.create(request));
  }

  @PutMapping("/admin/platforms/{id}")
  public ApiResponse<PlatformDtos.PlatformView> update(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable Long id,
      @RequestBody PlatformDtos.PlatformUpdateRequest request) {
    adminAuthService.requireAdmin(authorization);
    return ApiResponse.ok("平台已更新", platformService.update(id, request));
  }

  @DeleteMapping("/admin/platforms/{id}")
  public ApiResponse<Void> delete(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable Long id) {
    adminAuthService.requireAdmin(authorization);
    platformService.delete(id);
    return ApiResponse.ok("平台已删除", null);
  }
}
