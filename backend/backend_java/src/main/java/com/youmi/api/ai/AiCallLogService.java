package com.youmi.api.ai;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import java.util.ArrayList;
import java.util.List;

@Service
public class AiCallLogService {
  private static final Logger log = LoggerFactory.getLogger(AiCallLogService.class);
  private final JdbcTemplate jdbc;

  public AiCallLogService(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public void record(String source, String operation, String provider, String model,
      Long apiKeyId, boolean success, Integer httpStatus, long durationMs, String errorCode) {
    record(source, operation, provider, model, apiKeyId, "system_default",
        success, httpStatus, durationMs, errorCode);
  }

  public void record(String source, String operation, String provider, String model,
      Long apiKeyId, String selectionMode, boolean success, Integer httpStatus,
      long durationMs, String errorCode) {
    try {
      jdbc.update("""
          INSERT INTO ym_ai_call_log
            (source, operation, provider, model, api_key_id, selection_mode, status, http_status, duration_ms, error_code)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          """, clean(source, 64), clean(operation, 32), clean(provider, 64), clean(model, 128),
          apiKeyId, normalizeSelectionMode(selectionMode), success ? "SUCCESS" : "FAILED", httpStatus,
          Math.max(0, durationMs), clean(errorCode, 64));
    } catch (RuntimeException error) {
      // Observability must never turn a successful upstream AI request into an application failure.
      log.warn("Could not persist AI call telemetry: {}", error.getClass().getSimpleName());
    }
  }

  public List<AiCallLogDtos.Row> listRecent(int requestedLimit, String source, String status) {
    int limit = Math.max(1, Math.min(500, requestedLimit));
    List<String> conditions = new ArrayList<>();
    List<Object> args = new ArrayList<>();
    if (source != null && !source.isBlank()) {
      conditions.add("l.source = ?");
      args.add(source.trim());
    }
    if (status != null && !status.isBlank()) {
      conditions.add("l.status = ?");
      args.add(status.trim().toUpperCase());
    }
    String where = conditions.isEmpty() ? "" : "WHERE " + String.join(" AND ", conditions);
    args.add(limit);
    return jdbc.query("""
        SELECT l.id, l.source, l.operation, l.provider, l.model, l.api_key_id,
               k.name AS api_key_name, l.selection_mode, l.status, l.http_status,
               l.duration_ms, l.error_code, l.created_at
        FROM ym_ai_call_log l
        LEFT JOIN ym_model_api_key k ON k.id = l.api_key_id
        """ + where + " ORDER BY l.id DESC LIMIT ?", (rs, rowNum) -> new AiCallLogDtos.Row(
          rs.getLong("id"), rs.getString("source"), rs.getString("operation"),
          rs.getString("provider"), rs.getString("model"),
          nullableLong(rs.getObject("api_key_id")), rs.getString("api_key_name"),
          rs.getString("selection_mode"), rs.getString("status"),
          nullableInteger(rs.getObject("http_status")), rs.getLong("duration_ms"),
          rs.getString("error_code"), rs.getTimestamp("created_at") == null
              ? null : rs.getTimestamp("created_at").toInstant()), args.toArray());
  }

  private Long nullableLong(Object value) {
    return value == null ? null : ((Number) value).longValue();
  }

  private Integer nullableInteger(Object value) {
    return value == null ? null : ((Number) value).intValue();
  }

  private String normalizeSelectionMode(String value) {
    if ("dropdown".equals(value) || "fallback".equals(value)) return value;
    return "system_default";
  }

  private String clean(String value, int maxLength) {
    if (value == null || value.isBlank()) return null;
    String normalized = value.trim().replaceAll("[\\r\\n\\t]", " ");
    return normalized.length() <= maxLength ? normalized : normalized.substring(0, maxLength);
  }
}
