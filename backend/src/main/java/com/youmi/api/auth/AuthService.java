package com.youmi.api.auth;

import com.youmi.api.common.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class AuthService {
  private final UserRepository userRepository;
  private final PasswordHasher passwordHasher;
  private final TokenService tokenService;

  public AuthService(UserRepository userRepository, PasswordHasher passwordHasher, TokenService tokenService) {
    this.userRepository = userRepository;
    this.passwordHasher = passwordHasher;
    this.tokenService = tokenService;
  }

  public AuthDtos.LoginResponse login(AuthDtos.LoginRequest request, HttpServletRequest servletRequest) {
    String account = StringUtils.hasText(request.account()) ? request.account().trim() : "";
    if (!StringUtils.hasText(account) && StringUtils.hasText(request.phone())) {
      account = request.phone().trim();
    }

    if (!StringUtils.hasText(account) || !StringUtils.hasText(request.password())) {
      throw new ApiException(400, "请输入账号和密码");
    }

    UserAccount user = userRepository.findByLoginName(account)
        .orElseThrow(() -> new ApiException(401, "账号或密码错误"));
    String inputHash = passwordHasher.sha256(request.password(), user.passwordSalt());
    if (!inputHash.equals(user.passwordHash())) {
      throw new ApiException(401, "账号或密码错误");
    }
    if (!"ACTIVE".equals(user.status())) {
      throw new ApiException(403, "账号已被禁用");
    }

    userRepository.saveLoginLog(user.id(), account, clientIp(servletRequest), servletRequest.getHeader("User-Agent"));
    String token = tokenService.createToken(user.id());
    return new AuthDtos.LoginResponse(token, user.toProfile());
  }

  public AuthDtos.MeResponse currentUser(String token) {
    Long userId = tokenService.getUserId(token).orElseThrow(() -> new ApiException(401, "登录已失效"));
    UserAccount user = userRepository.findById(userId).orElseThrow(() -> new ApiException(401, "登录已失效"));
    return new AuthDtos.MeResponse(user.toProfile());
  }

  public void logout(String token) {
    tokenService.revoke(token);
  }

  private String clientIp(HttpServletRequest request) {
    String forwardedFor = request.getHeader("X-Forwarded-For");
    if (StringUtils.hasText(forwardedFor)) {
      return forwardedFor.split(",")[0].trim();
    }
    return request.getRemoteAddr();
  }
}
