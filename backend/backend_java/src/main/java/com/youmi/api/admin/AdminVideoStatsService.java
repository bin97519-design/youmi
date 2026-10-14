package com.youmi.api.admin;

import com.youmi.api.common.ApiException;
import com.youmi.api.video.VideoTaskHistory;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class AdminVideoStatsService {
  public record Summary(long totalTasks, long completedTasks, long failedTasks, long processingTasks,
      long todayTasks, int totalVideos, BigDecimal totalMiCost) { }
  public record TaskRow(String taskId, Long userId, String userName, String taskType, String provider,
      String prompt, String model, String resolution, Double durationSeconds, String status,
      Integer progress, int videoCount, List<String> videoUrls, BigDecimal miCost, BigDecimal estimatedMi,
      String errorMessage, String createdAt, String updatedAt, String completedAt, String persistStatus) { }
  public record Daily(String day, long tasks, long failedTasks, int videos, BigDecimal miCost) { }
  public record Model(String model, long tasks, int videos, BigDecimal miCost) { }
  public record Trend(String key, String label, long totalTasks, List<Daily> daily) { }
  public record Response(Summary summary, List<TaskRow> tasks, List<Daily> daily, List<Model> models,
      List<AdminDtos.ProviderSuccessStat> providers, List<Trend> modelTrends, List<Trend> shopTrends,
      List<Trend> userTrends) { }
  record Ledger(long id, Long userId, String taskId, BigDecimal price, String status, long createdAt, long updatedAt) { }
  record Account(Long id, String account, String name, String shopKey, String shopName) { }
  record Entry(TaskRow task, long createdAt, String shopKey, String shopName, String userKey) { }
  private static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");
  private final JdbcTemplate jdbc;
  private final VideoTaskHistory history;

  public AdminVideoStatsService(JdbcTemplate jdbc, VideoTaskHistory history) {
    this.jdbc = jdbc;
    this.history = history;
  }

  public Response stats(Long scopeUserId, String taskType, String dateFrom, String dateTo) {
    if (!List.of("VIDEO", "VIDEO_ENHANCE").contains(taskType)) throw new ApiException(400, "任务类型无效");
    LocalDate from = parseDate(dateFrom);
    LocalDate to = parseDate(dateTo);
    if (from != null && to != null && from.isAfter(to)) throw new ApiException(400, "日期范围无效");
    List<Entry> entries = entries(scopeUserId).stream()
        .filter(e -> taskType.equals(e.task().taskType())).toList();
    LocalDate today = LocalDate.now(ZONE);
    long completed = entries.stream().filter(e -> "completed".equals(e.task().status())).count();
    long failed = entries.stream().filter(e -> "failed".equals(e.task().status())).count();
    Summary summary = new Summary(entries.size(), completed, failed, entries.size() - completed - failed,
        entries.stream().filter(e -> day(e.createdAt()).equals(today)).count(),
        entries.stream().mapToInt(e -> e.task().videoCount()).sum(),
        miCost(entries));
    List<Entry> recent = entries.stream().filter(e -> !day(e.createdAt()).isBefore(today.minusDays(13))).toList();
    List<TaskRow> tasks = entries.stream()
        .filter(e -> from == null || !day(e.createdAt()).isBefore(from))
        .filter(e -> to == null || !day(e.createdAt()).isAfter(to))
        .limit(500).map(Entry::task).toList();
    List<Model> models = group(entries, e -> e.task().model()).entrySet().stream()
        .map(p -> new Model(p.getKey(), p.getValue().size(),
            p.getValue().stream().mapToInt(e -> e.task().videoCount()).sum(),
            miCost(p.getValue())))
        .sorted(Comparator.comparingLong(Model::tasks).reversed()).toList();
    List<AdminDtos.ProviderSuccessStat> providers = group(entries, e -> e.task().provider()).entrySet().stream()
        .map(p -> {
          long success = p.getValue().stream().filter(e -> "completed".equals(e.task().status())).count();
          long failure = p.getValue().stream().filter(e -> "failed".equals(e.task().status())).count();
          long finished = success + failure;
          BigDecimal rate = finished == 0 ? null : BigDecimal.valueOf(success * 100)
              .divide(BigDecimal.valueOf(finished), 1, RoundingMode.HALF_UP);
          return new AdminDtos.ProviderSuccessStat(p.getKey(), (long) p.getValue().size(), success, failure, finished, rate);
        }).toList();
    return new Response(summary, tasks, daily(recent), models, providers,
        trends(recent, e -> e.task().model(), e -> e.task().model()),
        trends(recent, Entry::shopKey, Entry::shopName),
        trends(recent, Entry::userKey, e -> e.task().userName()));
  }

  public List<TaskRow> taskRows(Long scopeUserId, String taskType, String dateFrom, String dateTo,
      String status, String model) {
    if (taskType != null && !List.of("VIDEO", "VIDEO_ENHANCE").contains(taskType)) {
      throw new ApiException(400, "任务类型无效");
    }
    LocalDate from = parseDate(dateFrom);
    LocalDate to = parseDate(dateTo);
    if (from != null && to != null && from.isAfter(to)) throw new ApiException(400, "日期范围无效");
    return entries(scopeUserId).stream()
        .filter(e -> taskType == null || taskType.equals(e.task().taskType()))
        .filter(e -> from == null || !day(e.createdAt()).isBefore(from))
        .filter(e -> to == null || !day(e.createdAt()).isAfter(to))
        .map(Entry::task)
        .filter(t -> status == null || status.isBlank() || statusKey(status).equals(statusKey(t.status())))
        .filter(t -> model == null || model.isBlank() || model.equals(t.model()))
        .toList();
  }

  private List<Entry> entries(Long scopeUserId) {
    Map<Long, Account> accounts = accounts(scopeUserId);
    Map<String, Ledger> ledgers = new LinkedHashMap<>();
    for (Ledger ledger : ledgers(scopeUserId)) ledgers.put(key(ledger.userId(), ledger.taskId()), ledger);
    Map<String, VideoTaskHistory.Snapshot> snapshots = new LinkedHashMap<>();
    for (var snapshot : history.list(scopeUserId)) snapshots.put(key(snapshot.userId(), snapshot.taskId()), snapshot);
    List<Entry> entries = new ArrayList<>();
    for (var pair : ledgers.entrySet()) {
      Ledger ledger = pair.getValue();
      var snapshot = snapshots.remove(pair.getKey());
      String type = ledger.taskId().startsWith("video-enhance:") ? "VIDEO_ENHANCE" : "VIDEO";
      entries.add(entry(ledger, snapshot, accounts.get(ledger.userId()), type));
    }
    for (var snapshot : snapshots.values()) {
      entries.add(entry(null, snapshot, accounts.get(snapshot.userId()), snapshot.taskType()));
    }
    entries.sort(Comparator.comparingLong(Entry::createdAt).reversed());
    return entries;
  }

  private static String statusKey(String value) {
    return switch (value == null ? "" : value.trim().toUpperCase(Locale.ROOT)) {
      case "COMPLETED", "SUCCEEDED", "SUCCESS", "DONE" -> "COMPLETED";
      case "FAILED", "ERROR", "CANCELLED", "CANCELED" -> "FAILED";
      case "PENDING", "WAITING", "QUEUED", "SUBMITTED" -> "PENDING";
      case "PROCESSING", "RUNNING", "GENERATING", "IN_PROGRESS", "PERSISTING", "RESERVING", "SUBMITTING" -> "PROCESSING";
      default -> value == null ? "" : value.trim().toUpperCase(Locale.ROOT);
    };
  }

  private List<Ledger> ledgers(Long scope) {
    String sql = "SELECT id, user_id, task_id, price, status, created_at, updated_at FROM ym_mi_value_log"
        + " WHERE biz_type = 'VIDEO'" + (scope == null ? "" : " AND user_id = ?") + " ORDER BY id";
    return jdbc.query(sql, (rs, n) -> {
      long id = rs.getLong("id");
      String taskId = rs.getString("task_id");
      return new Ledger(id, rs.getLong("user_id"), taskId == null || taskId.isBlank() ? "video-charge:" + id : taskId,
          rs.getBigDecimal("price") == null ? BigDecimal.ZERO : rs.getBigDecimal("price"), rs.getString("status"), epoch(rs.getTimestamp("created_at")), epoch(rs.getTimestamp("updated_at")));
    }, scope == null ? new Object[]{} : new Object[]{scope});
  }

  private Map<Long, Account> accounts(Long scope) {
    String sql = """
        SELECT u.id, u.account, COALESCE(NULLIF(u.nickname, ''), u.account) AS user_name,
               s.id AS shop_id, s.name AS shop_name
        FROM ym_sys_user u LEFT JOIN ym_shop s ON s.id = u.shop_id
        """ + (scope == null ? "" : " WHERE u.id = ?");
    Map<Long, Account> result = new LinkedHashMap<>();
    jdbc.query(sql, (rs, n) -> {
      Long id = rs.getLong("id");
      String shop = rs.getString("shop_id");
      result.put(id, new Account(id, rs.getString("account"), rs.getString("user_name"),
          shop == null ? "unbound" : shop, shop == null ? "未绑定店铺" : rs.getString("shop_name")));
      return id;
    }, scope == null ? new Object[]{} : new Object[]{scope});
    return result;
  }

  private Entry entry(Ledger ledger, VideoTaskHistory.Snapshot saved, Account account, String type) {
    Long userId = saved == null ? ledger.userId() : saved.userId();
    String taskId = saved == null ? ledger.taskId() : saved.taskId();
    String status = saved == null ? "unknown" : saved.status();
    boolean rolledBack = ledger != null && List.of("ROLLBACK", "FAILED").contains(ledger.status());
    if (rolledBack && !"completed".equals(status)) status = "failed";
    long createdAt = saved != null && saved.createdAt() > 0 ? saved.createdAt() : ledger != null ? ledger.createdAt() : saved.updatedAt();
    long updatedAt = saved == null ? ledger.updatedAt() : saved.updatedAt();
    Long completedAt = saved == null ? rolledBack ? updatedAt : null : saved.completedAt();
    if (rolledBack && completedAt == null) completedAt = ledger.updatedAt();
    List<String> urls = saved == null || saved.videoUrls() == null || "failed".equals(status) ? List.of() : saved.videoUrls();
    String provider = saved == null ? inferredProvider(taskId) : AdminService.canonicalProvider(saved.provider());
    String model = saved == null ? inferredModel(taskId) : saved.model();
    String name = account == null ? "用户 #" + userId : account.name();
    TaskRow task = new TaskRow(taskId, userId, name, type, provider,
        saved == null ? "历史任务（未保存提示词）" : saved.prompt(), model,
        saved == null ? "" : saved.resolution(), saved == null ? null : saved.durationSeconds(), status,
        saved == null ? null : saved.progress(), "completed".equals(status) ? Math.max(1, urls.size()) : 0, urls,
        ledger != null && "SUCCESS".equals(ledger.status()) && !"failed".equals(status) ? ledger.price() : BigDecimal.ZERO,
        ledger == null ? BigDecimal.ZERO : ledger.price(), saved == null ? "" : saved.errorMessage(),
        time(createdAt), time(updatedAt), completedAt == null ? null : time(completedAt),
        "VIDEO_ENHANCE".equals(type) && !urls.isEmpty() && "completed".equals(status)
            ? "DONE" : "persisting".equals(status) ? "PENDING" : "");
    return new Entry(task, createdAt, account == null ? "unbound" : account.shopKey(),
        account == null ? "未绑定店铺" : account.shopName(), account == null ? "user-" + userId : account.account());
  }

  private static Map<String, List<Entry>> group(List<Entry> entries, Function<Entry, String> key) {
    Map<String, List<Entry>> grouped = new LinkedHashMap<>();
    for (Entry entry : entries) grouped.computeIfAbsent(key.apply(entry), ignored -> new ArrayList<>()).add(entry);
    return grouped;
  }
  private static List<Daily> daily(List<Entry> entries) {
    return group(entries, e -> day(e.createdAt()).toString()).entrySet().stream()
        .map(p -> new Daily(p.getKey(), p.getValue().size(),
            p.getValue().stream().filter(e -> "failed".equals(e.task().status())).count(),
            p.getValue().stream().mapToInt(e -> e.task().videoCount()).sum(),
            miCost(p.getValue())))
        .sorted(Comparator.comparing(Daily::day)).toList();
  }
  private static List<Trend> trends(List<Entry> entries, Function<Entry, String> key, Function<Entry, String> label) {
    return group(entries, key).entrySet().stream()
        .map(p -> new Trend(p.getKey(), label.apply(p.getValue().get(0)), p.getValue().size(), daily(p.getValue())))
        .sorted(Comparator.comparingLong(Trend::totalTasks).reversed()).toList();
  }
  private static BigDecimal miCost(List<Entry> entries) {
    return entries.stream().map(e -> e.task().miCost()).reduce(BigDecimal.ZERO, BigDecimal::add);
  }
  private static LocalDate parseDate(String value) {
    if (value == null || value.isBlank()) return null;
    try { return LocalDate.parse(value); }
    catch (Exception error) { throw new ApiException(400, "日期格式无效"); }
  }
  private static String key(Long userId, String taskId) { return userId + ":" + taskId; }
  private static long epoch(Timestamp value) { return value == null ? 0 : value.toLocalDateTime().atZone(ZONE).toInstant().toEpochMilli(); }
  private static LocalDate day(long value) { return Instant.ofEpochMilli(value).atZone(ZONE).toLocalDate(); }
  private static String time(long value) { return Instant.ofEpochMilli(value).atZone(ZONE).toLocalDateTime().toString(); }
  private static String inferredProvider(String id) {
    if (id.startsWith("anmiao-video:") || id.startsWith("minimax-h3:") || id.startsWith("video-enhance:")) return "lingke";
    return id.startsWith("thq-") ? "thq" : "unknown";
  }
  private static String inferredModel(String id) {
    if (id.startsWith("minimax-h3:")) return "MiniMax H3";
    if (id.startsWith("video-enhance:")) return "video-enhance";
    return "历史视频模型（未记录）";
  }
}
