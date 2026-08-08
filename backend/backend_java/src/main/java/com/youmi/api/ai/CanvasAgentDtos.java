package com.youmi.api.ai;

import java.util.List;

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
      Integer count) {}

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

  public record EnhancePromptRequest(String prompt) {}

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
      Integer count) {}

  public record ChatResponse(
      String provider,
      String model,
      String reply,
      String visualAnalysis,
      String draftPrompt,
      List<String> draftPrompts,
      List<String> referenceLayerIds,
      String imageModel,
      String ratio,
      String resolution,
      int count,
      boolean readyToGenerate) {}
}
