package com.youmi.api.video;

import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiException;
import com.youmi.api.common.ApiResponse;
import com.youmi.api.credit.MiBizType;
import com.youmi.api.credit.MiValueDtos;
import com.youmi.api.credit.MiValueService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 视频生成入口。米值闸门逻辑完全镜像 {@code ImageTaskController}：
 * 先扣后生成、失败回滚、异步终态回滚/确认，单价取 {@code MiValueProperties} 的 VIDEO(50)。
 */
@RestController
@RequestMapping("/api/video-tasks")
public class VideoTaskController {
  private final VideoGenerationClient videoGenerationClient;
  private final MiValueService miValueService;
  private final AdminAuthService adminAuthService;

  public VideoTaskController(
      VideoGenerationClient videoGenerationClient,
      MiValueService miValueService,
      AdminAuthService adminAuthService) {
    this.videoGenerationClient = videoGenerationClient;
    this.miValueService = miValueService;
    this.adminAuthService = adminAuthService;
  }

  @PostMapping
  public ApiResponse<VideoGenerationDtos.CreateTaskResponse> create(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody VideoGenerationDtos.CreateTaskRequest request) throws Exception {
    Long userId = adminAuthService.requireUserId(authorization);
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
      throw new ApiException(502, "生成服务异常，米值已退回");
    }
  }

  @GetMapping("/{taskId}")
  public ApiResponse<VideoGenerationDtos.TaskStatusResponse> get(@PathVariable String taskId)
      throws Exception {
    VideoGenerationDtos.TaskStatusResponse response = videoGenerationClient.getTask(taskId);
    if (isTerminalFailed(response.getStatus())) {
      miValueService.rollbackByTaskId(taskId);
    } else if (isTerminalSuccess(response.getStatus())) {
      miValueService.commitByTaskId(taskId);
    }
    return ApiResponse.ok(response);
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
