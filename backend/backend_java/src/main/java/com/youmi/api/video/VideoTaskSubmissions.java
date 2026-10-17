package com.youmi.api.video;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import java.nio.channels.FileChannel;
import java.nio.channels.OverlappingFileLockException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class VideoTaskSubmissions {
  @FunctionalInterface public interface Submission {
    VideoGenerationDtos.CreateTaskResponse run() throws Exception;
  }
  record Saved(VideoGenerationDtos.CreateTaskRequest request, String status,
      VideoGenerationDtos.CreateTaskResponse response, int errorCode, String error) {}
  public record Lookup(boolean exists, String status, String taskId, String error) {}
  private final ObjectMapper mapper;
  private final Path root;

  public VideoTaskSubmissions(ObjectMapper mapper,
      @Value("${youmi.video-workflow.submission-work-dir:data/video-submissions}") String workDir) {
    this.mapper = mapper;
    root = Path.of(workDir).toAbsolutePath().normalize();
  }

  public VideoGenerationDtos.CreateTaskResponse create(Long userId,
      VideoGenerationDtos.CreateTaskRequest request, Submission submit) throws Exception {
    if (request == null || request.clientTaskId() == null || request.clientTaskId().isBlank())
      return submit.run();
    Path path = file(userId, request.clientTaskId());
    Files.createDirectories(path.getParent());
    try (var channel = FileChannel.open(path.resolveSibling(path.getFileName() + ".lock"),
        StandardOpenOption.CREATE, StandardOpenOption.WRITE)) {
      try (var lock = channel.tryLock()) {
        if (lock == null) throw new ApiException(409, "视频提交正在确认，请查询原任务");
        if (Files.isRegularFile(path)) {
          Saved saved = mapper.readValue(Files.readString(path), Saved.class);
          if (!saved.request().equals(request)) throw new ApiException(409, "请求编号已用于其他视频，请勿重复提交");
          if (saved.response() != null) return saved.response();
          if ("failed".equals(saved.status())) throw new ApiException(saved.errorCode(), saved.error());
          throw new ApiException(409, "视频提交结果待确认，请查询原任务，避免重复计费");
        }
        write(path, new Saved(request, "submitting", null, 0, ""));
        try {
          var response = submit.run();
          if (response == null || response.getTaskId() == null || response.getTaskId().isBlank())
            throw new ApiException(502, "未返回视频任务编号，请核对原任务");
          // Persist only the public receipt, never an upstream raw response or credentials.
          var receipt = new VideoGenerationDtos.CreateTaskResponse();
          receipt.setTaskId(response.getTaskId());
          receipt.setProvider(response.getProvider());
          receipt.setModel(response.getModel());
          receipt.setStatus(response.getStatus());
          receipt.setVideoUrls(response.getVideoUrls());
          receipt.setConsumedMi(response.getConsumedMi());
          receipt.setBalance(response.getBalance());
          write(path, new Saved(request, "accepted", receipt, 0, ""));
          return response;
        } catch (Exception error) {
          // A connection timeout occurs before the HTTP request reaches the provider.
          // Read/request timeouts still have an uncertain outcome and must not be replayed.
          if (error instanceof java.net.http.HttpConnectTimeoutException) {
            var failure = new ApiException(424, "连接中转站超时，任务未提交，请重新提交");
            write(path, new Saved(request, "failed", null, failure.getCode(), failure.getMessage()));
            throw failure;
          }
          boolean rejected = error instanceof ApiException api && api.getCode() >= 400
              && api.getCode() < 500 && api.getCode() != 408 && api.getCode() != 409;
          write(path, new Saved(request, rejected ? "failed" : "unknown", null,
              rejected ? ((ApiException) error).getCode() : 409,
              rejected ? error.getMessage() : "提交结果待确认，请核对原任务，避免重复计费"));
          throw error;
        }
      } catch (OverlappingFileLockException error) {
        throw new ApiException(409, "视频提交正在确认，请查询原任务");
      }
    }
  }

  public Lookup lookup(Long userId, String clientId) throws Exception {
    Path path = file(userId, clientId);
    if (!Files.isRegularFile(path)) return new Lookup(false, "not_found", "", "");
    Saved saved = mapper.readValue(Files.readString(path), Saved.class);
    return new Lookup(true, saved.status(), saved.response() == null ? "" : saved.response().getTaskId(), saved.error());
  }

  private Path file(Long userId, String id) {
    if (userId == null || id == null || !id.matches("[A-Za-z0-9._:-]{1,128}"))
      throw new ApiException(400, "视频请求编号无效");
    String name = UUID.nameUUIDFromBytes(id.getBytes(StandardCharsets.UTF_8)).toString();
    return root.resolve(userId.toString()).resolve(name + ".json");
  }

  private void write(Path path, Saved saved) throws Exception {
    Path temporary = Files.createTempFile(path.getParent(), ".submission-", ".tmp");
    try {
      Files.writeString(temporary, mapper.writeValueAsString(saved));
      try { Files.move(temporary, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING); }
      catch (java.nio.file.AtomicMoveNotSupportedException error) {
        Files.move(temporary, path, StandardCopyOption.REPLACE_EXISTING);
      }
    } finally { Files.deleteIfExists(temporary); }
  }
}
