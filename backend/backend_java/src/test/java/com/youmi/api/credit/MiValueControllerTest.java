package com.youmi.api.credit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.auth.TokenService;
import com.youmi.api.image.ImageGenerationClient;
import com.youmi.api.image.ImageGenerationDtos;
import com.youmi.api.video.VideoGenerationClient;
import com.youmi.api.video.VideoGenerationDtos;
import java.nio.charset.StandardCharsets;
import java.util.List;
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

/**
 * 米值闸门控制器集成测试：用内嵌 H2(MODE=MySQL) 替代 RDS，真实加载 {@code MiValueService} /
 * {@code MiValueRepository} / {@code UserRepository}（余额与流水真实落 H2），仅桩掉对外的
 * {@link ImageGenerationClient} / {@link VideoGenerationClient}，确保「不足拦截 / 扣减 / 失败回滚 /
 * 视频同闸门 / 管理后台鉴权调账」全链路在真实数据上闭环。
 *
 * <p>测试用户统一使用高位 id（99001~99005），与真实用户隔离；每个用例 @BeforeEach 重置数据与余额，
 * 断言只针对这些测试用户，绝不触碰真实余额。
 */
@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:youmiMiController;MODE=MySQL;DB_CLOSE_DELAY=-1",
    "spring.datasource.driver-class-name=org.h2.Driver",
    "spring.datasource.username=sa",
    "spring.datasource.password=",
    "spring.sql.init.mode=never",
    "spring.jpa.hibernate.ddl-auto=none"
})
@AutoConfigureMockMvc
@DisplayName("米值闸门控制器集成测试（生图/视频/管理后台）")
class MiValueControllerTest {

  @Autowired
  private MockMvc mockMvc;
  @Autowired
  private TokenService tokenService;
  @Autowired
  private JdbcTemplate jdbcTemplate;

  @MockBean
  private ImageGenerationClient imageGenerationClient;
  @MockBean
  private VideoGenerationClient videoGenerationClient;

  private final ObjectMapper objectMapper = new ObjectMapper();

  private static final Long IMAGE_USER = 99001L;
  private static final Long VIDEO_USER = 99002L;
  private static final Long ADMIN_USER = 99003L;
  private static final Long NORMAL_USER = 99004L;
  private static final Long TARGET_USER = 99005L;

  private String imageToken;
  private String videoToken;
  private String adminToken;
  private String normalToken;

  @BeforeEach
  void setUp() {
    initSchema();
    resetData();
    imageToken = tokenService.createToken(IMAGE_USER);
    videoToken = tokenService.createToken(VIDEO_USER);
    adminToken = tokenService.createToken(ADMIN_USER);
    normalToken = tokenService.createToken(NORMAL_USER);
  }

  private void initSchema() {
    jdbcTemplate.execute("""
        CREATE TABLE IF NOT EXISTS ym_sys_user (
          id BIGINT PRIMARY KEY, account VARCHAR(64), phone VARCHAR(32), nickname VARCHAR(64),
          password_hash VARCHAR(128), password_salt VARCHAR(64), status VARCHAR(20),
          mi_value INT, plan_name VARCHAR(64), shop_id BIGINT)
        """);
    jdbcTemplate.execute("""
        CREATE TABLE IF NOT EXISTS ym_sys_role (id BIGINT PRIMARY KEY, code VARCHAR(64), name VARCHAR(64))
        """);
    jdbcTemplate.execute("""
        CREATE TABLE IF NOT EXISTS ym_sys_user_role (user_id BIGINT, role_id BIGINT)
        """);
    jdbcTemplate.execute("""
        CREATE TABLE IF NOT EXISTS ym_shop (
          id BIGINT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(128), code VARCHAR(64),
          platform VARCHAR(32), status VARCHAR(20), created_at TIMESTAMP, updated_at TIMESTAMP)
        """);
    jdbcTemplate.execute("""
        CREATE TABLE IF NOT EXISTS ym_mi_value_log (
          id BIGINT PRIMARY KEY AUTO_INCREMENT, user_id BIGINT, biz_type VARCHAR(20),
          task_type VARCHAR(32), price INT, before_balance INT, after_balance INT,
          task_id VARCHAR(128), status VARCHAR(20), remark VARCHAR(255),
          created_at DATETIME, updated_at DATETIME)
        """);
  }

