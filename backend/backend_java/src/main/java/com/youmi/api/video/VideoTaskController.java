package com.youmi.api.video;

import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiException;
import com.youmi.api.common.ApiResponse;
import com.youmi.api.credit.MiBizType;
import com.youmi.api.credit.MiValueDtos;
import com.youmi.api.credit.MiValueService;
import com.youmi.api.image.ModelApiKeyDtos;
import com.youmi.api.image.ModelApiKeyService;
import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Optional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * THQ 视频生成入口。米值闸门逻辑完全镜像 {@code ImageTaskController}：
 * 先扣后生成、失败回滚、异步终态回滚/确认，单价取 {@code MiValueProperties} 的 VIDEO(50)。
 */
@RestController
@RequestMapping("/api/video-tasks")
public class VideoTaskController {
  private final VideoGenerationClient videoGenerationClient;
  private final MiValueService miValueService;
  private final AdminAuthService adminAuthService;
  private final ChatVideoJobs chatVideos;
  private final AnmiaoVideoClient anmiaoVideos;
  private final MinimaxVideoClient minimaxVideos;
  private SeedanceAnciVideoClient seedanceAnciVideos;
  private KlingOmniVideoClient klingOmniVideos;
  private WanxiangVideoClient wanxiangVideos;
  private ModelApiKeyService modelApiKeys;
  private final VideoTaskHistory history;
  private VideoTaskSubmissions submissions;
  /** Source-compatible setter retained for the product-video adapter tests/callers. */
  void setAnciVideos(SeedanceAnciVideoClient client) { this.seedanceAnciVideos = client; }

  public VideoTaskController(
      VideoGenerationClient videoGenerationClient,
      MiValueService miValueService,
      AdminAuthService adminAuthService, ChatVideoJobs chatVideos, AnmiaoVideoClient anmiaoVideos,
      MinimaxVideoClient minimaxVideos, VideoTaskHistory history) {
    this.videoGenerationClient = videoGenerationClient;
    this.miValueService = miValueService;
    this.adminAuthService = adminAuthService;
    this.chatVideos = chatVideos;
    this.anmiaoVideos = anmiaoVideos;
    this.minimaxVideos = minimaxVideos;
    this.history = history;
  }

  @org.springframework.beans.factory.annotation.Autowired(required = false)
  void setModelApiKeys(ModelApiKeyService modelApiKeys) { this.modelApiKeys = modelApiKeys; }

  @org.springframework.beans.factory.annotation.Autowired
  void setSeedanceAnciVideos(SeedanceAnciVideoClient client) { this.seedanceAnciVideos = client; }

  @org.springframework.beans.factory.annotation.Autowired
  void setKlingOmniVideos(KlingOmniVideoClient client) { this.klingOmniVideos = client; }

  @org.springframework.beans.factory.annotation.Autowired
  void setWanxiangVideos(WanxiangVideoClient client) { this.wanxiangVideos = client; }

  @org.springframework.beans.factory.annotation.Autowired
  void setSubmissions(VideoTaskSubmissions submissions) { this.submissions = submissions; }

  @PostMapping
  public ApiResponse<VideoGenerationDtos.CreateTaskResponse> create(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody VideoGenerationDtos.CreateTaskRequest request) throws Exception {
    Long userId = adminAuthService.requireUserId(authorization);
    return submissions == null ? createForUser(userId, request)
        : ApiResponse.ok(submissions.create(userId, request, () -> createForUser(userId, request).data()));
  }

