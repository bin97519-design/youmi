package com.youmi.api.video;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import com.youmi.api.credit.MiBizType;
import com.youmi.api.credit.MiValueService;
import jakarta.annotation.PreDestroy;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.math.BigDecimal;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/** Persist 30-second video submissions and poll accepted tasks without repeating generation. */
@Service
public class ChatVideoJobs {
  public static final String PREFIX = "thq-chat-video:";
  private final ChatVideoClient client;
  private final VideoGenerationClient media;
  private final VideoGenerationProperties config;
  private final MiValueService billing;
  private final ObjectMapper mapper;
  private final Path root;
  private final Set<String> active = ConcurrentHashMap.newKeySet();
  private final ThreadPoolExecutor executor = new ThreadPoolExecutor(2, 2, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(8));
  record Saved(String id, VideoGenerationDtos.CreateTaskRequest request, String status, String raw,
      String url, String error, BigDecimal price, ChatVideoClient.ProviderFailure failure) {
    Saved(String id, VideoGenerationDtos.CreateTaskRequest request, String status, String raw,
        String url, String error, BigDecimal price) {
      this(id, request, status, raw, url, error, price, null);
    }

    Saved(String id, VideoGenerationDtos.CreateTaskRequest request, String status, String raw,
        String url, String error, int price) {
      this(id, request, status, raw, url, error, BigDecimal.valueOf(price).setScale(2), null);
    }
  }

  public ChatVideoJobs(ChatVideoClient client, VideoGenerationClient media, VideoGenerationProperties config,
      MiValueService billing, ObjectMapper mapper,
      @Value("${youmi.video-workflow.chat-work-dir:data/chat-video-tasks}") String directory) {
    this.client = client;
    this.media = media;
    this.config = config;
    this.billing = billing;
    this.mapper = mapper;
    root = Path.of(directory).toAbsolutePath().normalize();
  }

  @PreDestroy public void close() { executor.shutdownNow(); }

  public synchronized VideoGenerationDtos.CreateTaskResponse create(Long userId, VideoGenerationDtos.CreateTaskRequest request) throws Exception {
    client.validate(request);
    String id = UUID.nameUUIDFromBytes((userId + ":" + request.clientTaskId()).getBytes(StandardCharsets.UTF_8)).toString();
    if (Files.isRegularFile(file(userId, id))) {
      Saved previous = read(userId, id);
      if (!previous.request().equals(request)) throw new ApiException(409, "任务编号已用于其他视频，不可重复提交");
      return created(previous);
    }
    client.checkAccess();
    var charge = billing.checkAndDeduct(userId, MiBizType.VIDEO);
    Saved saved = new Saved(id, request, "queued", "", "", "", charge.price());
    try {
      billing.linkTask(charge.logId(), PREFIX + id);
      write(userId, saved);
      schedule(userId, saved);
      return created(saved);
    } catch (Exception error) {
      billing.rollback(userId, charge.logId());
      if (Files.isRegularFile(file(userId, id))) write(userId, withStatus(saved, "failed", "生成队列繁忙，未提交到中转站"));
      throw error;
    }
  }

  public synchronized VideoGenerationDtos.TaskStatusResponse get(Long userId, String taskId) throws Exception {
    if (taskId == null || !taskId.startsWith(PREFIX)) throw new ApiException(404, "视频任务不存在");
    Saved saved = read(userId, taskId.substring(PREFIX.length()));
    if (List.of("queued", "processing", "persisting").contains(saved.status()) && !active.contains(saved.id())) {
      if (!saved.raw().isBlank()) schedule(userId, saved);
      else {
        saved = withStatus(saved, "failed", "视频服务曾中断，尚未收到成片。请核对中转站记录后再决定是否重试，系统不会重复提交");
        write(userId, saved);
        billing.rollbackByTaskId(taskId);
      }
    }
    var result = new VideoGenerationDtos.TaskStatusResponse();
    result.setTaskId(taskId);
    result.setProvider("thq");
    result.setStatus(saved.status());
    result.setProgress("completed".equals(saved.status()) ? 100 : null);
    result.setStage(switch (saved.status()) {
      case "queued" -> "等待提交";
      case "processing" -> "正在提交到中转站";
      case "persisting" -> "正在保存视频";
      case "completed" -> "已完成";
      case "failed" -> "生成失败";
      default -> "等待确认任务状态";
    });
    if (!saved.raw().isBlank() && List.of("queued", "processing").contains(saved.status())) {
      try {
        var state = client.taskState(saved.raw());
        result.setProgress(state.progress());
        result.setStage(state.pending()
            ? "queued".equals(state.status()) ? "中转站排队中" : "中转站生成中"
            : "正在保存视频");
      }
      catch (Exception ignored) { }
    }
    result.setVideoUrls(saved.url().isBlank() ? List.of() : List.of(saved.url()));
    result.setError(saved.error().isBlank() ? null : saved.error());
    return result;
  }

