package com.youmi.api.credit;

import com.youmi.api.auth.UserAccount;
import com.youmi.api.auth.UserRepository;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 米值消费流水的数据访问层。有效消费以 {@code ym_mi_value_log} 中 SUCCESS 状态为准。
 */
@Repository
public class MiValueRepository {
  private final JdbcTemplate jdbcTemplate;
  private final UserRepository userRepository;

  public MiValueRepository(JdbcTemplate jdbcTemplate, UserRepository userRepository) {
    this.jdbcTemplate = jdbcTemplate;
    this.userRepository = userRepository;
  }

  /** 旧余额字段兼容查询，不参与当前消费统计。 */
  public int getBalance(Long userId) {
    return userRepository.findById(userId).map(UserAccount::miValue).orElse(0);
  }

  /** 旧余额账户兼容方法，当前业务流程不再调用。 */
  public int deductAtomic(Long userId, int price) {
    return jdbcTemplate.update(
        "UPDATE ym_sys_user SET mi_value = mi_value - ? WHERE id = ? AND mi_value >= ?",
        price, userId, price);
  }

  /** 插入一条消费流水（默认 PENDING），返回自增主键 */
  public long insertLog(
      Long userId, MiBizType bizType, String taskType, int price,
      int beforeBalance, int afterBalance, String status, String taskId) {
    return insertLog(userId, bizType, taskType, price, beforeBalance, afterBalance, status, taskId, null);
  }

  /** 插入一条消费流水（带备注，如管理后台调账原因），返回自增主键 */
  public long insertLog(
      Long userId, MiBizType bizType, String taskType, int price,
      int beforeBalance, int afterBalance, String status, String taskId, String remark) {
    ShopSnapshot snapshot = findShopSnapshot(userId);
    jdbcTemplate.update(
        "INSERT INTO ym_mi_value_log"
            + " (user_id, shop_id, platform_id, biz_type, task_type, price,"
            + " before_balance, after_balance, status, task_id, remark)"
            + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        userId, snapshot.shopId(), snapshot.platformId(), bizType.name(), taskType, price,
        beforeBalance, afterBalance, status, taskId, remark);
    return jdbcTemplate.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
  }

  private ShopSnapshot findShopSnapshot(Long userId) {
    String sql = """
        SELECT u.shop_id, s.platform_id
        FROM ym_sys_user u
        LEFT JOIN ym_shop s ON s.id = u.shop_id
        WHERE u.id = ?
        """;
    return jdbcTemplate.query(sql, (rs, rowNum) -> new ShopSnapshot(
        nullableLong(rs.getObject("shop_id")),
        nullableLong(rs.getObject("platform_id"))), userId)
        .stream()
        .findFirst()
        .orElse(new ShopSnapshot(null, null));
  }

  private Long nullableLong(Object value) {
    return value instanceof Number number ? number.longValue() : null;
  }

  /** 将流水状态置为目标状态（commit/失败标记），并刷新 updated_at */
  public void setLogStatus(long logId, String status) {
    jdbcTemplate.update(
        "UPDATE ym_mi_value_log SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        status, logId);
  }

  public int settle(long logId, int settledPrice, int refundAmount) {
    return jdbcTemplate.update(
        "UPDATE ym_mi_value_log"
            + " SET price = ?, before_balance = 0, after_balance = 0, status = 'SUCCESS',"
            + " updated_at = CURRENT_TIMESTAMP"
            + " WHERE id = ? AND status = 'PENDING'",
        settledPrice, logId);
  }

  /** Total successful consumption for a user. Failed and rolled-back tasks are excluded. */
  public int getConsumedMi(Long userId) {
    Integer total = jdbcTemplate.queryForObject(
        "SELECT COALESCE(SUM(price), 0) FROM ym_mi_value_log"
            + " WHERE user_id = ? AND status = 'SUCCESS' AND biz_type IN ('IMAGE', 'VIDEO')",
        Integer.class, userId);
    return total == null ? 0 : total;
  }

  /** 回滚守卫：仅当流水处于 PENDING 或 SUCCESS 时才置为 ROLLBACK。 */
  public int markRollback(long logId) {
    return jdbcTemplate.update(
        "UPDATE ym_mi_value_log SET status = 'ROLLBACK', updated_at = CURRENT_TIMESTAMP"
            + " WHERE id = ? AND status IN ('PENDING', 'SUCCESS')",
        logId);
  }

  /** 关联外部任务 id 到流水（用于异步终态回滚/确认） */
  public void setTaskId(long logId, String taskId) {
    jdbcTemplate.update(
        "UPDATE ym_mi_value_log SET task_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        taskId, logId);
  }

  /** 按 task_id 查找仍处于 PENDING/SUCCESS 的流水（供异步终态处理） */
  public Optional<LogRow> findLogByTaskId(String taskId) {
    String sql = "SELECT id, user_id, price, status, biz_type FROM ym_mi_value_log"
        + " WHERE task_id = ? AND status IN ('PENDING', 'SUCCESS') LIMIT 1";
    return jdbcTemplate.query(sql, (rs, rn) -> new LogRow(
        rs.getLong("id"),
        rs.getLong("user_id"),
        rs.getInt("price"),
        rs.getString("status"),
        rs.getString("biz_type")), taskId).stream().findFirst();
  }

  public boolean isTaskOwnedByUser(String taskId, Long userId, MiBizType bizType) {
    if (taskId == null || taskId.isBlank() || userId == null || bizType == null) return false;
    Integer count = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM ym_mi_value_log WHERE task_id = ? AND user_id = ? AND biz_type = ?",
        Integer.class, taskId, userId, bizType.name());
    return count != null && count > 0;
  }

  /** 按自增 id 查找流水（供回滚时取 price / user_id） */
  public Optional<LogRow> findLogById(long logId) {
    String sql = "SELECT id, user_id, price, status, biz_type FROM ym_mi_value_log WHERE id = ?";
    return jdbcTemplate.query(sql, (rs, rn) -> new LogRow(
        rs.getLong("id"),
        rs.getLong("user_id"),
        rs.getInt("price"),
        rs.getString("status"),
        rs.getString("biz_type")), logId).stream().findFirst();
  }

  /** 旧余额账户兼容方法，当前业务流程不再调用。 */
  public void refund(Long userId, int price) {
    jdbcTemplate.update(
        "UPDATE ym_sys_user SET mi_value = mi_value + ? WHERE id = ?",
        price, userId);
  }

  /** 旧余额账户兼容方法，当前业务流程不再调用。 */
  public void adminAdjust(Long userId, int delta) {
    jdbcTemplate.update(
        "UPDATE ym_sys_user SET mi_value = GREATEST(0, mi_value + ?) WHERE id = ?",
        delta, userId);
  }

  /** 消费流水行快照（供 commit/rollback 时取 price 与 user_id） */
  public record LogRow(long logId, Long userId, int price, String status, String bizType) {}

  private record ShopSnapshot(Long shopId, Long platformId) {}
}
