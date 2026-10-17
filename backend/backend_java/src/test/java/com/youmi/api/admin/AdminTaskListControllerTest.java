package com.youmi.api.admin;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.youmi.api.auth.UserAccount;
import com.youmi.api.common.ApiException;
import java.util.List;
import org.junit.jupiter.api.Test;

class AdminTaskListControllerTest {
  final AdminAuthService auth = mock(AdminAuthService.class);
  final AdminTaskListService service = mock(AdminTaskListService.class);
  final AdminTaskListController controller = new AdminTaskListController(auth, service);
  final UserAccount user = new UserAccount(7L, "account", null, "User", "", "", "ACTIVE", 0, "", null, null, List.of("USER"));

  @Test void ordinaryUserScopeIsPreservedEvenWhenAnotherUserIsRequested() {
    when(auth.requireLogin("token")).thenReturn(user);
    controller.tasks("token", "all", null, null, "FAILED", "model", 8L, 3, 20, null);
    verify(service).tasks(7L, "all", null, null, "FAILED", "model", 8L, 3, 20);
  }

  @Test void adminCanFilterAllThreeCategoriesByUser() {
    when(auth.requireLogin("token")).thenReturn(user);
    when(auth.isAdmin(user)).thenReturn(true);
    controller.tasks("token", "all", null, null, null, null, 8L, 1, 10, null);
    verify(service).tasks(null, "all", null, null, null, null, 8L, 1, 10);
  }

  @Test void loginIsRequired() {
    when(auth.requireLogin(null)).thenThrow(new ApiException(401, "login required"));
    assertThrows(ApiException.class, () -> controller.tasks(null, "all", null, null, null, null, null, 1, 10, null));
    verifyNoInteractions(service);
  }

  @Test void storeManagerUsesBoundShopScope() {
    UserAccount manager = new UserAccount(9L, "manager", null, "Manager", "", "", "ACTIVE", 0, "",
        42L, "Shop", List.of("STORE_MANAGER"));
    when(auth.requireLogin("token")).thenReturn(manager);
    when(auth.isStoreManager(manager)).thenReturn(true);
    when(auth.isAdmin(manager)).thenReturn(false);
    when(auth.requireStoreManagerShopId("token")).thenReturn(42L);

    controller.tasks("token", "all", null, null, null, null, 999L, 1, 10, "shop");

    verify(service).tasksForShop(42L, "all", null, null, null, null, 1, 10);
    verify(service, never()).tasks(any(), any(), any(), any(), any(), any(), any(), anyInt(), anyInt());
  }
}
