package com.youmi.api.canvas;

import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiResponse;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** The personal character library is account-scoped and intentionally independent of canvas IDs. */
@RestController
@RequestMapping("/api/canvas/characters")
public class CharacterAssetController {
  private final CharacterAssetService service;
  private final AdminAuthService authService;

  public CharacterAssetController(CharacterAssetService service, AdminAuthService authService) {
    this.service = service;
    this.authService = authService;
  }

  @GetMapping
  public ApiResponse<List<CharacterAssetDtos.CharacterAsset>> list(
      @RequestHeader(value = "Authorization", required = false) String authorization) {
    return ApiResponse.ok(service.list(authService.requireUserId(authorization)));
  }

  @GetMapping("/{id}")
  public ApiResponse<CharacterAssetDtos.CharacterAsset> get(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable String id) {
    return ApiResponse.ok(service.get(authService.requireUserId(authorization), id));
  }

  @PostMapping
  public ApiResponse<CharacterAssetDtos.CharacterAsset> save(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody CharacterAssetDtos.SaveRequest request) {
    return ApiResponse.ok(service.save(authService.requireUserId(authorization), request));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Map<String, String>> delete(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable String id) {
    service.delete(authService.requireUserId(authorization), id);
    return ApiResponse.ok(Map.of("id", id));
  }
}
