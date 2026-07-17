package com.youmi.api.image;

import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiException;
import com.youmi.api.common.ApiResponse;
import com.youmi.api.credit.MiBizType;
import com.youmi.api.credit.MiValueDtos;
import com.youmi.api.credit.MiValueService;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.util.Map;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/image-tasks")
public class ImageTaskController {
  private final ImageGenerationClient imageGenerationClient;
  private final ImageTaskLogService imageTaskLogService;
  private final AdminAuthService adminAuthService;
  private final MiValueService miValueService;

  public ImageTaskController(
      ImageGenerationClient imageGenerationClient,
      ImageTaskLogService imageTaskLogService,
      AdminAuthService adminAuthService,
      MiValueService miValueService) {
    this.imageGenerationClient = imageGenerationClient;
    this.imageTaskLogService = imageTaskLogService;
    this.adminAuthService = adminAuthService;
    this.miValueService = miValueService;
  }

  @GetMapping("/status")
  public ApiResponse<ImageGenerationDtos.StatusResponse> status() {
    return ApiResponse.ok(imageGenerationClient.status());
  }

  @PostMapping
  public ApiResponse<ImageGenerationDtos.CreateTaskResponse> create(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody ImageGenerationDtos.CreateTaskRequest request) throws Exception {
    // 闸门要求登录态
    Long userId = adminAuthService.requireUserId(authorization);
    Timestamp requestStartedAt = new Timestamp(System.currentTimeMillis());
    // 客户端幂等：同一张生图前端带 client_task_id，刷新重提时直接返回已有任务，
    // 跳过米值扣减与外部生图调用，杜绝重复生图+重复扣费。
    if (request.clientTaskId() != null && !request.clientTaskId().isBlank()) {
      ImageTaskLogService.ExistingTask existing =
          imageTaskLogService.findExistingByClientTaskId(userId, request.clientTaskId());
      if (existing != null) {
        return ApiResponse.ok(imageTaskLogService.buildResponseFromEntity(existing));
      }
    }
    // 先扣后生成：原子扣减成功才发起外部调用；不足则抛 402，绝不发起外部调用
    MiValueDtos.DeductResult deduct = miValueService.checkAndDeduct(userId, MiBizType.IMAGE);
    try {
      ImageGenerationDtos.CreateTaskResponse response = imageGenerationClient.createTask(request, userId);
      // 关联外部任务 id 到流水，供异步失败回滚
      if (response.tasks() != null && !response.tasks().isEmpty()
          && response.tasks().get(0).taskId() != null) {
        miValueService.linkTask(deduct.logId(), response.tasks().get(0).taskId());
      }
      // 外部调用成功 → 确认流水 SUCCESS（余额已在扣减时减少，此处只改状态）
      miValueService.commit(deduct.logId());
      // 回填本次消耗与最新余额
      response.setConsumedMi(deduct.price());
      response.setBalance(miValueService.getBalance(userId));
      imageTaskLogService.recordCreated(userId, request, response, requestStartedAt);
      return ApiResponse.ok(response);
    } catch (DuplicateKeyException dke) {
      // 并发竞态：另一个同 client_task_id 的请求先 INSERT 成功了（TOCTOU 被 UNIQUE INDEX 拦截）
      // 查回那条已有记录并返回，不再报错、不重复扣费。
      // DuplicateKey 只可能在 recordCreated 时抛出，说明扣费+外部调用已完成；
      // 真正的保障是前端的 chatGenerating 守卫 + DB UNIQUE INDEX 从本源杜绝双扣费。
      ImageTaskLogService.ExistingTask existing =
          imageTaskLogService.findExistingByClientTaskId(userId, request.clientTaskId());
      if (existing != null) {
        return ApiResponse.ok(imageTaskLogService.buildResponseFromEntity(existing));
      }
      // 极端情况：查不到就往上抛，让外层 catch 处理
      throw dke;
    } catch (Exception e) {
      // 外部失败 → 幂等回滚米值并记流水 ROLLBACK
      miValueService.rollback(userId, deduct.logId());
      // 服务端日志：记录完整的调用上下文与堆栈，方便定位根因
      System.err.println("[ImageTask] createTask FAILED for user=" + userId
          + " model=" + request.model()
          + " error=" + e.getClass().getSimpleName() + ": " + e.getMessage());
      e.printStackTrace();
      // 前端展示信息：保留异常链信息帮助用户反馈定位
      String errorMsg = "生成服务异常，米值已退回";
      if (e.getMessage() != null) {
        errorMsg += ": " + e.getMessage();
      }
      throw new ApiException(502, errorMsg);
    }
  }

  @GetMapping("/by-client-task-id")
  public ApiResponse<Map<String, Object>> resolveByClientTaskId(
      @RequestParam("client_task_id") String clientTaskId,
      @RequestHeader(value = "Authorization", required = false) String authorization) {
    // 与 create 保持一致的鉴权（仅校验登录态）
    Long userId = adminAuthService.requireUserId(authorization);
    ImageTaskLogService.ExistingTask existing =
        imageTaskLogService.findExistingByClientTaskId(userId, clientTaskId);
    Map<String, Object> body = new java.util.HashMap<>();
    body.put("exists", existing != null);
    body.put("task_id", existing == null ? null : existing.taskId);
    return ApiResponse.ok(body);
  }