  private void resetData() {
    jdbcTemplate.update("DELETE FROM ym_mi_value_log");
    jdbcTemplate.update("DELETE FROM ym_sys_user_role");
    jdbcTemplate.update("DELETE FROM ym_sys_user");
    jdbcTemplate.update("DELETE FROM ym_sys_role");
    jdbcTemplate.update(
        "INSERT INTO ym_sys_role (id, code, name) VALUES (1, 'USER', '用户'), (2, 'ADMIN', '管理员')");
    insertUser(IMAGE_USER, "mi_image", 100, "标准版", List.of(1L));
    insertUser(VIDEO_USER, "mi_video", 100, "标准版", List.of(1L));
    insertUser(ADMIN_USER, "mi_admin", 1000, "管理员", List.of(2L));
    insertUser(NORMAL_USER, "mi_normal", 100, "标准版", List.of(1L));
    insertUser(TARGET_USER, "mi_target", 100, "标准版", List.of(1L));
  }

  private void insertUser(Long id, String account, int miValue, String plan, List<Long> roleIds) {
    jdbcTemplate.update(
        "INSERT INTO ym_sys_user (id, account, phone, nickname, password_hash, password_salt, status, mi_value, plan_name) "
            + "VALUES (?, ?, NULL, ?, 'x', 'x', 'ACTIVE', ?, ?)",
        id, account, account, miValue, plan);
    for (Long roleId : roleIds) {
      jdbcTemplate.update("INSERT INTO ym_sys_user_role (user_id, role_id) VALUES (?, ?)", id, roleId);
    }
  }

  private void setBalance(Long userId, int miValue) {
    jdbcTemplate.update("UPDATE ym_sys_user SET mi_value = ? WHERE id = ?", miValue, userId);
  }

  private int getBalance(Long userId) {
    return jdbcTemplate.queryForObject("SELECT mi_value FROM ym_sys_user WHERE id = ?", Integer.class, userId);
  }

  private int logCount(Long userId) {
    return jdbcTemplate.queryForObject("SELECT COUNT(*) FROM ym_mi_value_log WHERE user_id = ?",
        Integer.class, userId);
  }

  private String logStatus(Long userId) {
    List<String> s = jdbcTemplate.query("SELECT status FROM ym_mi_value_log WHERE user_id = ?",
        (rs, rn) -> rs.getString("status"), userId);
    return s.isEmpty() ? null : s.get(0);
  }

  private int logPrice(Long userId) {
    List<Integer> p = jdbcTemplate.query("SELECT price FROM ym_mi_value_log WHERE user_id = ?",
        (rs, rn) -> rs.getInt("price"), userId);
    return p.isEmpty() ? -1 : p.get(0);
  }

  private String logBizType(Long userId) {
    List<String> b = jdbcTemplate.query("SELECT biz_type FROM ym_mi_value_log WHERE user_id = ?",
        (rs, rn) -> rs.getString("biz_type"), userId);
    return b.isEmpty() ? null : b.get(0);
  }

  private MvcResult postImage(String token, String body) throws Exception {
    return mockMvc.perform(post("/api/image-tasks")
        .header("Authorization", "Bearer " + token)
        .contentType(MediaType.APPLICATION_JSON)
        .content(body)).andReturn();
  }

  private MvcResult postVideo(String token, String body) throws Exception {
    return mockMvc.perform(post("/api/video-tasks")
        .header("Authorization", "Bearer " + token)
        .contentType(MediaType.APPLICATION_JSON)
        .content(body)).andReturn();
  }

  // ===================== 生图：三态 =====================

  @Test
  @DisplayName("生图-余额不足拦截：HTTP 402 且文案含「米值不足」，绝不调用外部 imageGenerationClient，余额与流水不变")
  void image_insufficient_blocks402_noExternal() throws Exception {
    setBalance(IMAGE_USER, 5); // < IMAGE 单价 10

    MvcResult result = postImage(imageToken, "{\"prompt\":\"a cat\"}");

    assertEquals(402, result.getResponse().getStatus(), result.getResponse().getContentAsString());
    JsonNode body = objectMapper.readTree(new String(result.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8));
    assertTrue(body.get("message").asText().contains("米值不足"), "文案应含「米值不足」");
    // 资损防护核心：不足时绝不可发起外部生成调用
    verify(imageGenerationClient, never()).createTask(any());
    assertEquals(5, getBalance(IMAGE_USER), "余额不应变化");
    assertEquals(0, logCount(IMAGE_USER), "不应写入任何流水");
  }

