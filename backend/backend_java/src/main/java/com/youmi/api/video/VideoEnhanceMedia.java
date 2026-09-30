package com.youmi.api.video;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import com.youmi.api.file.OssStorageService;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class VideoEnhanceMedia {
  private final OssStorageService oss;
  private final ObjectMapper mapper;
  private final VideoEnhanceProperties config;
  private final String ffprobe;
  public VideoEnhanceMedia(OssStorageService oss, ObjectMapper mapper, VideoEnhanceProperties config,
      @Value("${YOUMI_FFPROBE:ffprobe}") String ffprobe) {
    this.oss = oss; this.mapper = mapper; this.config = config; this.ffprobe = ffprobe;
  }
  public boolean available() {
    if (!oss.isConfigured()) return false;
    Process process = null;
    try {
      process = new ProcessBuilder(ffprobe, "-version").redirectOutput(ProcessBuilder.Redirect.DISCARD)
          .redirectError(ProcessBuilder.Redirect.DISCARD).start();
      return process.waitFor(3, TimeUnit.SECONDS) && process.exitValue() == 0;
    } catch (Exception error) { return false; }
    finally { if (process != null && process.isAlive()) process.destroyForcibly(); }
  }
  public String ownedObject(Long userId, String url) {
    try {
      URI uri = URI.create(url);
      if (!Set.of("http", "https").contains(uri.getScheme()) || uri.getUserInfo() != null || !oss.isOwnFileUrl(url)) throw new IllegalArgumentException();
      String object = oss.requireUserObject(userId, oss.objectNameFromFileUrl(url));
      if (!Set.of("mp4", "mov", "mkv", "avi", "flv", "ts", "wmv").contains(extension(object))) {
        throw new ApiException(400, "超分支持 MP4 / MOV / MKV / AVI / FLV / TS / WMV 视频");
      }
      return object;
    } catch (ApiException error) { throw error; }
    catch (Exception error) { throw new ApiException(400, "请先将视频上传或保存到当前账号的素材空间"); }
  }
  public VideoEnhanceDtos.Metadata inspect(String object, Path source) throws Exception {
    Files.createDirectories(source.getParent());
    try (InputStream stream = oss.openObjectStream(object)) { copyLimited(stream, source, config.getMaxInputBytes()); }
    Path output = Files.createTempFile(source.getParent(), "probe-", ".json");
    Process process = null;
    try {
      process = new ProcessBuilder(ffprobe, "-v", "error", "-protocol_whitelist", "file,pipe",
          "-format_whitelist", "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,flv,mpegts,asf",
          "-select_streams", "v:0", "-show_entries", "stream=width,height,duration:format=duration", "-of", "json", source.toString())
          .redirectOutput(output.toFile()).redirectError(ProcessBuilder.Redirect.DISCARD).start();
      if (!process.waitFor(30, TimeUnit.SECONDS) || process.exitValue() != 0) throw new ApiException(400, "无法读取源视频，请确认视频完整且格式受支持");
      return metadata(mapper.readTree(Files.readString(output)));
    } finally {
      if (process != null && process.isAlive()) process.destroyForcibly();
      Files.deleteIfExists(output);
    }
  }
  static VideoEnhanceDtos.Metadata metadata(JsonNode json) {
    JsonNode video = json.path("streams").path(0);
    var metadata = new VideoEnhanceDtos.Metadata(json.path("format").path("duration").asDouble(video.path("duration").asDouble(0)),
        video.path("width").asInt(), video.path("height").asInt());
    metadata.validate();
    return metadata;
  }
  public String publishSource(Long userId, VideoEnhanceDtos.Task task, Path source) {
    String object = snapshot(userId, task);
    oss.uploadLocalFile(source, object, "application/octet-stream");
    return oss.getPresignedFileUrl(object);
  }
  public void removeSnapshot(Long userId, VideoEnhanceDtos.Task task) { oss.deleteFile(snapshot(userId, task)); }
  private String snapshot(Long userId, VideoEnhanceDtos.Task task) {
    return "users/" + userId + "/video-enhance-input/" + task.id() + "." + extension(task.sourceObject());
  }
  private static String extension(String name) { return name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT); }
  public String persist(Long userId, VideoEnhanceDtos.Task task, Path output) throws Exception {
    URI uri = URI.create(task.providerResultUrl());
    for (int redirects = 0; redirects < 5; redirects++) {
      requirePublicUrl(uri);
      var connection = (HttpURLConnection) uri.toURL().openConnection();
      connection.setInstanceFollowRedirects(false);
      connection.setConnectTimeout(15000);
      connection.setReadTimeout(120000);
      try {
        int code = connection.getResponseCode();
        if (code >= 300 && code < 400) { uri = uri.resolve(connection.getHeaderField("Location")); continue; }
        if (code != 200) throw new ApiException(502, "超分结果暂时无法下载，将继续保存原任务");
        try (InputStream stream = connection.getInputStream()) { copyLimited(stream, output, config.getMaxOutputBytes()); }
        String object = "users/" + userId + "/enhanced-videos/" + task.id() + ".mp4";
        oss.uploadLocalFile(output, object, "video/mp4");
        return oss.getFileUrl(object);
      } finally { connection.disconnect(); Files.deleteIfExists(output); }
    }
    throw new ApiException(502, "超分结果重定向过多");
  }
  static void requirePublicUrl(URI uri) throws Exception {
    if (!Set.of("http", "https").contains(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null) throw new ApiException(502, "无效的超分结果地址");
    for (InetAddress address : InetAddress.getAllByName(uri.getHost())) {
      byte[] bytes = address.getAddress();
      if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
          || address.isSiteLocalAddress() || address.isMulticastAddress()
          || bytes.length == 16 && (bytes[0] & 0xfe) == 0xfc
          || bytes.length == 4 && (bytes[0] & 255) == 100 && (bytes[1] & 255) >= 64 && (bytes[1] & 255) <= 127) {
        throw new ApiException(502, "超分结果地址不能指向内网");
      }
    }
  }
  static void copyLimited(InputStream input, Path file, long maxBytes) throws Exception {
    if (maxBytes <= 0) throw new ApiException(503, "视频文件大小上限未配置");
    try (var out = Files.newOutputStream(file)) {
      byte[] buffer = new byte[65536];
      long total = 0, deadline = System.nanoTime() + TimeUnit.MINUTES.toNanos(30);
      for (int count; (count = input.read(buffer)) != -1;) {
        total += count;
        if (total > maxBytes || System.nanoTime() > deadline) throw new ApiException(400, "视频超出当前服务器的文件大小或传输时间上限");
        out.write(buffer, 0, count);
      }
      if (total == 0) throw new ApiException(400, "视频文件为空");
    }
  }
}
