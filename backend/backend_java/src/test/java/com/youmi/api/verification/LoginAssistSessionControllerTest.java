package com.youmi.api.verification;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
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

class LoginAssistSessionControllerTest {
  private static final String AUTHORIZATION = "Bearer test-token";
  private static final String PUBLIC_KEY = "{\"kty\":\"RSA\",\"e\":\"AQAB\",\"n\":\""
      + "a".repeat(342) + "\"}";

  private MockMvc mockMvc;
  private ObjectMapper objectMapper;

  @BeforeEach
  void setUp() {
    AuthService authService = mock(AuthService.class);
    AuthDtos.UserProfile user = new AuthDtos.UserProfile(
        85296281L, "account", "13800000000", "测试用户", "ACTIVE",
        List.of("ADMIN"), 100, "普通用户", null, null);
    when(authService.currentUser(anyString())).thenReturn(new AuthDtos.MeResponse(user));
    objectMapper = new ObjectMapper();
    Clock clock = Clock.fixed(Instant.parse("2026-08-04T05:00:00Z"), ZoneOffset.UTC);
    LoginAssistSessionController controller = new LoginAssistSessionController(
        authService, objectMapper, clock, "https://example.com/youmi-api");
    mockMvc = MockMvcBuilders.standaloneSetup(controller)
        .setControllerAdvice(new GlobalExceptionHandler())
        .build();
  }

  @Test
  void relaysEncryptedCredentialsAndSmsWithoutExposingPlaintext() throws Exception {
    String id = createSession();

    mockMvc.perform(get("/api/public/login-assist-sessions/{id}", id))
        .andExpect(status().isOk())
        .andExpect(content().string(org.hamcrest.Matchers.containsString("crypto.subtle.encrypt")));

    mockMvc.perform(post("/api/public/login-assist-sessions/{id}/submit", id)
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"stage\":\"credentials\",\"ciphertext\":\"YWJjZA==\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("submitted"));

    mockMvc.perform(get("/api/login-assist-sessions/{id}", id)
            .header("Authorization", AUTHORIZATION))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.payloadStage").value("credentials"))
        .andExpect(jsonPath("$.data.ciphertext").value("YWJjZA=="));

    mockMvc.perform(post("/api/login-assist-sessions/{id}/state", id)
            .header("Authorization", AUTHORIZATION)
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"stage\":\"sms\",\"message\":\"请输入短信验证码\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.stage").value("sms"));

    mockMvc.perform(post("/api/public/login-assist-sessions/{id}/submit", id)
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"stage\":\"sms\",\"ciphertext\":\"ZWZnaA==\"}"))
        .andExpect(status().isOk());

    mockMvc.perform(get("/api/login-assist-sessions/{id}", id)
            .header("Authorization", AUTHORIZATION))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.payloadStage").value("sms"))
        .andExpect(jsonPath("$.data.ciphertext").value("ZWZnaA=="));

    mockMvc.perform(post("/api/login-assist-sessions/{id}/state", id)
            .header("Authorization", AUTHORIZATION)
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"status\":\"completed\",\"message\":\"登录成功\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.status").value("completed"));

    mockMvc.perform(get("/api/public/login-assist-sessions/{id}/status", id))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("completed"))
        .andExpect(jsonPath("$.publicKeyJwk").exists());
  }

  @Test
  void rejectsWrongOriginAndInvalidPublicKey() throws Exception {
    mockMvc.perform(post("/api/login-assist-sessions")
            .header("Authorization", AUTHORIZATION)
            .contentType(MediaType.APPLICATION_JSON)
            .content(objectMapper.writeValueAsString(new LoginAssistSessionController.CreateRequest(
                "sycm_login", "https://example.com", "测试", PUBLIC_KEY))))
        .andExpect(status().isBadRequest());

    mockMvc.perform(post("/api/login-assist-sessions")
            .header("Authorization", AUTHORIZATION)
            .contentType(MediaType.APPLICATION_JSON)
            .content(objectMapper.writeValueAsString(new LoginAssistSessionController.CreateRequest(
                "sycm_login", "https://sycm.taobao.com", "测试", "{}"))))
        .andExpect(status().isBadRequest());
  }

  private String createSession() throws Exception {
    String response = mockMvc.perform(post("/api/login-assist-sessions")
            .header("Authorization", AUTHORIZATION)
            .contentType(MediaType.APPLICATION_JSON)
            .content(objectMapper.writeValueAsString(new LoginAssistSessionController.CreateRequest(
                "sycm_login", "https://sycm.taobao.com", "生意参谋登录协助", PUBLIC_KEY))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.assistUrl")
            .value(org.hamcrest.Matchers.startsWith(
                "https://example.com/youmi-api/api/public/login-assist-sessions/")))
        .andReturn().getResponse().getContentAsString();
    return objectMapper.readTree(response).path("data").path("id").asText();
  }
}
