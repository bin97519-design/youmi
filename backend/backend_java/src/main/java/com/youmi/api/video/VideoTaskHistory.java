package com.youmi.api.video;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/** Read-only task snapshots for console reporting, without provider polling or billing. */
@Service
public class VideoTaskHistory {
  public record Snapshot(Long userId, String taskId, String taskType, String provider, String model,
      String prompt, String resolution, Double durationSeconds, String status, Integer progress,
      List<String> videoUrls, String errorMessage, long createdAt, long updatedAt, Long completedAt) { }

  private final ObjectMapper mapper;
  private final Path historyRoot;
  private final Path enhanceRoot;
  private final Path chatRoot;

  public VideoTaskHistory(ObjectMapper mapper,
      @Value("${youmi.video-workflow.history-work-dir:data/video-task-history}") String historyDir,
      @Value("${youmi.video-enhance.work-dir:data/video-enhance}") String enhanceDir,
      @Value("${youmi.video-workflow.chat-work-dir:data/chat-video-tasks}") String chatDir) {
    this.mapper = mapper;
    historyRoot = Path.of(historyDir).toAbsolutePath().normalize();
    enhanceRoot = Path.of(enhanceDir).toAbsolutePath().normalize();
    chatRoot = Path.of(chatDir).toAbsolutePath().normalize();
  }

  public synchronized void created(Long userId, VideoGenerationDtos.CreateTaskRequest request,
      VideoGenerationDtos.CreateTaskResponse response, long startedAt) {
    if (response == null || response.getTaskId() == null || response.getTaskId().isBlank()) return;
    long now = System.currentTimeMillis();
    String status = normalizeStatus(response.getStatus());
    save(new Snapshot(userId, response.getTaskId(), "VIDEO", response.getProvider(), response.getModel(),
        request == null ? "" : request.prompt(), request == null ? "" : request.resolution(),
        request == null || request.durationSeconds() == null ? null : request.durationSeconds().doubleValue(),
        status, null, safeUrls(response.getVideoUrls()), "", startedAt, now, terminal(status) ? now : null));
  }

  public synchronized void status(Long userId, VideoGenerationDtos.TaskStatusResponse response) {
    if (response == null || response.getTaskId() == null) return;
    Path file = historyFile(userId, response.getTaskId());
    if (!Files.isRegularFile(file)) return;
    try {
      Snapshot previous = mapper.readValue(Files.readString(file), Snapshot.class);
      String status = normalizeStatus(response.getStatus());
      if (terminal(previous.status()) && !previous.status().equals(status)) return;
      long now = System.currentTimeMillis();
      save(new Snapshot(userId, previous.taskId(), previous.taskType(), previous.provider(), previous.model(),
          previous.prompt(), previous.resolution(), previous.durationSeconds(), status, response.getProgress(),
          safeUrls(response.getVideoUrls()), response.getError(), previous.createdAt(), now,
          previous.completedAt() != null ? previous.completedAt() : terminal(status) ? now : null));
    } catch (Exception error) { warn(file); }
  }

  public List<Snapshot> list(Long scopeUserId) {
    List<Snapshot> result = new ArrayList<>();
    scan(historyRoot, scopeUserId, "history", result);
    scan(enhanceRoot, scopeUserId, "enhance", result);
    scan(chatRoot, scopeUserId, "chat", result);
    return result;
  }

  public List<Snapshot> listForUsers(Set<Long> userIds) {
    List<Snapshot> result = new ArrayList<>();
    if (userIds == null || userIds.isEmpty()) return result;
    for (Long userId : userIds) {
      if (userId == null || userId < 1) continue;
      scan(historyRoot, userId, "history", result);
      scan(enhanceRoot, userId, "enhance", result);
      scan(chatRoot, userId, "chat", result);
    }
    return result;
  }

  private void scan(Path root, Long scope, String kind, List<Snapshot> result) {
    if (!Files.isDirectory(root)) return;
    if (scope != null) { scanUser(root.resolve(scope.toString()), scope, kind, result); return; }
    try (var directories = Files.list(root)) {
      for (Path directory : directories.filter(Files::isDirectory).toList()) {
        String id = directory.getFileName().toString();
        if (!id.matches("[1-9][0-9]*")) continue;
        try { scanUser(directory, Long.valueOf(id), kind, result); }
        catch (NumberFormatException ignored) { }
      }
    } catch (Exception error) { warn(root); }
  }