  @GetMapping("/{taskId}")
  public ApiResponse<ImageGenerationDtos.TaskStatusResponse> get(
      @PathVariable String taskId,
      @RequestHeader(value = "Authorization", required = false) String authorization)
      throws Exception {
    Long userId = adminAuthService.requireUserId(authorization);
    if (!imageTaskLogService.isOwnedByUser(userId, taskId)) {
      throw new ApiException(404, "Image task not found");
    }
    ImageGenerationDtos.TaskStatusResponse response = imageGenerationClient.getTask(taskId);
    // 异步轮询到终态：失败则回退米值，成功则确认流水
    if (isTerminalFailed(response.status())) {
      miValueService.rollbackByTaskId(taskId);
    } else if (isTerminalSuccess(response)) {
      miValueService.commitByTaskId(taskId);
    }
    imageTaskLogService.recordStatus(response);
    return ApiResponse.ok(response);
  }

  /** 是否为终态失败（需回滚米值） */
  private boolean isTerminalFailed(String status) {
    if (status == null) return false;
    String s = status.trim().toLowerCase();
    return s.equals("failed") || s.equals("error") || s.equals("cancelled")
        || s.equals("canceled") || s.equals("expired") || s.equals("aborted")
        || s.contains("error") || s.contains("fail");
  }

  /** 是否为终态成功（需确认流水） */
  private boolean isTerminalSuccess(ImageGenerationDtos.TaskStatusResponse response) {
    if (response == null) return false;
    String status = response.status();
    if (!isTerminalFailed(status) && response.imageUrls() != null && !response.imageUrls().isEmpty()) {
      return true;
    }
    if (status == null) return false;
    String s = status.trim().toLowerCase();
    return s.equals("completed") || s.equals("succeeded") || s.equals("success")
        || s.equals("done") || s.equals("finished") || s.equals("generated")
        || s.equals("ready");
  }

  /**
   * 图片代理下载接口：解决前端下载跨域图片时 a.download 无效的问题。
   * 后端边从 CDN 接收边向前端流式发送，大图片也能快速开始下载，无需等待完整缓冲。
   */
  @GetMapping("/proxy-download")
  public void proxyDownload(@RequestParam("url") String imageUrl, HttpServletResponse response) throws IOException {
    URI uri;
    try {
      uri = new URI(imageUrl);
    } catch (Exception e) {
      response.sendError(HttpStatus.BAD_REQUEST.value());
      return;
    }
    if (!"https".equals(uri.getScheme()) && !"http".equals(uri.getScheme())) {
      response.sendError(HttpStatus.BAD_REQUEST.value());
      return;
    }
    String host = uri.getHost();
    if (host == null) {
      response.sendError(HttpStatus.BAD_REQUEST.value());
      return;
    }

    // 从 URL 提取文件名和 Content-Type
    String path = uri.getPath();
    String filename = path.substring(path.lastIndexOf('/') + 1);
    if (filename.isBlank()) filename = "image.png";
    String contentType = "application/octet-stream";
    if (filename.endsWith(".png")) contentType = "image/png";
    else if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) contentType = "image/jpeg";
    else if (filename.endsWith(".webp")) contentType = "image/webp";
    else if (filename.endsWith(".gif")) contentType = "image/gif";

    java.net.http.HttpClient client = java.net.http.HttpClient.newBuilder()
        .followRedirects(java.net.http.HttpClient.Redirect.NORMAL)
        .connectTimeout(java.time.Duration.ofSeconds(10))
        .build();
    java.net.http.HttpRequest req = java.net.http.HttpRequest.newBuilder()
        .uri(uri)
        .timeout(java.time.Duration.ofSeconds(120))
        .build();

    java.net.http.HttpResponse<java.io.InputStream> resp;
    try {
      resp = client.send(req, java.net.http.HttpResponse.BodyHandlers.ofInputStream());
    } catch (java.net.http.HttpTimeoutException e) {
      response.sendError(HttpStatus.GATEWAY_TIMEOUT.value(), "Upstream CDN timeout");
      return;
    } catch (Exception e) {
      response.sendError(HttpStatus.BAD_GATEWAY.value(), e.getMessage());
      return;
    }

    if (resp.statusCode() != 200) {
      response.sendError(HttpStatus.BAD_GATEWAY.value(), "Upstream returned " + resp.statusCode());
      return;
    }

    // 设置响应头
    response.setContentType(contentType);
    response.setHeader("Content-Disposition",
        "attachment; filename=\"" + URLEncoder.encode(filename, StandardCharsets.UTF_8) + "\"");
    response.setHeader("Access-Control-Allow-Origin", "*");

    // 流式传输：从 CDN 读取数据，边读边写给前端
    try (java.io.InputStream in = resp.body();
         OutputStream out = response.getOutputStream()) {
      byte[] buffer = new byte[8192];
      int bytesRead;
      while ((bytesRead = in.read(buffer)) != -1) {
        out.write(buffer, 0, bytesRead);
        out.flush();
      }
    }
  }
}
