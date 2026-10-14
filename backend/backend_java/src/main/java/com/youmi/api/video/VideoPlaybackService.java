package com.youmi.api.video;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import com.youmi.api.file.OssStorageService;
import jakarta.annotation.PreDestroy;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class VideoPlaybackService {
  public record Result(String id, String status, String sourceUrl, String url,
      int width, int height, double duration, String error) {}
  record Metadata(double duration, int width, int height) {}
  private record Job(Long userId, String id) {}
  private final OssStorageService oss;
  private final ObjectMapper mapper;
  private final Path root;
  private final String ffmpeg;
  private final String ffprobe;
  private final Set<Job> active = ConcurrentHashMap.newKeySet();
  private final ThreadPoolExecutor workers = new ThreadPoolExecutor(
      2, 2, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(8));
  private static final long MAX_BYTES = 300L * 1024 * 1024;

  public VideoPlaybackService(OssStorageService oss, ObjectMapper mapper,
      @Value("${youmi.video-playback.work-dir:data/video-playback}") String workDir,
      @Value("${YOUMI_FFMPEG:ffmpeg}") String ffmpeg,
      @Value("${YOUMI_FFPROBE:ffprobe}") String ffprobe) {
    this.oss = oss;
    this.mapper = mapper;
    this.root = Path.of(workDir).toAbsolutePath().normalize();
    this.ffmpeg = ffmpeg;
    this.ffprobe = ffprobe;
  }

  @PreDestroy public void close() { workers.shutdownNow(); }

  public synchronized Result create(Long userId, String sourceUrl) throws Exception {
    String object = ownedObject(userId, sourceUrl);
    String id = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
        .digest(("h264-v1:" + object).getBytes(StandardCharsets.UTF_8)));
    Path state = directory(userId, id).resolve("state.json");
    if (Files.isRegularFile(state)) {
      Result saved = read(userId, id);
      if ("completed".equals(saved.status()) || active.contains(new Job(userId, id))) return saved;
    }
    var result = new Result(id, "queued", sourceUrl, "", 0, 0, 0, "");
    enqueue(userId, result);
    return result;
  }

  public synchronized Result get(Long userId, String id) throws Exception {
    Result result = read(userId, id);
    if (Set.of("queued", "processing").contains(result.status()) && !active.contains(new Job(userId, id)))
      enqueue(userId, result);
    return result;
  }

  private void enqueue(Long userId, Result result) throws Exception {
    Job job = new Job(userId, result.id());
    if (!active.add(job)) return;
    try {
      write(userId, result);
      workers.execute(() -> convert(userId, result));
    } catch (Exception error) {
      active.remove(job);
      write(userId, new Result(result.id(), "failed", result.sourceUrl(), "", 0, 0, 0, "播放转换队列繁忙，请稍后重试"));
      throw new ApiException(503, "播放转换队列繁忙，请稍后重试");
    }
  }

  String ownedObject(Long userId, String url) {
    if (userId == null || userId <= 0) throw new ApiException(401, "请先登录");
    try {
      URI uri = URI.create(url);
      if (!Set.of("http", "https").contains(uri.getScheme()) || uri.getUserInfo() != null || !oss.isOwnFileUrl(url))
        throw new ApiException(400, "播放转换仅支持当前账号已上传的视频");
      return oss.requireUserObject(userId, oss.objectNameFromFileUrl(url));
    } catch (ApiException error) { throw error; }
    catch (Exception error) { throw new ApiException(400, "请选择当前账号已上传的视频"); }
  }

  private void convert(Long userId, Result input) {
    Path dir = directory(userId, input.id());
    Path source = dir.resolve("source");
    Path output = dir.resolve("playable.mp4");
    try {
      write(userId, new Result(input.id(), "processing", input.sourceUrl(), "", 0, 0, 0, ""));
      String object = ownedObject(userId, input.sourceUrl());
      try (var stream = oss.openObjectStream(object)) { VideoEnhanceMedia.copyLimited(stream, source, MAX_BYTES); }
      metadata(probe(source));
      render(source, output);
      if (Files.size(output) > MAX_BYTES) throw new ApiException(400, "播放副本超过 300MB，原视频已保留");
      var size = metadata(probe(output));
      String target = "users/" + userId + "/video-playback/" + input.id() + ".mp4";
      oss.uploadLocalFile(output, target, "video/mp4");
      write(userId, new Result(input.id(), "completed", input.sourceUrl(), oss.getFileUrl(target),
          size.width(), size.height(), size.duration(), ""));
    } catch (Exception error) {
      String message = error instanceof ApiException ? error.getMessage() : "视频播放格式转换失败，原视频已保留，请重试";
      try { write(userId, new Result(input.id(), "failed", input.sourceUrl(), "", 0, 0, 0, message)); }
      catch (Exception ignored) { }
      org.slf4j.LoggerFactory.getLogger(getClass()).warn("Video playback conversion {} failed: {}", input.id(), error.getClass().getSimpleName());
    } finally {
      try { Files.deleteIfExists(source); Files.deleteIfExists(output); }
      catch (Exception ignored) { }
      active.remove(new Job(userId, input.id()));
    }
  }

  JsonNode probe(Path input) throws Exception {
    Path report = Files.createTempFile(input.getParent(), "probe-", ".json");
    Process process = null;
    try {
      process = new ProcessBuilder(ffprobe, "-v", "error", "-protocol_whitelist", "file,pipe",
          "-format_whitelist", "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,flv,mpegts,asf",
          "-select_streams", "v:0", "-show_entries", "stream=width,height,duration,codec_name:format=duration",
          "-of", "json", input.toString()).redirectOutput(report.toFile())
          .redirectError(ProcessBuilder.Redirect.DISCARD).start();
      if (!process.waitFor(30, TimeUnit.SECONDS) || process.exitValue() != 0)
        throw new ApiException(400, "无法读取视频画面，原视频已保留");
      return mapper.readTree(Files.readString(report));
    } finally {
      if (process != null && process.isAlive()) process.destroyForcibly();
      Files.deleteIfExists(report);
    }
  }

  static Metadata metadata(JsonNode json) {
    JsonNode video = json.path("streams").path(0);
    var data = new Metadata(json.path("format").path("duration").asDouble(video.path("duration").asDouble(0)),
        video.path("width").asInt(), video.path("height").asInt());
    if (!Double.isFinite(data.duration()) || data.duration() <= 0 || data.duration() > 600
        || data.width() < 2 || data.height() < 2 || data.width() > 8192 || data.height() > 8192)
      throw new ApiException(400, "播放转换最多支持 10 分钟、8K 以内的视频，原视频已保留");
    return data;
  }

  void render(Path source, Path output) throws Exception {
    Process process = null;
    try {
      process = new ProcessBuilder(ffmpeg, "-v", "error", "-nostdin", "-y", "-protocol_whitelist", "file,pipe",
          "-i", source.toString(), "-map", "0:v:0", "-map", "0:a:0?",
          "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-preset", "veryfast",
          "-crf", "18", "-pix_fmt", "yuv420p", "-threads", "2", "-c:a", "aac", "-b:a", "192k",
          "-movflags", "+faststart", output.toString()).redirectOutput(ProcessBuilder.Redirect.DISCARD)
          .redirectError(ProcessBuilder.Redirect.DISCARD).start();
      if (!process.waitFor(15, TimeUnit.MINUTES) || process.exitValue() != 0)
        throw new ApiException(400, "播放格式转换未完成，原视频已保留，请重试");
    } finally { if (process != null && process.isAlive()) process.destroyForcibly(); }
  }

  private Path directory(Long userId, String id) {
    if (userId == null || userId <= 0 || id == null || !id.matches("[0-9a-f]{64}"))
      throw new ApiException(404, "播放转换任务不存在");
    return root.resolve(userId.toString()).resolve(id);
  }

  private Result read(Long userId, String id) throws Exception {
    Path file = directory(userId, id).resolve("state.json");
    if (!Files.isRegularFile(file)) throw new ApiException(404, "播放转换任务不存在");
    return mapper.readValue(Files.readString(file), Result.class);
  }

  private void write(Long userId, Result result) throws Exception {
    Path dir = directory(userId, result.id());
    Files.createDirectories(dir);
    Path temp = Files.createTempFile(dir, "state-", ".tmp");
    try {
      Files.writeString(temp, mapper.writeValueAsString(result));
      try { Files.move(temp, dir.resolve("state.json"), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING); }
      catch (java.nio.file.AtomicMoveNotSupportedException error) {
        Files.move(temp, dir.resolve("state.json"), StandardCopyOption.REPLACE_EXISTING);
      }
    } finally { Files.deleteIfExists(temp); }
  }
}
