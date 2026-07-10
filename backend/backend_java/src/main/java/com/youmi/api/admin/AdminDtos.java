package com.youmi.api.admin;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

public final class AdminDtos {
  private AdminDtos() {
  }

  public record UserRow(
      Long id,
      String account,
      String phone,
      String nickname,
      String status,
      Integer miValue,
      String planName,
      Long shopId,
      String shopName,
      String shopPlatform,
      List<String> roles,
      String createdAt,
      String updatedAt) {
  }

  public record UserCreateRequest(
      String account,
      String phone,
      String nickname,
      String password,
      String status,
      Integer miValue,
      String planName,
      Long shopId,
      String shopName,
      String shopPlatform,
      List<String> roles) {
  }

  public record UserUpdateRequest(
      String phone,
      String nickname,
      String password,
      String status,
      Integer miValue,
      String planName,
      Long shopId,
      String shopPlatform,
      List<String> roles) {
  }

  public record RoleRow(
      Long id,
      String code,
      String name,
      List<String> permissions,
      Integer userCount,
      String createdAt) {
  }

  public record RoleCreateRequest(String code, String name, List<String> permissions) {
  }

  public record RoleUpdateRequest(String name, List<String> permissions) {
  }

  public record ImageStatsResponse(
      ImageStatsSummary summary,
      List<ImageTaskRow> tasks,
      List<DailyImageStat> daily,
      List<ModelImageStat> models) {
  }

  public record ImageStatsSummary(
      Long totalTasks,
      Long completedTasks,
      Long failedTasks,
      Long processingTasks,
      Long todayTasks,
      Integer totalImages,
      Integer totalMiCost,
      BigDecimal totalMoneyCost) {
  }

  public record ImageTaskRow(
      Long id,
      String taskId,
      Long userId,
      String userName,
      String provider,
      String prompt,
      String model,
      String requestedModel,
      String size,
      String resolution,
      Integer requestedCount,
      String status,
      Integer progress,
      Integer imageCount,
      Integer miCost,
      BigDecimal moneyCost,
      String errorMessage,
      String createdAt,
      String updatedAt,
      String completedAt) {
  }

  public record DailyImageStat(String day, Long tasks, Integer images, Integer miCost, BigDecimal moneyCost) {
  }

  public record ModelImageStat(String model, Long tasks, Integer images, Integer miCost, BigDecimal moneyCost) {
  }

  public record ConsoleOverview(
      Map<String, Object> users,
      Map<String, Object> roles,
      Map<String, Object> images) {
  }
}
