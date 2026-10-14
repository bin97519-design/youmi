package com.youmi.api.video;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiException;
import com.youmi.api.credit.MiBizType;
import com.youmi.api.credit.MiValueDtos;
import com.youmi.api.credit.MiValueService;
import com.youmi.api.image.ModelApiKeyService;
import org.junit.jupiter.api.Test;

class VideoTaskControllerTest {
  final VideoGenerationClient legacy = mock(VideoGenerationClient.class);
  final ChatVideoJobs chat = mock(ChatVideoJobs.class);
  final AnmiaoVideoClient anmiao = mock(AnmiaoVideoClient.class);
  final MinimaxVideoClient minimax = mock(MinimaxVideoClient.class);
  final AdminAuthService auth = mock(AdminAuthService.class);
  final MiValueService billing = mock(MiValueService.class);
  final VideoTaskHistory history = mock(VideoTaskHistory.class);
  final VideoTaskController controller = new VideoTaskController(legacy, billing, auth, chat, anmiao, minimax, history);

  @Test void unsupportedVideoReferencesCannotReachBillingOrLegacyRoutes() {
    when(auth.requireUserId("token")).thenReturn(7L);
    for (String model : java.util.List.of("seedance-2.0-fast-0826-720p", "minimax-h3", ChatVideoClient.MODEL, "bound-other-model")) {
      var request = new VideoGenerationDtos.CreateTaskRequest("test", model, "3:4", 6, "720p",
          java.util.List.of(), null, null, null, true, null, null, null, null,
          java.util.List.of(new VideoGenerationDtos.ReferenceVideo("https://assets.example/a.mp4", 5.0)));
      assertEquals(400, assertThrows(ApiException.class, () -> controller.create("token", request)).getCode());
    }
    verifyNoInteractions(billing, legacy, chat, minimax, anmiao);
  }

  @Test void supportedReferenceVideosReachNativeTransportAndHistoryWithoutBeingDropped() throws Exception {
    when(auth.requireUserId("token")).thenReturn(7L);
    var request = new VideoGenerationDtos.CreateTaskRequest("test", "seedance-2.5", "3:4", 6, "720p",
        java.util.List.of(), null, null, null, true, null, null, "native-ref-client", null,
        java.util.List.of(new VideoGenerationDtos.ReferenceVideo("https://assets.example/a.mp4", 5.0)));
    when(anmiao.supportsModel(request.model())).thenReturn(true);
    when(anmiao.price(request)).thenReturn(18);
    var response = new VideoGenerationDtos.CreateTaskResponse();
    response.setTaskId("anmiao-video:key:1:native-ref-task");
    when(anmiao.createTask(request)).thenReturn(response);
    when(billing.checkAndDeduct(7L, MiBizType.VIDEO, 18))
        .thenReturn(new MiValueDtos.DeductResult(5L, 0, 0, 18, MiBizType.VIDEO));
    controller.create("token", request);
    verify(anmiao).createTask(request);
    verify(history).created(eq(7L), eq(request), eq(response), anyLong());
    verifyNoInteractions(legacy, chat, minimax);
  }

  @Test void removedModelCannotFallThroughToLegacyTransportOrBilling() {
    when(auth.requireUserId("token")).thenReturn(7L);
    var request = new VideoGenerationDtos.CreateTaskRequest("test", "minimax-h3-max", "16:9", 5);
    assertEquals(400, assertThrows(ApiException.class, () -> controller.create("token", request)).getCode());
    verifyNoInteractions(legacy, chat, anmiao, minimax, billing);
  }

