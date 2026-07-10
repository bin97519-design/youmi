package com.youmi.api.shop;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.youmi.api.common.ApiException;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 店铺服务层测试：用内嵌 H2(MODE=MySQL) 替代 RDS，真实加载 {@link ShopService} / {@link ShopRepository}
 * （SQL 真实落 H2），聚焦「CRUD 全路径 / code 唯一冲突 / 删除前仍有账号拦截 / 公开列表只返 ACTIVE」
 * 的业务逻辑。测试用户使用高位 id，与真实数据隔离。
 */
@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:youmiShopService;MODE=MySQL;DB_CLOSE_DELAY=-1",
    "spring.datasource.driver-class-name=org.h2.Driver",
    "spring.datasource.username=sa",
    "spring.datasource.password=",
    "spring.sql.init.mode=never",
    "spring.jpa.hibernate.ddl-auto=none"
})
@DisplayName("店铺服务层测试（真实 H2 + 真实 ShopService/ShopRepository）")
class ShopServiceTest {

  @Autowired
  private ShopService shopService;
  @Autowired
  private ShopRepository shopRepository;
  @Autowired
  private JdbcTemplate jdbcTemplate;

  @BeforeEach
  void setUp() {
    initSchema();
    resetData();
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
    jdbcTemplate.update("DELETE FROM ym_shop");
    jdbcTemplate.update("DELETE FROM ym_sys_user");
  }

  /** 直接挂一个账号到指定店铺，用于验证「删除前仍有账号」拦截。 */
  private void bindUserToShop(Long userId, Long shopId) {
    jdbcTemplate.update(
        "INSERT INTO ym_sys_user (account, password_hash, password_salt, status, nickname, mi_value, shop_id) "
            + "VALUES (?, 'h', 's', 'ACTIVE', ?, 0, ?)",
        "u" + userId, "u" + userId, shopId);
  }

  private long userCountByShop(Long shopId) {
    return jdbcTemplate.queryForObject("SELECT COUNT(*) FROM ym_sys_user WHERE shop_id = ?", Long.class, shopId);
  }

  // ===================== 新建店铺 =====================

  @Test
  @DisplayName("新建店铺：name 为空/纯空格 → 400 店铺名称不能为空")
  void create_nameEmpty400() {
    ApiException ex = assertThrows(ApiException.class,
        () -> shopService.createShop(new ShopDtos.ShopCreateRequest("   ", "CODE1", null)));
    assertEquals(400, ex.getCode());
    assertTrue(ex.getMessage().contains("店铺名称不能为空"));
  }

  @Test
  @DisplayName("新建店铺：code 为空 → 400 店铺编码不能为空")
  void create_codeEmpty400() {
    ApiException ex = assertThrows(ApiException.class,
        () -> shopService.createShop(new ShopDtos.ShopCreateRequest("店铺A", null, null)));
    assertEquals(400, ex.getCode());
    assertTrue(ex.getMessage().contains("店铺编码不能为空"));
  }

  @Test
  @DisplayName("新建店铺：成功，status=ACTIVE，code 自动转大写")
  void create_success() {
    ShopDtos.ShopView v = shopService.createShop(new ShopDtos.ShopCreateRequest("店铺A", "code-a", "taobao"));
    assertNotNull(v.id());
    assertEquals("店铺A", v.name());
    assertEquals("CODE-A", v.code(), "code 应自动转大写");
    assertEquals("ACTIVE", v.status(), "新建店铺默认 ACTIVE");
    assertEquals("taobao", v.platform());
  }

  @Test
  @DisplayName("新建店铺：code 唯一冲突 → 400 店铺编码已存在")
  void create_codeConflict400() {
    shopService.createShop(new ShopDtos.ShopCreateRequest("店铺A", "CODE1", null));
    ApiException ex = assertThrows(ApiException.class,
        () -> shopService.createShop(new ShopDtos.ShopCreateRequest("店铺B", "code1", null)));
    assertEquals(400, ex.getCode());
    assertTrue(ex.getMessage().contains("店铺编码已存在"));
  }

  // ===================== 更新店铺 =====================

