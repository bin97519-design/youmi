package com.youmi.api.credit;

import java.math.BigDecimal;

/**
 * 米值模块对外暴露的 DTO 集合。
 */
public final class MiValueDtos {
  private MiValueDtos() {
  }

  /** 扣减结果：控制器据此回填响应（本次消耗、最新余额） */
  public record DeductResult(
      Long logId,
      BigDecimal beforeBalance,
      BigDecimal afterBalance,
      BigDecimal price,
      MiBizType bizType) {
    public DeductResult(Long logId, int beforeBalance, int afterBalance, int price, MiBizType bizType) {
      this(logId, BigDecimal.valueOf(beforeBalance).setScale(2),
          BigDecimal.valueOf(afterBalance).setScale(2), BigDecimal.valueOf(price).setScale(2), bizType);
    }
  }

  /** 管理后台查询某用户米值的视图 */
  public record MiValueAdminView(BigDecimal balance, String planName) {
  }

  public record MiValueConsumptionView(BigDecimal consumedMi, String planName) {
  }

  /** 管理后台调账请求体 */
  public record MiValueAdjustRequest(int delta, String reason) {
  }
}
