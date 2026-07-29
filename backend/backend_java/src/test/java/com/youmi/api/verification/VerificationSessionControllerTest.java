package com.youmi.api.verification;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.youmi.api.auth.AuthDtos;
import com.youmi.api.auth.AuthService;
import com.youmi.api.common.GlobalExceptionHandler;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class VerificationSessionControllerTest {
  private MockMvc mockMvc;

  @BeforeEach
  void setUp() {
    AuthService authService = mock(AuthService.class);
    AuthDtos.UserProfile user = new AuthDtos.UserProfile(
        85296281L, "account", "13800000000", "测试用户", "ACTIVE",
        List.of("ADMIN"), 100, "普通用户", null, null);
    when(authService.currentUser(anyString())).thenReturn(new AuthDtos.MeResponse(user));
    Clock clock = Clock.fixed(Instant.parse("2026-07-26T05:00:00Z"), ZoneOffset.UTC);
    VerificationSessionController controller =
        new VerificationSessionController(authService, clock, "https://example.com/youmi-api");
    mockMvc = MockMvcBuilders.standaloneSetup(controller)
        .setControllerAdvice(new GlobalExceptionHandler())
        .build();
  }

  @Test
  void createsSubmitsAndConsumesOneTimeCode() throws Exception {
    String response = mockMvc.perform(post("/api/verification-sessions")
            .header("Authorization", "Bearer test-token")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"purpose\":\"huice_sms\",\"label\":\"慧策手机验证码\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.verificationUrl")
            .value(org.hamcrest.Matchers.startsWith(
                "https://example.com/youmi-api/api/public/verification-sessions/")))
        .andReturn().getResponse().getContentAsString();
    String id = com.fasterxml.jackson.databind.json.JsonMapper.builder().build()
        .readTree(response).path("data").path("id").asText();

    mockMvc.perform(get("/api/public/verification-sessions/{id}", id))
        .andExpect(status().isOk())
        .andExpect(content().string(org.hamcrest.Matchers.containsString("手机验证码")));

    mockMvc.perform(post("/api/public/verification-sessions/{id}", id)
            .contentType(MediaType.APPLICATION_FORM_URLENCODED)
            .param("code", "123456"))
        .andExpect(status().isOk())
        .andExpect(content().string(org.hamcrest.Matchers.containsString("验证码已提交")));

    mockMvc.perform(get("/api/verification-sessions/{id}", id)
            .header("Authorization", "Bearer test-token"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.status").value("submitted"))
        .andExpect(jsonPath("$.data.code").value("123456"));

    mockMvc.perform(get("/api/verification-sessions/{id}", id)
            .header("Authorization", "Bearer test-token"))
        .andExpect(status().isNotFound());

    mockMvc.perform(get("/api/public/verification-sessions/{id}", id))
        .andExpect(status().isGone())
        .andExpect(content().string(org.hamcrest.Matchers.containsString("验证链接已失效")));
  }

  @Test
  void rejectsNonNumericCode() throws Exception {
    String response = mockMvc.perform(post("/api/verification-sessions")
            .header("Authorization", "Bearer test-token")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"purpose\":\"huice_sms\"}"))
        .andReturn().getResponse().getContentAsString();
    String id = com.fasterxml.jackson.databind.json.JsonMapper.builder().build()
        .readTree(response).path("data").path("id").asText();

    mockMvc.perform(post("/api/public/verification-sessions/{id}", id)
            .contentType(MediaType.APPLICATION_FORM_URLENCODED)
            .param("code", "12ab"))
        .andExpect(status().isBadRequest())
        .andExpect(content().string(org.hamcrest.Matchers.containsString("4-8 位数字验证码")));
  }
}