  @Test
  @DisplayName("更新店铺：店铺不存在 → 404 店铺不存在")
  void update_notFound404() {
    ApiException ex = assertThrows(ApiException.class,
        () -> shopService.updateShop(99999L, new ShopDtos.ShopUpdateRequest("新名", "DISABLED")));
    assertEquals(404, ex.getCode());
    assertTrue(ex.getMessage().contains("店铺不存在"));
  }

  @Test
  @DisplayName("更新店铺：改名 + 停用成功，status=DISABLED")
  void update_success() {
    ShopDtos.ShopView v = shopService.createShop(new ShopDtos.ShopCreateRequest("店铺A", "CODE1", null));
    ShopDtos.ShopView u = shopService.updateShop(v.id(), new ShopDtos.ShopUpdateRequest("店铺A改名", "DISABLED"));
    assertEquals("店铺A改名", u.name());
    assertEquals("DISABLED", u.status());
  }

  // ===================== 列表过滤 =====================

  @Test
  @DisplayName("列表：status=DISABLED 仅返回停用店铺，ACTIVE 仅返回启用店铺")
  void list_filterByStatus() {
    shopService.createShop(new ShopDtos.ShopCreateRequest("A", "A1", null));
    shopService.createShop(new ShopDtos.ShopCreateRequest("B", "B1", null));
    shopService.createShop(new ShopDtos.ShopCreateRequest("C", "C1", null));
    ShopDtos.ShopView b = shopService.listShops(null).stream()
        .filter(s -> "B1".equals(s.code())).findFirst().orElseThrow();
    shopService.updateShop(b.id(), new ShopDtos.ShopUpdateRequest(null, "DISABLED"));

    List<ShopDtos.ShopView> disabled = shopService.listShops("DISABLED");
    assertEquals(1, disabled.size(), "应只有 1 个停用店铺");
    assertEquals("DISABLED", disabled.get(0).status());

    List<ShopDtos.ShopView> active = shopService.listShops("ACTIVE");
    assertEquals(2, active.size(), "应剩 2 个启用店铺");
  }

  // ===================== 删除店铺 =====================

  @Test
  @DisplayName("删除店铺：仍有账号绑定 → 400 该店铺下仍有账号，无法删除")
  void delete_boundUsers400() {
    ShopDtos.ShopView v = shopService.createShop(new ShopDtos.ShopCreateRequest("A", "A1", null));
    bindUserToShop(90001L, v.id());
    assertEquals(1, userCountByShop(v.id()));

    ApiException ex = assertThrows(ApiException.class, () -> shopService.deleteShop(v.id()));
    assertEquals(400, ex.getCode());
    assertTrue(ex.getMessage().contains("该店铺下仍有账号，无法删除"));
    // 删除被拦截，记录仍在
    assertTrue(shopRepository.findById(v.id()).isPresent());
  }

  @Test
  @DisplayName("删除店铺：无账号绑定 → 成功，记录消失")
  void delete_success() {
    ShopDtos.ShopView v = shopService.createShop(new ShopDtos.ShopCreateRequest("A", "A1", null));
    shopService.deleteShop(v.id());
    assertTrue(shopRepository.findById(v.id()).isEmpty());
  }

  @Test
  @DisplayName("删除店铺：店铺不存在 → 404 店铺不存在")
  void delete_notFound404() {
    ApiException ex = assertThrows(ApiException.class, () -> shopService.deleteShop(99999L));
    assertEquals(404, ex.getCode());
    assertTrue(ex.getMessage().contains("店铺不存在"));
  }

  // ===================== 公开列表 =====================

  @Test
  @DisplayName("公开列表：仅返回 ACTIVE 店铺的 id/name/code")
  void publicList_onlyActive() {
    ShopDtos.ShopView active = shopService.createShop(new ShopDtos.ShopCreateRequest("A店", "A1", null));
    ShopDtos.ShopView disabled = shopService.createShop(new ShopDtos.ShopCreateRequest("B店", "B1", null));
    shopService.updateShop(disabled.id(), new ShopDtos.ShopUpdateRequest(null, "DISABLED"));

    List<ShopDtos.ShopPublicView> pub = shopService.listActiveShops();
    assertEquals(1, pub.size(), "公开列表应只有 1 个 ACTIVE 店铺");
    assertEquals(active.id(), pub.get(0).id());
    assertEquals("A店", pub.get(0).name());
    assertEquals("A1", pub.get(0).code());
  }
}
