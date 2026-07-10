package com.youmi.api.auth;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class UserRepository {
  private final JdbcTemplate jdbcTemplate;

  public UserRepository(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public Optional<UserAccount> findByLoginName(String loginName) {
    String sql = """
        SELECT u.id, u.account, u.phone, u.nickname, u.password_hash, u.password_salt, u.status,
               u.mi_value, u.plan_name, u.shop_id, s.`name` AS shop_name
        FROM ym_sys_user u
        LEFT JOIN ym_shop s ON s.id = u.shop_id
        WHERE u.account = ? OR u.phone = ? OR CAST(u.id AS CHAR) = ?
        LIMIT 1
        """;
    List<UserAccount> users = jdbcTemplate.query(sql, (rs, rowNum) -> mapUser(rs), loginName, loginName, loginName);
    return users.stream().findFirst();
  }

  public Optional<UserAccount> findById(Long id) {
    String sql = """
        SELECT u.id, u.account, u.phone, u.nickname, u.password_hash, u.password_salt, u.status,
               u.mi_value, u.plan_name, u.shop_id, s.`name` AS shop_name
        FROM ym_sys_user u
        LEFT JOIN ym_shop s ON s.id = u.shop_id
        WHERE u.id = ?
        LIMIT 1
        """;
    List<UserAccount> users = jdbcTemplate.query(sql, (rs, rowNum) -> mapUser(rs), id);
    return users.stream().findFirst();
  }

  public void saveLoginLog(Long userId, String account, String ip, String userAgent) {
    jdbcTemplate.update(
        "INSERT INTO ym_login_log (user_id, account, ip, user_agent) VALUES (?, ?, ?, ?)",
        userId,
        account,
        ip,
        userAgent
    );
  }

  public Long insertUser(String account, String passwordHash, String salt, Long shopId) {
    jdbcTemplate.update(
        "INSERT INTO ym_sys_user (account, password_hash, password_salt, status, nickname, mi_value, shop_id) VALUES (?, ?, ?, 'ACTIVE', ?, 0, ?)",
        account, passwordHash, salt, account, shopId
    );
    Long id = jdbcTemplate.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
    // 分配默认角色
    jdbcTemplate.update(
        "INSERT INTO ym_sys_user_role (user_id, role_id) SELECT ?, id FROM ym_sys_role WHERE code = 'USER'",
        id
    );
    return id;
  }

  private UserAccount mapUser(ResultSet rs) throws SQLException {
    Long id = rs.getLong("id");
    Long shopId = rs.getLong("shop_id");
    if (rs.wasNull()) {
      shopId = null;
    }
    return new UserAccount(
        id,
        rs.getString("account"),
        rs.getString("phone"),
        rs.getString("nickname"),
        rs.getString("password_hash"),
        rs.getString("password_salt"),
        rs.getString("status"),
        rs.getInt("mi_value"),
        rs.getString("plan_name"),
        shopId,
        rs.getString("shop_name"),
        findRoles(id)
    );
  }

  private List<String> findRoles(Long userId) {
    String sql = """
        SELECT r.code
        FROM ym_sys_role r
        INNER JOIN ym_sys_user_role ur ON ur.role_id = r.id
        WHERE ur.user_id = ?
        ORDER BY r.id
        """;
    return jdbcTemplate.queryForList(sql, String.class, userId);
  }
}
