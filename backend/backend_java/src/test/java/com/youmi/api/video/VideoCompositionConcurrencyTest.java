package com.youmi.api.video;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import com.youmi.api.file.OssStorageService;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class VideoCompositionConcurrencyTest {
  @TempDir Path directory;

  @Test void sameUserCanComposeTwoJobsAndQueueAnotherWithoutInvalidatingRunningStates() throws Exception {
    var oss = mock(OssStorageService.class);
    when(oss.isOwnFileUrl(anyString())).thenReturn(true);
    when(oss.requireUserObject(eq(1L), anyString())).thenReturn("users/1/source.mp4");
    var started = new CountDownLatch(2);
    var release = new CountDownLatch(1);
    when(oss.openObjectStream(anyString())).thenAnswer(invocation -> {
      started.countDown();
      assertTrue(release.await(5, TimeUnit.SECONDS));
      throw new ApiException(400, "Mock source unavailable");
    });
    var service = spy(new VideoCompositionService(oss, new ObjectMapper(), directory.toString(), "unused", "unused"));
    doReturn(true).when(service).available();
    var request = new ProductVideoDtos.ComposeRequest(
        List.of(new ProductVideoDtos.Clip("https://owned.example/users/1/source.mp4", 0, 4, "")), "16:9", "", 0);
    try {
      var first = service.create(1L, request);
      var second = service.create(1L, request);
      assertTrue(started.await(5, TimeUnit.SECONDS));
      var queued = service.create(1L, request);
      assertEquals("processing", service.get(1L, first.id()).status());
      assertEquals("processing", service.get(1L, second.id()).status());
      assertEquals("queued", service.get(1L, queued.id()).status());
      assertEquals(404, assertThrows(ApiException.class, () -> service.get(2L, first.id())).getCode());
      release.countDown();
      for (String id : List.of(first.id(), second.id(), queued.id())) {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(4);
        while (List.of("queued", "processing").contains(service.get(1L, id).status()) && System.nanoTime() < deadline)
          Thread.sleep(10);
        assertEquals("failed", service.get(1L, id).status());
      }
    } finally { release.countDown(); service.close(); }
  }
}