  private ApiResponse<VideoGenerationDtos.CreateTaskResponse> createForUser(Long userId,
      VideoGenerationDtos.CreateTaskRequest request) throws Exception {
    long startedAt = System.currentTimeMillis();
    String featureCode = request == null ? null : request.featureCode();
    boolean productVideoCall = "product-video-video".equals(featureCode);
    if (featureCode != null && !featureCode.isBlank()
        && !java.util.Set.of("canvas-video", "product-video-video").contains(featureCode))
      throw new ApiException(400, "不支持的视频生成功能映射");
    String profile = request == null ? null : request.parameterProfile();
    boolean seedance25Profile = AnmiaoVideoClient.CANVAS_V3_SEEDANCE25.equals(profile);
    boolean minimaxH3Profile = "canvas-v3-minimax-h3".equals(profile);
    boolean seedanceAnciProfile = SeedanceAnciVideoClient.PROFILE.equals(profile);
    boolean klingOmniProfile = KlingOmniVideoClient.PROFILE.equals(profile);
    boolean wanxiangProfile = WanxiangVideoClient.PROFILE.equals(profile);
    boolean wanxiangRoute = request != null && wanxiangVideos != null
        && wanxiangVideos.supports(request.model(), "canvas-video");
    if (request != null && (WanxiangVideoClient.isModel(request.model()) || wanxiangRoute) && !wanxiangProfile)
      throw new ApiException(400, "万相 3.0 全能必须使用对应的参数配置");
    if (!wanxiangProfile && request != null
        && (!request.wanxiangParams().isEmpty() || !request.referenceAudioMedia().isEmpty()))
      throw new ApiException(400, "wanxiang_params 和 reference_audio_media 仅用于万相 3.0 全能参数配置");
    boolean klingOmniRoute = request != null && klingOmniVideos != null
        && klingOmniVideos.supports(request.model(), "canvas-video");
    boolean klingOmniModel = request != null && KlingOmniVideoClient.isModel(request.model());
    if ((klingOmniModel || klingOmniRoute) && !klingOmniProfile)
      throw new ApiException(400, "可灵-Omni 必须使用对应的参数配置");
    if (!klingOmniProfile && request != null && !request.omniParams().isEmpty())
      throw new ApiException(400, "omni_params 仅用于可灵-Omni 参数配置");
    boolean seedanceAnciRoute = request != null && seedanceAnciVideos != null
        && seedanceAnciVideos.supports(request.model(), featureCode);
    boolean seedanceAnciModel = request != null && request.model() != null
        && SeedanceAnciVideoClient.MODEL.equalsIgnoreCase(request.model().trim());
    boolean legacyAnci = seedanceAnciModel && (profile == null || profile.isBlank())
        && (productVideoCall || featureCode == null || featureCode.isBlank());
    // This model must never fall through to the similarly named native per-second adapter.
    if ((seedanceAnciModel || seedanceAnciRoute) && !seedanceAnciProfile && !legacyAnci)
      throw new ApiException(400, "Seedance 2.0 按次必须使用对应的按次参数配置");
    if (profile != null && !profile.isBlank()) {
      if (!seedance25Profile && !minimaxH3Profile && !seedanceAnciProfile && !klingOmniProfile && !wanxiangProfile)
        throw new ApiException(400, "不支持的视频参数配置");
      boolean supported = wanxiangProfile ? wanxiangRoute && !productVideoCall
          : klingOmniProfile ? klingOmniRoute && !productVideoCall
          : seedanceAnciProfile ? seedanceAnciRoute : seedance25Profile
          ? anmiaoVideos.supportsCanvasV3Seedance25(request.model(), featureCode)
          : minimaxVideos.supportsCanvasV3H3(request.model(), featureCode);
      if (!supported) throw new ApiException(400, "视频模型与所选参数配置不匹配或未配置对应通道");
    }
    if (wanxiangProfile) {
      wanxiangVideos.validate(request);
      // Settlement uses this provider's final reported cost, never an invented price.
      MiValueDtos.DeductResult deduct = miValueService.checkAndDeduct(userId, MiBizType.VIDEO, 0);
      try {
        var response = wanxiangVideos.createTask(request);
        miValueService.linkTask(deduct.logId(), response.getTaskId());
        response.setConsumedMi(deduct.price());
        response.setBalance(miValueService.getBalance(userId));
        history.created(userId, request, response, startedAt);
        return ApiResponse.ok(response);
      } catch (Exception error) {
        miValueService.rollback(userId, deduct.logId());
        throw error;
      }
    }
    if (klingOmniProfile) {
      klingOmniVideos.validate(request);
      // Provider final cost is authoritative; no hardcoded mode/duration price.
      MiValueDtos.DeductResult deduct = miValueService.checkAndDeduct(userId, MiBizType.VIDEO, 0);
      try {
        var response = klingOmniVideos.createTask(request);
        miValueService.linkTask(deduct.logId(), response.getTaskId());
        response.setConsumedMi(deduct.price());
        response.setBalance(miValueService.getBalance(userId));
        history.created(userId, request, response, startedAt);
        return ApiResponse.ok(response);
      } catch (Exception error) {
        miValueService.rollback(userId, deduct.logId());
        throw error;
      }
    }
    if (seedanceAnciProfile) {
      seedanceAnciVideos.validate(request);
      // The upstream per-call price is not a duration rate. The final provider
      // cost settles this zero hold through the same idempotent billing flow.
      MiValueDtos.DeductResult deduct = miValueService.checkAndDeduct(userId, MiBizType.VIDEO, 0);
      try {
        var response = seedanceAnciVideos.createTask(request);
        miValueService.linkTask(deduct.logId(), response.getTaskId());
        response.setConsumedMi(deduct.price());
        response.setBalance(miValueService.getBalance(userId));
        history.created(userId, request, response, startedAt);
        return ApiResponse.ok(response);
      } catch (Exception error) {
        miValueService.rollback(userId, deduct.logId());
        throw error;
      }
    }
    boolean mappedHailuoAlias = productVideoCall && minimaxVideos.usesMappedHailuoAlias(
        request == null ? null : request.model(), featureCode);
    if (productVideoCall && !mappedHailuoAlias
        && (modelApiKeys == null || request.model() == null || modelApiKeys.resolve(
            request.model(), ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, featureCode).isEmpty()))
      throw new ApiException(400, "该视频模型未映射到主图视频分镜视频生成功能");
    if (request != null && "minimax-h3-max".equals(request.model()))
      throw new ApiException(400, "原视频模型已移除，请重新选择视频模型");
    if (!seedance25Profile && !minimaxH3Profile && request != null && !request.normalizedReferenceVideos().isEmpty()
        && (!AnmiaoVideoClient.supportsVideoReferences(request.model())
            || !(productVideoCall ? anmiaoVideos.supportsModel(request.model(), featureCode)
                : anmiaoVideos.supportsModel(request.model()))))
      throw new ApiException(400, "所选模型或通道不支持参考视频，请更换模型或移除视频连线");
    if (request != null && ChatVideoClient.MODEL.equals(request.model())) {
      VideoGenerationDtos.CreateTaskResponse response = chatVideos.create(userId, request);
      history.created(userId, request, response, startedAt);
      return ApiResponse.ok(response);
    }
    boolean minimax = minimaxH3Profile || request != null && MinimaxVideoClient.supportsModel(request.model());
    boolean configuredModel = seedance25Profile || request != null && !minimax && !legacyAnci && (productVideoCall
        ? anmiaoVideos.supportsModel(request.model(), featureCode)
        : anmiaoVideos.supportsModel(request.model()));
    if (request != null && !minimax && !legacyAnci && !configuredModel
        && anmiaoVideos.isConfiguredKeyExcluded(request.model()))
      throw new ApiException(400, "所选视频模型未映射到画布视频功能");
    if (minimax || configuredModel || legacyAnci) {
      MiValueDtos.DeductResult deduct;
      if (seedance25Profile) {
        BigDecimal price = anmiaoVideos.quoteCanvasV3Seedance25(request);
        deduct = miValueService.checkAndDeduct(userId, MiBizType.VIDEO, price);
      } else {
        int price = legacyAnci ? seedanceAnciVideos.price(request) : minimax ? minimaxVideos.price(request) : anmiaoVideos.price(request);
        deduct = miValueService.checkAndDeduct(userId, MiBizType.VIDEO, price);
      }
      try {
        VideoGenerationDtos.CreateTaskResponse response = legacyAnci ? seedanceAnciVideos.createTask(request) : minimax
            ? minimaxVideos.createTask(request) : anmiaoVideos.createTask(request);
        miValueService.linkTask(deduct.logId(), response.getTaskId());
        response.setConsumedMi(deduct.price());
        response.setBalance(miValueService.getBalance(userId));
        history.created(userId, request, response, startedAt);
        return ApiResponse.ok(response);
      } catch (Exception error) {
        miValueService.rollback(userId, deduct.logId());
        throw error;
      }
    }
    MiValueDtos.DeductResult deduct = miValueService.checkAndDeduct(userId, MiBizType.VIDEO);
    try {
      VideoGenerationDtos.CreateTaskResponse response = videoGenerationClient.createTask(request);
      miValueService.linkTask(deduct.logId(), response.getTaskId());
      miValueService.commit(deduct.logId());
      response.setConsumedMi(deduct.price());
      response.setBalance(miValueService.getBalance(userId));
      history.created(userId, request, response, startedAt);
      return ApiResponse.ok(response);
    } catch (Exception e) {
      miValueService.rollback(userId, deduct.logId());
      System.err.println("[VideoTask] createTask FAILED for user=" + userId
          + " model=" + request.model()
          + " error=" + e.getClass().getSimpleName() + ": " + e.getMessage());
      e.printStackTrace();
      String reason = e.getMessage() == null || e.getMessage().isBlank()
          ? "上游视频服务未返回错误原因"
          : e.getMessage().replaceAll("\\s+", " ").trim();
      if (reason.length() > 500) {
        reason = reason.substring(0, 500) + "...";
      }
      throw new ApiException(502, "视频生成失败，失败任务不计入米值消耗：" + reason, e);
    }
  }

