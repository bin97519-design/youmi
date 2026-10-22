package com.youmi.api.video;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiException;
import com.youmi.api.credit.MiBizType;
import com.youmi.api.credit.MiValueDtos;
import com.youmi.api.credit.MiValueService;
import com.youmi.api.image.ModelApiKeyDtos;
import com.youmi.api.image.ModelApiKeyService;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class VideoTaskControllerCanvasV3Test {
  final VideoGenerationClient legacy = mock(VideoGenerationClient.class);
  final ChatVideoJobs chat = mock(ChatVideoJobs.class);
  final AnmiaoVideoClient anmiao = mock(AnmiaoVideoClient.class);
  final MinimaxVideoClient minimax = mock(MinimaxVideoClient.class);
  final AdminAuthService auth = mock(AdminAuthService.class);
  final MiValueService billing = mock(MiValueService.class);
  final VideoTaskHistory history = mock(VideoTaskHistory.class);
  final ModelApiKeyService keys = mock(ModelApiKeyService.class);
  final VideoTaskController controller = new VideoTaskController(legacy, billing, auth, chat, anmiao, minimax, history);

  @BeforeEach void setup() {
    when(auth.requireUserId("token")).thenReturn(7L);
    controller.setModelApiKeys(keys);
  }

  VideoGenerationDtos.CreateTaskRequest request(String profile, String model, List<VideoGenerationDtos.ReferenceVideo> videos) {
    return new VideoGenerationDtos.CreateTaskRequest("test", model, "16:9", 12, "720p", List.of(),
        null, null, null, false, null, null, "client-25", "canvas-video", videos,
        profile, List.of(), List.of(), false);
  }

  @Test void unknownProfileAndMismatchedModelsCannotFallThroughToBillingOrLegacyTransport() throws Exception {
    for (var input : List.of(
        request("invalid-profile", "model-api-key:17", List.of()),
        request(AnmiaoVideoClient.CANVAS_V3_SEEDANCE25, "model-api-key:17", List.of()),
        request("canvas-v3-minimax-h3", "model-api-key:17", List.of())))
      assertEquals(400, assertThrows(ApiException.class, () -> controller.create("token", input)).getCode());
    verifyNoInteractions(legacy, chat, billing, history, keys);
    verify(anmiao, never()).createTask(any());
    verify(minimax, never()).createTask(any());
  }

  @Test void opaqueSeedanceProfileWithVideoReferencesUsesNativeFixedQuoteWithoutLegacyAliasing() throws Exception {
    var input = request(AnmiaoVideoClient.CANVAS_V3_SEEDANCE25, "model-api-key:17",
        List.of(new VideoGenerationDtos.ReferenceVideo("https://assets.example/ref.mp4", 3.0)));
    when(anmiao.supportsCanvasV3Seedance25(input.model(), "canvas-video")).thenReturn(true);
    when(anmiao.quoteCanvasV3Seedance25(input)).thenReturn(new BigDecimal("18.60"));
    when(billing.checkAndDeduct(7L, MiBizType.VIDEO, new BigDecimal("18.60")))
        .thenReturn(new MiValueDtos.DeductResult(5L, BigDecimal.ZERO, BigDecimal.ZERO,
            new BigDecimal("18.60"), MiBizType.VIDEO));
    var created = new VideoGenerationDtos.CreateTaskResponse();
    created.setTaskId("anmiao-video:v3-25:key:17:9007199254740993000");
    when(anmiao.createTask(input)).thenReturn(created);
    var response = controller.create("token", input).data();
    assertSame(created, response);
    assertEquals(new BigDecimal("18.60"), response.getConsumedMi());
    verify(billing).linkTask(5L, created.getTaskId());
    verify(history).created(eq(7L), eq(input), same(created), anyLong());
    verify(anmiao, never()).price(any());
    verifyNoInteractions(legacy, chat, minimax, keys);
  }

  @Test void missingQuoteConfigurationFailsBeforeAccountingAndCreateFailuresRollBack() throws Exception {
    var input = request(AnmiaoVideoClient.CANVAS_V3_SEEDANCE25, AnmiaoVideoClient.MODEL25, List.of());
    when(anmiao.supportsCanvasV3Seedance25(input.model(), "canvas-video")).thenReturn(true);
    when(anmiao.quoteCanvasV3Seedance25(input)).thenThrow(new ApiException(503, "单价未配置"));
    assertEquals(503, assertThrows(ApiException.class, () -> controller.create("token", input)).getCode());
    verifyNoInteractions(billing, legacy, chat, minimax, history);
    doReturn(new BigDecimal("24.00")).when(anmiao).quoteCanvasV3Seedance25(input);
    when(billing.checkAndDeduct(7L, MiBizType.VIDEO, new BigDecimal("24.00")))
        .thenReturn(new MiValueDtos.DeductResult(9L, 0, 0, 24, MiBizType.VIDEO));
    when(anmiao.createTask(input)).thenThrow(new ApiException(400, "输入未通过审核"));
    assertEquals(400, assertThrows(ApiException.class, () -> controller.create("token", input)).getCode());
    verify(billing).rollback(7L, 9L);
    verify(history, never()).created(any(), any(), any(), anyLong());
  }

  @Test void fixedQuoteSuccessCommitsWithoutWaitingForAnUndocumentedProviderCostField() throws Exception {
    String task = "anmiao-video:v3-25:key:17:9007199254740993000";
    when(billing.isTaskOwnedByUser(7L, task, MiBizType.VIDEO)).thenReturn(true);
    var completed = new VideoGenerationDtos.TaskStatusResponse();
    completed.setProvider("灵科AI");
    completed.setTaskId(task);
    completed.setStatus("completed");
    completed.setVideoUrls(List.of("https://videos.example/result.mp4"));
    completed.setRaw(new ObjectMapper().readTree("{\"status\":\"succeeded\",\"usage\":{\"output_seconds\":12}}"));
    when(anmiao.getTask(task, 7L)).thenReturn(completed);
    assertEquals("completed", controller.refresh(7L, task).getStatus());
    verify(billing).commitByTaskId(task);
    verify(billing, never()).settleActualByTaskId(anyString(), any());
    verify(history).status(7L, completed);
    verifyNoInteractions(legacy, chat, minimax);
  }

  @Test void fixedQuoteFailedTaskRollsBackAndOwnershipStillProtectsPolling() throws Exception {
    String task = "anmiao-video:v3-25:25:123456";
    assertEquals(404, assertThrows(ApiException.class, () -> controller.refresh(7L, task)).getCode());
    verifyNoInteractions(anmiao, minimax, legacy, chat);
    when(billing.isTaskOwnedByUser(7L, task, MiBizType.VIDEO)).thenReturn(true);
    var failed = new VideoGenerationDtos.TaskStatusResponse();
    failed.setTaskId(task); failed.setStatus("failed"); failed.setError("输入未通过审核");
    when(anmiao.getTask(task, 7L)).thenReturn(failed);
    assertEquals("failed", controller.refresh(7L, task).getStatus());
    verify(billing).rollbackByTaskId(task);
    verify(billing, never()).commitByTaskId(anyString());
  }

  @Test void canvasModelEndpointUsesRoutedIdentitiesAndPreservesOldModelEndpoint() {
    var routed = new ModelApiKeyDtos.ModelOption("model-api-key:17", "SD2.5", "灵科AI", AnmiaoVideoClient.MODEL25);
    when(keys.enabledRoutedModelOptions(ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video"))
        .thenReturn(List.of(routed));
    when(anmiao.available25()).thenReturn(true);
    assertEquals(List.of(routed), controller.canvasModels("token").data());
    verify(keys).enabledRoutedModelOptions(ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video");
    verify(keys, never()).enabledModelOptions(any(), any());
    var legacyOption = new ModelApiKeyDtos.ModelOption(AnmiaoVideoClient.MODEL25, "old model", "provider");
    when(anmiao.configuredModels("canvas-video")).thenReturn(List.of(legacyOption));
    assertEquals(List.of(legacyOption), controller.models("token", "canvas-video").data());
  }

  @Test void propertyConfiguredNativeModelIsVisibleButUnconfiguredModelIsNotPretendedReady() {
    assertEquals(List.of(), controller.canvasModels("token").data());
    when(anmiao.available25()).thenReturn(true);
    var options = controller.canvasModels("token").data();
    assertEquals(1, options.size());
    assertEquals(AnmiaoVideoClient.MODEL25, options.get(0).value());
    assertEquals(AnmiaoVideoClient.MODEL25, options.get(0).model());
  }

  @Test void realH3ModelPropertiesAddOneOptionWithoutConflatingHailuoOrChangingTheOldEndpoint() {
    when(minimax.availableCanvasV3H3()).thenReturn(true);
    var options = controller.canvasModels("token").data();
    assertEquals(1, options.size());
    assertEquals("minimax-h3", options.get(0).value());
    var routed = new ModelApiKeyDtos.ModelOption("model-api-key:22", "custom H3", "灵科AI", "MiniMax-H3");
    when(keys.enabledRoutedModelOptions(ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video"))
        .thenReturn(List.of(routed));
    assertEquals(List.of(routed), controller.canvasModels("token").data());
  }
}