  private void schedule(Long userId, Saved saved) {
    if (!active.add(saved.id())) return;
    try { executor.execute(() -> run(userId, saved)); }
    catch (java.util.concurrent.RejectedExecutionException error) {
      active.remove(saved.id());
      throw new ApiException(503, "30 秒视频生成队列繁忙，请稍后再试");
    }
  }

  private void run(Long userId, Saved initial) {
    Saved latest = initial;
    try {
      if (latest.raw().isBlank()) {
        write(userId, withStatus(latest, "processing", ""));
        String raw = client.generate(latest.request());
        latest = new Saved(latest.id(), latest.request(), "processing", raw, "", "", latest.price());
        write(userId, latest);
      }
      var state = client.taskState(latest.raw());
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(Math.max(30, config.getChatTimeoutSeconds()));
      while (state.pending()) {
        if (state.id().isBlank()) throw new ApiException(502, "中转站未返回视频任务编号，请核对记录，勿重复提交");
        latest = withStatus(latest, state.status(), "");
        write(userId, latest);
        // Keep the accepted task resumable; reaching this polling window never resubmits or refunds it.
        if (System.nanoTime() >= deadline) return;
        String raw = client.poll(state.id());
        latest = new Saved(latest.id(), latest.request(), "processing", raw, "", "", latest.price());
        write(userId, latest);
        state = client.taskState(raw);
        if (state.pending()) TimeUnit.SECONDS.sleep(3);
      }
      latest = withStatus(latest, "persisting", "");
      write(userId, latest);
      String url = client.resultUrl(latest.raw());
      if (config.isPersistGeneratedVideos()) url = client.persistVideo(PREFIX + latest.id(), latest.id(), url, userId);
      latest = new Saved(latest.id(), latest.request(), "completed", latest.raw(), url, "", latest.price());
      write(userId, latest);
    } catch (Exception error) {
      if (!latest.raw().isBlank() && (error instanceof InterruptedException || error instanceof java.io.IOException
          || error instanceof ChatVideoClient.ProviderException provider && "查询视频".equals(provider.details().phase()))) {
        // A lost status/download response is not a failed generation. Resume only GET/download operations.
        latest = withStatus(latest, latest.status(), "视频查询或保存暂时中断，将继续查询原任务，不会重复提交");
        try { write(userId, latest); }
        catch (Exception storageError) { org.slf4j.LoggerFactory.getLogger(getClass()).error("Cannot save video task {}", latest.id()); }
        if (error instanceof InterruptedException) Thread.currentThread().interrupt();
        return;
      }
      String message = error instanceof ApiException ? error.getMessage()
          : "30 秒视频响应中断或成片保存失败，已收到的响应会保留。请核对中转站记录，勿重复提交";
      latest = error instanceof ChatVideoClient.ProviderException provider
          ? new Saved(latest.id(), latest.request(), "failed", provider.responseBody(), "", message,
              latest.price(), provider.details())
          : withStatus(latest, "failed", message);
      try { write(userId, latest); }
      catch (Exception storageError) { org.slf4j.LoggerFactory.getLogger(getClass()).error("Cannot save chat video task {}", latest.id()); }
    } finally { active.remove(initial.id()); }
    // Reconcile even when the browser has been closed. Polling can safely retry this accounting step.
    try {
      if ("completed".equals(latest.status())) billing.commitByTaskId(PREFIX + latest.id());
      else if ("failed".equals(latest.status())) billing.rollbackByTaskId(PREFIX + latest.id());
    } catch (Exception error) {
      org.slf4j.LoggerFactory.getLogger(getClass()).warn("Chat video accounting pending for {}", latest.id());
    }
  }

  private Saved withStatus(Saved saved, String status, String error) {
    return new Saved(saved.id(), saved.request(), status, saved.raw(), saved.url(), error, saved.price(), saved.failure());
  }

  private VideoGenerationDtos.CreateTaskResponse created(Saved saved) {
    var result = new VideoGenerationDtos.CreateTaskResponse();
    result.setTaskId(PREFIX + saved.id());
    result.setProvider("thq");
    result.setModel(ChatVideoClient.MODEL);
    result.setStatus(saved.status());
    result.setConsumedMi(saved.price());
    return result;
  }

  private Path file(Long userId, String id) {
    if (userId == null || userId <= 0 || id == null || !id.matches("[0-9a-f-]{36}")) throw new ApiException(404, "视频任务不存在");
    return root.resolve(userId.toString()).resolve(id + ".json");
  }

  private Saved read(Long userId, String id) throws Exception {
    Path file = file(userId, id);
    if (!Files.isRegularFile(file)) throw new ApiException(404, "视频任务不存在");
    return mapper.readValue(Files.readString(file), Saved.class);
  }

  private synchronized void write(Long userId, Saved saved) throws Exception {
    Path file = file(userId, saved.id());
    Files.createDirectories(file.getParent());
    Path temporary = Files.createTempFile(file.getParent(), ".chat-video-", ".tmp");
    try {
      Files.writeString(temporary, mapper.writeValueAsString(saved));
      try { Files.move(temporary, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING); }
      catch (java.nio.file.AtomicMoveNotSupportedException error) { Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING); }
    } finally { Files.deleteIfExists(temporary); }
  }
}
