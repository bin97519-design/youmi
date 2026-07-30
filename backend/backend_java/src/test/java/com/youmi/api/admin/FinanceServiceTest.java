package com.youmi.api.admin;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.youmi.api.common.ApiException;
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
  @DisplayName("只统计成功消费，并按流水快照归属平台和店铺")
  void reportUsesSuccessfulLedgerAndSnapshotDimensions() {
    FinanceDtos.FinanceReport report =
        financeService.report("2026-07-01", "2026-07-31", null, null);

    assertEquals(3L, report.summary().transactionCount());
    assertEquals(23L, report.summary().totalMi());
    assertEquals("0.23", report.summary().totalYuan().toPlainString());
    assertEquals(2, report.daily().size());
    assertEquals(2, report.platforms().size());
    assertEquals("淘宝", report.shops().get(0).platformName());
    assertEquals("爱洁猫", report.shops().get(0).shopName());
    assertEquals(15L, report.shops().get(0).totalMi());
  }

  @Test
  @DisplayName("平台和店铺筛选可组合")
  void reportFiltersByPlatformAndShop() {
    FinanceDtos.FinanceReport report =
        financeService.report("2026-07-01", "2026-07-31", 1L, 10L);

    assertEquals(2L, report.summary().transactionCount());
    assertEquals(15L, report.summary().totalMi());
    assertEquals(1, report.platforms().size());
    assertEquals(1, report.shops().size());
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
          price INT,
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

    // 用户 100 当前已换到京东店，但历史流水快照仍属于淘宝爱洁猫。
    insertLog(100, 10L, 1L, "IMAGE", 8, "SUCCESS", "2026-07-10 10:00:00", "生图");
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
        """, userId, shopId, platformId, bizType, price, status, createdAt, remark);
  }
}
