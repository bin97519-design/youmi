package com.youmi.api.admin;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.youmi.api.common.ApiException;
import com.youmi.api.file.OssStorageProperties;
import com.youmi.api.file.OssStorageService;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class AdminOssControllerTest {
  private final AdminAuthService auth = mock(AdminAuthService.class);
  private final OssStorageProperties properties = new OssStorageProperties();
  private final OssStorageService storage = mock(OssStorageService.class);
  private final AdminOssController controller = new AdminOssController(auth, properties, storage);

  @Test
  void statusRequiresAdminAndDoesNotExposeCredentials() {
    properties.setAccessKeyId("private-id");
    properties.setAccessKeySecret("private-secret");

    Map<String, Object> status = controller.status("admin-token").data();

    verify(auth).requireAdmin("admin-token");
    assertFalse(status.containsKey("accessKeyId"));
    assertFalse(status.containsKey("accessKeySecret"));
  }

  @Test
  void listingRequiresAdminAndPassesPagingArguments() {
    Map<String, Object> page = Map.of("prefix", "images/", "objects", List.of());
    when(storage.listAdminObjects("images", "images/a.png", 50)).thenReturn(page);

    assertEquals(page, controller.list("admin-token", "images", "images/a.png", 50).data());
    verify(auth).requireAdmin("admin-token");
    verify(storage).listAdminObjects("images", "images/a.png", 50);
  }

  @Test
  void rejectedAuthorizationStopsBeforeStorageAccess() {
    when(auth.requireAdmin("user-token")).thenThrow(new ApiException(403, "forbidden"));

    org.junit.jupiter.api.Assertions.assertThrows(ApiException.class,
        () -> controller.list("user-token", "", null, 100));
  }

  @Test
  void datePreviewAndDeletionRequireAdmin() {
    AdminOssController.DateDeletionRequest request =
        new AdminOssController.DateDeletionRequest("images/", "2026-10-01", "2026-10-12");
    Map<String, Object> preview = Map.of("matchedCount", 2L);
    Map<String, Object> deleted = Map.of("deletedCount", 2L);
    when(storage.previewAdminDateDeletion("images/", "2026-10-01", "2026-10-12")).thenReturn(preview);
    when(storage.deleteAdminObjectsByDate("images/", "2026-10-01", "2026-10-12")).thenReturn(deleted);

    assertEquals(preview, controller.previewDateDeletion("admin-token", request).data());
    assertEquals(deleted, controller.deleteByDate("admin-token", request).data());
    org.mockito.Mockito.verify(auth, org.mockito.Mockito.times(2)).requireAdmin("admin-token");
  }
}
