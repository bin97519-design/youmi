package com.youmi.api.canvas;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.admin.AdminCanvasController;
import com.youmi.api.auth.TokenService;
import com.youmi.api.auth.UserAccount;
import com.youmi.api.auth.UserRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 画布数据隔离机制集成测试。
 *
 * <p>目标：证明隔离在「接口层」与「数据层」双重生效，且无法被越权绕过。
 *
 * <p>策略：
 * <ul>
 *   <li>用 {@link SpringBootTest} + 内嵌 H2(MODE=MySQL) 替代 RDS 数据源，隔离且不依赖外网。</li>
 *   <li>用 {@link MockBean} 桩 {@link UserRepository#findById} 返回 A(ADMIN) / B(USER)，
 *       避免依赖真实用户表与角色关联表。</li>
 *   <li>用真实 {@link TokenService#createToken} 造 token（Redis 不可用时自动落文件降级），
 *       真实走一遍 Authorization: Bearer &lt;token&gt; 的鉴权链路。</li>
 *   <li>用 {@link JdbcTemplate} 直接 INSERT 跨用户画布数据，断言各接口的可见/越权行为。</li>
 * </ul>
 */
@SpringBootTest(properties = {
    // 用内嵌 H2 替换 RDS MySQL；MODE=MySQL 以兼容仓库里的 MySQL 风格 SQL
    "spring.datasource.url=jdbc:h2:mem:youmiCanvasIsolation;MODE=MySQL;DB_CLOSE_DELAY=-1",
    "spring.datasource.driver-class-name=org.h2.Driver",
    "spring.datasource.username=sa",
    "spring.datasource.password=",
    // 关闭自动 schema 初始化，避免 H2 无法解析 MySQL 专属 DDL；表由测试自行以 H2 兼容语句创建
    "spring.sql.init.mode=never",
    "spring.jpa.hibernate.ddl-auto=none"
})
@AutoConfigureMockMvc
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisplayName("画布数据隔离机制测试")
class CanvasIsolationTest {

  @Autowired
  private MockMvc mockMvc;

  @Autowired
  private TokenService tokenService;

  @Autowired
  private JdbcTemplate jdbcTemplate;

  @MockBean
  private UserRepository userRepository;

  private final ObjectMapper objectMapper = new ObjectMapper();

  // 用户 A：管理员；用户 B：普通用户
  private static final Long USER_A_ID = 1L;
  private static final Long USER_B_ID = 2L;

  private String tokenA;
  private String tokenB;

  @BeforeEach
  void setUp() {
    UserAccount userA = new UserAccount(
        USER_A_ID, "admin_a", null, "AdminA", "x", "x", "ACTIVE", 0, "管理员", null, null, List.of("ADMIN"));
    UserAccount userB = new UserAccount(
        USER_B_ID, "user_b", null, "UserB", "x", "x", "ACTIVE", 0, "普通用户", null, null, List.of("USER"));

    org.mockito.Mockito.when(userRepository.findById(USER_A_ID)).thenReturn(Optional.of(userA));
    org.mockito.Mockito.when(userRepository.findById(USER_B_ID)).thenReturn(Optional.of(userB));

    tokenA = tokenService.createToken(USER_A_ID);
    tokenB = tokenService.createToken(USER_B_ID);

    initSchemaAndData();
  }

  /** 以 H2 兼容 DDL 建表，并插入 A/B 两个用户各若干条画布。每次重置，保证用例间相互独立。 */
  private void initSchemaAndData() {
    jdbcTemplate.execute("""
        CREATE TABLE IF NOT EXISTS ym_canvas_document (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          doc_id VARCHAR(64) NOT NULL,
          user_id BIGINT NOT NULL,
          title VARCHAR(256) NOT NULL DEFAULT '',
          payload_json VARCHAR(8000) NOT NULL,
          thumbnail_url VARCHAR(512) NULL,
          is_reverse_prompt TINYINT NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """);

    jdbcTemplate.update("DELETE FROM ym_canvas_document");

    // 属于 A 的两条
    insertCanvas("doc-a-1", USER_A_ID, "A canvas 1");
    insertCanvas("doc-a-2", USER_A_ID, "A canvas 2");
    // 属于 B 的两条
    insertCanvas("doc-b-1", USER_B_ID, "B canvas 1");
    insertCanvas("doc-b-2", USER_B_ID, "B canvas 2");
  }

  private void insertCanvas(String docId, Long userId, String title) {
    jdbcTemplate.update(
        "INSERT INTO ym_canvas_document (doc_id, user_id, title, payload_json, thumbnail_url, "
            + "is_reverse_prompt, created_at, updated_at) VALUES (?, ?, ?, '{}', ?, 0, "
            + "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
        docId, userId, title, "http://thumb/" + docId);
  }

  private MvcResult performGet(String url, String token) throws Exception {
    return mockMvc.perform(get(url)
            .header("Authorization", "Bearer " + token)
            .accept(MediaType.APPLICATION_JSON))
        .andReturn();
  }

  private List<Long> extractOwnerIds(MvcResult result) throws Exception {
    JsonNode root = objectMapper.readTree(result.getResponse().getContentAsString());
    JsonNode data = root.get("data");
    List<Long> owners = new ArrayList<>();
    if (data != null && data.isArray()) {
      for (JsonNode n : data) {
        owners.add(n.get("ownerId").asLong());
      }
    }
    return owners;
  }

  private List<String> extractDocIds(MvcResult result) throws Exception {
    JsonNode root = objectMapper.readTree(result.getResponse().getContentAsString());
    JsonNode data = root.get("data");
    List<String> ids = new ArrayList<>();
    if (data != null && data.isArray()) {
      for (JsonNode n : data) {
        ids.add(n.get("docId").asText());
      }
    }
    return ids;
  }

  // ============ M1：管理员全局可见（跨用户） ============
  @Test
  @Order(1)
  @DisplayName("M1: 管理员 list 同时包含 A 和 B 的画布")
  void m1_adminSeesAll() throws Exception {
    MvcResult result = performGet("/api/admin/canvas/list", tokenA);
    assertEquals(200, result.getResponse().getStatus(), "管理员应可访问管理端 list");

    List<Long> owners = extractOwnerIds(result);
    assertTrue(owners.contains(USER_A_ID), "管理端应能看到 A 的画布");
    assertTrue(owners.contains(USER_B_ID), "管理端应能看到 B 的画布（跨用户可见）");
  }

  // ============ M2：非管理员禁入管理端 ============
  @Test
  @Order(2)
  @DisplayName("M2: 普通用户访问管理端 list 被拒 403")
  void m2_nonAdminBlocked() throws Exception {
    mockMvc.perform(get("/api/admin/canvas/list")
            .header("Authorization", "Bearer " + tokenB))
        .andExpect(status().isForbidden());
  }

  // ============ M3：普通用户仅见自己 ============
  @Test
  @Order(3)
  @DisplayName("M3: 普通用户 list 只包含自己的画布")
  void m3_userSeesOnlySelf() throws Exception {
    MvcResult result = performGet("/api/canvas/list", tokenB);
    assertEquals(200, result.getResponse().getStatus(), "普通用户应可访问自己的 list");

    List<String> ids = extractDocIds(result);
    assertTrue(ids.stream().anyMatch(id -> id.startsWith("doc-b")), "应包含 B 自己的画布");
    assertFalse(ids.stream().anyMatch(id -> id.startsWith("doc-a")),
        "绝不应包含 A 的画布（数据层 userId 过滤生效）");
  }

  // ============ M4：防篡改越权（普通用户访问他人 docId 被数据层过滤） ============
  // 注意：ApiResponse 是纯 record，不设置 HTTP 状态码，业务级「not found」以
  // HTTP 200 + body(code=404, data=null) 形式返回（与前端约定一致）。故断言 body 而非 HTTP 状态。
  @Test
  @Order(4)
  @DisplayName("M4: 普通用户访问他人画布 docId 被数据层过滤（body.code=404, data=null）")
  void m4_userCannotAccessOthersDoc() throws Exception {
    MvcResult result = performGet("/api/canvas/doc-a-1", tokenB);
    assertEquals(200, result.getResponse().getStatus());
    JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
    assertEquals(404, body.get("code").asInt(),
        "普通用户访问他人画布应被数据层按 userId 过滤，返回 not-found");
    assertTrue(body.get("data").isNull(), "绝不应泄漏他人画布数据");
  }

  // ============ M5：管理员可看他人详情 ============
  @Test
  @Order(5)
  @DisplayName("M5: 管理员可按 docId 查看他人画布且 ownerId 正确")
  void m5_adminSeesOtherDetail() throws Exception {
    MvcResult result = performGet("/api/admin/canvas/doc-b-1", tokenA);
    assertEquals(200, result.getResponse().getStatus(), "管理员应可查看他人画布详情");

    JsonNode data = objectMapper.readTree(result.getResponse().getContentAsString()).get("data");
    assertEquals(USER_B_ID, data.get("ownerId").asLong(), "ownerId 应为 B（被查看画布的真实归属）");
  }

  // ============ M6：管理员可删他人 ============
  @Test
  @Order(6)
  @DisplayName("M6: 管理员删除他人画布后，原主再访问该 docId 被过滤（body.code=404, data=null）")
  void m6_adminDeletesOther() throws Exception {
    mockMvc.perform(delete("/api/admin/canvas/doc-b-1")
            .header("Authorization", "Bearer " + tokenA))
        .andExpect(status().isOk());

    // 原主 B 再访问已被删除的画布 → 数据层过滤，返回 not-found（HTTP 200 + body.code=404, data=null）
    MvcResult afterDel = performGet("/api/canvas/doc-b-1", tokenB);
    assertEquals(200, afterDel.getResponse().getStatus());
    JsonNode body = objectMapper.readTree(afterDel.getResponse().getContentAsString());
    assertEquals(404, body.get("code").asInt(), "被管理员删除后，原主再访问应返回 not-found");
    assertTrue(body.get("data").isNull(), "删除后不应再返回画布数据");
  }

  // ============ M7：非管理员删他人被拒（且他人画布仍存在） ============
  @Test
  @Order(7)
  @DisplayName("M7: 普通用户删除他人画布被拒 403，且他人画布仍存在")
  void m7_nonAdminDeleteOtherRejected() throws Exception {
    mockMvc.perform(delete("/api/admin/canvas/doc-a-1")
            .header("Authorization", "Bearer " + tokenB))
        .andExpect(status().isForbidden());

    // A 的画布未被删除，管理员仍能取到
    MvcResult result = performGet("/api/admin/canvas/doc-a-1", tokenA);
    assertEquals(200, result.getResponse().getStatus(), "A 的画布应仍存在");
  }
}
