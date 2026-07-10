package com.youmi.api.shop;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * 账号-店铺归属集成测试：用内嵌 H2(MODE=MySQL) 替代 RDS，真实加载 ShopService /
 * AuthService / AdminService（店铺与账号真实落 H2），仅桩掉对外的 ImageGenerationClient /
 * VideoGenerationClient，确保「店铺 CRUD / 注册必填绑定校验 / 后台改店解绑 / 按店铺筛选」
 * 全链路在真实数据上闭环。
 *
 * <p>测试用户统一使用高位 id（99003 管理员 / 99006 / 99007），与真实用户隔离；
 * 每个用例 @BeforeEach 重置数据与店铺，断言只针对这些测试数据。
 */
@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:youmiShopTest;MODE=MySQL;DB_CLOSE_DELAY=-1",
    "spring.datasource.driver-class-name=org.h2.Driver",
    "spring.datasource.username=sa",
    "spring.datasource.password=",
    "spring.sql.init.mode=never",
    "spring.jpa.hibernate.ddl-auto=none"})
@AutoConfigureMockMvc
@DisplayName("账号-店铺归属集成测试（CRUD+注册绑定+后台改店/筛选）")
class ShopAccountBindingTest {

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
  private static final Long U1 = 99006L; // 用于后台改店/解绑
  private static final Long U2 = 99007L; // 预绑 shop A，用于删除校验 + 筛选
  private static final Long SHOP_A = 1L;
  private static final Long SHOP_B = 2L;
  private String adminToken;

  @BeforeEach
  void setUp() {
    initSchema();
    resetData();
    adminToken = tokenService.createToken(ADMIN);
  }

  private void initSchema() {
    jdbcTemplate.execute(
        "CREATE TABLE IF NOT EXISTS ym_sys_role (id BIGINT PRIMARY KEY, code VARCHAR(64), name VARCHAR(64))");
    jdbcTemplate.execute(
        "CREATE TABLE IF NOT EXISTS ym_sys_user_role (user_id BIGINT, role_id BIGINT)");
    jdbcTemplate.execute("""
        CREATE TABLE IF NOT EXISTS ym_sys_user (
          id BIGINT AUTO_INCREMENT PRIMARY KEY, account VARCHAR(64), phone VARCHAR(32), nickname VARCHAR(64),
          password_hash VARCHAR(128), password_salt VARCHAR(64), status VARCHAR(20),
          mi_value INT, plan_name VARCHAR(64), shop_id BIGINT,
          created_at TIMESTAMP, updated_at TIMESTAMP)""");
    jdbcTemplate.execute("""
        CREATE TABLE IF NOT EXISTS ym_shop (
          id BIGINT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(128), code VARCHAR(64),
          platform VARCHAR(32), status VARCHAR(20), created_at TIMESTAMP, updated_at TIMESTAMP)""");
  }

