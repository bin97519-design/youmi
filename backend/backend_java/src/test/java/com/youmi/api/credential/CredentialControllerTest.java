package com.youmi.api.credential;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.auth.UserAccount;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

@ExtendWith(MockitoExtension.class)
class CredentialControllerTest {
  @Mock private CredentialService service;
  @Mock private AdminAuthService authService;

  private MockMvc mockMvc;

  @BeforeEach
  void setUp() {
    mockMvc = MockMvcBuilders
        .standaloneSetup(new CredentialController(service, authService, false))
        .build();
  }

  @Test
  void disablesOwnedCredential() throws Exception {
    String credentialId = "4a617967-a4fc-4b13-8824-61af54089499";
    when(authService.requireLogin("Bearer access-token")).thenReturn(new UserAccount(
        42L, "tester", null, "测试用户", null, null, "ACTIVE", 0, null,
        null, null, List.of("USER")));
    when(service.disable(42L, credentialId)).thenReturn(
        new CredentialDtos.DisableCredentialView(
            credentialId, "DISABLED", false, "2026-09-19T11:45:00"));

    mockMvc.perform(post("/api/session-credentials/{credentialId}/disable", credentialId)
            .header("Authorization", "Bearer access-token")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.code").value(0))
        .andExpect(jsonPath("$.data.credentialId").value(credentialId))
        .andExpect(jsonPath("$.data.status").value("DISABLED"))
        .andExpect(jsonPath("$.data.available").value(false))
        .andExpect(jsonPath("$.data.disabledAt").value("2026-09-19T11:45:00"));

    verify(service).disable(42L, credentialId);
  }
}
