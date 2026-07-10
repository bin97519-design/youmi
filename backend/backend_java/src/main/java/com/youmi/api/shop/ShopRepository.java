package com.youmi.api.shop;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

/**
 * 店铺数据访问层，基于 JdbcTemplate 直写 SQL（无 ORM）。
 *
 * <p>所有 SQL 均参数化，避免拼接注入。
 */
@Repository
public class ShopRepository {
  private static final String BASE_SELECT =
      "SELECT id, `name`, code, platform, status, created_at, updated_at FROM ym_shop";

  private final JdbcTemplate jdbcTemplate;

  public ShopRepository(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public Optional<Shop> findById(Long id) {
    List<Shop> rows = jdbcTemplate.query(BASE_SELECT + " WHERE id = ?", this::mapRow, id);
    return rows.stream().findFirst();
  }

  public Optional<Shop> findByCode(String code) {
    List<Shop> rows = jdbcTemplate.query(BASE_SELECT + " WHERE code = ?", this::mapRow, code);
    return rows.stream().findFirst();
  }

  /** 按名称精确查找店铺 ID，用于管理员创建账号时自动匹配或创建。 */
  public Optional<Long> findIdByName(String name) {
    List<Long> ids = jdbcTemplate.queryForList(
        "SELECT id FROM ym_shop WHERE `name` = ? LIMIT 1", Long.class, name);
    return ids.isEmpty() ? Optional.empty() : Optional.of(ids.get(0));
  }

  public List<Shop> findAll() {
    return jdbcTemplate.query(BASE_SELECT + " ORDER BY id DESC", this::mapRow);
  }

  public List<Shop> findByStatus(String status) {
    return jdbcTemplate.query(BASE_SELECT + " WHERE status = ? ORDER BY id DESC", this::mapRow, status);
  }

  public List<Shop> findActive() {
    return jdbcTemplate.query(BASE_SELECT + " WHERE status = 'ACTIVE' ORDER BY id DESC", this::mapRow);
  }

  public Long insert(String name, String code, String platform, String status) {
    KeyHolder keyHolder = new GeneratedKeyHolder();
    jdbcTemplate.update(connection -> {
      PreparedStatement ps = connection.prepareStatement(
          "INSERT INTO ym_shop (name, code, platform, status) VALUES (?, ?, ?, ?)",
          Statement.RETURN_GENERATED_KEYS);
      ps.setString(1, name);
      ps.setString(2, code);
      ps.setString(3, platform);
      ps.setString(4, status);
      return ps;
    }, keyHolder);
    return keyHolder.getKey().longValue();
  }

  public int update(Long id, String name, String status) {
    return jdbcTemplate.update(
        "UPDATE ym_shop SET name = ?, status = ? WHERE id = ?",
        name, status, id);
  }

  public int deleteById(Long id) {
    return jdbcTemplate.update("DELETE FROM ym_shop WHERE id = ?", id);
  }

  public boolean existsById(Long id) {
    Integer count = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM ym_shop WHERE id = ?", Integer.class, id);
    return count != null && count > 0;
  }

  /** 存在性 + 状态校验：用于账号绑定店铺时，确保店铺存在且为 ACTIVE。 */
  public boolean existsActiveById(Long id) {
    Integer count = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM ym_shop WHERE id = ? AND status = 'ACTIVE'", Integer.class, id);
    return count != null && count > 0;
  }

  /** 统计仍绑定该店铺的账号数量，供删除前校验。 */
  public long countUsersByShopId(Long shopId) {
    Long count = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM ym_sys_user WHERE shop_id = ?", Long.class, shopId);
    return count == null ? 0L : count;
  }

  private Shop mapRow(ResultSet rs, int rowNum) throws SQLException {
    return new Shop(
        rs.getLong("id"),
        rs.getString("name"),
        rs.getString("code"),
        rs.getString("platform"),
        rs.getString("status"),
        time(rs, "created_at"),
        time(rs, "updated_at"));
  }

  private String time(ResultSet rs, String field) throws SQLException {
    Timestamp timestamp = rs.getTimestamp(field);
    if (timestamp == null) return null;
    return timestamp.toLocalDateTime().toString();
  }
}
