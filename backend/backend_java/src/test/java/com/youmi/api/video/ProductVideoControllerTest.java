package com.youmi.api.video;

import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiException;
import com.youmi.api.common.GlobalExceptionHandler;
import com.youmi.api.credit.MiValueProperties;
import com.youmi.api.image.ModelApiKeyDtos;
import com.youmi.api.image.ModelApiKeyService;
import com.youmi.api.selection.SelectionPoolService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.util.List;
import java.util.Map;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class ProductVideoControllerTest {
  private final AdminAuthService auth = mock(AdminAuthService.class);
  private final ProductVideoPlanService plans = mock(ProductVideoPlanService.class);
  private final VideoCompositionService compositions = mock(VideoCompositionService.class);
  private final SelectionPoolService products = mock(SelectionPoolService.class);
  private final ProductVideoPlanJobs jobs = mock(ProductVideoPlanJobs.class);
  private final ProductVideoContinuityService reviews = mock(ProductVideoContinuityService.class);
  private MockMvc mvc;

  @BeforeEach void setup() {
    when(auth.requireUserId("Bearer test")).thenReturn(7L);
    when(auth.requireUserId(null)).thenThrow(new ApiException(401, "未登录"));
    var pricing = new MiValueProperties();
    pricing.setPrices(Map.of("VIDEO", 50));
    var controller = new ProductVideoController(auth, plans, compositions, products, pricing,
        new AnmiaoVideoProperties(), new MinimaxVideoProperties());
    controller.setContinuityReviews(reviews);
    mvc = MockMvcBuilders.standaloneSetup(controller,
        new ProductVideoPlanJobController(auth, jobs))
        .setControllerAdvice(new GlobalExceptionHandler()).build();
  }

  @Test void continuityReviewEndpointsRequireLoginAndScopeEveryOperation() throws Exception {
    String id = "00000000-0000-4000-8000-000000000001";
    var state = new ProductVideoContinuityService.State(id, "queued", 0, "Review", List.of(), "", List.of(), "");
    when(reviews.create(eq(7L), any())).thenReturn(state);
    when(reviews.get(7L, id)).thenReturn(state);
    when(reviews.cancel(7L, id)).thenReturn(state);
    String body = "{\"id\":\"" + id + "\",\"kind\":\"boundaries\",\"clips\":[]}";
    mvc.perform(post("/api/product-videos/continuity-reviews").contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().isUnauthorized());
    verifyNoInteractions(reviews);
    mvc.perform(post("/api/product-videos/continuity-reviews").header("Authorization", "Bearer test")
        .contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isOk()).andExpect(jsonPath("$.data.id").value(id));
    mvc.perform(get("/api/product-videos/continuity-reviews/" + id).header("Authorization", "Bearer test")).andExpect(status().isOk());
    mvc.perform(post("/api/product-videos/continuity-reviews/" + id + "/cancel").header("Authorization", "Bearer test")
        .contentType(MediaType.APPLICATION_JSON).content("{}")).andExpect(status().isOk());
    verify(reviews).create(eq(7L), argThat(request -> id.equals(request.id())));
    verify(reviews).get(7L, id); verify(reviews).cancel(7L, id);
  }

  @Test void compositionChecksAnExplicitReviewReceiptBeforeRendering() throws Exception {
    when(compositions.create(eq(7L), any())).thenReturn(new ProductVideoDtos.Composition("job", "queued", 0, "", ""));
    mvc.perform(post("/api/product-videos/compositions").header("Authorization", "Bearer test")
        .contentType(MediaType.APPLICATION_JSON).content("{\"clips\":[],\"ratio\":\"16:9\",\"continuityReviewId\":\"review\"}"))
        .andExpect(status().isOk());
    var order = inOrder(reviews, compositions);
    order.verify(reviews).verifyComposition(eq(7L), eq("review"), anyList());
    order.verify(compositions).create(eq(7L), any());
  }

  @Test void authenticatedPlanBindsJsonAndRejectsAnonymousAccess() throws Exception {
    when(plans.plan(any())).thenReturn(new ProductVideoDtos.PlanResponse("test", List.of(new ProductVideoDtos.ShotPlan("shot", "frame", "move", "", 4, "purpose", "design")), new ProductVideoDtos.PlanSummary("analysis", "concept")));
    mvc.perform(post("/api/product-videos/plan").contentType(MediaType.APPLICATION_JSON).content("{\"brief\":\"product\",\"count\":1}"))
        .andExpect(status().isUnauthorized());
    mvc.perform(post("/api/product-videos/plan").header("Authorization", "Bearer test").contentType(MediaType.APPLICATION_JSON)
        .content("{\"brief\":\"product\",\"count\":1,\"images\":[\"https://assets/frame.png\"],\"ratio\":\"16:9\",\"imageRoles\":[{\"imageIndex\":1,\"role\":\"primary_product\"}]}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.shots[0].title").value("shot"));
    verify(plans).plan(argThat(request -> request.images().get(0).equals("https://assets/frame.png")
        && request.imageRoles().get(0).equals(new ProductVideoDtos.ReferenceImageRole(1, "primary_product"))));
  }

  @Test void wholePeriodRefinementRequiresLoginAndPreservesTheSelectedIndex() throws Exception {
    String body = "{\"index\":1,\"request\":{\"brief\":\"Product\",\"count\":1}}";
    mvc.perform(post("/api/product-videos/refine-timeline").contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().isUnauthorized());
    verifyNoInteractions(plans);
    when(plans.refineTimeline(any())).thenReturn(new ProductVideoDtos.TimelineBeat(5, 15, "Action", "Camera", "Finish"));
    mvc.perform(post("/api/product-videos/refine-timeline").header("Authorization", "Bearer test")
        .contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isOk()).andExpect(jsonPath("$.data.start").value(5));
    verify(plans).refineTimeline(argThat(request -> request.index() == 1));
  }

  @Test void canvasReverseRequiresLoginAndReturnsTextWithoutSubmittingMedia() throws Exception {
    String body = """
        {"planningModel":"gem-3.8-flash","shotCount":2,"referenceVideo":{
        "url":"https://assets/source.mp4","duration":15,"width":832,"height":1108,
        "frames":[{"url":"https://assets/first.jpg","time":0.03},{"url":"https://assets/last.jpg","time":14.96}]}}
        """;
    when(plans.reversePrompt(any())).thenReturn(new ProductVideoDtos.ReversePromptResponse(
        "lk888", "gem-3.8-flash", "视频提示词", 15, 2));
    mvc.perform(post("/api/product-videos/reverse-prompt").contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().isUnauthorized());
    verifyNoInteractions(plans);
    mvc.perform(post("/api/product-videos/reverse-prompt").header("Authorization", "Bearer test")
        .contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.promptText").value("视频提示词"))
        .andExpect(jsonPath("$.data.frameCount").value(2));
    verify(plans).reversePrompt(argThat(request -> request.shotCount() == 2
        && "gem-3.8-flash".equals(request.planningModel()) && request.referenceVideo().frames().size() == 2));
    verifyNoInteractions(compositions, jobs, products);
  }

  @Test void compositionAndStatusAreScopedToAuthenticatedUser() throws Exception {
    when(compositions.create(eq(7L), any())).thenReturn(new ProductVideoDtos.Composition("job", "queued", 0, "", ""));
    when(compositions.get(7L, "job")).thenReturn(new ProductVideoDtos.Composition("job", "failed", 0, "", "input failure"));
    mvc.perform(post("/api/product-videos/compositions").header("Authorization", "Bearer test").contentType(MediaType.APPLICATION_JSON)
        .content("{\"clips\":[{\"url\":\"https://own/users/7/a.mp4\",\"start\":0,\"duration\":4}],\"ratio\":\"16:9\",\"musicVolume\":0.2}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.id").value("job"));
    mvc.perform(get("/api/product-videos/compositions/job").header("Authorization", "Bearer test"))
        .andExpect(jsonPath("$.data.status").value("failed"));
    verify(compositions).get(7L, "job");
  }

  @Test void planningCapabilitiesExposeTimeoutAndTimeoutReturnsGatewayStatus() throws Exception {
    when(plans.stageTimeoutSeconds()).thenReturn(180);
    when(plans.models()).thenReturn(List.of(
        new com.youmi.api.ai.CanvasAgentDtos.AgentModelOption("default", "gpt-5.6-luna", true),
        new com.youmi.api.ai.CanvasAgentDtos.AgentModelOption("gem-3.8-flash", "GEM 3.8 flash", true)));
    mvc.perform(get("/api/product-videos/capabilities").header("Authorization", "Bearer test"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.planStageTimeoutSeconds").value(180))
        .andExpect(jsonPath("$.data.planningModels[1].value").value("gem-3.8-flash"))
        .andExpect(jsonPath("$.data.planningModels[1].configured").value(true))
        .andExpect(jsonPath("$.data.clipSpeed").value(true))
        .andExpect(jsonPath("$.data.singleVideoPlan").value(true))
        .andExpect(jsonPath("$.data.wholeVideoShotCount").value(true))
        .andExpect(jsonPath("$.data.wholeVideoOptionalContinuity").value(true))
        .andExpect(jsonPath("$.data.imageEvidenceRoles").value(true))
        .andExpect(jsonPath("$.data.videoPlayback").value(true))
        .andExpect(jsonPath("$.data.synchronizedAudio").value(true))
        .andExpect(jsonPath("$.data.referenceVideoReverse").value(true))
        .andExpect(jsonPath("$.data.referenceVideoHighlights").value(true))
        .andExpect(jsonPath("$.data.canvasVideoReversePrompt").value(true))
        .andExpect(jsonPath("$.data.anmiaoVideo").value(false))
        .andExpect(jsonPath("$.data.anmiaoMiPerSecondByResolution['480p']").value(0))
        .andExpect(jsonPath("$.data.anmiaoMiPerSecondByResolution['720p']").value(0))
        .andExpect(jsonPath("$.data.anmiaoMiPerSecondByResolution['1080p']").value(0))
        .andExpect(jsonPath("$.data.anmiaoMiPerSecondByResolution['4k']").value(0))
        .andExpect(jsonPath("$.data.anmiao25Video").value(false))
        .andExpect(jsonPath("$.data.anmiao25MiPerSecondByResolution['480p']").value(0))
        .andExpect(jsonPath("$.data.anmiao25MiPerSecondByResolution['720p']").value(0))
        .andExpect(jsonPath("$.data.anmiao25MiPerSecondByResolution['1080p']").value(0))
        .andExpect(jsonPath("$.data.minimaxVideo").value(false))
        .andExpect(jsonPath("$.data.minimaxMaxVideo").doesNotExist())
        .andExpect(jsonPath("$.data.minimaxMaxMiPerSecondByResolution").doesNotExist());
    when(plans.plan(any())).thenThrow(new ApiException(504, "分镜策划超时（商品识图与整片策划）"));
    mvc.perform(post("/api/product-videos/plan").header("Authorization", "Bearer test").contentType(MediaType.APPLICATION_JSON)
        .content("{\"brief\":\"product\",\"count\":4,\"ratio\":\"16:9\"}"))
        .andExpect(status().isGatewayTimeout()).andExpect(jsonPath("$.code").value(504))
        .andExpect(jsonPath("$.message").value("分镜策划超时（商品识图与整片策划）"));
  }

  @Test void capabilitiesReturnMappedModelsWithoutRequiringVaultDecryption() throws Exception {
    var keys = mock(ModelApiKeyService.class);
    when(keys.enabledModelOptions(ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION, "product-video-image"))
        .thenReturn(List.of(new ModelApiKeyDtos.ModelOption("tt-image-2.5", "Image model", "test")));
    when(keys.enabledModelOptions(ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "product-video-video"))
        .thenReturn(List.of(new ModelApiKeyDtos.ModelOption("minimax-h3", "MiniMax H3", "test")));
    when(keys.resolve(anyString(), anyString(), anyString()))
        .thenThrow(new ApiException(503, "vault unavailable"));
    var minimax = new MinimaxVideoProperties();
    var client = new MinimaxVideoClient(minimax, mock(VideoGenerationClient.class), new com.fasterxml.jackson.databind.ObjectMapper());
    client.setModelApiKeyService(keys);
    var pricing = new MiValueProperties();
    pricing.setPrices(Map.of("VIDEO", 50));
    when(plans.models()).thenReturn(List.of());
    var controller = new ProductVideoController(auth, plans, compositions, products, pricing,
        new AnmiaoVideoProperties(), minimax);
    controller.setModelApiKeys(keys);
    controller.setMinimaxClient(client);
    var capabilitiesMvc = MockMvcBuilders.standaloneSetup(controller)
        .setControllerAdvice(new GlobalExceptionHandler()).build();
    capabilitiesMvc.perform(get("/api/product-videos/capabilities").header("Authorization", "Bearer test"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.imageModels[0].value").value("tt-image-2.5"))
        .andExpect(jsonPath("$.data.videoModels[0].value").value("minimax-h3"))
        .andExpect(jsonPath("$.data.hailuoH3Video").value(true));
    verify(keys, never()).resolve(anyString(), anyString(), anyString());
    verify(compositions).available();
    verifyNoMoreInteractions(compositions);
    verifyNoInteractions(products);
  }

  @Test void compositionBindsPerClipSpeedWithoutChangingLegacyTrimRequest() throws Exception {
    when(compositions.create(eq(7L), any())).thenReturn(new ProductVideoDtos.Composition("speed-job", "queued", 0, "", ""));
    mvc.perform(post("/api/product-videos/compositions").header("Authorization", "Bearer test").contentType(MediaType.APPLICATION_JSON)
        .content("{\"clips\":[{\"url\":\"https://own/users/7/a.mp4\",\"start\":0,\"duration\":4,\"timingMode\":\"speed\"},{\"url\":\"https://own/users/7/b.mp4\",\"start\":2,\"duration\":3}],\"ratio\":\"16:9\",\"musicVolume\":0.2}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.id").value("speed-job"));
    verify(compositions).create(eq(7L), argThat(request ->
        "speed".equals(request.clips().get(0).timingMode()) && request.clips().get(0).duration() == 4
        && request.clips().get(1).timingMode() == null && request.clips().get(1).start() == 2));
  }

  @Test void publishesOnlyOwnedCompletedOutputNotClientSuppliedUrl() throws Exception {
    when(compositions.get(7L, "job")).thenReturn(new ProductVideoDtos.Composition("job", "completed", 100, "https://own/users/7/final.mp4", ""));
    mvc.perform(post("/api/product-videos/publish").header("Authorization", "Bearer test").contentType(MediaType.APPLICATION_JSON)
        .content("{\"productId\":9,\"compositionId\":\"job\"}"))
        .andExpect(status().isOk());
    verify(products).appendMainVideo(7L, 9L, "https://own/users/7/final.mp4");
  }

  @Test void doesNotPublishIncompleteOutput() throws Exception {
    when(compositions.get(7L, "job")).thenReturn(new ProductVideoDtos.Composition("job", "processing", 50, "", ""));
    mvc.perform(post("/api/product-videos/publish").header("Authorization", "Bearer test").contentType(MediaType.APPLICATION_JSON)
        .content("{\"productId\":9,\"compositionId\":\"job\"}"))
        .andExpect(jsonPath("$.code").value(409));
    verifyNoInteractions(products);
  }

  @Test void planJobsExposeAuthenticatedSubmissionCheckpointsAndExplicitRetry() throws Exception {
    var state = new ProductVideoPlanJobs.State("task", "processing", "镜头 3-4", 4, "",
        new ProductVideoDtos.PlanResponse("test", List.of(new ProductVideoDtos.ShotPlan("saved", "frame", "move", "", 4, "purpose", "design")), null), 100);
    when(jobs.create(eq(7L), any())).thenReturn(state);
    when(jobs.get(7L, "task")).thenReturn(state);
    when(jobs.retry(7L, "task")).thenReturn(state);
    mvc.perform(get("/api/product-videos/plan-tasks/task")).andExpect(status().isUnauthorized());
    mvc.perform(post("/api/product-videos/plan-tasks").header("Authorization", "Bearer test")
        .contentType(MediaType.APPLICATION_JSON).content("{\"id\":\"task\",\"request\":{\"brief\":\"product\",\"count\":4,\"ratio\":\"16:9\"}}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.id").value("task"));
    mvc.perform(get("/api/product-videos/plan-tasks/task").header("Authorization", "Bearer test"))
        .andExpect(jsonPath("$.data.result.shots[0].title").value("saved"))
        .andExpect(jsonPath("$.data.stage").value("镜头 3-4"));
    mvc.perform(post("/api/product-videos/plan-tasks/task/retry").header("Authorization", "Bearer test"))
        .andExpect(status().isOk());
    verify(jobs).create(eq(7L), argThat(input -> input.request().count() == 4));
    verify(jobs).get(7L, "task");
    verify(jobs).retry(7L, "task");
  }
}
