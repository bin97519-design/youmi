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
            task_id, client_task_id, user_id, provider, task_type, prompt, model, requested_model, size, resolution,
            requested_count, status, progress, raw_response
          )
          VALUES (?, ?, ?, ?, 'IMAGE', ?, ?, ?, ?, ?, ?, ?, 0, ?)
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
          request == null ? null : request.clientTaskId(),
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

  /**
   * 客户端幂等：按前端稳定携带的 {@code client_task_id} 查询是否已存在同一张生图的落库记录。
   * 命中表示刷新重提场景，调用方应直接返回已有任务，跳过米值扣减与外部生图调用。
   *
   * @param clientTaskId 前端生成的客户端幂等键（空值直接返回 null）
   * @return 已存在的任务快照，未命中返回 null
   */
  public ExistingTask findExistingByClientTaskId(Long userId, String clientTaskId) {
    if (userId == null || clientTaskId == null || clientTaskId.isBlank()) return null;
    List<ExistingTask> rows = jdbcTemplate.query(
        "SELECT task_id, provider, model, requested_model, size, resolution, requested_count, status, raw_response "
            + "FROM ym_image_task WHERE user_id = ? AND client_task_id = ? LIMIT 1",
        (rs, i) -> new ExistingTask(
            rs.getString("task_id"),
            rs.getString("provider"),
            rs.getString("model"),
            rs.getString("requested_model"),
            rs.getString("size"),
            rs.getString("resolution"),
            rs.getInt("requested_count"),
            rs.getString("status"),
            rs.getString("raw_response")),
        userId, clientTaskId);
    return rows.isEmpty() ? null : rows.get(0);
  }

  public boolean isOwnedByUser(Long userId, String taskId) {
    if (userId == null || taskId == null || taskId.isBlank()) return false;
    Integer count = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM ym_image_task WHERE task_id = ? AND user_id = ?",
        Integer.class, taskId, userId);
    return count != null && count > 0;
  }

  /** 已落库生图任务的轻量快照，用于幂等早返回时构造响应。 */
  public static class ExistingTask {
    public final String taskId, provider, model, requestedModel, size, resolution, status, rawResponse;
    public final int n;

    public ExistingTask(String taskId, String provider, String model, String requestedModel,
        String size, String resolution, int n, String status, String rawResponse) {
      this.taskId = taskId;
      this.provider = provider;
      this.model = model;
      this.requestedModel = requestedModel;
      this.size = size;
      this.resolution = resolution;
      this.n = n;
      this.status = status;
      this.rawResponse = rawResponse;
    }
  }

  /** 由 {@link ExistingTask} 构造与正常创建响应结构一致的 {@link CreateTaskResponse}。 */
  public ImageGenerationDtos.CreateTaskResponse buildResponseFromEntity(ExistingTask e) {
    List<ImageGenerationDtos.TaskRef> tasks = List.of(
        new ImageGenerationDtos.TaskRef(e.taskId, e.status == null ? "submitted" : e.status));
    return new ImageGenerationDtos.CreateTaskResponse(
        e.provider, e.requestedModel, e.model, e.size, e.resolution,
        e.n <= 0 ? 1 : e.n, tasks, null);
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
        SET provider = COALESCE(NULLIF(?, ''), provider),
            status = ?, progress = ?, image_count = ?, mi_cost = ?, money_cost = ?,
            image_urls = ?, error_message = ?, raw_response = ?, completed_at = COALESCE(?, completed_at)
        WHERE task_id = ?
        """,
        response.provider(),
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
