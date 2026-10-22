package com.youmi.api.video;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiException;
import com.youmi.api.credit.MiBizType;
import com.youmi.api.credit.MiValueDtos;
import com.youmi.api.credit.MiValueService;
import java.math.BigDecimal;
import java.net.http.HttpTimeoutException;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class VideoTaskControllerSeedanceAnciTest {
  private final VideoGenerationClient legacy = mock(VideoGenerationClient.class);
  private final ChatVideoJobs chat = mock(ChatVideoJobs.class);
  private final AnmiaoVideoClient anmiao = mock(AnmiaoVideoClient.class);
  private final MinimaxVideoClient minimax = mock(MinimaxVideoClient.class);
  private final SeedanceAnciVideoClient anci = mock(SeedanceAnciVideoClient.class);
  private final AdminAuthService auth = mock(AdminAuthService.class);
  private final MiValueService billing = mock(MiValueService.class);
  private final VideoTaskHistory history = mock(VideoTaskHistory.class);
  private final ObjectMapper mapper = new ObjectMapper();
  private final VideoTaskController controller = new VideoTaskController(
      legacy, billing, auth, chat, anmiao, minimax, history);
  @TempDir Path work;

  @BeforeEach void setup() {
    when(auth.requireUserId("token")).thenReturn(7L);
    controller.setSeedanceAnciVideos(anci);
  }

  private VideoGenerationDtos.CreateTaskRequest request(int duration, String version) throws Exception {
    return mapper.readValue("""
        {"model":"model-api-key:73","prompt":"参考角色在海边漫步","feature_code":"canvas-video",
         "parameter_profile":"canvas-v3-seedance20-anci","mode":"cankaosheng","version":"%s",
         "durationSeconds":%d,"resolution":"720p","ratio":"16:9","client_task_id":"anci-request-1",
         "reference_image_urls":["https://assets.example/first.png","https://assets.example/second.png"],
         "reference_videos":[],"reference_audios":[]}
        """.formatted(version, duration), VideoGenerationDtos.CreateTaskRequest.class);
  }

  private void ready(VideoGenerationDtos.CreateTaskRequest request, String taskId) throws Exception {
    when(anci.supports(request.model(), "canvas-video")).thenReturn(true);
    when(billing.checkAndDeduct(7L, MiBizType.VIDEO, 0))
        .thenReturn(new MiValueDtos.DeductResult(9L, 0, 0, 0, MiBizType.VIDEO));
    var created = new VideoGenerationDtos.CreateTaskResponse();
    created.setTaskId(taskId);
    created.setModel(request.model());
    created.setStatus("queued");
    created.setProvider("custom channel name");
    when(anci.createTask(request)).thenReturn(created);
  }

  private VideoGenerationDtos.TaskStatusResponse status(String taskId, String status, String raw)
      throws Exception {
    var result = new VideoGenerationDtos.TaskStatusResponse();
    result.setTaskId(taskId);
    result.setStatus(status);
    result.setProvider("custom provider, not a pricing rule");
    result.setVideoUrls("completed".equals(status) ? List.of("https://assets.example/result.mp4") : List.of());
    result.setRaw(mapper.readTree(raw));
    when(billing.isTaskOwnedByUser(7L, taskId, MiBizType.VIDEO)).thenReturn(true);
    when(anci.getTask(taskId, 7L)).thenReturn(result);
    return result;
  }

  @Test void configuredPerCallModelUsesZeroInitialHoldForBothDurationExtremes() throws Exception {
    for (int seconds : List.of(4, 15)) {
      var request = request(seconds, seconds == 4 ? "快速" : "标准");
      String task = SeedanceAnciVideoClient.PREFIX + "73:" + seconds;
      ready(request, task);
      var result = controller.create("token", request).data();
      assertEquals(task, result.getTaskId());
      assertEquals(new BigDecimal("0.00"), result.getConsumedMi());
      verify(anci).validate(request);
      verify(anci).createTask(request);
      verify(billing).linkTask(9L, task);
      verify(history).created(eq(7L), eq(request), same(result), anyLong());
    }
    verify(billing, times(2)).checkAndDeduct(7L, MiBizType.VIDEO, 0);
    verify(billing, never()).commit(anyLong());
    verifyNoInteractions(legacy, chat, anmiao, minimax);
  }

  @Test void mismatchedProfileModelCannotFallThroughToAnotherProviderOrCharge() throws Exception {
    var request = request(5, "快速");
    when(anci.supports(request.model(), "canvas-video")).thenReturn(false);
    assertEquals(400, assertThrows(ApiException.class,
        () -> controller.create("token", request)).getCode());
    verify(anci, never()).validate(any());
    verify(anci, never()).createTask(any());
    verifyNoInteractions(billing, legacy, chat, anmiao, minimax, history);
  }

  @Test void missingProfileCannotRouteNativeOrConfiguredPerCallModelsThroughTheLegacyProtocol()
      throws Exception {
    for (String model : List.of(SeedanceAnciVideoClient.MODEL, "model-api-key:73")) {
      var json = mapper.valueToTree(request(5, "快速"));
      ((com.fasterxml.jackson.databind.node.ObjectNode) json).put("model", model)
          .remove("parameter_profile");
      var request = mapper.treeToValue(json, VideoGenerationDtos.CreateTaskRequest.class);
      when(anci.supports(model, "canvas-video")).thenReturn(!SeedanceAnciVideoClient.MODEL.equals(model));
      assertEquals(400, assertThrows(ApiException.class,
          () -> controller.create("token", request)).getCode());
    }
    verify(anci, never()).validate(any());
    verify(anci, never()).createTask(any());
    verifyNoInteractions(billing, legacy, chat, anmiao, minimax, history);
  }

  @Test void invalidParametersFailBeforeAnyHoldAndRejectedCreateRollsBackOnce() throws Exception {
    var request = request(5, "快速");
    when(anci.supports(request.model(), "canvas-video")).thenReturn(true);
    doThrow(new ApiException(400, "仅支持参考图片，不能指定首尾帧")).when(anci).validate(request);
    assertEquals(400, assertThrows(ApiException.class,
        () -> controller.create("token", request)).getCode());
    verifyNoInteractions(billing);
    doNothing().when(anci).validate(request);
    ready(request, SeedanceAnciVideoClient.PREFIX + "73:123");
    when(anci.createTask(request)).thenThrow(new ApiException(422, "provider rejected request"));
    assertEquals(422, assertThrows(ApiException.class,
        () -> controller.create("token", request)).getCode());
    verify(billing, times(1)).rollback(7L, 9L);
    verify(billing, never()).linkTask(anyLong(), anyString());
    verifyNoInteractions(legacy, chat, anmiao, minimax, history);
  }

  @Test void unauthorizedCallsAndForeignTasksNeverReachTheProvider() throws Exception {
    when(auth.requireUserId("unauthorized")).thenThrow(new ApiException(401, "需要登录"));
    var request = request(5, "快速");
    assertEquals(401, assertThrows(ApiException.class,
        () -> controller.create("unauthorized", request)).getCode());
    String task = SeedanceAnciVideoClient.PREFIX + "73:123";
    assertEquals(404, assertThrows(ApiException.class,
        () -> controller.get(task, "token")).getCode());
    verify(billing).isTaskOwnedByUser(7L, task, MiBizType.VIDEO);
    verifyNoInteractions(anci, legacy, chat, anmiao, minimax, history);
  }

  @Test void terminalSuccessSettlesProviderReportedPerCallCostIndependentOfProviderLabel() throws Exception {
    String task = SeedanceAnciVideoClient.PREFIX + "73:123";
    var completed = status(task, "completed", "{\"state\":\"success\",\"is_final\":true,\"cost\":0.23}");
    assertSame(completed, controller.get(task, "token").data());
    verify(anci).getTask(task, 7L);
    verify(billing).settleActualByTaskId(task, new BigDecimal("23.00"));
    verify(billing, never()).commitByTaskId(anyString());
    verify(billing, never()).rollbackByTaskId(anyString());
    verify(history).status(7L, completed);
    verifyNoInteractions(legacy, chat, anmiao, minimax);
  }

  @Test void missingOrInvalidActualCostStaysProcessingRatherThanClaimingFreeCompletion() throws Exception {
    int suffix = 0;
    for (String raw : List.of("{}", "{\"cost\":null}", "{\"cost\":-0.23}", "{\"cost\":\"invalid\"}")) {
      String task = SeedanceAnciVideoClient.PREFIX + "73:" + (++suffix);
      var completed = status(task, "completed", raw);
      assertEquals("processing", controller.refresh(7L, task).getStatus());
      assertNotNull(completed.getStage());
      verify(history).status(7L, completed);
    }
    verify(billing, never()).settleActualByTaskId(anyString(), any());
    verify(billing, never()).commitByTaskId(anyString());
    verify(billing, never()).rollbackByTaskId(anyString());
  }

  @Test void failedTasksRollbackWhileNonFinalResponsesKeepWaiting() throws Exception {
    String pendingTask = SeedanceAnciVideoClient.PREFIX + "73:1";
    var pending = status(pendingTask, "processing", "{\"state\":\"success\",\"is_final\":false,\"cost\":0.23}");
    assertSame(pending, controller.refresh(7L, pendingTask));
    verify(billing, never()).settleActualByTaskId(anyString(), any());
    verify(billing, never()).commitByTaskId(anyString());
    String failedTask = SeedanceAnciVideoClient.PREFIX + "73:2";
    var failed = status(failedTask, "failed", "{\"state\":\"failed\",\"is_final\":true,\"cost\":0}");
    assertSame(failed, controller.refresh(7L, failedTask));
    verify(billing).rollbackByTaskId(failedTask);
  }

  @Test void replayingTheSameClientIdReusesTheReceiptAndVersionIsPartOfRequestIdentity() throws Exception {
    var request = request(5, "快速");
    String task = SeedanceAnciVideoClient.PREFIX + "73:123";
    ready(request, task);
    controller.setSubmissions(new VideoTaskSubmissions(mapper, work.toString()));
    var first = controller.create("token", request).data();
    var replay = controller.create("token", request).data();
    assertEquals(first.getTaskId(), replay.getTaskId());
    assertEquals(new BigDecimal("0.00"), replay.getConsumedMi());
    verify(anci, times(1)).validate(request);
    verify(anci, times(1)).createTask(request);
    verify(billing, times(1)).checkAndDeduct(7L, MiBizType.VIDEO, 0);
    verify(history, times(1)).created(eq(7L), eq(request), any(), anyLong());
    assertEquals(409, assertThrows(ApiException.class,
        () -> controller.create("token", request(5, "标准"))).getCode());
    verify(anci, times(1)).createTask(any());
  }

  @Test void anUncertainPostOutcomeIsNeverAutomaticallySubmittedAgain() throws Exception {
    var request = request(5, "快速");
    ready(request, SeedanceAnciVideoClient.PREFIX + "73:123");
    controller.setSubmissions(new VideoTaskSubmissions(mapper, work.toString()));
    when(anci.createTask(request)).thenThrow(new HttpTimeoutException("response timeout"));
    assertThrows(HttpTimeoutException.class, () -> controller.create("token", request));
    var lookup = controller.byClientTaskId(request.clientTaskId(), "token").data();
    assertTrue(lookup.exists());
    assertEquals("unknown", lookup.status());
    assertEquals(409, assertThrows(ApiException.class,
        () -> controller.create("token", request)).getCode());
    verify(anci, times(1)).createTask(request);
    verify(billing, times(1)).checkAndDeduct(7L, MiBizType.VIDEO, 0);
    verify(billing, times(1)).rollback(7L, 9L);
    verifyNoInteractions(legacy, chat, anmiao, minimax, history);
  }
}
