package com.youmi.api.credit;

/**
 * 米值不足异常。必须继承 {@link ApiException}（经由 {@link MiValueException}），
 * 才能被 {@code GlobalExceptionHandler} 的 {@code switch} 捕获并映射为 HTTP 402。
 */
public class MiValueInsufficientException extends MiValueException {
  /**
   * @param balance 当前余额，用于拼装文案「米值不足，当前余额 Y」
   */
  public MiValueInsufficientException(int balance) {
    super(402, "米值不足，当前余额 " + balance);
  }
}
