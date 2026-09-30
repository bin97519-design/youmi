package com.youmi.api.video;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import com.youmi.api.credit.MiBizType;
import com.youmi.api.credit.MiValueDtos;
import com.youmi.api.credit.MiValueService;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ChatVideoJobsTest {
  @TempDir Path directory;
  final ObjectMapper mapper = new ObjectMapper();
  final ChatVideoClient client = mock(ChatVideoClient.class);
  final VideoGenerationClient media = mock(VideoGenerationClient.class);
  final VideoGenerationProperties config = new VideoGenerationProperties();
  final MiValueService billing = mock(MiValueService.class);

  ChatVideoJobs jobs() throws Exception {
    config.setPersistGeneratedVideos(false);
    when(billing.checkAndDeduct(1L, MiBizType.VIDEO)).thenReturn(new MiValueDtos.DeductResult(1L, 0, 0, 50, MiBizType.VIDEO));
    when(client.taskState(anyString())).thenReturn(new ChatVideoClient.TaskState("", "completed", 100));
    return new ChatVideoJobs(client, media, config, billing, mapper, directory.toString());
  }

  @Test void acceptsImmediatelyAndPersistsCompletionWithoutRepeatingGenerationOrBilling() throws Exception {
    var gate = new CountDownLatch(1);
    when(client.generate(any())).thenAnswer(call -> { assertTrue(gate.await(5, TimeUnit.SECONDS)); return "raw-video-result"; });
    when(client.resultUrl("raw-video-result")).thenReturn("https://result.test/a.mp4");
    var jobs = jobs();
    String id;
    try {
      var result = jobs.create(1L, ChatVideoClientTest.request());
      id = result.getTaskId();
      assertEquals("queued", result.getStatus());
      assertNull(jobs.get(1L, id).getProgress(), "Submission has no provider percentage yet");
      assertEquals(id, jobs.create(1L, ChatVideoClientTest.request()).getTaskId());
      assertThrows(ApiException.class, () -> jobs.get(2L, id));
      gate.countDown();
      var done = waitFor(jobs, id, "completed");
      assertEquals("https://result.test/a.mp4", done.getVideoUrls().get(0));
      assertNull(done.getRaw());
      verify(billing, times(1)).checkAndDeduct(1L, MiBizType.VIDEO);
      verify(client, times(1)).generate(any());
    } finally { gate.countDown(); jobs.close(); }
    var reopened = jobs();
    try {
      assertEquals("completed", reopened.get(1L, id).getStatus());
      assertEquals(id, reopened.create(1L, ChatVideoClientTest.request()).getTaskId());
      verify(client, times(1)).generate(any());
      verify(billing, times(1)).checkAndDeduct(1L, MiBizType.VIDEO);
    } finally { reopened.close(); }
  }

  @Test void rejectsInaccessibleModelBeforeAnyChargeOrJobCreation() throws Exception {
    var jobs = jobs();
    try {
      doThrow(new ApiException(503, "group unavailable")).when(client).checkAccess();
      assertThrows(ApiException.class, () -> jobs.create(1L, ChatVideoClientTest.request()));
      verifyNoInteractions(billing);
      verify(client, never()).generate(any());
      assertFalse(Files.exists(directory.resolve("1")));
    } finally { jobs.close(); }
  }

  @Test void malformedProviderResultFailsAndKeepsRawResponseWithoutAutoRetry() throws Exception {
    var jobs = jobs();
    try {
      when(client.generate(any())).thenReturn("unrecognized-provider-output");
      when(client.resultUrl(any())).thenThrow(new ApiException(502, "no video result"));
      var id = jobs.create(1L, ChatVideoClientTest.request()).getTaskId();
      assertEquals("no video result", waitFor(jobs, id, "failed").getError());
      assertTrue(Files.readString(directory.resolve("1").resolve(id.substring(ChatVideoJobs.PREFIX.length()) + ".json")).contains("unrecognized-provider-output"));
      jobs.get(1L, id);
      jobs.create(1L, ChatVideoClientTest.request());
      verify(client, times(1)).generate(any());
      verify(billing, timeout(1000)).rollbackByTaskId(id);
      verify(billing, never()).commitByTaskId(anyString());
    } finally { jobs.close(); }
  }

  @Test void restartDoesNotResubmitAnInterruptedUpstreamRequest() throws Exception {
    var jobs = jobs();
    String id = "00000000-0000-0000-0000-000000000001";
    Files.createDirectories(directory.resolve("1"));
    Files.writeString(directory.resolve("1").resolve(id + ".json"), mapper.writeValueAsString(
        new ChatVideoJobs.Saved(id, ChatVideoClientTest.request(), "processing", "", "", "", 50)));
    try {
      assertEquals("failed", jobs.get(1L, ChatVideoJobs.PREFIX + id).getStatus());
      verify(client, never()).generate(any());
      verify(billing).rollbackByTaskId(ChatVideoJobs.PREFIX + id);
    } finally { jobs.close(); }
  }

  @Test void providerHttpFailureIsPersistedWithoutRetryingOrExposingRawData() throws Exception {
    var failure = new ChatVideoClient.ProviderFailure("提交视频", "POST", "https://provider.test/v1/chat/completions", 404, "req-test", "application/json");
    when(client.generate(any())).thenThrow(new ChatVideoClient.ProviderException(502, "upstream route missing", failure, "{\"error\":\"upstream missing\"}"));
    String id;
    var jobs = jobs();
    try {
      id = jobs.create(1L, ChatVideoClientTest.request()).getTaskId();
      var state = waitFor(jobs, id, "failed");
      assertEquals("upstream route missing", state.getError());
      assertNull(state.getRaw());
      var saved = mapper.readValue(Files.readString(directory.resolve("1").resolve(id.substring(ChatVideoJobs.PREFIX.length()) + ".json")), ChatVideoJobs.Saved.class);
      assertEquals(404, saved.failure().httpStatus());
      assertEquals("req-test", saved.failure().requestId());
      assertEquals("{\"error\":\"upstream missing\"}", saved.raw());
      verify(billing, timeout(1000)).rollbackByTaskId(id);
    } finally { jobs.close(); }
    var reopened = jobs();
    try {
      assertEquals("failed", reopened.get(1L, id).getStatus());
      assertEquals(id, reopened.create(1L, ChatVideoClientTest.request()).getTaskId());
      verify(client, times(1)).generate(any());
      verify(billing, times(1)).checkAndDeduct(1L, MiBizType.VIDEO);
      verify(client, never()).resultUrl(anyString());
    } finally { reopened.close(); }
  }

  @Test void queuedVideoIsPolledAndOnlyCompletedAfterTheProviderReturnsAResult() throws Exception {
    var jobs = jobs();
    var gate = new CountDownLatch(1);
    when(client.generate(any())).thenReturn("queued-video");
    when(client.taskState("queued-video")).thenReturn(new ChatVideoClient.TaskState("upstream-1", "processing", 42));
    when(client.poll("upstream-1")).thenAnswer(call -> { assertTrue(gate.await(5, TimeUnit.SECONDS)); return "completed-video"; });
    when(client.resultUrl("completed-video")).thenReturn("https://result.test/a.mp4");
    try {
      String id = jobs.create(1L, ChatVideoClientTest.request()).getTaskId();
      verify(client, timeout(1000)).poll("upstream-1");
      assertEquals(42, jobs.get(1L, id).getProgress());
      assertEquals("中转站生成中", jobs.get(1L, id).getStage());
      verify(billing, never()).commitByTaskId(anyString());
      verify(billing, never()).rollbackByTaskId(anyString());
      gate.countDown();
      assertEquals("https://result.test/a.mp4", waitFor(jobs, id, "completed").getVideoUrls().get(0));
      verify(client, times(1)).generate(any());
      verify(billing, timeout(1000)).commitByTaskId(id);
    } finally { gate.countDown(); jobs.close(); }
  }

  @Test void restartResumesAnAcceptedTaskWithoutSubmittingOrChargingAgain() throws Exception {
    var jobs = jobs();
    String id = "00000000-0000-0000-0000-000000000002";
    Files.createDirectories(directory.resolve("1"));
    Files.writeString(directory.resolve("1").resolve(id + ".json"), mapper.writeValueAsString(
        new ChatVideoJobs.Saved(id, ChatVideoClientTest.request(), "processing", "saved-task", "", "", 50)));
    when(client.taskState("saved-task")).thenReturn(new ChatVideoClient.TaskState("upstream-2", "queued", 0));
    when(client.poll("upstream-2")).thenReturn("finished-task");
    when(client.resultUrl("finished-task")).thenReturn("https://result.test/b.mp4");
    try {
      assertEquals("https://result.test/b.mp4", waitFor(jobs, ChatVideoJobs.PREFIX + id, "completed").getVideoUrls().get(0));
      verify(client, never()).generate(any());
      verify(billing, never()).checkAndDeduct(anyLong(), any());
      verify(client, times(1)).poll("upstream-2");
    } finally { jobs.close(); }
  }

  @Test void upstreamTaskFailureIsShownAndRefundedWithoutResubmission() throws Exception {
    var jobs = jobs();
    when(client.generate(any())).thenReturn("queued-video");
    when(client.taskState("queued-video")).thenReturn(new ChatVideoClient.TaskState("upstream-3", "queued", 0));
    when(client.poll("upstream-3")).thenReturn("failed-video-response");
    when(client.taskState("failed-video-response")).thenThrow(new ApiException(502, "provider generation failed"));
    try {
      String id = jobs.create(1L, ChatVideoClientTest.request()).getTaskId();
      assertEquals("provider generation failed", waitFor(jobs, id, "failed").getError());
      assertEquals("生成失败", jobs.get(1L, id).getStage());
      assertNull(jobs.get(1L, id).getProgress());
      var saved = mapper.readValue(Files.readString(directory.resolve("1").resolve(id.substring(ChatVideoJobs.PREFIX.length()) + ".json")), ChatVideoJobs.Saved.class);
      assertEquals("failed-video-response", saved.raw());
      verify(billing, timeout(1000)).rollbackByTaskId(id);
      verify(billing, never()).commitByTaskId(anyString());
      verify(client, times(1)).generate(any());
    } finally { jobs.close(); }
  }

  @Test void transientPollingFailureKeepsTheOriginalTaskAndDoesNotRefundIt() throws Exception {
    var jobs = jobs();
    var gate = new CountDownLatch(1);
    when(client.generate(any())).thenReturn("queued-video");
    when(client.taskState("queued-video")).thenReturn(new ChatVideoClient.TaskState("upstream-4", "queued", 0));
    when(client.poll("upstream-4")).thenThrow(new java.io.IOException("temporary connection loss"))
        .thenAnswer(call -> { assertTrue(gate.await(5, TimeUnit.SECONDS)); return "done-video"; });
    when(client.resultUrl("done-video")).thenReturn("https://result.test/c.mp4");
    try {
      String id = jobs.create(1L, ChatVideoClientTest.request()).getTaskId();
      for (int i = 0; i < 100; i++) { jobs.get(1L, id); Thread.sleep(10); }
      verify(client, times(2)).poll("upstream-4");
      verify(billing, never()).rollbackByTaskId(anyString());
      gate.countDown();
      waitFor(jobs, id, "completed");
      verify(client, times(1)).generate(any());
    } finally { gate.countDown(); jobs.close(); }
  }

  private VideoGenerationDtos.TaskStatusResponse waitFor(ChatVideoJobs jobs, String id, String status) throws Exception {
    for (int i = 0; i < 200; i++) {
      var state = jobs.get(1L, id);
      if (status.equals(state.getStatus())) return state;
      Thread.sleep(10);
    }
    fail("Job did not become " + status);
    return null;
  }
}
