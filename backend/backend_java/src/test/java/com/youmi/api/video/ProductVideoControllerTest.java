package com.youmi.api.video;

import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiException;
import com.youmi.api.common.GlobalExceptionHandler;
import com.youmi.api.credit.MiValueProperties;
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
  private MockMvc mvc;

  @BeforeEach void setup() {
    when(auth.requireUserId("Bearer test")).thenReturn(7L);
    when(auth.requireUserId(null)).thenThrow(new ApiException(401, "未登录"));
    var pricing = new MiValueProperties();
    pricing.setPrices(Map.of("VIDEO", 50));
    mvc = MockMvcBuilders.standaloneSetup(new ProductVideoController(auth, plans, compositions, products, pricing,
        new AnmiaoVideoProperties(), new MinimaxVideoProperties()),
        new ProductVideoPlanJobController(auth, jobs))
        .setControllerAdvice(new GlobalExceptionHandler()).build();
  }

  @Test void authenticatedPlanBindsJsonAndRejectsAnonymousAccess() throws Exception {
    when(plans.plan(any())).thenReturn(new ProductVideoDtos.PlanResponse("test", List.of(new ProductVideoDtos.ShotPlan("shot", "frame", "move", "", 4, "purpose", "design")), new ProductVideoDtos.PlanSummary("analysis", "concept")));
    mvc.perform(post("/api/product-videos/plan").contentType(MediaType.APPLICATION_JSON).content("{\"brief\":\"product\",\"count\":1}"))
        .andExpect(status().isUnauthorized());
    mvc.perform(post("/api/product-videos/plan").header("Authorization", "Bearer test").contentType(MediaType.APPLICATION_JSON)
        .content("{\"brief\":\"product\",\"count\":1,\"images\":[\"https://assets/frame.png\"],\"ratio\":\"16:9\"}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.shots[0].title").value("shot"));
    verify(plans).plan(argThat(request -> request.images().get(0).equals("https://assets/frame.png")));
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
        .andExpect(jsonPath("$.data.synchronizedAudio").value(true))
        .andExpect(jsonPath("$.data.referenceVideoReverse").value(true))
        .andExpect(jsonPath("$.data.referenceVideoHighlights").value(true))
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
