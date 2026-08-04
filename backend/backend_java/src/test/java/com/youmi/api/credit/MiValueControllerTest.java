package com.youmi.api.credit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.auth.TokenService;
import com.youmi.api.image.ImageGenerationClient;
import com.youmi.api.image.ImageGenerationDtos;
import com.youmi.api.video.VideoGenerationClient;
import com.youmi.api.video.VideoGenerationDtos;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:youmiMiController;MODE=MySQL;DB_CLOSE_DELAY=-1",
    "spring.datasource.driver-class-name=org.h2.Driver",
    "spring.datasource.username=sa",
    "spring.datasource.password=",
    "spring.sql.init.mode=never"
})
@AutoConfigureMockMvc
@DisplayName("米值消费记录接口")
class MiValueControllerTest {
  @Autowired private MockMvc mockMvc;
  @Autowired private TokenService tokenService;
  @Autowired private JdbcTemplate jdbcTemplate;
  @MockBean private ImageGenerationClient imageGenerationClient;
  @MockBean private VideoGenerationClient videoGenerationClient;

  private final ObjectMapper objectMapper = new ObjectMapper();
  private static final Long USER = 99001L;
  private static final Long ADMIN = 99002L;
  private String userToken;
  private String adminToken;

  @BeforeEach
  void setUp() {
    initSchema();
    jdbcTemplate.update("DELETE FROM ym_mi_value_log");
    jdbcTemplate.update("DELETE FROM ym_sys_user_role");
    jdbcTemplate.update("DELETE FROM ym_sys_user");
    jdbcTemplate.update("DELETE FROM ym_sys_role");
    jdbcTemplate.update(
        "INSERT INTO ym_sys_role (id, code, name) VALUES (1, 'USER', 'User'), (2, 'ADMIN', 'Admin')");
    insertUser(USER, "consumer", 0, 1L);
    insertUser(ADMIN, "admin", 0, 2L);
    userToken = tokenService.createToken(USER);
    adminToken = tokenService.createToken(ADMIN);
  }

  @Test
  @DisplayName("零余额用户仍可生图并记录成功消费")
  void zeroBalanceDoesNotBlockImageGeneration() throws Exception {
    ImageGenerationDtos.CreateTaskResponse response =
        new ImageGenerationDtos.CreateTaskResponse("agnes", "", "model", "9:16", "2K", 1, null, null);
    when(imageGenerationClient.createTask(any(), anyLong())).thenReturn(response);

    MvcResult result = postImage("{\"prompt\":\"a cat\"}");

    assertEquals(200, result.getResponse().getStatus());
    JsonNode data = objectMapper.readTree(result.getResponse().getContentAsString()).get("data");
    assertEquals(10, data.get("consumedMi").asInt());
    assertEquals(0, currentStoredBalance(USER));
    assertEquals("SUCCESS", logStatus(USER));
  }

  @Test
  @DisplayName("生图失败作废消费记录且不修改账户字段")
  void failedImageIsNotCountedAsConsumption() throws Exception {
    when(imageGenerationClient.createTask(any(), anyLong()))
        .thenThrow(new RuntimeException("upstream down"));

    MvcResult result = postImage("{\"prompt\":\"a cat\"}");

    assertEquals(502, result.getResponse().getStatus());
    assertEquals(0, currentStoredBalance(USER));
    assertEquals("ROLLBACK", logStatus(USER));
  }

  @Test
  @DisplayName("零余额用户仍可生视频并记录消费")
  void zeroBalanceDoesNotBlockVideoGeneration() throws Exception {
    VideoGenerationDtos.CreateTaskResponse response = new VideoGenerationDtos.CreateTaskResponse();
    response.setProvider("gettoken");
    response.setModel("veo31-fast-image2video");
    response.setTaskId("gettoken:video-1");
    response.setStatus("submitted");
    when(videoGenerationClient.createTask(any())).thenReturn(response);

    MvcResult result = mockMvc.perform(post("/api/video-tasks")
        .header("Authorization", "Bearer " + userToken)
        .contentType(MediaType.APPLICATION_JSON)
        .content("{\"prompt\":\"a video\"}"))
        .andReturn();

    assertEquals(200, result.getResponse().getStatus());
    JsonNode data = objectMapper.readTree(result.getResponse().getContentAsString()).get("data");
    assertEquals(50, data.get("consumedMi").asInt());
    assertEquals(0, currentStoredBalance(USER));
    assertEquals("SUCCESS", logStatus(USER));
  }

