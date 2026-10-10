package com.youmi.api.video;

import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiException;
import com.youmi.api.common.ApiResponse;
import com.youmi.api.credit.MiBizType;
import com.youmi.api.credit.MiValueProperties;
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
  private MinimaxVideoClient minimaxClient;

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

  @GetMapping("/capabilities")
  public ApiResponse<?> capabilities(@RequestHeader(value = "Authorization", required = false) String token) {
    auth.requireUserId(token);
    boolean configured20 = anmiaoClient != null && anmiaoClient.hasConfiguredModelVersion(false);
    boolean configured25 = anmiaoClient != null && anmiaoClient.hasConfiguredModelVersion(true);
    boolean configuredHailuo = minimaxClient != null && minimaxClient.hasConfiguredHailuoModel();
    return ApiResponse.ok(Map.ofEntries(
        Map.entry("composition", compositions.available()),
        Map.entry("videoPrice", pricing.getPrice(MiBizType.VIDEO)),
        Map.entry("imagePrices", pricing.getImagePrices()),
        Map.entry("planStageTimeoutSeconds", plans.stageTimeoutSeconds()),
        Map.entry("planningModels", plans.models()),
        Map.entry("clipSpeed", true), Map.entry("singleVideoPlan", true), Map.entry("singleVideo30", true),
        Map.entry("wholeVideoShotCount", true), Map.entry("synchronizedAudio", true),
        Map.entry("referenceVideoReverse", true), Map.entry("longReferenceVideo", true),
        Map.entry("referenceVideoHighlights", true),
        Map.entry("fixedContinuity", true),
        Map.entry("fixedContinuityImages", true),
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

  @PostMapping("/compositions")
  public ApiResponse<?> compose(@RequestHeader(value = "Authorization", required = false) String token,
      @RequestBody ProductVideoDtos.ComposeRequest request) throws Exception {
    return ApiResponse.ok(compositions.create(auth.requireUserId(token), request));
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
