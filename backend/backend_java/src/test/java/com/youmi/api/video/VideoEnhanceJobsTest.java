package com.youmi.api.video;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import com.youmi.api.credit.MiBizType;
import com.youmi.api.credit.MiValueDtos;
import com.youmi.api.credit.MiValueService;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static com.youmi.api.video.VideoEnhanceDtos.*;

class VideoEnhanceJobsTest {
  @TempDir Path temp;
  final VideoEnhanceClient client = mock(VideoEnhanceClient.class);
  final VideoEnhanceMedia media = mock(VideoEnhanceMedia.class);
  final VideoEnhanceProperties config = new VideoEnhanceProperties();
  final MiValueService billing = mock(MiValueService.class);
  final ObjectMapper mapper = new ObjectMapper();
  VideoEnhanceJobs jobs;
  @BeforeEach void setup() throws Exception {
    config.setApiKey("test-only");
    jobs = new VideoEnhanceJobs(client, media, config, billing, mapper, temp.toString());
    when(media.available()).thenReturn(true);
    when(media.ownedObject(1L, "https://owned.test/source.mp4")).thenReturn("users/1/source.mp4");
    when(media.inspect(eq("users/1/source.mp4"), any())).thenAnswer(invocation -> {
      Path source = invocation.getArgument(1);
      Files.createDirectories(source.getParent()); Files.writeString(source, "test video bytes");
      return new Metadata(15.2, 1280, 720);
    });
    when(media.publishSource(eq(1L), any(), any())).thenReturn("https://owned.test/snapshot.mp4");
    when(billing.checkAndDeduct(eq(1L), eq(MiBizType.VIDEO), anyInt())).thenReturn(new MiValueDtos.DeductResult(4L, 0, 0, 7, MiBizType.VIDEO));
    when(client.create(anyString(), any())).thenReturn("123456");
    when(client.poll("123456")).thenReturn(new VideoEnhanceClient.State(false, "running", 45, "处理中", "", ""));
  }
  @AfterEach void close() { jobs.close(); }
  Task quote() throws Exception {
    return jobs.quote(1L, new QuoteRequest("https://owned.test/source.mp4", VideoEnhanceClientTest.settings("standard")));
  }
  @Test void quoteUsesProbedDurationAndCreateIsIdempotent() throws Exception {
    Task quote = quote();
    assertEquals(7, quote.price());
    assertEquals(15.2, quote.metadata().duration());
    verifyNoInteractions(billing);
    Task first = jobs.create(1L, quote.id());
    assertEquals("123456", first.providerTaskId());
    assertEquals(first, jobs.create(1L, quote.id()));
    verify(client, times(1)).create(anyString(), any());
    verify(billing, times(1)).checkAndDeduct(1L, MiBizType.VIDEO, 7);
    verify(billing).linkTask(4L, VideoEnhanceJobs.PREFIX + quote.id());
    assertFalse(Files.exists(temp.resolve("1/" + quote.id() + ".source")));
  }
  @Test void unavailableKeyDoesNotInspectOrBill() {
    doThrow(new ApiException(503, "missing key")).when(client).requireConfigured();
    assertThrows(ApiException.class, this::quote);
    verifyNoInteractions(media, billing);
  }
  @Test void lostSubmissionResponseNeverResubmitsOrMarksKnownFailure() throws Exception {
    Task quote = quote();
    when(client.create(anyString(), any())).thenThrow(new IOException("response lost"));
    Task task = jobs.create(1L, quote.id());
    assertEquals("unknown", task.status());
    assertEquals(task, jobs.create(1L, task.id()));
    jobs.get(1L, task.id());
    verify(client, times(1)).create(anyString(), any());
    verify(billing, never()).rollback(any(), any());
    verify(billing, never()).commitByTaskId(any());
  }
  @Test void rejectedSubmissionRollsBackWithoutRetry() throws Exception {
    Task quote = quote();
    when(client.create(anyString(), any())).thenThrow(new VideoEnhanceClient.Rejected("quota"));
    assertEquals("failed", jobs.create(1L, quote.id()).status());
    verify(billing).rollback(1L, 4L);
    jobs.create(1L, quote.id());
    verify(client, times(1)).create(anyString(), any());
  }
  @Test void pollingTransientErrorsAndPersistenceFailuresKeepSameJob() throws Exception {
    Task task = jobs.create(1L, quote().id());
    assertTrue(jobs.pollOnce(1L, task.id()));
    assertEquals(45, jobs.get(1L, task.id()).progress());
    when(client.poll("123456")).thenThrow(new IOException("temporarily unavailable"));
    assertTrue(jobs.pollOnce(1L, task.id()));
    assertEquals("running", jobs.get(1L, task.id()).status());
    verify(billing, never()).rollbackByTaskId(any());
    doReturn(new VideoEnhanceClient.State(true, "success", 100, "已完成", "https://result.test/video.mp4", "")).when(client).poll("123456");
    when(media.persist(eq(1L), any(), any())).thenThrow(new IOException("storage unavailable"))
        .thenReturn("https://owned.test/enhanced.mp4");
    assertTrue(jobs.pollOnce(1L, task.id()));
    assertEquals("persisting", jobs.get(1L, task.id()).status());
    assertFalse(jobs.pollOnce(1L, task.id()));
    Task completed = jobs.get(1L, task.id());
    assertEquals("completed", completed.status()); assertEquals("", completed.error());
    assertEquals("https://owned.test/enhanced.mp4", completed.resultUrl());
    verify(client, times(1)).create(anyString(), any());
    verify(billing, atLeastOnce()).commitByTaskId(VideoEnhanceJobs.PREFIX + task.id());
  }
  @Test void providerFailureRollsBackAndRestartResumesOnlyQueries() throws Exception {
    Task task = jobs.create(1L, quote().id());
    jobs.close();
    jobs = new VideoEnhanceJobs(client, media, config, billing, mapper, temp.toString());
    when(client.poll("123456")).thenReturn(new VideoEnhanceClient.State(true, "failed", 19, "失败", "", "invalid source"));
    assertFalse(jobs.pollOnce(1L, task.id()));
    assertEquals("invalid source", jobs.get(1L, task.id()).error());
    verify(client, times(1)).create(anyString(), any());
    verify(billing, atLeastOnce()).rollbackByTaskId(VideoEnhanceJobs.PREFIX + task.id());
  }
  @Test void rejectsCrossUserExpiredQuotesAndTraversal() throws Exception {
    Task quote = quote();
    assertThrows(ApiException.class, () -> jobs.get(2L, quote.id()));
    assertThrows(ApiException.class, () -> jobs.create(2L, quote.id()));
    assertThrows(ApiException.class, () -> jobs.get(1L, "../1/test"));
    Task expired = new Task(quote.id(), quote.sourceObject(), quote.settings(), quote.metadata(), quote.price(), 0, 1,
        "quoted", "", null, "", "", "", "");
    Files.writeString(temp.resolve("1/" + quote.id() + ".json"), mapper.writeValueAsString(expired));
    assertThrows(ApiException.class, () -> jobs.create(1L, quote.id()));
    verifyNoInteractions(billing);
  }
  @Test void cancellingQuoteNeverCancelsSubmittedTasks() throws Exception {
    Task quoted = quote();
    jobs.discardQuote(1L, quoted.id());
    assertThrows(ApiException.class, () -> jobs.get(1L, quoted.id()));
    Task task = jobs.create(1L, quote().id());
    jobs.discardQuote(1L, task.id());
    assertEquals("pending", jobs.get(1L, task.id()).status());
    assertEquals(1, jobs.list(1L, "https://owned.test/source.mp4").size());
  }
}
