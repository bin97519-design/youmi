package com.youmi.api.admin;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.youmi.api.auth.PasswordHasher;
import com.youmi.api.image.ImageGenerationProperties;
import com.youmi.api.platform.PlatformRepository;
import com.youmi.api.shop.ShopRepository;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

class AdminImageTaskPageTest {
  @SuppressWarnings({"rawtypes", "unchecked"})
  @Test
  void pollingSkipsCountAndClampsPageSize() {
    JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
    when(jdbcTemplate.query(anyString(), any(RowMapper.class), any(Object[].class)))
        .thenReturn(List.of());
    AdminService service = new AdminService(
        jdbcTemplate,
        mock(PasswordHasher.class),
        mock(ShopRepository.class),
        mock(PlatformRepository.class),
        mock(ImageGenerationProperties.class));

    AdminDtos.ImageTaskPage page = service.imageTaskPage(
        null, "2026-10-01", "2026-10-10", "", "", null, 0, 500, false);

    assertEquals(1, page.page());
    assertEquals(100, page.pageSize());
    assertEquals(-1, page.total());
    verify(jdbcTemplate, never()).queryForObject(
        anyString(), eq(Long.class), any(Object[].class));
    org.mockito.ArgumentCaptor<String> sql = org.mockito.ArgumentCaptor.forClass(String.class);
    verify(jdbcTemplate).query(sql.capture(), any(RowMapper.class), any(Object[].class));
    assertFalse(sql.getValue().contains("DATE(t.created_at)"));
    assertEquals(true, sql.getValue().contains("t.created_at >= ?"));
    assertEquals(true, sql.getValue().contains("t.created_at < DATE_ADD(?, INTERVAL 1 DAY)"));
    assertEquals(true, sql.getValue().contains("LIMIT ? OFFSET ?"));
  }
}
