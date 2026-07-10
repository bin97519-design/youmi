package com.youmi.api.auth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.image.ImageGenerationClient;
import com.youmi.api.video.VideoGenerationClient;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
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
 * 注册绑定店铺测试：用内嵌 H2(MODE=MySQL) 替代 RDS，真实加载 AuthController / AuthService /
 * UserRepository / ShopRepository，桩掉外部生成客户端。验证 RegisterRequest.shopId 的必填校验
 * （null / 不存在 / 已停用 → 400「请选择有效的店铺」）以及正常绑定写入 ym_sys_user.shop_id。
 */
@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:youmiAuthRegister;MODE=MySQL;DB_CLOSE_DELAY=-1",
    "spring.datasource.driver-class-name=org.h2.Driver",
    "spring.datasource.username=sa",
    "spring.datasource.password=",
    "spring.sql.init.mode=never",
    "spring.jpa.hibernate.ddl-auto=none"
})
@AutoConfigureMockMvc
@DisplayName("注册绑定店铺测试（shopId 校验 + 写入）")
class AuthRegisterShopTest {

  @Autowired
  private MockMvc mockMvc;
  @Autowired
  private JdbcTemplate jdbcTemplate;

  @MockBean
  private ImageGenerationClient imageGenerationClient;
  @MockBean
  private VideoGenerationClient videoGenerationClient;

  private final ObjectMapper objectMapper = new ObjectMapper();

  @BeforeEach
  void setUp() {
    initSchema();
    resetData();
    jdbcTemplate.update("INSERT INTO ym_sys_role (id, code, name) VALUES (1, 'USER', '用户')");
  }

  private void initSchema() {
    jdbcTemplate.execute("""
        CREATE TABLE IF NOT EXISTS ym_shop (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          name VARCHAR(128) NOT NULL,
          code VARCHAR(64) NOT NULL UNIQUE,
          platform VARCHAR(32) NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
          created_at DATETIME,
          updated_at DATETIME,
          INDEX idx_shop_status (status))
        """);
    jdbcTemplate.execute("""
        CREATE TABLE IF NOT EXISTS ym_sys_role (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          code VARCHAR(64) NOT NULL UNIQUE,
          name VARCHAR(64) NOT NULL,
          created_at DATETIME)
        """);
    jdbcTemplate.execute("""
        CREATE TABLE IF NOT EXISTS ym_sys_user_role (user_id BIGINT NOT NULL, role_id BIGINT NOT NULL,
          PRIMARY KEY (user_id, role_id))
        """);
    jdbcTemplate.execute("""
        CREATE TABLE IF NOT EXISTS ym_sys_user (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          account VARCHAR(64) NOT NULL UNIQUE,
          phone VARCHAR(32) NULL,
          nickname VARCHAR(64) NOT NULL,
          password_hash VARCHAR(128) NOT NULL,
          password_salt VARCHAR(64) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
          mi_value INT NOT NULL DEFAULT 0,
          plan_name VARCHAR(32) NOT NULL DEFAULT '普通用户',
          shop_id BIGINT NULL,
          created_at DATETIME,
          updated_at DATETIME,
          INDEX idx_user_shop (shop_id))
        """);
  }

  private void resetData() {
    jdbcTemplate.update("DELETE FROM ym_sys_user_role");
    jdbcTemplate.update("DELETE FROM ym_sys_user");
    jdbcTemplate.update("DELETE FROM ym_sys_role");
    jdbcTemplate.update("DELETE FROM ym_shop");
    jdbcTemplate.update("INSERT INTO ym_sys_role (id, code, name) VALUES (1, 'USER', '用户')");
  }

  /** 插入一个店铺并返回其自增 id。 */
  private Long insertShop(String name, String code, String status) {
    jdbcTemplate.update(
        "INSERT INTO ym_shop (name, code, platform, status) VALUES (?, ?, NULL, ?)", name, code, status);
    return jdbcTemplate.queryForObject("SELECT id FROM ym_shop WHERE code = ?", Long.class, code);
  }

  private MvcResult register(String body) throws Exception {
    return mockMvc.perform(post("/api/auth/register")
        .contentType(MediaType.APPLICATION_JSON)
        .content(body)).andReturn();
  }

  private JsonNode bodyOf(MvcResult r) throws Exception {
    return objectMapper.readTree(new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8));
  }

  private Long shopIdOfUser(String account) {
    return jdbcTemplate.queryForObject("SELECT shop_id FROM ym_sys_user WHERE account = ?", Long.class, account);
  }

  @Test
  @DisplayName("注册：shopId 为 null → HTTP 400 且文案含「请选择有效的店铺」")
  void register_shopIdNull400() throws Exception {
    MvcResult r = register(objectMapper.writeValueAsString(
        Map.of("account", "acc_null", "password", "pw123456", "shopId", null)));
    assertEquals(400, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    assertTrue(bodyOf(r).get("message").asText().contains("请选择有效的店铺"));
    // 校验失败不应写入用户
    assertEquals(0, (int) jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM ym_sys_user WHERE account = 'acc_null'", Integer.class));
  }

  @Test
  @DisplayName("注册：shopId 对应店铺不存在 → HTTP 400 且文案含「请选择有效的店铺」")
  void register_shopIdNotExist400() throws Exception {
    MvcResult r = register(objectMapper.writeValueAsString(
        Map.of("account", "acc_no", "password", "pw123456", "shopId", 99999L)));
    assertEquals(400, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    assertTrue(bodyOf(r).get("message").asText().contains("请选择有效的店铺"));
    assertEquals(0, (int) jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM ym_sys_user WHERE account = 'acc_no'", Integer.class));
  }

  @Test
  @DisplayName("注册：shopId 对应店铺已停用(DISABLED) → HTTP 400 且文案含「请选择有效的店铺」")
  void register_shopDisabled400() throws Exception {
    Long disabledShop = insertShop("禁用店", "DISABLED1", "DISABLED");
    MvcResult r = register(objectMapper.writeValueAsString(
        Map.of("account", "acc_dis", "password", "pw123456", "shopId", disabledShop)));
    assertEquals(400, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    assertTrue(bodyOf(r).get("message").asText().contains("请选择有效的店铺"));
    assertEquals(0, (int) jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM ym_sys_user WHERE account = 'acc_dis'", Integer.class));
  }

  @Test
  @DisplayName("注册：shopId 有效且 ACTIVE → HTTP 200，写入 shop_id，响应 profile.shopId 一致")
  void register_normalBound200() throws Exception {
    Long activeShop = insertShop("启用店", "ACTIVE1", "ACTIVE");
    MvcResult r = register(objectMapper.writeValueAsString(
        Map.of("account", "acc_ok", "password", "pw123456", "shopId", activeShop)));
    assertEquals(200, r.getResponse().getStatus(), r.getResponse().getContentAsString());

    JsonNode data = bodyOf(r).get("data");
    assertNotNull(data, "应返回登录态 data");
    JsonNode profile = data.get("user");
    assertNotNull(profile, "data.user 不应为空");
    assertEquals(activeShop.longValue(), profile.get("shopId").asLong(), "响应 profile.shopId 应与所选店铺一致");

    Long dbShopId = shopIdOfUser("acc_ok");
    assertEquals(activeShop, dbShopId, "ym_sys_user.shop_id 应正确写入");
  }
}