  @Test void productVideoModelMustBelongToItsFeatureMapping() {
    when(auth.requireUserId("token")).thenReturn(7L);
    var modelApiKeys = mock(ModelApiKeyService.class);
    controller.setModelApiKeys(modelApiKeys);
    when(modelApiKeys.resolve("unmapped-video", ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION,
        "product-video-video")).thenReturn(java.util.Optional.empty());
    var request = new VideoGenerationDtos.CreateTaskRequest("test", "unmapped-video", "16:9", 5,
        "720p", java.util.List.of(), null, null, null, false, null, null, null, "product-video-video");

    var error = assertThrows(ApiException.class, () -> controller.create("token", request));

    assertEquals(400, error.getCode());
    verify(modelApiKeys).resolve("unmapped-video", ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION,
        "product-video-video");
    verify(minimax).usesMappedHailuoAlias("unmapped-video", "product-video-video");
    verifyNoInteractions(legacy, chat, anmiao, billing);
  }

  @Test void mappedMiniH3CredentialAcceptsLegacyProductVideoSelection() throws Exception {
    when(auth.requireUserId("token")).thenReturn(7L);
    var modelApiKeys = mock(ModelApiKeyService.class);
    controller.setModelApiKeys(modelApiKeys);
    when(minimax.usesMappedHailuoAlias("minimax-h3", "product-video-video")).thenReturn(true);
    var request = new VideoGenerationDtos.CreateTaskRequest("slow camera move", "minimax-h3", "adaptive", 5,
        "768p", java.util.List.of("https://assets.example/first.png"),
        "https://assets.example/first.png", null, null, false, null, null, "client-id",
        "product-video-video");
    when(minimax.price(request)).thenReturn(0);
    when(billing.checkAndDeduct(7L, MiBizType.VIDEO, 0))
        .thenReturn(new MiValueDtos.DeductResult(12L, 0, 0, 0, MiBizType.VIDEO));
    var created = new VideoGenerationDtos.CreateTaskResponse();
    created.setTaskId("hailuo-h3:key:9:123456");
    when(minimax.createTask(request)).thenReturn(created);

    controller.create("token", request);

    verify(modelApiKeys, never()).resolve(anyString(), anyString(), anyString());
    verify(billing).linkTask(12L, created.getTaskId());
    verifyNoInteractions(legacy, chat, anmiao);
  }

  @Test void minimaxUsesOwnPriceAndTransportAndCommitsOnlyAfterFinalSuccess() throws Exception {
    when(auth.requireUserId("token")).thenReturn(7L);
    var request = MinimaxVideoClientTest.request(5, "768p", java.util.List.of(), null, null);
    when(minimax.price(request)).thenReturn(25);
    when(billing.checkAndDeduct(7L, MiBizType.VIDEO, 25))
        .thenReturn(new MiValueDtos.DeductResult(8L, 0, 0, 25, MiBizType.VIDEO));
    var created = new VideoGenerationDtos.CreateTaskResponse();
    created.setTaskId("minimax-h3:123456");
    when(minimax.createTask(request)).thenReturn(created);
    controller.create("token", request);
    verify(billing).linkTask(8L, created.getTaskId());
    verify(billing, never()).commit(anyLong());
    when(billing.isTaskOwnedByUser(7L, created.getTaskId(), MiBizType.VIDEO)).thenReturn(true);
    var result = new VideoGenerationDtos.TaskStatusResponse();
    result.setStatus("processing");
    when(minimax.getTask(created.getTaskId(), 7L)).thenReturn(result);
    controller.get(created.getTaskId(), "token");
    verify(billing, never()).commitByTaskId(anyString());
    verify(billing, never()).rollbackByTaskId(anyString());
    result.setStatus("completed");
    controller.get(created.getTaskId(), "token");
    verify(billing).commitByTaskId(created.getTaskId());
    verifyNoInteractions(legacy, chat);
    verify(anmiao, never()).createTask(any());
    verify(anmiao, never()).price(any());
    verify(history).created(eq(7L), eq(request), eq(created), anyLong());
    verify(history, times(2)).status(7L, result);
  }