  @GetMapping("/models")
  public ApiResponse<java.util.List<ModelApiKeyDtos.ModelOption>> models(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @org.springframework.web.bind.annotation.RequestParam(value = "feature_code", defaultValue = "canvas-video") String featureCode) {
    adminAuthService.requireUserId(authorization);
    if (!java.util.Set.of("canvas-video", "product-video-video").contains(featureCode))
      throw new ApiException(400, "不支持的视频模型功能映射");
    return ApiResponse.ok(anmiaoVideos.configuredModels(featureCode));
  }

  /** Opt-in routed model identities for Canvas V3; legacy /models is unchanged. */
  @GetMapping("/canvas-models")
  public ApiResponse<java.util.List<ModelApiKeyDtos.ModelOption>> canvasModels(
      @RequestHeader(value = "Authorization", required = false) String authorization) {
    adminAuthService.requireUserId(authorization);
    var options = new java.util.ArrayList<ModelApiKeyDtos.ModelOption>(modelApiKeys == null ? java.util.List.of()
        : modelApiKeys.enabledRoutedModelOptions(ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, "canvas-video"));
    boolean hasSeedance25 = options.stream().anyMatch(option ->
        AnmiaoVideoClient.MODEL25.equals(option.model())
            || "seedance-2.5-guanfang-anmiao".equals(option.model())
            || AnmiaoVideoClient.MODEL25.equals(option.value())
            || "seedance-2.5-guanfang-anmiao".equals(option.value()));
    if (!hasSeedance25 && anmiaoVideos.available25())
      options.add(new ModelApiKeyDtos.ModelOption(AnmiaoVideoClient.MODEL25,
          "SD 2.5 满血版 按秒", "anmiao", AnmiaoVideoClient.MODEL25));
    boolean hasMinimaxH3 = options.stream().anyMatch(option ->
        MinimaxVideoClient.MODEL.equalsIgnoreCase(option.model())
            || MinimaxVideoClient.MODEL.equalsIgnoreCase(option.value()));
    if (!hasMinimaxH3 && minimaxVideos.availableCanvasV3H3())
      options.add(new ModelApiKeyDtos.ModelOption(MinimaxVideoClient.MODEL,
          "MiniMax H3", "minimax", MinimaxVideoClient.MODEL));
    return ApiResponse.ok(java.util.List.copyOf(options));
  }

