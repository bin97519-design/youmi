package com.youmi.api.ai;

import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiException;
import com.youmi.api.common.ApiResponse;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/ai/canvas-agent")
public class CanvasAgentController {
  private static final Logger log = LoggerFactory.getLogger(CanvasAgentController.class);

  private final CanvasAgentService canvasAgentService;
  private final CanvasAgentRepository canvasAgentRepository;
  private final AdminAuthService adminAuthService;

  public CanvasAgentController(
      CanvasAgentService canvasAgentService,
      CanvasAgentRepository canvasAgentRepository,
      AdminAuthService adminAuthService) {
    this.canvasAgentService = canvasAgentService;
    this.canvasAgentRepository = canvasAgentRepository;
    this.adminAuthService = adminAuthService;
  }

  @PostMapping("/plan")
  public ApiResponse<CanvasAgentDtos.PlanResponse> plan(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody CanvasAgentDtos.PlanRequest request) throws Exception {
    Long userId = adminAuthService.requireUserId(authorization);
    long startedAt = System.currentTimeMillis();
    try {
      CanvasAgentDtos.PlanResponse response = canvasAgentService.plan(request);
      recordUsage(
          userId,
          request == null ? "" : request.canvasId(),
          "",
          "PLAN",
          response.provider(),
          response.model(),
          "SUCCESS",
          startedAt,
          length(request == null ? "" : request.instruction()),
          length(response.summary()) + response.steps().stream().mapToInt(step -> length(step.prompt())).sum(),
          response.steps().stream().mapToInt(CanvasAgentDtos.PlanStep::count).sum(),
          "");
      return ApiResponse.ok(response);
    } catch (Exception error) {
      recordFailure(
          userId,
          request == null ? "" : request.canvasId(),
          "",
          "PLAN",
          startedAt,
          request == null ? "" : request.instruction(),
          error);
      throw error;
    }
  }

  @PostMapping("/chat")
  public ApiResponse<CanvasAgentDtos.ChatResponse> chat(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody CanvasAgentDtos.ChatRequest request) throws Exception {
    Long userId = adminAuthService.requireUserId(authorization);
    long startedAt = System.currentTimeMillis();
    try {
      CanvasAgentDtos.ChatResponse response = canvasAgentService.chat(request);
      int outputChars = length(response.reply())
          + response.draftPrompts().stream().mapToInt(this::length).sum();
      recordUsage(
          userId,
          request == null ? "" : request.canvasId(),
          request == null ? "" : request.conversationId(),
          "CHAT",
          response.provider(),
          response.model(),
          "SUCCESS",
          startedAt,
          length(request == null ? "" : request.instruction()),
          outputChars,
          0,
          "");
      return ApiResponse.ok(response);
    } catch (Exception error) {
      recordFailure(
          userId,
          request == null ? "" : request.canvasId(),
          request == null ? "" : request.conversationId(),
          "CHAT",
          startedAt,
          request == null ? "" : request.instruction(),
          error);
      throw error;
    }
  }

  @PostMapping("/enhance-prompt")
  public ApiResponse<CanvasAgentDtos.EnhancePromptResponse> enhancePrompt(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody CanvasAgentDtos.EnhancePromptRequest request) throws Exception {
    Long userId = adminAuthService.requireUserId(authorization);
    long startedAt = System.currentTimeMillis();
    try {
      CanvasAgentDtos.EnhancePromptResponse response = canvasAgentService.enhancePrompt(request);
      recordUsage(
          userId,
          request == null ? "" : request.canvasId(),
          request == null ? "" : request.conversationId(),
          "ENHANCE",
          response.provider(),
          response.model(),
          "SUCCESS",
          startedAt,
          length(request == null ? "" : request.prompt()),
          length(response.prompt()),
          0,
          "");
      return ApiResponse.ok(response);
    } catch (Exception error) {
      recordFailure(
          userId,
          request == null ? "" : request.canvasId(),
          request == null ? "" : request.conversationId(),
          "ENHANCE",
          startedAt,
          request == null ? "" : request.prompt(),
          error);
      throw error;
    }
  }

  @GetMapping("/conversations")
  public ApiResponse<List<CanvasAgentDtos.ConversationResponse>> conversations(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestParam String canvasId) {
    Long userId = adminAuthService.requireUserId(authorization);
    return ApiResponse.ok(canvasAgentRepository.findConversations(userId, requireCanvasId(canvasId)));
  }

  @PutMapping("/conversations/{conversationId}")
  public ApiResponse<CanvasAgentDtos.ConversationResponse> saveConversation(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable String conversationId,
      @RequestBody CanvasAgentDtos.ConversationSyncRequest request) {
    Long userId = adminAuthService.requireUserId(authorization);
    String cleanConversationId = requireId(conversationId, "conversationId");
    if (cleanConversationId.length() > 128) {
      throw new ApiException(400, "conversationId 过长");
    }
    String canvasId = requireCanvasId(request == null ? "" : request.canvasId());
    String title = clean(request == null ? "" : request.title(), 256);
    if (title.isBlank()) title = "新对话";
    List<Map<String, Object>> messages = request == null || request.messages() == null
        ? List.of()
        : request.messages().stream().filter(Objects::nonNull).limit(200).toList();
    return ApiResponse.ok(canvasAgentRepository.saveConversation(
        cleanConversationId,
        userId,
        canvasId,
        title,
        messages));
  }

  @DeleteMapping("/conversations/{conversationId}")
  public ApiResponse<Map<String, String>> deleteConversation(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable String conversationId,
      @RequestParam String canvasId) {
    Long userId = adminAuthService.requireUserId(authorization);
    String cleanConversationId = requireId(conversationId, "conversationId");
    canvasAgentRepository.deleteConversation(cleanConversationId, userId, requireCanvasId(canvasId));
    return ApiResponse.ok(Map.of("conversationId", cleanConversationId));
  }

  private void recordFailure(
      Long userId,
      String canvasId,
      String conversationId,
      String operation,
      long startedAt,
      String input,
      Exception error) {
    recordUsage(
        userId,
        canvasId,
        conversationId,
        operation,
        "teamorouter",
        "",
        "FAILED",
        startedAt,
        length(input),
        0,
        0,
        error == null ? "" : error.getMessage());
  }

  private void recordUsage(
      Long userId,
      String canvasId,
      String conversationId,
      String operation,
      String provider,
      String model,
      String status,
      long startedAt,
      int inputChars,
      int outputChars,
      int imageCount,
      String errorMessage) {
    try {
      canvasAgentRepository.recordUsage(
          userId,
          canvasId,
          conversationId,
          operation,
          provider,
          model,
          status,
          System.currentTimeMillis() - startedAt,
          inputChars,
          outputChars,
          imageCount,
          errorMessage);
    } catch (RuntimeException usageError) {
      log.warn("Failed to record Canvas Agent usage: {}", usageError.getMessage());
    }
  }

  private String requireId(String value, String fieldName) {
    String cleaned = clean(value, 160);
    if (cleaned.isBlank()) throw new ApiException(400, fieldName + " 不能为空");
    return cleaned;
  }

  private String requireCanvasId(String value) {
    String cleaned = requireId(value, "canvasId");
    if (cleaned.length() > 64) throw new ApiException(400, "canvasId 过长");
    return cleaned;
  }

  private String clean(String value, int maxLength) {
    if (value == null) return "";
    String cleaned = value.trim();
    return cleaned.length() > maxLength ? cleaned.substring(0, maxLength) : cleaned;
  }

  private int length(String value) {
    return value == null ? 0 : value.length();
  }
}