  @Test void minimaxUnavailableDoesNotChargeAndRejectedOrFailedTaskRefunds() throws Exception {
    when(auth.requireUserId("token")).thenReturn(7L);
    var request = MinimaxVideoClientTest.request(5, "768p", java.util.List.of(), null, null);
    when(minimax.price(request)).thenThrow(new ApiException(503, "missing key"));
    assertThrows(ApiException.class, () -> controller.create("token", request));
    verifyNoInteractions(billing);
    doReturn(25).when(minimax).price(request);
    when(billing.checkAndDeduct(7L, MiBizType.VIDEO, 25))
        .thenReturn(new MiValueDtos.DeductResult(9L, 0, 0, 25, MiBizType.VIDEO));
    when(minimax.createTask(request)).thenThrow(new ApiException(403, "denied"));
    assertThrows(ApiException.class, () -> controller.create("token", request));
    verify(billing).rollback(7L, 9L);
    assertThrows(ApiException.class, () -> controller.get("minimax-h3:123456", "token"));
    verify(minimax, never()).getTask(anyString(), anyLong());
    when(billing.isTaskOwnedByUser(7L, "minimax-h3:123456", MiBizType.VIDEO)).thenReturn(true);
    var failed = new VideoGenerationDtos.TaskStatusResponse();
    failed.setStatus("failed");
    when(minimax.getTask("minimax-h3:123456", 7L)).thenReturn(failed);
    controller.get("minimax-h3:123456", "token");
    verify(billing).rollbackByTaskId("minimax-h3:123456");
  }

  @Test void thirtySecondRequestUsesNewJobsWithoutLegacyGenerationOrDuplicateCharge() throws Exception {
    when(auth.requireUserId("token")).thenReturn(7L);
    when(chat.create(7L, ChatVideoClientTest.request())).thenReturn(new VideoGenerationDtos.CreateTaskResponse());
    controller.create("token", ChatVideoClientTest.request());
    verify(chat).create(7L, ChatVideoClientTest.request());
    verifyNoInteractions(legacy, billing);
    verify(anmiao, never()).createTask(any());
    verify(anmiao, never()).price(any());
  }

  @Test void fifteenSecondRequestKeepsItsExistingRouteAndAccounting() throws Exception {
    when(auth.requireUserId("token")).thenReturn(7L);
    var request = new VideoGenerationDtos.CreateTaskRequest("test", "seedance-2.0-fast-0826-720p", "16:9", 15);
    var response = new VideoGenerationDtos.CreateTaskResponse();
    response.setTaskId("thq-video:old-1");
    when(anmiao.supportsModel(request.model())).thenReturn(false);
    when(anmiao.isConfiguredKeyExcluded(request.model())).thenReturn(false);
    when(legacy.createTask(request)).thenReturn(response);
    when(billing.checkAndDeduct(7L, MiBizType.VIDEO)).thenReturn(new MiValueDtos.DeductResult(1L, 0, 0, 50, MiBizType.VIDEO));
    controller.create("token", request);
    verify(legacy).createTask(request);
    verify(billing).linkTask(1L, "thq-video:old-1");
    verify(billing).commit(1L);
    verify(anmiao).supportsModel(request.model());
    verify(anmiao).isConfiguredKeyExcluded(request.model());
    verifyNoMoreInteractions(anmiao);
    verifyNoInteractions(chat);
    verify(history).created(eq(7L), eq(request), eq(response), anyLong());
  }

  @Test void pollingChecksOwnershipAndRoutesToCorrectProvider() throws Exception {
    when(auth.requireUserId("token")).thenReturn(7L);
    String id = ChatVideoJobs.PREFIX + "test";
    assertThrows(ApiException.class, () -> controller.get(id, "token"));
    verifyNoInteractions(chat, legacy, anmiao);
    when(billing.isTaskOwnedByUser(7L, id, MiBizType.VIDEO)).thenReturn(true);
    var response = new VideoGenerationDtos.TaskStatusResponse();
    response.setStatus("failed");
    when(chat.get(7L, id)).thenReturn(response);
    controller.get(id, "token");
    verify(chat).get(7L, id);
    verify(billing).rollbackByTaskId(id);
    verifyNoInteractions(legacy, anmiao);
  }

