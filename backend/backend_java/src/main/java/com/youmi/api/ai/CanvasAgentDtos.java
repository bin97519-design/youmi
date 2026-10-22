package com.youmi.api.ai;

import java.util.List;
import java.util.Map;

public final class CanvasAgentDtos {
  private CanvasAgentDtos() {}

  public record LayerContext(
      String id,
      String name,
      String type,
      String url,
      Double width,
      Double height,
      Double x,
      Double y) {}

  public record PlanRequest(
      String canvasId,
      String instruction,
      List<LayerContext> layers,
      List<String> selectedLayerIds,
      List<String> referenceLayerIds,
      String model,
      String ratio,
      String resolution,
      Integer count,
      String agentModel) {
    public PlanRequest(String canvasId, String instruction, List<LayerContext> layers,
        List<String> selectedLayerIds, List<String> referenceLayerIds, String model,
        String ratio, String resolution, Integer count) {
      this(canvasId, instruction, layers, selectedLayerIds, referenceLayerIds, model,
          ratio, resolution, count, null);
    }
  }

  public record PlanStep(
      String action,
      String title,
      String prompt,
      List<String> referenceLayerIds,
      String model,
      String ratio,
      String resolution,
      int count) {}

  public record PlanResponse(
      String provider,
      String model,
      String summary,
      String visualAnalysis,
      List<PlanStep> steps) {}

  public record ChatMessage(String role, String content) {}

  public record EnhancePromptRequest(
      String canvasId,
      String conversationId,
      String prompt,
      String agentModel) {
    public EnhancePromptRequest(String canvasId, String conversationId, String prompt) {
      this(canvasId, conversationId, prompt, null);
    }
    public EnhancePromptRequest(String prompt) {
      this("", "", prompt, null);
    }
  }

  public record EnhancePromptResponse(
      String provider,
      String model,
      String prompt) {}

  public record TextReference(String name, String text) {}

  public record TextNodeRequest(String canvasId, String layerId, String instruction, String text,
      String agentModel, List<String> imageUrls, List<TextReference> referenceTexts) {}

  public record TextNodeResponse(String provider, String model, String text) {}

  public record ChatRequest(
      String canvasId,
      String instruction,
      List<ChatMessage> history,
      List<LayerContext> layers,
      List<String> selectedLayerIds,
      List<String> referenceLayerIds,
      String model,
      String ratio,
      String resolution,
      Integer count,
      List<String> models,
      String conversationId,
      String agentModel,
      VideoDraftSettings video,
      ReferenceVideo referenceVideo,
      ScriptBriefContext scriptBrief,
      TurnContext turnContext) {
    public ChatRequest(String canvasId, String instruction, List<ChatMessage> history,
        List<LayerContext> layers, List<String> selectedLayerIds, List<String> referenceLayerIds,
        String model, String ratio, String resolution, Integer count, List<String> models,
        String conversationId, String agentModel, VideoDraftSettings video,
        ReferenceVideo referenceVideo, ScriptBriefContext scriptBrief) {
      this(canvasId, instruction, history, layers, selectedLayerIds, referenceLayerIds,
          model, ratio, resolution, count, models, conversationId, agentModel, video,
          referenceVideo, scriptBrief, null);
    }
    // Keep the previous canonical constructor available to legacy canvas callers.
    public ChatRequest(String canvasId, String instruction, List<ChatMessage> history,
        List<LayerContext> layers, List<String> selectedLayerIds, List<String> referenceLayerIds,
        String model, String ratio, String resolution, Integer count, List<String> models,
        String conversationId, String agentModel, VideoDraftSettings video,
        ReferenceVideo referenceVideo) {
      this(canvasId, instruction, history, layers, selectedLayerIds, referenceLayerIds,
          model, ratio, resolution, count, models, conversationId, agentModel, video,
          referenceVideo, null);
    }
    public ChatRequest(String canvasId, String instruction, List<ChatMessage> history,
        List<LayerContext> layers, List<String> selectedLayerIds, List<String> referenceLayerIds,
        String model, String ratio, String resolution, Integer count, List<String> models,
        String conversationId, String agentModel, VideoDraftSettings video) {
      this(canvasId, instruction, history, layers, selectedLayerIds, referenceLayerIds,
          model, ratio, resolution, count, models, conversationId, agentModel, video, null);
    }
    public ChatRequest(String canvasId, String instruction, List<ChatMessage> history,
        List<LayerContext> layers, List<String> selectedLayerIds, List<String> referenceLayerIds,
        String model, String ratio, String resolution, Integer count, List<String> models,
        String conversationId, String agentModel) {
      this(canvasId, instruction, history, layers, selectedLayerIds, referenceLayerIds,
          model, ratio, resolution, count, models, conversationId, agentModel, null);
    }
    public ChatRequest(String canvasId, String instruction, List<ChatMessage> history,
        List<LayerContext> layers, List<String> selectedLayerIds, List<String> referenceLayerIds,
        String model, String ratio, String resolution, Integer count, List<String> models,
        String conversationId) {
      this(canvasId, instruction, history, layers, selectedLayerIds, referenceLayerIds,
          model, ratio, resolution, count, models, conversationId, null);
    }
    public ChatRequest(
        String canvasId,
        String instruction,
        List<ChatMessage> history,
        List<LayerContext> layers,
        List<String> selectedLayerIds,
        List<String> referenceLayerIds,
        String model,
        String ratio,
        String resolution,
        Integer count) {
      this(
          canvasId,
          instruction,
          history,
          layers,
          selectedLayerIds,
          referenceLayerIds,
          model,
          ratio,
          resolution,
          count,
          List.of(),
          "", null);
    }
  }

