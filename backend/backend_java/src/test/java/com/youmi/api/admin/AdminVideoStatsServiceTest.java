package com.youmi.api.admin;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import com.youmi.api.video.VideoGenerationDtos;
import com.youmi.api.video.VideoTaskHistory;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class AdminVideoStatsServiceTest {
  @TempDir Path temp;
  final ObjectMapper mapper = new ObjectMapper();
  JdbcTemplate jdbc;
  VideoTaskHistory history;
  AdminVideoStatsService service;
  final ZoneId zone = ZoneId.of("Asia/Shanghai");
  String today;
  long started;

  @BeforeEach void setup() {
    jdbc = new JdbcTemplate(new DriverManagerDataSource("jdbc:h2:mem:" + UUID.randomUUID() + ";MODE=MySQL;DB_CLOSE_DELAY=-1", "sa", ""));
    jdbc.execute("CREATE TABLE ym_shop (id BIGINT, name VARCHAR(100))");
    jdbc.execute("CREATE TABLE ym_sys_user (id BIGINT, account VARCHAR(100), nickname VARCHAR(100), shop_id BIGINT)");
    jdbc.execute("CREATE TABLE ym_mi_value_log (id BIGINT, user_id BIGINT, biz_type VARCHAR(20), task_id VARCHAR(128), price DECIMAL(18,2), status VARCHAR(20), created_at TIMESTAMP, updated_at TIMESTAMP)");
    jdbc.update("INSERT INTO ym_shop VALUES (10, 'Shop A')");
    jdbc.update("INSERT INTO ym_sys_user VALUES (1, 'alice', 'Alice', 10), (2, 'bob', 'Bob', NULL)");
    today = LocalDate.now(zone).toString();
    started = LocalDate.now(zone).atTime(9, 0).atZone(zone).toInstant().toEpochMilli();
    history = new VideoTaskHistory(mapper, temp.resolve("history").toString(), temp.resolve("enhance").toString(), temp.resolve("chat").toString());
    service = new AdminVideoStatsService(jdbc, history);
  }

  void charge(long id, long user, String taskId, String status, int price) {
    jdbc.update("INSERT INTO ym_mi_value_log VALUES (?, ?, 'VIDEO', ?, ?, ?, ?, ?)", id, user, taskId, price, status,
        today + " 09:00:00", today + " 09:02:00");
  }
  void assertMi(String expected, BigDecimal actual) {
    assertEquals(0, new BigDecimal(expected).compareTo(actual));
  }
  void video(long user, String id, String status, String url) {
    var request = new VideoGenerationDtos.CreateTaskRequest("A continuous camera move", "seedance-2.5", "16:9", 15);
    var response = new VideoGenerationDtos.CreateTaskResponse();
    response.setProvider("lk888"); response.setModel(request.model()); response.setTaskId(id); response.setStatus(status);
    response.setVideoUrls(url.isBlank() ? List.of() : List.of(url));
    history.created(user, request, response, started);
  }
  void enhance(long user, String id, String status) throws Exception {
    Path file = temp.resolve("enhance").resolve(Long.toString(user)).resolve(id + ".json");
    Files.createDirectories(file.getParent());
    Files.writeString(file, mapper.writeValueAsString(java.util.Map.of(
        "id", id, "status", status, "createdAt", started,
        "settings", java.util.Map.of("resolution", "1080p", "toolVersion", "standard"),
        "metadata", java.util.Map.of("duration", 15),
        "resultUrl", "completed".equals(status) ? "https://media.test/enhanced.mp4" : "")));
    Files.setLastModifiedTime(file, FileTime.fromMillis(started + 120000));
  }

  @Test void historicalEnhancementsAreIncludedButQuotesAreNot() throws Exception {
    enhance(1, "ready", "completed"); enhance(1, "bad", "failed"); enhance(1, "quote", "quoted");
    charge(1, 1, "video-enhance:ready", "SUCCESS", 120);
    charge(2, 1, "video-enhance:bad", "ROLLBACK", 120);
    var stats = service.stats(1L, "VIDEO_ENHANCE", today, today);
    assertEquals(2, stats.summary().totalTasks());
    assertEquals(1, stats.summary().completedTasks());
    assertEquals(1, stats.summary().failedTasks());
    assertMi("120", stats.summary().totalMiCost());
    assertEquals(1, stats.summary().totalVideos());
    assertMi("120", stats.tasks().stream().filter(t -> "completed".equals(t.status())).findFirst().orElseThrow().miCost());
    assertMi("0", stats.tasks().stream().filter(t -> "failed".equals(t.status())).findFirst().orElseThrow().miCost());
    assertEquals("50.0", stats.providers().get(0).successRate().toString());
    assertEquals("1080p", stats.tasks().get(0).resolution());
    assertEquals("Shop A", stats.shopTrends().get(0).label());
    assertEquals(1, stats.daily().get(0).videos());
  }

  @Test void scopesEverySourceAndSeparatesGenerationFromEnhancement() throws Exception {
    video(1, "anmiao-video:a", "completed", "https://media.test/a.mp4");
    video(2, "anmiao-video:b", "completed", "https://media.test/private.mp4");
    charge(1, 1, "anmiao-video:a", "SUCCESS", 75);
    charge(2, 2, "anmiao-video:b", "SUCCESS", 105);
    enhance(1, "enhance", "completed"); charge(3, 1, "video-enhance:enhance", "SUCCESS", 120);
    var stats = service.stats(1L, "VIDEO", null, null);
    assertEquals(1, stats.tasks().size());
    assertMi("75", stats.summary().totalMiCost());
    assertEquals("Alice", stats.tasks().get(0).userName());
    assertEquals("lingke", stats.tasks().get(0).provider());
    assertEquals(2, service.stats(null, "VIDEO", null, null).tasks().size());
  }

  @Test void legacyChargeIsNotProofOfCompletedGeneration() {
    charge(1, 1, "thq-video:legacy", "SUCCESS", 50);
    var stats = service.stats(1L, "VIDEO", null, null);
    assertEquals("unknown", stats.tasks().get(0).status());
    assertNull(stats.tasks().get(0).completedAt());
    assertEquals(0, stats.summary().completedTasks());
    assertEquals(1, stats.summary().processingTasks());
    assertNull(stats.providers().get(0).successRate());
    assertMi("50", stats.summary().totalMiCost());
  }

  @Test void dateFilterDoesNotTruncateSummaryAndPendingConsumptionIsZero() {
    video(1, "minimax-h3:pending", "pending", "");
    charge(1, 1, "minimax-h3:pending", "PENDING", 75);
    var stats = service.stats(1L, "VIDEO", "2000-01-01", "2000-01-02");
    assertEquals(1, stats.summary().totalTasks());
    assertMi("0", stats.summary().totalMiCost());
    assertTrue(stats.tasks().isEmpty());
    assertMi("75", service.stats(1L, "VIDEO", today, today).tasks().get(0).estimatedMi());
    assertThrows(ApiException.class, () -> service.stats(1L, "BAD", null, null));
    assertThrows(ApiException.class, () -> service.stats(1L, "VIDEO", "invalid", null));
    assertThrows(ApiException.class, () -> service.stats(1L, "VIDEO", "2026-10-10", "2026-10-01"));
  }

  @Test void statusSnapshotPersistsAndCannotRegressAfterCompletion() {
    video(1, "anmiao-video:a", "pending", ""); charge(1, 1, "anmiao-video:a", "SUCCESS", 75);
    var response = new VideoGenerationDtos.TaskStatusResponse();
    response.setTaskId("anmiao-video:a"); response.setStatus("completed");
    response.setVideoUrls(List.of("https://media.test/a.mp4")); history.status(1L, response);
    response.setStatus("pending"); response.setVideoUrls(List.of()); history.status(1L, response);
    response.setStatus("failed"); history.status(1L, response);
    var task = service.stats(1L, "VIDEO", null, null).tasks().get(0);
    assertEquals("completed", task.status());
    assertEquals(List.of("https://media.test/a.mp4"), task.videoUrls());
    assertNotNull(task.completedAt());
  }

  @Test void decimalVideoChargesArePreservedInEveryReportingDimension() {
    video(1, "anmiao-video:decimal", "completed", "https://media.test/decimal.mp4");
    charge(1, 1, "anmiao-video:decimal", "SUCCESS", 0);
    jdbc.update("UPDATE ym_mi_value_log SET price = ? WHERE id = 1", new BigDecimal("88.29"));
    var stats = service.stats(1L, "VIDEO", today, today);
    assertMi("88.29", stats.summary().totalMiCost());
    assertMi("88.29", stats.tasks().get(0).miCost());
    assertMi("88.29", stats.daily().get(0).miCost());
    assertMi("88.29", stats.models().get(0).miCost());
    assertMi("88.29", stats.userTrends().get(0).daily().get(0).miCost());
  }

  @Test void corruptSnapshotDoesNotHideOtherTasks() throws Exception {
    enhance(1, "ready", "completed");
    Files.writeString(temp.resolve("enhance/1/corrupt.json"), "broken");
    assertEquals(1, service.stats(1L, "VIDEO_ENHANCE", null, null).tasks().size());
  }

  @Test void taskListFiltersBeforePaginationAndHasNoRecentFiveHundredLimit() throws Exception {
    for (int id = 1; id <= 501; id++) charge(id, 1, "thq-video:" + id, "SUCCESS", 10);
    enhance(1, "older-failure", "failed");
    charge(502, 1, "video-enhance:older-failure", "ROLLBACK", 10);
    assertEquals(502, service.taskRows(1L, null, today, today, "", "").size());
    var filtered = service.taskRows(1L, null, today, today, "FAILED", "video-enhance");
    assertEquals(1, filtered.size());
    assertEquals("video-enhance:older-failure", filtered.get(0).taskId());
    assertTrue(service.taskRows(2L, null, today, today, "", "").isEmpty());
    assertTrue(service.taskRows(1L, "VIDEO", today, today, "FAILED", "").isEmpty());
    assertTrue(service.taskRows(1L, null, "2000-01-01", "2000-01-02", "", "").isEmpty());
    assertThrows(ApiException.class, () -> service.taskRows(1L, "BAD", null, null, "", ""));
  }

  @Test void historicalChatTasksKeepTheirResultsWithoutExposingProviderRawResponse() throws Exception {
    Path file = temp.resolve("chat/1/chat.json");
    Files.createDirectories(file.getParent());
    Files.writeString(file, mapper.writeValueAsString(java.util.Map.of(
        "id", "old-chat", "status", "completed", "url", "https://media.test/old-chat.mp4",
        "raw", "private-provider-response", "request", java.util.Map.of(
            "prompt", "One connected video", "model", "seedance-chat", "durationSeconds", 30, "resolution", "720p"))));
    charge(1, 1, "thq-chat-video:old-chat", "SUCCESS", 90);
    var stats = service.stats(1L, "VIDEO", today, today);
    assertEquals(1, stats.summary().totalTasks());
    assertEquals(30, stats.tasks().get(0).durationSeconds());
    assertEquals("One connected video", stats.tasks().get(0).prompt());
    assertEquals(List.of("https://media.test/old-chat.mp4"), stats.tasks().get(0).videoUrls());
    assertFalse(mapper.writeValueAsString(stats).contains("private-provider-response"));
  }
}
