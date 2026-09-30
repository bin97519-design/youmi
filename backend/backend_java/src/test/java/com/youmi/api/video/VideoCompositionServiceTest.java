package com.youmi.api.video;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import com.youmi.api.file.OssStorageService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.api.Assumptions;
import java.nio.file.Path;
import java.nio.file.Files;
import java.util.List;
import java.util.concurrent.TimeUnit;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class VideoCompositionServiceTest {
  @TempDir Path temp;
  final ObjectMapper mapper = new ObjectMapper();

  @Test void longCompositionAcceptsMoreThanEightClipsWithBoundedTotalDuration() {
    var clips = java.util.stream.IntStream.range(0, 14)
        .mapToObj(i -> new ProductVideoDtos.Clip("source", 0, 7.5, "")).toList();
    assertDoesNotThrow(() -> VideoCompositionService.validate(new ProductVideoDtos.ComposeRequest(clips, "16:9", "", 0)));
    assertThrows(ApiException.class, () -> VideoCompositionService.validate(new ProductVideoDtos.ComposeRequest(
        java.util.Collections.nCopies(49, clips.get(0)), "16:9", "", 0)));
    assertThrows(ApiException.class, () -> VideoCompositionService.validate(new ProductVideoDtos.ComposeRequest(
        java.util.Collections.nCopies(48, clips.get(0)), "16:9", "", 0)));
  }

  @Test void realLongCompositionPreserves105SecondsAcrossFourteenClips() throws Exception {
    String ffmpeg = System.getenv("YOUMI_FFMPEG"), ffprobe = System.getenv("YOUMI_FFPROBE");
    Assumptions.assumeTrue(ffmpeg != null && ffprobe != null);
    Path source = temp.resolve("long-source.mp4");
    run(List.of(ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i", "color=green:s=64x64:d=8:r=10",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", source.toString()));
    var service = new VideoCompositionService(mock(OssStorageService.class), mapper, temp.toString(), ffmpeg, ffprobe);
    try {
      var clips = java.util.Collections.nCopies(14, new ProductVideoDtos.Clip("source", 0, 7.5, ""));
      Path result = service.renderLocal(new ProductVideoDtos.ComposeRequest(clips, "16:9", "", 0),
          java.util.Collections.nCopies(14, source), null, temp);
      Path metadata = temp.resolve("long.json");
      var process = new ProcessBuilder(ffprobe, "-v", "error", "-show_format", "-of", "json", result.toString())
          .redirectOutput(metadata.toFile()).start();
      assertTrue(process.waitFor(30, TimeUnit.SECONDS));
      assertEquals(0, process.exitValue());
      assertEquals(105, mapper.readTree(Files.readString(metadata)).path("format").path("duration").asDouble(), .1);
    } finally { service.close(); }
  }

  @Test void audioDefaultsOffForLegacyRequestsAndLargeSpeedFactorsAreChained() throws Exception {
    var legacy = mapper.readValue("{\"clips\":[],\"ratio\":\"16:9\",\"musicVolume\":0}", ProductVideoDtos.ComposeRequest.class);
    assertFalse(legacy.keepOriginalAudio());
    assertEquals("atempo=2,atempo=1.875000000", VideoCompositionService.audioTempo(3.75));
    assertEquals("atempo=2,atempo=2,atempo=2,atempo=1.875000000", VideoCompositionService.audioTempo(15));
  }

  @Test void realAudioTracksStayAlignedThroughSpeedTrimSilentClipsAndMusicMixing() throws Exception {
    String ffmpeg = System.getenv("YOUMI_FFMPEG"), ffprobe = System.getenv("YOUMI_FFPROBE");
    Assumptions.assumeTrue(ffmpeg != null && ffprobe != null);
    Path source = temp.resolve("audio-source.mp4"), silent = temp.resolve("silent.mp4"), music = temp.resolve("music.wav");
    run(List.of(ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i", "color=green:s=64x64:d=15:r=10",
        "-f", "lavfi", "-i", "aevalsrc=if(between(t\\,5\\,10)\\,0.4*sin(2*PI*440*t)\\,0):s=48000:d=15",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", source.toString()));
    run(List.of(ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i", "color=blue:s=64x64:d=1:r=10",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", silent.toString()));
    run(List.of(ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=1", music.toString()));
    var service = new VideoCompositionService(mock(OssStorageService.class), mapper, temp.toString(), ffmpeg, ffprobe);
    try {
      for (boolean withMusic : new boolean[]{false, true}) {
        Path dir = Files.createDirectory(temp.resolve("audio-" + withMusic));
        var request = new ProductVideoDtos.ComposeRequest(List.of(
            new ProductVideoDtos.Clip("a", 0, 4, "", "speed"),
            new ProductVideoDtos.Clip("b", 0, 1, ""),
            new ProductVideoDtos.Clip("a", 4, 3, "")), "1:1", withMusic ? "music" : "", .1, true);
        Path output = service.renderLocal(request, List.of(source, silent, source), withMusic ? music : null, dir);
        Path pcm = dir.resolve("audio.pcm");
        run(List.of(ffmpeg, "-y", "-v", "error", "-i", output.toString(), "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", pcm.toString()));
        byte[] samples = Files.readAllBytes(pcm);
        assertEquals(8, samples.length / 16000.0, .12);
        for (double time : new double[]{.3, 3.5, 4.5, 5.4})
          assertTrue(rms(samples, time) < .02, "Silent moment must stay aligned at " + time);
        for (double time : new double[]{1.8, 6.5, 7.5})
          assertTrue(rms(samples, time) > .1, "Original action sound must remain aligned at " + time);
        if (withMusic) assertTrue(rms(samples, 4.5) > .002, "Music must also play over a silent source clip");
      }
      Path dir = Files.createDirectory(temp.resolve("muted"));
      Path output = service.renderLocal(new ProductVideoDtos.ComposeRequest(
          List.of(new ProductVideoDtos.Clip("a", 5, 1, "")), "1:1", "", 0), List.of(source), null, dir);
      Path probe = dir.resolve("audio.json");
      var process = new ProcessBuilder(ffprobe, "-v", "error", "-select_streams", "a", "-show_streams", "-of", "json", output.toString())
          .redirectOutput(probe.toFile()).start();
      assertTrue(process.waitFor(30, TimeUnit.SECONDS));
      assertEquals(0, process.exitValue());
      assertEquals(0, mapper.readTree(Files.readString(probe)).path("streams").size());
    } finally { service.close(); }
  }

  private double rms(byte[] pcm, double start) {
    int first = (int) (start * 8000), count = 1600;
    var buffer = java.nio.ByteBuffer.wrap(pcm).order(java.nio.ByteOrder.LITTLE_ENDIAN);
    double sum = 0;
    for (int i = first; i < first + count; i++) {
      double sample = buffer.getShort(i * 2) / 32768.0;
      sum += sample * sample;
    }
    return Math.sqrt(sum / count);
  }

  @Test void validatesDurationRatiosAndSubtitles() {
    assertThrows(ApiException.class, () -> VideoCompositionService.validate(new ProductVideoDtos.ComposeRequest(List.of(), "16:9", "", .2)));
    assertThrows(ApiException.class, () -> VideoCompositionService.validate(new ProductVideoDtos.ComposeRequest(List.of(new ProductVideoDtos.Clip("x", -1, 4, "")), "16:9", "", .2)));
    assertThrows(ApiException.class, () -> VideoCompositionService.dimensions("adaptive"));
    String subtitles = VideoCompositionService.subtitles(List.of(new ProductVideoDtos.Clip("x", 0, 4, "{\\pos(0,0)}\n商品")), new int[]{1280, 720});
    assertFalse(subtitles.contains("{\\pos"));
    assertTrue(subtitles.contains("0:00:04.00"));
  }

  @Test void rejectsForeignAssetsAndCrossUserJobs() throws Exception {
    var oss = mock(OssStorageService.class);
    var service = new VideoCompositionService(oss, mapper, temp.toString(), "ffmpeg", "ffprobe");
    assertThrows(ApiException.class, () -> service.ownedObject(1L, "http://127.0.0.1/secret"));
    when(oss.isOwnFileUrl("https://own.example/users/2/a.mp4")).thenReturn(true);
    when(oss.requireUserObject(1L, "/users/2/a.mp4")).thenThrow(new ApiException(403, "forbidden"));
    assertThrows(ApiException.class, () -> service.ownedObject(1L, "https://own.example/users/2/a.mp4"));
    String id = "00000000-0000-0000-0000-000000000001";
    Files.createDirectories(temp.resolve("2").resolve(id));
    Files.writeString(temp.resolve("2").resolve(id).resolve("state.json"), mapper.writeValueAsString(new ProductVideoDtos.Composition(id, "completed", 100, "url", "")));
    assertThrows(ApiException.class, () -> service.get(1L, id));
    assertThrows(ApiException.class, () -> service.get(1L, "../state.json"));
    service.close();
  }

  @Test void speedModeIsExplicitAndLegacyClipsStillTrim() throws Exception {
    var legacy = mapper.readValue("{\"url\":\"x\",\"start\":2,\"duration\":4,\"caption\":\"\"}", ProductVideoDtos.Clip.class);
    assertNull(legacy.timingMode());
    VideoCompositionService.validate(new ProductVideoDtos.ComposeRequest(List.of(legacy), "16:9", "", 0));
    var speed = mapper.readValue("{\"url\":\"x\",\"start\":0,\"duration\":4,\"caption\":\"\",\"timingMode\":\"speed\"}", ProductVideoDtos.Clip.class);
    assertEquals("speed", speed.timingMode());
    VideoCompositionService.validate(new ProductVideoDtos.ComposeRequest(List.of(speed, legacy), "16:9", "", 0));
    for (var clip : List.of(
        new ProductVideoDtos.Clip("x", 2, 4, "", "speed"),
        new ProductVideoDtos.Clip("x", 0, 4, "", "unknown"),
        new ProductVideoDtos.Clip("x", 0, 0, "", "speed"),
        new ProductVideoDtos.Clip("x", 0, Double.NaN, "", "speed"),
        new ProductVideoDtos.Clip("x", 0, 31, "", "speed"))) {
      assertThrows(ApiException.class, () -> VideoCompositionService.validate(new ProductVideoDtos.ComposeRequest(List.of(clip), "16:9", "", 0)));
    }
  }

  @Test void thirtySecondWholeVideoExportsInFull() throws Exception {
    String ffmpeg = System.getenv("YOUMI_FFMPEG"), ffprobe = System.getenv("YOUMI_FFPROBE");
    Assumptions.assumeTrue(ffmpeg != null && ffprobe != null);
    Path source = temp.resolve("whole30.mp4");
    run(List.of(ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i", "color=green:s=64x64:d=30:r=2",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", source.toString()));
    var request = new ProductVideoDtos.ComposeRequest(List.of(new ProductVideoDtos.Clip("source", 0, 30, "全片")), "16:9", "", 0);
    VideoCompositionService.validate(request);
    var service = new VideoCompositionService(mock(OssStorageService.class), mapper, temp.toString(), ffmpeg, ffprobe);
    try {
      Path output = service.renderLocal(request, List.of(source), null, temp);
      Path metadata = temp.resolve("whole30.json");
      var probe = new ProcessBuilder(ffprobe, "-v", "error", "-show_format", "-of", "json", output.toString()).redirectOutput(metadata.toFile()).start();
      assertTrue(probe.waitFor(30, TimeUnit.SECONDS));
      assertEquals(0, probe.exitValue());
      assertEquals(30, mapper.readTree(Files.readString(metadata)).path("format").path("duration").asDouble(), .1);
    } finally { service.close(); }
  }

  @Test void interruptedJobBecomesFailedAfterRestart() throws Exception {
    String id = "00000000-0000-0000-0000-000000000001";
    Files.createDirectories(temp.resolve("1").resolve(id));
    Files.writeString(temp.resolve("1").resolve(id).resolve("state.json"), mapper.writeValueAsString(new ProductVideoDtos.Composition(id, "processing", 30, "", "")));
    var service = new VideoCompositionService(mock(OssStorageService.class), mapper, temp.toString(), "ffmpeg", "ffprobe");
    assertEquals("failed", service.get(1L, id).status());
    service.close();
  }

  @Test void realFfmpegRendersTrimmedOrderedCaptionedMp4WithMusic() throws Exception {
    String ffmpeg = System.getenv("YOUMI_FFMPEG"), ffprobe = System.getenv("YOUMI_FFPROBE");
    Assumptions.assumeTrue(ffmpeg != null && ffprobe != null, "Set media binaries to run real rendering test");
    Path a = temp.resolve("a.mp4"), b = temp.resolve("b.mp4"), music = temp.resolve("music.wav");
    run(List.of(ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i", "color=red:s=640x480:d=3:r=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", a.toString()));
    run(List.of(ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i", "color=blue:s=640x480:d=3:r=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", b.toString()));
    run(List.of(ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", music.toString()));
    var service = new VideoCompositionService(mock(OssStorageService.class), mapper, temp.toString(), ffmpeg, ffprobe);
    var request = new ProductVideoDtos.ComposeRequest(List.of(
        new ProductVideoDtos.Clip("a", .5, 1.5, "商品全景"), new ProductVideoDtos.Clip("b", 1, 1.5, "材质细节")), "16:9", "music", .25);
    Path output = service.renderLocal(request, List.of(a, b), music, temp);
    assertTrue(Files.size(output) > 1000);
    Path probe = temp.resolve("result.json");
    var process = new ProcessBuilder(ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", output.toString()).redirectOutput(probe.toFile()).start();
    assertTrue(process.waitFor(30, TimeUnit.SECONDS));
    var data = mapper.readTree(Files.readString(probe));
    assertEquals(3, data.path("format").path("duration").asDouble(), .1);
    assertEquals(1280, data.path("streams").get(0).path("width").asInt());
    assertEquals("30/1", data.path("streams").get(0).path("r_frame_rate").asText());
    assertEquals("audio", data.path("streams").get(1).path("codec_type").asText());
    Path firstFrame = temp.resolve("first.png"), secondFrame = temp.resolve("second.png");
    run(List.of(ffmpeg, "-y", "-v", "error", "-ss", "0.7", "-i", output.toString(), "-frames:v", "1", firstFrame.toString()));
    run(List.of(ffmpeg, "-y", "-v", "error", "-ss", "2.2", "-i", output.toString(), "-frames:v", "1", secondFrame.toString()));
    var firstImage = javax.imageio.ImageIO.read(firstFrame.toFile());
    var secondImage = javax.imageio.ImageIO.read(secondFrame.toFile());
    var red = new java.awt.Color(firstImage.getRGB(640, 250));
    var blue = new java.awt.Color(secondImage.getRGB(640, 250));
    assertTrue(red.getRed() > 200 && red.getBlue() < 50);
    assertTrue(blue.getBlue() > 200 && blue.getRed() < 50);
    int captionPixels = 0;
    for (int y = 600; y < 705; y++) for (int x = 300; x < 980; x++) {
      var color = new java.awt.Color(firstImage.getRGB(x, y));
      if (color.getRed() > 200 && color.getGreen() > 200 && color.getBlue() > 200) captionPixels++;
    }
    assertTrue(captionPixels > 30, "Rendered caption must be visible");
    assertThrows(ApiException.class, () -> service.renderLocal(new ProductVideoDtos.ComposeRequest(
        List.of(new ProductVideoDtos.Clip("a", 2, 4, "")), "16:9", "", 0), List.of(a), null, temp));
    service.close();
  }

  private void run(List<String> command) throws Exception {
    var process = new ProcessBuilder(command).redirectError(ProcessBuilder.Redirect.INHERIT).start();
    assertTrue(process.waitFor(30, TimeUnit.SECONDS));
    assertEquals(0, process.exitValue());
  }

  @Test void realFfmpegSpeedIncludesBeginningMiddleAndEndAndMixesWithTrimmedClips() throws Exception {
    String ffmpeg = System.getenv("YOUMI_FFMPEG"), ffprobe = System.getenv("YOUMI_FFPROBE");
    Assumptions.assumeTrue(ffmpeg != null && ffprobe != null, "Set media binaries to run real rendering test");
    Path source = temp.resolve("full-15s.mp4");
    run(List.of(ffmpeg, "-y", "-v", "error",
        "-f", "lavfi", "-i", "color=red:s=160x120:d=5:r=30",
        "-f", "lavfi", "-i", "color=lime:s=160x120:d=5:r=30",
        "-f", "lavfi", "-i", "color=blue:s=160x120:d=5:r=30",
        "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]", "-map", "[v]",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", source.toString()));
    var service = new VideoCompositionService(mock(OssStorageService.class), mapper, temp.toString(), ffmpeg, ffprobe);
    try {
      for (int target : new int[]{4, 6}) {
        Path dir = Files.createDirectory(temp.resolve("speed-" + target));
        var request = new ProductVideoDtos.ComposeRequest(List.of(
            new ProductVideoDtos.Clip("source", 0, target, "整段加速", "speed"),
            new ProductVideoDtos.Clip("source", 6, 1.5, "截取片段")), "16:9", "", 0);
        Path output = service.renderLocal(request, List.of(source, source), null, dir);
        Path probe = dir.resolve("result.json");
        var process = new ProcessBuilder(ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", output.toString()).redirectOutput(probe.toFile()).start();
        assertTrue(process.waitFor(30, TimeUnit.SECONDS));
        assertEquals(0, process.exitValue());
        var metadata = mapper.readTree(Files.readString(probe));
        assertEquals(target + 1.5, metadata.path("format").path("duration").asDouble(), .05);
        assertEquals("30/1", metadata.path("streams").get(0).path("r_frame_rate").asText());
        double[] times = {.1, target / 2.0, target - .1, target + .5};
        for (int i = 0; i < times.length; i++) {
          Path frame = dir.resolve("frame-" + i + ".png");
          run(List.of(ffmpeg, "-y", "-v", "error", "-ss", Double.toString(times[i]), "-i", output.toString(), "-frames:v", "1", frame.toString()));
          var pixel = new java.awt.Color(javax.imageio.ImageIO.read(frame.toFile()).getRGB(640, 250));
          if (i == 0) assertTrue(pixel.getRed() > 200 && pixel.getBlue() < 50, "Beginning of original must remain");
          else if (i == 2) assertTrue(pixel.getBlue() > 200 && pixel.getRed() < 50, "End of original must remain");
          else assertTrue(pixel.getGreen() > 200 && pixel.getRed() < 50, "Middle and following trimmed clip must remain");
        }
        String captions = Files.readString(dir.resolve("captions.ass"));
        assertTrue(captions.contains("0:00:0" + target + ".00,0:00:0" + (target + 1) + ".50"));
      }
      Path shortSource = temp.resolve("short.mp4");
      run(List.of(ffmpeg, "-y", "-v", "error", "-i", source.toString(), "-t", "2", "-c", "copy", shortSource.toString()));
      var invalid = new ProductVideoDtos.ComposeRequest(List.of(new ProductVideoDtos.Clip("short", 0, 4, "", "speed")), "16:9", "", 0);
      assertThrows(ApiException.class, () -> service.renderLocal(invalid, List.of(shortSource), null, temp));
    } finally {
      service.close();
    }
  }
}
