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
import java.math.BigDecimal;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class VideoTaskControllerSeedanceAnciProductCompatibilityTest {
  final VideoGenerationClient legacy = mock(VideoGenerationClient.class);
  final ChatVideoJobs chat = mock(ChatVideoJobs.class);
  final AnmiaoVideoClient anmiao = mock(AnmiaoVideoClient.class);
  final MinimaxVideoClient minimax = mock(MinimaxVideoClient.class);
  final SeedanceAnciVideoClient anci = mock(SeedanceAnciVideoClient.class);
  final AdminAuthService auth = mock(AdminAuthService.class);
  final MiValueService billing = mock(MiValueService.class);
  final ModelApiKeyService keys = mock(ModelApiKeyService.class);
  final VideoTaskHistory history = mock(VideoTaskHistory.class);
  final VideoTaskController controller = new VideoTaskController(legacy, billing, auth, chat, anmiao, minimax, history);
  final ObjectMapper mapper = new ObjectMapper();

  VideoGenerationDtos.CreateTaskRequest input() throws Exception {
    return mapper.readValue("""
        {"prompt":"商品展示","model":"seedance-2.0-anci","ratio":"3:4","resolution":"720p",
         "durationSeconds":15,"version":"标准","feature_code":"product-video-video","generate_audio":true}
        """, VideoGenerationDtos.CreateTaskRequest.class);
  }

  @Test void productRoutingChecksFeatureAndRetainsFlatReportedSettlementForOldPrefix() throws Exception {
    when(auth.requireUserId("token")).thenReturn(7L); controller.setModelApiKeys(keys); controller.setAnciVideos(anci);
    var request = input();
    var credential = new ModelApiKeyService.ResolvedModelApiKey(43L, request.model(), "custom", "https://api.example",
        "/v1/media/generate", "/v1/media/status", "not-used");
    when(keys.resolve(request.model(), "video_generation", "product-video-video")).thenReturn(Optional.of(credential));
    when(billing.checkAndDeduct(7L, MiBizType.VIDEO, 0)).thenReturn(new MiValueDtos.DeductResult(12L, 0, 0, 0, MiBizType.VIDEO));
    String taskId = SeedanceAnciVideoClient.LEGACY_PREFIX + "43:123456";
    var created = new VideoGenerationDtos.CreateTaskResponse(); created.setTaskId(taskId);
    when(anci.createTask(request)).thenReturn(created);
    assertEquals(taskId, controller.create("token", request).data().getTaskId());
    verify(anci).price(request); verify(anci).createTask(request); verify(billing).linkTask(12L, taskId);
    verify(keys).resolve(request.model(), "video_generation", "product-video-video");
    verifyNoInteractions(legacy, anmiao, chat);
    var completed = new VideoGenerationDtos.TaskStatusResponse(); completed.setStatus("completed"); completed.setProvider("arbitrary-label");
    completed.setRaw(mapper.readTree("{\"cost\":0.23}")); when(anci.getTask(taskId, 7L)).thenReturn(completed);
    when(billing.isTaskOwnedByUser(7L, taskId, MiBizType.VIDEO)).thenReturn(true);
    assertSame(completed, controller.get(taskId, "token").data());
    verify(billing).settleActualByTaskId(taskId, new BigDecimal("23.00")); verify(billing, never()).commitByTaskId(anyString());
  }

  @Test void unboundProductModelCannotReachBillingOrBorrowCanvas() throws Exception {
    when(auth.requireUserId("token")).thenReturn(7L); controller.setModelApiKeys(keys); controller.setAnciVideos(anci);
    var request = input();
    assertEquals(400, assertThrows(ApiException.class, () -> controller.create("token", request)).getCode());
    verify(keys).resolve(request.model(), "video_generation", "product-video-video");
    verify(keys, never()).resolve(anyString(), anyString(), eq("canvas-video"));
    verify(anci, never()).price(any()); verify(anci, never()).createTask(any()); verifyNoInteractions(billing, legacy, anmiao, chat);
  }
}