  @Test void perSecondRequestUsesSeparateTransportAndDurationPrice() throws Exception {
    when(auth.requireUserId("token")).thenReturn(7L);
    var request = new VideoGenerationDtos.CreateTaskRequest("test", AnmiaoVideoClient.MODEL, "16:9", 6);
    when(anmiao.supportsModel(AnmiaoVideoClient.MODEL)).thenReturn(true);
    var response = new VideoGenerationDtos.CreateTaskResponse();
    response.setTaskId("anmiao-video:123");
    when(anmiao.supportsModel(AnmiaoVideoClient.MODEL)).thenReturn(true);
    when(anmiao.price(request)).thenReturn(18);
    when(anmiao.createTask(request)).thenReturn(response);
    when(billing.checkAndDeduct(7L, MiBizType.VIDEO, 18))
        .thenReturn(new MiValueDtos.DeductResult(2L, 0, 0, 18, MiBizType.VIDEO));
    controller.create("token", request);
    verify(billing).linkTask(2L, "anmiao-video:123");
    verifyNoInteractions(legacy, chat);
  }

  @Test void mappedFastModelUsesConfiguredVideoTransportInsteadOfLegacyThq() throws Exception {
    when(auth.requireUserId("token")).thenReturn(7L);
    var request = new VideoGenerationDtos.CreateTaskRequest("test", AnmiaoVideoClient.MODEL20_FAST,
        "16:9", 4, "480p", java.util.List.of(), null, null, null, false, null, null, null);
    var response = new VideoGenerationDtos.CreateTaskResponse();
    response.setTaskId("anmiao-video:key:42:fast-123");
    when(anmiao.supportsModel(AnmiaoVideoClient.MODEL20_FAST)).thenReturn(true);
    when(anmiao.price(request)).thenReturn(12);
    when(anmiao.createTask(request)).thenReturn(response);
    when(billing.checkAndDeduct(7L, MiBizType.VIDEO, 12))
        .thenReturn(new MiValueDtos.DeductResult(12L, 0, 0, 12, MiBizType.VIDEO));

    controller.create("token", request);

    verify(anmiao).createTask(request);
    verify(billing).linkTask(12L, response.getTaskId());
    verify(legacy, never()).createTask(any());
  }

  @Test void mappedCanvasMinimaxLinksSelectedCredentialTaskWithoutLegacyCharge() throws Exception {
    when(auth.requireUserId("token")).thenReturn(7L);
    var images = java.util.stream.IntStream.range(0, 6)
        .mapToObj(i -> "https://assets.example/" + i + ".png").toList();
    var request = new VideoGenerationDtos.CreateTaskRequest("slow camera move", MinimaxVideoClient.MODEL,
        "3:4", 15, "768p", images, null, null, null, true, null, null, "client-id");
    when(minimax.price(request)).thenReturn(0);
    when(billing.checkAndDeduct(7L, MiBizType.VIDEO, 0))
        .thenReturn(new MiValueDtos.DeductResult(12L, 0, 0, 0, MiBizType.VIDEO));
    var created = new VideoGenerationDtos.CreateTaskResponse();
    created.setTaskId("minimax-h3:key:10:123456");
    created.setModel(MinimaxVideoClient.MODEL);
    created.setProvider("Mapped channel");
    when(minimax.createTask(request)).thenReturn(created);

    assertEquals(created.getTaskId(), controller.create("token", request).data().getTaskId());
    verify(billing).linkTask(12L, created.getTaskId());
    verify(billing, never()).commit(anyLong());
    verifyNoInteractions(legacy, anmiao, chat);
  }

  @org.junit.jupiter.params.ParameterizedTest
  @org.junit.jupiter.params.provider.ValueSource(strings = {"hailuo-h3:key:9:123456", "minimax-h3:key:10:123456"})
  void configuredMiniH3SettlesReportedCostRegardlessOfProviderLabel(String taskId) throws Exception {
    when(auth.requireUserId("token")).thenReturn(7L);
    when(billing.isTaskOwnedByUser(7L, taskId, MiBizType.VIDEO)).thenReturn(true);
    var completed = new VideoGenerationDtos.TaskStatusResponse();
    completed.setProvider("开放 API");
    completed.setStatus("completed");
    completed.setRaw(new ObjectMapper().readTree("{\"cost\":0.23}"));
    when(minimax.getTask(taskId, 7L)).thenReturn(completed);

    controller.get(taskId, "token");

    verify(billing).settleActualByTaskId(taskId, new java.math.BigDecimal("23.00"));
    verify(billing, never()).commitByTaskId(taskId);
    verify(billing, never()).rollbackByTaskId(taskId);
  }

