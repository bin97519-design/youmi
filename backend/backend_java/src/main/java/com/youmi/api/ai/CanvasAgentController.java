package com.youmi.api.ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiException;
import com.youmi.api.common.ApiResponse;
import java.io.IOException;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
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
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

@RestController
@RequestMapping("/api/ai/canvas-agent")
public class CanvasAgentController {
  private static final Logger log = LoggerFactory.getLogger(CanvasAgentController.class);
  private static final ObjectMapper STREAM_JSON = new ObjectMapper();

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

  @GetMapping("/models")
  public ApiResponse<List<CanvasAgentDtos.AgentModelOption>> models(
      @RequestHeader(value = "Authorization", required = false) String authorization) {
    adminAuthService.requireUserId(authorization);
    return ApiResponse.ok(canvasAgentService.models());
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
          request == null ? null : request.agentModel(),
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
          request == null ? null : request.agentModel(),
          startedAt,
          request == null ? "" : request.instruction(),
          error);
      throw error;
    }
  }

  @PostMapping(value = "/chat/stream", produces = MediaType.APPLICATION_NDJSON_VALUE)
  public StreamingResponseBody chatStream(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody CanvasAgentDtos.ChatRequest request) {
    Long userId = adminAuthService.requireUserId(authorization);
    long startedAt = System.currentTimeMillis();
    return output -> {
      AtomicBoolean replyStarted = new AtomicBoolean(false);
      try {
        int layerCount = request == null || request.layers() == null ? 0 : request.layers().size();
        int selectedCount = request == null || request.selectedLayerIds() == null
            ? 0 : request.selectedLayerIds().size();
        writeStreamEvent(output, Map.of(
            "type", "thinking",
            "id", "context",
            "label", "正在读取画布中的 " + layerCount + " 个节点与 " + selectedCount + " 个选中素材",
            "state", "active"));
        writeStreamEvent(output, Map.of(
            "type", "thinking",
            "id", "context",
            "label", "已读取画布中的 " + layerCount + " 个节点与 " + selectedCount + " 个选中素材",
            "state", "complete"));
        writeStreamEvent(output, Map.of(
            "type", "thinking",
            "id", "model",
            "label", "正在使用数据库推理模型解析创作意图与生成约束",
            "state", "active"));

        CanvasAgentDtos.ChatResponse response = canvasAgentService.chatStream(
            request,
            delta -> writeStreamEvent(output, Map.of("type", "thinking_delta", "delta", delta)),
            delta -> {
              if (replyStarted.compareAndSet(false, true)) {
                writeStreamEvent(output, Map.of(
                    "type", "thinking", "id", "model",
                    "label", "已解析创作意图、模型偏好与生成约束", "state", "complete"));
                writeStreamEvent(output, Map.of(
                    "type", "thinking", "id", "answer",
                    "label", "正在流式整理回答与下一步建议", "state", "active"));
              }
              writeStreamEvent(output, Map.of("type", "reply_delta", "delta", delta));
            });
        if (!replyStarted.get()) {
          writeStreamEvent(output, Map.of(
              "type", "thinking", "id", "model",
              "label", "已解析创作意图、模型偏好与生成约束", "state", "complete"));
        }
        writeStreamEvent(output, Map.of(
            "type", "thinking", "id", "answer",
            "label", response.readyToGenerate()
                ? "已整理回答并准备可确认的生成草稿"
                : "已整理回答与下一步建议",
            "state", "complete"));
        writeStreamEvent(output, Map.of("type", "result", "data", response));

        int outputChars = length(response.reply())
            + response.draftPrompts().stream().mapToInt(this::length).sum();
        recordUsage(
            userId,
            request == null ? "" : request.canvasId(),
            request == null ? "" : request.conversationId(),
            "CHAT_STREAM",
            response.provider(),
            response.model(),
            "SUCCESS",
            startedAt,
            length(request == null ? "" : request.instruction()),
            outputChars,
            0,
            "");
      } catch (UncheckedIOException disconnected) {
        log.debug("Canvas Agent stream closed by client: {}", disconnected.getMessage());
      } catch (Exception error) {
        try {
          writeStreamEvent(output, Map.of(
              "type", "error",
              "message", clean(error.getMessage(), 1000).isBlank()
                  ? "TV Director 暂时无法回复，请稍后重试"
                  : clean(error.getMessage(), 1000)));
        } catch (UncheckedIOException disconnected) {
          log.debug("Canvas Agent stream closed while reporting an error: {}", disconnected.getMessage());
        }
        recordFailure(
            userId,
            request == null ? "" : request.canvasId(),
            request == null ? "" : request.conversationId(),
            "CHAT_STREAM",
            request == null ? null : request.agentModel(),
            startedAt,
            request == null ? "" : request.instruction(),
            error);
      }
    };
  }

  private void writeStreamEvent(OutputStream output, Map<String, ?> event) {
    try {
      output.write(STREAM_JSON.writeValueAsString(event).getBytes(StandardCharsets.UTF_8));
      output.write('\n');
      output.flush();
    } catch (IOException error) {
      throw new UncheckedIOException(error);
    }
  }

  @PostMapping("/text")
  public ApiResponse<CanvasAgentDtos.TextNodeResponse> text(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody CanvasAgentDtos.TextNodeRequest request) throws Exception {
    Long userId = adminAuthService.requireUserId(authorization);
    long startedAt = System.currentTimeMillis();
    String conversationId = "text-node-" + (request == null ? "" : request.layerId());
    String input = request == null ? "" : Objects.toString(request.instruction(), "") + Objects.toString(request.text(), "");
    try {
      var response = canvasAgentService.writeTextNode(request);
      recordUsage(userId, request == null ? "" : request.canvasId(), conversationId, "TEXT",
          response.provider(), response.model(), "SUCCESS", startedAt, length(input), length(response.text()),
          request == null || request.imageUrls() == null ? 0 : request.imageUrls().size(), "");
      return ApiResponse.ok(response);
    } catch (Exception error) {
      recordFailure(userId, request == null ? "" : request.canvasId(), conversationId, "TEXT",
          request == null ? null : request.agentModel(), startedAt, input, error);
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
          request == null ? null : request.agentModel(),
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
      String agentModel,
      long startedAt,
      String input,
      Exception error) {
    recordUsage(
        userId,
        canvasId,
        conversationId,
        operation,
        GemAgentClient.MODEL.equals(agentModel) ? "lk888" : "teamorouter",
        agentModel == null ? "" : agentModel,
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
