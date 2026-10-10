package com.youmi.api.video;

import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiException;
import com.youmi.api.common.ApiResponse;
import com.youmi.api.credit.MiBizType;
import com.youmi.api.credit.MiValueDtos;
import com.youmi.api.credit.MiValueService;
import com.youmi.api.image.ModelApiKeyDtos;
import com.youmi.api.image.ModelApiKeyService;
import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Optional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * THQ 视频生成入口。米值闸门逻辑完全镜像 {@code ImageTaskController}：
 * 先扣后生成、失败回滚、异步终态回滚/确认，单价取 {@code MiValueProperties} 的 VIDEO(50)。
 */
@RestController
@RequestMapping("/api/video-tasks")
public class VideoTaskController {
  private final VideoGenerationClient videoGenerationClient;
  private final MiValueService miValueService;
  private final AdminAuthService adminAuthService;
  private final ChatVideoJobs chatVideos;
  private final AnmiaoVideoClient anmiaoVideos;
  private final MinimaxVideoClient minimaxVideos;

  public VideoTaskController(
      VideoGenerationClient videoGenerationClient,
      MiValueService miValueService,
      AdminAuthService adminAuthService, ChatVideoJobs chatVideos, AnmiaoVideoClient anmiaoVideos,
      MinimaxVideoClient minimaxVideos) {
    this.videoGenerationClient = videoGenerationClient;
    this.miValueService = miValueService;
    this.adminAuthService = adminAuthService;
    this.chatVideos = chatVideos;
    this.anmiaoVideos = anmiaoVideos;
    this.minimaxVideos = minimaxVideos;
  }

  @PostMapping
  public ApiResponse<VideoGenerationDtos.CreateTaskResponse> create(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody VideoGenerationDtos.CreateTaskRequest request) throws Exception {
    Long userId = adminAuthService.requireUserId(authorization);
    if (request != null && "minimax-h3-max".equals(request.model()))
      throw new ApiException(400, "原视频模型已移除，请重新选择视频模型");
    if (request != null && ChatVideoClient.MODEL.equals(request.model()))
      return ApiResponse.ok(chatVideos.create(userId, request));
    boolean minimax = request != null && MinimaxVideoClient.supportsModel(request.model());
    boolean configuredModel = request != null && !minimax && anmiaoVideos.supportsModel(request.model());
    if (request != null && !minimax && !configuredModel
        && anmiaoVideos.isConfiguredKeyExcluded(request.model()))
      throw new ApiException(400, "所选视频模型未映射到画布视频功能");
    if (minimax || configuredModel) {
      int price = minimax ? minimaxVideos.price(request) : anmiaoVideos.price(request);
      MiValueDtos.DeductResult deduct = miValueService.checkAndDeduct(userId, MiBizType.VIDEO, price);
      try {
        VideoGenerationDtos.CreateTaskResponse response = minimax
            ? minimaxVideos.createTask(request) : anmiaoVideos.createTask(request);
        miValueService.linkTask(deduct.logId(), response.getTaskId());
        response.setConsumedMi(deduct.price());
        response.setBalance(miValueService.getBalance(userId));
        return ApiResponse.ok(response);
      } catch (Exception error) {
        miValueService.rollback(userId, deduct.logId());
        throw error;
      }
    }
    MiValueDtos.DeductResult deduct = miValueService.checkAndDeduct(userId, MiBizType.VIDEO);
    try {
      VideoGenerationDtos.CreateTaskResponse response = videoGenerationClient.createTask(request);
      miValueService.linkTask(deduct.logId(), response.getTaskId());
      miValueService.commit(deduct.logId());
      response.setConsumedMi(deduct.price());
      response.setBalance(miValueService.getBalance(userId));
      return ApiResponse.ok(response);
    } catch (Exception e) {
      miValueService.rollback(userId, deduct.logId());
      System.err.println("[VideoTask] createTask FAILED for user=" + userId
          + " model=" + request.model()
          + " error=" + e.getClass().getSimpleName() + ": " + e.getMessage());
      e.printStackTrace();
      String reason = e.getMessage() == null || e.getMessage().isBlank()
          ? "上游视频服务未返回错误原因"
          : e.getMessage().replaceAll("\\s+", " ").trim();
      if (reason.length() > 500) {
        reason = reason.substring(0, 500) + "...";
      }
      throw new ApiException(502, "视频生成失败，失败任务不计入米值消耗：" + reason, e);
    }
  }

