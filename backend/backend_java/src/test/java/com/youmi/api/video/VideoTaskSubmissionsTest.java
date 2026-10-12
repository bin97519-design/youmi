package com.youmi.api.video;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class VideoTaskSubmissionsTest {
  @TempDir Path temp;
  VideoGenerationDtos.CreateTaskRequest request(String id, String prompt) {
    return new VideoGenerationDtos.CreateTaskRequest(prompt, "minimax-h3", "16:9", 5,
        "768p", List.of(), null, null, null, false, null, null, id);
  }
  VideoGenerationDtos.CreateTaskResponse receipt() {
    var result = new VideoGenerationDtos.CreateTaskResponse();
    result.setTaskId("minimax-h3:provider-id");
    result.setStatus("queued");
    return result;
  }
  @Test void sameRequestReturnsPersistedReceiptAfterRestartWithoutAnotherCharge() throws Exception {
    var service = new VideoTaskSubmissions(new ObjectMapper(), temp.toString());
    var count = new AtomicInteger();
    var input = request("client-1", "motion");
    service.create(7L, input, () -> { count.incrementAndGet(); return receipt(); });
    var restarted = new VideoTaskSubmissions(new ObjectMapper(), temp.toString());
    assertEquals(receipt().getTaskId(), restarted.create(7L, input, () -> {
      count.incrementAndGet(); return receipt();
    }).getTaskId());
    assertEquals(1, count.get());
    assertEquals("accepted", restarted.lookup(7L, "client-1").status());
    assertFalse(restarted.lookup(8L, "client-1").exists());
    assertEquals(409, assertThrows(ApiException.class,
        () -> restarted.create(7L, request("client-1", "changed"), this::receipt)).getCode());
  }
  @Test void uncertainSubmissionIsNeverAutomaticallyResubmitted() throws Exception {
    var service = new VideoTaskSubmissions(new ObjectMapper(), temp.toString());
    var input = request("client-2", "motion");
    assertThrows(Exception.class, () -> service.create(7L, input, () -> { throw new java.io.IOException("lost response"); }));
    assertEquals("unknown", service.lookup(7L, "client-2").status());
    var restarted = new VideoTaskSubmissions(new ObjectMapper(), temp.toString());
    assertEquals(409, assertThrows(ApiException.class,
        () -> restarted.create(7L, input, () -> { fail("duplicate provider submission"); return receipt(); })).getCode());
  }
  @Test void definiteRejectionIsDiscoverableButReusesTheSameOutcome() throws Exception {
    var service = new VideoTaskSubmissions(new ObjectMapper(), temp.toString());
    var input = request("client-3", "motion");
    assertThrows(ApiException.class, () -> service.create(7L, input, () -> { throw new ApiException(400, "invalid duration"); }));
    assertEquals("failed", service.lookup(7L, "client-3").status());
    assertEquals(400, assertThrows(ApiException.class, () -> service.create(7L, input, this::receipt)).getCode());
    assertThrows(ApiException.class, () -> service.lookup(7L, "../escape"));
  }
  @Test void simultaneousSubmissionsCannotBothReachTheProvider() throws Exception {
    var service = new VideoTaskSubmissions(new ObjectMapper(), temp.toString());
    var another = new VideoTaskSubmissions(new ObjectMapper(), temp.toString());
    var entered = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var input = request("client-race", "motion");
    var executor = Executors.newSingleThreadExecutor();
    try {
      var first = executor.submit(() -> service.create(7L, input, () -> {
        entered.countDown(); assertTrue(release.await(5, TimeUnit.SECONDS)); return receipt();
      }));
      assertTrue(entered.await(5, TimeUnit.SECONDS));
      assertEquals("submitting", service.lookup(7L, "client-race").status());
      assertEquals(409, assertThrows(ApiException.class, () -> another.create(7L, input,
          () -> { fail("duplicate charge"); return receipt(); })).getCode());
      release.countDown();
      assertEquals(receipt().getTaskId(), first.get(5, TimeUnit.SECONDS).getTaskId());
    } finally { release.countDown(); executor.shutdownNow(); }
  }
}