  @GetMapping("/by-client-task-id")
  public ApiResponse<VideoTaskSubmissions.Lookup> byClientTaskId(
      @org.springframework.web.bind.annotation.RequestParam("client_task_id") String clientId,
      @RequestHeader(value = "Authorization", required = false) String authorization) throws Exception {
    Long userId = adminAuthService.requireUserId(authorization);
    return ApiResponse.ok(submissions.lookup(userId, clientId));
  }

  @GetMapping("/{taskId}")
  public ApiResponse<VideoGenerationDtos.TaskStatusResponse> get(
      @PathVariable String taskId,
      @RequestHeader(value = "Authorization", required = false) String authorization)
      throws Exception {
    Long userId = adminAuthService.requireUserId(authorization);
    return ApiResponse.ok(refresh(userId, taskId));
  }

  VideoGenerationDtos.TaskStatusResponse refresh(Long userId, String taskId) throws Exception {
    if (!miValueService.isTaskOwnedByUser(userId, taskId, MiBizType.VIDEO)) {
      throw new ApiException(404, "Video task not found");
    }
    VideoGenerationDtos.TaskStatusResponse response = taskId.startsWith(ChatVideoJobs.PREFIX)
        ? chatVideos.get(userId, taskId)
        : taskId.startsWith(WanxiangVideoClient.PREFIX)
            ? wanxiangVideos.getTask(taskId, userId)
        : taskId.startsWith(KlingOmniVideoClient.PREFIX)
            ? klingOmniVideos.getTask(taskId, userId)
        : SeedanceAnciVideoClient.isTaskId(taskId)
            ? seedanceAnciVideos.getTask(taskId, userId)
        : taskId.startsWith(AnmiaoVideoClient.PREFIX)
            ? anmiaoVideos.getTask(taskId, userId)
        : taskId.startsWith(MinimaxVideoClient.PREFIX) || taskId.startsWith(MinimaxVideoClient.CONFIGURED_PREFIX)
                ? minimaxVideos.getTask(taskId, userId) : videoGenerationClient.getTask(taskId, userId);
    if (isTerminalFailed(response.getStatus())) {
      miValueService.rollbackByTaskId(taskId);
    } else if (isTerminalSuccess(response.getStatus())) {
      if (usesProviderReportedCostTask(taskId, response)) {
        Optional<BigDecimal> actualCost = providerCostInMi(response.getRaw(),
            taskId.startsWith(KlingOmniVideoClient.PREFIX) || taskId.startsWith(WanxiangVideoClient.PREFIX));
        if (actualCost.isPresent()) {
          miValueService.settleActualByTaskId(taskId, actualCost.get());
        } else {
          response.setStatus("processing");
          response.setStage("生成已完成，等待灵科 AI 返回实际费用");
        }
      } else {
        miValueService.commitByTaskId(taskId);
      }
    }
    history.status(userId, response);
    return response;
  }

