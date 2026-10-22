package com.youmi.api.video;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.ai.AgentChatClient;
import com.youmi.api.ai.AiChatDtos;
import com.youmi.api.ai.GemAgentClient;
import com.youmi.api.common.ApiException;
import com.youmi.api.image.ModelApiKeyService;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ProductVideoProductAnalysisTest {
  @TempDir Path dir;
  private final ObjectMapper mapper = new ObjectMapper();
  private final AgentChatClient client = mock(AgentChatClient.class);
  private final ModelApiKeyService keys = mock(ModelApiKeyService.class);
  private final GemAgentClient gem = mock(GemAgentClient.class);
  private final ModelApiKeyService.ResolvedModelApiKey credential = new ModelApiKeyService.ResolvedModelApiKey(
      6, "gem-3-pro", "lk888", "http://127.0.0.1/v1beta", "/models/gem-3-pro:generateContent", "", "test-only", Map.of());
  private final ProductVideoDtos.PlanRequest request = new ProductVideoDtos.PlanRequest("根据主图完整读取参数",
      List.of("https://assets.example/main-original.png", "https://assets.example/details-original.jpg"),
      1, "3:4", null, null, "product_analysis", null, false, null, "gem-3-pro");
  private final String content = """
      {"productName":"棉麻窗帘","summary":"商品概述","sellingPoints":[
      {"title":"遮光","description":"卧室遮光休息","evidence":"详情页上的遮光说明","imageIndices":[2,2]}],
      "questions":["请核对隔音参数"]}
      """;
  private ProductVideoPlanService service(String response) throws Exception {
    when(keys.resolve("gem-3-pro", ModelApiKeyService.MODEL_TYPE_VISION_REASONING, "canvas-agent"))
        .thenReturn(java.util.Optional.of(credential));
    when(client.completeConfiguredModel(eq(credential), anyString(), anyString(), anyList(), anyDouble(),
        anyString(), anyString(), anyInt(), any(Duration.class)))
        .thenReturn(new AiChatDtos.CompletionResult("lk888", "gem-3-pro", response));
    return new ProductVideoPlanService(client, mapper, 300, gem, keys);
  }
  private ProductVideoPlanService.ProgressListener progress() {
    return (stage, outline, shots, provider) -> {};
  }
  private ProductVideoPlanJobs.State finished(ProductVideoPlanJobs jobs, String id) throws Exception {
    long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(4);
    while (System.nanoTime() < until) {
      var state = jobs.get(1L, id);
      if (List.of("failed", "completed").contains(state.status())) return state;
      Thread.sleep(10);
    }
    throw new AssertionError("Analysis did not finish");
  }

  @Test void selectedPlannerReadsOriginalImagesAndReturnsEditableFactsWithEvidence() throws Exception {
    var result = service(content).analyzeProduct(request, "analysis-test", progress());
    assertEquals("gem-3-pro", result.model());
    assertEquals("棉麻窗帘", result.productName());
    assertEquals(List.of(2), result.sellingPoints().get(0).imageIndices());
    assertEquals("请核对隔音参数", result.questions().get(0));
    var system = ArgumentCaptor.forClass(String.class);
    var input = ArgumentCaptor.forClass(String.class);
    verify(client).completeConfiguredModel(eq(credential), system.capture(), input.capture(), eq(request.images()), eq(.2),
        eq("product-video-planning"), eq("dropdown"), eq(8000), eq(Duration.ofSeconds(300)));
    assertTrue(system.getValue().contains("不策划分镜"));
    assertTrue(system.getValue().contains("内部结构"));
    assertEquals(request.brief(), mapper.readTree(input.getValue()).path("notes").asText());
    verifyNoInteractions(gem);
  }

  @Test void malformedOrInvalidEvidenceFailsWithoutSavingInvalidResultsOrAutomaticallyRetrying() throws Exception {
    for (String invalid : List.of("not json", "{}", content.replace("[2,2]", "[3]"), content.replace("遮光\"", "\""))) {
      reset(client);
      var service = service(invalid);
      var progress = mock(ProductVideoPlanService.ProgressListener.class);
      assertThrows(ApiException.class, () -> service.analyzeProduct(request, "analysis-test", progress));
      verify(progress, never()).response(anyString(), anyString());
      verify(client, times(1)).completeConfiguredModel(eq(credential), anyString(), anyString(), eq(request.images()), anyDouble(), anyString(), anyString(), anyInt(), any(Duration.class));
    }
  }

  @Test void analysisTaskIsOwnedDurableAndIdempotentAcrossRestarts() throws Exception {
    var service = service(content);
    String id = "product-analysis-test";
    var jobs = new ProductVideoPlanJobs(service, mapper, dir.toString());
    ProductVideoDtos.ProductAnalysis analysis;
    try {
      jobs.create(1L, new ProductVideoPlanJobs.CreateRequest(id, request));
      var result = finished(jobs, id);
      assertEquals("completed", result.status());
      assertTrue(result.result().shots().isEmpty());
      analysis = result.analysis();
      assertNotNull(analysis);
      assertEquals(analysis, jobs.create(1L, new ProductVideoPlanJobs.CreateRequest(id, request)).analysis());
      assertThrows(ApiException.class, () -> jobs.get(2L, id));
    } finally { jobs.close(); }
    var reopened = new ProductVideoPlanJobs(service, mapper, dir.toString());
    try {
      assertEquals(analysis, reopened.get(1L, id).analysis());
      assertEquals(analysis, reopened.retry(1L, id).analysis());
      verify(client, times(1)).completeConfiguredModel(eq(credential), anyString(), anyString(), anyList(), anyDouble(), anyString(), anyString(), anyInt(), any(Duration.class));
    } finally { reopened.close(); }
  }

  @Test void retryAfterRestartReusesValidatedSavedAnalysisWithoutAnotherModelRequest() throws Exception {
    var service = service(content);
    var analysis = service.analyzeProduct(request, "first-pass", progress());
    String id = "saved-analysis-retry";
    Files.createDirectories(dir.resolve("1"));
    var saved = new ProductVideoPlanJobs.Saved(new ProductVideoPlanJobs.State(id, "processing", "保存分析", 1, "",
        new ProductVideoDtos.PlanResponse("lk888", List.of(), null), 10), request, null,
        Map.of("product-analysis", mapper.writeValueAsString(analysis)));
    Files.writeString(dir.resolve("1").resolve(id + ".json"), mapper.writeValueAsString(saved));
    var jobs = new ProductVideoPlanJobs(service, mapper, dir.toString());
    try {
      assertEquals("failed", jobs.get(1L, id).status());
      jobs.retry(1L, id);
      assertEquals(analysis, finished(jobs, id).analysis());
      verify(client, times(1)).completeConfiguredModel(eq(credential), anyString(), anyString(), anyList(), anyDouble(), anyString(), anyString(), anyInt(), any(Duration.class));
    } finally { jobs.close(); }
  }

  @Test void requiresMaterialsAndRejectsAnalysisThroughTheScriptEndpoint() throws Exception {
    var service = service(content);
    var empty = new ProductVideoDtos.PlanRequest("notes", List.of(), 1, "3:4", null, null, "product_analysis");
    assertThrows(ApiException.class, () -> service.validate(empty));
    assertThrows(ApiException.class, () -> service.plan(request));
    var many = new ProductVideoDtos.PlanRequest("", java.util.Collections.nCopies(13, "https://assets.example/image.png"), 1, "3:4", null, null, "product_analysis");
    assertThrows(ApiException.class, () -> service.validate(many));
    verify(client, never()).completeConfiguredModel(any(), anyString(), anyString(), anyList(), anyDouble(), anyString(), anyString(), anyInt(), any(Duration.class));
  }
}
