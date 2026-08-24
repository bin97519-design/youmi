package com.youmi.api.admin;

import static org.junit.jupiter.api.Assertions.assertEquals;
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

class AdminProtectedUserTest {
  private JdbcTemplate jdbcTemplate;
  private AdminService adminService;

  @BeforeEach
  void setUp() {
    DriverManagerDataSource dataSource = new DriverManagerDataSource(
        "jdbc:h2:mem:adminProtectedUser;MODE=MySQL;DB_CLOSE_DELAY=-1", "sa", "");
    jdbcTemplate = new JdbcTemplate(dataSource);
    jdbcTemplate.execute("DROP TABLE IF EXISTS ym_sys_user_role");
    jdbcTemplate.execute("DROP TABLE IF EXISTS ym_sys_user");
    jdbcTemplate.execute("CREATE TABLE ym_sys_user (id BIGINT PRIMARY KEY)");
    jdbcTemplate.execute(
        "CREATE TABLE ym_sys_user_role (user_id BIGINT NOT NULL, role_id BIGINT NOT NULL)");
    jdbcTemplate.update("INSERT INTO ym_sys_user (id) VALUES (1), (2)");
    jdbcTemplate.update("INSERT INTO ym_sys_user_role (user_id, role_id) VALUES (1, 1), (2, 1)");
    adminService = new AdminService(
        jdbcTemplate,
        new PasswordHasher(),
        mock(ShopRepository.class),
        mock(PlatformRepository.class),
        new ImageGenerationProperties());
  }

  @Test
  void deleteUser_rejectsProtectedAdmin() {
    ApiException error = assertThrows(ApiException.class, () -> adminService.deleteUser(1L));

    assertEquals(403, error.getCode());
    assertEquals("系统管理员账号不可删除", error.getMessage());
    assertEquals(1, jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM ym_sys_user WHERE id = 1", Integer.class));
  }

  @Test
  void deleteUser_keepsExistingBehaviorForOtherUsers() {
    adminService.deleteUser(2L);

    assertEquals(0, jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM ym_sys_user WHERE id = 2", Integer.class));
  }
}
