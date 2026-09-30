package com.youmi.api.video;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ProductVideoPlanJobsTest {
  @TempDir Path dir;
  private final ObjectMapper mapper = new ObjectMapper();
  private final ProductVideoPlanService plans = mock(ProductVideoPlanService.class);
  private final ProductVideoDtos.PlanRequest request = new ProductVideoDtos.PlanRequest("商品", List.of(), 4, "16:9", null, null);
  private final ProductVideoDtos.ShotPlan shot = new ProductVideoDtos.ShotPlan("细节", "首帧", "动作", "", 4, "展示", "策划");
  private final String id = "550e8400-e29b-41d4-a716-446655440000";

  @Test void planningModelIsPersistedAndRetryDoesNotSwitchProvider() throws Exception {
    var selected = new ProductVideoDtos.PlanRequest("商品", List.of(), 1, "16:9", null, null,
        "storyboard", null, false, null, "gem-3.8-flash");
    when(plans.plan(eq(selected), any(), anyList(), any()))
        .thenThrow(new ApiException(502, "temporary upstream error"))
        .thenReturn(new ProductVideoDtos.PlanResponse("lk888", List.of(shot), null));
    var jobs = new ProductVideoPlanJobs(plans, mapper, dir.toString());
    try {
      jobs.create(1L, new ProductVideoPlanJobs.CreateRequest(id, selected));
      assertEquals("failed", finished(jobs).status());
    } finally { jobs.close(); }
    var saved = mapper.readTree(java.nio.file.Files.readString(dir.resolve("1").resolve(id + ".json")));
    assertEquals("gem-3.8-flash", saved.path("request").path("planningModel").asText());
    jobs = new ProductVideoPlanJobs(plans, mapper, dir.toString());
    try {
      var reopened = jobs;
      assertThrows(ApiException.class, () -> reopened.create(1L, new ProductVideoPlanJobs.CreateRequest(id,
          new ProductVideoDtos.PlanRequest("商品", List.of(), 1, "16:9", null, null,
              "storyboard", null, false, null, "default"))));
      jobs.retry(1L, id);
      assertEquals("lk888", finished(jobs).result().provider());
      verify(plans, times(2)).plan(eq(selected), any(), anyList(), any());
    } finally { jobs.close(); }
  }

  private ProductVideoPlanJobs.State finished(ProductVideoPlanJobs jobs) throws Exception {
    long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(4);
    while (System.nanoTime() < until) {
      var state = jobs.get(1L, id);
      if (List.of("failed", "completed").contains(state.status())) return state;
      Thread.sleep(10);
    }
    throw new AssertionError("Job did not finish");
  }

  @Test void submissionIsImmediateIdempotentAndOwnedWithDurableResult() throws Exception {
    var release = new CountDownLatch(1);
    when(plans.plan(eq(request), isNull(), anyList(), any())).thenAnswer(invocation -> {
      assertTrue(release.await(4, TimeUnit.SECONDS));
      return new ProductVideoDtos.PlanResponse("mock", List.of(shot), null);
    });
    var jobs = new ProductVideoPlanJobs(plans, mapper, dir.toString());
    try {
      assertEquals("queued", jobs.create(1L, new ProductVideoPlanJobs.CreateRequest(id, request)).status());
      assertEquals(id, jobs.create(1L, new ProductVideoPlanJobs.CreateRequest(id, request)).id());
      assertEquals(404, assertThrows(ApiException.class, () -> jobs.get(2L, id)).getCode());
      assertEquals(404, assertThrows(ApiException.class, () -> jobs.get(1L, "../../escape")).getCode());
      assertEquals(409, assertThrows(ApiException.class, () -> jobs.create(1L,
          new ProductVideoPlanJobs.CreateRequest("another-job-id", request))).getCode());
      release.countDown();
      assertEquals("completed", finished(jobs).status());
      var reopened = new ProductVideoPlanJobs(plans, mapper, dir.toString());
      try { assertEquals(List.of(shot), reopened.get(1L, id).result().shots()); }
      finally { reopened.close(); }
      verify(plans, times(1)).plan(eq(request), isNull(), anyList(), any());
    } finally { release.countDown(); jobs.close(); }
  }

  @Test void retryKeepsSavedOutlineAndShotsAndDoesNotRerunCompletedTasks() throws Exception {
    var outline = mapper.createObjectNode().put("analysis", "分析").put("concept", "整片思路");
    when(plans.plan(eq(request), any(), anyList(), any())).thenAnswer(invocation -> {
      ProductVideoPlanService.ProgressListener progress = invocation.getArgument(3);
      List<ProductVideoDtos.ShotPlan> existing = invocation.getArgument(2);
      if (existing.isEmpty()) {
        progress.save("镜头 3-4 提示词展开", outline, List.of(shot, shot), "mock");
        progress.response("details-2", "saved provider response");
        throw new ApiException(504, "最后一段超时");
      }
      assertEquals(outline, invocation.getArgument(1));
      assertEquals(2, existing.size());
      assertEquals("saved provider response", progress.previousResponse("details-2"));
      assertNull(progress.previousResponse("details-0"));
      return new ProductVideoDtos.PlanResponse("mock", List.of(shot, shot, shot, shot), null);
    });
    var jobs = new ProductVideoPlanJobs(plans, mapper, dir.toString());
    try {
      jobs.create(1L, new ProductVideoPlanJobs.CreateRequest(id, request));
      var failed = finished(jobs);
      assertEquals("failed", failed.status());
      assertEquals(2, failed.result().shots().size());
      assertEquals("最后一段超时", failed.error());
      jobs.retry(1L, id);
      assertEquals(4, finished(jobs).result().shots().size());
      assertEquals("completed", jobs.retry(1L, id).status());
      verify(plans, times(2)).plan(eq(request), any(), anyList(), any());
    } finally { jobs.close(); }
  }

  @Test void interruptedJobsRetainCheckpointWithoutAutomaticallyResubmitting() throws Exception {
    var state = new ProductVideoPlanJobs.State(id, "processing", "镜头 3-4", 4, "",
        new ProductVideoDtos.PlanResponse("mock", List.of(shot, shot), null), 1);
    java.nio.file.Files.createDirectories(dir.resolve("1"));
    java.nio.file.Files.writeString(dir.resolve("1").resolve(id + ".json"), mapper.writeValueAsString(
        new ProductVideoPlanJobs.Saved(state, request, mapper.createObjectNode(), java.util.Map.of())));
    var jobs = new ProductVideoPlanJobs(plans, mapper, dir.toString());
    try {
      assertEquals("failed", jobs.get(1L, id).status());
      assertEquals(2, jobs.get(1L, id).result().shots().size());
      verifyNoInteractions(plans);
    } finally { jobs.close(); }
  }

  @Test void wholeVideoModeAndTimelineSurviveRestartAndRemainIdempotent() throws Exception {
    var wholeRequest = new ProductVideoDtos.PlanRequest("商品", List.of(), 1, "16:9", null, null, "single_video", 2);
    var timeline = List.of(new ProductVideoDtos.TimelineBeat(0, 5, "开场", "中景", "推进"),
        new ProductVideoDtos.TimelineBeat(5, 15, "展示与收尾", "近景到全景", "结束"));
    var full = new ProductVideoDtos.ShotPlan("整片", "首帧", "0-5 秒开场\n5-15 秒展示与收尾", "", 15, "完整展示", "策划", "single_video", timeline);
    when(plans.plan(eq(wholeRequest), isNull(), anyList(), any()))
        .thenReturn(new ProductVideoDtos.PlanResponse("mock", List.of(full), null));
    var jobs = new ProductVideoPlanJobs(plans, mapper, dir.toString());
    try {
      jobs.create(1L, new ProductVideoPlanJobs.CreateRequest(id, wholeRequest));
      assertEquals("整片策划已完成", finished(jobs).stage());
      var reopened = new ProductVideoPlanJobs(plans, mapper, dir.toString());
      try {
        assertEquals(List.of(full), reopened.get(1L, id).result().shots());
        assertEquals("completed", reopened.create(1L, new ProductVideoPlanJobs.CreateRequest(id, wholeRequest)).status());
        assertEquals("completed", reopened.retry(1L, id).status());
        var changedCount = new ProductVideoDtos.PlanRequest("商品", List.of(), 1, "16:9", null, null, "single_video", 4);
        assertEquals(409, assertThrows(ApiException.class, () -> reopened.create(1L, new ProductVideoPlanJobs.CreateRequest(id, changedCount))).getCode());
        var otherMode = new ProductVideoDtos.PlanRequest("商品", List.of(), 1, "16:9", null, null);
        assertEquals(409, assertThrows(ApiException.class, () -> reopened.create(1L, new ProductVideoPlanJobs.CreateRequest(id, otherMode))).getCode());
      } finally { reopened.close(); }
      verify(plans, times(1)).plan(eq(wholeRequest), isNull(), anyList(), any());
    } finally { jobs.close(); }
  }
}
