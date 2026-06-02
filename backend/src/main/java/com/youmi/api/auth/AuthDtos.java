package com.youmi.api.auth;

import java.util.List;

public final class AuthDtos {
  private AuthDtos() {
  }

  public record LoginRequest(String account, String phone, String password) {
  }

  public record LoginResponse(String token, UserProfile user) {
  }

  public record MeResponse(UserProfile user) {
  }

  public record UserProfile(
      Long id,
      String account,
      String phone,
      String name,
      String status,
      List<String> roles,
      Integer miValue,
      String plan
  ) {
  }
}
