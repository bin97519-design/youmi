package com.youmi.api.video;

import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiException;
import com.youmi.api.common.ApiResponse;
import com.youmi.api.credit.MiBizType;
import com.youmi.api.credit.MiValueProperties;
import com.youmi.api.image.ModelApiKeyService;
import com.youmi.api.image.ModelApiKeyDtos;
import com.youmi.api.selection.SelectionPoolService;
import java.util.Map;
import org.springframework.web.bind.annotation.*;
import org.springframework.beans.factory.annotation.Autowired;

@RestController
@RequestMapping("/api/product-videos")
public class ProductVideoController {
  private final AdminAuthService auth;
  private final ProductVideoPlanService plans;
  private final VideoCompositionService compositions;
  private final SelectionPoolService products;
  private final MiValueProperties pricing;
  private final AnmiaoVideoProperties anmiao;
  private final MinimaxVideoProperties minimax;
  private final AnmiaoVideoClient anmiaoClient;
  private ModelApiKeyService modelApiKeys;
  private MinimaxVideoClient minimaxClient;
  private ProductVideoPlanJobs planJobs;
  private ProductVideoContinuityService continuityReviews;

  public ProductVideoController(AdminAuthService auth, ProductVideoPlanService plans,
      VideoCompositionService compositions, SelectionPoolService products, MiValueProperties pricing,
      AnmiaoVideoProperties anmiao, MinimaxVideoProperties minimax) {
    this(auth, plans, compositions, products, pricing, anmiao, minimax, null);
  }

  @Autowired
  public ProductVideoController(AdminAuthService auth, ProductVideoPlanService plans,
      VideoCompositionService compositions, SelectionPoolService products, MiValueProperties pricing,
      AnmiaoVideoProperties anmiao, MinimaxVideoProperties minimax, AnmiaoVideoClient anmiaoClient) {
    this.auth = auth;
    this.plans = plans;
    this.compositions = compositions;
    this.products = products;
    this.pricing = pricing;
    this.anmiao = anmiao;
    this.minimax = minimax;
    this.anmiaoClient = anmiaoClient;
  }

  @Autowired(required = false)
  void setMinimaxClient(MinimaxVideoClient minimaxClient) { this.minimaxClient = minimaxClient; }

  @Autowired(required = false)
  void setModelApiKeys(ModelApiKeyService modelApiKeys) { this.modelApiKeys = modelApiKeys; }

  @Autowired
  void setPlanJobs(ProductVideoPlanJobs planJobs) { this.planJobs = planJobs; }

  @Autowired
  void setContinuityReviews(ProductVideoContinuityService reviews) { this.continuityReviews = reviews; }

  @GetMapping("/capabilities")
  public ApiResponse<?> capabilities(@RequestHeader(value = "Authorization", required = false) String token) {
    auth.requireUserId(token);
    var imageModels = modelApiKeys == null ? java.util.List.<ModelApiKeyDtos.ModelOption>of()
        : modelApiKeys.enabledModelOptions(ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION, "product-video-image");
    var videoModels = modelApiKeys == null ? java.util.List.<ModelApiKeyDtos.ModelOption>of()
        : modelApiKeys.enabledModelOptions(ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "product-video-video");
    boolean configured20 = anmiaoClient != null && anmiaoClient.hasConfiguredModelVersion(false, "product-video-video");
    boolean configured25 = anmiaoClient != null && anmiaoClient.hasConfiguredModelVersion(true, "product-video-video");
    boolean configuredHailuo = minimaxClient != null && minimaxClient.hasConfiguredHailuoModel("product-video-video");
    return ApiResponse.ok(Map.ofEntries(
        Map.entry("composition", compositions.available()),
        Map.entry("compositionResolutions", java.util.List.of("720p", "1080p", "2K", "4K")),
        Map.entry("videoSubmissionRecovery", true),
        Map.entry("localShotRefinement", true),
        Map.entry("wholeTimelineEditing", true),
        Map.entry("wholeTimelineRefinement", true),
        Map.entry("wholeTimelineReview", continuityReviews != null && continuityReviews.available()),
        Map.entry("continuityReview", continuityReviews != null && continuityReviews.available()),
        Map.entry("audioSmoothing", true),
        Map.entry("videoPrice", pricing.getPrice(MiBizType.VIDEO)),
        Map.entry("imagePrices", pricing.getImagePrices()),
        Map.entry("planStageTimeoutSeconds", plans.stageTimeoutSeconds()),
        Map.entry("planningModels", plans.models()),
        Map.entry("imageModels", imageModels),
        Map.entry("videoModels", videoModels),
        Map.entry("hailuoH3Video", configuredHailuo),
        Map.entry("clipSpeed", true), Map.entry("singleVideoPlan", true), Map.entry("singleVideo30", true),
        Map.entry("wholeVideoShotCount", true), Map.entry("synchronizedAudio", true),
        Map.entry("referenceVideoReverse", true), Map.entry("longReferenceVideo", true),
        Map.entry("referenceVideoHighlights", true),
        Map.entry("canvasVideoReversePrompt", true),
        Map.entry("fixedContinuity", true),
        Map.entry("fixedContinuityImages", true),
        Map.entry("imageEvidenceRoles", true),
        Map.entry("wholeVideoOptionalContinuity", true),
        Map.entry("anmiaoVideo", anmiao.isAvailable() || configured20),
        Map.entry("anmiaoMiPerSecondByResolution", anmiao.availableRates(configured20)),
        Map.entry("anmiao25Video", anmiao.isAvailable25() || configured25),
        Map.entry("anmiao25MiPerSecondByResolution", anmiao.availableRates25(configured25)),
        Map.entry("minimaxVideo", minimax.isAvailable() || configuredHailuo),
        Map.entry("minimaxMiPerSecondByResolution", minimax.availableRates(configuredHailuo))));
  }

