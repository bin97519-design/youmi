package com.youmi.api.file;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

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

  @Test
  void recognizesConfiguredBucketAndCustomDomainUrls() {
    OssStorageProperties properties = new OssStorageProperties();
    properties.setEndpoint("oss-cn-shanghai.aliyuncs.com");
    properties.setAccessKeyId("test-id");
    properties.setAccessKeySecret("test-secret");
    properties.setBucketName("youmi-bucket");
    OssStorageService bucketService = new OssStorageService(properties);

    assertTrue(bucketService.isOwnFileUrl(
        "https://youmi-bucket.oss-cn-shanghai.aliyuncs.com/users/12/generated/a.png?x=1"));
    assertFalse(bucketService.isOwnFileUrl(
        "https://other-bucket.oss-cn-shanghai.aliyuncs.com/a.png"));

    properties.setCustomDomain("https://img.youmi.example");
    assertTrue(bucketService.isOwnFileUrl("https://img.youmi.example/users/12/generated/a.png"));
  }
}
