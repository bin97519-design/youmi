package com.youmi.api.admin;

import com.youmi.api.auth.UserAccount;
import com.youmi.api.common.ApiResponse;
import com.youmi.api.image.ModelApiKeyDtos;
import com.youmi.api.image.ModelApiKeyService;
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
@RequestMapping("/api/admin/model-api-keys")
public class AdminModelApiKeyController {
  private final AdminAuthService adminAuthService;
  private final ModelApiKeyService service;

  public AdminModelApiKeyController(
      AdminAuthService adminAuthService, ModelApiKeyService service) {
    this.adminAuthService = adminAuthService;
    this.service = service;
  }

  @GetMapping
  public ApiResponse<List<ModelApiKeyDtos.Row>> list(
      @RequestHeader(value = "Authorization", required = false) String authorization) {
    adminAuthService.requireAdmin(authorization);
    return ApiResponse.ok(service.list());
  }

  @PostMapping
  public ApiResponse<ModelApiKeyDtos.Row> create(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody ModelApiKeyDtos.SaveRequest request) {
    UserAccount admin = adminAuthService.requireAdmin(authorization);
    return ApiResponse.ok("模型 API Key 已创建", service.create(request, admin.id()));
  }

  @PutMapping("/{id}")
  public ApiResponse<ModelApiKeyDtos.Row> update(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable long id,
      @RequestBody ModelApiKeyDtos.SaveRequest request) {
    adminAuthService.requireAdmin(authorization);
    return ApiResponse.ok("模型 API Key 已更新", service.update(id, request));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Void> disable(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable long id) {
    adminAuthService.requireAdmin(authorization);
    service.disable(id);
    return ApiResponse.ok("模型 API Key 已停用", null);
  }
}