  @Test
  @DisplayName("生图-余额充足：HTTP 200，consumedMi=10，balance 减 10，DB 流水 SUCCESS/price=10")
  void image_normal_deducts10() throws Exception {
    setBalance(IMAGE_USER, 100);
    // tasks=null 避免触发 ym_image_task 写入（与闸门验证无关），专注米值闭环
    ImageGenerationDtos.CreateTaskResponse resp =
        new ImageGenerationDtos.CreateTaskResponse("agnes", "", "model", "9:16", "2K", 1, null, null);
    when(imageGenerationClient.createTask(any())).thenReturn(resp);

    MvcResult result = postImage(imageToken, "{\"prompt\":\"a cat\"}");

    assertEquals(200, result.getResponse().getStatus(), result.getResponse().getContentAsString());
    JsonNode data = objectMapper.readTree(result.getResponse().getContentAsString()).get("data");
    assertEquals(10, data.get("consumedMi").asInt(), "consumedMi 应为单价 10");
    assertEquals(90, data.get("balance").asInt(), "响应余额应减 10");
    assertEquals(90, getBalance(IMAGE_USER), "DB 余额应减 10");
    assertEquals(1, logCount(IMAGE_USER), "应有一条流水");
    assertEquals("SUCCESS", logStatus(IMAGE_USER), "流水应置 SUCCESS");
    assertEquals(10, logPrice(IMAGE_USER), "流水 price 应为 10");
  }

  @Test
  @DisplayName("生图-外部生成失败：HTTP 502 且文案含「生成服务异常，米值已退回」，余额恢复，流水 ROLLBACK")
  void image_failure_rollsBack() throws Exception {
    setBalance(IMAGE_USER, 100);
    when(imageGenerationClient.createTask(any())).thenThrow(new RuntimeException("upstream down"));

    MvcResult result = postImage(imageToken, "{\"prompt\":\"a cat\"}");

    assertEquals(502, result.getResponse().getStatus(), result.getResponse().getContentAsString());
    JsonNode body = objectMapper.readTree(new String(result.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8));
    assertTrue(body.get("message").asText().contains("生成服务异常，米值已退回"), "文案应含「生成服务异常，米值已退回」");
    assertEquals(100, getBalance(IMAGE_USER), "余额应回滚恢复为 100");
    assertEquals(1, logCount(IMAGE_USER), "应有一条流水");
    assertEquals("ROLLBACK", logStatus(IMAGE_USER), "流水应置 ROLLBACK");
  }

  // ===================== 视频：三态（与生图镜像） =====================

  @Test
  @DisplayName("视频-余额不足拦截：HTTP 402 且文案含「米值不足」，绝不调用外部 videoGenerationClient，余额与流水不变")
  void video_insufficient_blocks402_noExternal() throws Exception {
    setBalance(VIDEO_USER, 5); // < VIDEO 单价 50

    MvcResult result = postVideo(videoToken, "{\"prompt\":\"a video\"}");

    assertEquals(402, result.getResponse().getStatus(), result.getResponse().getContentAsString());
    JsonNode body = objectMapper.readTree(new String(result.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8));
    assertTrue(body.get("message").asText().contains("米值不足"), "文案应含「米值不足」");
    verify(videoGenerationClient, never()).createTask(any());
    assertEquals(5, getBalance(VIDEO_USER), "余额不应变化");
    assertEquals(0, logCount(VIDEO_USER), "不应写入任何流水");
  }

  @Test
  @DisplayName("视频-余额充足：HTTP 200，consumedMi=50，balance 减 50，DB 流水 SUCCESS/price=50")
  void video_normal_deducts50() throws Exception {
    setBalance(VIDEO_USER, 100);
    VideoGenerationDtos.CreateTaskResponse resp = new VideoGenerationDtos.CreateTaskResponse();
    resp.setProvider("agnes");
    resp.setModel("model");
    resp.setTaskId("agnes-video:abc");
    resp.setStatus("submitted");
    when(videoGenerationClient.createTask(any())).thenReturn(resp);

    MvcResult result = postVideo(videoToken, "{\"prompt\":\"a video\"}");

    assertEquals(200, result.getResponse().getStatus(), result.getResponse().getContentAsString());
    JsonNode data = objectMapper.readTree(result.getResponse().getContentAsString()).get("data");
    assertEquals(50, data.get("consumedMi").asInt(), "consumedMi 应为单价 50");
    assertEquals(50, data.get("balance").asInt(), "响应余额应减 50");
    assertEquals(50, getBalance(VIDEO_USER), "DB 余额应减 50");
    assertEquals(1, logCount(VIDEO_USER), "应有一条流水");
    assertEquals("SUCCESS", logStatus(VIDEO_USER), "流水应置 SUCCESS");
    assertEquals(50, logPrice(VIDEO_USER), "流水 price 应为 50");
  }

