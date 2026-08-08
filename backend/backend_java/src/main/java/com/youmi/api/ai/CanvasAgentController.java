package com.youmi.api.ai;

import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiResponse;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/ai/canvas-agent")
public class CanvasAgentController {
  private final CanvasAgentService canvasAgentService;
  private final AdminAuthService adminAuthService;

  public CanvasAgentController(
      CanvasAgentService canvasAgentService,
      AdminAuthService adminAuthService) {
    this.canvasAgentService = canvasAgentService;
    this.adminAuthService = adminAuthService;
  }

  @PostMapping("/plan")
  public ApiResponse<CanvasAgentDtos.PlanResponse> plan(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody CanvasAgentDtos.PlanRequest request) throws Exception {
    adminAuthService.requireUserId(authorization);
    return ApiResponse.ok(canvasAgentService.plan(request));
  }

  @PostMapping("/chat")
  public ApiResponse<CanvasAgentDtos.ChatResponse> chat(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody CanvasAgentDtos.ChatRequest request) throws Exception {
    adminAuthService.requireUserId(authorization);
    return ApiResponse.ok(canvasAgentService.chat(request));
  }

  @PostMapping("/enhance-prompt")
  public ApiResponse<CanvasAgentDtos.EnhancePromptResponse> enhancePrompt(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody CanvasAgentDtos.EnhancePromptRequest request) throws Exception {
    adminAuthService.requireUserId(authorization);
    return ApiResponse.ok(canvasAgentService.enhancePrompt(request));
  }
}
