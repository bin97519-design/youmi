package com.youmi.api.image;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class ImageTaskLogService {
  private static final int MI_COST_PER_IMAGE = 15;

  private final JdbcTemplate jdbcTemplate;
  private final ObjectMapper objectMapper;

  public ImageTaskLogService(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
    this.jdbcTemplate = jdbcTemplate;
    this.objectMapper = objectMapper;
  }

  public void recordCreated(
      Long userId,
      ImageGenerationDtos.CreateTaskRequest request,
      ImageGenerationDtos.CreateTaskResponse response) {
    if (response == null || response.tasks() == null) return;
    String prompt = request == null || request.prompt() == null ? "" : request.prompt().trim();
    String raw = rawString(response.raw());
    for (ImageGenerationDtos.TaskRef task : response.tasks()) {
      if (task == null || task.taskId() == null || task.taskId().isBlank()) continue;
      jdbcTemplate.update("""
          INSERT INTO ym_image_task (
            task_id, user_id, provider, task_type, prompt, model, requested_model, size, resolution,
            requested_count, status, progress, raw_response
          )
          VALUES (?, ?, ?, 'IMAGE', ?, ?, ?, ?, ?, ?, ?, 0, ?)
          ON DUPLICATE KEY UPDATE
            user_id = COALESCE(VALUES(user_id), user_id),
            provider = VALUES(provider),
            prompt = VALUES(prompt),
            model = VALUES(model),
            requested_model = VALUES(requested_model),
            size = VALUES(size),
            resolution = VALUES(resolution),
            requested_count = VALUES(requested_count),
            status = VALUES(status),
            raw_response = VALUES(raw_response)
          """,
          task.taskId(),
          userId,
          response.provider(),
          prompt,
          response.model(),
          response.requestedModel(),
          response.size(),
          response.resolution(),
          response.n(),
          normalizeStatus(task.status(), "submitted"),
          raw);
    }
  }

  public void recordStatus(ImageGenerationDtos.TaskStatusResponse response) {
    if (response == null || response.taskId() == null || response.taskId().isBlank()) return;
    List<String> imageUrls = response.imageUrls() == null ? List.of() : response.imageUrls();
    int imageCount = isDone(response.status()) ? imageUrls.size() : 0;
    int miCost = imageCount * MI_COST_PER_IMAGE;
    BigDecimal moneyCost = extractMoneyCost(response.raw());
    Timestamp completedAt = isDone(response.status()) ? Timestamp.valueOf(LocalDateTime.now()) : null;

    jdbcTemplate.update("""
        UPDATE ym_image_task
        SET status = ?, progress = ?, image_count = ?, mi_cost = ?, money_cost = ?,
            image_urls = ?, error_message = ?, raw_response = ?, completed_at = COALESCE(?, completed_at)
        WHERE task_id = ?
        """,
        normalizeStatus(response.status(), "unknown"),
        response.progress() == null ? 0 : Math.max(0, Math.min(100, response.progress())),
        imageCount,
        miCost,
        moneyCost,
        rawString(objectMapper.valueToTree(imageUrls)),
        response.error(),
        rawString(response.raw()),
        completedAt,
        response.taskId());
  }

  private boolean isDone(String status) {
    if (status == null) return false;
    String value = status.trim().toLowerCase();
    return value.equals("completed") || value.equals("succeeded") || value.equals("success") || value.equals("done");
  }

  private String normalizeStatus(String status, String fallback) {
    return status == null || status.isBlank() ? fallback : status.trim().toLowerCase();
  }

  private BigDecimal extractMoneyCost(JsonNode raw) {
    if (raw == null || raw.isMissingNode() || raw.isNull()) return BigDecimal.ZERO;
    JsonNode data = raw.path("data");
    if (data.isArray() && data.size() > 0) data = data.get(0);
    if (data.isMissingNode() || data.isNull()) data = raw;
    JsonNode cost = data.path("cost");
    if (cost.isNumber()) return cost.decimalValue();
    if (cost.isTextual()) {
      try {
        return new BigDecimal(cost.asText().trim());
      } catch (NumberFormatException ignored) {
        return BigDecimal.ZERO;
      }
    }
    return BigDecimal.ZERO;
  }

  private String rawString(JsonNode node) {
    if (node == null || node.isMissingNode() || node.isNull()) return null;
    try {
      return objectMapper.writeValueAsString(node);
    } catch (Exception ignored) {
      return node.toString();
    }
  }
}
