package com.youmi.api.video;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiException;
import com.youmi.api.credit.MiBizType;
import com.youmi.api.credit.MiValueDtos;
import com.youmi.api.credit.MiValueService;
import org.junit.jupiter.api.Test;

class VideoTaskControllerTest {
  final VideoGenerationClient legacy = mock(VideoGenerationClient.class);
  final ChatVideoJobs chat = mock(ChatVideoJobs.class);
  final AnmiaoVideoClient anmiao = mock(AnmiaoVideoClient.class);
  final MinimaxVideoClient minimax = mock(MinimaxVideoClient.class);
  final AdminAuthService auth = mock(AdminAuthService.class);
  final MiValueService billing = mock(MiValueService.class);
  final VideoTaskController controller = new VideoTaskController(legacy, billing, auth, chat, anmiao, minimax);

  @Test void removedModelCannotFallThroughToLegacyTransportOrBilling() {
    when(auth.requireUserId("token")).thenReturn(7L);
    var request = new VideoGenerationDtos.CreateTaskRequest("test", "minimax-h3-max", "16:9", 5);
    assertEquals(400, assertThrows(ApiException.class, () -> controller.create("token", request)).getCode());
    verifyNoInteractions(legacy, chat, anmiao, minimax, billing);
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
    verifyNoInteractions(legacy, chat, anmiao);
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
    verifyNoInteractions(legacy, billing, anmiao);
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

  @Test void LingkeVideoSettlesReportedCostOnlyAfterSuccessfulPolling() throws Exception {
    when(auth.requireUserId("token")).thenReturn(7L);
    String taskId = "hailuo-h3:key:9:123456";
    when(billing.isTaskOwnedByUser(7L, taskId, MiBizType.VIDEO)).thenReturn(true);
    var completed = new VideoGenerationDtos.TaskStatusResponse();
    completed.setProvider("灵科AI");
    completed.setStatus("completed");
    completed.setRaw(new ObjectMapper().readTree("{\"cost\":0.23}"));
    when(minimax.getTask(taskId, 7L)).thenReturn(completed);

    controller.get(taskId, "token");

    verify(billing).settleActualByTaskId(taskId, new java.math.BigDecimal("23.00"));
    verify(billing, never()).commitByTaskId(taskId);
    verify(billing, never()).rollbackByTaskId(taskId);
  }

  @Test void LingkeVideoWaitsForCostInsteadOfSettlingZero() throws Exception {
    when(auth.requireUserId("token")).thenReturn(7L);
    String taskId = "hailuo-h3:key:9:123456";
    when(billing.isTaskOwnedByUser(7L, taskId, MiBizType.VIDEO)).thenReturn(true);
    var completed = new VideoGenerationDtos.TaskStatusResponse();
    completed.setProvider("lk888");
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
