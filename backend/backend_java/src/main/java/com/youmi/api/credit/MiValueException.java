package com.youmi.api.credit;

import com.youmi.api.common.ApiException;

/**
 * 米值相关异常的基类，继承 {@link ApiException} 以便被
 * {@code GlobalExceptionHandler} 的统一 {@code switch (code)} 捕获并映射为对应的 HTTP 状态码。
 */
public class MiValueException extends ApiException {
  public MiValueException(int code, String message) {
    super(code, message);
  }
}
