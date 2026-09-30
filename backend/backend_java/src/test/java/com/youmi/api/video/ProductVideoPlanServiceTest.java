package com.youmi.api.video;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.youmi.api.ai.AgentChatClient;
import com.youmi.api.ai.AiChatDtos;
import com.youmi.api.ai.GemAgentClient;
import com.youmi.api.common.ApiException;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ProductVideoPlanServiceTest {
  private final ObjectMapper mapper = new ObjectMapper();
  private final AgentChatClient client = mock(AgentChatClient.class);
  private final ProductVideoPlanService service = new ProductVideoPlanService(client, mapper, 180);

  @Test void fixedContinuityReachesOutlineAndEveryDetailBatchWithoutChangingBriefOrReferences() throws Exception {
    when(client.isConfigured()).thenReturn(true);
    var inputs = new java.util.ArrayList<JsonNode>();
    var prompts = new java.util.ArrayList<String>();
    when(client.completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class)))
        .thenAnswer(invocation -> {
          var input = mapper.readTree(invocation.getArgument(1, String.class));
          inputs.add(input);
          prompts.add(invocation.getArgument(0));
          assertEquals(List.of("https://assets.example/product.jpg"), invocation.getArgument(2));
          String result = input.has("outline")
              ? details(java.util.Collections.nCopies(input.path("outline").path("shots").size(), "none").toArray(String[]::new)).toString()
              : outline("none", "none", "none").toString();
          return new AiChatDtos.CompletionResult("mock", "test", result);
        });
    var request = new ProductVideoDtos.PlanRequest("商品信息", List.of("https://assets.example/product.jpg"), 3,
        "3:4", null, List.of(), "storyboard", null, false, null, "default", "同一客厅、白衣人物、白色纱帘");
    assertEquals(3, service.plan(request).shots().size());
    assertEquals(3, inputs.size());
    for (int i = 0; i < inputs.size(); i++) {
      var source = inputs.get(i).has("source") ? inputs.get(i).path("source") : inputs.get(i);
      assertEquals(request.continuity(), source.path("continuity").asText());
      assertEquals(request.brief(), source.path("brief").asText());
      assertTrue(prompts.get(i).contains("全部镜头及 timeline 必须使用同一个房间"));
      assertTrue(prompts.get(i).contains("纯商品特写仍可不出人物"));
    }
    assertEquals(request, mapper.readValue(mapper.writeValueAsString(request), ProductVideoDtos.PlanRequest.class));
  }

  @Test void fixedContinuityIsOptionalForOldJobsAndBoundedSeparatelyFromTheBrief() throws Exception {
    var request = mapper.readValue("{\"brief\":\"curtain\",\"count\":1,\"ratio\":\"3:4\"}", ProductVideoDtos.PlanRequest.class);
    assertNull(request.continuity());
    service.validate(request);
    var tooLong = new ProductVideoDtos.PlanRequest("curtain", List.of(), 1, "3:4", null, null,
        "storyboard", null, false, null, null, "x".repeat(5001));
    assertTrue(assertThrows(ApiException.class, () -> service.validate(tooLong)).getMessage().contains("5000"));
  }

  @Test void wholeVideoContinuityKeepsProductEvidenceButDoesNotImposeSharedStoryboardAnchors() throws Exception {
    for (int seconds : new int[]{15, 30}) for (boolean fixed : new boolean[]{false, true}) {
      reset(client);
      replies(countedOutline(seconds, 4), countedDetails(4));
      String settings = fixed ? "固定场景和人物已开启：同一客厅与人物。图1是固定商品图。"
          : "场景与人物未锁定，商品外观保持参考图中的白色。图1是固定商品图。";
      var request = new ProductVideoDtos.PlanRequest("商品视频", List.of("https://assets.example/product.jpg"),
          1, "3:4", null, List.of(), seconds == 30 ? "single_video_30" : "single_video", 4,
          false, null, "default", settings);
      assertEquals(seconds, service.plan(request).shots().get(0).duration());
      var prompts = ArgumentCaptor.forClass(String.class);
      var inputs = ArgumentCaptor.forClass(String.class);
      verify(client, times(2)).completeVision(prompts.capture(), inputs.capture(), anyList(), anyDouble(), anyInt(), any(Duration.class));
      for (int i = 0; i < 2; i++) {
        assertTrue(prompts.getAllValues().get(i).contains("只有用户明确开启固定场景和人物时"));
        assertTrue(prompts.getAllValues().get(i).contains("不要求先生成一张供其他镜头使用的基准图"));
        assertTrue(prompts.getAllValues().get(i).contains("商品款式、实际颜色、材质、纹理、结构与安装方式始终以商品参考图为准"));
        assertFalse(prompts.getAllValues().get(i).contains("全部镜头及 timeline 必须使用同一个房间"));
        assertFalse(prompts.getAllValues().get(i).contains("第一个镜头建立房间与商品的中景或全景"));
        var input = mapper.readTree(inputs.getAllValues().get(i));
        assertEquals(settings, (input.has("source") ? input.path("source") : input).path("continuity").asText());
      }
    }
  }

  @Test void fixedReferenceImagesReachAllStagesWithTheirRoleMappingAndWithoutTextDescriptions() throws Exception {
    when(client.isConfigured()).thenReturn(true);
    var images = java.util.stream.IntStream.range(1, 9).mapToObj(i -> "https://assets.example/" + i + ".png").toList();
    String roles = "图1是固定商品图；图7是固定场景图；图8是固定人物图。对应文字可以留空。";
    var inputs = new java.util.ArrayList<JsonNode>();
    when(client.completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class)))
        .thenAnswer(invocation -> {
          var input = mapper.readTree(invocation.getArgument(1, String.class));
          inputs.add(input);
          assertEquals(images, invocation.getArgument(2));
          String system = invocation.getArgument(0);
          assertTrue(system.contains("不要将所有附图都当成商品图"));
          assertTrue(system.contains("不要求用户再次用文字描述"));
          var source = input.has("source") ? input.path("source") : input;
          assertEquals(roles, source.path("continuity").asText());
          String result = input.has("outline") ? details("none").toString() : outline("none").toString();
          return new AiChatDtos.CompletionResult("mock", "test", result);
        });
    var request = new ProductVideoDtos.PlanRequest("窗帘主图视频", images, 1, "3:4", null, List.of(),
        "storyboard", null, false, null, "default", roles);
    assertEquals(1, service.plan(request).shots().size());
    assertEquals(2, inputs.size());
    var overflow = new ProductVideoDtos.PlanRequest(request.brief(),
        java.util.stream.IntStream.range(1, 10).mapToObj(i -> "https://assets.example/" + i + ".png").toList(),
        1, "3:4", null, List.of(), "storyboard", null, false, null, "default", roles);
    assertTrue(assertThrows(ApiException.class, () -> service.validate(overflow)).getMessage().contains("最多 8 张"));
    var legacy = new ProductVideoDtos.PlanRequest(request.brief(), images, 1, "3:4", null, null);
    assertTrue(assertThrows(ApiException.class, () -> service.validate(legacy)).getMessage().contains("最多 6 张"));
  }

  private ProductVideoDtos.PlanRequest longReferenceRequest() {
    return longReferenceRequest(14);
  }

  private ProductVideoDtos.PlanRequest longReferenceRequest(int count) {
    var segments = new java.util.ArrayList<ProductVideoDtos.ReferenceSegment>();
    var frames = new java.util.ArrayList<ProductVideoDtos.ReferenceFrame>();
    for (int i = 0; i < count; i++) {
      double start = Math.round(i * 10500.0 / count) / 100.0;
      double end = Math.round((i + 1) * 10500.0 / count) / 100.0;
      segments.add(new ProductVideoDtos.ReferenceSegment(start, end));
      for (double time : new double[]{start + .03, (start + end) / 2, end - .04})
        frames.add(new ProductVideoDtos.ReferenceFrame("https://assets.example/" + time + ".jpg", time));
    }
    var video = new ProductVideoDtos.ReferenceVideo("https://assets.example/source.mp4", "long", 105,
        1920, 1080, "No transcript", frames, segments);
    return new ProductVideoDtos.PlanRequest("窗帘", List.of("https://assets.example/product.jpg"), count,
        "16:9", null, null, "storyboard", null, false, video, "default");
  }

  private String longStageResponse(String input) throws Exception {
    var source = mapper.readTree(input);
    if (source.has("expectedShots")) {
      var analysis = referenceAnalysis(source.path("expectedShots").asInt());
      for (int i = 0; i < source.path("segments").size(); i++) {
        var shot = (ObjectNode) analysis.path("shots").get(i);
        shot.put("sourceStart", source.path("segments").get(i).path("start").asDouble());
        shot.put("sourceEnd", source.path("segments").get(i).path("end").asDouble());
      }
      return analysis.toString();
    }
    if (source.has("outline")) return details(java.util.Collections.nCopies(source.path("outline").path("shots").size(), "none")
        .toArray(String[]::new)).toString();
    if (source.has("referenceVideoAnalysis")) {
      var referenceShots = source.path("referenceVideoAnalysis").path("shots");
      var result = outline(java.util.Collections.nCopies(referenceShots.size(), "none").toArray(String[]::new));
      for (int i = 0; i < referenceShots.size(); i++) {
        var reference = referenceShots.get(i);
        ((ObjectNode) result.path("shots").get(i)).put("duration", reference.path("sourceEnd").asDouble() - reference.path("sourceStart").asDouble());
      }
      return result.toString();
    }
    return "{\"summary\":\"全片结构\",\"continuity\":\"同一人物服装及空间\"}";
  }

  private ProductVideoDtos.PlanRequest highlightRequest(double duration) {
    var base = longReferenceRequest(16);
    var source = base.referenceVideo();
    double scale = duration / source.duration();
    var reference = new ProductVideoDtos.ReferenceVideo(source.url(), source.name(), duration, source.width(), source.height(),
        source.audioSummary(), source.frames().stream().map(frame -> new ProductVideoDtos.ReferenceFrame(frame.url(), frame.time() * scale)).toList(),
        source.segments().stream().map(segment -> new ProductVideoDtos.ReferenceSegment(segment.start() * scale, segment.end() * scale)).toList(), "highlights");
    return new ProductVideoDtos.PlanRequest(base.brief(), base.images(), 1, base.ratio(), null, null,
        "single_video_30", 4, false, reference, "default");
  }

  private String highlightStageResponse(String input) throws Exception {
    var node = mapper.readTree(input);
    if (node.has("candidates")) {
      var selection = mapper.createObjectNode().put("reason", "保留开头、两处核心演示和结尾，省略重复与等待。");
      var items = selection.putArray("selected");
      for (int index : new int[]{1, 6, 12, 16}) items.addObject().put("sourceIndex", index).put("reason", "独立信息价值");
      return selection.toString();
    }
    if (node.has("expectedShots")) return longStageResponse(input);
    return node.has("outline") ? countedDetails(4).toString() : countedOutline(30, 4).toString();
  }

  @Test void highlightsInspectAll120SecondsBeforeSelectingOneNaturalThirtySecondPlan() throws Exception {
    when(client.isConfigured()).thenReturn(true);
    var inputs = new java.util.ArrayList<JsonNode>();
    var imageInputs = new java.util.ArrayList<List<String>>();
    var prompts = new java.util.ArrayList<String>();
    when(client.completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class)))
        .thenAnswer(invocation -> {
          inputs.add(mapper.readTree(invocation.getArgument(1, String.class)));
          imageInputs.add(invocation.getArgument(2));
          prompts.add(invocation.getArgument(0));
          return new AiChatDtos.CompletionResult("mock", "test", highlightStageResponse(invocation.getArgument(1)));
        });
    var request = highlightRequest(120);
    var result = service.plan(request);
    assertEquals(11, inputs.size());
    assertEquals(request.referenceVideo().frames().stream().map(ProductVideoDtos.ReferenceFrame::url).toList(),
        imageInputs.subList(0, 8).stream().flatMap(List::stream).toList());
    assertTrue(imageInputs.subList(0, 8).stream().allMatch(images -> images.size() == 6));
    assertEquals(request.referenceVideo().frames().stream().map(ProductVideoDtos.ReferenceFrame::time).toList(),
        inputs.subList(0, 8).stream().flatMap(input -> java.util.stream.StreamSupport.stream(input.path("frameTimes").spliterator(), false))
            .map(JsonNode::asDouble).toList());
    var selectionInput = inputs.get(8);
    assertEquals(16, selectionInput.path("candidates").size());
    assertEquals(120, selectionInput.path("candidates").get(15).path("sourceEnd").asDouble());
    assertEquals(30, selectionInput.path("targetDuration").asInt());
    var selected = inputs.get(9).path("referenceVideoAnalysis").path("shots");
    assertEquals(4, selected.size());
    assertEquals(16, selected.get(3).path("originalSourceIndex").asInt());
    assertEquals(120, selected.get(3).path("sourceEnd").asDouble());
    assertTrue(prompts.get(9).contains("不按全片比例加速"));
    assertFalse(prompts.get(9).contains("本次按原片等长分段制作"));
    assertEquals(1, result.shots().size());
    assertEquals(30, result.shots().get(0).duration());
    assertEquals(4, result.shots().get(0).timeline().size());
    assertEquals(30, result.shots().get(0).timeline().get(3).end());
    assertTrue(result.summary().concept().contains("120.0 秒"));
  }

  @Test void highlightsResumeCachedSourceAnalysisAndSelectionWithoutResubmittingThem() throws Exception {
    when(client.isConfigured()).thenReturn(true);
    var inputs = new java.util.ArrayList<JsonNode>();
    var fail = new java.util.concurrent.atomic.AtomicBoolean(true);
    when(client.completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class)))
        .thenAnswer(invocation -> {
          var input = mapper.readTree(invocation.getArgument(1, String.class));
          inputs.add(input);
          if (input.has("referenceVideoAnalysis") && !input.has("outline") && fail.compareAndSet(true, false))
            throw new ApiException(502, "temporary failure");
          return new AiChatDtos.CompletionResult("mock", "test", highlightStageResponse(invocation.getArgument(1)));
        });
    var cached = new java.util.HashMap<String, String>();
    var progress = new ProductVideoPlanService.ProgressListener() {
      public void save(String stage, JsonNode outline, List<ProductVideoDtos.ShotPlan> shots, String provider) {}
      public void response(String stage, String content) { cached.put(stage, content); }
      public String previousResponse(String stage) { return cached.get(stage); }
    };
    var request = highlightRequest(105);
    assertThrows(ApiException.class, () -> service.plan(request, null, List.of(), progress));
    assertEquals(9, cached.size());
    assertEquals(30, service.plan(request, null, List.of(), progress).shots().get(0).duration());
    assertEquals(8, inputs.stream().filter(node -> node.has("segments")).count());
    assertEquals(1, inputs.stream().filter(node -> node.has("candidates")).count());
    assertEquals(12, inputs.size());
  }

  @Test void highlightsRejectAmbiguousSelectionAndInvalidModesBeforeCallingProviders() throws Exception {
    var request = highlightRequest(120);
    var candidates = referenceAnalysis(16).path("shots");
    for (String indices : List.of("1,1,12,16", "1,6,12,17", "6,1,12,16", "1,6,12")) {
      var selection = mapper.createObjectNode().put("reason", "选择理由");
      var items = selection.putArray("selected");
      for (String index : indices.split(",")) items.addObject().put("sourceIndex", Integer.parseInt(index)).put("reason", "保留");
      assertThrows(ApiException.class, () -> service.parseHighlightSelection(selection.toString(), candidates, 4, request.referenceVideo()));
    }
    assertThrows(ApiException.class, () -> service.validate(highlightRequest(121)));
    assertThrows(ApiException.class, () -> service.validate(highlightRequest(30)));
    assertThrows(ApiException.class, () -> service.validate(new ProductVideoDtos.PlanRequest(request.brief(), request.images(),
        1, request.ratio(), null, null, "single_video", 4, false, request.referenceVideo())));
    assertThrows(ApiException.class, () -> service.validate(new ProductVideoDtos.PlanRequest(request.brief(), request.images(),
        1, request.ratio(), null, null, "single_video_30", null, false, request.referenceVideo())));
    verifyNoInteractions(client);
  }

  @Test void gemLongReferenceUsesLargerPlanningBudgetAndRetriesOnlyTheTruncatedBatchOnce() throws Exception {
    var gem = mock(GemAgentClient.class);
    var selectedService = new ProductVideoPlanService(client, mapper, 180, gem);
    when(gem.isConfigured()).thenReturn(true);
    var budgets = new java.util.ArrayList<Integer>();
    var inputs = new java.util.ArrayList<String>();
    var images = new java.util.ArrayList<List<String>>();
    var timeouts = new java.util.ArrayList<Duration>();
    var truncated = new java.util.concurrent.atomic.AtomicBoolean();
    when(gem.complete(anyString(), anyString(), anyList(), anyDouble(), eq(true), anyInt(), any(Duration.class)))
        .thenAnswer(invocation -> {
          String input = invocation.getArgument(1);
          budgets.add(invocation.getArgument(5));
          inputs.add(input);
          images.add(invocation.getArgument(2));
          timeouts.add(invocation.getArgument(6));
          if (mapper.readTree(input).has("expectedShots") && truncated.compareAndSet(false, true))
            throw new GemAgentClient.OutputLimitException();
          return new AiChatDtos.CompletionResult("lk888", GemAgentClient.MODEL, longStageResponse(input));
        });
    var source = longReferenceRequest(27);
    var request = new ProductVideoDtos.PlanRequest(source.brief(), source.images(), source.count(), source.ratio(),
        null, null, source.productionMode(), null, false, source.referenceVideo(), GemAgentClient.MODEL);
    var result = selectedService.plan(request);
    assertEquals(27, result.shots().size());
    assertEquals(105, result.shots().stream().mapToDouble(ProductVideoDtos.ShotPlan::duration).sum(), .001);
    assertEquals(44, budgets.size());
    assertTrue(budgets.stream().allMatch(budget -> budget >= 12000 && budget <= 16000));
    assertEquals(List.of(12000, 12000, 16000, 12000), budgets.subList(0, 4));
    assertEquals(inputs.get(1), inputs.get(2), "Recovery must not remove segments or change source timing");
    assertEquals(images.get(1), images.get(2), "Recovery must keep all six source frames");
    assertEquals(6, images.get(2).size());
    assertTrue(timeouts.get(2).compareTo(Duration.ofSeconds(180)) <= 0);
    assertTrue(timeouts.get(2).compareTo(Duration.ofSeconds(10)) >= 0);
    verifyNoInteractions(client);
  }

  @Test void gemRepeatedTruncationStopsAfterOneRecoveryAndDoesNotSavePartialShots() throws Exception {
    var gem = mock(GemAgentClient.class);
    var selectedService = new ProductVideoPlanService(client, mapper, 180, gem);
    when(gem.isConfigured()).thenReturn(true);
    when(gem.complete(anyString(), anyString(), anyList(), anyDouble(), eq(true), anyInt(), any(Duration.class)))
        .thenThrow(new GemAgentClient.OutputLimitException());
    var request = new ProductVideoDtos.PlanRequest("商品", List.of(), 2, "16:9", null, null,
        "storyboard", null, false, null, GemAgentClient.MODEL);
    var saved = new java.util.ArrayList<ProductVideoDtos.ShotPlan>();
    var error = assertThrows(ApiException.class, () -> selectedService.plan(request, null, List.of(),
        (stage, outline, shots, provider) -> saved.addAll(shots)));
    assertTrue(error.getMessage().contains("商品识图与整片策划"));
    assertTrue(error.getMessage().contains("继续未完成分镜"));
    assertFalse(error.getMessage().contains("缩小本次需求"));
    assertTrue(saved.isEmpty());
    var budgets = ArgumentCaptor.forClass(Integer.class);
    verify(gem, times(2)).complete(anyString(), anyString(), anyList(), anyDouble(), eq(true), budgets.capture(), any(Duration.class));
    assertEquals(List.of(12000, 16000), budgets.getAllValues());
    verifyNoInteractions(client);
  }

  @Test void gemTransportTimeoutAndPermissionErrorsNeverTriggerOutputRecovery() throws Exception {
    var gem = mock(GemAgentClient.class);
    var selectedService = new ProductVideoPlanService(client, mapper, 180, gem);
    var request = new ProductVideoDtos.PlanRequest("商品", List.of(), 1, "16:9", null, null,
        "storyboard", null, false, null, GemAgentClient.MODEL);
    for (Exception failure : List.of(new HttpTimeoutException("timeout"), new java.io.IOException("connection lost"),
        new ApiException(502, "GEM 接口请求失败（HTTP 403）"))) {
      reset(gem);
      when(gem.isConfigured()).thenReturn(true);
      when(gem.complete(anyString(), anyString(), anyList(), anyDouble(), eq(true), anyInt(), any(Duration.class)))
          .thenThrow(failure);
      assertThrows(ApiException.class, () -> selectedService.plan(request));
      verify(gem, times(1)).complete(anyString(), anyString(), anyList(), anyDouble(), eq(true), eq(12000), any(Duration.class));
    }
    verifyNoInteractions(client);
  }

  @Test void repairedAnalysisStillRequiresEveryFieldAndTheExpectedShotCount() throws Exception {
    String valid = referenceAnalysis(2).toString();
    String damaged = valid.substring(0, valid.length() - 2) + "盖]}";
    assertEquals(mapper.readTree(valid), service.parseReferenceAnalysis(damaged, 2, 12));
    assertThrows(ApiException.class, () -> service.parseReferenceAnalysis(damaged, 3, 12));
    var incomplete = referenceAnalysis(2);
    ((ObjectNode) incomplete.path("shots").get(1)).remove("action");
    String missing = incomplete.toString();
    assertThrows(ApiException.class, () -> service.parseReferenceAnalysis(
        missing.substring(0, missing.length() - 2) + "盖]}", 2, 12));
    var outsideRange = referenceAnalysis(2);
    ((ObjectNode) outsideRange.path("shots").get(1)).put("sourceEnd", 99);
    String invalidRange = outsideRange.toString();
    assertThrows(ApiException.class, () -> service.parseReferenceAnalysis(
        invalidRange.substring(0, invalidRange.length() - 2) + "盖]}", 2, 12));
  }

  @Test void resumesSavedMalformedReferenceAnalysisWithoutReanalyzingCompletedBatches() throws Exception {
    when(client.isConfigured()).thenReturn(true);
    var request = longReferenceRequest();
    var completed = java.util.stream.IntStream.range(0, 6).mapToObj(index -> new ProductVideoDtos.ShotPlan(
        "Original " + index, "original frame", "original movement", "", 7.5, "purpose", "design")).toList();
    var cached = new java.util.HashMap<String, String>();
    cached.put("long-overview", "{\"summary\":\"全片结构\",\"continuity\":\"同一人物服装及空间\"}");
    var analysis = referenceAnalysis(2);
    for (int i = 0; i < 2; i++) {
      ((ObjectNode) analysis.path("shots").get(i)).put("sourceStart", i * 7.5).put("sourceEnd", (i + 1) * 7.5);
    }
    String valid = analysis.toString();
    cached.put("long-6-reference-analysis", valid.substring(0, valid.length() - 2) + "盖]}");
    var calls = new java.util.ArrayList<JsonNode>();
    when(client.completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class)))
        .thenAnswer(invocation -> {
          calls.add(mapper.readTree(invocation.getArgument(1, String.class)));
          return new AiChatDtos.CompletionResult("mock", "test", longStageResponse(invocation.getArgument(1)));
        });
    var result = service.plan(request, null, completed, new ProductVideoPlanService.ProgressListener() {
      public void save(String stage, JsonNode outline, List<ProductVideoDtos.ShotPlan> shots, String provider) {}
      public String previousResponse(String stage) { return cached.get(stage); }
    });
    assertEquals(completed, result.shots().subList(0, 6));
    assertEquals(14, result.shots().size());
    assertEquals(105, result.shots().stream().mapToDouble(ProductVideoDtos.ShotPlan::duration).sum(), .001);
    assertEquals(11, calls.size());
    assertTrue(calls.get(0).has("referenceVideoAnalysis"), "Saved analysis must be reused before writing the next outline");
    assertFalse(calls.get(0).has("expectedShots"));
    assertTrue(cached.get("long-6-reference-analysis").endsWith("盖]}"));
  }

  @Test void optionalLocalCheckpointReplaysOfflineWithoutWritingUserDataOrCallingProviders() throws Exception {
    String file = System.getProperty("youmi.plan-regression-file");
    org.junit.jupiter.api.Assumptions.assumeTrue(file != null && !file.isBlank());
    var path = java.nio.file.Path.of(file);
    String original = java.nio.file.Files.readString(path);
    var saved = mapper.readValue(original, ProductVideoPlanJobs.Saved.class);
    var gem = mock(GemAgentClient.class);
    when(gem.isConfigured()).thenReturn(true);
    when(client.isConfigured()).thenReturn(true);
    when(gem.complete(anyString(), anyString(), anyList(), anyDouble(), eq(true), anyInt(), any(Duration.class)))
        .thenAnswer(invocation -> new AiChatDtos.CompletionResult("mock", GemAgentClient.MODEL,
            longStageResponse(invocation.getArgument(1))));
    when(client.completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class)))
        .thenAnswer(invocation -> new AiChatDtos.CompletionResult("mock", "test", longStageResponse(invocation.getArgument(1))));
    var result = new ProductVideoPlanService(client, mapper, 180, gem).plan(saved.request(), saved.outline(),
        saved.state().result().shots(), new ProductVideoPlanService.ProgressListener() {
          public void save(String stage, JsonNode outline, List<ProductVideoDtos.ShotPlan> shots, String provider) {}
          public String previousResponse(String stage) { return saved.responses().get(stage); }
        });
    assertEquals(saved.request().count(), result.shots().size());
    assertEquals(saved.request().referenceVideo().duration(), result.shots().stream().mapToDouble(ProductVideoDtos.ShotPlan::duration).sum(), .011);
    assertEquals(saved.state().result().shots(), result.shots().subList(0, saved.state().result().shots().size()));
    assertEquals(original, java.nio.file.Files.readString(path));
  }

  @Test void longReferencePlansAll105SecondsInBoundedBatchesAndResumesWithoutRepeatingCompletedShots() throws Exception {
    when(client.isConfigured()).thenReturn(true);
    var detailCalls = new java.util.concurrent.atomic.AtomicInteger();
    var calls = new java.util.ArrayList<String>();
    when(client.completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class)))
        .thenAnswer(invocation -> {
          String input = invocation.getArgument(1);
          calls.add(input);
          assertTrue(((List<?>) invocation.getArgument(2)).size() <= 8);
          if (mapper.readTree(input).has("outline") && detailCalls.incrementAndGet() == 2)
            throw new ApiException(502, "temporary failure");
          return new AiChatDtos.CompletionResult("mock", "test", longStageResponse(input));
        });
    var responses = new java.util.HashMap<String, String>();
    var saved = new java.util.concurrent.atomic.AtomicReference<List<ProductVideoDtos.ShotPlan>>(List.of());
    ProductVideoPlanService.ProgressListener progress = new ProductVideoPlanService.ProgressListener() {
      public void save(String stage, JsonNode outline, List<ProductVideoDtos.ShotPlan> shots, String provider) { saved.set(shots); }
      public void response(String stage, String content) { responses.put(stage, content); }
      public String previousResponse(String stage) { return responses.get(stage); }
    };
    assertThrows(ApiException.class, () -> service.plan(longReferenceRequest(), null, List.of(), progress));
    assertEquals(2, saved.get().size());
    assertEquals(7, calls.size());
    var result = service.plan(longReferenceRequest(), null, saved.get(), progress);
    assertEquals(14, result.shots().size());
    assertEquals(105, result.shots().stream().mapToDouble(ProductVideoDtos.ShotPlan::duration).sum(), .001);
    assertEquals(23, calls.size(), "Overview, completed batch and valid outline must not be regenerated");
    assertEquals(14, saved.get().size());
    assertEquals("全片结构", result.summary().analysis());
    assertTrue(calls.stream().anyMatch(input -> input.contains("同一人物服装及空间")));
  }

  @Test void longReferenceRejectsMissingTruncatedOverlappingOrOverlongSegmentsBeforeCallingProvider() throws Exception {
    var request = longReferenceRequest();
    assertDoesNotThrow(() -> service.validate(request));
    var video = request.referenceVideo();
    for (var segments : List.of(video.segments().subList(0, 13),
        java.util.stream.IntStream.range(0, 14).mapToObj(i -> i == 1
            ? new ProductVideoDtos.ReferenceSegment(7, 15) : video.segments().get(i)).toList(),
        List.of(new ProductVideoDtos.ReferenceSegment(0, 105)))) {
      var invalid = new ProductVideoDtos.ReferenceVideo(video.url(), video.name(), video.duration(),
          video.width(), video.height(), video.audioSummary(), video.frames(), segments);
      assertThrows(ApiException.class, () -> service.validate(new ProductVideoDtos.PlanRequest(request.brief(),
          request.images(), segments.size(), request.ratio(), null, null, "storyboard", null, false, invalid)));
    }
    var missing = new ProductVideoDtos.ReferenceVideo(video.url(), video.name(), video.duration(),
        video.width(), video.height(), video.audioSummary(), video.frames());
    assertThrows(ApiException.class, () -> service.validate(new ProductVideoDtos.PlanRequest(request.brief(),
        request.images(), 14, request.ratio(), null, null, "storyboard", null, false, missing)));
    verify(client, never()).completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class));
  }

  @Test void selectedGemHandlesEveryStageAndRefinementForAllProductionModes() throws Exception {
    var gem = mock(GemAgentClient.class);
    var selectedService = new ProductVideoPlanService(client, mapper, 180, gem);
    when(gem.isConfigured()).thenReturn(true);
    for (String mode : List.of("storyboard", "single_video", "single_video_30")) {
      clearInvocations(gem);
      boolean whole = !"storyboard".equals(mode);
      String strategy = (whole ? countedOutline("single_video_30".equals(mode) ? 30 : 15, 4) : outline("hands")).toString();
      String detail = (whole ? countedDetails(4) : details("hands")).toString();
      when(gem.complete(anyString(), anyString(), anyList(), anyDouble(), eq(true), anyInt(), any(Duration.class)))
          .thenReturn(new AiChatDtos.CompletionResult("lk888", GemAgentClient.MODEL, strategy),
              new AiChatDtos.CompletionResult("lk888", GemAgentClient.MODEL, detail),
              new AiChatDtos.CompletionResult("lk888", GemAgentClient.MODEL, strategy),
              new AiChatDtos.CompletionResult("lk888", GemAgentClient.MODEL, detail));
      var images = List.of("https://assets.example/product.png");
      var request = new ProductVideoDtos.PlanRequest("窗帘", images, 1, "3:4", null, null, mode,
          whole ? 4 : null, false, null, GemAgentClient.MODEL);
      var result = selectedService.plan(request);
      assertEquals("lk888", result.provider());
      assertEquals(1, result.shots().size());
      selectedService.plan(new ProductVideoDtos.PlanRequest("窗帘", images, 1, "3:4", result.shots().get(0),
          null, mode, whole ? 4 : null, false, null, GemAgentClient.MODEL));
      verify(gem, times(4)).complete(anyString(), anyString(), eq(images), anyDouble(), eq(true), anyInt(), eq(Duration.ofSeconds(180)));
    }
    verifyNoInteractions(client);
  }

  @Test void gemReferenceAnalysisUsesTheSameSelectedModelAsProductPlanning() throws Exception {
    var gem = mock(GemAgentClient.class);
    when(gem.isConfigured()).thenReturn(true);
    when(gem.complete(anyString(), anyString(), anyList(), anyDouble(), eq(true), anyInt(), any(Duration.class)))
        .thenReturn(new AiChatDtos.CompletionResult("lk888", GemAgentClient.MODEL, referenceAnalysis(2).toString()),
            new AiChatDtos.CompletionResult("lk888", GemAgentClient.MODEL, outline("person", "none").toString()),
            new AiChatDtos.CompletionResult("lk888", GemAgentClient.MODEL, details("person", "none").toString()));
    var frames = List.of(new ProductVideoDtos.ReferenceFrame("https://assets.example/frame-0.png", 0),
        new ProductVideoDtos.ReferenceFrame("https://assets.example/frame-1.png", 6));
    var video = new ProductVideoDtos.ReferenceVideo("https://assets.example/ref.mp4", "ref", 12, 1080, 1920, "", frames);
    var request = new ProductVideoDtos.PlanRequest("窗帘", List.of("https://assets.example/product.png"), 2,
        "3:4", null, null, "storyboard", null, false, video, GemAgentClient.MODEL);
    assertEquals(2, new ProductVideoPlanService(client, mapper, 180, gem).plan(request).shots().size());
    var imageLists = ArgumentCaptor.forClass(List.class);
    verify(gem, times(3)).complete(anyString(), anyString(), imageLists.capture(), anyDouble(), eq(true), anyInt(), any(Duration.class));
    assertEquals(frames.stream().map(ProductVideoDtos.ReferenceFrame::url).toList(), imageLists.getAllValues().get(0));
    assertEquals(request.images(), imageLists.getAllValues().get(1));
    assertEquals(request.images(), imageLists.getAllValues().get(2));
    verifyNoInteractions(client);
  }

  @Test void unknownOrUnconfiguredPlannerNeverFallsBackAndProviderErrorsArePreserved() throws Exception {
    var gem = mock(GemAgentClient.class);
    var selectedService = new ProductVideoPlanService(client, mapper, 180, gem);
    var request = new ProductVideoDtos.PlanRequest("商品", List.of(), 1, "16:9", null, null,
        "storyboard", null, false, null, GemAgentClient.MODEL);
    assertEquals(503, assertThrows(ApiException.class, () -> selectedService.plan(request)).getCode());
    assertEquals(400, assertThrows(ApiException.class, () -> selectedService.validate(
        new ProductVideoDtos.PlanRequest("商品", List.of(), 1, "16:9", null, null,
            "storyboard", null, false, null, "unknown"))).getCode());
    when(gem.isConfigured()).thenReturn(true);
    when(gem.complete(anyString(), anyString(), anyList(), anyDouble(), eq(true), anyInt(), any(Duration.class)))
        .thenThrow(new ApiException(502, "GEM 接口拒绝访问"));
    assertEquals("GEM 接口拒绝访问", assertThrows(ApiException.class, () -> selectedService.plan(request)).getMessage());
    verify(client, never()).completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class));
  }

  @Test void audioChoiceReachesBothPlanningStagesAndDefaultsOff() throws Exception {
    when(client.isConfigured()).thenReturn(true);
    when(client.completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class)))
        .thenReturn(new AiChatDtos.CompletionResult("mock", "test", outline("hands").toString()),
            new AiChatDtos.CompletionResult("mock", "test", details("hands").toString()));
    var request = new ProductVideoDtos.PlanRequest("窗帘", List.of("https://test.example/ref.png"), 1,
        "16:9", null, List.of(), null, null, true);
    service.plan(request);
    var systems = ArgumentCaptor.forClass(String.class);
    var inputs = ArgumentCaptor.forClass(String.class);
    verify(client, times(2)).completeVision(systems.capture(), inputs.capture(), anyList(), anyDouble(), anyInt(), any(Duration.class));
    for (String system : systems.getAllValues()) {
      assertTrue(system.contains("音画同步已开启"));
      assertTrue(system.contains("imagePrompt 不写声音"));
    }
    assertTrue(mapper.readTree(inputs.getAllValues().get(0)).path("generateAudio").asBoolean());
    assertTrue(mapper.readTree(inputs.getAllValues().get(1)).path("source").path("generateAudio").asBoolean());
    assertFalse(new ProductVideoDtos.PlanRequest("窗帘", List.of(), 1, "16:9", null, List.of()).generateAudio());
    assertEquals("", ProductVideoPlanService.audioPlanningPrompt(false));
  }

  @Test void productAppearanceIsGroundedInReferencesInBothStagesForEveryMode() throws Exception {
    for (String mode : List.of("storyboard", "single_video", "single_video_30")) {
      clearInvocations(client);
      boolean whole = !mode.equals("storyboard");
      replies(whole ? countedOutline(mode.equals("single_video_30") ? 30 : 15, 4) : outline("hands"),
          whole ? countedDetails(4) : details("hands"));
      var images = List.of("https://assets.example/product.png");
      service.plan(new ProductVideoDtos.PlanRequest("保留商品原有印花", images, 1, "16:9", null, null,
          mode, whole ? 4 : null));
      var systems = ArgumentCaptor.forClass(String.class);
      verify(client, times(2)).completeVision(systems.capture(), anyString(), eq(images), anyDouble(), anyInt(), any(Duration.class));
      for (String system : systems.getAllValues()) {
        assertTrue(system.contains("商品外观一致性"));
        assertTrue(system.contains("不混合不同参考图的色号"));
        assertTrue(system.contains("不编造色号或微观纤维结构"));
        assertTrue(system.contains("以图像为准"));
        assertTrue(system.contains("不得抹除原有图案"));
        assertTrue(system.contains("不安排靠侧光强化纤维"));
        assertTrue(system.contains("保持商品底色与白平衡稳定"));
      }
    }
  }

  @Test void referenceVideoIsAnalyzedBeforeProductPlanningAndUsesSeparateImages() throws Exception {
    var frameUrls = List.of("https://assets.example/video-0.jpg", "https://assets.example/video-6.jpg",
        "https://assets.example/video-12.jpg");
    var frames = List.of(new ProductVideoDtos.ReferenceFrame(frameUrls.get(0), .1),
        new ProductVideoDtos.ReferenceFrame(frameUrls.get(1), 6),
        new ProductVideoDtos.ReferenceFrame(frameUrls.get(2), 11.9));
    var referenceVideo = new ProductVideoDtos.ReferenceVideo("https://assets.example/reference.mp4",
        "参考视频.mp4", 12, 1080, 1920, "声音连续，第6秒有峰值。", frames);
    var productImages = List.of("https://assets.example/product.png");
    when(client.isConfigured()).thenReturn(true);
    when(client.completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class)))
        .thenReturn(new AiChatDtos.CompletionResult("mock", "test", referenceAnalysis(2).toString()),
            new AiChatDtos.CompletionResult("mock", "test", outline("person", "none").toString()),
            new AiChatDtos.CompletionResult("mock", "test", details("person", "none").toString()));

    var result = service.plan(new ProductVideoDtos.PlanRequest("替换为白色窗帘", productImages, 2,
        "9:16", null, null, "storyboard", null, true, referenceVideo));
    assertEquals(2, result.shots().size());
    var systems = ArgumentCaptor.forClass(String.class);
    var inputs = ArgumentCaptor.forClass(String.class);
    var images = ArgumentCaptor.forClass(List.class);
    verify(client, times(3)).completeVision(systems.capture(), inputs.capture(), images.capture(),
        anyDouble(), anyInt(), any(Duration.class));
    assertEquals(frameUrls, images.getAllValues().get(0));
    assertEquals(productImages, images.getAllValues().get(1));
    assertEquals(productImages, images.getAllValues().get(2));
    assertTrue(systems.getAllValues().get(0).contains("不要自由创作新镜头"));
    assertTrue(systems.getAllValues().get(1).contains("本次是参考视频反推"));
    assertTrue(systems.getAllValues().get(2).contains("只把原商品替换"));
    assertEquals(2, mapper.readTree(inputs.getAllValues().get(1)).path("referenceVideoAnalysis").path("shots").size());
    assertEquals("替换为白色窗帘", mapper.readTree(inputs.getAllValues().get(1)).path("source").path("brief").asText());
    assertThrows(ApiException.class, () -> service.validate(new ProductVideoDtos.PlanRequest("商品",
        productImages, 2, "9:16", null, null, "storyboard", null, false,
        new ProductVideoDtos.ReferenceVideo("https://assets.example/long.mp4", "long.mp4", 31,
            1080, 1920, "", frames))));
  }

  private ObjectNode outline(String... modes) {
    ObjectNode root = mapper.createObjectNode();
    root.put("analysis", "图中可见商品结构和面料；宣传功效尚未经验证。");
    root.put("concept", "从使用场景引入，展示可见细节，再回到整体外观形成完整认识。");
    var shots = root.putArray("shots");
    for (int i = 0; i < modes.length; i++) {
      var shot = shots.addObject();
      shot.put("title", "镜头" + (i + 1));
      shot.put("purpose", "本镜表达目的" + (i + 1));
      shot.put("evidence", "依据参考图可见外观，场景为创意安排");
      shot.put("scene", "柔和自然光的卧室");
      shot.put("startState", "商品摆放稳定，动作尚未开始");
      shot.put("action", "缓慢展示这一镜的关键细节");
      shot.put("endState", "停留在关键细节，商品保持原样");
      shot.put("transition", "以相同光向连接下一个整体镜头");
      shot.put("duration", 4);
      shot.putObject("people").put("mode", modes[i]).put("reason", "按本镜表达需要决定人物是否出现");
    }
    return root;
  }

  private ObjectNode details(String... modes) {
    var root = mapper.createObjectNode();
    var shots = root.putArray("shots");
    for (int i = 0; i < modes.length; i++) {
      shots.addObject().put("shotIndex", i + 1).put("peopleMode", modes[i])
          .put("imagePrompt", "主体、场景、构图、光线和起始状态：" + modes[i])
          .put("motion", "从首帧起始状态连续完成动作，再稳定停留。")
          .put("caption", "商品展示");
    }
    return root;
  }

  private ObjectNode referenceAnalysis(int count) {
    var root = mapper.createObjectNode();
    root.put("summary", "参考视频按时间依次展示人物拉动窗帘，再以商品整体画面收尾。");
    root.put("sound", "声音连续，在动作发生处有强度峰值；未提供口播转写。");
    var shots = root.putArray("shots");
    for (int index = 0; index < count; index++) {
      double start = index * 12.0 / count;
      double end = (index + 1) * 12.0 / count;
      shots.addObject()
          .put("sourceIndex", index + 1).put("sourceStart", start).put("sourceEnd", end)
          .put("sourceEvidence", "依据第" + start + "秒附近关键帧")
          .put("scene", "自然光卧室窗边")
          .put("composition", "中景平视，窗帘位于画面中央")
          .put("people", index == 0 ? "人物站在窗边，手部接触帘布" : "无人物")
          .put("product", "原窗帘自然垂落")
          .put("startState", "帘布静止，动作尚未开始")
          .put("action", "帘布由右向左连续移动")
          .put("endState", "帘布移动完成后自然垂落")
          .put("cameraMotion", "摄影机固定，画面内部运动")
          .put("materialMotion", "褶皱依次压缩并在停止后小幅回摆")
          .put("lightMotion", "窗外入光随遮挡范围逐步减弱")
          .put("transition", index == count - 1 ? "自然结束" : "动作匹配切入下一镜")
          .put("sound", "动作位置有短促声音峰值，其余声音平稳");
    }
    return root;
  }

  private ObjectNode wholeOutline() {
    var root = outline("hands");
    var shot = (ObjectNode) root.path("shots").get(0);
    shot.put("duration", 15);
    var timeline = shot.putArray("timeline");
    timeline.addObject().put("start", 0).put("end", 4).put("action", "开场展示窗边环境").put("camera", "中景缓慢推进").put("transition", "切到面料细节");
    timeline.addObject().put("start", 4).put("end", 11).put("action", "手部展示面料触感并拉合窗帘").put("camera", "近景跟随手部").put("transition", "切回整体空间");
    timeline.addObject().put("start", 11).put("end", 15).put("action", "完整空间收尾").put("camera", "稳定全景").put("transition", "自然结束");
    return root;
  }

  private ObjectNode wholeDetails() {
    var root = details("hands");
    var shot = (ObjectNode) root.path("shots").get(0);
    shot.remove("motion");
    shot.put("continuity", "同一窗帘、手部、服装与房间，按策划切换景别，不更换商品。");
    var segments = shot.putArray("segments");
    for (int i = 1; i <= 3; i++) segments.addObject().put("segmentIndex", i).put("description", "第" + i + "阶段的动作、机位、结束状态与自然衔接。");
    return root;
  }

  private ObjectNode countedOutline(int seconds, int count) {
    var result = wholeOutline();
    var shot = (ObjectNode) result.path("shots").get(0);
    shot.put("duration", seconds);
    var timeline = shot.putArray("timeline");
    for (int i = 0; i < count; i++) timeline.addObject().put("start", i * seconds / count)
        .put("end", (i + 1) * seconds / count).put("action", "第" + (i + 1) + "镜的具体动作")
        .put("camera", "具体机位和运镜").put("transition", "自然衔接");
    return result;
  }

  private ObjectNode countedDetails(int count) {
    var result = wholeDetails();
    var shot = (ObjectNode) result.path("shots").get(0);
    var segments = shot.putArray("segments");
    for (int i = 0; i < count; i++) segments.addObject().put("segmentIndex", i + 1)
        .put("description", "具体动作和机位的执行描述，保持同一商品与场景。".repeat(6));
    return result;
  }

  private ObjectNode textRepair(String path, String text) {
    var result = mapper.createObjectNode();
    result.putArray("replacements").addObject().put("path", path).put("text", text);
    return result;
  }

  @Test void gemRepairs187CharacterActionsOnceWithoutChangingTheWholeVideoOrOtherFields() throws Exception {
    var gem = mock(GemAgentClient.class);
    var selected = new ProductVideoPlanService(client, mapper, 180, gem);
    for (int seconds : new int[]{15, 30}) {
      reset(gem);
      when(gem.isConfigured()).thenReturn(true);
      var draft = countedOutline(seconds, 1);
      ((ObjectNode) draft.at("/shots/0/timeline/0")).put("action", "动".repeat(187));
      String shortened = "先展示帘头上沿漏光，再向右缓慢移动，保持原有颜色与结构，最后停在遮挡位置。";
      var expected = draft.deepCopy();
      ((ObjectNode) expected.at("/shots/0/timeline/0")).put("action", shortened);
      var patch = textRepair("/shots/0/timeline/0/action", shortened);
      patch.put("duration", 999); // Extra model output must never replace the real timeline.
      when(gem.complete(anyString(), anyString(), anyList(), anyDouble(), eq(true), anyInt(), any(Duration.class)))
          .thenReturn(new AiChatDtos.CompletionResult("lk888", GemAgentClient.MODEL, draft.toString()),
              new AiChatDtos.CompletionResult("lk888", GemAgentClient.MODEL, patch.toString()),
              new AiChatDtos.CompletionResult("lk888", GemAgentClient.MODEL, countedDetails(1).toString()));
      String mode = seconds == 30 ? "single_video_30" : "single_video";
      var images = List.of("https://assets.example/product.jpg");
      var request = new ProductVideoDtos.PlanRequest("帘头遮挡上方漏光", images, 1, "9:16", null, null,
          mode, 1, true, null, GemAgentClient.MODEL);
      var result = selected.plan(request);
      assertEquals(shortened, result.shots().get(0).timeline().get(0).action());
      assertEquals(seconds, result.shots().get(0).duration());
      var systems = ArgumentCaptor.forClass(String.class);
      var inputs = ArgumentCaptor.forClass(String.class);
      @SuppressWarnings("unchecked") var refs = (ArgumentCaptor<List<String>>) (ArgumentCaptor<?>) ArgumentCaptor.forClass(List.class);
      verify(gem, times(3)).complete(systems.capture(), inputs.capture(), refs.capture(), anyDouble(), eq(true), anyInt(), any(Duration.class));
      assertTrue(systems.getAllValues().get(0).contains("action 最多180字"));
      assertTrue(systems.getAllValues().get(1).contains("只精简"));
      var repairInput = mapper.readTree(inputs.getAllValues().get(1));
      assertEquals(draft, repairInput.path("outline"));
      assertEquals(1, repairInput.path("fields").size());
      assertEquals(180, repairInput.at("/fields/0/maxLength").asInt());
      assertEquals(expected, mapper.readTree(inputs.getAllValues().get(2)).path("outline"));
      assertEquals(List.of(images, List.of(), images), refs.getAllValues());
    }
    verifyNoInteractions(client);
  }

  @Test void allOverlongOutlineFieldsAreRepairedTogetherAndTheResultIsCheckpointed() throws Exception {
    var draft = countedOutline(15, 1);
    draft.put("analysis", "析".repeat(2001));
    ((ObjectNode) draft.at("/shots/0")).put("action", "动".repeat(301));
    ((ObjectNode) draft.at("/shots/0/people")).put("reason", "人".repeat(201));
    ((ObjectNode) draft.at("/shots/0/timeline/0")).put("action", "动".repeat(187))
        .put("camera", "机".repeat(141)).put("transition", "接".repeat(121));
    var patches = mapper.createObjectNode();
    var replacements = patches.putArray("replacements");
    var expected = draft.deepCopy();
    var paths = List.of("/analysis", "/shots/0/action", "/shots/0/people/reason", "/shots/0/timeline/0/action",
        "/shots/0/timeline/0/camera", "/shots/0/timeline/0/transition");
    for (String path : paths) {
      replacements.addObject().put("path", path).put("text", "保留关键动作、方向和结束状态");
      int split = path.lastIndexOf('/');
      ((ObjectNode) expected.at(path.substring(0, split))).put(path.substring(split + 1), "保留关键动作、方向和结束状态");
    }
    replies(draft, patches, countedDetails(1));
    var responses = new java.util.HashMap<String, String>();
    var stages = new java.util.ArrayList<String>();
    var progress = new ProductVideoPlanService.ProgressListener() {
      public void save(String stage, JsonNode outline, List<ProductVideoDtos.ShotPlan> shots, String provider) { stages.add(stage); }
      public void response(String stage, String content) { responses.put(stage, content); }
    };
    var request = new ProductVideoDtos.PlanRequest("窗帘", List.of(), 1, "3:4", null, null, "single_video", 1);
    assertEquals(1, service.plan(request, null, List.of(), progress).shots().size());
    assertEquals(draft.toString(), responses.get("outline-before-length-repair"));
    assertEquals(expected, mapper.readTree(responses.get("outline")));
    assertTrue(stages.contains("正在精简超长策划描述"));
    var inputs = ArgumentCaptor.forClass(String.class);
    verify(client, times(3)).completeVision(anyString(), inputs.capture(), anyList(), anyDouble(), anyInt(), any(Duration.class));
    assertEquals(paths.size(), mapper.readTree(inputs.getAllValues().get(1)).path("fields").size());
  }

  @Test void continuingAnOldLengthFailureRepairsItsSavedDraftWithoutPlanningAgain() throws Exception {
    var draft = countedOutline(15, 1);
    ((ObjectNode) draft.at("/shots/0/timeline/0")).put("action", "动".repeat(187));
    replies(textRepair("/shots/0/timeline/0/action", "展示帘头并保持原结构"), countedDetails(1));
    var responses = new java.util.HashMap<String, String>();
    responses.put("outline", draft.toString());
    var progress = new ProductVideoPlanService.ProgressListener() {
      public void save(String stage, JsonNode outline, List<ProductVideoDtos.ShotPlan> shots, String provider) {}
      public String previousResponse(String stage) { return responses.get(stage); }
      public void response(String stage, String content) { responses.put(stage, content); }
    };
    var request = new ProductVideoDtos.PlanRequest("窗帘", List.of(), 1, "3:4", null, null, "single_video", 1);
    assertEquals(1, service.plan(request, null, List.of(), progress).shots().size());
    var inputs = ArgumentCaptor.forClass(String.class);
    verify(client, times(2)).completeVision(anyString(), inputs.capture(), anyList(), anyDouble(), anyInt(), any(Duration.class));
    assertTrue(mapper.readTree(inputs.getAllValues().get(0)).has("fields"));
    assertEquals(draft.toString(), responses.get("outline-before-length-repair"));
  }

  @Test void badRepairsStopAfterOneAttemptWithoutLosingOrTruncatingTheOriginalDraft() throws Exception {
    var draft = countedOutline(15, 1);
    ((ObjectNode) draft.at("/shots/0/timeline/0")).put("action", "动".repeat(187));
    String path = "/shots/0/timeline/0/action";
    var duplicate = textRepair(path, "动作");
    ((com.fasterxml.jackson.databind.node.ArrayNode) duplicate.path("replacements")).addObject().put("path", path).put("text", "动作");
    for (JsonNode patch : List.of(textRepair(path, "动".repeat(181)), textRepair(path, " "),
        textRepair("/shots/0/title", "不允许修改标题"), mapper.readTree("{\"replacements\":[]}"), duplicate,
        mapper.readTree("{\"replacements\":[{\"path\":\"" + path + "\",\"text\":42}]}"))) {
      reset(client);
      replies(draft, patch);
      var responses = new java.util.HashMap<String, String>();
      var saved = new java.util.ArrayList<JsonNode>();
      var progress = new ProductVideoPlanService.ProgressListener() {
        public void save(String stage, JsonNode outline, List<ProductVideoDtos.ShotPlan> shots, String provider) {
          if (outline != null) saved.add(outline);
          assertTrue(shots.isEmpty());
        }
        public void response(String stage, String content) { responses.put(stage, content); }
      };
      var request = new ProductVideoDtos.PlanRequest("窗帘", List.of(), 1, "3:4", null, null, "single_video", 1);
      assertThrows(ApiException.class, () -> service.plan(request, null, List.of(), progress));
      assertEquals(draft.toString(), responses.get("outline"));
      assertTrue(saved.isEmpty());
      verify(client, times(2)).completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class));
    }
  }

  @Test void shortenedTextCannotBypassInvalidTimelineAndRepairTimeoutDoesNotStartAnotherAttempt() throws Exception {
    var draft = countedOutline(15, 2);
    ((ObjectNode) draft.at("/shots/0/timeline/0")).put("action", "动".repeat(187));
    ((ObjectNode) draft.at("/shots/0/timeline/1")).put("start", 0);
    replies(draft, textRepair("/shots/0/timeline/0/action", "展示原商品"));
    var request = new ProductVideoDtos.PlanRequest("窗帘", List.of(), 1, "3:4", null, null, "single_video", 2);
    assertTrue(assertThrows(ApiException.class, () -> service.plan(request)).getMessage().contains("不能重叠"));
    verify(client, times(2)).completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class));
    reset(client);
    when(client.isConfigured()).thenReturn(true);
    when(client.completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class)))
        .thenReturn(new AiChatDtos.CompletionResult("mock", "test", draft.toString()))
        .thenThrow(new HttpTimeoutException("test timeout"));
    assertEquals(504, assertThrows(ApiException.class, () -> service.plan(request)).getCode());
    verify(client, times(2)).completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class));
  }

  @Test void selectedInternalCountControlsBothStagesAndFitsThePromptBudget() throws Exception {
    for (int seconds : new int[]{15, 30}) for (int count : new int[]{1, 4, 8}) {
      clearInvocations(client);
      replies(countedOutline(seconds, count), countedDetails(count));
      String mode = seconds == 30 ? "single_video_30" : "single_video";
      var request = new ProductVideoDtos.PlanRequest("窗帘", List.of(), 1, "16:9", null, null, mode, count);
      var result = service.plan(request);
      assertEquals(1, result.shots().size());
      var shot = result.shots().get(0);
      assertEquals(count, shot.timeline().size());
      assertEquals(seconds, shot.duration());
      assertEquals(seconds, shot.timeline().get(count - 1).end());
      assertTrue(shot.motion().length() <= 1800);
      assertDoesNotThrow(() -> service.validate(new ProductVideoDtos.PlanRequest("窗帘", List.of(), 1, "16:9", shot, null, mode, count)));
      var prompts = ArgumentCaptor.forClass(String.class);
      var inputs = ArgumentCaptor.forClass(String.class);
      verify(client, times(2)).completeVision(prompts.capture(), inputs.capture(), anyList(), anyDouble(), anyInt(), any(Duration.class));
      assertTrue(prompts.getAllValues().get(0).contains("恰好 " + count + " 个分镜"));
      assertTrue(prompts.getAllValues().get(1).contains("本次恰好 " + count + " 段"));
      assertEquals(count, mapper.readTree(inputs.getAllValues().get(0)).path("timelineCount").asInt());
      assertEquals(count, mapper.readTree(inputs.getAllValues().get(1)).path("source").path("timelineCount").asInt());
    }
  }

  @Test void rejectsWrongCountsAndInvalidRangesBeforeExpandingAndResumesTheSelectedCount() throws Exception {
    for (int invalid : new int[]{0, -1, 9}) assertThrows(ApiException.class, () -> service.validate(
        new ProductVideoDtos.PlanRequest("窗帘", List.of(), 1, "16:9", null, null, "single_video", invalid)));
    assertThrows(ApiException.class, () -> service.validate(
        new ProductVideoDtos.PlanRequest("窗帘", List.of(), 4, "16:9", null, null, "storyboard", 4)));
    replies(countedOutline(15, 3), countedDetails(3));
    var request = new ProductVideoDtos.PlanRequest("窗帘", List.of(), 1, "16:9", null, null, "single_video", 4);
    var error = assertThrows(ApiException.class, () -> service.plan(request));
    assertTrue(error.getMessage().contains("需要 4 个分镜"));
    verify(client, times(1)).completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class));
    clearInvocations(client);
    when(client.completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class)))
        .thenReturn(new AiChatDtos.CompletionResult("mock", "test", countedDetails(4).toString()));
    var resumed = service.plan(request, countedOutline(15, 4), List.of(), (stage, outline, shots, provider) -> {});
    assertEquals(4, resumed.shots().get(0).timeline().size());
    verify(client, times(1)).completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class));
    verify(client).completeVision(contains("商品外观一致性"), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class));
    clearInvocations(client);
    assertThrows(ApiException.class, () -> service.plan(request, countedOutline(15, 3), List.of(), (stage, outline, shots, provider) -> {}));
    verify(client, never()).completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class));
  }

  @Test void eightShotDescriptionsShareTheTotalBudgetWithoutLosingAnyContent() throws Exception {
    for (int seconds : new int[]{15, 30}) {
      var outline = countedOutline(seconds, 8);
      var details = countedDetails(8);
      var shot = (ObjectNode) details.path("shots").get(0);
      int[] lengths = {173, 171, 168, 170, 160, 172, 164, 172};
      for (int i = 0; i < lengths.length; i++)
        ((ObjectNode) shot.path("segments").get(i)).put("description", "镜".repeat(lengths[i]));
      shot.put("continuity", "同".repeat(163));
      var result = service.parseDetails(details.toString(), outline, outline, 0, true, seconds).get(0);
      StringBuilder expected = new StringBuilder();
      for (int i = 0; i < lengths.length; i++) expected.append(i * seconds / 8).append("-")
          .append((i + 1) * seconds / 8).append(" 秒：").append("镜".repeat(lengths[i])).append("\n");
      expected.append("全片连续性：").append("同".repeat(163));
      assertEquals(expected.toString(), result.motion());
      assertTrue(result.motion().length() <= 1800);
      assertEquals(8, result.timeline().size());
      if (seconds == 30) assertEquals(1586, result.motion().length());

      var first = (ObjectNode) shot.path("segments").get(0);
      first.put("description", first.path("description").asText() + "字".repeat(1800 - result.motion().length()));
      assertEquals(1800, service.parseDetails(details.toString(), outline, outline, 0, true, seconds).get(0).motion().length());
      first.put("description", first.path("description").asText() + "字");
      var error = assertThrows(ApiException.class, () -> service.parseDetails(details.toString(), outline, outline, 0, true, seconds));
      assertTrue(error.getMessage().contains("1801 字，上限 1800 字"));
      assertFalse(error.getMessage().contains("缺少"));
      first.remove("description");
      assertTrue(assertThrows(ApiException.class, () -> service.parseDetails(details.toString(), outline, outline, 0, true, seconds))
          .getMessage().contains("缺少有效的第 1 镜执行描述"));
    }
  }

  @Test void retryRecoversValidatedStoredDetailsWithoutRequestingTheModel() throws Exception {
    when(client.isConfigured()).thenReturn(true);
    var outline = countedOutline(30, 8);
    var details = countedDetails(8);
    ((ObjectNode) details.path("shots").get(0).path("segments").get(0)).put("description", "完整画面与同步声音。".repeat(20));
    var saved = new java.util.concurrent.atomic.AtomicReference<List<ProductVideoDtos.ShotPlan>>(List.of());
    var request = new ProductVideoDtos.PlanRequest("白色纱帘", List.of(), 1, "3:4", null, null, "single_video_30", 8, true);
    var result = service.plan(request, outline, List.of(), new ProductVideoPlanService.ProgressListener() {
      public void save(String stage, JsonNode planned, List<ProductVideoDtos.ShotPlan> shots, String provider) { saved.set(shots); }
      public String previousResponse(String stage) { return "details-0".equals(stage) ? details.toString() : null; }
      public void response(String stage, String content) { fail("Recovery must not create a new model response"); }
    });
    assertEquals(8, result.shots().get(0).timeline().size());
    assertEquals(result.shots(), saved.get());
    assertTrue(result.shots().get(0).motion().contains("完整画面与同步声音。".repeat(20)));
    verify(client, never()).completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class));
  }

  @Test void retryDoesNotAcceptIncompleteOrMismatchedStoredDetails() throws Exception {
    when(client.isConfigured()).thenReturn(true);
    var outline = countedOutline(30, 8);
    var details = countedDetails(8);
    var incomplete = details.deepCopy();
    ((ObjectNode) incomplete.path("shots").get(0).path("segments").get(7)).remove("description");
    var mismatch = details.deepCopy();
    ((ObjectNode) mismatch.path("shots").get(0)).put("peopleMode", "person");
    var overlong = details.deepCopy();
    ((ObjectNode) overlong.path("shots").get(0).path("segments").get(0)).put("description", "字".repeat(1800));
    for (String cached : List.of("{", incomplete.toString(), mismatch.toString(), overlong.toString())) {
      clearInvocations(client);
      when(client.completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class)))
          .thenReturn(new AiChatDtos.CompletionResult("mock", "test", details.toString()));
      var result = service.plan(new ProductVideoDtos.PlanRequest("商品", List.of(), 1, "3:4", null, null, "single_video_30", 8),
          outline, List.of(), new ProductVideoPlanService.ProgressListener() {
            public void save(String stage, JsonNode planned, List<ProductVideoDtos.ShotPlan> shots, String provider) {}
            public String previousResponse(String stage) { return cached; }
          });
      assertEquals(8, result.shots().get(0).timeline().size());
      verify(client, times(1)).completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class));
    }
  }

  @Test void wholeVideoPlansAllFifteenSecondsAsOneGenerationUnit() throws Exception {
    replies(wholeOutline(), wholeDetails());
    var images = List.of("https://assets.example/product.png");
    var request = new ProductVideoDtos.PlanRequest("遮光窗帘", images, 1, "3:4", null, null, "single_video");
    var result = service.plan(request);
    assertEquals(1, result.shots().size());
    var shot = result.shots().get(0);
    assertEquals("single_video", shot.productionMode());
    assertEquals(15, shot.duration());
    assertEquals(3, shot.timeline().size());
    assertTrue(shot.motion().startsWith("0-4 秒："));
    assertTrue(shot.motion().contains("\n4-11 秒："));
    assertTrue(shot.motion().contains("\n11-15 秒："));
    assertTrue(shot.motion().contains("全片连续性："));
    var systems = ArgumentCaptor.forClass(String.class);
    var inputs = ArgumentCaptor.forClass(String.class);
    verify(client, times(2)).completeVision(systems.capture(), inputs.capture(), eq(images), anyDouble(), anyInt(), any(Duration.class));
    assertTrue(systems.getAllValues().get(0).contains("不强制一镜到底"));
    assertFalse(systems.getAllValues().get(0).contains("单镜建议使用时长 2 至 8 秒"));
    assertTrue(systems.getAllValues().get(1).contains("视频模型只调用一次"));
    assertTrue(systems.getAllValues().get(1).contains("画面起点；动作过程；构图运镜；光线质感；结束与衔接"));
    assertTrue(systems.getAllValues().get(1).contains("不能把其他时段锁在首帧构图里"));
    assertFalse(systems.getAllValues().get(1).contains("一个镜头只安排一个核心动作"));
    assertEquals("single_video", mapper.readTree(inputs.getAllValues().get(0)).path("productionMode").asText());
    assertEquals("single_video", mapper.readTree(inputs.getAllValues().get(1)).path("source").path("productionMode").asText());
  }

  @Test void wholeVideoRequiresACompleteContinuousTimelineAndEveryExpandedSegment() throws Exception {
    var planned = service.parseOutline(wholeOutline().toString(), 1, true);
    for (double start : new double[]{3, 5, -1}) {
      var broken = wholeOutline();
      ((ObjectNode) broken.path("shots").get(0).path("timeline").get(1)).put("start", start);
      assertThrows(ApiException.class, () -> service.parseOutline(broken.toString(), 1, true));
    }
    var shortTimeline = wholeOutline();
    ((ObjectNode) shortTimeline.path("shots").get(0).path("timeline").get(2)).put("end", 14);
    assertThrows(ApiException.class, () -> service.parseOutline(shortTimeline.toString(), 1, true));
    assertThrows(ApiException.class, () -> service.parseOutline(outline("hands").toString(), 1, true));
    assertThrows(ApiException.class, () -> service.parseDetails(details("hands").toString(), planned, planned, 0, true));
    var wrong = wholeDetails();
    ((ObjectNode) wrong.path("shots").get(0).path("segments").get(2)).put("segmentIndex", 1);
    assertThrows(ApiException.class, () -> service.parseDetails(wrong.toString(), planned, planned, 0, true));
    assertThrows(ApiException.class, () -> service.validate(new ProductVideoDtos.PlanRequest("商品", List.of(), 4, "16:9", null, null, "single_video")));
    assertThrows(ApiException.class, () -> service.validate(new ProductVideoDtos.PlanRequest("商品", List.of(), 1, "16:9", null, null, "unknown")));
  }

  @Test void wholeVideoTimeLabelsAreAddedOnceAndConflictingModelTimingsAreRejected() throws Exception {
    var outline = service.parseOutline(wholeOutline().toString(), 1, true);
    var details = wholeDetails();
    var segment = (ObjectNode) details.path("shots").get(0).path("segments").get(0);
    segment.put("description", "0-4秒，0.0至4.0秒：画面从窗边中景开始，沿手部缓慢推近，帘布保持自然垂坠。");
    String motion = service.parseDetails(details.toString(), outline, outline, 0, true).get(0).motion();
    assertTrue(motion.startsWith("0-4 秒：画面从窗边中景开始"));
    var beat = new ProductVideoDtos.TimelineBeat(0, 4, "", "", "");
    assertEquals("约第2秒手部入画。", ProductVideoPlanService.segmentDescription("约第2秒手部入画。", beat));
    assertThrows(ApiException.class, () -> ProductVideoPlanService.segmentDescription("0-5秒，推进。", beat));
    assertThrows(ApiException.class, () -> ProductVideoPlanService.segmentDescription("0-4秒：", beat));
  }

  @Test void thirtySecondPlanHasItsOwnModeAndCannotBeConfusedWithFifteenSeconds() throws Exception {
    var planned = wholeOutline();
    var shot = (ObjectNode) planned.path("shots").get(0);
    shot.put("duration", 30);
    ((ObjectNode) shot.path("timeline").get(2)).put("end", 30);
    replies(planned, wholeDetails());
    var request = new ProductVideoDtos.PlanRequest("窗帘", List.of(), 1, "16:9", null, null, "single_video_30");
    var result = service.plan(request).shots().get(0);
    assertEquals(30, result.duration());
    assertEquals("single_video_30", result.productionMode());
    assertTrue(result.motion().contains("11-30 秒："));
    assertThrows(ApiException.class, () -> service.parseOutline(planned.toString(), 1, true));
    assertThrows(ApiException.class, () -> service.parseOutline(wholeOutline().toString(), 1, true, 30));
    assertDoesNotThrow(() -> service.validate(new ProductVideoDtos.PlanRequest("窗帘", List.of(), 1, "16:9", result, null, "single_video_30")));
    var systems = ArgumentCaptor.forClass(String.class);
    verify(client, times(2)).completeVision(systems.capture(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class));
    assertTrue(systems.getAllValues().get(0).contains("30 秒视频"));
    assertTrue(systems.getAllValues().get(1).contains("完整 30 秒视频"));
    assertFalse(systems.getAllValues().get(0).contains("15 秒"));
  }

  @Test void wholeVideoResumeSkipsSavedAnalysisAndRefinementKeepsMode() throws Exception {
    var saved = wholeOutline();
    when(client.isConfigured()).thenReturn(true);
    when(client.completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class)))
        .thenReturn(new AiChatDtos.CompletionResult("mock", "test", wholeDetails().toString()));
    var result = service.plan(new ProductVideoDtos.PlanRequest("窗帘", List.of(), 1, "16:9", null, null, "single_video"),
        saved, List.of(), (stage, outline, shots, provider) -> {});
    assertEquals(15, result.shots().get(0).duration());
    verify(client, times(1)).completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class));
    var refinement = new ProductVideoDtos.PlanRequest("窗帘", List.of(), 1, "16:9", result.shots().get(0), null, "single_video");
    assertDoesNotThrow(() -> service.validate(refinement));
  }

  private void replies(JsonNode outline, JsonNode... batches) throws Exception {
    when(client.isConfigured()).thenReturn(true);
    var stub = when(client.completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class)))
        .thenReturn(new AiChatDtos.CompletionResult("mock", "test", outline.toString()));
    for (var batch : batches) stub = stub.thenReturn(new AiChatDtos.CompletionResult("mock", "test", batch.toString()));
  }

  @Test void plansStoryBeforePromptsAndAllowsMixedPeopleNeeds() throws Exception {
    replies(outline("person", "hands", "none"), details("person", "hands"), details("none"));
    var images = List.of("https://assets.example/product.png");
    var result = service.plan(new ProductVideoDtos.PlanRequest("儿童床垫", images, 3, "3:4", null, null));
    assertEquals(3, result.shots().size());
    assertEquals("本镜表达目的3", result.shots().get(2).purpose());
    assertTrue(result.shots().get(2).imagePrompt().endsWith("none"));
    assertTrue(result.shots().get(2).design().contains("衔接："));
    assertTrue(result.summary().analysis().contains("尚未经验证"));
    var systems = ArgumentCaptor.forClass(String.class);
    var inputs = ArgumentCaptor.forClass(String.class);
    verify(client, times(3)).completeVision(systems.capture(), inputs.capture(), eq(images), eq(0.35), anyInt(), eq(Duration.ofSeconds(180)));
    assertTrue(systems.getAllValues().get(0).contains("人物是否出现由该镜头的表达需要决定"));
    assertFalse(systems.getAllValues().get(0).contains("每个分镜首帧都必须有成年模特"));
    var second = mapper.readTree(inputs.getAllValues().get(1));
    assertEquals("本镜表达目的3", second.path("story").path("shots").get(2).path("purpose").asText());
    assertEquals(2, second.path("outline").path("shots").size());
    assertEquals(2, second.path("source").path("count").asInt());
    assertEquals(0, second.path("completedShots").size());
    var third = mapper.readTree(inputs.getAllValues().get(2));
    assertEquals(1, third.path("outline").path("shots").size());
    assertEquals(1, third.path("source").path("count").asInt());
    assertEquals("本镜表达目的3", third.path("outline").path("shots").get(0).path("purpose").asText());
    assertEquals(3, third.path("startShotNumber").asInt());
    assertEquals(2, third.path("completedShots").size());
    assertEquals(result.shots().get(0).imagePrompt(), third.path("completedShots").get(0).path("imagePrompt").asText());
    assertEquals(0, second.path("source").path("images").size());
  }

  @Test void ignoresLegacyCastingAndCanPlanEntirelyProductOnly() throws Exception {
    replies(outline("none"), details("none"));
    var request = mapper.readValue("{\"brief\":\"商品\",\"count\":1,\"ratio\":\"16:9\",\"talentMode\":\"person\"}", ProductVideoDtos.PlanRequest.class);
    var result = service.plan(request);
    assertTrue(result.shots().get(0).imagePrompt().endsWith("none"));
    var inputs = ArgumentCaptor.forClass(String.class);
    verify(client, times(2)).completeVision(anyString(), inputs.capture(), anyList(), anyDouble(), anyInt(), any(Duration.class));
    assertTrue(inputs.getAllValues().stream().noneMatch(value -> value.contains("talentMode")));
  }

  @Test void refinementUsesCurrentAndSurroundingShotIntent() throws Exception {
    replies(outline("none"), details("none"));
    var current = new ProductVideoDtos.ShotPlan("材质", "原首帧", "原动作", "", 4, "展示织纹", "光线扫过织纹");
    var context = List.of(new ProductVideoDtos.ShotContext("使用场景", "建立使用关系", "人物躺下", "先场景再材质"));
    service.plan(new ProductVideoDtos.PlanRequest("床垫", List.of(), 1, "16:9", current, context));
    var inputs = ArgumentCaptor.forClass(String.class);
    verify(client, times(2)).completeVision(anyString(), inputs.capture(), anyList(), anyDouble(), anyInt(), any(Duration.class));
    var source = mapper.readTree(inputs.getAllValues().get(0));
    assertEquals("展示织纹", source.path("currentShot").path("purpose").asText());
    assertEquals("建立使用关系", source.path("contextShots").get(0).path("purpose").asText());
  }

  @Test void incompleteOrRepeatedOutlinesDoNotProceedToPromptGeneration() throws Exception {
    var incomplete = outline("none");
    ((ObjectNode) incomplete.path("shots").get(0)).remove("action");
    replies(incomplete, details("none"));
    assertThrows(ApiException.class, () -> service.plan(new ProductVideoDtos.PlanRequest("商品", List.of(), 1, "16:9", null, null)));
    verify(client, times(1)).completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class));
    var repeated = outline("none", "none");
    ((ObjectNode) repeated.path("shots").get(1)).put("purpose", "本镜表达目的1");
    assertThrows(ApiException.class, () -> service.parseOutline(repeated.toString(), 2));
  }

  @Test void rejectsChangedCastingOrderOrMissingPromptsDuringExpansion() throws Exception {
    var planned = service.parseOutline(outline("none").toString(), 1);
    assertThrows(ApiException.class, () -> service.parseDetails(details("person").toString(), planned));
    var wrongOrder = details("none");
    ((ObjectNode) wrongOrder.path("shots").get(0)).put("shotIndex", 2);
    assertThrows(ApiException.class, () -> service.parseDetails(wrongOrder.toString(), planned));
    var empty = details("none");
    ((ObjectNode) empty.path("shots").get(0)).remove("motion");
    assertThrows(ApiException.class, () -> service.parseDetails(empty.toString(), planned));
    assertThrows(ApiException.class, () -> service.parseDetails(details("none", "none").toString(), planned));
  }

  @Test void handlesFencedJsonAndValidatesDurationAndCount() throws Exception {
    var planned = service.parseOutline("```json\n" + outline("hands") + "\n```", 1);
    assertEquals(4, service.parseDetails(details("hands").toString(), planned).get(0).duration());
    assertThrows(ApiException.class, () -> service.parseOutline(outline("none").toString(), 2));
    var invalid = outline("none");
    ((ObjectNode) invalid.path("shots").get(0)).put("duration", 30);
    assertThrows(ApiException.class, () -> service.parseOutline(invalid.toString(), 1));
  }

  @Test void requiresValidInputsAndProviderWithoutFakeFallback() throws Exception {
    assertThrows(ApiException.class, () -> service.plan(new ProductVideoDtos.PlanRequest("", List.of(), 4, "16:9", null, null)));
    assertThrows(ApiException.class, () -> service.plan(new ProductVideoDtos.PlanRequest("商品", List.of(), 9, "16:9", null, null)));
    assertThrows(ApiException.class, () -> service.plan(new ProductVideoDtos.PlanRequest("商品", List.of(), 1, "16:9", null, null)));
    verify(client, never()).completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class));
  }

  @Test void outlineTimeoutNamesStageAndDoesNotRetry() throws Exception {
    when(client.isConfigured()).thenReturn(true);
    when(client.completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class)))
        .thenThrow(new HttpTimeoutException("request timed out"));
    var error = assertThrows(ApiException.class, () -> service.plan(
        new ProductVideoDtos.PlanRequest("商品", List.of(), 4, "16:9", null, null)));
    assertEquals(504, error.getCode());
    assertTrue(error.getMessage().contains("商品识图与整片策划"));
    assertFalse(error.getMessage().contains("request timed out"));
    verify(client, times(1)).completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class));
  }

  @Test void laterBatchTimeoutReturnsNoPartialPlanAndDoesNotRetry() throws Exception {
    when(client.isConfigured()).thenReturn(true);
    when(client.completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class)))
        .thenReturn(new AiChatDtos.CompletionResult("mock", "test", outline("none", "hands", "person", "none").toString()))
        .thenReturn(new AiChatDtos.CompletionResult("mock", "test", details("none", "hands").toString()))
        .thenThrow(new HttpTimeoutException("request timed out"));
    var request = new ProductVideoDtos.PlanRequest("商品", List.of(), 4, "16:9", null, null);
    var before = mapper.writeValueAsString(request);
    var error = assertThrows(ApiException.class, () -> service.plan(request));
    assertEquals(504, error.getCode());
    assertTrue(error.getMessage().contains("镜头 3-4 提示词展开"));
    assertTrue(error.getMessage().contains("180 秒"));
    assertEquals(before, mapper.writeValueAsString(request));
    verify(client, times(3)).completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class));
  }

  @Test void eightShotsUseFourSmallBatchesWithFullStoryContext() throws Exception {
    replies(outline("none", "none", "none", "none", "none", "none", "none", "none"),
        details("none", "none"), details("none", "none"), details("none", "none"), details("none", "none"));
    var result = service.plan(new ProductVideoDtos.PlanRequest("商品", List.of(), 8, "16:9", null, null));
    assertEquals(8, result.shots().size());
    assertEquals("本镜表达目的8", result.shots().get(7).purpose());
    var inputs = ArgumentCaptor.forClass(String.class);
    verify(client, times(5)).completeVision(anyString(), inputs.capture(), anyList(), anyDouble(), anyInt(), eq(Duration.ofSeconds(180)));
    for (int i = 1; i < 5; i++) {
      var input = mapper.readTree(inputs.getAllValues().get(i));
      assertEquals(2, input.path("outline").path("shots").size());
      assertEquals(8, input.path("story").path("shots").size());
      assertEquals((i - 1) * 2 + 1, input.path("startShotNumber").asInt());
    }
  }

  @Test void planningTimeoutIsBoundedIndependentlyOfNormalAgent() {
    assertEquals(30, new ProductVideoPlanService(client, mapper, 1).stageTimeoutSeconds());
    assertEquals(300, new ProductVideoPlanService(client, mapper, 900).stageTimeoutSeconds());
    assertEquals(180, service.stageTimeoutSeconds());
  }

  @Test void checkpointsSurviveLaterTimeoutAndResumeOnlyRemainingShots() throws Exception {
    var full = outline("none", "hands", "person", "none");
    when(client.isConfigured()).thenReturn(true);
    when(client.completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class)))
        .thenReturn(new AiChatDtos.CompletionResult("mock", "test", full.toString()))
        .thenReturn(new AiChatDtos.CompletionResult("mock", "test", details("none", "hands").toString()))
        .thenThrow(new HttpTimeoutException("request timed out"))
        .thenReturn(new AiChatDtos.CompletionResult("mock", "test", details("person", "none").toString()));
    var saved = new java.util.concurrent.atomic.AtomicReference<List<ProductVideoDtos.ShotPlan>>(List.of());
    var request = new ProductVideoDtos.PlanRequest("商品", List.of(), 4, "16:9", null, null);
    assertThrows(ApiException.class, () -> service.plan(request, null, List.of(),
        (stage, outline, shots, provider) -> saved.set(shots)));
    assertEquals(2, saved.get().size());
    var result = service.plan(request, full, saved.get(), (stage, outline, shots, provider) -> {});
    assertEquals(4, result.shots().size());
    assertEquals(saved.get().get(0), result.shots().get(0));
    verify(client, times(4)).completeVision(anyString(), anyString(), anyList(), anyDouble(), anyInt(), any(Duration.class));
  }

  @Test void acceptsWholeStoryOnlyWhenEveryShotPassesTheOriginalValidation() throws Exception {
    var story = outline("none", "hands", "person", "none");
    var batch = story.deepCopy();
    batch.putArray("shots").add(story.path("shots").get(2)).add(story.path("shots").get(3));
    var full = details("none", "hands", "person", "none");
    assertEquals("本镜表达目的3", service.parseDetails(full.toString(), batch, story, 2).get(0).purpose());
    assertEquals(2, service.parseDetails(full.toString(), batch, story, 2).size());
    assertThrows(ApiException.class, () -> service.parseDetails(details("person", "hands", "person", "none").toString(), batch, story, 2));
    assertThrows(ApiException.class, () -> service.parseDetails(details("person").toString(), batch, story, 2));
  }

  @Test void savesUnparseableProviderResponseBeforeRejectingIt() throws Exception {
    replies(outline("none", "none"), details("none"));
    var raw = new java.util.HashMap<String, String>();
    assertThrows(ApiException.class, () -> service.plan(new ProductVideoDtos.PlanRequest("商品", List.of(), 2, "16:9", null, null), null, List.of(),
        new ProductVideoPlanService.ProgressListener() {
          public void save(String stage, JsonNode outline, List<ProductVideoDtos.ShotPlan> shots, String provider) {}
          public void response(String stage, String content) { raw.put(stage, content); }
        }));
    assertEquals(1, mapper.readTree(raw.get("details-0")).path("shots").size());
    assertEquals(2, mapper.readTree(raw.get("outline")).path("shots").size());
  }
}