  private void resetData() {
    jdbcTemplate.update("DELETE FROM ym_sys_user_role");
    jdbcTemplate.update("DELETE FROM ym_sys_user");
    jdbcTemplate.update("DELETE FROM ym_sys_role");
    jdbcTemplate.update("DELETE FROM ym_shop");
    jdbcTemplate.update(
        "INSERT INTO ym_sys_role (id, code, name) VALUES (1,'USER','用户'),(2,'ADMIN','管理员')");
    jdbcTemplate.update(
        "INSERT INTO ym_sys_user (id, account, phone, nickname, password_hash, password_salt, status, mi_value, plan_name, shop_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
        ADMIN, "admin", "Admin", "x", "x", "x", "ACTIVE", 100, "标准版", null);
    jdbcTemplate.update("INSERT INTO ym_sys_user_role (user_id, role_id) VALUES (?,?)", ADMIN, 2L);
    jdbcTemplate.update(
        "INSERT INTO ym_sys_user (id, account, phone, nickname, password_hash, password_salt, status, mi_value, plan_name, shop_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
        U1, "u1", "U1", "x", "x", "x", "ACTIVE", 100, "标准版", null);
    jdbcTemplate.update("INSERT INTO ym_sys_user_role (user_id, role_id) VALUES (?,?)", U1, 1L);
    jdbcTemplate.update(
        "INSERT INTO ym_sys_user (id, account, phone, nickname, password_hash, password_salt, status, mi_value, plan_name, shop_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
        U2, "u2", "U2", "x", "x", "x", "ACTIVE", 100, "标准版", SHOP_A);
    jdbcTemplate.update("INSERT INTO ym_sys_user_role (user_id, role_id) VALUES (?,?)", U2, 1L);
    jdbcTemplate.update(
        "INSERT INTO ym_shop (id, name, code, platform, status, created_at, updated_at) VALUES (1,'店铺A','A001',NULL,'ACTIVE',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
    jdbcTemplate.update(
        "INSERT INTO ym_shop (id, name, code, platform, status, created_at, updated_at) VALUES (2,'店铺B','B002',NULL,'DISABLED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
  }

  // ===================== 请求辅助（req 前缀避免与 MockMvcRequestBuilders 静态导入冲突） =====================

  private MvcResult reqPost(String url, String token, String body) throws Exception {
    MockHttpServletRequestBuilder b = post(url).contentType(MediaType.APPLICATION_JSON).content(body);
    if (token != null) {
      b = b.header("Authorization", "Bearer " + token);
    }
    return mockMvc.perform(b).andReturn();
  }

  private MvcResult reqPut(String url, String token, String body) throws Exception {
    MockHttpServletRequestBuilder b = put(url).contentType(MediaType.APPLICATION_JSON).content(body);
    if (token != null) {
      b = b.header("Authorization", "Bearer " + token);
    }
    return mockMvc.perform(b).andReturn();
  }

  private MvcResult reqGet(String url, String token) throws Exception {
    MockHttpServletRequestBuilder b = get(url);
    if (token != null) {
      b = b.header("Authorization", "Bearer " + token);
    }
    return mockMvc.perform(b).andReturn();
  }

  private MvcResult reqDelete(String url, String token) throws Exception {
    MockHttpServletRequestBuilder b = delete(url);
    if (token != null) {
      b = b.header("Authorization", "Bearer " + token);
    }
    return mockMvc.perform(b).andReturn();
  }

  private JsonNode body(MvcResult r) throws Exception {
    return objectMapper.readTree(new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8));
  }

  private String msg(MvcResult r) throws Exception {
    return body(r).get("message").asText();
  }

  // ===================== 店铺 CRUD =====================

  @Test
  @DisplayName("创建店铺成功：200，返回 ACTIVE 店铺视图（含 id/name/code/status）")
  void createShop_success() throws Exception {
    MvcResult r = reqPost("/api/admin/shops", adminToken, "{\"name\":\"新店铺\",\"code\":\"NEW01\"}");
    assertEquals(200, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    JsonNode d = body(r).get("data");
    assertEquals("新店铺", d.get("name").asText());
    assertEquals("NEW01", d.get("code").asText());
    assertEquals("ACTIVE", d.get("status").asText());
  }

  @Test
  @DisplayName("创建店铺 name 为空：400，文案含「店铺名称不能为空」")
  void createShop_emptyName() throws Exception {
    MvcResult r = reqPost("/api/admin/shops", adminToken, "{\"name\":\"\",\"code\":\"X1\"}");
    assertEquals(400, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    assertTrue(msg(r).contains("店铺名称不能为空"), msg(r));
  }

  @Test
  @DisplayName("创建店铺 code 重复：400，文案含「店铺编码已存在」")
  void createShop_dupCode() throws Exception {
    reqPost("/api/admin/shops", adminToken, "{\"name\":\"店1\",\"code\":\"DUP\"}");
    MvcResult r = reqPost("/api/admin/shops", adminToken, "{\"name\":\"店2\",\"code\":\"DUP\"}");
    assertEquals(400, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    assertTrue(msg(r).contains("店铺编码已存在"), msg(r));
  }

  @Test
  @DisplayName("删除店铺仍有账号：400，文案含「该店铺下仍有账号，无法删除」")
  void deleteShop_withUsers() throws Exception {
    MvcResult r = reqDelete("/api/admin/shops/" + SHOP_A, adminToken);
    assertEquals(400, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    assertTrue(msg(r).contains("该店铺下仍有账号"), msg(r));
  }

  @Test
  @DisplayName("公开列表 /api/shops 只返 ACTIVE 店铺（不含 DISABLED 的店铺B）")
  void publicList_onlyActive() throws Exception {
    MvcResult r = reqGet("/api/shops", null);
    assertEquals(200, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    JsonNode arr = body(r).get("data");
    assertEquals(1, arr.size(), "应只返回 ACTIVE 的店铺A");
    assertEquals("店铺A", arr.get(0).get("name").asText());
    assertEquals("A001", arr.get(0).get("code").asText());
  }

  @Test
  @DisplayName("无 token 访问后台店铺接口：401")
  void admin_noToken_401() throws Exception {
    MvcResult r = reqPost("/api/admin/shops", null, "{\"name\":\"x\",\"code\":\"y\"}");
    assertEquals(401, r.getResponse().getStatus(), r.getResponse().getContentAsString());
  }

  // ===================== 注册绑定校验 =====================

  @Test
  @DisplayName("注册不传 shopId：200，DB shop_id 为 NULL（店铺由后台后续分配）")
  void register_emptyShop() throws Exception {
    MvcResult r = reqPost("/api/auth/register", null, "{\"account\":\"nu1\",\"password\":\"p\"}");
    assertEquals(200, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    Long dbShop = jdbcTemplate.queryForObject(
        "SELECT shop_id FROM ym_sys_user WHERE account='nu1'", Long.class);
    assertTrue(dbShop == null, "注册未传 shopId 时 shop_id 应为 NULL");
  }

  @Test
  @DisplayName("注册 shopId 不存在：400，文案含「请选择有效的店铺」")
  void register_shopNotExists() throws Exception {
    MvcResult r = reqPost("/api/auth/register", null, "{\"account\":\"nu2\",\"password\":\"p\",\"shopId\":999}");
    assertEquals(400, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    assertTrue(msg(r).contains("请选择有效的店铺"), msg(r));
  }

  @Test
  @DisplayName("注册 shopId 为 DISABLED 店铺：400，文案含「请选择有效的店铺」")
  void register_disabledShop() throws Exception {
    MvcResult r = reqPost("/api/auth/register", null,
        "{\"account\":\"nu3\",\"password\":\"p\",\"shopId\":" + SHOP_B + "}");
    assertEquals(400, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    assertTrue(msg(r).contains("请选择有效的店铺"), msg(r));
  }

  @Test
  @DisplayName("注册正常绑定店铺：200，DB ym_sys_user.shop_id 写入")
  void register_bindShop() throws Exception {
    MvcResult r = reqPost("/api/auth/register", null,
        "{\"account\":\"nu4\",\"password\":\"p\",\"shopId\":" + SHOP_A + "}");
    assertEquals(200, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    Long dbShop = jdbcTemplate.queryForObject(
        "SELECT shop_id FROM ym_sys_user WHERE account='nu4'", Long.class);
    assertEquals(SHOP_A, dbShop, "注册应写入 shop_id");
  }

  // ===================== 后台改店 / 筛选 =====================

  @Test
  @DisplayName("后台更新用户改 shopId：200，DB shop_id 更新")
  void admin_updateShop() throws Exception {
    MvcResult r = reqPut("/api/admin/users/" + U1, adminToken, "{\"shopId\":" + SHOP_A + "}");
    assertEquals(200, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    Long dbShop = jdbcTemplate.queryForObject("SELECT shop_id FROM ym_sys_user WHERE id=" + U1, Long.class);
    assertEquals(SHOP_A, dbShop);
  }

  @Test
  @DisplayName("后台更新用户 shopId=null 解绑：200，DB shop_id 为 NULL")
  void admin_unbindShop() throws Exception {
    jdbcTemplate.update("UPDATE ym_sys_user SET shop_id=? WHERE id=?", SHOP_A, U1);
    MvcResult r = reqPut("/api/admin/users/" + U1, adminToken, "{\"shopId\":null}");
    assertEquals(200, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    Long dbShop = jdbcTemplate.queryForObject("SELECT shop_id FROM ym_sys_user WHERE id=" + U1, Long.class);
    assertTrue(dbShop == null, "解绑后 shop_id 应为 NULL");
  }

  @Test
  @DisplayName("后台按 shopId 筛选：只返该店铺用户，且 row 含 shopName")
  void admin_filterByShop() throws Exception {
    MvcResult r = reqGet("/api/admin/users?shopId=" + SHOP_A, adminToken);
    assertEquals(200, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    JsonNode arr = body(r).get("data");
    assertEquals(1, arr.size(), "shop A 仅绑了 U2");
    assertEquals(SHOP_A, arr.get(0).get("shopId").asLong());
    assertEquals("店铺A", arr.get(0).get("shopName").asText());
  }

  @Test
  @DisplayName("后台更新用户 shopId 不存在：400，文案含「请选择有效的店铺」")
  void admin_updateShopNotExists() throws Exception {
    MvcResult r = reqPut("/api/admin/users/" + U1, adminToken, "{\"shopId\":999}");
    assertEquals(400, r.getResponse().getStatus(), r.getResponse().getContentAsString());
    assertTrue(msg(r).contains("请选择有效的店铺"), msg(r));
  }

  // ===================== 创建账号自动建店 =====================

  @Test
  @DisplayName("创建账号传 shopName 新名称+shopPlatform：自动建店铺并绑定，platform 写入正确")
  void admin_createUser_autoCreateShop() throws Exception {
    String body = "{"
        + "\"account\":\"au1\",\"password\":\"p123456\","
        + "\"shopName\":\"全新店铺\",\"shopPlatform\":\"抖音\""
        + "}";
    MvcResult r = reqPost("/api/admin/users", adminToken, body);
    assertEquals(200, r.getResponse().getStatus(), r.getResponse().getContentAsString());

    /* 确认新店铺已创建且 platform 正确 */
    Map<String, Object> shop = jdbcTemplate.queryForMap(
        "SELECT id, `name`, platform FROM ym_shop WHERE `name`='全新店铺'");
    assertEquals("全新店铺", shop.get("name"));
    assertEquals("抖音", shop.get("platform"), "新店铺 platform 应为传入的「抖音」");

    /* 确认用户绑定了该新店 */
    Long userShop = jdbcTemplate.queryForObject(
        "SELECT shop_id FROM ym_sys_user WHERE account='au1'", Long.class);
    assertEquals(shop.get("id"), userShop, "新账号应绑定自动创建的店铺");
  }

  @Test
  @DisplayName("创建账号传 shopName 已有名称：复用已有店铺 ID，不重复创建")
  void admin_createUser_shopNameReusesExisting() throws Exception {
    long before = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM ym_shop", Long.class);
    String body = "{"
        + "\"account\":\"au2\",\"password\":\"p123456\","
        + "\"shopName\":\"店铺A\""
        + "}";
    MvcResult r = reqPost("/api/admin/users", adminToken, body);
    assertEquals(200, r.getResponse().getStatus(), r.getResponse().getContentAsString());

    /* 店铺数不变（没有新建） */
    long after = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM ym_shop", Long.class);
    assertEquals(before, after, "不应重复创建已有店铺");

    /* 用户绑定的是 SHOP_A */
    Long userShop = jdbcTemplate.queryForObject(
        "SELECT shop_id FROM ym_sys_user WHERE account='au2'", Long.class);
    assertEquals(SHOP_A, userShop, "应复用已有店铺 A 的 ID");
  }
}
