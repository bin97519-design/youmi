package com.youmi.api.common;

public class ApiException extends RuntimeException {
  private final int code;

  public ApiException(int code, String message) {
    super(message);
    this.code = code;
  }

  public ApiException(int code, String message, Throwable cause) {
    super(message, cause);
    this.code = code;
  }

  public int getCode() {
    return code;
  }
}