  /** Metadata offered for explicit reuse, never evidence that an image was submitted or read. */
  public record ScriptReferenceCandidate(String id, String name, String referenceRole) {}

  public record ScriptBriefContext(String sourceMode, List<ScriptReferenceCandidate> referenceCandidates) {
    public ScriptBriefContext {
      sourceMode = switch (sourceMode == null ? "" : sourceMode.strip()) {
        case "history", "upload", "text", "current" -> sourceMode.strip();
        default -> "unconfirmed";
      };
      referenceCandidates = referenceCandidates == null ? List.of()
          : referenceCandidates.stream().filter(java.util.Objects::nonNull).limit(8).toList();
    }
  }

  public record VideoDraftSettings(
      String model, String ratio, String resolution, Integer duration,
      Boolean generateAudio, String referenceMode, String version) {
    public VideoDraftSettings(String model, String ratio, String resolution, Integer duration,
        Boolean generateAudio, String referenceMode) {
      this(model, ratio, resolution, duration, generateAudio, referenceMode, null);
    }
  }

  public record ReferenceVideo(
      String url, String name, double duration, Integer width, Integer height,
      String audioSummary, List<VideoFrame> frames) {}

  public record VideoFrame(String url, double time) {}

  /** Conversation state is routing evidence only, never media execution authorization. */
  public record TurnContext(
      String message,
      String source,
      String taskType,
      String taskStage,
      String taskGoal,
      List<ClarificationQuestion> pendingQuestions,
      List<String> currentReferenceLayerIds) {
    public TurnContext(String message, String source, String taskType, String taskStage,
        String taskGoal, List<ClarificationQuestion> pendingQuestions) {
      this(message, source, taskType, taskStage, taskGoal, pendingQuestions, List.of());
    }
  }

  /** Public, validated branch choices; contains no hidden model reasoning. */
  public record RoutingDecision(
      String context,
      String relation,
      String turn,
      String task,
      String action,
      String stage,
      String summary) {}

  public record ClarificationQuestion(String id, String question, List<String> options, String kind) {
    public ClarificationQuestion {
      kind = switch (kind == null ? "" : kind.strip()) {
        case "image_source" -> "image_source";
        case "image_upload" -> "image_upload";
        case "script_source" -> "script_source";
        default -> "choice";
      };
      options = switch (kind) {
        case "image_source" -> List.of("参考图生图", "纯文字生图");
        case "image_upload" -> List.of();
        case "script_source" -> List.of("沿用历史商品图", "上传或选择其他商品图", "仅根据文字策划");
        default -> options == null ? List.of() : List.copyOf(options);
      };
    }

    public ClarificationQuestion(String id, String question, List<String> options) {
      this(id, question, options, "choice");
    }
  }

  public record ChatResponse(
      String provider,
      String model,
      String reply,
      String visualAnalysis,
      String draftPrompt,
      List<String> draftPrompts,
      List<String> referenceLayerIds,
      String imageModel,
      List<String> imageModels,
      String ratio,
      String resolution,
      int count,
      boolean readyToGenerate,
      String generationType,
      Integer durationSeconds,
      List<ClarificationQuestion> questions,
      RoutingDecision routing) {
    public ChatResponse {
      questions = questions == null ? List.of() : List.copyOf(questions);
      if (!questions.isEmpty()) {
        draftPrompt = "";
        draftPrompts = List.of();
        readyToGenerate = false;
      }
    }

    public ChatResponse(String provider, String model, String reply, String visualAnalysis,
        String draftPrompt, List<String> draftPrompts, List<String> referenceLayerIds,
        String imageModel, List<String> imageModels, String ratio, String resolution,
        int count, boolean readyToGenerate, String generationType, Integer durationSeconds,
        List<ClarificationQuestion> questions) {
      this(provider, model, reply, visualAnalysis, draftPrompt, draftPrompts, referenceLayerIds,
          imageModel, imageModels, ratio, resolution, count, readyToGenerate, generationType,
          durationSeconds, questions, null);
    }

    public ChatResponse(String provider, String model, String reply, String visualAnalysis,
        String draftPrompt, List<String> draftPrompts, List<String> referenceLayerIds,
        String imageModel, List<String> imageModels, String ratio, String resolution,
        int count, boolean readyToGenerate, String generationType, Integer durationSeconds) {
      this(provider, model, reply, visualAnalysis, draftPrompt, draftPrompts, referenceLayerIds,
          imageModel, imageModels, ratio, resolution, count, readyToGenerate, generationType,
          durationSeconds, List.of());
    }
  }

  public record AgentModelOption(String value, String label, boolean configured, Long contextBudgetTokens) {
    public AgentModelOption(String value, String label, boolean configured) {
      this(value, label, configured, null);
    }
  }

  public record ConversationSyncRequest(
      String canvasId,
      String title,
      List<Map<String, Object>> messages) {}

  public record ConversationResponse(
      String id,
      String canvasId,
      String title,
      List<Map<String, Object>> messages,
      long createdAt,
      long updatedAt) {}
}
