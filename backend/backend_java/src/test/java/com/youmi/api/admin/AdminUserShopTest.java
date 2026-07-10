package com.youmi.api.admin;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.auth.TokenService;
import com.youmi.api.image.ImageGenerationClient;
import com.youmi.api.video.VideoGenerationClient;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
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
 * 后台账号店铺归属测试：用内嵌 H2(MODE=MySQL) 替代 RDS，真实加载 AdminController / AdminService /
 * ShopRepository / UserRepository，桩掉外部生成客户端。验证 createUser 写 shop_id、updateUser
 * 改店/解绑(NULL)、listUsers 按 shopId 筛选、getUser 返回 shopName。
 */
@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:youmiAdminUser;MODE=MySQL;DB_CLOSE_DELAY=-1",
    "spring.datasource.driver-class-name=org.h2.Driver",
    "spring.datasource.username=sa",
    "spring.datasource.password=",
    "spring.sql.init.mode=never",
    "spring.jpa.hibernate.ddl-auto=none"
})
@AutoConfigureMockMvc
@DisplayName("后台账号店铺归属测试（create/update/list/getUser）")
class AdminUserShopTest {

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

  private static final Long ADMIN = 99003L;
  private String adminToken;

  @BeforeEach
  void setUp() {
    initSchema();
    resetData();
    insertRole(1L, "USER");
    insertRole(2L, "ADMIN");
    insertUser(ADMIN, "admin_user", List.of(2L));
    adminToken = tokenService.createToken(ADMIN);
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
    jdbcTemplate.update("INSERT INTO ym_sys_role (id, code, name) VALUES (1, 'USER', '用户'), (2, 'ADMIN', '管理员')");
  }

  private void insertRole(Long id, String code) {
    jdbcTemplate.update("INSERT INTO ym_sys_role (id, code, name) VALUES (?, ?, ?)", id, code, code);
  }

  private void insertUser(Long id, String account, List<Long> roleIds) {
    jdbcTemplate.update(
        "INSERT INTO ym_sys_user (id, account, phone, nickname, password_hash, password_salt, status, mi_value, plan_name) "
            + "VALUES (?, ?, NULL, ?, 'x', 'x', 'ACTIVE', 0, '普通用户')",
        id, account, account);
    for (Long roleId : roleIds) {
      jdbcTemplate.update("INSERT INTO ym_sys_user_role (user_id, role_id) VALUES (?, ?)", id, roleId);
    }
  }

  private Long insertShop(String name, String code, String status) {
    jdbcTemplate.update(
        "INSERT INTO ym_shop (name, code, platform, status) VALUES (?, ?, NULL, ?)", name, code, status);
    return jdbcTemplate.queryForObject("SELECT id FROM ym_shop WHERE code = ?", Long.class, code);
  }

  private MvcResult createUser(String account, Long shopId) throws Exception {
    Map<String, Object> body = new HashMap<>();
    body.put("account", account);
    body.put("password", "pw123456");
    if (shopId != null) body.put("shopId", shopId);
    return mockMvc.perform(post("/api/admin/users")
        .header("Authorization", "Bearer " + adminToken)
        .contentType(MediaType.APPLICATION_JSON)
        .content(objectMapper.writeValueAsString(body))).andReturn();
  }