  private void scanUser(Path directory, Long userId, String kind, List<Snapshot> result) {
    if (!Files.isDirectory(directory)) return;
    try (var files = Files.list(directory)) {
      for (Path file : files.filter(p -> p.getFileName().toString().endsWith(".json")).toList()) {
        try {
          if ("history".equals(kind)) {
            Snapshot saved = mapper.readValue(Files.readString(file), Snapshot.class);
            if (userId.equals(saved.userId())) result.add(saved);
          } else {
            JsonNode saved = mapper.readTree(Files.readString(file));
            String status = normalizeStatus(saved.path("status").asText());
            if ("quoted".equals(status)) continue;
            long updated = Files.getLastModifiedTime(file).toMillis();
            boolean enhance = "enhance".equals(kind);
            JsonNode request = enhance ? saved.path("settings") : saved.path("request");
            String url = saved.path(enhance ? "resultUrl" : "url").asText("");
            String id = saved.path("id").asText("");
            if (id.isBlank()) continue;
            String resolution = request.path("resolution").asText("");
            Double duration = enhance ? saved.path("metadata").path("duration").asDouble(0)
                : request.path("durationSeconds").asDouble(0);
            result.add(new Snapshot(userId, (enhance ? "video-enhance:" : ChatVideoJobs.PREFIX) + id,
                enhance ? "VIDEO_ENHANCE" : "VIDEO", enhance ? "lingke" : "thq",
                enhance ? "video-enhance" : request.path("model").asText(ChatVideoClient.MODEL),
                enhance ? "视频超分 · " + resolution.toUpperCase(Locale.ROOT) + " · "
                    + ("professional".equals(request.path("toolVersion").asText()) ? "专业版" : "标准版")
                    : request.path("prompt").asText(""), resolution, duration,
                status, saved.path("progress").isNumber() ? saved.path("progress").asInt() : null,
                url.isBlank() ? List.of() : List.of(url), saved.path("error").asText(""),
                enhance ? saved.path("createdAt").asLong(0) : 0L, updated, terminal(status) ? updated : null));
          }
        } catch (Exception error) { warn(file); }
      }
    } catch (Exception error) { warn(directory); }
  }

  private Path historyFile(Long userId, String taskId) {
    String name = UUID.nameUUIDFromBytes(taskId.getBytes(StandardCharsets.UTF_8)).toString();
    return historyRoot.resolve(userId.toString()).resolve(name + ".json");
  }

  private void save(Snapshot snapshot) {
    Path file = historyFile(snapshot.userId(), snapshot.taskId());
    try {
      Files.createDirectories(file.getParent());
      Path temporary = Files.createTempFile(file.getParent(), ".video-history-", ".tmp");
      try {
        Files.writeString(temporary, mapper.writeValueAsString(snapshot));
        try { Files.move(temporary, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING); }
        catch (java.nio.file.AtomicMoveNotSupportedException error) {
          Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING);
        }
      } finally { Files.deleteIfExists(temporary); }
    } catch (Exception error) { warn(file); }
  }

  public static String normalizeStatus(String value) {
    String status = value == null ? "unknown" : value.trim().toLowerCase(Locale.ROOT);
    if (List.of("completed", "succeeded", "success", "done", "finished", "generated", "ready").contains(status)) return "completed";
    if (List.of("failed", "error", "cancelled", "canceled", "expired", "aborted").contains(status)) return "failed";
    return status.isBlank() ? "unknown" : status;
  }

  public static boolean terminal(String status) { return List.of("completed", "failed").contains(status); }
  private static List<String> safeUrls(List<String> urls) {
    return urls == null ? List.of() : urls.stream().filter(u -> u != null && !u.isBlank()).distinct().toList();
  }
  private void warn(Path path) {
    org.slf4j.LoggerFactory.getLogger(getClass()).warn("Cannot read/write video reporting snapshot {}", path.getFileName());
  }
}
