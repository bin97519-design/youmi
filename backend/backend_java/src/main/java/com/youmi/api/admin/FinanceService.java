package com.youmi.api.admin;

import com.youmi.api.common.ApiException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class FinanceService {
  private static final int MAX_RANGE_DAYS = 3660;
  private static final String LEDGER_FROM = """
      FROM ym_mi_value_log l
      LEFT JOIN ym_sys_user u ON u.id = l.user_id
      LEFT JOIN ym_shop s ON s.id = COALESCE(l.shop_id, u.shop_id)
      LEFT JOIN ym_platform p ON p.id = COALESCE(l.platform_id, s.platform_id)
      """;

  private final JdbcTemplate jdbcTemplate;

  public FinanceService(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public FinanceDtos.FinanceReport report(
      String rawDateFrom,
      String rawDateTo,
      Long platformId,
      Long shopId) {
    LocalDate today = LocalDate.now();
    LocalDate dateTo = parseDate(rawDateTo, today, "结束日期格式错误");
    LocalDate dateFrom = parseDate(rawDateFrom, dateTo.withDayOfMonth(1), "开始日期格式错误");
    validateRange(dateFrom, dateTo);

    LedgerFilter filter = ledgerFilter(dateFrom, dateTo, platformId, shopId);
    return new FinanceDtos.FinanceReport(
        new FinanceDtos.FinancePeriod(
            dateFrom.toString(), dateTo.toString(), platformId, shopId),
        summary(filter),
        daily(filter),
        platforms(filter),
        shops(filter),
        users(filter));
  }

  public byte[] exportCsv(
      String rawDateFrom,
      String rawDateTo,
      Long platformId,
      Long shopId) {
    return exportCsv(report(rawDateFrom, rawDateTo, platformId, shopId));
  }

  public byte[] exportCsv(FinanceDtos.FinanceReport report) {
    StringBuilder csv = new StringBuilder(4096);
    csv.append('\ufeff');
    csv.append("有米AI财务消耗报表\n");
    csv.append("统计日期,").append(report.period().dateFrom()).append(" 至 ")
        .append(report.period().dateTo()).append('\n');
    csv.append("换算口径,1米值=0.01元\n\n");

    FinanceDtos.FinanceSummary summary = report.summary();
    csv.append("汇总指标,数值\n");
    csv.append("成功消费笔数,").append(summary.transactionCount()).append('\n');
    csv.append("消费用户数,").append(summary.userCount()).append('\n');
    csv.append("消费店铺数,").append(summary.shopCount()).append('\n');
    csv.append("生图米值,").append(summary.imageMi()).append('\n');
    csv.append("视频米值,").append(summary.videoMi()).append('\n');
    csv.append("总消耗米值,").append(summary.totalMi()).append('\n');
    csv.append("折合金额（元）,").append(summary.totalYuan()).append("\n\n");

    csv.append("每日明细\n");
    csv.append("日期,消费笔数,消费用户数,生图米值,视频米值,总米值,金额（元）\n");
    for (FinanceDtos.DailyFinanceRow row : report.daily()) {
      appendCsvRow(csv, row.day(), row.transactionCount(), row.userCount(), row.imageMi(),
          row.videoMi(), row.totalMi(), row.totalYuan());
    }

    csv.append("\n平台汇总\n");
    csv.append("平台,消费笔数,店铺数,用户数,生图米值,视频米值,总米值,金额（元）\n");
    for (FinanceDtos.PlatformFinanceRow row : report.platforms()) {
      appendCsvRow(csv, row.platformName(), row.transactionCount(), row.shopCount(),
          row.userCount(), row.imageMi(), row.videoMi(), row.totalMi(), row.totalYuan());
    }

    csv.append("\n店铺汇总\n");
    csv.append("平台,店铺,店铺编码,消费笔数,用户数,生图米值,视频米值,总米值,金额（元）\n");
    for (FinanceDtos.ShopFinanceRow row : report.shops()) {
      appendCsvRow(csv, row.platformName(), row.shopName(), row.shopCode(),
          row.transactionCount(), row.userCount(), row.imageMi(), row.videoMi(),
          row.totalMi(), row.totalYuan());
    }

    csv.append("\n个人汇总\n");
    csv.append("账号,昵称,用户ID,消费笔数,平台数,店铺数,生图米值,视频米值,总米值,金额（元）\n");
    for (FinanceDtos.UserFinanceRow row : report.users()) {
      appendCsvRow(csv, row.account(), row.nickname(), row.userId(), row.transactionCount(),
          row.platformCount(), row.shopCount(), row.imageMi(), row.videoMi(),
          row.totalMi(), row.totalYuan());
    }
    return csv.toString().getBytes(StandardCharsets.UTF_8);
  }

  private FinanceDtos.FinanceSummary summary(LedgerFilter filter) {
    String sql = """
        SELECT COUNT(*) AS transaction_count,
               COUNT(DISTINCT l.user_id) AS user_count,
               COUNT(DISTINCT COALESCE(l.shop_id, u.shop_id)) AS shop_count,
               COALESCE(SUM(CASE WHEN l.biz_type = 'IMAGE' THEN l.price ELSE 0 END), 0) AS image_mi,
               COALESCE(SUM(CASE WHEN l.biz_type = 'VIDEO' THEN l.price ELSE 0 END), 0) AS video_mi,
               COALESCE(SUM(l.price), 0) AS total_mi
        """ + LEDGER_FROM + filter.where();
    return jdbcTemplate.queryForObject(sql, (rs, rowNum) -> {
      long totalMi = rs.getLong("total_mi");
      return new FinanceDtos.FinanceSummary(
          rs.getLong("transaction_count"),
          rs.getLong("user_count"),
          rs.getLong("shop_count"),
          rs.getLong("image_mi"),
          rs.getLong("video_mi"),
          totalMi,
          yuan(totalMi));
    }, filter.args());
  }

  private List<FinanceDtos.DailyFinanceRow> daily(LedgerFilter filter) {
    String sql = """
        SELECT DATE(l.created_at) AS stat_day,
               COUNT(*) AS transaction_count,
               COUNT(DISTINCT l.user_id) AS user_count,
               COALESCE(SUM(CASE WHEN l.biz_type = 'IMAGE' THEN l.price ELSE 0 END), 0) AS image_mi,
               COALESCE(SUM(CASE WHEN l.biz_type = 'VIDEO' THEN l.price ELSE 0 END), 0) AS video_mi,
               COALESCE(SUM(l.price), 0) AS total_mi
        """ + LEDGER_FROM + filter.where() + """
        GROUP BY DATE(l.created_at)
        ORDER BY stat_day
        """;
    return jdbcTemplate.query(sql, (rs, rowNum) -> {
      long totalMi = rs.getLong("total_mi");
      return new FinanceDtos.DailyFinanceRow(
          rs.getString("stat_day"),
          rs.getLong("transaction_count"),
          rs.getLong("user_count"),
          rs.getLong("image_mi"),
          rs.getLong("video_mi"),
          totalMi,
          yuan(totalMi));
    }, filter.args());
  }

  private List<FinanceDtos.PlatformFinanceRow> platforms(LedgerFilter filter) {
    String sql = """
        SELECT COALESCE(l.platform_id, s.platform_id) AS effective_platform_id,
               COALESCE(p.code, 'UNBOUND') AS platform_code,
               COALESCE(p.name, '未绑定平台') AS platform_name,
               COUNT(*) AS transaction_count,
               COUNT(DISTINCT COALESCE(l.shop_id, u.shop_id)) AS shop_count,
               COUNT(DISTINCT l.user_id) AS user_count,
               COALESCE(SUM(CASE WHEN l.biz_type = 'IMAGE' THEN l.price ELSE 0 END), 0) AS image_mi,
               COALESCE(SUM(CASE WHEN l.biz_type = 'VIDEO' THEN l.price ELSE 0 END), 0) AS video_mi,
               COALESCE(SUM(l.price), 0) AS total_mi
        """ + LEDGER_FROM + filter.where() + """
        GROUP BY COALESCE(l.platform_id, s.platform_id), p.code, p.name
        ORDER BY total_mi DESC, platform_name
        """;
    return jdbcTemplate.query(sql, (rs, rowNum) -> {
      long totalMi = rs.getLong("total_mi");
      return new FinanceDtos.PlatformFinanceRow(
          nullableLong(rs, "effective_platform_id"),
          rs.getString("platform_code"),
          rs.getString("platform_name"),
          rs.getLong("transaction_count"),
          rs.getLong("shop_count"),
          rs.getLong("user_count"),
          rs.getLong("image_mi"),
          rs.getLong("video_mi"),
          totalMi,
          yuan(totalMi));
    }, filter.args());
  }

  private List<FinanceDtos.ShopFinanceRow> shops(LedgerFilter filter) {
    String sql = """
        SELECT COALESCE(l.shop_id, u.shop_id) AS effective_shop_id,
               COALESCE(s.code, 'UNBOUND') AS shop_code,
               COALESCE(s.name, '未绑定店铺') AS shop_name,
               COALESCE(l.platform_id, s.platform_id) AS effective_platform_id,
               COALESCE(p.name, '未绑定平台') AS platform_name,
               COUNT(*) AS transaction_count,
               COUNT(DISTINCT l.user_id) AS user_count,
               COALESCE(SUM(CASE WHEN l.biz_type = 'IMAGE' THEN l.price ELSE 0 END), 0) AS image_mi,
               COALESCE(SUM(CASE WHEN l.biz_type = 'VIDEO' THEN l.price ELSE 0 END), 0) AS video_mi,
               COALESCE(SUM(l.price), 0) AS total_mi
        """ + LEDGER_FROM + filter.where() + """
        GROUP BY COALESCE(l.shop_id, u.shop_id), s.code, s.name,
                 COALESCE(l.platform_id, s.platform_id), p.name
        ORDER BY total_mi DESC, shop_name
        """;
    return jdbcTemplate.query(sql, (rs, rowNum) -> {
      long totalMi = rs.getLong("total_mi");
      return new FinanceDtos.ShopFinanceRow(
          nullableLong(rs, "effective_shop_id"),
          rs.getString("shop_code"),
          rs.getString("shop_name"),
          nullableLong(rs, "effective_platform_id"),
          rs.getString("platform_name"),
          rs.getLong("transaction_count"),
          rs.getLong("user_count"),
          rs.getLong("image_mi"),
          rs.getLong("video_mi"),
          totalMi,
          yuan(totalMi));
    }, filter.args());
  }

  private List<FinanceDtos.UserFinanceRow> users(LedgerFilter filter) {
    String sql = """
        SELECT l.user_id AS effective_user_id,
               u.account,
               u.nickname,
               COUNT(*) AS transaction_count,
               COUNT(DISTINCT COALESCE(l.platform_id, s.platform_id)) AS platform_count,
               COUNT(DISTINCT COALESCE(l.shop_id, u.shop_id)) AS shop_count,
               COALESCE(SUM(CASE WHEN l.biz_type = 'IMAGE' THEN l.price ELSE 0 END), 0) AS image_mi,
               COALESCE(SUM(CASE WHEN l.biz_type = 'VIDEO' THEN l.price ELSE 0 END), 0) AS video_mi,
               COALESCE(SUM(l.price), 0) AS total_mi
        """ + LEDGER_FROM + filter.where() + """
        GROUP BY l.user_id, u.account, u.nickname
        ORDER BY total_mi DESC, effective_user_id
        """;
    return jdbcTemplate.query(sql, (rs, rowNum) -> {
      long totalMi = rs.getLong("total_mi");
      return new FinanceDtos.UserFinanceRow(
          nullableLong(rs, "effective_user_id"),
          rs.getString("account"),
          rs.getString("nickname"),
          rs.getLong("transaction_count"),
          rs.getLong("platform_count"),
          rs.getLong("shop_count"),
          rs.getLong("image_mi"),
          rs.getLong("video_mi"),
          totalMi,
          yuan(totalMi));
    }, filter.args());
  }

  private LedgerFilter ledgerFilter(
      LocalDate dateFrom,
      LocalDate dateTo,
      Long platformId,
      Long shopId) {
    StringBuilder where = new StringBuilder("""
        WHERE l.status = 'SUCCESS'
          AND l.biz_type IN ('IMAGE', 'VIDEO')
          AND l.created_at >= ?
          AND l.created_at < ?
        """);
    List<Object> args = new ArrayList<>();
    args.add(Timestamp.valueOf(dateFrom.atStartOfDay()));
    args.add(Timestamp.valueOf(dateTo.plusDays(1).atStartOfDay()));
    if (platformId != null) {
      where.append(" AND COALESCE(l.platform_id, s.platform_id) = ?\n");
      args.add(platformId);
    }
    if (shopId != null) {
      where.append(" AND COALESCE(l.shop_id, u.shop_id) = ?\n");
      args.add(shopId);
    }
    return new LedgerFilter(where.toString(), args.toArray());
  }

  private LocalDate parseDate(String raw, LocalDate fallback, String message) {
    if (raw == null || raw.isBlank()) return fallback;
    try {
      return LocalDate.parse(raw.trim());
    } catch (DateTimeParseException exception) {
      throw new ApiException(400, message);
    }
  }

  private void validateRange(LocalDate dateFrom, LocalDate dateTo) {
    if (dateFrom.isAfter(dateTo)) {
      throw new ApiException(400, "开始日期不能晚于结束日期");
    }
    if (ChronoUnit.DAYS.between(dateFrom, dateTo) > MAX_RANGE_DAYS) {
      throw new ApiException(400, "单次统计范围不能超过10年");
    }
  }

  private BigDecimal yuan(long miValue) {
    return BigDecimal.valueOf(miValue)
        .movePointLeft(2)
        .setScale(2, RoundingMode.HALF_UP);
  }

  private Long nullableLong(ResultSet rs, String column) throws SQLException {
    long value = rs.getLong(column);
    return rs.wasNull() ? null : value;
  }

  private void appendCsvRow(StringBuilder csv, Object... values) {
    for (int index = 0; index < values.length; index++) {
      if (index > 0) csv.append(',');
      csv.append(csvCell(values[index]));
    }
    csv.append('\n');
  }

  private String csvCell(Object value) {
    String text = value == null ? "" : String.valueOf(value);
    if (text.indexOf(',') >= 0 || text.indexOf('"') >= 0 || text.indexOf('\n') >= 0) {
      return '"' + text.replace("\"", "\"\"") + '"';
    }
    return text;
  }

  private record LedgerFilter(String where, Object[] args) {
  }
}