  @org.junit.jupiter.params.ParameterizedTest
  @org.junit.jupiter.params.provider.ValueSource(strings = {"hailuo-h3:key:9:123456", "minimax-h3:key:10:123456"})
  void configuredMiniH3WaitsForReportedCostInsteadOfSettlingZero(String taskId) throws Exception {
    when(auth.requireUserId("token")).thenReturn(7L);
    when(billing.isTaskOwnedByUser(7L, taskId, MiBizType.VIDEO)).thenReturn(true);
    var completed = new VideoGenerationDtos.TaskStatusResponse();
    completed.setProvider("开放 API");
    completed.setStatus("completed");
    when(minimax.getTask(taskId, 7L)).thenReturn(completed);

    var result = controller.get(taskId, "token").data();

    assertEquals("processing", result.getStatus());
    assertEquals("生成已完成，等待灵科 AI 返回实际费用", result.getStage());
    verify(billing, never()).commitByTaskId(taskId);
    verify(billing, never()).settleActualByTaskId(anyString(), anyInt());
  }

  @Test void rejectedPerSecondTaskRefundsAndOwnedPollingUsesItsProvider() throws Exception {
    when(auth.requireUserId("token")).thenReturn(7L);
    var request = new VideoGenerationDtos.CreateTaskRequest("test", AnmiaoVideoClient.MODEL, "16:9", 6);
    when(anmiao.supportsModel(AnmiaoVideoClient.MODEL)).thenReturn(true);
    when(anmiao.price(request)).thenReturn(18);
    when(billing.checkAndDeduct(7L, MiBizType.VIDEO, 18))
        .thenReturn(new MiValueDtos.DeductResult(3L, 0, 0, 18, MiBizType.VIDEO));
    when(anmiao.createTask(request)).thenThrow(new ApiException(400, "InvalidParameter"));
    assertThrows(ApiException.class, () -> controller.create("token", request));
    verify(billing).rollback(7L, 3L);

    String taskId = "anmiao-video:123";
    when(billing.isTaskOwnedByUser(7L, taskId, MiBizType.VIDEO)).thenReturn(true);
    var response = new VideoGenerationDtos.TaskStatusResponse();
    response.setStatus("failed");
    when(anmiao.getTask(taskId, 7L)).thenReturn(response);
    controller.get(taskId, "token");
    verify(anmiao).getTask(taskId, 7L);
    verify(billing).rollbackByTaskId(taskId);
    verifyNoInteractions(legacy, chat);
  }

  @Test void seedance25UsesPerSecondRouteWithoutChangingLegacyCharge() throws Exception {
    when(auth.requireUserId("token")).thenReturn(7L);
    var request = new VideoGenerationDtos.CreateTaskRequest("test", AnmiaoVideoClient.MODEL25,
        "adaptive", 30);
    when(anmiao.supportsModel(AnmiaoVideoClient.MODEL25)).thenReturn(true);
    var response = new VideoGenerationDtos.CreateTaskResponse();
    response.setTaskId("anmiao-video:456");
    when(anmiao.supportsModel(AnmiaoVideoClient.MODEL25)).thenReturn(true);
    when(anmiao.price(request)).thenReturn(210);
    when(anmiao.createTask(request)).thenReturn(response);
    when(billing.checkAndDeduct(7L, MiBizType.VIDEO, 210))
        .thenReturn(new MiValueDtos.DeductResult(4L, 0, 0, 210, MiBizType.VIDEO));

    controller.create("token", request);
    verify(billing).linkTask(4L, "anmiao-video:456");
    verifyNoInteractions(legacy, chat);
  }
}
