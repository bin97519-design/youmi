package com.youmi.api.auth;

import java.util.List;

public record UserAccount(
    Long id,
    String account,
    String phone,
    String nickname,
    String passwordHash,
    String passwordSalt,
    String status,
    Integer miValue,
    String planName,
    List<String> roles
) {
  public AuthDtos.UserProfile toProfile() {
    return new AuthDtos.UserProfile(id, account, phone, nickname, status, roles, miValue, planName);
  }
}