  private JsonNode bodyOf(MvcResult r) throws Exception {
    return objectMapper.readTree(new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8));
  }

  // ===================== createUser 写 shop_id =====================

  @Test
  @DisplayName("后台建账号：带 shopId → HTTP 200，shopId 写入且 shopName 回填")
  void createUser_withShop() throws Exception {
    Long shop = insertShop("店铺甲", "SHOP_A", "ACTIVE");
    MvcResult r = createUser("u_a", shop);
    assertEquals(200, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    JsonNode data = bodyOf(r).get("data");
    assertEquals(shop.longValue(), data.get("shopId").asLong());
    assertEquals("店铺甲", data.get("shopName").asText(), "应回填店铺名称");
  }

  @Test
  @DisplayName("后台建账号：shopId 不存在 → HTTP 400 且文案含「请选择有效的店铺」")
  void createUser_invalidShop400() throws Exception {
    MvcResult r = createUser("u_bad", 99999L);
    assertEquals(400, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    assertTrue(bodyOf(r).get("message").asText().contains("请选择有效的店铺"));
  }

  // ===================== updateUser 改店 / 解绑 =====================

  @Test
  @DisplayName("后台改账号：更换为有效店铺 → HTTP 200，shopId 更新")
  void updateUser_changeShop() throws Exception {
    Long shop1 = insertShop("店铺一", "SHOP_1", "ACTIVE");
    Long shop2 = insertShop("店铺二", "SHOP_2", "ACTIVE");
    Long userId = bodyOf(createUser("u_change", shop1)).get("data").get("id").asLong();

    MvcResult r = mockMvc.perform(put("/api/admin/users/" + userId)
        .header("Authorization", "Bearer " + adminToken)
        .contentType(MediaType.APPLICATION_JSON)
        .content(objectMapper.writeValueAsString(Map.of("shopId", shop2)))).andReturn();
    assertEquals(200, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    JsonNode data = bodyOf(r).get("data");
    assertEquals(shop2.longValue(), data.get("shopId").asLong(), "应切换到新店铺");
    assertEquals("店铺二", data.get("shopName").asText());
  }

  @Test
  @DisplayName("后台改账号：shopId 置 NULL → HTTP 200，shopId 与 shopName 均为 null（解绑）")
  void updateUser_unbindNull() throws Exception {
    Long shop1 = insertShop("店铺一", "SHOP_1", "ACTIVE");
    Long userId = bodyOf(createUser("u_unbind", shop1)).get("data").get("id").asLong();

    Map<String, Object> body = new HashMap<>();
    body.put("shopId", null);
    MvcResult r = mockMvc.perform(put("/api/admin/users/" + userId)
        .header("Authorization", "Bearer " + adminToken)
        .contentType(MediaType.APPLICATION_JSON)
        .content(objectMapper.writeValueAsString(body))).andReturn();
    assertEquals(200, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    JsonNode data = bodyOf(r).get("data");
    assertTrue(data.get("shopId").isNull(), "解绑后 shopId 应为 JSON null");
    assertTrue(data.get("shopName").isNull(), "shopName 应为 JSON null");
  }

  @Test
  @DisplayName("后台改账号：shopId 为不存在的店铺 → HTTP 400 且文案含「请选择有效的店铺」")
  void updateUser_invalidShop400() throws Exception {
    Long shop1 = insertShop("店铺一", "SHOP_1", "ACTIVE");
    Long userId = bodyOf(createUser("u_bad2", shop1)).get("data").get("id").asLong();

    MvcResult r = mockMvc.perform(put("/api/admin/users/" + userId)
        .header("Authorization", "Bearer " + adminToken)
        .contentType(MediaType.APPLICATION_JSON)
        .content(objectMapper.writeValueAsString(Map.of("shopId", 99999L)))).andReturn();
    assertEquals(400, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    assertTrue(bodyOf(r).get("message").asText().contains("请选择有效的店铺"));
  }

  // ===================== listUsers 按 shopId 筛选 =====================

  @Test
  @DisplayName("后台账号列表：shopId 过滤仅返回该店铺账号")
  void listUsers_filterByShop() throws Exception {
    Long shop1 = insertShop("店铺一", "SHOP_1", "ACTIVE");
    Long shop2 = insertShop("店铺二", "SHOP_2", "ACTIVE");
    bodyOf(createUser("u_s1a", shop1)).get("data").get("id").asLong();
    bodyOf(createUser("u_s1b", shop1)).get("data").get("id").asLong();
    bodyOf(createUser("u_s2a", shop2)).get("data").get("id").asLong();

    MvcResult r = mockMvc.perform(get("/api/admin/users")
        .header("Authorization", "Bearer " + adminToken)
        .param("shopId", String.valueOf(shop1))).andReturn();
    assertEquals(200, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    JsonNode data = bodyOf(r).get("data");
    assertEquals(2, data.size(), "shop1 下应有 2 个账号");
    for (JsonNode u : data) {
      assertEquals(shop1.longValue(), u.get("shopId").asLong());
    }
  }

  // ===================== getUser 返回 shopId / shopName =====================

  @Test
  @DisplayName("后台查单个账号：返回 shopId 与 shopName（NULL 时 shopName 为 null）")
  void getUser_returnsShopName() throws Exception {
    Long shop1 = insertShop("店铺一", "SHOP_1", "ACTIVE");
    Long userId = bodyOf(createUser("u_get", shop1)).get("data").get("id").asLong();

    MvcResult r = mockMvc.perform(get("/api/admin/users/" + userId)
        .header("Authorization", "Bearer " + adminToken)).andReturn();
    assertEquals(200, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    JsonNode data = bodyOf(r).get("data");
    assertEquals(shop1.longValue(), data.get("shopId").asLong());
    assertEquals("店铺一", data.get("shopName").asText());

    // 解绑后再查，shopName 应为 null
    Map<String, Object> unbind = new HashMap<>();
    unbind.put("shopId", null);
    mockMvc.perform(put("/api/admin/users/" + userId)
        .header("Authorization", "Bearer " + adminToken)
        .contentType(MediaType.APPLICATION_JSON)
        .content(objectMapper.writeValueAsString(unbind))).andReturn();

    MvcResult r2 = mockMvc.perform(get("/api/admin/users/" + userId)
        .header("Authorization", "Bearer " + adminToken)).andReturn();
    JsonNode data2 = bodyOf(r2).get("data");
    assertTrue(data2.get("shopId").isNull());
    assertTrue(data2.get("shopName").isNull(), "解绑后 shopName 应为 null");
  }
}
