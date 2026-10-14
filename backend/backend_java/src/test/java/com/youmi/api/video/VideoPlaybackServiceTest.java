package com.youmi.api.video;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import com.youmi.api.file.OssStorageService;
import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class VideoPlaybackServiceTest {
  @TempDir Path dir;
  final ObjectMapper mapper = new ObjectMapper();
  final OssStorageService oss = mock(OssStorageService.class);
  final String source = "https://oss.test/users/1/uploads/source.mp4";

  VideoPlaybackService service() throws Exception {
    when(oss.isOwnFileUrl(source)).thenReturn(true);
    when(oss.objectNameFromFileUrl(source)).thenReturn("users/1/uploads/source.mp4");
    when(oss.requireUserObject(1L, "users/1/uploads/source.mp4")).thenReturn("users/1/uploads/source.mp4");
    when(oss.openObjectStream(anyString())).thenReturn(new ByteArrayInputStream(new byte[] { 1, 2, 3 }));
    when(oss.getFileUrl(anyString())).thenAnswer(call -> "https://oss.test/" + call.getArgument(0));
    return new VideoPlaybackService(oss, mapper, dir.toString(), "ffmpeg", "ffprobe");
  }

  @Test void rejectsExternalAndAnotherUsersSourcesBeforeDownloading() throws Exception {
    var service = service();
    try {
      assertThrows(ApiException.class, () -> service.create(1L, "http://127.0.0.1/private.mp4"));
      when(oss.requireUserObject(2L, "users/1/uploads/source.mp4")).thenThrow(new ApiException(403, "forbidden"));
      assertThrows(ApiException.class, () -> service.create(2L, source));
      verify(oss, never()).openObjectStream(anyString());
      assertThrows(ApiException.class, () -> service.get(1L, "../other"));
    } finally { service.close(); }
  }

  @Test void publishesCompatibleCopyOnceAndKeepsTheOriginalObject() throws Exception {
    var service = spy(service());
    var metadata = mapper.readTree("{\"streams\":[{\"width\":1440,\"height\":1920}],\"format\":{\"duration\":25.3}}");
    doReturn(metadata).when(service).probe(any());
    doAnswer(call -> { Files.write(call.getArgument(1), new byte[] { 4, 5, 6 }); return null; })
        .when(service).render(any(), any());
    try {
      var first = service.create(1L, source);
      var completed = waitFor(service, first.id());
      assertEquals("completed", completed.status());
      assertEquals(source, completed.sourceUrl());
      assertEquals(1440, completed.width());
      assertEquals(1920, completed.height());
      assertEquals(25.3, completed.duration());
      assertTrue(completed.url().contains("/users/1/video-playback/"));
      assertEquals(completed, service.create(1L, source));
      verify(oss, times(1)).uploadLocalFile(any(), contains("users/1/video-playback/"), eq("video/mp4"));
      verify(oss, never()).deleteFile(anyString());
    } finally { service.close(); }
  }

  @Test void duplicateRequestsShareAnActiveConversion() throws Exception {
    var service = spy(service());
    CountDownLatch started = new CountDownLatch(1), finish = new CountDownLatch(1);
    doAnswer(call -> {
      started.countDown();
      finish.await(5, TimeUnit.SECONDS);
      throw new ApiException(400, "test failure");
    }).when(service).probe(any());
    try {
      var first = service.create(1L, source);
      assertTrue(started.await(5, TimeUnit.SECONDS));
      assertEquals(first.id(), service.create(1L, source).id());
      verify(oss, times(1)).openObjectStream(anyString());
      finish.countDown();
      assertEquals("failed", waitFor(service, first.id()).status());
    } finally { finish.countDown(); service.close(); }
  }

  @Test void invalidMetadataCannotProduceAPlayableCopy() throws Exception {
    for (String json : new String[] { "{\"streams\":[],\"format\":{\"duration\":25}}", "{\"streams\":[{\"width\":1440,\"height\":1920}],\"format\":{\"duration\":700}}" })
      assertThrows(ApiException.class, () -> VideoPlaybackService.metadata(mapper.readTree(json)));
    var metadata = VideoPlaybackService.metadata(mapper.readTree("{\"streams\":[{\"width\":320,\"height\":240}],\"format\":{\"duration\":2}}"));
    assertEquals(320, metadata.width());
  }

  @Test void realConversionPreservesPictureDimensionsFrameRateAndAudio() throws Exception {
    String ffmpeg = System.getenv("YOUMI_FFMPEG"), ffprobe = System.getenv("YOUMI_FFPROBE");
    Assumptions.assumeTrue(ffmpeg != null && ffprobe != null, "FFmpeg runtime is optional in CI");
    Path input = dir.resolve("hevc.mp4"), output = dir.resolve("playable.mp4");
    var fixture = new ProcessBuilder(ffmpeg, "-v", "error", "-nostdin", "-y", "-f", "lavfi", "-i", "testsrc2=size=144x192:rate=30",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "1", "-c:v", "libx265", "-preset", "ultrafast",
        "-x265-params", "pools=1:frame-threads=1", "-c:a", "aac", input.toString())
        .redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectError(ProcessBuilder.Redirect.DISCARD).start();
    try { assertTrue(fixture.waitFor(30, TimeUnit.SECONDS)); assertEquals(0, fixture.exitValue()); }
    finally { if (fixture.isAlive()) fixture.destroyForcibly(); }
    var service = new VideoPlaybackService(oss, mapper, dir.toString(), ffmpeg, ffprobe);
    try {
      service.render(input, output);
      assertEquals("h264", service.probe(output).path("streams").path(0).path("codec_name").asText());
      var metadata = VideoPlaybackService.metadata(service.probe(output));
      assertEquals(144, metadata.width());
      assertEquals(192, metadata.height());
      assertEquals(1, metadata.duration(), .1);
      Path report = dir.resolve("all-streams.json");
      var probe = new ProcessBuilder(ffprobe, "-v", "error", "-show_entries", "stream=codec_type,codec_name,avg_frame_rate",
          "-of", "json", output.toString()).redirectOutput(report.toFile()).redirectError(ProcessBuilder.Redirect.DISCARD).start();
      try { assertTrue(probe.waitFor(30, TimeUnit.SECONDS)); assertEquals(0, probe.exitValue()); }
      finally { if (probe.isAlive()) probe.destroyForcibly(); }
      var streams = mapper.readTree(Files.readString(report)).path("streams");
      assertEquals("30/1", streams.path(0).path("avg_frame_rate").asText());
      assertEquals("aac", streams.path(1).path("codec_name").asText());
    } finally { service.close(); }
  }

  private VideoPlaybackService.Result waitFor(VideoPlaybackService service, String id) throws Exception {
    for (int attempt = 0; attempt < 200; attempt++) {
      var result = service.get(1L, id);
      if (result.status().equals("completed") || result.status().equals("failed")) return result;
      Thread.sleep(10);
    }
    fail("conversion did not finish");
    return null;
  }
}
