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
import java.util.Optional;
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
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/image-tasks")
public class ImageTaskController {
  private final ImageGenerationClient imageGenerationClient;
  private final ImageTaskLogService imageTaskLogService;
  private final AdminAuthService adminAuthService;
  private final MiValueService miValueService;
  private final ImageMiValuePricingService pricingService;
  private ModelApiKeyService modelApiKeyService;

  public ImageTaskController(
      ImageGenerationClient imageGenerationClient,
      ImageTaskLogService imageTaskLogService,
      AdminAuthService adminAuthService,
      MiValueService miValueService,
      ImageMiValuePricingService pricingService) {
    this.imageGenerationClient = imageGenerationClient;
    this.imageTaskLogService = imageTaskLogService;
    this.adminAuthService = adminAuthService;
    this.miValueService = miValueService;
    this.pricingService = pricingService;
  }

  @org.springframework.beans.factory.annotation.Autowired(required = false)
  void setModelApiKeyService(ModelApiKeyService modelApiKeyService) {
    this.modelApiKeyService = modelApiKeyService;
  }

  @GetMapping("/status")
  public ApiResponse<ImageGenerationDtos.StatusResponse> status() {
    return ApiResponse.ok(imageGenerationClient.status());
  }

  @GetMapping("/canvas-models")
  public ApiResponse<CanvasModelsResponse> canvasModels(
      @RequestParam(value = "feature_code", defaultValue = "canvas-image") String featureCode) {
    if (modelApiKeyService == null) return ApiResponse.ok(new CanvasModelsResponse(false, java.util.List.of()));
    if (!java.util.Set.of("canvas-image", "canvas-creation-image", "product-video-image").contains(featureCode)) {
      throw new ApiException(400, "不支持的画布生图功能映射");
    }
    java.util.List<ModelApiKeyDtos.ModelOption> options = modelApiKeyService.enabledModelOptions(
        ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION, featureCode);
    return ApiResponse.ok(new CanvasModelsResponse(
        modelApiKeyService.isFeatureMappingConfigured(featureCode),
        options.stream().map(ModelApiKeyDtos.ModelOption::value).distinct().toList(),
        options));
  }

  public record CanvasModelsResponse(
      boolean mappingConfigured,
      java.util.List<String> models,
      java.util.List<ModelApiKeyDtos.ModelOption> options) {
    public CanvasModelsResponse(boolean mappingConfigured, java.util.List<String> models) {
      this(mappingConfigured, models, java.util.List.of());
    }
  }

  @GetMapping("/today-global-count")
  public ApiResponse<Map<String, Object>> todayGlobalCount(
      @RequestHeader(value = "Authorization", required = false) String authorization) {
    Long userId = adminAuthService.optionalUserId(authorization);
    ImageTaskLogService.TodayImageCounts counts = imageTaskLogService.todayImageCounts(userId);
    Map<String, Object> result = new java.util.LinkedHashMap<>();
    result.put("totalImages", counts.globalImages());
    result.put("personalImages", userId == null ? null : counts.personalImages());
    return ApiResponse.ok(result);
  }

