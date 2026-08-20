package com.youmi.api.admin;

import java.math.BigDecimal;
import java.util.List;

public final class FinanceDtos {
  private FinanceDtos() {
  }

  public record FinanceReport(
      FinancePeriod period,
      FinanceSummary summary,
      List<DailyFinanceRow> daily,
      List<PlatformFinanceRow> platforms,
      List<ShopFinanceRow> shops,
      List<UserFinanceRow> users) {
  }

  public record FinancePeriod(
      String dateFrom,
      String dateTo,
      Long platformId,
      Long shopId) {
  }

  public record FinanceSummary(
      Long transactionCount,
      Long userCount,
      Long shopCount,
      Long imageMi,
      Long videoMi,
      Long totalMi,
      BigDecimal totalYuan) {
  }

  public record DailyFinanceRow(
      String day,
      Long transactionCount,
      Long userCount,
      Long imageMi,
      Long videoMi,
      Long totalMi,
      BigDecimal totalYuan) {
  }

  public record PlatformFinanceRow(
      Long platformId,
      String platformCode,
      String platformName,
      Long transactionCount,
      Long shopCount,
      Long userCount,
      Long imageMi,
      Long videoMi,
      Long totalMi,
      BigDecimal totalYuan) {
  }

  public record ShopFinanceRow(
      Long shopId,
      String shopCode,
      String shopName,
      Long platformId,
      String platformName,
      Long transactionCount,
      Long userCount,
      Long imageMi,
      Long videoMi,
      Long totalMi,
      BigDecimal totalYuan) {
  }

  public record UserFinanceRow(
      Long userId,
      String account,
      String nickname,
      Long transactionCount,
      Long platformCount,
      Long shopCount,
      Long imageMi,
      Long videoMi,
      Long totalMi,
      BigDecimal totalYuan) {
  }
}