  @PostMapping("/plan")
  public ApiResponse<?> plan(@RequestHeader(value = "Authorization", required = false) String token,
      @RequestBody ProductVideoDtos.PlanRequest request) throws Exception {
    auth.requireUserId(token);
    return ApiResponse.ok(plans.plan(request));
  }

  @PostMapping("/reverse-prompt")
  public ApiResponse<ProductVideoDtos.ReversePromptResponse> reversePrompt(
      @RequestHeader(value = "Authorization", required = false) String token,
      @RequestBody ProductVideoDtos.ReversePromptRequest request) throws Exception {
    auth.requireUserId(token);
    return ApiResponse.ok(plans.reversePrompt(request));
  }

  @PostMapping("/refine")
  public ApiResponse<ProductVideoDtos.PlanResponse> refine(
      @RequestHeader(value = "Authorization", required = false) String token,
      @RequestBody ProductVideoDtos.RefineRequest request) throws Exception {
    return ApiResponse.ok(planJobs.refine(auth.requireUserId(token), request));
  }

  @PostMapping("/refine-timeline")
  public ApiResponse<ProductVideoDtos.TimelineBeat> refineTimeline(
      @RequestHeader(value = "Authorization", required = false) String token,
      @RequestBody ProductVideoDtos.TimelineRefineRequest request) throws Exception {
    auth.requireUserId(token);
    return ApiResponse.ok(plans.refineTimeline(request));
  }

  @PostMapping("/compositions")
  public ApiResponse<?> compose(@RequestHeader(value = "Authorization", required = false) String token,
      @RequestBody ProductVideoDtos.ComposeRequest request) throws Exception {
    Long userId = auth.requireUserId(token);
    if (request != null && request.continuityReviewId() != null) {
      if (continuityReviews == null) throw new ApiException(503, "视频检查服务尚未就绪");
      continuityReviews.verifyComposition(userId, request.continuityReviewId(), request.clips());
    }
    return ApiResponse.ok(compositions.create(userId, request));
  }

  @PostMapping("/continuity-reviews")
  public ApiResponse<?> review(@RequestHeader(value = "Authorization", required = false) String token,
      @RequestBody ProductVideoContinuityService.Request request) throws Exception {
    Long userId = auth.requireUserId(token);
    if (continuityReviews == null) throw new ApiException(503, "视频检查服务尚未就绪");
    return ApiResponse.ok(continuityReviews.create(userId, request));
  }

  @GetMapping("/continuity-reviews/{id}")
  public ApiResponse<?> reviewStatus(@RequestHeader(value = "Authorization", required = false) String token,
      @PathVariable String id) throws Exception {
    Long userId = auth.requireUserId(token);
    if (continuityReviews == null) throw new ApiException(503, "视频检查服务尚未就绪");
    return ApiResponse.ok(continuityReviews.get(userId, id));
  }

  @PostMapping("/continuity-reviews/{id}/cancel")
  public ApiResponse<?> cancelReview(@RequestHeader(value = "Authorization", required = false) String token,
      @PathVariable String id) throws Exception {
    Long userId = auth.requireUserId(token);
    if (continuityReviews == null) throw new ApiException(503, "视频检查服务尚未就绪");
    return ApiResponse.ok(continuityReviews.cancel(userId, id));
  }

  @GetMapping("/compositions/{id}")
  public ApiResponse<?> status(@RequestHeader(value = "Authorization", required = false) String token,
      @PathVariable String id) throws Exception {
    return ApiResponse.ok(compositions.get(auth.requireUserId(token), id));
  }

  @PostMapping("/publish")
  public ApiResponse<?> publish(@RequestHeader(value = "Authorization", required = false) String token,
      @RequestBody ProductVideoDtos.PublishRequest request) throws Exception {
    Long userId = auth.requireUserId(token);
    if (request == null || request.productId() == null || request.compositionId() == null) throw new ApiException(400, "请选择商品和成片");
    var composition = compositions.get(userId, request.compositionId());
    if (!"completed".equals(composition.status())) throw new ApiException(409, "视频尚未合成完成");
    return ApiResponse.ok(products.appendMainVideo(userId, request.productId(), composition.url()));
  }
}