  @PostMapping
  public ApiResponse<ImageGenerationDtos.CreateTaskResponse> create(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody ImageGenerationDtos.CreateTaskRequest request) throws Exception {
    // 闸门要求登录态
    Long userId = adminAuthService.requireUserId(authorization);
    if (request == null) {
      throw new ApiException(400, "生图请求不能为空");
    }
    // ym_image_task currently owns one provider task per client idempotency key. Until child-task
    // persistence is redesigned, accepting n > 1 could leave paid provider tasks unowned.
    if (request.requestedCount() > 1) {
      throw new ApiException(400, "当前暂仅支持每次生成 1 张图片");
    }
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
    ImageMiValuePricingService.PriceQuote quote;
    var mappedModel = modelApiKeyService == null || request.model() == null
        ? java.util.Optional.<ModelApiKeyService.ResolvedModelApiKey>empty()
        : modelApiKeyService.resolve(request.model(), ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION,
            request.featureCode());
    boolean modelMapped = mappedModel.isPresent();
    String billingModel = mappedModel.map(ModelApiKeyService.ResolvedModelApiKey::model).orElse(request.model());
    try {
      quote = pricingService.quote(billingModel, request.resolution(), request.requestedCount());
    } catch (IllegalArgumentException e) {
      if (!modelMapped) throw new ApiException(400, e.getMessage());
      try {
        quote = pricingService.reportedCostQuote(billingModel, request.resolution(), request.requestedCount());
      } catch (IllegalArgumentException unsupportedRequest) {
        throw new ApiException(400, unsupportedRequest.getMessage());
      }
    }
    String clientTaskId = request.clientTaskId() == null ? null : request.clientTaskId().trim();
    boolean claimedClientTask = false;
    if (clientTaskId != null && !clientTaskId.isBlank()) {
      claimedClientTask = imageTaskLogService.tryClaimClientTask(userId, clientTaskId);
      if (!claimedClientTask) {
        // The winner may have completed between the initial lookup and the atomic claim.
        ImageTaskLogService.ExistingTask existing =
            imageTaskLogService.findExistingByClientTaskId(userId, clientTaskId);
        if (existing != null) {
          return ApiResponse.ok(imageTaskLogService.buildResponseFromEntity(existing));
        }
        throw new ApiException(409, "该图片任务正在提交，请稍后按原任务查询，系统不会重复扣费");
      }
    }

    MiValueDtos.DeductResult deduct;
    try {
      deduct = miValueService.checkAndDeduct(userId, MiBizType.IMAGE, quote.reservedPrice());
    } catch (Exception e) {
      if (claimedClientTask) imageTaskLogService.releaseClientTaskClaim(userId, clientTaskId);
      throw e;
    }

    boolean providerCallStarted = false;
    try {
      if (claimedClientTask) {
        imageTaskLogService.markClientTaskSubmitting(userId, clientTaskId, deduct.logId());
      }
      // Freeze the key before entering the provider client. Transport/5xx failures from this point
      // are indeterminate; explicit validation/rejection errors are handled separately below.
      providerCallStarted = true;
      ImageGenerationDtos.CreateTaskResponse response = imageGenerationClient.createTask(request, userId);
      if (response == null) {
        throw new IllegalStateException("Image provider returned no response");
      }
      String taskId = response.tasks() == null || response.tasks().isEmpty()
              || response.tasks().get(0) == null
          ? null
          : response.tasks().get(0).taskId();
      if (claimedClientTask && (taskId == null || taskId.isBlank())) {
        throw new IllegalStateException("Image provider returned no task id");
      }
      // Prefer an actual provider cost when the create response already includes it.
      // Most async providers only return cost during polling, which is handled below.
      Optional<ImageTaskLogService.ProviderCost> providerCost =
          imageTaskLogService.extractProviderCost(response.raw());
      java.math.BigDecimal settledPrice = providerCost.isPresent()
          ? providerCost.get().miCost()
          : pricingService.settlementPrice(quote, response.provider());

      // Persist the provider task and close the request-level claim before settlement. Once the
      // provider accepted the request, retries must always resolve to this task, even when later
      // billing bookkeeping fails.
      response.setConsumedMi(settledPrice);
      imageTaskLogService.recordCreated(userId, request, response, requestStartedAt);
      if (claimedClientTask) {
        imageTaskLogService.completeClientTaskClaim(userId, clientTaskId, taskId);
      }
      if (taskId != null && !taskId.isBlank()) {
        miValueService.linkTask(deduct.logId(), taskId);
      }

      int afterBalance;
      if (providerCost.isPresent() && taskId != null && !taskId.isBlank()) {
        miValueService.settleActualByTaskId(taskId, settledPrice);
        afterBalance = miValueService.getBalance(userId);
      } else {
        // External call succeeded; without a reported cost, retain the configured estimate.
        miValueService.settle(deduct.logId(), settledPrice);
        afterBalance = 0;
      }
      // 回填本次消耗与最新余额
      response.setBalance(afterBalance);
      return ApiResponse.ok(response);
    } catch (Exception e) {
      boolean definitivelyRejected = isDefinitiveProviderRejection(e);
      if (providerCallStarted && claimedClientTask && !definitivelyRejected) {
        // The provider may already own the request. Keep the billing reservation and the same
        // client key for reconciliation; an automatic refund + retry could create a free duplicate.
        imageTaskLogService.markClientTaskUnknown(userId, clientTaskId, e.getMessage());
      } else {
        miValueService.rollback(userId, deduct.logId());
        if (claimedClientTask) {
          if (providerCallStarted && definitivelyRejected) {
            imageTaskLogService.releaseRejectedClientTaskClaim(
                userId, clientTaskId, deduct.logId());
          } else {
            imageTaskLogService.releaseClientTaskClaim(userId, clientTaskId);
          }
        }
      }
      // 服务端日志：记录完整的调用上下文与堆栈，方便定位根因
      System.err.println("[ImageTask] createTask FAILED for user=" + userId
          + " model=" + request.model()
          + " error=" + e.getClass().getSimpleName() + ": " + e.getMessage());
      e.printStackTrace();
      // 前端展示信息：保留异常链信息帮助用户反馈定位
      if (definitivelyRejected && e instanceof ApiException apiError) {
        throw apiError;
      }
      String errorMsg = providerCallStarted && claimedClientTask
          ? "生成请求已发出但结果待确认，米值暂时保留；请查询原任务，勿重复提交"
          : "生成服务异常，失败任务不计入米值消耗";
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
    ImageTaskLogService.ClientTaskClaim claim =
        imageTaskLogService.findClientTaskClaim(userId, clientTaskId);
    String claimStatus = claim == null ? null : claim.status();
    boolean inFlight = "CLAIMED".equalsIgnoreCase(claimStatus)
        || "SUBMITTING".equalsIgnoreCase(claimStatus);
    boolean deliveryUnknown = "UNKNOWN".equalsIgnoreCase(claimStatus);
    Map<String, Object> body = new java.util.LinkedHashMap<>();
    body.put("exists", existing != null);
    body.put("task_id", existing != null ? existing.taskId : claim == null ? null : claim.taskId());
    body.put("claim_status", claimStatus);
    body.put("billing_log_id", claim == null ? null : claim.billingLogId());
    body.put("error_message", claim == null ? null : claim.errorMessage());
    body.put("in_flight", inFlight);
    body.put("delivery_unknown", deliveryUnknown);
    // A retry is only safe when neither a persisted task nor a request-level claim owns the key.
    body.put("retry_safe", existing == null && claim == null);
    return ApiResponse.ok(body);
  }

  /**
   * Failures with an explicit local/provider rejection are safe to refund and release. Transport,
   * 5xx and malformed-success failures remain indeterminate because the provider may have accepted
   * the request before the response was lost.
   */
  private boolean isDefinitiveProviderRejection(Exception error) {
    if (error instanceof ApiException apiError) {
      int code = apiError.getCode();
      return code == 400 || code == 413;
    }
    return false;
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
    Optional<ImageTaskLogService.ProviderCost> providerCost = imageTaskLogService.recordStatus(response);
    // 异步轮询到终态：失败则回退米值，成功则确认流水
    if (isTerminalFailed(response.status())) {
      miValueService.rollbackByTaskId(taskId);
    } else if (providerCost.isPresent()) {
      miValueService.settleActualByTaskId(taskId, providerCost.get().miCost());
    } else if (isTerminalSuccess(response)) {
      miValueService.commitByTaskId(taskId);
    }
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
    if (status == null) return false;
    String s = status.trim().toLowerCase();
    boolean completed = s.equals("completed") || s.equals("succeeded") || s.equals("success")
        || s.equals("done") || s.equals("finished") || s.equals("generated")
        || s.equals("ready");
    return completed && response.imageUrls() != null && !response.imageUrls().isEmpty();
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
