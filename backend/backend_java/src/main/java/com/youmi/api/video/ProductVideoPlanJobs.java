package com.youmi.api.video;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import com.youmi.api.ai.GemAgentClient;
import jakarta.annotation.PreDestroy;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class ProductVideoPlanJobs {
  private static final Logger log = LoggerFactory.getLogger(ProductVideoPlanJobs.class);
  private final ProductVideoPlanService plans;
  private final ObjectMapper mapper;
  private final Path root;
  private final Map<Long, String> active = new ConcurrentHashMap<>();
  private final ThreadPoolExecutor executor = new ThreadPoolExecutor(
      2, 2, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(8));

  public record CreateRequest(String id, ProductVideoDtos.PlanRequest request) {}
  public record State(String id, String status, String stage, int count, String error,
      ProductVideoDtos.PlanResponse result, long updatedAt) {}
  record Saved(State state, ProductVideoDtos.PlanRequest request, JsonNode outline, Map<String, String> responses) {}

  public ProductVideoPlanJobs(ProductVideoPlanService plans, ObjectMapper mapper,
      @Value("${youmi.video-workflow.plan-work-dir:data/video-plans}") String workDir) {
    this.plans = plans;
    this.mapper = mapper;
    this.root = Path.of(workDir).toAbsolutePath().normalize();
  }

  @PreDestroy
  public void close() { executor.shutdownNow(); }

  public synchronized State create(Long userId, CreateRequest input) throws Exception {
    if (input == null) throw new ApiException(400, "缺少策划任务");
    Path file = file(userId, input.id());
    plans.validate(input.request());
    if (Files.isRegularFile(file)) {
      Saved existing = read(userId, input.id());
      if (!existing.request().equals(input.request())) throw new ApiException(409, "任务编号已用于其他策划");
      return get(userId, input.id());
    }
    var state = new State(input.id(), "queued", "等待策划", input.request().count(), "",
        new ProductVideoDtos.PlanResponse(GemAgentClient.MODEL.equals(input.request().planningModel()) ? "lk888" : "teamorouter",
            List.of(), null), System.currentTimeMillis());
    return schedule(userId, new Saved(state, input.request(), null, Map.of()));
  }

  public synchronized State get(Long userId, String id) throws Exception {
    Saved saved = read(userId, id);
    if (running(saved.state()) && !id.equals(active.get(userId))) {
      saved = withStatus(saved, "failed", "策划服务已重启，已完成部分已保留，请继续未完成分镜");
      write(userId, saved);
    }
    return saved.state();
  }

  public synchronized State retry(Long userId, String id) throws Exception {
    State current = get(userId, id);
    if (!"failed".equals(current.status())) return current;
    return schedule(userId, withStatus(read(userId, id), "queued", ""));
  }

  private State schedule(Long userId, Saved saved) throws Exception {
    String id = saved.state().id();
    if (active.putIfAbsent(userId, id) != null) throw new ApiException(409, "当前已有分镜策划正在进行，请等待完成");
    try {
      write(userId, saved);
      executor.execute(() -> run(userId, saved));
      return saved.state();
    } catch (Exception error) {
      active.remove(userId, id);
      write(userId, withStatus(saved, "failed", "策划队列繁忙，请稍后继续"));
      throw new ApiException(503, "策划队列繁忙，请稍后继续");
    }
  }

  private void run(Long userId, Saved initial) {
    String id = initial.state().id();
    try {
      var result = plans.plan(initial.request(), initial.outline(), initial.state().result().shots(),
          new ProductVideoPlanService.ProgressListener() {
          @Override public void save(String stage, JsonNode outline, List<ProductVideoDtos.ShotPlan> shots, String provider) throws Exception {
            var summary = outline == null ? null : new ProductVideoDtos.PlanSummary(
                outline.path("analysis").asText(), outline.path("concept").asText());
            write(userId, new Saved(new State(id, "processing", stage, initial.request().count(), "",
                new ProductVideoDtos.PlanResponse(provider, shots, summary), System.currentTimeMillis()),
                initial.request(), outline, read(userId, id).responses()));
          }
          @Override public void response(String stage, String content) throws Exception {
            Saved latest = read(userId, id);
            var responses = new java.util.LinkedHashMap<String, String>();
            if (latest.responses() != null) responses.putAll(latest.responses());
            responses.put(stage, content);
            write(userId, new Saved(latest.state(), latest.request(), latest.outline(), responses));
          }
          @Override public String previousResponse(String stage) {
            return initial.responses() == null ? null : initial.responses().get(stage);
          }
          });
      Saved latest = read(userId, id);
      finish(userId, new Saved(new State(id, "completed", ProductVideoPlanService.isWholeVideo(initial.request().productionMode())
          ? "整片策划已完成" : "分镜策划已完成", initial.request().count(), "",
          result, System.currentTimeMillis()), initial.request(), latest.outline(), latest.responses()));
      log.info("Product video plan job {} delivered {} shots", id, result.shots().size());
    } catch (Exception error) {
      log.warn("Product video plan job {} failed ({})", id, error.getClass().getSimpleName());
      String message = error instanceof ApiException ? error.getMessage() : "分镜响应未能完整解析，已完成部分已保留，可稍后继续";
      try { finish(userId, withStatus(read(userId, id), "failed", message)); }
      catch (Exception storageError) {
        active.remove(userId, id);
        log.error("Cannot save plan job {} failure", id, storageError);
      }
    }
  }

  private synchronized void finish(Long userId, Saved saved) throws Exception {
    write(userId, saved);
    active.remove(userId, saved.state().id());
  }

  private Saved withStatus(Saved saved, String status, String error) {
    var old = saved.state();
    return new Saved(new State(old.id(), status, old.stage(), old.count(), error, old.result(),
        System.currentTimeMillis()), saved.request(), saved.outline(), saved.responses());
  }

  private boolean running(State state) { return List.of("queued", "processing").contains(state.status()); }

  private Path file(Long userId, String id) {
    if (userId == null || id == null || !id.matches("[a-zA-Z0-9-]{10,80}")) throw new ApiException(404, "策划任务不存在");
    return root.resolve(userId.toString()).resolve(id + ".json");
  }

  private Saved read(Long userId, String id) throws Exception {
    Path path = file(userId, id);
    if (!Files.isRegularFile(path)) throw new ApiException(404, "策划任务不存在");
    return mapper.readValue(Files.readString(path), Saved.class);
  }

  private synchronized void write(Long userId, Saved saved) throws Exception {
    Path path = file(userId, saved.state().id());
    Files.createDirectories(path.getParent());
    Path temp = Files.createTempFile(path.getParent(), ".plan-", ".tmp");
    try {
      Files.writeString(temp, mapper.writeValueAsString(saved));
      try { Files.move(temp, path, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE); }
      catch (java.nio.file.AtomicMoveNotSupportedException error) { Files.move(temp, path, StandardCopyOption.REPLACE_EXISTING); }
    } finally { Files.deleteIfExists(temp); }
  }
}