  private Optional<BigDecimal> providerCostInMi(JsonNode raw, boolean documentedTopLevelCost) {
    if (raw == null || raw.isNull() || raw.isMissingNode()) return Optional.empty();
    JsonNode cost = documentedTopLevelCost ? raw.get("cost") : raw.findValue("cost");
    if (cost == null || cost.isNull() || cost.isMissingNode()) return Optional.empty();
    try {
      BigDecimal amount = cost.isNumber() ? cost.decimalValue() : new BigDecimal(cost.asText().trim());
      if (amount.signum() < 0) return Optional.empty();
      return Optional.of(amount.movePointRight(2).setScale(2, RoundingMode.HALF_UP));
    } catch (NumberFormatException | ArithmeticException ignored) {
      return Optional.empty();
    }
  }

  private boolean usesProviderReportedCostTask(String taskId,
      VideoGenerationDtos.TaskStatusResponse response) {
    if (taskId != null && taskId.startsWith(WanxiangVideoClient.PREFIX)) return true;
    if (taskId != null && taskId.startsWith(KlingOmniVideoClient.PREFIX)) return true;
    if (SeedanceAnciVideoClient.isTaskId(taskId)) return true;
    if (taskId != null && taskId.startsWith(AnmiaoVideoClient.CANVAS_V3_PREFIX)) return false;
    return (taskId != null && (taskId.startsWith(MinimaxVideoClient.CONFIGURED_PREFIX + "key:")
        || taskId.startsWith(MinimaxVideoClient.MAPPED_PREFIX)))
        || ModelApiKeyService.usesProviderReportedCost(response.getProvider());
  }

  private boolean isTerminalFailed(String status) {
    if (status == null) {
      return false;
    }
    String s = status.trim().toLowerCase();
    return s.equals("failed") || s.equals("error") || s.equals("cancelled")
        || s.equals("canceled") || s.equals("expired") || s.equals("aborted")
        || s.contains("error") || s.contains("fail");
  }

  private boolean isTerminalSuccess(String status) {
    if (status == null) {
      return false;
    }
    String s = status.trim().toLowerCase();
    return s.equals("completed") || s.equals("succeeded") || s.equals("success")
        || s.equals("done") || s.equals("finished") || s.equals("generated")
        || s.equals("ready");
  }
}
