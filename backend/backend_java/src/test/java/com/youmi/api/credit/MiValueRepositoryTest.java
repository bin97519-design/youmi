package com.youmi.api.credit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 米值仓储 SQL 级测试：用内嵌 H2(MODE=MySQL) 替代 RDS，验证原子扣减守卫、退回、调账下限、
 * 回滚幂等守卫以及流水读写往返均与实现中的 SQL 一致。属集成测试（真实 JdbcTemplate + 真实 MiValueRepository）。
 */
@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:youmiMiRepo;MODE=MySQL;DB_CLOSE_DELAY=-1",
    "spring.datasource.driver-class-name=org.h2.Driver",
    "spring.datasource.username=sa",
    "spring.datasource.password=",
    "spring.sql.init.mode=never",
    "spring.jpa.hibernate.ddl-auto=none"
})
@DisplayName("米值仓储 SQL 级测试（扣减守卫/GREATEST/回滚守卫）")
class MiValueRepositoryTest {

  @Autowired
  private MiValueRepository repository;
  @Autowired
  private JdbcTemplate jdbcTemplate;

  private static final Long USER = 99001L;

  @BeforeEach
  void setUp() {
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
    jdbcTemplate.update("DELETE FROM ym_mi_value_log");
    jdbcTemplate.update("DELETE FROM ym_sys_user");
    jdbcTemplate.update(
        "INSERT INTO ym_sys_user (id, account, phone, nickname, password_hash, password_salt, status, mi_value, plan_name) "
            + "VALUES (?, 'u', NULL, 'u', 'x', 'x', 'ACTIVE', 0, '普通用户')",
        USER);
  }

  private int balance() {
    return jdbcTemplate.queryForObject("SELECT mi_value FROM ym_sys_user WHERE id = ?", Integer.class, USER);
  }

  private void setBalance(int v) {
    jdbcTemplate.update("UPDATE ym_sys_user SET mi_value = ? WHERE id = ?", v, USER);
  }

  @Test
  @DisplayName("getBalance：用户不存在返回 0")
  void getBalance_returnsZeroForMissing() {
    assertEquals(0, repository.getBalance(99999L));
  }

  @Test
  @DisplayName("deductAtomic 守卫：mi_value>=price 时才扣减，否则 affected=0（并发防护）")
  void deductAtomic_guard() {
    setBalance(10);
    assertEquals(0, repository.deductAtomic(USER, 50), "余额10<50，应被 WHERE mi_value>=price 守卫挡掉");
    assertEquals(10, balance(), "不应扣减");
    assertEquals(1, repository.deductAtomic(USER, 10), "余额10>=10，应扣减成功");
    assertEquals(0, balance(), "扣减后应为0");
  }

  @Test
  @DisplayName("refund：退回米值到余额")
  void refund() {
    setBalance(0);
    repository.refund(USER, 10);
    assertEquals(10, balance());
  }

  @Test
  @DisplayName("adminAdjust：GREATEST(0, mi_value+delta) 保证非负余额（负到0不越界）")
  void adminAdjust_greatest() {
    setBalance(30);
    repository.adminAdjust(USER, -100);
    assertEquals(0, balance(), "30-100 应被 GREATEST 钳到 0");
    repository.adminAdjust(USER, 50);
    assertEquals(50, balance());
  }

  @Test
  @DisplayName("markRollback 幂等守卫：PENDING→ROLLBACK 命中一次，重复调用返回0不再退款")
  void markRollback_guard() {
    long logId = repository.insertLog(USER, MiBizType.IMAGE, null, 10, 100, 90, "PENDING", null);
    assertEquals(1, repository.markRollback(logId), "首次应命中");
    assertEquals(0, repository.markRollback(logId), "已 ROLLBACK，应返回0（幂等）");
  }

  @Test
  @DisplayName("insertLog/setLogStatus/findLogById/findLogByTaskId 往返一致")
  void logRoundTrip() {
    long logId = repository.insertLog(USER, MiBizType.VIDEO, null, 50, 200, 150, "PENDING",
        "agnes-video:task1");
    assertTrue(logId > 0, "LAST_INSERT_ID 应返回自增主键");
    repository.setLogStatus(logId, "SUCCESS");

    Optional<MiValueRepository.LogRow> byId = repository.findLogById(logId);
    assertTrue(byId.isPresent());
    assertEquals(50, byId.get().price());
    assertEquals("SUCCESS", byId.get().status());

    Optional<MiValueRepository.LogRow> byTask = repository.findLogByTaskId("agnes-video:task1");
    assertTrue(byTask.isPresent());
    assertEquals(logId, byTask.get().logId());
  }
}
