package com.youmi.api.video;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import com.youmi.api.file.OssStorageService;
import jakarta.annotation.PreDestroy;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class VideoCompositionService {
  private final OssStorageService oss;
  private final ObjectMapper mapper;
  private final Path root;
  private final String ffmpeg;
  private final String ffprobe;
  private final Map<Long, String> active = new ConcurrentHashMap<>();
  private final ThreadPoolExecutor executor = new ThreadPoolExecutor(
      2, 2, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(8));
  private static final long MAX_BYTES = 150L * 1024 * 1024;

  public VideoCompositionService(OssStorageService oss, ObjectMapper mapper,
      @Value("${youmi.video-workflow.work-dir:data/video-compositions}") String workDir,
      @Value("${YOUMI_FFMPEG:ffmpeg}") String ffmpeg,
      @Value("${YOUMI_FFPROBE:ffprobe}") String ffprobe) {
    this.oss = oss;
    this.mapper = mapper;
    this.root = Path.of(workDir).toAbsolutePath().normalize();
    this.ffmpeg = ffmpeg;
    this.ffprobe = ffprobe;
  }

  @PreDestroy
  public void close() { executor.shutdownNow(); }

  public boolean available() {
    return oss.isConfigured() && executable(ffmpeg) && executable(ffprobe);
  }

  private boolean executable(String binary) {
    Process process = null;
    try {
      process = new ProcessBuilder(binary, "-version").redirectOutput(ProcessBuilder.Redirect.DISCARD)
          .redirectError(ProcessBuilder.Redirect.DISCARD).start();
      return process.waitFor(3, TimeUnit.SECONDS) && process.exitValue() == 0;
    } catch (Exception ignored) { return false; }
    finally { if (process != null && process.isAlive()) process.destroyForcibly(); }
  }

  public ProductVideoDtos.Composition create(Long userId, ProductVideoDtos.ComposeRequest request) throws Exception {
    validate(request);
    for (var clip : request.clips()) ownedObject(userId, clip.url());
    if (request.musicUrl() != null && !request.musicUrl().isBlank()) ownedObject(userId, request.musicUrl());
    if (!available()) throw new ApiException(503, "成片服务未就绪，请配置 FFmpeg、FFprobe 和素材存储");
    String id = UUID.randomUUID().toString();
    if (active.putIfAbsent(userId, id) != null) throw new ApiException(409, "当前已有成片正在合成，请等待完成");
    var state = new ProductVideoDtos.Composition(id, "queued", 0, "", "");
    try {
      write(userId, state);
      executor.execute(() -> compose(userId, id, request));
    } catch (Exception error) {
      active.remove(userId, id);
      write(userId, new ProductVideoDtos.Composition(id, "failed", 0, "", "合成队列繁忙，请稍后再试"));
      throw new ApiException(503, "合成队列繁忙，请稍后再试");
    }
    return state;
  }

  public ProductVideoDtos.Composition get(Long userId, String id) throws Exception {
    Path file = directory(userId, id).resolve("state.json");
    if (!Files.isRegularFile(file)) throw new ApiException(404, "成片任务不存在");
    var state = mapper.readValue(Files.readString(file), ProductVideoDtos.Composition.class);
    if (List.of("queued", "processing").contains(state.status()) && !id.equals(active.get(userId))) {
      state = new ProductVideoDtos.Composition(id, "failed", state.progress(), "", "合成服务已重启，请重新合成，原始片段已保留");
      write(userId, state);
    }
    return state;
  }

  String ownedObject(Long userId, String url) {
    try {
      URI uri = URI.create(url);
      if (!List.of("https", "http").contains(uri.getScheme()) || uri.getUserInfo() != null
          || !oss.isOwnFileUrl(url)) throw new IllegalArgumentException();
      return oss.requireUserObject(userId, uri.getPath());
    } catch (Exception error) {
      throw new ApiException(400, "合成仅支持当前账号素材空间中的视频和音频，请先上传或转存素材");
    }
  }

  static void validate(ProductVideoDtos.ComposeRequest request) {
    if (request == null || request.clips() == null || request.clips().isEmpty() || request.clips().size() > 48) {
      throw new ApiException(400, "成片需要 1 至 48 个片段");
    }
    dimensions(request.ratio());
    if (!Double.isFinite(request.musicVolume()) || request.musicVolume() < 0 || request.musicVolume() > 1) {
      throw new ApiException(400, "音乐音量需在 0 至 1 之间");
    }
    for (var clip : request.clips()) {
      if (clip == null || !Double.isFinite(clip.start()) || !Double.isFinite(clip.duration())
          || clip.start() < 0 || clip.start() > 600 || clip.duration() < 0.5 || clip.duration() > 30
          || (clip.caption() != null && clip.caption().length() > 120)) {
        throw new ApiException(400, "裁剪范围无效，每个片段 0.5 至 30 秒，字幕最多 120 字");
      }
      if (clip.timingMode() != null && !List.of("trim", "speed").contains(clip.timingMode())) {
        throw new ApiException(400, "不支持的片段处理方式");
      }
      if ("speed".equals(clip.timingMode()) && clip.start() != 0) {
        throw new ApiException(400, "整段加速需从原片开头开始");
      }
    }
    if (request.clips().stream().mapToDouble(ProductVideoDtos.Clip::duration).sum() > 300)
      throw new ApiException(400, "单次合成总时长不能超过 5 分钟");
  }

  static int[] dimensions(String ratio) {
    return switch (ratio == null ? "" : ratio) {
      case "16:9" -> new int[]{1280, 720};
      case "9:16" -> new int[]{720, 1280};
      case "1:1" -> new int[]{720, 720};
      case "3:4" -> new int[]{720, 960};
      case "4:3" -> new int[]{960, 720};
      case "21:9" -> new int[]{1680, 720};
      default -> throw new ApiException(400, "不支持的成片比例");
    };
  }

  private void compose(Long userId, String id, ProductVideoDtos.ComposeRequest request) {
    Path dir = directory(userId, id);
    try {
      write(userId, new ProductVideoDtos.Composition(id, "processing", 5, "", ""));
      List<Path> sources = new ArrayList<>();
      for (int i = 0; i < request.clips().size(); i++) {
        Path input = dir.resolve("source-" + i + ".mp4");
        download(userId, request.clips().get(i).url(), input);
        sources.add(input);
      }
      Path music = null;
      if (request.musicUrl() != null && !request.musicUrl().isBlank()) {
        music = dir.resolve("music-input");
        download(userId, request.musicUrl(), music);
      }
      write(userId, new ProductVideoDtos.Composition(id, "processing", 30, "", ""));
      Path output = renderLocal(request, sources, music, dir);
      write(userId, new ProductVideoDtos.Composition(id, "processing", 90, "", ""));
      String object = oss.scopeUserDir(userId, "product-videos") + "/" + id + ".mp4";
      if (Files.size(output) > MAX_BYTES) throw new ApiException(400, "成片文件过大，请减少片段时长");
      try (InputStream input = Files.newInputStream(output)) { oss.uploadStream(input, object, "video/mp4"); }
      write(userId, new ProductVideoDtos.Composition(id, "completed", 100, oss.getFileUrl(object), ""));
    } catch (Exception error) {
      String message = error instanceof ApiException ? error.getMessage() : "合成失败，请检查视频素材或服务日志后重试";
      org.slf4j.LoggerFactory.getLogger(getClass()).warn("Video composition {} failed", id, error);
      try { write(userId, new ProductVideoDtos.Composition(id, "failed", 0, "", message)); }
      catch (Exception ignored) { }
    } finally {
      active.remove(userId, id);
      try (var files = Files.list(dir)) {
        files.filter(path -> !path.getFileName().toString().equals("state.json"))
            .forEach(path -> { try { Files.deleteIfExists(path); } catch (Exception ignored) { } });
      } catch (Exception ignored) { }
    }
  }

  private void download(Long userId, String url, Path target) throws Exception {
    try (InputStream input = oss.openObjectStream(ownedObject(userId, url)); var output = Files.newOutputStream(target)) {
      byte[] buffer = new byte[65536];
      long size = 0;
      for (int read; (read = input.read(buffer)) != -1;) {
        size += read;
        if (size > MAX_BYTES) throw new ApiException(400, "单个素材不能超过 150MB");
        output.write(buffer, 0, read);
      }
    }
  }

  Path renderLocal(ProductVideoDtos.ComposeRequest request, List<Path> sources, Path music, Path dir) throws Exception {
    int[] size = dimensions(request.ratio());
    StringBuilder manifest = new StringBuilder();
    for (int i = 0; i < sources.size(); i++) {
      var clip = request.clips().get(i);
      Path probe = dir.resolve("probe-" + i + ".json");
      run(List.of(ffprobe, "-v", "error", "-protocol_whitelist", "file,pipe", "-format_whitelist",
          "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi",
          "-show_entries", "stream=codec_type,duration:format=duration", "-of", "json",
          sources.get(i).toString()), dir, probe, 30);
      var metadata = mapper.readTree(Files.readString(probe));
      double duration = 0;
      boolean hasAudio = false;
      boolean hasVideo = false;
      for (var stream : metadata.path("streams")) {
        if ("audio".equals(stream.path("codec_type").asText())) hasAudio = true;
        if (!hasVideo && "video".equals(stream.path("codec_type").asText())) {
          duration = stream.path("duration").asDouble(0);
          hasVideo = true;
        }
      }
      if (!hasVideo) throw new ApiException(400, "镜头 " + (i + 1) + " 缺少视频画面");
      if (duration <= 0) duration = metadata.path("format").path("duration").asDouble(0);
      if (!Double.isFinite(duration) || duration <= 0) throw new ApiException(400, "无法读取镜头 " + (i + 1) + " 的视频时长");
      boolean speed = "speed".equals(clip.timingMode());
      if (speed && clip.duration() > duration + 0.05) throw new ApiException(400, "镜头 " + (i + 1) + " 的加速目标时长不能超过原片时长");
      if (!speed && clip.start() + clip.duration() > duration + 0.05) throw new ApiException(400, "镜头 " + (i + 1) + " 的裁剪范围超过素材实际时长");
      // Retiming precedes output trimming so speed mode includes the entire source timeline.
      String timing = speed
          ? "setpts=(PTS-STARTPTS)*" + number(clip.duration()) + "/" + number(duration) + ","
          : "";
      String name = "clip-" + i + ".mp4";
      List<String> clipCommand = new ArrayList<>(List.of(ffmpeg, "-nostdin", "-y", "-v", "error", "-protocol_whitelist", "file,pipe",
          "-format_whitelist", "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi",
          "-ss", number(speed ? 0 : clip.start()), "-i", sources.get(i).toString()));
      // Give every retained clip the same audio layout, including silent source clips.
      if (request.keepOriginalAudio() && !hasAudio)
        clipCommand.addAll(List.of("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"));
      clipCommand.addAll(List.of("-t", number(clip.duration()), "-map", "0:v:0", "-vf", timing + "scale=" + size[0] + ":" + size[1]
              + ":force_original_aspect_ratio=decrease:force_divisible_by=2,pad=" + size[0] + ":" + size[1]
              + ":(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30",
          "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", "-threads", "2"));
      if (request.keepOriginalAudio()) {
        String audio = "aresample=48000:async=1:first_pts=0,"
            + (hasAudio && speed ? audioTempo(duration / clip.duration()) + "," : "")
            + "apad,atrim=duration=" + number(clip.duration());
        clipCommand.addAll(List.of("-map", hasAudio ? "0:a:0" : "1:a:0", "-af", audio,
            "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "192k"));
      } else clipCommand.add("-an");
      clipCommand.add(name);
      run(clipCommand, dir, dir.resolve("render-" + i + ".log"), 180);
      manifest.append("file '").append(name).append("'\n");
    }
    Files.writeString(dir.resolve("clips.txt"), manifest, StandardCharsets.UTF_8);
    Files.writeString(dir.resolve("captions.ass"), subtitles(request.clips(), size), StandardCharsets.UTF_8);
    List<String> command = new ArrayList<>(List.of(ffmpeg, "-nostdin", "-y", "-v", "error",
        "-protocol_whitelist", "file,pipe", "-f", "concat", "-safe", "1", "-i", "clips.txt"));
    if (music != null) command.addAll(List.of("-stream_loop", "-1", "-protocol_whitelist", "file,pipe",
        "-format_whitelist", "mp3,wav,aac,flac,ogg,mov,mp4,m4a,3gp,3g2,mj2", "-i", music.toString()));
    command.addAll(List.of("-map", "0:v:0", "-vf", "subtitles=captions.ass", "-c:v", "libx264", "-preset", "fast",
        "-crf", "20", "-pix_fmt", "yuv420p", "-threads", "2"));
    if (request.keepOriginalAudio() && music != null) command.addAll(List.of("-filter_complex",
        "[1:a:0]volume=" + number(request.musicVolume()) + "[music];"
            + "[0:a:0][music]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95:level=0:latency=1[audio]",
        "-map", "[audio]", "-c:a", "aac", "-b:a", "192k"));
    else if (request.keepOriginalAudio()) command.addAll(List.of("-map", "0:a:0", "-c:a", "aac", "-b:a", "192k"));
    else if (music != null) command.addAll(List.of("-map", "1:a:0", "-af", "volume=" + number(request.musicVolume()),
        "-c:a", "aac", "-b:a", "192k", "-shortest"));
    command.addAll(List.of("-t", number(request.clips().stream().mapToDouble(ProductVideoDtos.Clip::duration).sum()),
        "-movflags", "+faststart", "output.mp4"));
    run(command, dir, dir.resolve("compose.log"), 300);
    Path output = dir.resolve("output.mp4");
    if (!Files.isRegularFile(output) || Files.size(output) < 100) throw new ApiException(502, "合成未返回有效视频");
    return output;
  }

  static String audioTempo(double factor) {
    List<String> filters = new ArrayList<>();
    while (factor > 2) { filters.add("atempo=2"); factor /= 2; }
    while (factor < .5) { filters.add("atempo=0.5"); factor *= 2; }
    filters.add("atempo=" + String.format(Locale.ROOT, "%.9f", factor));
    return String.join(",", filters);
  }

  static String subtitles(List<ProductVideoDtos.Clip> clips, int[] size) {
    StringBuilder text = new StringBuilder("[Script Info]\nScriptType: v4.00+\nPlayResX: " + size[0] + "\nPlayResY: " + size[1]
        + "\nWrapStyle: 0\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        + "Style: Default,Microsoft YaHei,32,&H00FFFFFF,&H00FFFFFF,&H00202020,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,36,36,40,1\n"
        + "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n");
    double start = 0;
    for (var clip : clips) {
      if (clip.caption() != null && !clip.caption().isBlank()) {
        String caption = clip.caption().replace("\\", "＼").replace("{", "（").replace("}", "）")
            .replace("\r", "").replace("\n", "\\N");
        text.append("Dialogue: 0,").append(assTime(start)).append(',').append(assTime(start + clip.duration()))
            .append(",Default,,0,0,0,,").append(caption).append('\n');
      }
      start += clip.duration();
    }
    return text.toString();
  }

  private static String assTime(double seconds) {
    int cs = (int) Math.round(seconds * 100);
    return String.format(Locale.ROOT, "%d:%02d:%02d.%02d", cs / 360000, cs / 6000 % 60, cs / 100 % 60, cs % 100);
  }

  private static String number(double value) { return String.format(Locale.ROOT, "%.3f", value); }

  private void run(List<String> command, Path dir, Path output, int seconds) throws Exception {
    Process process = new ProcessBuilder(command).directory(dir.toFile()).redirectErrorStream(true)
        .redirectOutput(output.toFile()).start();
    try {
      if (!process.waitFor(seconds, TimeUnit.SECONDS)) throw new ApiException(504, "视频合成超时，请减少片段后重试");
      if (process.exitValue() != 0) throw new IllegalStateException("Media processing failed: " + Files.readString(output));
    } finally { if (process.isAlive()) process.destroyForcibly(); }
  }

  private Path directory(Long userId, String id) {
    if (userId == null || !id.matches("[0-9a-f-]{36}")) throw new ApiException(404, "成片任务不存在");
    return root.resolve(userId.toString()).resolve(id);
  }

  private void write(Long userId, ProductVideoDtos.Composition state) throws Exception {
    Path dir = directory(userId, state.id());
    Files.createDirectories(dir);
    Path temporary = dir.resolve("state.tmp");
    Files.writeString(temporary, mapper.writeValueAsString(state));
    Files.move(temporary, dir.resolve("state.json"), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
  }
}
