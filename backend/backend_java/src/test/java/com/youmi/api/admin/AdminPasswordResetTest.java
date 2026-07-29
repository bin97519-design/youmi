package com.youmi.api.admin;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;

import com.youmi.api.auth.PasswordHasher;
import com.youmi.api.common.ApiException;
import com.youmi.api.image.ImageGenerationProperties;
import com.youmi.api.platform.PlatformRepository;
import com.youmi.api.shop.ShopRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class AdminPasswordResetTest {
  private JdbcTemplate jdbcTemplate;
  private PasswordHasher passwordHasher;
  private AdminService adminService;

  @BeforeEach
  void setUp() {
    DriverManagerDataSource dataSource = new DriverManagerDataSource(
        "jdbc:h2:mem:adminPasswordReset;MODE=MySQL;DB_CLOSE_DELAY=-1", "sa", "");
    jdbcTemplate = new JdbcTemplate(dataSource);
    jdbcTemplate.execute("DROP TABLE IF EXISTS ym_sys_user");
    jdbcTemplate.execute("""
        CREATE TABLE ym_sys_user (
          id BIGINT PRIMARY KEY,
          password_hash VARCHAR(128) NOT NULL,
          password_salt VARCHAR(128) NOT NULL)
        """);
    jdbcTemplate.update(
        "INSERT INTO ym_sys_user (id, password_hash, password_salt) VALUES (1, 'old-hash', 'old-salt')");
    passwordHasher = new PasswordHasher();
    adminService = new AdminService(
        jdbcTemplate,
        passwordHasher,
        mock(ShopRepository.class),
        mock(PlatformRepository.class),
        new ImageGenerationProperties());
  }

  @Test
  void resetUserPassword_replacesHashAndSalt() {
    adminService.resetUserPassword(1L, new AdminDtos.UserPasswordResetRequest("new-pass-123"));

    String salt = jdbcTemplate.queryForObject(
        "SELECT password_salt FROM ym_sys_user WHERE id = 1", String.class);
    String hash = jdbcTemplate.queryForObject(
        "SELECT password_hash FROM ym_sys_user WHERE id = 1", String.class);

    assertNotEquals("old-salt", salt);
    assertNotEquals("old-hash", hash);
    assertEquals(passwordHasher.sha256("new-pass-123", salt), hash);
  }

  @Test
  void resetUserPassword_rejectsShortPassword() {
    ApiException error = assertThrows(ApiException.class,
        () -> adminService.resetUserPassword(
            1L, new AdminDtos.UserPasswordResetRequest("12345")));

    assertEquals(400, error.getCode());
    assertEquals("新密码不能少于6位", error.getMessage());
  }
}
