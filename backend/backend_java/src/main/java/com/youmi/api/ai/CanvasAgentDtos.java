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
      VideoDraftSettings video) {
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

  public record VideoDraftSettings(
      String model, String ratio, String resolution, Integer duration,
      Boolean generateAudio, String referenceMode) {}

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
      Integer durationSeconds) {}

  public record AgentModelOption(String value, String label, boolean configured) {}

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
