package com.youmi.api.admin;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.youmi.api.common.ApiException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import javax.sql.DataSource;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

@DisplayName("财务米值统计")
class FinanceServiceTest {
  private JdbcTemplate jdbcTemplate;
  private FinanceService financeService;

  @BeforeEach
  void setUp() {
    jdbcTemplate = new JdbcTemplate(dataSource());
    financeService = new FinanceService(jdbcTemplate);
    createSchema();
    seedData();
  }

  @Test
  @DisplayName("只统计成功消费，并按账号当前归属汇总平台和店铺")
  void reportUsesSuccessfulLedgerAndCurrentUserShop() {
    FinanceDtos.FinanceReport report =
        financeService.report("2026-07-01", "2026-07-31", null, null);

    assertEquals(3L, report.summary().transactionCount());
    assertEquals(new BigDecimal("23.25"), report.summary().totalMi());
    assertEquals("0.23", report.summary().totalYuan().toPlainString());
    assertEquals(2, report.daily().size());
    assertEquals(1, report.platforms().size());
    assertEquals("京东", report.shops().get(0).platformName());
    assertEquals("京东旗舰店", report.shops().get(0).shopName());
    assertEquals(new BigDecimal("23.25"), report.shops().get(0).totalMi());
    assertEquals(2, report.users().size());
    assertEquals("operator", report.users().get(0).account());
    assertEquals("运营", report.users().get(0).nickname());
    assertEquals(2L, report.users().get(0).transactionCount());
    assertEquals(new BigDecimal("15.25"), report.users().get(0).totalMi());
  }

  @Test
  @DisplayName("平台和店铺筛选可组合")
  void reportFiltersByPlatformAndShop() {
    FinanceDtos.FinanceReport report =
        financeService.report("2026-07-01", "2026-07-31", 2L, 20L);

    assertEquals(3L, report.summary().transactionCount());
    assertEquals(new BigDecimal("23.25"), report.summary().totalMi());
    assertEquals(1, report.platforms().size());
    assertEquals(1, report.shops().size());
    assertEquals(2, report.users().size());
  }

  @Test
  @DisplayName("账号换店后历史成功消费立即归入新店")
  void reportReflectsShopReassignment() {
    jdbcTemplate.update("UPDATE ym_sys_user SET shop_id = 10 WHERE id = 100");

    FinanceDtos.FinanceReport report =
        financeService.report("2026-07-01", "2026-07-31", 1L, 10L);

    assertEquals(2L, report.summary().transactionCount());
    assertEquals(new BigDecimal("15.25"), report.summary().totalMi());
    assertEquals(1, report.shops().size());
    assertEquals("爱洁猫", report.shops().get(0).shopName());
    assertEquals("淘宝", report.shops().get(0).platformName());
    assertEquals("operator", report.users().get(0).account());
  }

  @Test
  @DisplayName("日期范围校验阻止反向区间")
  void reportRejectsInvalidRange() {
    ApiException exception = assertThrows(ApiException.class,
        () -> financeService.report("2026-07-31", "2026-07-01", null, null));
    assertEquals(400, exception.getCode());
  }

  @Test
  @DisplayName("CSV 带 UTF-8 BOM、中文标题与各维度明细")
  void exportCsvIsExcelFriendly() {
    byte[] bytes = financeService.exportCsv(
        financeService.report("2026-07-01", "2026-07-31", null, null));
    assertTrue(bytes.length > 3);
    assertEquals((byte) 0xEF, bytes[0]);
    assertEquals((byte) 0xBB, bytes[1]);
    assertEquals((byte) 0xBF, bytes[2]);
    String csv = new String(bytes, StandardCharsets.UTF_8);
    assertTrue(csv.contains("有米AI财务消耗报表"));
    assertTrue(csv.contains("平台汇总"));
    assertTrue(csv.contains("店铺汇总"));
    assertTrue(csv.contains("个人汇总"));
    assertTrue(csv.contains("operator,运营,100"));
    assertFalse(csv.contains("回滚任务"));
  }

