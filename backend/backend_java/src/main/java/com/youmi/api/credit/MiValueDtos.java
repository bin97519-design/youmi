package com.youmi.api.credit;

/**
 * 米值模块对外暴露的 DTO 集合。
 */
public final class MiValueDtos {
  private MiValueDtos() {
  }

  /** 扣减结果：控制器据此回填响应（本次消耗、最新余额） */
  public record DeductResult(
      Long logId,
      int beforeBalance,
      int afterBalance,
      int price,
      MiBizType bizType) {
  }

  /** 管理后台查询某用户米值的视图 */
  public record MiValueAdminView(int balance, String planName) {
  }

  /** 管理后台调账请求体 */
  public record MiValueAdjustRequest(int delta, String reason) {
  }
}