  @GetMapping("/models")
  public ApiResponse<java.util.List<ModelApiKeyDtos.ModelOption>> models(
      @RequestHeader(value = "Authorization", required = false) String authorization) {
    adminAuthService.requireUserId(authorization);
    return ApiResponse.ok(anmiaoVideos.configuredModels());
  }

  @GetMapping("/{taskId}")
  public ApiResponse<VideoGenerationDtos.TaskStatusResponse> get(
      @PathVariable String taskId,
      @RequestHeader(value = "Authorization", required = false) String authorization)
      throws Exception {
    Long userId = adminAuthService.requireUserId(authorization);
    if (!miValueService.isTaskOwnedByUser(userId, taskId, MiBizType.VIDEO)) {
      throw new ApiException(404, "Video task not found");
    }
    VideoGenerationDtos.TaskStatusResponse response = taskId.startsWith(ChatVideoJobs.PREFIX)
        ? chatVideos.get(userId, taskId)
        : taskId.startsWith(AnmiaoVideoClient.PREFIX)
            ? anmiaoVideos.getTask(taskId, userId)
        : taskId.startsWith(MinimaxVideoClient.PREFIX) || taskId.startsWith(MinimaxVideoClient.CONFIGURED_PREFIX)
                ? minimaxVideos.getTask(taskId, userId) : videoGenerationClient.getTask(taskId, userId);
    if (isTerminalFailed(response.getStatus())) {
      miValueService.rollbackByTaskId(taskId);
    } else if (isTerminalSuccess(response.getStatus())) {
      if (ModelApiKeyService.usesProviderReportedCost(response.getProvider())) {
        Optional<BigDecimal> actualCost = providerCostInMi(response.getRaw());
        if (actualCost.isPresent()) {
          miValueService.settleActualByTaskId(taskId, actualCost.get());
        } else {
          response.setStatus("processing");
          response.setStage("生成已完成，等待灵科 AI 返回实际费用");
        }
      } else {
        miValueService.commitByTaskId(taskId);
      }
    }
    return ApiResponse.ok(response);
  }

  private Optional<BigDecimal> providerCostInMi(JsonNode raw) {
    if (raw == null || raw.isNull() || raw.isMissingNode()) return Optional.empty();
    JsonNode cost = raw.findValue("cost");
    if (cost == null || cost.isNull() || cost.isMissingNode()) return Optional.empty();
    try {
      BigDecimal amount = cost.isNumber() ? cost.decimalValue() : new BigDecimal(cost.asText().trim());
      if (amount.signum() < 0) return Optional.empty();
      return Optional.of(amount.movePointRight(2).setScale(2, RoundingMode.HALF_UP));
    } catch (NumberFormatException | ArithmeticException ignored) {
      return Optional.empty();
    }
  }

  private boolean isTerminalFailed(String status) {
    if (status == null) {
      return false;
    }
    String s = status.trim().toLowerCase();
    return s.equals("failed") || s.equals("error") || s.equals("cancelled")
        || s.equals("canceled") || s.equals("expired") || s.equals("aborted")
        || s.contains("error") || s.contains("fail");
  }

  private boolean isTerminalSuccess(String status) {
    if (status == null) {
      return false;
    }
    String s = status.trim().toLowerCase();
    return s.equals("completed") || s.equals("succeeded") || s.equals("success")
        || s.equals("done") || s.equals("finished") || s.equals("generated")
        || s.equals("ready");
  }
}