  @Test
  @DisplayName("管理端只返回累计成功消费")
  void adminReadsConsumptionInsteadOfBalance() throws Exception {
    insertLog(USER, 77, "SUCCESS");
    insertLog(USER, 99, "ROLLBACK");

    MvcResult result = mockMvc.perform(get("/api/admin/user/" + USER + "/mi-value")
        .header("Authorization", "Bearer " + adminToken)).andReturn();

    assertEquals(200, result.getResponse().getStatus());
    JsonNode data = objectMapper.readTree(result.getResponse().getContentAsString()).get("data");
    assertEquals(77, data.get("consumedMi").asInt());
  }

  @Test
  @DisplayName("管理端余额调账接口已停用")
  void balanceAdjustmentEndpointIsGone() throws Exception {
    MvcResult result = mockMvc.perform(post("/api/admin/user/" + USER + "/mi-value")
        .header("Authorization", "Bearer " + adminToken)
        .contentType(MediaType.APPLICATION_JSON)
        .content("{\"delta\":100,\"reason\":\"recharge\"}"))
        .andReturn();

    assertEquals(410, objectMapper.readTree(result.getResponse().getContentAsString()).get("code").asInt());
    assertEquals(0, currentStoredBalance(USER));
  }

  private MvcResult postImage(String body) throws Exception {
    return mockMvc.perform(post("/api/image-tasks")
        .header("Authorization", "Bearer " + userToken)
        .contentType(MediaType.APPLICATION_JSON)
        .content(body)).andReturn();
  }

  private void initSchema() {
    jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS ym_sys_user (id BIGINT PRIMARY KEY, account VARCHAR(64), phone VARCHAR(32), nickname VARCHAR(64), password_hash VARCHAR(128), password_salt VARCHAR(64), status VARCHAR(20), mi_value INT, plan_name VARCHAR(64), shop_id BIGINT)");
    jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS ym_sys_role (id BIGINT PRIMARY KEY, code VARCHAR(64), name VARCHAR(64))");
    jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS ym_sys_user_role (user_id BIGINT, role_id BIGINT)");
    jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS ym_platform (id BIGINT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(64), code VARCHAR(32), status VARCHAR(20), sort_order INT, created_at TIMESTAMP, updated_at TIMESTAMP)");
    jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS ym_shop (id BIGINT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(128), code VARCHAR(64), platform_id BIGINT, platform VARCHAR(32), status VARCHAR(20), created_at TIMESTAMP, updated_at TIMESTAMP)");
    jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS ym_mi_value_log (id BIGINT PRIMARY KEY AUTO_INCREMENT, user_id BIGINT, shop_id BIGINT, platform_id BIGINT, biz_type VARCHAR(20), task_type VARCHAR(32), price INT, before_balance INT, after_balance INT, task_id VARCHAR(128), status VARCHAR(20), remark VARCHAR(255), created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
  }

  private void insertUser(Long id, String account, int miValue, Long roleId) {
    jdbcTemplate.update("INSERT INTO ym_sys_user (id, account, nickname, password_hash, password_salt, status, mi_value, plan_name) VALUES (?, ?, ?, 'x', 'x', 'ACTIVE', ?, 'Standard')", id, account, account, miValue);
    jdbcTemplate.update("INSERT INTO ym_sys_user_role (user_id, role_id) VALUES (?, ?)", id, roleId);
  }

  private void insertLog(Long userId, int price, String status) {
    jdbcTemplate.update("INSERT INTO ym_mi_value_log (user_id, biz_type, price, before_balance, after_balance, status) VALUES (?, 'IMAGE', ?, 0, 0, ?)", userId, price, status);
  }

  private int currentStoredBalance(Long userId) {
    return jdbcTemplate.queryForObject("SELECT mi_value FROM ym_sys_user WHERE id = ?", Integer.class, userId);
  }

  private String logStatus(Long userId) {
    return jdbcTemplate.queryForObject("SELECT status FROM ym_mi_value_log WHERE user_id = ? ORDER BY id DESC LIMIT 1", String.class, userId);
  }
}