  private DataSource dataSource() {
    JdbcDataSource dataSource = new JdbcDataSource();
    dataSource.setURL("jdbc:h2:mem:finance;MODE=MySQL;DB_CLOSE_DELAY=-1");
    dataSource.setUser("sa");
    dataSource.setPassword("");
    return dataSource;
  }

  private void createSchema() {
    jdbcTemplate.execute("DROP ALL OBJECTS");
    jdbcTemplate.execute("""
        CREATE TABLE ym_platform (
          id BIGINT PRIMARY KEY, name VARCHAR(64), code VARCHAR(32))
        """);
    jdbcTemplate.execute("""
        CREATE TABLE ym_shop (
          id BIGINT PRIMARY KEY, name VARCHAR(128), code VARCHAR(64), platform_id BIGINT)
        """);
    jdbcTemplate.execute("""
        CREATE TABLE ym_sys_user (
          id BIGINT PRIMARY KEY, account VARCHAR(64), nickname VARCHAR(64), shop_id BIGINT)
        """);
    jdbcTemplate.execute("""
        CREATE TABLE ym_mi_value_log (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          user_id BIGINT,
          shop_id BIGINT,
          platform_id BIGINT,
          biz_type VARCHAR(20),
          price DECIMAL(12,2),
          status VARCHAR(20),
          remark VARCHAR(255),
          created_at DATETIME)
        """);
  }

  private void seedData() {
    jdbcTemplate.update(
        "INSERT INTO ym_platform (id, name, code) VALUES (1, '淘宝', 'TAOBAO'), (2, '京东', 'JD')");
    jdbcTemplate.update("""
        INSERT INTO ym_shop (id, name, code, platform_id)
        VALUES (10, '爱洁猫', 'AJM', 1), (20, '京东旗舰店', 'JD-FLAG', 2)
        """);
    jdbcTemplate.update("""
        INSERT INTO ym_sys_user (id, account, nickname, shop_id)
        VALUES (100, 'operator', '运营', 20), (200, 'jd-user', '京东运营', 20)
        """);

    // 用户 100 当前已换到京东店；财务汇总应随账号当前归属变化，流水快照只作兜底。
    insertLog(100, 10L, 1L, "IMAGE", new BigDecimal("8.25"), "SUCCESS", "2026-07-10 10:00:00", "生图");
    insertLog(100, 10L, 1L, "VIDEO", 7, "SUCCESS", "2026-07-10 11:00:00", "视频");
    insertLog(200, 20L, 2L, "IMAGE", 8, "SUCCESS", "2026-07-11 10:00:00", "生图");
    insertLog(100, 10L, 1L, "IMAGE", 99, "ROLLBACK", "2026-07-12 10:00:00", "回滚任务");
    insertLog(100, 10L, 1L, "ADMIN_ADJUST", 500, "SUCCESS", "2026-07-12 10:00:00", "充值");
    insertLog(100, 10L, 1L, "IMAGE", 9, "SUCCESS", "2026-08-01 10:00:00", "区间外");
  }

  private void insertLog(
      long userId,
      Long shopId,
      Long platformId,
      String bizType,
      int price,
      String status,
      String createdAt,
      String remark) {
    jdbcTemplate.update("""
        INSERT INTO ym_mi_value_log
          (user_id, shop_id, platform_id, biz_type, price, status, created_at, remark)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, userId, shopId, platformId, bizType, BigDecimal.valueOf(price), status, createdAt, remark);
  }

  private void insertLog(long userId, Long shopId, Long platformId, String bizType,
      BigDecimal price, String status, String createdAt, String remark) {
    jdbcTemplate.update("""
        INSERT INTO ym_mi_value_log
          (user_id, shop_id, platform_id, biz_type, price, status, created_at, remark)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, userId, shopId, platformId, bizType, price, status, createdAt, remark);
  }
}
