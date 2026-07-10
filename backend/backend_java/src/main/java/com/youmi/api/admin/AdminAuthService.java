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

  /** 只验证登录，不要求 ADMIN，返回当前用户 */
  public UserAccount requireLogin(String authorization) {
    Long userId = tokenService.getUserId(parseBearerToken(authorization))
        .orElseThrow(() -> new ApiException(401, "请先登录"));
    UserAccount user = userRepository.findById(userId)
        .orElseThrow(() -> new ApiException(401, "登录已失效"));
    return user;
  }

  public UserAccount requireAdmin(String authorization) {
    UserAccount user = requireLogin(authorization);
    if (user.roles() == null || !user.roles().contains("ADMIN")) {
      throw new ApiException(403, "没有控制台权限");
    }
    return user;
  }

  /** 判断用户是否为管理员 */
  public boolean isAdmin(UserAccount user) {
    return user.roles() != null && user.roles().contains("ADMIN");
  }

  public Long optionalUserId(String authorization) {
    return tokenService.getUserId(parseBearerToken(authorization)).orElse(null);
  }

  /** 验证登录态并返回 userId；未登录抛 401（供需要登录的接口，如米值扣减闸门使用） */
  public Long requireUserId(String authorization) {
    Long userId = optionalUserId(authorization);
    if (userId == null) {
      throw new ApiException(401, "未登录");
    }
    return userId;
  }

  private String parseBearerToken(String authorization) {
    if (authorization == null || !authorization.startsWith("Bearer ")) return "";
    return authorization.substring("Bearer ".length()).trim();
  }
}
