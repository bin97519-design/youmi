package com.youmi.api.ecommerce;

import com.youmi.api.auth.TokenService;
import com.youmi.api.common.ApiException;
import com.youmi.api.common.ApiResponse;
import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 电商套图 REST 控制器。
 * 提供策划、确认、生图、进度、结果、下载、画布导入 8 个端点。
 */
@RestController
@RequestMapping("/api/v1/ecommerce-sets")
public class EcommerceSetController {
  private static final Logger log = LoggerFactory.getLogger(EcommerceSetController.class);

  private final EcommerceSetService ecommerceSetService;
  private final TokenService tokenService;

  public EcommerceSetController(
      EcommerceSetService ecommerceSetService,
      TokenService tokenService) {
    this.ecommerceSetService = ecommerceSetService;
    this.tokenService = tokenService;
  }

  /**
   * POST /api/v1/ecommerce-sets/planning
   * 创建 AI 策划方案
   */
  @PostMapping("/planning")
  public ApiResponse<EcommerceSetDtos.PlanningResponse> createPlanning(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody EcommerceSetDtos.CreatePlanningRequest request) throws Exception {
    Long userId = requireUserId(authorization);
    return ApiResponse.ok(ecommerceSetService.createPlanning(userId, request));
  }

  /**
   * PUT /api/v1/ecommerce-sets/{setId}/planning
   * 更新策划数据
   */
  @PutMapping("/{setId}/planning")
  public ApiResponse<EcommerceSetDtos.PlanningResponse> updatePlanning(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable String setId,
      @RequestBody EcommerceSetDtos.UpdatePlanningRequest request) {
    Long userId = requireUserId(authorization);
    return ApiResponse.ok(ecommerceSetService.updatePlanning(userId, setId, request));
  }

  /**
   * POST /api/v1/ecommerce-sets/{setId}/confirm
   * 确认策划方案
   */
  @PostMapping("/{setId}/confirm")
  public ApiResponse<Object> confirmPlanning(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable String setId) {
    Long userId = requireUserId(authorization);
    ecommerceSetService.confirmPlanning(userId, setId);
    return ApiResponse.ok(java.util.Map.of("setId", setId, "status", "CONFIRMED"));
  }

  /**
   * POST /api/v1/ecommerce-sets/{setId}/generate
   * 启动生图
   */
  @PostMapping("/{setId}/generate")
  public ApiResponse<EcommerceSetDtos.GenerationResponse> startGeneration(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable String setId,
      @RequestBody EcommerceSetDtos.StartGenerationRequest request) throws Exception {
    Long userId = requireUserId(authorization);
    return ApiResponse.ok(ecommerceSetService.startGeneration(userId, setId, request));
  }

  /**
   * GET /api/v1/ecommerce-sets/{setId}/progress
   * 查询生图进度
   */
  @GetMapping("/{setId}/progress")
  public ApiResponse<EcommerceSetDtos.ProgressResponse> pollProgress(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable String setId) {
    Long userId = requireUserId(authorization);
    return ApiResponse.ok(ecommerceSetService.pollProgress(userId, setId));
  }

  /**
   * GET /api/v1/ecommerce-sets/{setId}/result
   * 获取生图结果
   */
  @GetMapping("/{setId}/result")
  public ApiResponse<EcommerceSetDtos.ResultResponse> getResult(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable String setId) {
    Long userId = requireUserId(authorization);
    return ApiResponse.ok(ecommerceSetService.getResult(userId, setId));
  }

  /** GET /api/v1/ecommerce-sets/source-images */
  @GetMapping("/source-images")
  public ApiResponse<java.util.List<EcommerceSetDtos.SourceImage>> getRecentSourceImages(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestParam(value = "limit", defaultValue = "24") int limit) {
    Long userId = requireUserId(authorization);
    return ApiResponse.ok(ecommerceSetService.getRecentSourceImages(userId, limit));
  }

  /**
   * GET /api/v1/ecommerce-sets/{setId}/images/{imageId}/download
   * 下载单张图片（代理转发，解决跨域）
   */
  @GetMapping("/{setId}/images/{imageId}/download")
  public ResponseEntity<InputStream> downloadImage(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable String setId,
      @PathVariable Long imageId) throws Exception {
    Long userId = requireUserId(authorization);
    // 获取图片 URL
    EcommerceSetDtos.ResultResponse result = ecommerceSetService.getResult(userId, setId);
    String imageUrl = null;
    for (EcommerceSetDtos.ResultImage img : result.mainImages()) {
      if (img.id() == imageId) { imageUrl = img.imageUrl(); break; }
    }
    if (imageUrl == null) {
      for (EcommerceSetDtos.ResultImage img : result.detailPages()) {
        if (img.id() == imageId) { imageUrl = img.imageUrl(); break; }
      }
    }
    if (imageUrl == null || imageUrl.isBlank()) {
      throw new ApiException(404, "图片不存在");
    }

    // 代理下载
    java.net.http.HttpClient client = java.net.http.HttpClient.newBuilder()
        .followRedirects(java.net.http.HttpClient.Redirect.NORMAL)
        .connectTimeout(java.time.Duration.ofSeconds(10))
        .build();
    java.net.http.HttpRequest httpRequest = java.net.http.HttpRequest.newBuilder()
        .uri(URI.create(imageUrl))
        .timeout(java.time.Duration.ofSeconds(120))
        .build();
    java.net.http.HttpResponse<InputStream> httpResponse = client.send(
        httpRequest, java.net.http.HttpResponse.BodyHandlers.ofInputStream());

    if (httpResponse.statusCode() != 200) {
      throw new ApiException(502, "图片下载失败：" + httpResponse.statusCode());
    }

    String contentType = "image/png";
    String cd = "attachment; filename=\"" + URLEncoder.encode("ecommerce_" + imageId + ".png", StandardCharsets.UTF_8) + "\"";

    return ResponseEntity.ok()
        .header(HttpHeaders.CONTENT_TYPE, contentType)
        .header(HttpHeaders.CONTENT_DISPOSITION, cd)
        .body(httpResponse.body());
  }

  /**
   * POST /api/v1/ecommerce-sets/{setId}/images/{imageId}/import-canvas
   * 导入到画布
   */
  @PostMapping("/{setId}/images/{imageId}/import-canvas")
  public ApiResponse<EcommerceSetDtos.CanvasImportResponse> importToCanvas(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable String setId,
      @PathVariable Long imageId) throws Exception {
    Long userId = requireUserId(authorization);
    return ApiResponse.ok(ecommerceSetService.importToCanvas(userId, setId, imageId));
  }

  /** POST /api/v1/ecommerce-sets/{setId}/images/{imageId}/retry */
  @PostMapping("/{setId}/images/{imageId}/retry")
  public ApiResponse<EcommerceSetDtos.RetryResponse> retryImage(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable String setId,
      @PathVariable Long imageId) {
    Long userId = requireUserId(authorization);
    return ApiResponse.ok(ecommerceSetService.retryImage(userId, setId, imageId));
  }

  // ==================== 鉴权辅助 ====================

  private Long requireUserId(String authorization) {
    String token = parseBearerToken(authorization);
    if (token == null || token.isBlank()) {
      throw new ApiException(401, "未登录");
    }
    return tokenService.getUserId(token)
        .orElseThrow(() -> new ApiException(401, "登录已过期"));
  }

  private String parseBearerToken(String authorization) {
    if (authorization == null || !authorization.startsWith("Bearer ")) return "";
    return authorization.substring("Bearer ".length());
  }
}
