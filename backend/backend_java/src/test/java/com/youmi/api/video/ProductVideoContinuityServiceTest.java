package com.youmi.api.video;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.ai.CanvasAgentDtos;
import com.youmi.api.common.ApiException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class ProductVideoContinuityServiceTest {
  @TempDir Path temporary;
  private final ObjectMapper mapper = new ObjectMapper();
  private final String ffmpeg = System.getenv().getOrDefault("YOUMI_FFMPEG", "ffmpeg");
  private final String ffprobe = System.getenv().getOrDefault("YOUMI_FFPROBE", "ffprobe");
  private ProductVideoContinuityService.Clip clip(String id, boolean editable) {
    return new ProductVideoContinuityService.Clip(id, id, "https://owned.example/" + id + ".mp4", 0, 4,
        "trim", "match_cut", "Move right", "Starting", "Moving", editable, editable);
  }
  private ProductVideoContinuityService.Request request(String kind, int count) {
    return new ProductVideoContinuityService.Request(UUID.randomUUID().toString(), kind, "default", "One continuous event",
        java.util.stream.IntStream.range(0, count).mapToObj(index -> clip("shot-" + index, true)).toList());
  }
  private Path movie() throws Exception {
    return movie(4);
  }
  private Path movie(double seconds) throws Exception {
    org.junit.jupiter.api.Assumptions.assumeTrue(System.getenv("YOUMI_FFMPEG") != null && System.getenv("YOUMI_FFPROBE") != null,
        "Real media sampling tests require the configured FFmpeg and FFprobe binaries");
    Path output = temporary.resolve("source.mp4");
    var process = new ProcessBuilder(ffmpeg, "-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i",
        "testsrc2=size=160x120:rate=24", "-t", String.valueOf(seconds), "-c:v", "libx264", "-preset", "ultrafast", output.toString())
        .redirectError(ProcessBuilder.Redirect.DISCARD).redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
    assertTrue(process.waitFor(20, TimeUnit.SECONDS));
    assertEquals(0, process.exitValue());
    return output;
  }
  private ProductVideoContinuityService service(ProductVideoPlanService plans, Path movie) throws Exception {
    var media = mock(VideoCompositionService.class);
    when(media.available()).thenReturn(true);
    when(media.ownedObject(anyLong(), anyString())).thenReturn("owned");
    doAnswer(call -> { Files.copy(movie, call.getArgument(2, Path.class), StandardCopyOption.REPLACE_EXISTING); return null; })
        .when(media).download(anyLong(), anyString(), any(Path.class));
    when(plans.models()).thenReturn(List.of(new CanvasAgentDtos.AgentModelOption("default", "Test", true)));
    return new ProductVideoContinuityService(plans, media, mapper, temporary.resolve("reviews").toString(), ffmpeg, ffprobe);
  }
  private void responses(ProductVideoPlanService plans) throws Exception {
    when(plans.inspectContinuity(anyString(), anyString(), any(), anyList())).thenAnswer(call -> {
      String kind = call.getArgument(1);
      if (kind.equals("whole")) return mapper.readTree("{\"summary\":\"Actual event has a beginning and ending\",\"issues\":[]}");
      var evidence = mapper.valueToTree(call.getArgument(2));
      var result = mapper.createObjectNode();
      var array = result.putArray("results");
      for (var pair : evidence.path(kind.equals("timeline") ? "sections" : "pairs")) {
        var item = array.addObject();
        item.put("index", pair.path("index").asInt()).put("status", "pass").put("confidence", .9)
            .put("previousState", "Hand moving right").put("currentState", "Same hand continues")
            .put("motion", "Continue rightward slowly").put("advice", "Cut during the action");
        item.putArray("issues"); item.put("previousCutFrame", 1); item.put("currentCutFrame", 1);
      }
      return result;
    });
  }

  private ProductVideoContinuityService.Request wholeRequest(int seconds, int count) {
    var source = new ProductVideoContinuityService.Clip("whole", "Whole", "https://owned.example/whole.mp4", 0, seconds,
        "trim", "opening", "", "", "", false, false);
    var timeline = java.util.stream.IntStream.range(0, count).mapToObj(index -> new ProductVideoDtos.TimelineBeat(
        index * (double)seconds / count, (index + 1) * (double)seconds / count, "Action", "Camera", "Transition",
        "Beginning", "Ending", index == 0 ? "opening" : "match_cut", "Execute this section")).toList();
    return new ProductVideoContinuityService.Request(UUID.randomUUID().toString(), "timeline", "default", "One event", List.of(source), timeline);
  }

  @Test void singleWholeMovieIsInspectedInsideEveryPeriodWithActualHeadMiddleAndTailFrames() throws Exception {
    for (int seconds : new int[]{15, 30}) {
      var plans = mock(ProductVideoPlanService.class); responses(plans);
      var service = service(plans, movie(seconds));
      try {
        var request = wholeRequest(seconds, 3);
        service.create(1L, request);
        var state = await(service, request.id());
        assertEquals("completed", state.status(), state.error()); assertEquals(3, state.results().size());
        assertEquals("segment-2", state.results().get(2).currentId());
        var inputs = org.mockito.ArgumentCaptor.forClass(Object.class);
        var images = org.mockito.ArgumentCaptor.forClass(List.class);
        verify(plans, times(2)).inspectContinuity(eq("default"), eq("timeline"), inputs.capture(), images.capture());
        for (int batch = 0; batch < inputs.getAllValues().size(); batch++) {
          var data = mapper.valueToTree(inputs.getAllValues().get(batch));
          assertFalse(data.toString().contains("https://owned.example"));
          assertTrue(images.getAllValues().get(batch).size() <= 8);
          for (var section : data.path("sections")) for (String field : List.of("headFrames", "middleFrames", "tailFrames")) {
            assertEquals(3, section.path(field).size());
            for (var label : section.path(field)) {
              assertTrue(label.path("sourceTime").asDouble() >= section.path("planned").path("start").asDouble());
              assertTrue(label.path("sourceTime").asDouble() < section.path("planned").path("end").asDouble());
              assertTrue(label.path("imageIndex").asInt() < images.getAllValues().get(batch).size());
            }
          }
        }
        verify(plans).inspectContinuity(eq("default"), eq("whole"), any(), eq(List.of()));
        assertFalse(Files.exists(temporary.resolve("reviews/1/" + request.id() + "/timeline-samples")));
        assertNull(state.results().get(0).suggestedCurrentStart());
      } finally { service.close(); }
    }
  }

  @Test void wholeInspectionRejectsIncompleteOrOverlappingPlansAndDoesNotTreatLowConfidenceAsPass() throws Exception {
    var request = wholeRequest(15, 2);
    var incomplete = new ProductVideoContinuityService.Request(request.id(), "timeline", "default", "", request.clips(), request.timeline().subList(0, 1));
    assertThrows(ApiException.class, () -> ProductVideoContinuityService.validate(incomplete));
    var missing = new ProductVideoContinuityService.Request(request.id(), "timeline", "default", "", request.clips(), null);
    assertThrows(ApiException.class, () -> ProductVideoContinuityService.validate(missing));
    var value = mapper.readTree("{\"results\":[{\"index\":0,\"status\":\"pass\",\"confidence\":0.4,\"currentState\":\"Actual state\",\"motion\":\"Actual motion\",\"issues\":[]}]}");
    assertEquals("uncertain", ProductVideoContinuityService.parseTimeline(value, request, 0, 1).get(0).status());
    assertThrows(ApiException.class, () -> ProductVideoContinuityService.parseTimeline(value, request, 1, 2));
  }

  @Test void wholeEndSamplingStaysInsideTheActualFinalFrameWhenMetadataIsSlightlyShorter() throws Exception {
    var plans = mock(ProductVideoPlanService.class); responses(plans);
    var service = service(plans, movie(14.95));
    try {
      var request = wholeRequest(15, 1);
      service.create(1L, request);
      var state = await(service, request.id());
      assertEquals("completed", state.status(), state.error()); assertEquals(1, state.results().size());
      var input = org.mockito.ArgumentCaptor.forClass(Object.class);
      verify(plans).inspectContinuity(eq("default"), eq("timeline"), input.capture(), anyList());
      var data = mapper.valueToTree(input.getValue());
      double last = data.path("sections").get(0).path("tailFrames").get(2).path("sourceTime").asDouble();
      assertTrue(last < data.path("actualDuration").asDouble() - .04);
    } finally { service.close(); }
  }
  private ProductVideoContinuityService.State await(ProductVideoContinuityService service, String id) throws Exception {
    for (int attempt = 0; attempt < 300; attempt++) {
      var state = service.get(1L, id);
      if (List.of("completed", "failed", "cancelled").contains(state.status())) return state;
      Thread.sleep(50);
    }
    fail("Review did not complete"); return null;
  }

  @Test void realSamplingAndCheckpointedReviewUseActualFramesAndOneWholeStoryCall() throws Exception {
    var plans = mock(ProductVideoPlanService.class); responses(plans);
    var service = service(plans, movie());
    try {
      var request = request("boundaries", 3);
      service.create(1L, request);
      var state = await(service, request.id());
      assertEquals("completed", state.status(), state.error());
      assertEquals(2, state.results().size());
      assertTrue(state.results().get(0).suggestedPreviousEnd() < 4);
      var images = org.mockito.ArgumentCaptor.forClass(List.class);
      var submittedEvidence = org.mockito.ArgumentCaptor.forClass(Object.class);
      verify(plans).inspectContinuity(eq("default"), eq("boundaries"), submittedEvidence.capture(), images.capture());
      assertTrue(images.getValue().size() >= 2 && images.getValue().size() <= 4);
      assertTrue(images.getValue().stream().allMatch(value -> value.toString().startsWith("data:image/jpeg;base64,")));
      var evidenceJson = mapper.valueToTree(submittedEvidence.getValue());
      assertFalse(evidenceJson.toString().contains("https://owned.example"));
      for (var pair : evidenceJson.path("pairs")) {
        assertEquals(3, pair.path("previousFrames").size());
        assertEquals(3, pair.path("currentFrames").size());
        assertEquals(1, pair.path("previousPlaybackRate").asDouble());
        for (String field : List.of("previousFrames", "currentFrames")) for (int panel = 0; panel < 3; panel++) {
          var label = pair.path(field).get(panel);
          assertEquals(panel, label.path("panelIndex").asInt());
          assertTrue(label.path("imageIndex").asInt() < images.getValue().size());
          assertTrue(label.path("sourceTime").asDouble() < 4);
        }
      }
      verify(plans).inspectContinuity(eq("default"), eq("whole"), any(), eq(List.of()));
      String saved = Files.readString(temporary.resolve("reviews/1/" + request.id() + "/state.json"));
      assertFalse(saved.contains("base64"));
      assertFalse(Files.exists(temporary.resolve("reviews/1/" + request.id() + "/batch-0")));
      var restored = service.get(1L, request.id());
      assertEquals(state, restored);
      var clips = request.clips().stream().map(clip -> new ProductVideoDtos.Clip(clip.url(), clip.start(), clip.duration(), "")).toList();
      assertDoesNotThrow(() -> service.verifyComposition(1L, request.id(), clips));
      var swapped = new java.util.ArrayList<>(clips); java.util.Collections.reverse(swapped);
      assertThrows(ApiException.class, () -> service.verifyComposition(1L, request.id(), swapped));
      assertThrows(ApiException.class, () -> service.verifyComposition(2L, request.id(), clips));
      assertThrows(ApiException.class, () -> service.get(2L, request.id()));
      assertEquals(state, service.create(1L, request));
      verify(plans, times(2)).inspectContinuity(anyString(), anyString(), any(), anyList());
      var changed = new ProductVideoContinuityService.Request(request.id(), request.kind(), request.model(), "Changed", request.clips());
      assertThrows(ApiException.class, () -> service.create(1L, changed));
    } finally { service.close(); }
  }

  @Test void handoffAnalyzesThreeActualTailFramesAndDoesNotCheckAFictionalNextVideo() throws Exception {
    var plans = mock(ProductVideoPlanService.class); responses(plans);
    var service = service(plans, movie());
    try {
      var request = request("handoff", 1);
      service.create(1L, request);
      var state = await(service, request.id());
      assertEquals("completed", state.status(), state.error());
      assertEquals("", state.results().get(0).currentId());
      var images = org.mockito.ArgumentCaptor.forClass(List.class);
      verify(plans).inspectContinuity(eq("default"), eq("handoff"), any(), images.capture());
      assertEquals(1, images.getValue().size());
      var bytes = java.util.Base64.getDecoder().decode(images.getValue().get(0).toString().split(",", 2)[1]);
      var strip = javax.imageio.ImageIO.read(new java.io.ByteArrayInputStream(bytes));
      assertTrue(strip.getWidth() > strip.getHeight() * 2);
      verify(plans, never()).inspectContinuity(anyString(), eq("whole"), any(), anyList());
    } finally { service.close(); }
  }

  @Test void stoppingAnInFlightBatchPreservesResultsAndMakesNoFurtherModelCalls() throws Exception {
    var plans = mock(ProductVideoPlanService.class);
    responses(plans);
    CountDownLatch entered = new CountDownLatch(1), released = new CountDownLatch(1);
    doAnswer(call -> {
      entered.countDown(); assertTrue(released.await(10, TimeUnit.SECONDS));
      return mapper.readTree("{\"results\":[{\"index\":0,\"status\":\"pass\",\"confidence\":0.9,\"previousState\":\"Moving\",\"currentState\":\"Moving\",\"motion\":\"Right\",\"issues\":[]},{\"index\":1,\"status\":\"pass\",\"confidence\":0.9,\"previousState\":\"Moving\",\"currentState\":\"Moving\",\"motion\":\"Right\",\"issues\":[]}]}");
    }).when(plans).inspectContinuity(anyString(), eq("boundaries"), any(), anyList());
    var service = service(plans, movie());
    try {
      var request = request("boundaries", 5);
      service.create(1L, request); assertTrue(entered.await(10, TimeUnit.SECONDS));
      assertEquals("stopping", service.cancel(1L, request.id()).status());
      released.countDown();
      var state = await(service, request.id());
      assertEquals("cancelled", state.status()); assertEquals(2, state.results().size());
      verify(plans, times(1)).inspectContinuity(anyString(), anyString(), any(), anyList());
    } finally { released.countDown(); service.close(); }
  }

  @Test void restartDoesNotAutomaticallyRepeatAnUncertainModelCall() throws Exception {
    var plans = mock(ProductVideoPlanService.class);
    var service = service(plans, movie());
    try {
      String id = UUID.randomUUID().toString();
      Path directory = temporary.resolve("reviews/1/" + id); Files.createDirectories(directory);
      var state = new ProductVideoContinuityService.State(id, "processing", 40, "In flight", List.of(), "", List.of(), "");
      Files.writeString(directory.resolve("state.json"), mapper.writeValueAsString(state));
      var stopped = service.get(1L, id);
      assertEquals("failed", stopped.status()); assertTrue(stopped.error().contains("未自动重复"));
      verify(plans, never()).inspectContinuity(anyString(), anyString(), any(), anyList());
    } finally { service.close(); }
  }

  @Test void parsingRejectsMissingOrWrongPairsAndDowngradesLowConfidence() throws Exception {
    var request = request("boundaries", 2);
    var sample = new ProductVideoContinuityService.Sample(List.of(0.0, .4, .8), List.of(), 80, 5);
    var evidence = Map.of(0, new ProductVideoContinuityService.Evidence(request.clips().get(0), 4, sample, sample),
        1, new ProductVideoContinuityService.Evidence(request.clips().get(1), 4, sample, sample));
    var value = mapper.readTree("{\"results\":[{\"index\":0,\"status\":\"pass\",\"confidence\":0.4,\"previousState\":\"Moving\",\"currentState\":\"Moving\",\"motion\":\"Right\",\"issues\":[]}]}");
    assertEquals("uncertain", ProductVideoContinuityService.parse(value, request, 0, 1, evidence).get(0).status());
    ((com.fasterxml.jackson.databind.node.ObjectNode)value.path("results").get(0)).put("index", 8);
    assertThrows(ApiException.class, () -> ProductVideoContinuityService.parse(value, request, 0, 1, evidence));
    assertThrows(ApiException.class, () -> ProductVideoContinuityService.parse(mapper.readTree("{\"results\":[]}"), request, 0, 1, evidence));
  }

  @Test void lockedCutSuggestionsAreIgnoredAndSamplingRespectsSourceSpeed() throws Exception {
    var request = new ProductVideoContinuityService.Request(UUID.randomUUID().toString(), "boundaries", "default", "",
        List.of(clip("a", false), clip("b", false)));
    var sample = new ProductVideoContinuityService.Sample(List.of(0.0, .4, .8), List.of(), 80, 5);
    var evidence = Map.of(0, new ProductVideoContinuityService.Evidence(request.clips().get(0), 4, sample, sample),
        1, new ProductVideoContinuityService.Evidence(request.clips().get(1), 4, sample, sample));
    var value = mapper.readTree("{\"results\":[{\"index\":0,\"status\":\"pass\",\"confidence\":0.9,\"previousState\":\"Moving\",\"currentState\":\"Moving\",\"motion\":\"Right\",\"issues\":[],\"previousCutFrame\":1,\"currentCutFrame\":1}]}");
    var result = ProductVideoContinuityService.parse(value, request, 0, 1, evidence).get(0);
    assertNull(result.suggestedPreviousEnd()); assertNull(result.suggestedCurrentStart());
    var times = ProductVideoContinuityService.sampleTimes(0, 15, 3);
    assertEquals(2.4, times[2], .0001); assertEquals(14.96, times[5], .0001);
    assertThrows(ApiException.class, () -> ProductVideoContinuityService.sampleTimes(0, Double.NaN, 1));
    assertThrows(ApiException.class, () -> ProductVideoContinuityService.validate(new ProductVideoContinuityService.Request("../bad", "boundaries", "default", "", request.clips())));
  }
}
