package com.youmi.api.admin;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.stereotype.Service;

@Service
public class AdminTaskListService {
  public record TaskPage(List<Map<String, Object>> tasks, long total, int page, int pageSize) { }
  private static final int IMAGE_BATCH_SIZE = 100;
  private static final TypeReference<LinkedHashMap<String, Object>> ROW_TYPE = new TypeReference<>() { };
  private static final Comparator<Map<String, Object>> ORDER = Comparator
      .comparing(AdminTaskListService::createdAt, Comparator.reverseOrder())
      .thenComparingInt(row -> typeOrder(String.valueOf(row.get("taskType"))))
      .thenComparing(Comparator.comparingLong(AdminTaskListService::imageId).reversed())
      .thenComparing(row -> String.valueOf(row.get("userId")))
      .thenComparing(row -> String.valueOf(row.get("taskId")));
  private final AdminService images;
  private final AdminVideoStatsService videos;
  private final ObjectMapper mapper;

  public AdminTaskListService(AdminService images, AdminVideoStatsService videos, ObjectMapper mapper) {
    this.images = images;
    this.videos = videos;
    this.mapper = mapper;
  }

  public TaskPage tasks(Long scopeUserId, String kind, String dateFrom, String dateTo, String status,
      String model, Long userId, int page, int pageSize) {
    return tasks(scopeUserId, null, kind, dateFrom, dateTo, status, model, userId, page, pageSize);
  }

  public TaskPage tasksForShop(Long shopId, String kind, String dateFrom, String dateTo, String status,
      String model, int page, int pageSize) {
    return tasks(null, shopId, kind, dateFrom, dateTo, status, model, null, page, pageSize);
  }

  private TaskPage tasks(Long scopeUserId, Long scopeShopId, String kind, String dateFrom, String dateTo, String status,
      String model, Long userId, int page, int pageSize) {
    if (!List.of("all", "image", "video", "enhance").contains(kind)) throw new ApiException(400, "任务类型无效");
    validateDates(dateFrom, dateTo);
    String statusFilter = status == null ? "" : status.trim().toUpperCase(Locale.ROOT);
    if (!statusFilter.isEmpty() && !List.of("COMPLETED", "FAILED", "PENDING", "PROCESSING").contains(statusFilter)) {
      throw new ApiException(400, "任务状态无效");
    }
    int safePage = Math.max(1, page);
    int size = Math.min(100, Math.max(1, pageSize));
    if (scopeUserId != null && userId != null && !scopeUserId.equals(userId)) {
      return new TaskPage(List.of(), 0, safePage, size);
    }
    Long scope = scopeUserId == null && scopeShopId == null ? userId : scopeUserId;
    if ("image".equals(kind)) {
      var result = scopeShopId == null
          ? images.imageTaskPage(scope, dateFrom, dateTo, statusFilter, model, null, safePage, size, true)
          : images.imageTaskPageForShop(scopeShopId, dateFrom, dateTo, statusFilter, model, safePage, size, true);
      return new TaskPage(result.tasks().stream().map(this::imageRow).toList(), result.total(), safePage, size);
    }
    String videoType = "video".equals(kind) ? "VIDEO" : "enhance".equals(kind) ? "VIDEO_ENHANCE" : null;
    List<Map<String, Object>> rows = new ArrayList<>((scopeShopId == null
        ? videos.taskRows(scope, videoType, dateFrom, dateTo, statusFilter, model)
        : videos.taskRowsForShop(scopeShopId, videoType, dateFrom, dateTo, statusFilter, model))
        .stream().map(this::row).toList());
    long offset = (long) (safePage - 1) * size;
    long total = rows.size();
    long imageStart = 0;
    if ("all".equals(kind)) {
      // At most all video rows can precede an image, so only this image window can enter the requested page.
      imageStart = Math.max(0, offset - rows.size());
      long batch = imageStart / IMAGE_BATCH_SIZE;
      var result = scopeShopId == null
          ? images.imageTaskPage(scope, dateFrom, dateTo, statusFilter, model, null,
              Math.toIntExact(batch + 1), IMAGE_BATCH_SIZE, true)
          : images.imageTaskPageForShop(scopeShopId, dateFrom, dateTo, statusFilter, model,
              Math.toIntExact(batch + 1), IMAGE_BATCH_SIZE, true);
      total += result.total();
      long imageEnd = Math.min(result.total(), offset + size);
      while (batch * IMAGE_BATCH_SIZE < imageEnd) {
        long batchStart = batch * IMAGE_BATCH_SIZE;
        for (int index = 0; index < result.tasks().size(); index++) {
          long position = batchStart + index;
          if (position >= imageStart && position < imageEnd) rows.add(imageRow(result.tasks().get(index)));
        }
        batch++;
        if (batch * IMAGE_BATCH_SIZE >= imageEnd) break;
        result = scopeShopId == null
            ? images.imageTaskPage(scope, dateFrom, dateTo, statusFilter, model, null,
                Math.toIntExact(batch + 1), IMAGE_BATCH_SIZE, false)
            : images.imageTaskPageForShop(scopeShopId, dateFrom, dateTo, statusFilter, model,
                Math.toIntExact(batch + 1), IMAGE_BATCH_SIZE, false);
      }
    }
    rows.sort(ORDER);
    return new TaskPage(rows.stream().skip(offset - imageStart).limit(size).toList(), total, safePage, size);
  }

  private Map<String, Object> row(Object value) {
    return mapper.convertValue(value, ROW_TYPE);
  }

  private Map<String, Object> imageRow(AdminDtos.ImageTaskRow value) {
    Map<String, Object> row = row(value);
    row.put("taskType", "IMAGE");
    return row;
  }

  private static LocalDateTime createdAt(Map<String, Object> row) {
    Object value = row.get("createdAt");
    return value == null ? LocalDateTime.MIN : LocalDateTime.parse(value.toString().replace(' ', 'T'));
  }

  private static long imageId(Map<String, Object> row) {
    return row.get("id") instanceof Number number ? number.longValue() : 0;
  }

  private static int typeOrder(String type) {
    return "IMAGE".equals(type) ? 0 : "VIDEO".equals(type) ? 1 : 2;
  }

  private static void validateDates(String dateFrom, String dateTo) {
    LocalDate from;
    LocalDate to;
    try {
      from = dateFrom == null || dateFrom.isBlank() ? null : LocalDate.parse(dateFrom);
      to = dateTo == null || dateTo.isBlank() ? null : LocalDate.parse(dateTo);
    } catch (RuntimeException error) {
      throw new ApiException(400, "日期格式无效");
    }
    if (from != null && to != null && from.isAfter(to)) throw new ApiException(400, "日期范围无效");
  }
}