  @Test
  @DisplayName("视频-外部生成失败：HTTP 502 且文案含「生成服务异常，米值已退回」，余额恢复，流水 ROLLBACK")
  void video_failure_rollsBack() throws Exception {
    setBalance(VIDEO_USER, 100);
    when(videoGenerationClient.createTask(any())).thenThrow(new RuntimeException("upstream down"));

    MvcResult result = postVideo(videoToken, "{\"prompt\":\"a video\"}");

    assertEquals(502, result.getResponse().getStatus(), result.getResponse().getContentAsString());
    JsonNode body = objectMapper.readTree(new String(result.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8));
    assertTrue(body.get("message").asText().contains("生成服务异常，米值已退回"), "文案应含「生成服务异常，米值已退回」");
    assertEquals(100, getBalance(VIDEO_USER), "余额应回滚恢复为 100");
    assertEquals(1, logCount(VIDEO_USER), "应有一条流水");
    assertEquals("ROLLBACK", logStatus(VIDEO_USER), "流水应置 ROLLBACK");
  }

  // ===================== 管理后台 =====================

  @Test
  @DisplayName("管理后台-无 token 访问调账接口：HTTP 401")
  void admin_noToken_401() throws Exception {
    mockMvc.perform(post("/api/admin/user/" + TARGET_USER + "/mi-value")
        .contentType(MediaType.APPLICATION_JSON)
        .content("{\"delta\":100,\"reason\":\"充值\"}"))
        .andExpect(status().isUnauthorized());
  }

  @Test
  @DisplayName("管理后台-普通用户 token 访问调账接口：HTTP 403（无控制台权限）")
  void admin_normalUser_403() throws Exception {
    mockMvc.perform(post("/api/admin/user/" + TARGET_USER + "/mi-value")
        .header("Authorization", "Bearer " + normalToken)
        .contentType(MediaType.APPLICATION_JSON)
        .content("{\"delta\":100,\"reason\":\"充值\"}"))
        .andExpect(status().isForbidden());
  }

  @Test
  @DisplayName("管理后台-admin token 查询米值：HTTP 200 返回 balance + planName")
  void admin_get_success() throws Exception {
    setBalance(TARGET_USER, 77);
    MvcResult result = mockMvc.perform(get("/api/admin/user/" + TARGET_USER + "/mi-value")
        .header("Authorization", "Bearer " + adminToken)).andReturn();
    assertEquals(200, result.getResponse().getStatus(), result.getResponse().getContentAsString());
    JsonNode data = objectMapper.readTree(result.getResponse().getContentAsString()).get("data");
    assertEquals(77, data.get("balance").asInt());
    assertNotNull(data.get("planName"), "应返回套餐名");
  }

  @Test
  @DisplayName("管理后台-admin token 正调账：余额按 delta 增加，流水 biz_type=ADMIN_ADJUST/SUCCESS")
  void admin_adjust_success() throws Exception {
    setBalance(TARGET_USER, 100);
    MvcResult result = mockMvc.perform(post("/api/admin/user/" + TARGET_USER + "/mi-value")
        .header("Authorization", "Bearer " + adminToken)
        .contentType(MediaType.APPLICATION_JSON)
        .content("{\"delta\":50,\"reason\":\"充值\"}")).andReturn();
    assertEquals(200, result.getResponse().getStatus(), result.getResponse().getContentAsString());
    JsonNode data = objectMapper.readTree(result.getResponse().getContentAsString()).get("data");
    assertEquals(150, data.get("balance").asInt(), "余额应增加 50");
    assertEquals(150, getBalance(TARGET_USER), "DB 余额应增加 50");
    assertEquals(1, logCount(TARGET_USER), "应有一条流水");
    assertEquals("ADMIN_ADJUST", logBizType(TARGET_USER), "流水 biz_type 应为 ADMIN_ADJUST");
    assertEquals("SUCCESS", logStatus(TARGET_USER), "流水应置 SUCCESS");
  }

  @Test
  @DisplayName("管理后台-admin token 负向调账：负到 0 不越界（GREATEST 钳制），余额下限为 0")
  void admin_adjust_negativeToZero() throws Exception {
    setBalance(TARGET_USER, 30);
    MvcResult result = mockMvc.perform(post("/api/admin/user/" + TARGET_USER + "/mi-value")
        .header("Authorization", "Bearer " + adminToken)
        .contentType(MediaType.APPLICATION_JSON)
        .content("{\"delta\":-100,\"reason\":\"扣减超额\"}")).andReturn();
    assertEquals(200, result.getResponse().getStatus(), result.getResponse().getContentAsString());
    assertEquals(0, getBalance(TARGET_USER), "30-100 应被 GREATEST 钳到 0，不得为负");
  }
}
