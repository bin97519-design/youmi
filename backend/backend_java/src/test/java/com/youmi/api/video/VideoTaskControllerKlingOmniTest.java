package com.youmi.api.video;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
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

/** No real provider, credentials, or billing database are used by these routing tests. */
class VideoTaskControllerKlingOmniTest {
  private final VideoGenerationClient legacy = mock(VideoGenerationClient.class);
  private final ChatVideoJobs chat = mock(ChatVideoJobs.class);
  private final AnmiaoVideoClient anmiao = mock(AnmiaoVideoClient.class);
  private final MinimaxVideoClient minimax = mock(MinimaxVideoClient.class);
  private final SeedanceAnciVideoClient anci = mock(SeedanceAnciVideoClient.class);
  private final KlingOmniVideoClient omni = mock(KlingOmniVideoClient.class);
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
    controller.setKlingOmniVideos(omni);
  }

  private VideoGenerationDtos.CreateTaskRequest request(String quality) throws Exception {
    return mapper.readValue("""
        {"model":"model-api-key:73","prompt":"参考角色在海边漫步","feature_code":"canvas-video",
         "parameter_profile":"canvas-v3-kling-omni","client_task_id":"omni-request-1",
         "omni_params":{"mode":"%s","duration":"5","aspect_ratio":"16:9"},
         "reference_image_urls":["https://assets.example/first.png","https://assets.example/second.png"],
         "reference_videos":[],"reference_audios":[]}
        """.formatted(quality), VideoGenerationDtos.CreateTaskRequest.class);
  }

  private ObjectNode json(VideoGenerationDtos.CreateTaskRequest request) {
    return mapper.valueToTree(request);
  }

  private VideoGenerationDtos.CreateTaskRequest request(ObjectNode value) throws Exception {
    return mapper.treeToValue(value, VideoGenerationDtos.CreateTaskRequest.class);
  }

  private void ready(VideoGenerationDtos.CreateTaskRequest request, String taskId) throws Exception {
    when(omni.supports(request.model(), request.featureCode())).thenReturn(true);
    when(billing.checkAndDeduct(7L, MiBizType.VIDEO, 0))
        .thenReturn(new MiValueDtos.DeductResult(9L, 0, 0, 0, MiBizType.VIDEO));
    var created = new VideoGenerationDtos.CreateTaskResponse();
    created.setTaskId(taskId);
    created.setModel(request.model());
    created.setStatus("queued");
    created.setProvider("custom Omni channel");
    when(omni.createTask(request)).thenReturn(created);
  }

  private VideoGenerationDtos.TaskStatusResponse status(String taskId, String status, String raw)
      throws Exception {
    var result = new VideoGenerationDtos.TaskStatusResponse();
    result.setTaskId(taskId);
    result.setStatus(status);
    result.setProvider("custom provider label does not determine pricing");
    result.setVideoUrls("completed".equals(status) ? List.of("https://oss.example/result.mp4") : List.of());
    result.setRaw(mapper.readTree(raw));
    when(billing.isTaskOwnedByUser(7L, taskId, MiBizType.VIDEO)).thenReturn(true);
    when(omni.getTask(taskId, 7L)).thenReturn(result);
    return result;
  }

  @Test void allThreeDocumentedModelsUseOmniZeroHoldAndNeverUseAnotherAdapter() throws Exception {
    for (String model : List.of("kling-v3-omni-cankao", "kling-v3-omni-videoref", "kling-v3-omni-shouweizhen")) {
      ObjectNode input = json(request("std")).put("model", model);
      if (model.endsWith("videoref")) {
        ((ObjectNode) input.path("omni_params")).put("refer_type", "feature");
        input.withArray("reference_videos").addObject().put("url", "https://assets.example/reference.mp4")
            .put("durationSeconds", 5);
      } else if (model.endsWith("shouweizhen")) {
        ((ObjectNode) input.path("omni_params")).remove("aspect_ratio");
      }
      var request = request(input);
      String task = KlingOmniVideoClient.PREFIX + "73:" + model.length();
      ready(request, task);
      var result = controller.create("token", request).data();
      assertEquals(task, result.getTaskId());
      assertEquals(new BigDecimal("0.00"), result.getConsumedMi());
      verify(omni).validate(request);
      verify(omni).createTask(request);
      verify(billing).linkTask(9L, task);
      verify(history).created(eq(7L), eq(request), same(result), anyLong());
    }
    verify(billing, times(3)).checkAndDeduct(7L, MiBizType.VIDEO, 0);
    verify(billing, never()).commit(anyLong());
    verifyNoInteractions(legacy, chat, anmiao, minimax);
    verify(anci, never()).createTask(any());
  }

  @Test void unmatchedOmniProfileFailsBeforeBillingOrAnyProviderSubmission() throws Exception {
    var request = request("std");
    when(omni.supports(request.model(), "canvas-video")).thenReturn(false);
    assertEquals(400, assertThrows(ApiException.class,
        () -> controller.create("token", request)).getCode());
    verify(omni, never()).validate(any());
    verify(omni, never()).createTask(any());
    verifyNoInteractions(billing, legacy, chat, anmiao, minimax, history);
  }

  @Test void missingOrOtherProfileCannotBypassOmniForNativeOrManagedIdentity() throws Exception {
    for (String model : List.of("kling-v3-omni-cankao", "kling-v3-omni-videoref",
        "kling-v3-omni-shouweizhen", "model-api-key:73")) {
      for (String profile : List.of("", "canvas-v3-seedance20-anci", "canvas-v3-minimax-h3")) {
        ObjectNode input = json(request("std")).put("model", model);
        if (profile.isBlank()) input.remove("parameter_profile");
        else input.put("parameter_profile", profile);
        when(omni.supports(model, "canvas-video")).thenReturn(model.startsWith("model-api-key:"));
        var invalid = request(input);
        assertEquals(400, assertThrows(ApiException.class,
            () -> controller.create("token", invalid)).getCode(), model + " / " + profile);
      }
    }
    verify(omni, never()).validate(any());
    verify(omni, never()).createTask(any());
    verifyNoInteractions(billing, legacy, chat, anmiao, minimax, history);
  }

  @Test void validationRunsBeforeHoldAndProviderRejectionRollsBackTheHoldExactlyOnce() throws Exception {
    var request = request("std");
    when(omni.supports(request.model(), "canvas-video")).thenReturn(true);
    doThrow(new ApiException(400, "视频参考需要一个视频")).when(omni).validate(request);
    assertEquals(400, assertThrows(ApiException.class,
        () -> controller.create("token", request)).getCode());
    verifyNoInteractions(billing);
    doNothing().when(omni).validate(request);
    ready(request, KlingOmniVideoClient.PREFIX + "73:123");
    when(omni.createTask(request)).thenThrow(new ApiException(422, "provider rejected request"));
    assertEquals(422, assertThrows(ApiException.class,
        () -> controller.create("token", request)).getCode());
    verify(billing, times(1)).rollback(7L, 9L);
    verify(billing, never()).linkTask(anyLong(), anyString());
    verifyNoInteractions(legacy, chat, anmiao, minimax, history);
  }

  @Test void unauthenticatedCreateAndForeignTaskNeverReachTheOmniProvider() throws Exception {
    when(auth.requireUserId("unauthorized")).thenThrow(new ApiException(401, "需要登录"));
    var request = request("std");
    assertEquals(401, assertThrows(ApiException.class,
        () -> controller.create("unauthorized", request)).getCode());
    String task = KlingOmniVideoClient.PREFIX + "73:123";
    assertEquals(404, assertThrows(ApiException.class,
        () -> controller.get(task, "token")).getCode());
    verify(billing).isTaskOwnedByUser(7L, task, MiBizType.VIDEO);
    verifyNoInteractions(omni, legacy, chat, anmiao, minimax, history);
  }

  @Test void persistedSuccessSettlesReportedActualCostEvenWithACustomProviderLabel() throws Exception {
    String task = KlingOmniVideoClient.PREFIX + "73:123";
    var completed = status(task, "completed", "{\"state\":\"success\",\"is_final\":true,\"cost\":0.23}");
    assertSame(completed, controller.get(task, "token").data());
    verify(omni).getTask(task, 7L);
    verify(billing).settleActualByTaskId(task, new BigDecimal("23.00"));
    verify(billing, never()).commitByTaskId(anyString());
    verify(billing, never()).rollbackByTaskId(anyString());
    verify(history).status(7L, completed);
    verifyNoInteractions(legacy, chat, anmiao, minimax);
  }

  @Test void absentNegativeOrMalformedActualCostCannotBecomeFreeCompletion() throws Exception {
    int suffix = 0;
    for (String raw : List.of("{}", "{\"cost\":null}", "{\"cost\":-0.23}", "{\"cost\":\"invalid\"}",
        "{\"unrelated\":{\"cost\":0.23}}")) {
      String task = KlingOmniVideoClient.PREFIX + "73:" + (++suffix);
      var completed = status(task, "completed", raw);
      assertEquals("processing", controller.refresh(7L, task).getStatus());
      assertNotNull(completed.getStage());
      verify(history).status(7L, completed);
    }
    verify(billing, never()).settleActualByTaskId(anyString(), any());
    verify(billing, never()).commitByTaskId(anyString());
    verify(billing, never()).rollbackByTaskId(anyString());
  }

  @Test void validZeroActualCostIsSettledRatherThanTreatedAsMissing() throws Exception {
    String task = KlingOmniVideoClient.PREFIX + "73:124";
    var completed = status(task, "completed", "{\"cost\":0}");
    assertEquals("completed", controller.refresh(7L, task).getStatus());
    verify(billing).settleActualByTaskId(task, new BigDecimal("0.00"));
    verify(history).status(7L, completed);
  }

  @Test void savingAndNonFinalResponsesNeverSettleOrRollbackWhileFailureDoes() throws Exception {
    for (String state : List.of("processing", "persisting")) {
      String task = KlingOmniVideoClient.PREFIX + "73:" + state.length();
      var pending = status(task, state, "{\"state\":\"success\",\"is_final\":true,\"cost\":0.23}");
      assertSame(pending, controller.refresh(7L, task));
      verify(history).status(7L, pending);
    }
    verify(billing, never()).settleActualByTaskId(anyString(), any());
    verify(billing, never()).commitByTaskId(anyString());
    verify(billing, never()).rollbackByTaskId(anyString());
    String failedTask = KlingOmniVideoClient.PREFIX + "73:2";
    var failed = status(failedTask, "failed", "{\"state\":\"failed\",\"is_final\":true,\"cost\":0}");
    assertSame(failed, controller.refresh(7L, failedTask));
    verify(billing).rollbackByTaskId(failedTask);
  }

  @Test void sameClientIdReusesReceiptAndOmniParametersParticipateInIdempotentIdentity() throws Exception {
    var request = request("std");
    String task = KlingOmniVideoClient.PREFIX + "73:123";
    ready(request, task);
    controller.setSubmissions(new VideoTaskSubmissions(mapper, work.toString()));
    var first = controller.create("token", request).data();
    var replay = controller.create("token", request).data();
    assertEquals(first.getTaskId(), replay.getTaskId());
    assertEquals(new BigDecimal("0.00"), replay.getConsumedMi());
    verify(omni, times(1)).validate(request);
    verify(omni, times(1)).createTask(request);
    verify(billing, times(1)).checkAndDeduct(7L, MiBizType.VIDEO, 0);
    verify(history, times(1)).created(eq(7L), eq(request), any(), anyLong());
    assertEquals(409, assertThrows(ApiException.class,
        () -> controller.create("token", request("pro"))).getCode());
    verify(omni, times(1)).createTask(any());
  }

  @Test void uncertainPostResponseIsRecordedUnknownAndNeverRepostedAutomatically() throws Exception {
    var request = request("std");
    ready(request, KlingOmniVideoClient.PREFIX + "73:123");
    controller.setSubmissions(new VideoTaskSubmissions(mapper, work.toString()));
    when(omni.createTask(request)).thenThrow(new HttpTimeoutException("response timeout"));
    assertThrows(HttpTimeoutException.class, () -> controller.create("token", request));
    var lookup = controller.byClientTaskId(request.clientTaskId(), "token").data();
    assertTrue(lookup.exists());
    assertEquals("unknown", lookup.status());
    assertEquals(409, assertThrows(ApiException.class,
        () -> controller.create("token", request)).getCode());
    verify(omni, times(1)).createTask(request);
    verify(billing, times(1)).checkAndDeduct(7L, MiBizType.VIDEO, 0);
    verify(billing, times(1)).rollback(7L, 9L);
    verifyNoInteractions(legacy, chat, anmiao, minimax, history);
  }
}
