package com.youmi.api.shop;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.auth.TokenService;
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
 * 店铺控制器集成测试：用内嵌 H2(MODE=MySQL) 替代 RDS，真实加载 ShopController / ShopService /
 * AdminAuthService（鉴权真实走 TokenService 文件降级），仅桩掉对外的 ImageGenerationClient /
 * VideoGenerationClient。验证后台 CRUD 的 HTTP 状态与文案，以及公开列表仅返 ACTIVE。
 */
@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:youmiShopController;MODE=MySQL;DB_CLOSE_DELAY=-1",
    "spring.datasource.driver-class-name=org.h2.Driver",
    "spring.datasource.username=sa",
    "spring.datasource.password=",
    "spring.sql.init.mode=never",
    "spring.jpa.hibernate.ddl-auto=none"
})
@AutoConfigureMockMvc
@DisplayName("店铺控制器集成测试（MockMvc + 真实 ShopService）")
class ShopControllerTest {

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
    insertUser(ADMIN, "shop_admin", List.of(2L));
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

  private MvcResult postShop(String token, String body) throws Exception {
    return mockMvc.perform(post("/api/admin/shops")
        .header("Authorization", "Bearer " + token)
        .contentType(MediaType.APPLICATION_JSON)
        .content(body)).andReturn();
  }

  private Long createShopAndGetId(String name, String code) throws Exception {
    MvcResult r = postShop(adminToken, objectMapper.writeValueAsString(Map.of("name", name, "code", code)));
    assertEquals(200, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    return objectMapper.readTree(r.getResponse().getContentAsString()).get("data").get("id").asLong();
  }

  private JsonNode bodyOf(MvcResult r) throws Exception {
    return objectMapper.readTree(new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8));
  }

  // ===================== 新建 =====================

