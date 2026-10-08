package com.youmi.api.admin;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.youmi.api.auth.PasswordHasher;
import com.youmi.api.image.ImageGenerationProperties;
import com.youmi.api.platform.PlatformRepository;
import com.youmi.api.shop.ShopRepository;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

class AdminImageStatsSqlTest {
  @SuppressWarnings({"rawtypes", "unchecked"})
  @Test
  void ordinaryUserTrendQueriesKeepWhitespaceBeforeGroupBy() {
    JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
    List<String> queries = new ArrayList<>();
    when(jdbcTemplate.queryForObject(anyString(), any(RowMapper.class), any(Object[].class)))
        .thenReturn(new AdminDtos.ImageStatsSummary(
            0L, 0L, 0L, 0L, 0L, 0, 0, BigDecimal.ZERO));
    when(jdbcTemplate.query(anyString(), any(RowMapper.class), any(Object[].class)))
        .thenAnswer(invocation -> {
          queries.add(invocation.getArgument(0));
          return List.of();
        });

    AdminService service = new AdminService(
        jdbcTemplate,
        mock(PasswordHasher.class),
        mock(ShopRepository.class),
        mock(PlatformRepository.class),
        mock(ImageGenerationProperties.class));

    service.imageStats(42L, "2026-09-01", "2026-09-01");

    long scopedTrendQueries = queries.stream()
        .filter(sql -> sql.contains("t.user_id = ?"))
        .filter(sql -> sql.contains("GROUP BY"))
        .count();
    assertEquals(3L, scopedTrendQueries);
    queries.forEach(sql -> assertFalse(sql.contains("?GROUP BY"), sql));
  }
}
