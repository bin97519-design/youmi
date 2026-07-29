package com.youmi.api.platform;

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

@Repository
public class PlatformRepository {
  private static final String BASE_SELECT =
      "SELECT id, name, code, status, sort_order, created_at, updated_at FROM ym_platform";

  private final JdbcTemplate jdbcTemplate;

  public PlatformRepository(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public Optional<Platform> findById(Long id) {
    return jdbcTemplate.query(BASE_SELECT + " WHERE id = ?", this::mapRow, id)
        .stream()
        .findFirst();
  }

  public Optional<Platform> findByCode(String code) {
    return jdbcTemplate.query(BASE_SELECT + " WHERE code = ?", this::mapRow, code)
        .stream()
        .findFirst();
  }

  public Optional<Platform> findByNameOrCode(String value) {
    return jdbcTemplate.query(
            BASE_SELECT + " WHERE name = ? OR UPPER(code) = UPPER(?) LIMIT 1",
            this::mapRow,
            value,
            value)
        .stream()
        .findFirst();
  }

  public List<Platform> findAll() {
    return jdbcTemplate.query(
        BASE_SELECT + " ORDER BY sort_order ASC, id ASC",
        this::mapRow);
  }

  public List<Platform> findActive() {
    return jdbcTemplate.query(
        BASE_SELECT + " WHERE status = 'ACTIVE' ORDER BY sort_order ASC, id ASC",
        this::mapRow);
  }

  public Long insert(String name, String code, String status, int sortOrder) {
    KeyHolder keyHolder = new GeneratedKeyHolder();
    jdbcTemplate.update(connection -> {
      PreparedStatement ps = connection.prepareStatement(
          "INSERT INTO ym_platform (name, code, status, sort_order) VALUES (?, ?, ?, ?)",
          Statement.RETURN_GENERATED_KEYS);
      ps.setString(1, name);
      ps.setString(2, code);
      ps.setString(3, status);
      ps.setInt(4, sortOrder);
      return ps;
    }, keyHolder);
    return keyHolder.getKey().longValue();
  }

  public int update(Long id, String name, String status, int sortOrder) {
    return jdbcTemplate.update(
        "UPDATE ym_platform SET name = ?, status = ?, sort_order = ? WHERE id = ?",
        name,
        status,
        sortOrder,
        id);
  }

  public int syncLegacyShopPlatformName(Long platformId, String platformName) {
    return jdbcTemplate.update(
        "UPDATE ym_shop SET platform = ? WHERE platform_id = ?",
        platformName,
        platformId);
  }

  public int deleteById(Long id) {
    return jdbcTemplate.update("DELETE FROM ym_platform WHERE id = ?", id);
  }

  public long countShops(Long platformId) {
    Long count = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM ym_shop WHERE platform_id = ?",
        Long.class,
        platformId);
    return count == null ? 0L : count;
  }

  private Platform mapRow(ResultSet rs, int rowNum) throws SQLException {
    return new Platform(
        rs.getLong("id"),
        rs.getString("name"),
        rs.getString("code"),
        rs.getString("status"),
        rs.getInt("sort_order"),
        time(rs, "created_at"),
        time(rs, "updated_at"));
  }

  private String time(ResultSet rs, String field) throws SQLException {
    Timestamp timestamp = rs.getTimestamp(field);
    return timestamp == null ? null : timestamp.toLocalDateTime().toString();
  }
}
