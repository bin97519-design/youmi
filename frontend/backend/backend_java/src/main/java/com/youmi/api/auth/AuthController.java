package com.youmi.api.auth;

import com.youmi.api.common.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class AuthController {
  private final AuthService authService;

  public AuthController(AuthService authService) {
    this.authService = authService;
  }

  @GetMapping("/health")
  public ApiResponse<Object> health() {
    return ApiResponse.ok("ok", java.util.Map.of("service", "youmi-api"));
  }

  @PostMapping("/auth/login")
  public ApiResponse<AuthDtos.LoginResponse> login(
      @RequestBody AuthDtos.LoginRequest request,
      HttpServletRequest servletRequest
  ) {
    return ApiResponse.ok("登录成功", authService.login(request, servletRequest));
  }

  @PostMapping("/auth/register")
  public ApiResponse<AuthDtos.LoginResponse> register(@RequestBody AuthDtos.RegisterRequest request) {
    return ApiResponse.ok("注册成功", authService.register(request));
  }

  @GetMapping("/auth/me")
  public ApiResponse<AuthDtos.MeResponse> me(@RequestHeader(value = "Authorization", required = false) String authorization) {
    return ApiResponse.ok(authService.currentUser(parseBearerToken(authorization)));
  }

  @PostMapping("/auth/logout")
  public ApiResponse<Object> logout(@RequestHeader(value = "Authorization", required = false) String authorization) {
    authService.logout(parseBearerToken(authorization));
    return ApiResponse.ok("已退出登录", java.util.Map.of());
  }

  private String parseBearerToken(String authorization) {
    if (authorization == null || !authorization.startsWith("Bearer ")) return "";
    return authorization.substring("Bearer ".length());
  }
}
