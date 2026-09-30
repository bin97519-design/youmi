package com.youmi.api.video;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import com.youmi.api.credit.MiBizType;
import com.youmi.api.credit.MiValueService;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import static com.youmi.api.video.VideoEnhanceDtos.*;

@Service
public class VideoEnhanceJobs {
  static final String PREFIX = "video-enhance:";
  private final VideoEnhanceClient client;
  private final VideoEnhanceMedia media;
  private final VideoEnhanceProperties config;
  private final MiValueService billing;
  private final ObjectMapper mapper;
  private final Path root;
  private final ScheduledExecutorService workers = Executors.newScheduledThreadPool(2);
  private final Set<String> active = ConcurrentHashMap.newKeySet();
  public VideoEnhanceJobs(VideoEnhanceClient client, VideoEnhanceMedia media, VideoEnhanceProperties config,
      MiValueService billing, ObjectMapper mapper, @Value("${youmi.video-enhance.work-dir:data/video-enhance}") String dir) {
    this.client = client; this.media = media; this.config = config; this.billing = billing; this.mapper = mapper;
    root = Path.of(dir).toAbsolutePath().normalize();
  }
  @PostConstruct void recover() {
    workers.execute(() -> {
      if (!Files.isDirectory(root)) return;
      try (var users = Files.list(root)) {
        for (Path directory : users.filter(Files::isDirectory).toList()) {
          if (!directory.getFileName().toString().matches("[1-9][0-9]*")) continue;
          Long userId = Long.valueOf(directory.getFileName().toString());
          for (Task task : listSaved(userId)) {
            if (Set.of("reserving", "submitting").contains(task.status())) {
              task = task.state("unknown", "", null, "提交结果待核对", "服务在提交期间中断，请核对中转站记录；系统不会重复提交", "", "");
              write(userId, task);
            }
            if (pollable(task)) schedule(userId, task.id());
            reconcile(task);
          }
        }
      } catch (Exception error) { log("Cannot recover enhancement tasks"); }
    });
    workers.scheduleWithFixedDelay(this::cleanupQuotes, 1, 5, TimeUnit.MINUTES);
  }
  @PreDestroy public void close() { workers.shutdownNow(); }
  public boolean available() { return config.configured() && media.available(); }
  public synchronized Task quote(Long userId, QuoteRequest request) throws Exception {
    client.requireConfigured();
    if (!media.available()) throw new ApiException(503, "视频检查或素材存储服务尚未就绪");
    if (request == null || request.settings() == null) throw new ApiException(400, "请选择视频和超分参数");
    request.settings().validate();
    String source = media.ownedObject(userId, request.sourceUrl());
    long now = System.currentTimeMillis();
    long pending = listSaved(userId).stream().filter(t -> !Set.of("completed", "failed").contains(t.status())
        && !("quoted".equals(t.status()) && t.expiresAt() < now)).count();
    if (pending >= 3) throw new ApiException(429, "最多同时准备或处理 3 个超分任务，请等待任务完成或报价过期");
    String id = UUID.randomUUID().toString();
    Path sourceFile = source(userId, id);
    try {
      Metadata metadata = media.inspect(source, sourceFile);
      metadata.validate();
      Task task = new Task(id, source, request.settings(), metadata, request.settings().price(metadata.duration(), config.getBaseMiPerSecond()),
          now, now + TimeUnit.MINUTES.toMillis(15), "quoted", "", null, "待确认", "", "", "");
      write(userId, task);
      return task;
    } catch (Exception error) { Files.deleteIfExists(sourceFile); throw error; }
  }
  public synchronized Task create(Long userId, String id) throws Exception {
    Task task = read(userId, id);
    if (!"quoted".equals(task.status())) return task;
    client.requireConfigured();
    if (task.expiresAt() < System.currentTimeMillis() || !Files.isRegularFile(source(userId, id))) throw new ApiException(409, "报价已过期，请重新核算");
    write(userId, task.state("reserving", "", null, "准备源视频", "", "", ""));
    boolean submitted = false;
    Long chargeId = null;
    try {
      String sourceUrl = media.publishSource(userId, task, source(userId, id));
      var charge = billing.checkAndDeduct(userId, MiBizType.VIDEO, task.price());
      chargeId = charge.logId();
      billing.linkTask(chargeId, PREFIX + id);
      task = task.state("submitting", "", null, "正在提交", "", "", "");
      write(userId, task);
      submitted = true;
      String providerId = client.create(sourceUrl, task.settings());
      task = task.state("pending", providerId, null, "中转站排队中", "", "", "");
      write(userId, task);
      schedule(userId, id);
      return task;
    } catch (Exception error) {
      boolean knownFailure = !submitted || error instanceof VideoEnhanceClient.Rejected;
      Task state = task.state(knownFailure ? "failed" : "unknown", task.providerTaskId(), null,
          knownFailure ? "未成功提交" : "提交结果待核对", knownFailure ? error instanceof VideoEnhanceClient.Rejected
              ? error.getMessage() + "；未计入消费" : "视频超分未成功提交，未计入消费。请核对服务配置或中转站记录"
              : "尚未确认提交结果，请核对中转站记录；系统不会重复提交", "", "");
      write(userId, state);
      if (knownFailure) {
        if (chargeId != null) billing.rollback(userId, chargeId);
        removeSnapshot(userId, state);
      }
      return state;
    } finally { Files.deleteIfExists(source(userId, id)); }
  }
  public Task get(Long userId, String id) throws Exception {
    Task task = read(userId, id);
    if (pollable(task)) schedule(userId, id);
    reconcile(task);
    return task;
  }
  public synchronized void discardQuote(Long userId, String id) throws Exception {
    Task task = read(userId, id);
    if (!"quoted".equals(task.status())) return;
    Files.deleteIfExists(source(userId, id));
    Files.deleteIfExists(file(userId, id));
  }
  public List<Task> list(Long userId, String url) throws Exception {
    String source = media.ownedObject(userId, url);
    var result = listSaved(userId).stream().filter(t -> t.sourceObject().equals(source) && !"quoted".equals(t.status()))
        .sorted(Comparator.comparingLong(Task::createdAt).reversed()).limit(30).toList();
    for (Task task : result) { if (pollable(task)) schedule(userId, task.id()); reconcile(task); }
    return result;
  }
  private boolean pollable(Task task) { return !task.providerTaskId().isBlank() && Set.of("pending", "running", "persisting").contains(task.status()); }
  private void schedule(Long userId, String id) {
    String key = userId + ":" + id;
    if (workers.isShutdown() || !active.add(key)) return;
    workers.schedule(() -> {
      boolean again = false;
      try { again = pollOnce(userId, id); }
      catch (Exception error) { again = true; log("Enhancement polling will resume for " + id); }
      finally { active.remove(key); }
      if (again) schedule(userId, id);
    }, 4, TimeUnit.SECONDS);
  }
  boolean pollOnce(Long userId, String id) throws Exception {
    Task task = read(userId, id);
    if (!pollable(task)) { reconcile(task); return false; }
    try {
      if (!"persisting".equals(task.status())) {
        var state = client.poll(task.providerTaskId());
        if (!state.terminal()) {
          task = task.state("pending".equals(state.state()) ? "pending" : "running", task.providerTaskId(), state.progress(), state.stage(), "", "", "");
          write(userId, task);
          return true;
        }
        if ("failed".equals(state.state())) {
          task = task.state("failed", task.providerTaskId(), state.progress(), "超分失败", state.error().isBlank() ? "中转站处理失败，未计入消费" : state.error(), "", "");
          write(userId, task);
          reconcile(task);
          removeSnapshot(userId, task);
          return false;
        }
        task = task.state("persisting", task.providerTaskId(), state.progress(), "正在保存超分视频", "", "", state.url());
        write(userId, task);
      }
      String url = media.persist(userId, task, root.resolve(userId.toString()).resolve(id + ".output"));
      task = task.state("completed", task.providerTaskId(), 100, "已完成", "", url, task.providerResultUrl());
      write(userId, task);
      reconcile(task);
      removeSnapshot(userId, task);
      return false;
    } catch (Exception error) {
      if (Set.of("completed", "failed").contains(task.status())) throw error;
      write(userId, task.state(task.status(), task.providerTaskId(), task.progress(), task.stage(),
          (error instanceof ApiException ? error.getMessage() + "；" : "")
              + "查询或保存暂时中断，将继续处理原任务，不会重复提交", task.resultUrl(), task.providerResultUrl()));
      return true;
    }
  }
  private void reconcile(Task task) {
    if ("completed".equals(task.status())) billing.commitByTaskId(PREFIX + task.id());
    if ("failed".equals(task.status())) billing.rollbackByTaskId(PREFIX + task.id());
  }
  private void removeSnapshot(Long userId, Task task) {
    try { media.removeSnapshot(userId, task); } catch (Exception error) { log("Cannot remove enhancement input snapshot " + task.id()); }
  }
  private Path file(Long userId, String id) {
    if (userId == null || userId <= 0 || id == null || !id.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")) throw new ApiException(404, "超分任务不存在");
    return root.resolve(userId.toString()).resolve(id + ".json");
  }
  private Path source(Long userId, String id) { return file(userId, id).resolveSibling(id + ".source"); }
  private Task read(Long userId, String id) throws Exception {
    Path file = file(userId, id);
    if (!Files.isRegularFile(file)) throw new ApiException(404, "超分任务不存在");
    return mapper.readValue(Files.readString(file), Task.class);
  }
  private void write(Long userId, Task task) throws Exception {
    Path file = file(userId, task.id());
    Files.createDirectories(file.getParent());
    Path temp = Files.createTempFile(file.getParent(), "enhance-", ".tmp");
    try {
      Files.writeString(temp, mapper.writeValueAsString(task));
      try { Files.move(temp, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING); }
      catch (java.nio.file.AtomicMoveNotSupportedException error) { Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING); }
    } finally { Files.deleteIfExists(temp); }
  }
  private List<Task> listSaved(Long userId) throws Exception {
    if (userId == null || userId <= 0) throw new ApiException(401, "请先登录");
    Path directory = root.resolve(userId.toString());
    if (!Files.isDirectory(directory)) return List.of();
    List<Task> tasks = new ArrayList<>();
    try (var files = Files.list(directory)) {
      for (Path file : files.filter(p -> p.getFileName().toString().endsWith(".json")).toList()) {
        try { tasks.add(mapper.readValue(Files.readString(file), Task.class)); }
        catch (Exception error) { log("Cannot read enhancement task " + file.getFileName()); }
      }
    }
    return tasks;
  }
  private synchronized void cleanupQuotes() {
    if (!Files.isDirectory(root)) return;
    try (var users = Files.list(root)) {
      for (Path directory : users.filter(Files::isDirectory).toList()) {
        if (!directory.getFileName().toString().matches("[1-9][0-9]*")) continue;
        Long userId = Long.valueOf(directory.getFileName().toString());
        for (Task task : listSaved(userId)) if ("quoted".equals(task.status()) && task.expiresAt() < System.currentTimeMillis()) {
          Files.deleteIfExists(source(userId, task.id()));
          Files.deleteIfExists(file(userId, task.id()));
        }
      }
    } catch (Exception error) { log("Cannot clean expired enhancement quotes"); }
  }
  private void log(String message) { org.slf4j.LoggerFactory.getLogger(getClass()).warn(message); }
}
