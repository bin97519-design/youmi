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
      """
      SELECT s.id, s.`name`, s.code, s.platform_id,
             p.code AS platform_code,
             COALESCE(p.name, s.platform) AS platform_name,
             s.status, s.created_at, s.updated_at
      FROM ym_shop s
      LEFT JOIN ym_platform p ON p.id = s.platform_id
      """;

  private final JdbcTemplate jdbcTemplate;

  public ShopRepository(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public Optional<Shop> findById(Long id) {
    List<Shop> rows = jdbcTemplate.query(BASE_SELECT + " WHERE s.id = ?", this::mapRow, id);
    return rows.stream().findFirst();
  }

  public Optional<Shop> findByCode(String code) {
    List<Shop> rows = jdbcTemplate.query(BASE_SELECT + " WHERE s.code = ?", this::mapRow, code);
    return rows.stream().findFirst();
  }

  /** 按名称精确查找店铺 ID，用于管理员创建账号时自动匹配或创建。 */
  public Optional<Long> findIdByName(String name) {
    List<Long> ids = jdbcTemplate.queryForList(
        "SELECT id FROM ym_shop WHERE `name` = ? LIMIT 1", Long.class, name);
    return ids.isEmpty() ? Optional.empty() : Optional.of(ids.get(0));
  }

  public Optional<Long> findIdByNameAndPlatformId(String name, Long platformId) {
    List<Long> ids = jdbcTemplate.queryForList(
        "SELECT id FROM ym_shop WHERE `name` = ? AND platform_id = ? LIMIT 1",
        Long.class,
        name,
        platformId);
    return ids.isEmpty() ? Optional.empty() : Optional.of(ids.get(0));
  }

  public List<Shop> findAll() {
    return jdbcTemplate.query(BASE_SELECT + " ORDER BY s.id DESC", this::mapRow);
  }

  public List<Shop> findByStatus(String status) {
    return jdbcTemplate.query(
        BASE_SELECT + " WHERE s.status = ? ORDER BY s.id DESC",
        this::mapRow,
        status);
  }

  public List<Shop> findActive() {
    return jdbcTemplate.query(
        BASE_SELECT + " WHERE s.status = 'ACTIVE' ORDER BY s.id DESC",
        this::mapRow);
  }

  public Long insert(
      String name,
      String code,
      Long platformId,
      String platformName,
      String status) {
    KeyHolder keyHolder = new GeneratedKeyHolder();
    jdbcTemplate.update(connection -> {
      PreparedStatement ps = connection.prepareStatement(
          "INSERT INTO ym_shop (name, code, platform_id, platform, status) VALUES (?, ?, ?, ?, ?)",
          Statement.RETURN_GENERATED_KEYS);
      ps.setString(1, name);
      ps.setString(2, code);
      ps.setObject(3, platformId);
      ps.setString(4, platformName);
      ps.setString(5, status);
      return ps;
    }, keyHolder);
    return keyHolder.getKey().longValue();
  }

  public int update(
      Long id,
      String name,
      Long platformId,
      String platformName,
      String status) {
    return jdbcTemplate.update(
        "UPDATE ym_shop SET name = ?, platform_id = ?, platform = ?, status = ? WHERE id = ?",
        name,
        platformId,
        platformName,
        status,
        id);
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
        nullableLong(rs, "platform_id"),
        rs.getString("platform_code"),
        rs.getString("platform_name"),
        rs.getString("status"),
        time(rs, "created_at"),
        time(rs, "updated_at"));
  }

  private Long nullableLong(ResultSet rs, String field) throws SQLException {
    long value = rs.getLong(field);
    return rs.wasNull() ? null : value;
  }

  private String time(ResultSet rs, String field) throws SQLException {
    Timestamp timestamp = rs.getTimestamp(field);
    if (timestamp == null) return null;
    return timestamp.toLocalDateTime().toString();
  }
}
