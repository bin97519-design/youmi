package com.youmi.api.admin;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.youmi.api.auth.UserAccount;
import com.youmi.api.common.ApiException;
import java.util.List;
import org.junit.jupiter.api.Test;

class AdminVideoStatsControllerTest {
  final AdminAuthService auth = mock(AdminAuthService.class);
  final AdminVideoStatsService stats = mock(AdminVideoStatsService.class);
  final AdminVideoStatsController controller = new AdminVideoStatsController(auth, stats);
  final UserAccount user = new UserAccount(7L, "account", null, "User", "", "", "ACTIVE", 0, "", null, null, List.of("USER"));

  @Test void ordinaryUserCannotRequestAnotherUsersData() {
    when(auth.requireLogin("token")).thenReturn(user);
    controller.videoStats("token", "VIDEO_ENHANCE", "2026-10-01", "2026-10-10");
    verify(stats).stats(7L, "VIDEO_ENHANCE", "2026-10-01", "2026-10-10");
  }
  @Test void adminCanViewAllUsers() {
    when(auth.requireLogin("token")).thenReturn(user);
    when(auth.isAdmin(user)).thenReturn(true);
    controller.videoStats("token", "VIDEO", null, null);
    verify(stats).stats(null, "VIDEO", null, null);
  }
  @Test void loginIsRequiredBeforeReadingAnyHistory() {
    when(auth.requireLogin(null)).thenThrow(new ApiException(401, "login required"));
    assertThrows(ApiException.class, () -> controller.videoStats(null, "VIDEO", null, null));
    verifyNoInteractions(stats);
  }
}
