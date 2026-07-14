package com.youmi.api.file;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.youmi.api.common.ApiException;
import org.junit.jupiter.api.Test;

class OssStorageIsolationTest {
  private final OssStorageService service = new OssStorageService(new OssStorageProperties());

  @Test
  void scopesDirectoriesAndRejectsOtherUsersObjects() {
    assertEquals("users/12/youmi/uploads", service.scopeUserDir(12L, "youmi/uploads"));
    assertEquals(
        "users/12/youmi/uploads/a.png",
        service.requireUserObject(12L, "users/12/youmi/uploads/a.png"));
    assertThrows(
        ApiException.class,
        () -> service.requireUserObject(12L, "users/13/youmi/uploads/a.png"));
    assertThrows(
        ApiException.class,
        () -> service.requireUserObject(12L, "users/12/../13/a.png"));
  }
}