  @Test
  @DisplayName("新建店铺：后台成功 → HTTP 200，status=ACTIVE，code 大写")
  void create_success() throws Exception {
    MvcResult r = postShop(adminToken,
        objectMapper.writeValueAsString(Map.of("name", "店铺A", "code", "code-a", "platform", "taobao")));
    assertEquals(200, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    JsonNode data = bodyOf(r).get("data");
    assertTrue(data.get("id").asLong() > 0);
    assertEquals("CODE-A", data.get("code").asText(), "code 应自动大写");
    assertEquals("ACTIVE", data.get("status").asText());
  }

  @Test
  @DisplayName("新建店铺：code 唯一冲突 → HTTP 400 且文案含「店铺编码已存在」")
  void create_codeConflict400() throws Exception {
    createShopAndGetId("店铺A", "CODE1");
    MvcResult r = postShop(adminToken, objectMapper.writeValueAsString(Map.of("name", "店铺B", "code", "code1")));
    assertEquals(400, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    assertTrue(bodyOf(r).get("message").asText().contains("店铺编码已存在"));
  }

  @Test
  @DisplayName("新建店铺：name 为空 → HTTP 400")
  void create_nameEmpty400() throws Exception {
    MvcResult r = postShop(adminToken,
        objectMapper.writeValueAsString(Map.of("name", "  ", "code", "CODEX")));
    assertEquals(400, r.getResponse().getStatus(), r.getResponse().getContentAsString());
  }

  // ===================== 更新 =====================

  @Test
  @DisplayName("更新店铺：改名+停用 → HTTP 200，status=DISABLED")
  void update_success() throws Exception {
    Long id = createShopAndGetId("店铺A", "CODE1");
    MvcResult r = mockMvc.perform(put("/api/admin/shops/" + id)
        .header("Authorization", "Bearer " + adminToken)
        .contentType(MediaType.APPLICATION_JSON)
        .content(objectMapper.writeValueAsString(Map.of("name", "店铺A改名", "status", "DISABLED")))).andReturn();
    assertEquals(200, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    assertEquals("DISABLED", bodyOf(r).get("data").get("status").asText());
  }

  @Test
  @DisplayName("更新店铺：店铺不存在 → HTTP 404 且文案含「店铺不存在」")
  void update_notFound404() throws Exception {
    MvcResult r = mockMvc.perform(put("/api/admin/shops/99999")
        .header("Authorization", "Bearer " + adminToken)
        .contentType(MediaType.APPLICATION_JSON)
        .content(objectMapper.writeValueAsString(Map.of("name", "x", "status", "DISABLED")))).andReturn();
    assertEquals(404, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    assertTrue(bodyOf(r).get("message").asText().contains("店铺不存在"));
  }

  // ===================== 列表 =====================

  @Test
  @DisplayName("后台列表：status=DISABLED 过滤正确")
  void list_filterByStatus() throws Exception {
    createShopAndGetId("A", "A1");
    Long bId = createShopAndGetId("B", "B1");
    createShopAndGetId("C", "C1");
    mockMvc.perform(put("/api/admin/shops/" + bId)
        .header("Authorization", "Bearer " + adminToken)
        .contentType(MediaType.APPLICATION_JSON)
        .content(objectMapper.writeValueAsString(Map.of("status", "DISABLED")))).andReturn();

    MvcResult r = mockMvc.perform(get("/api/admin/shops")
        .header("Authorization", "Bearer " + adminToken)
        .param("status", "DISABLED")).andReturn();
    assertEquals(200, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    assertEquals(1, bodyOf(r).get("data").size());
    assertEquals("DISABLED", bodyOf(r).get("data").get(0).get("status").asText());
  }

  // ===================== 删除 =====================

  @Test
  @DisplayName("删除店铺：无账号绑定 → HTTP 200，随后查询不到")
  void delete_success() throws Exception {
    Long id = createShopAndGetId("A", "A1");
    MvcResult r = mockMvc.perform(delete("/api/admin/shops/" + id)
        .header("Authorization", "Bearer " + adminToken)).andReturn();
    assertEquals(200, r.getResponse().getStatus(), r.getResponse().getContentAsString());

    MvcResult r2 = mockMvc.perform(get("/api/admin/shops")
        .header("Authorization", "Bearer " + adminToken)).andReturn();
    boolean stillThere = false;
    for (JsonNode s : bodyOf(r2).get("data")) {
      if (s.get("id").asLong() == id) stillThere = true;
    }
    assertTrue(!stillThere, "删除后不应再出现在列表");
  }

  @Test
  @DisplayName("删除店铺：仍有账号绑定 → HTTP 400 且文案含「该店铺下仍有账号，无法删除」")
  void delete_boundUsers400() throws Exception {
    Long id = createShopAndGetId("A", "A1");
    jdbcTemplate.update(
        "INSERT INTO ym_sys_user (account, password_hash, password_salt, status, nickname, mi_value, shop_id) "
            + "VALUES (?, 'h', 's', 'ACTIVE', ?, 0, ?)",
        "bound" + id, "bound" + id, id);
    MvcResult r = mockMvc.perform(delete("/api/admin/shops/" + id)
        .header("Authorization", "Bearer " + adminToken)).andReturn();
    assertEquals(400, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    assertTrue(bodyOf(r).get("message").asText().contains("该店铺下仍有账号，无法删除"));
  }

  // ===================== 公开列表 =====================

  @Test
  @DisplayName("公开列表：无需登录，仅返 ACTIVE 的 id/name/code")
  void public_list_onlyActive() throws Exception {
    Long activeId = createShopAndGetId("A店", "A1");
    Long disabledId = createShopAndGetId("B店", "B1");
    mockMvc.perform(put("/api/admin/shops/" + disabledId)
        .header("Authorization", "Bearer " + adminToken)
        .contentType(MediaType.APPLICATION_JSON)
        .content(objectMapper.writeValueAsString(Map.of("status", "DISABLED")))).andReturn();

    MvcResult r = mockMvc.perform(get("/api/shops")).andReturn();
    assertEquals(200, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    JsonNode data = bodyOf(r).get("data");
    assertEquals(1, data.size(), "公开列表应只有 1 个 ACTIVE");
    assertEquals(activeId.longValue(), data.get(0).get("id").asLong());
    assertEquals("A店", data.get(0).get("name").asText());
    assertEquals("A1", data.get(0).get("code").asText());
    assertTrue(data.get(0).get("platform") == null || data.get(0).get("platform").isNull(),
        "公开视图不应暴露 platform 等内部字段");
  }
}
