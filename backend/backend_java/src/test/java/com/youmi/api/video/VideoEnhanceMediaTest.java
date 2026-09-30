package com.youmi.api.video;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import com.youmi.api.file.OssStorageService;
import java.io.ByteArrayInputStream;
import java.math.BigDecimal;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class VideoEnhanceMediaTest {
  @TempDir Path temp;
  @Test void allDocumentedMultipliersApplyAndRoundingIsPredictable() {
    for (var resolution : Map.of("720p", 1, "1080p", 2, "2k", 4, "4k", 8, "8k", 32).entrySet())
      for (var fps : Map.of("keep", 1, "60", 2, "120", 4).entrySet())
        for (var version : Map.of("standard", 1, "professional", 10).entrySet()) {
          var settings = new VideoEnhanceDtos.Settings(resolution.getKey(), fps.getKey(), version.getKey(), "aigc", "natural");
          assertEquals(3 * resolution.getValue() * fps.getValue() * version.getValue(), settings.price(15, new BigDecimal("0.2")));
        }
    assertEquals(7, VideoEnhanceClientTest.settings("standard").price(15.2, new BigDecimal("0.2")));
    assertThrows(ApiException.class, () -> VideoEnhanceClientTest.settings("standard").price(601, BigDecimal.ONE));
    assertThrows(ApiException.class, () -> VideoEnhanceClientTest.settings("standard").price(Double.NaN, BigDecimal.ONE));
  }
  @Test void validatesActualDurationAndBothEdgesIncludingPortrait() throws Exception {
    new VideoEnhanceDtos.Metadata(600, 1440, 2560).validate();
    new VideoEnhanceDtos.Metadata(1, 360, 640).validate();
    assertThrows(ApiException.class, () -> new VideoEnhanceDtos.Metadata(600.01, 1280, 720).validate());
    assertThrows(ApiException.class, () -> new VideoEnhanceDtos.Metadata(15, 358, 640).validate());
    assertThrows(ApiException.class, () -> new VideoEnhanceDtos.Metadata(15, 1920, 1920).validate());
    assertThrows(ApiException.class, () -> new VideoEnhanceDtos.Metadata(15, 2561, 1440).validate());
    assertThrows(ApiException.class, () -> VideoEnhanceMedia.metadata(new ObjectMapper().readTree("{\"streams\":[],\"format\":{\"duration\":15}}")));
  }
  @Test void rejectsExternalInputsAndPrivateResultAddressesBeforeDownload() {
    var oss = mock(OssStorageService.class);
    var media = new VideoEnhanceMedia(oss, new ObjectMapper(), new VideoEnhanceProperties(), "ffprobe");
    assertThrows(ApiException.class, () -> media.ownedObject(1L, "https://outside.test/source.mp4"));
    assertThrows(ApiException.class, () -> media.ownedObject(1L, "file:///tmp/test.mp4"));
    assertThrows(ApiException.class, () -> VideoEnhanceMedia.requirePublicUrl(URI.create("http://127.0.0.1/private")));
    assertThrows(ApiException.class, () -> VideoEnhanceMedia.requirePublicUrl(URI.create("http://[::1]/private")));
    verify(oss, never()).openObjectStream(any());
  }
  @Test void boundedCopyNeverBuffersWholeVideo() throws Exception {
    Path file = temp.resolve("bounded.mp4");
    VideoEnhanceMedia.copyLimited(new ByteArrayInputStream(new byte[100]), file, 100);
    assertEquals(100, Files.size(file));
    assertThrows(ApiException.class, () -> VideoEnhanceMedia.copyLimited(new ByteArrayInputStream(new byte[101]), file, 100));
    assertThrows(ApiException.class, () -> VideoEnhanceMedia.copyLimited(new ByteArrayInputStream(new byte[0]), file, 100));
  }
  @Test void realVideoMetadataIsInspectedWithoutTrustingBrowser() throws Exception {
    String ffmpeg = System.getenv("YOUMI_FFMPEG"), ffprobe = System.getenv("YOUMI_FFPROBE");
    Assumptions.assumeTrue(ffmpeg != null && ffprobe != null);
    Path video = temp.resolve("source.mp4");
    Process process = new ProcessBuilder(ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:d=1:r=5",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", video.toString()).start();
    try { assertTrue(process.waitFor(30, TimeUnit.SECONDS)); assertEquals(0, process.exitValue()); }
    finally { if (process.isAlive()) process.destroyForcibly(); }
    var oss = mock(OssStorageService.class);
    when(oss.openObjectStream("source")).thenAnswer(invocation -> Files.newInputStream(video));
    var media = new VideoEnhanceMedia(oss, new ObjectMapper(), new VideoEnhanceProperties(), ffprobe);
    var metadata = media.inspect("source", temp.resolve("snapshot.source"));
    assertEquals(640, metadata.width()); assertEquals(360, metadata.height()); assertEquals(1, metadata.duration(), .1);
  }
}
