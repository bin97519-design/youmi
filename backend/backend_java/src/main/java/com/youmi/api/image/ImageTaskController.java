package com.youmi.api.image;

import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/image-tasks")
public class ImageTaskController {
  private final ImageGenerationClient imageGenerationClient;
  private final ImageTaskLogService imageTaskLogService;
  private final AdminAuthService adminAuthService;

  public ImageTaskController(
      ImageGenerationClient imageGenerationClient,
      ImageTaskLogService imageTaskLogService,
      AdminAuthService adminAuthService) {
    this.imageGenerationClient = imageGenerationClient;
    this.imageTaskLogService = imageTaskLogService;
    this.adminAuthService = adminAuthService;
  }

  @GetMapping("/status")
  public ApiResponse<ImageGenerationDtos.StatusResponse> status() {
    return ApiResponse.ok(imageGenerationClient.status());
  }

  @PostMapping
  public ApiResponse<ImageGenerationDtos.CreateTaskResponse> create(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody ImageGenerationDtos.CreateTaskRequest request) throws Exception {
    ImageGenerationDtos.CreateTaskResponse response = imageGenerationClient.createTask(request);
    imageTaskLogService.recordCreated(adminAuthService.optionalUserId(authorization), request, response);
    return ApiResponse.ok(response);
  }

  @GetMapping("/{taskId}")
  public ApiResponse<ImageGenerationDtos.TaskStatusResponse> get(@PathVariable String taskId)
      throws Exception {
    ImageGenerationDtos.TaskStatusResponse response = imageGenerationClient.getTask(taskId);
    imageTaskLogService.recordStatus(response);
    return ApiResponse.ok(response);
  }
}
