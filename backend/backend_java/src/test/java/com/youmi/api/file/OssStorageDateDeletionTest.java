package com.youmi.api.file;

import static org.junit.jupiter.api.Assertions.assertThrows;

import com.youmi.api.common.ApiException;
import org.junit.jupiter.api.Test;

class OssStorageDateDeletionTest {
  private final OssStorageService storage = new OssStorageService(new OssStorageProperties());

  @Test
  void bulkDateOperationsRequireASelectedFolder() {
    assertThrows(ApiException.class,
        () -> storage.previewAdminDateDeletion("", "2026-10-01", "2026-10-10"));
  }

  @Test
  void invalidDateRangeIsRejectedBeforeCallingOss() {
    assertThrows(ApiException.class,
        () -> storage.previewAdminDateDeletion("images/", "not-a-date", "2026-10-10"));
    assertThrows(ApiException.class,
        () -> storage.previewAdminDateDeletion("images/", "2026-10-11", "2026-10-10"));
  }

  @Test
  void unsafePrefixCannotBeUsedForBulkDeletion() {
    assertThrows(ApiException.class,
        () -> storage.deleteAdminObjectsByDate("images/../private", "2026-10-01", "2026-10-10"));
  }
}
