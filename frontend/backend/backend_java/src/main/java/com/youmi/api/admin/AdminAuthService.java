package com.youmi.api.admin;

import com.youmi.api.auth.TokenService;
import com.youmi.api.auth.UserAccount;
import com.youmi.api.auth.UserRepository;
import com.youmi.api.common.ApiException;
import org.springframework.stereotype.Service;

@Service
public class AdminAuthService {
  private final TokenService tokenService;
  private final UserRepository userRepository;

  public AdminAuthService(TokenService tokenService, UserRepository userRepository) {
    this.tokenService = tokenService;
    this.userRepository = userRepository;
  }

  public UserAccount requireAdmin(String authorization) {
    Long userId = tokenService.getUserId(parseBearerToken(authorization))
        .orElseThrow(() -> new ApiException(401, "请先登录"));
    UserAccount user = userRepository.findById(userId)
        .orElseThrow(() -> new ApiException(401, "登录已失效"));
    if (user.roles() == null || !user.roles().contains("ADMIN")) {
      throw new ApiException(403, "没有控制台权限");
    }
    return user;
  }

  public Long optionalUserId(String authorization) {
    return tokenService.getUserId(parseBearerToken(authorization)).orElse(null);
  }

  private String parseBearerToken(String authorization) {
    if (authorization == null || !authorization.startsWith("Bearer ")) return "";
    return authorization.substring("Bearer ".length()).trim();
  }
}
