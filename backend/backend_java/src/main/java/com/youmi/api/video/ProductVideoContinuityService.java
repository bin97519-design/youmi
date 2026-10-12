package com.youmi.api.video;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import jakarta.annotation.PreDestroy;
import java.awt.image.BufferedImage;
import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import javax.imageio.ImageIO;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class ProductVideoContinuityService {
  public record Clip(String shotId, String title, String url, double start, double duration,
      String timingMode, String transition, String motion, String startState, String endState,
      boolean allowStartTrim, boolean allowEndTrim) {}
  public record Request(String id, String kind, String model, String concept, List<Clip> clips,
      List<ProductVideoDtos.TimelineBeat> timeline) {
    public Request(String id, String kind, String model, String concept, List<Clip> clips) {
      this(id, kind, model, concept, clips, null);
    }
  }
  public record Result(int index, String previousId, String currentId, String status, double confidence,
      String previousState, String currentState, String motion, List<String> issues, String advice,
      Double suggestedPreviousEnd, Double suggestedCurrentStart) {}
  public record State(String id, String status, int progress, String stage, List<Result> results,
      String summary, List<String> issues, String error) {}
  record Sample(List<Double> times, List<String> images, double meanLuma, double frameDifference) {}
  record Evidence(Clip clip, double end, Sample head, Sample tail, double sourceDuration, double frameRate) {
    Evidence(Clip clip, double end, Sample head, Sample tail) { this(clip, end, head, tail, end, 30); }
  }
  private record Key(Long userId, String id) {}
  private final ProductVideoPlanService plans;
  private final VideoCompositionService media;
  private final ObjectMapper mapper;
  private final Path root;
  private final String ffmpeg;
  private final String ffprobe;
  private final Set<Key> active = ConcurrentHashMap.newKeySet();
  private final Set<Key> cancelled = ConcurrentHashMap.newKeySet();
  private final ThreadPoolExecutor executor = new ThreadPoolExecutor(2, 2, 0, TimeUnit.SECONDS,
      new ArrayBlockingQueue<>(8));

  public ProductVideoContinuityService(ProductVideoPlanService plans, VideoCompositionService media,
      ObjectMapper mapper, @Value("${youmi.video-workflow.review-dir:data/video-continuity}") String directory,
      @Value("${YOUMI_FFMPEG:ffmpeg}") String ffmpeg, @Value("${YOUMI_FFPROBE:ffprobe}") String ffprobe) {
    this.plans = plans;
    this.media = media;
    this.mapper = mapper;
    this.root = Path.of(directory).toAbsolutePath().normalize();
    this.ffmpeg = ffmpeg;
    this.ffprobe = ffprobe;
  }

  @PreDestroy public void close() { executor.shutdownNow(); }
  public boolean available() { return !plans.models().isEmpty() && media.available(); }

  public synchronized State create(Long userId, Request request) throws Exception {
    validate(request);
    Path directory = directory(userId, request.id());
    for (var clip : request.clips()) media.ownedObject(userId, clip.url());
    Path saved = directory.resolve("request.json");
    if (Files.isRegularFile(saved)) {
      var original = mapper.readValue(Files.readString(saved), Request.class);
      if (!fingerprint(original).equals(fingerprint(request))) throw new ApiException(409, "检查编号已用于另一份视频，请重新发起检查");
      return get(userId, request.id());
    }
    String model = request.model() == null || request.model().isBlank() ? "default" : request.model();
    if (plans.models().stream().noneMatch(option -> option.value().equals(model)))
      throw new ApiException(400, "所选检查模型不可用，请重新选择策划模型");
    if (!media.available()) throw new ApiException(503, "视频检查服务未就绪");
    Files.createDirectories(directory);
    atomic(saved, request);
    var state = state(request.id(), "queued", 0, "等待检查", List.of(), "", List.of(), "");
    write(userId, state);
    Key key = new Key(userId, request.id());
    active.add(key);
    try { executor.execute(() -> review(key, request)); }
    catch (Exception error) {
      active.remove(key);
      write(userId, state(request.id(), "failed", 0, "检查未开始", List.of(), "", List.of(), "检查队列繁忙，请稍后重新发起"));
      throw new ApiException(503, "检查队列繁忙，请稍后重新发起");
    }
    return state;
  }

  public synchronized State get(Long userId, String id) throws Exception {
    Path file = directory(userId, id).resolve("state.json");
    if (!Files.isRegularFile(file)) throw new ApiException(404, "视频检查任务不存在");
    var state = mapper.readValue(Files.readString(file), State.class);
    if (List.of("queued", "processing", "stopping").contains(state.status()) && !active.contains(new Key(userId, id))) {
      state = state(id, "failed", state.progress(), "检查已中断", state.results(), state.summary(), state.issues(),
          "检查服务已重启，已有结果保留；未自动重复调用模型，请确认后重新检查");
      write(userId, state);
    }
    return state;
  }

  public synchronized State cancel(Long userId, String id) throws Exception {
    var current = get(userId, id);
    if (!List.of("queued", "processing", "stopping").contains(current.status())) return current;
    cancelled.add(new Key(userId, id));
    var state = state(id, "stopping", current.progress(), "正在停止后续检查", current.results(), current.summary(), current.issues(), "");
    write(userId, state);
    return state;
  }

  public synchronized void verifyComposition(Long userId, String id, List<ProductVideoDtos.Clip> clips) throws Exception {
    var result = get(userId, id);
    var request = mapper.readValue(Files.readString(directory(userId, id).resolve("request.json")), Request.class);
    if (!"completed".equals(result.status()) || !"boundaries".equals(request.kind()) || clips == null
        || clips.size() != request.clips().size()) throw new ApiException(409, "实际衔接检查与当前成片不一致，请重新检查");
    for (int index = 0; index < clips.size(); index++) {
      var actual = clips.get(index); var checked = request.clips().get(index);
      if (actual == null) throw new ApiException(409, "检查对应片段不存在");
      String mode = actual.timingMode() == null ? "trim" : actual.timingMode();
      if (!checked.url().equals(actual.url()) || !checked.timingMode().equals(mode)
          || !Double.isFinite(actual.start()) || !Double.isFinite(actual.duration())
          || Math.abs(checked.start() - actual.start()) > .000001 || Math.abs(checked.duration() - actual.duration()) > .000001)
        throw new ApiException(409, "片段顺序或剪辑点已改变，请重新检查实际衔接");
    }
  }

  private void review(Key key, Request request) {
    if ("timeline".equals(request.kind())) { reviewTimeline(key, request); return; }
    var results = new ArrayList<Result>();
    String summary = "";
    List<String> wholeIssues = List.of();
    int progress = 0;
    try {
      int count = "handoff".equals(request.kind()) ? 1 : request.clips().size() - 1;
      for (int offset = 0; offset < count; offset += 2) {
        if (cancelled.contains(key)) break;
        int end = Math.min(offset + 2, count);
        write(key.userId(), state(key.id(), "processing", progress, "检查实际画面 " + (offset + 1) + "–" + end + " / " + count,
            results, summary, wholeIssues, ""));
        Path batch = directory(key.userId(), key.id()).resolve("batch-" + offset);
        Files.createDirectories(batch);
        try {
          var cache = new HashMap<Integer, Evidence>();
          var images = new ArrayList<String>();
          var pairs = new ArrayList<Map<String, Object>>();
          for (int index = offset; index < end; index++) {
            var previous = evidence(key.userId(), request, index, batch, cache);
            var current = "handoff".equals(request.kind()) ? null : evidence(key.userId(), request, index + 1, batch, cache);
            var pair = new HashMap<String, Object>();
            pair.put("index", index);
            pair.put("previous", clipContext(previous.clip()));
            pair.put("previousEnd", previous.end());
            pair.put("previousPlaybackRate", "speed".equals(previous.clip().timingMode()) ? previous.end() / previous.clip().duration() : 1);
            pair.put("previousFrames", frameLabels(previous.tail(), images));
            pair.put("previousMeasurements", Map.of("meanLuma", previous.tail().meanLuma(), "frameDifference", previous.tail().frameDifference()));
            if (current != null) {
              pair.put("current", clipContext(current.clip()));
              pair.put("currentPlaybackRate", "speed".equals(current.clip().timingMode()) ? current.end() / current.clip().duration() : 1);
              pair.put("currentFrames", frameLabels(current.head(), images));
              pair.put("currentMeasurements", Map.of("meanLuma", current.head().meanLuma(), "frameDifference", current.head().frameDifference()));
            }
            pairs.add(pair);
          }
          if (cancelled.contains(key)) break;
          var response = plans.inspectContinuity(request.model(), request.kind().equals("handoff") ? "handoff" : "boundaries",
              Map.of("concept", text(request.concept(), 1200), "order", request.clips().stream().map(Clip::title).toList(), "pairs", pairs), images);
          results.addAll(parse(response, request, offset, end, cache));
          progress = (int) Math.round(end * 85.0 / count);
          write(key.userId(), state(key.id(), "processing", progress, "镜间检查已保存", results, summary, wholeIssues, ""));
        } finally { clearBatch(batch); }
      }
      if (!cancelled.contains(key) && !"handoff".equals(request.kind())) {
        write(key.userId(), state(key.id(), "processing", 90, "检查整片叙事与收尾", results, "", List.of(), ""));
        var response = plans.inspectContinuity(request.model(), "whole", Map.of("concept", text(request.concept(), 1200),
            "order", request.clips().stream().map(ProductVideoContinuityService::clipContext).toList(), "actualObservations", results), List.of());
        summary = requiredText(response, "summary", 400);
        wholeIssues = issues(response.path("issues"));
      }
      write(key.userId(), state(key.id(), cancelled.contains(key) ? "cancelled" : "completed",
          cancelled.contains(key) ? progress : 100, cancelled.contains(key) ? "检查已停止，已有结果保留" : "检查完成，待确认",
          results, summary, wholeIssues, ""));
    } catch (Exception error) {
      if (error instanceof InterruptedException) Thread.currentThread().interrupt();
      try { write(key.userId(), state(key.id(), "failed", progress, "检查未完成", results, summary, wholeIssues,
          error instanceof ApiException ? error.getMessage() : "实际视频检查失败，已有结果保留；请核对后重新检查")); }
      catch (Exception ignored) { }
      org.slf4j.LoggerFactory.getLogger(getClass()).warn("Video continuity {} failed ({})", key.id(), error.getClass().getSimpleName());
    } finally { active.remove(key); cancelled.remove(key); }
  }

  private Evidence evidence(Long userId, Request request, int index, Path batch, Map<Integer, Evidence> cache) throws Exception {
    if (cache.containsKey(index)) return cache.get(index);
    var clip = request.clips().get(index);
    Path source = batch.resolve("source-" + index + ".mp4");
    media.download(userId, clip.url(), source);
    Path probe = batch.resolve("probe-" + index + ".json");
    run(List.of(ffprobe, "-v", "error", "-protocol_whitelist", "file,pipe", "-format_whitelist",
        "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi", "-show_entries", "stream=codec_type,duration,avg_frame_rate:format=duration", "-of", "json", source.toString()), batch, probe);
    var metadata = mapper.readTree(Files.readString(probe));
    double sourceDuration = 0;
    boolean hasVideo = false;
    double frameRate = 30;
    for (var stream : metadata.path("streams")) if ("video".equals(stream.path("codec_type").asText())) {
      hasVideo = true; sourceDuration = stream.path("duration").asDouble(0);
      String[] rate = stream.path("avg_frame_rate").asText("30/1").split("/");
      try { double value = Double.parseDouble(rate[0]) / Double.parseDouble(rate[1]); if (Double.isFinite(value) && value > 0) frameRate = value; }
      catch (RuntimeException ignored) { }
      break;
    }
    if (sourceDuration <= 0) sourceDuration = metadata.path("format").path("duration").asDouble(0);
    if (!hasVideo || !Double.isFinite(sourceDuration) || sourceDuration <= 0) throw new ApiException(400, "无法读取片段实际视频时长");
    boolean speed = "speed".equals(clip.timingMode());
    double start = speed ? 0 : clip.start(), end = speed ? sourceDuration : clip.start() + clip.duration();
    if (end > sourceDuration + .05 || clip.duration() > sourceDuration + .05) throw new ApiException(400, clip.title() + " 的裁剪范围超过实际视频时长");
    double[] times = sampleTimes(start, Math.min(end, sourceDuration), speed ? sourceDuration / clip.duration() : 1);
    double last = Math.max(start, Math.min(end, sourceDuration) - Math.max(.04, 1 / frameRate + .01));
    for (int i = 0; i < times.length; i++) times[i] = Math.min(times[i], last);
    var head = "handoff".equals(request.kind()) ? null : sample(source, batch, index + "-head", List.of(times[0], times[1], times[2]));
    var tail = sample(source, batch, index + "-tail", List.of(times[3], times[4], times[5]));
    var evidence = new Evidence(clip, end, head, tail, sourceDuration, frameRate);
    cache.put(index, evidence);
    return evidence;
  }

  private void reviewTimeline(Key key, Request request) {
    var results = new ArrayList<Result>();
    Path batch = directory(key.userId(), key.id()).resolve("timeline-samples");
    int progress = 0;
    String summary = "";
    List<String> wholeIssues = List.of();
    try {
      if (cancelled.contains(key)) {
        write(key.userId(), state(key.id(), "cancelled", 0, "检查已停止", results, "", List.of(), ""));
        return;
      }
      Files.createDirectories(batch);
      write(key.userId(), state(key.id(), "processing", 0, "读取整片实际视频", results, "", List.of(), ""));
      var actual = evidence(key.userId(), request, 0, batch, new HashMap<>());
      if (Math.abs(actual.sourceDuration() - actual.clip().duration()) > .15)
        wholeIssues = List.of("实际视频时长与策划的整片时长不一致，请核对生成结果");
      Path source = batch.resolve("source-0.mp4");
      Sample previousTail = null;
      int count = request.timeline().size();
      for (int offset = 0; offset < count; offset += 2) {
        if (cancelled.contains(key)) break;
        int end = Math.min(count, offset + 2);
        var images = new ArrayList<String>();
        var sections = new ArrayList<Map<String, Object>>();
        for (int index = offset; index < end; index++) {
          var beat = request.timeline().get(index);
          double last = Math.max(beat.start(), Math.min(beat.end(), actual.sourceDuration()) - Math.max(.04, 1 / actual.frameRate() + .01));
          double window = Math.min(.8, beat.end() - beat.start() - .08);
          var head = sample(source, batch, "section-" + index + "-head", List.of(beat.start(), Math.min(last, beat.start() + window / 2), Math.min(last, beat.start() + window)));
          var middle = sample(source, batch, "section-" + index + "-middle", List.of(beat.start() + (last - beat.start()) / 4,
              (beat.start() + last) / 2, beat.start() + (last - beat.start()) * 3 / 4));
          var tail = sample(source, batch, "section-" + index + "-tail", List.of(Math.max(beat.start(), last - window), Math.max(beat.start(), last - window / 2), last));
          var section = new HashMap<String, Object>();
          section.put("index", index); section.put("planned", beat);
          section.put("headFrames", frameLabels(head, images)); section.put("middleFrames", frameLabels(middle, images));
          section.put("tailFrames", frameLabels(tail, images));
          section.put("measurements", Map.of("headDifference", head.frameDifference(), "middleDifference", middle.frameDifference(),
              "tailDifference", tail.frameDifference(), "meanLuma", middle.meanLuma()));
          if (previousTail != null) section.put("previousTailFrames", frameLabels(previousTail, images));
          sections.add(section); previousTail = tail;
        }
        if (cancelled.contains(key)) break;
        write(key.userId(), state(key.id(), "processing", progress, "检查整片时段 " + (offset + 1) + "–" + end + " / " + count, results, "", wholeIssues, ""));
        var response = plans.inspectContinuity(request.model(), "timeline", Map.of("concept", text(request.concept(), 1200),
            "source", clipContext(actual.clip()), "actualDuration", actual.sourceDuration(), "sections", sections), images);
        results.addAll(parseTimeline(response, request, offset, end));
        progress = (int)Math.round(end * 85.0 / count);
        write(key.userId(), state(key.id(), "processing", progress, "时段检查已保存", results, "", wholeIssues, ""));
      }
      if (!cancelled.contains(key)) {
        var response = plans.inspectContinuity(request.model(), "whole", Map.of("concept", text(request.concept(), 1200),
            "timeline", request.timeline(), "actualObservations", results), List.of());
        summary = requiredText(response, "summary", 400);
        var combined = new ArrayList<>(wholeIssues); combined.addAll(issues(response.path("issues")));
        wholeIssues = combined.stream().distinct().limit(6).toList();
      }
      clearBatch(batch);
      write(key.userId(), state(key.id(), cancelled.contains(key) ? "cancelled" : "completed", cancelled.contains(key) ? progress : 100,
          cancelled.contains(key) ? "检查已停止，已有结果保留" : "整片时段检查完成", results, summary, wholeIssues, ""));
    } catch (Exception error) {
      if (error instanceof InterruptedException) Thread.currentThread().interrupt();
      try { write(key.userId(), state(key.id(), "failed", progress, "整片时段检查未完成", results, summary, wholeIssues,
          error instanceof ApiException ? error.getMessage() : "整片检查失败，已有结果保留；未自动重试模型")); } catch (Exception ignored) { }
      org.slf4j.LoggerFactory.getLogger(getClass()).warn("Whole timeline review {} failed ({})", key.id(), error.getClass().getSimpleName());
    } finally { clearBatch(batch); active.remove(key); cancelled.remove(key); }
  }

  static List<Result> parseTimeline(JsonNode root, Request request, int offset, int end) {
    var array = root.path("results");
    if (!array.isArray() || array.size() != end - offset) throw new ApiException(502, "整片时段检查结果不完整");
    var results = new ArrayList<Result>();
    for (int i = 0; i < array.size(); i++) {
      var value = array.get(i); int index = offset + i;
      String status = value.path("status").asText(); double confidence = value.path("confidence").asDouble(-1);
      if (!value.path("index").isIntegralNumber() || value.path("index").asInt(-1) != index || !List.of("pass", "attention", "uncertain").contains(status)
          || !Double.isFinite(confidence) || confidence < 0 || confidence > 1) throw new ApiException(502, "整片时段检查结果无效");
      var found = issues(value.path("issues"));
      if (confidence < .65) status = "uncertain";
      else if (status.equals("pass") && !found.isEmpty()) status = "attention";
      results.add(new Result(index, index == 0 ? "" : "segment-" + (index - 1), "segment-" + index, status, confidence,
          index == 0 ? "全片开场" : requiredText(value, "previousState", 400), requiredText(value, "currentState", 400),
          requiredText(value, "motion", 400), found, text(value.path("advice").asText(), 400), null, null));
    }
    return results;
  }

  Sample sample(Path source, Path directory, String name, List<Double> times) throws Exception {
    var frames = new ArrayList<BufferedImage>();
    var pixels = new ArrayList<double[]>();
    for (int index = 0; index < times.size(); index++) {
      Path output = directory.resolve(name + "-" + index + ".jpg");
      run(List.of(ffmpeg, "-nostdin", "-y", "-v", "error", "-protocol_whitelist", "file,pipe",
          "-format_whitelist", "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi", "-ss", number(times.get(index)), "-i", source.toString(),
          "-frames:v", "1", "-vf", "scale=512:512:force_original_aspect_ratio=decrease", "-q:v", "4", output.toString()), directory, directory.resolve(name + "-" + index + ".log"));
      if (!Files.isRegularFile(output) || Files.size(output) > 512 * 1024) throw new ApiException(502, "视频采样失败，请检查素材");
      BufferedImage image = ImageIO.read(output.toFile());
      if (image == null) throw new ApiException(502, "无法读取视频采样画面");
      var values = new double[32 * 32];
      for (int y = 0; y < 32; y++) for (int x = 0; x < 32; x++) {
        int rgb = image.getRGB(x * image.getWidth() / 32, y * image.getHeight() / 32);
        values[y * 32 + x] = .2126 * ((rgb >> 16) & 255) + .7152 * ((rgb >> 8) & 255) + .0722 * (rgb & 255);
      }
      pixels.add(values);
      frames.add(image);
    }
    double luma = 0, difference = 0;
    for (var values : pixels) for (double value : values) luma += value;
    for (int index = 1; index < pixels.size(); index++) for (int p = 0; p < 1024; p++) difference += Math.abs(pixels.get(index)[p] - pixels.get(index - 1)[p]);
    // A timed three-frame strip keeps both boundaries inside the clients' eight-image limit.
    int width = frames.get(0).getWidth(), height = frames.get(0).getHeight();
    var strip = new BufferedImage(width * frames.size(), height, BufferedImage.TYPE_INT_RGB);
    var graphics = strip.createGraphics();
    try {
      graphics.setColor(Color.BLACK); graphics.fillRect(0, 0, strip.getWidth(), strip.getHeight());
      for (int index = 0; index < frames.size(); index++) {
        graphics.drawImage(frames.get(index), index * width, 0, null);
        if (index > 0) graphics.drawLine(index * width, 0, index * width, height);
      }
    } finally { graphics.dispose(); }
    var encoded = new ByteArrayOutputStream();
    if (!ImageIO.write(strip, "jpeg", encoded) || encoded.size() > 1536 * 1024) throw new ApiException(502, "视频采样图片过大");
    var images = List.of("data:image/jpeg;base64," + Base64.getEncoder().encodeToString(encoded.toByteArray()));
    return new Sample(times, images, luma / (pixels.size() * 1024), difference / (Math.max(1, pixels.size() - 1) * 1024));
  }

  static double[] sampleTimes(double start, double end, double factor) {
    if (!Double.isFinite(start) || !Double.isFinite(end) || !Double.isFinite(factor) || start < 0 || end - start < .49 || factor <= 0)
      throw new ApiException(400, "视频采样范围无效");
    double window = Math.min(end - start - .04, .8 * factor);
    return new double[]{start, start + window / 2, start + window,
        Math.max(start, end - window - .04), Math.max(start, end - window / 2 - .04), end - .04};
  }

  private List<Map<String, Object>> frameLabels(Sample sample, List<String> images) {
    var labels = new ArrayList<Map<String, Object>>();
    String strip = sample.images().get(0);
    int imageIndex = images.indexOf(strip);
    if (imageIndex < 0) { imageIndex = images.size(); images.add(strip); }
    for (int index = 0; index < sample.times().size(); index++) {
      labels.add(Map.of("imageIndex", imageIndex, "panelIndex", index, "sourceTime", sample.times().get(index), "candidateIndex", index));
    }
    return labels;
  }

  static List<Result> parse(JsonNode root, Request request, int offset, int end, Map<Integer, Evidence> evidence) {
    var array = root.path("results");
    if (!array.isArray() || array.size() != end - offset) throw new ApiException(502, "衔接检查结果不完整，未自动判定通过");
    var results = new ArrayList<Result>();
    for (int i = 0; i < array.size(); i++) {
      var value = array.get(i);
      int index = value.path("index").asInt(-1);
      String status = value.path("status").asText();
      double confidence = value.path("confidence").asDouble(-1);
      if (index != offset + i || !List.of("pass", "attention", "uncertain").contains(status)
          || !Double.isFinite(confidence) || confidence < 0 || confidence > 1) throw new ApiException(502, "衔接检查结果无效，需人工确认");
      if (confidence < .65) status = "uncertain";
      var foundIssues = issues(value.path("issues"));
      if ("pass".equals(status) && !foundIssues.isEmpty()) status = "attention";
      var previous = evidence.get(index);
      var current = "handoff".equals(request.kind()) ? null : evidence.get(index + 1);
      Double previousEnd = suggestedCut(value.path("previousCutFrame"), previous.clip().allowEndTrim(), previous.tail().times(), previous.end(), true);
      Double currentStart = current == null ? null : suggestedCut(value.path("currentCutFrame"), current.clip().allowStartTrim(), current.head().times(), current.clip().start(), false);
      if (previousEnd != null && previousEnd - previous.clip().start() < .5) previousEnd = null;
      if (currentStart != null && current.end() - currentStart < .5) currentStart = null;
      results.add(new Result(index, previous.clip().shotId(), current == null ? "" : current.clip().shotId(), status, confidence,
          requiredText(value, "previousState", 400), current == null ? "" : requiredText(value, "currentState", 400), requiredText(value, "motion", 400),
          foundIssues, text(value.path("advice").asText(), 400), previousEnd, currentStart));
    }
    return results;
  }

  private static Double suggestedCut(JsonNode value, boolean allowed, List<Double> candidates, double unchanged, boolean tail) {
    if (value.isMissingNode() || value.isNull() || !allowed) return null;
    if (!value.isIntegralNumber() || value.asInt() < 0 || value.asInt() > 2) throw new ApiException(502, "剪辑建议不在实际采样范围内");
    int index = value.asInt();
    double time = tail && index == 2 || !tail && index == 0 ? unchanged : candidates.get(index);
    return Math.abs(time - unchanged) < .05 ? null : time;
  }

  static void validate(Request request) {
    if (request == null || request.id() == null || !request.id().matches("[0-9a-f-]{36}")
        || request.kind() == null || !List.of("boundaries", "handoff", "timeline").contains(request.kind()) || request.clips() == null
        || request.clips().size() < ("boundaries".equals(request.kind()) ? 2 : 1) || request.clips().size() > 48
        || !"boundaries".equals(request.kind()) && request.clips().size() != 1 || length(request.model()) > 200 || length(request.concept()) > 1200)
      throw new ApiException(400, "视频检查参数无效");
    var ids = new HashSet<String>();
    double total = 0;
    for (var clip : request.clips()) {
      if (clip == null || clip.shotId() == null || clip.shotId().isBlank() || length(clip.shotId()) > 128 || !ids.add(clip.shotId())
          || clip.url() == null || length(clip.url()) > 4096 || length(clip.title()) > 120 || length(clip.motion()) > 600
          || length(clip.startState()) > 400 || length(clip.endState()) > 400
          || !Double.isFinite(clip.start()) || !Double.isFinite(clip.duration()) || clip.start() < 0 || clip.start() > 600
          || clip.duration() < .5 || clip.duration() > 30 || clip.timingMode() == null || !List.of("trim", "speed").contains(clip.timingMode())
          || clip.transition() == null || !List.of("opening", "match_cut", "continue", "time_cut", "scene_cut").contains(clip.transition())
          || "speed".equals(clip.timingMode()) && clip.start() != 0)
        throw new ApiException(400, "视频检查片段参数无效");
      total += clip.duration();
    }
    if (total > 300) throw new ApiException(400, "一次检查支持5分钟以内的成片");
    if ("timeline".equals(request.kind())) {
      var clip = request.clips().get(0);
      if (clip.start() != 0 || !"trim".equals(clip.timingMode()) || clip.duration() != 15 && clip.duration() != 30
          || request.timeline() == null || request.timeline().isEmpty() || request.timeline().size() > 8)
        throw new ApiException(400, "整片检查需提供15或30秒完整时间轴");
      double previous = 0;
      for (var beat : request.timeline()) {
        if (beat == null || !Double.isFinite(beat.start()) || !Double.isFinite(beat.end()) || Math.abs(beat.start() - previous) > .001
            || beat.end() - beat.start() < 1 || beat.end() > clip.duration() || length(beat.action()) > 180 || length(beat.camera()) > 140
            || length(beat.transition()) > 120 || length(beat.startState()) > 120 || length(beat.endState()) > 120 || length(beat.description()) > 1800
            || beat.transitionType() == null || !List.of("opening", "continue", "match_cut", "time_cut", "scene_cut").contains(beat.transitionType())
            || (beat.start() == 0) != "opening".equals(beat.transitionType()))
          throw new ApiException(400, "整片检查时段无效或内容过长");
        previous = beat.end();
      }
      if (Math.abs(previous - clip.duration()) > .001) throw new ApiException(400, "整片检查时间轴未覆盖全部时长");
    } else if (request.timeline() != null && !request.timeline().isEmpty()) throw new ApiException(400, "镜间检查不能混入整片时段");
  }

  static List<String> issues(JsonNode value) {
    if (!value.isArray() || value.size() > 6) throw new ApiException(502, "检查问题列表无效");
    var result = new ArrayList<String>();
    for (var item : value) {
      if (!item.isTextual() || item.asText().isBlank() || item.asText().length() > 160) throw new ApiException(502, "检查问题描述无效");
      result.add(item.asText());
    }
    return List.copyOf(result);
  }
  private static String requiredText(JsonNode value, String key, int max) {
    var item = value.path(key);
    if (!item.isTextual() || item.asText().isBlank() || item.asText().length() > max) throw new ApiException(502, "检查观察描述不完整");
    return item.asText();
  }
  private static Map<String, Object> clipContext(Clip clip) {
    return Map.ofEntries(Map.entry("title", text(clip.title(), 120)), Map.entry("start", clip.start()),
        Map.entry("duration", clip.duration()), Map.entry("timingMode", clip.timingMode()),
        Map.entry("transition", clip.transition()), Map.entry("plannedMotion", text(clip.motion(), 600)),
        Map.entry("plannedStartState", text(clip.startState(), 400)), Map.entry("plannedEndState", text(clip.endState(), 400)),
        Map.entry("allowStartTrim", clip.allowStartTrim()), Map.entry("allowEndTrim", clip.allowEndTrim()));
  }
  private static String text(String value, int max) { return value == null ? "" : value.substring(0, Math.min(max, value.length())); }
  private static int length(String value) { return value == null ? 0 : value.length(); }
  private static String number(double value) { return String.format(Locale.ROOT, "%.4f", value); }
  private static State state(String id, String status, int progress, String stage, List<Result> results, String summary, List<String> issues, String error) {
    return new State(id, status, progress, stage, List.copyOf(results), summary, List.copyOf(issues), error);
  }
  private String fingerprint(Request request) throws Exception {
    return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(mapper.writeValueAsBytes(request)));
  }
  private Path directory(Long userId, String id) {
    if (userId == null || userId <= 0 || id == null || !id.matches("[0-9a-f-]{36}")) throw new ApiException(404, "视频检查任务不存在");
    return root.resolve(userId.toString()).resolve(id);
  }
  private synchronized void write(Long userId, State state) throws Exception { atomic(directory(userId, state.id()).resolve("state.json"), state); }
  private void atomic(Path target, Object value) throws Exception {
    Files.createDirectories(target.getParent());
    Path temporary = Files.createTempFile(target.getParent(), "review-", ".tmp");
    try {
      Files.writeString(temporary, mapper.writeValueAsString(value), StandardCharsets.UTF_8);
      Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    } finally { Files.deleteIfExists(temporary); }
  }
  private void run(List<String> command, Path directory, Path log) throws Exception {
    Process process = new ProcessBuilder(command).directory(directory.toFile()).redirectErrorStream(true).redirectOutput(log.toFile()).start();
    try {
      if (!process.waitFor(45, TimeUnit.SECONDS)) throw new ApiException(504, "视频检查采样超时");
      if (process.exitValue() != 0) throw new ApiException(502, "视频采样失败，请检查素材格式和视频服务");
    } finally { if (process.isAlive()) process.destroyForcibly(); }
  }
  private void clearBatch(Path batch) {
    try (var files = Files.list(batch)) {
      for (Path file : files.toList()) if (Files.isRegularFile(file)) Files.deleteIfExists(file);
      Files.deleteIfExists(batch);
    } catch (Exception ignored) { }
  }
}
