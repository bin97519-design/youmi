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
import org.junit.jupiter.api.Test;

class VideoTaskControllerMinimaxV3Test {
  private final VideoGenerationClient legacy = mock(VideoGenerationClient.class);
  private final ChatVideoJobs chat = mock(ChatVideoJobs.class);
  private final AnmiaoVideoClient anmiao = mock(AnmiaoVideoClient.class);
  private final MinimaxVideoClient minimax = mock(MinimaxVideoClient.class);
  private final AdminAuthService auth = mock(AdminAuthService.class);
  private final MiValueService billing = mock(MiValueService.class);
  private final VideoTaskHistory history = mock(VideoTaskHistory.class);
  private final VideoTaskController controller = new VideoTaskController(legacy, billing, auth, chat, anmiao, minimax, history);
  private final ObjectMapper mapper = new ObjectMapper();

  private VideoGenerationDtos.CreateTaskRequest request() throws Exception {
    return mapper.readValue("""
        {"model":"model-api-key:73","prompt":"白鹭掠过湖面","feature_code":"canvas-video",
        "parameter_profile":"canvas-v3-minimax-h3","mode":"cankaosheng","resolution":"768P",
        "durationSeconds":5,"ratio":"16:9","reference_image_urls":["https://assets.example/ref.png"],
        "reference_videos":[{"url":"https://assets.example/ref.mp4","durationSeconds":5.0}],
        "reference_audios":["https://assets.example/ref.mp3"]}
        """, VideoGenerationDtos.CreateTaskRequest.class);
  }

  @Test void opaqueV3H3RouteAndAllReferenceRolesReachOnlyMinimaxAndKeepActualCostSettlement() throws Exception {
    when(auth.requireUserId("token")).thenReturn(7L);
    var request = request();
    when(minimax.supportsCanvasV3H3(request.model(), "canvas-video")).thenReturn(true);
    doReturn(0).when(minimax).price(request);
    when(billing.checkAndDeduct(7L, MiBizType.VIDEO, 0))
        .thenReturn(new MiValueDtos.DeductResult(9L, 0, 0, 0, MiBizType.VIDEO));
    var created = new VideoGenerationDtos.CreateTaskResponse();
    created.setTaskId("minimax-h3:key:73:0009007199254740993100009");
    created.setModel(request.model());
    when(minimax.createTask(request)).thenReturn(created);

    assertSame(created, controller.create("token", request).data());
    verify(minimax).createTask(request);
    verify(billing).linkTask(9L, created.getTaskId());
    verify(billing, never()).commit(anyLong());
    verify(history).created(eq(7L), eq(request), eq(created), anyLong());
    verifyNoInteractions(legacy, chat, anmiao);

    when(billing.isTaskOwnedByUser(7L, created.getTaskId(), MiBizType.VIDEO)).thenReturn(true);
    var completed = new VideoGenerationDtos.TaskStatusResponse();
    completed.setStatus("completed");
    completed.setProvider("Custom channel, not a billing rule");
    completed.setRaw(mapper.readTree("{\"state\":\"success\",\"is_final\":true,\"cost\":0.42}"));
    when(minimax.getTask(created.getTaskId(), 7L)).thenReturn(completed);
    controller.get(created.getTaskId(), "token");
    verify(billing).settleActualByTaskId(created.getTaskId(), new BigDecimal("42.00"));
    verify(billing, never()).commitByTaskId(created.getTaskId());
  }

  @Test void mismatchedH3ProfileCannotFallBackToOtherProvidersOrCharge() throws Exception {
    when(auth.requireUserId("token")).thenReturn(7L);
    var request = request();
    when(minimax.supportsCanvasV3H3(request.model(), "canvas-video")).thenReturn(false);
    assertEquals(400, assertThrows(ApiException.class, () -> controller.create("token", request)).getCode());
    verifyNoInteractions(billing, legacy, chat, anmiao, history);
    verify(minimax, never()).createTask(any());
    verify(minimax, never()).price(any());
  }

  @Test void missingH3RateFailsBeforeBillingAndARejectedPostRollsBackExactlyOnce() throws Exception {
    when(auth.requireUserId("token")).thenReturn(7L);
    var request = request();
    when(minimax.supportsCanvasV3H3(request.model(), "canvas-video")).thenReturn(true);
    when(minimax.price(request)).thenThrow(new ApiException(503, "input rate missing"));
    assertEquals(503, assertThrows(ApiException.class, () -> controller.create("token", request)).getCode());
    verifyNoInteractions(billing);
    doReturn(0).when(minimax).price(request);
    when(billing.checkAndDeduct(7L, MiBizType.VIDEO, 0))
        .thenReturn(new MiValueDtos.DeductResult(9L, 0, 0, 0, MiBizType.VIDEO));
    when(minimax.createTask(request)).thenThrow(new ApiException(502, "provider rejected request"));
    assertEquals(502, assertThrows(ApiException.class, () -> controller.create("token", request)).getCode());
    verify(billing, times(1)).rollback(7L, 9L);
    verify(billing, never()).linkTask(anyLong(), anyString());
    verifyNoInteractions(legacy, chat, anmiao, history);
  }
}
