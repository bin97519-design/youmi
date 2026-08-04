package com.youmi.api.auth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@WebMvcTest(AuthController.class)
@DisplayName("开放注册已关闭")
class AuthRegisterShopTest {
  @Autowired private MockMvc mockMvc;
  @MockBean private AuthService authService;
  private final ObjectMapper objectMapper = new ObjectMapper();

  @Test
  @DisplayName("注册接口拒绝创建账号，账号只能由管理员添加")
  void publicRegistrationIsDisabled() throws Exception {
    MvcResult result = mockMvc.perform(post("/api/auth/register")
        .contentType(MediaType.APPLICATION_JSON)
        .content("{\"account\":\"new-user\",\"password\":\"secret\"}"))
        .andReturn();

    assertEquals(403, result.getResponse().getStatus());
    assertEquals(403,
        objectMapper.readTree(result.getResponse().getContentAsString()).get("code").asInt());
  }
}
