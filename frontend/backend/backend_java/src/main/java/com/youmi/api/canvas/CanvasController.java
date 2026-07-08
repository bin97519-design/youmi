package com.youmi.api.canvas;

import com.youmi.api.auth.TokenService;
import com.youmi.api.common.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/canvas")
public class CanvasController {
  private static final Logger log = LoggerFactory.getLogger(CanvasController.class);

  private final CanvasRepository canvasRepository;
  private final TokenService tokenService;

  public CanvasController(CanvasRepository canvasRepository, TokenService tokenService) {
    this.canvasRepository = canvasRepository;
    this.tokenService = tokenService;
  }

  @GetMapping("/list")
  public ApiResponse<List<CanvasDtos.CanvasSummary>> list(
      @RequestHeader(value = "Authorization", required = false) String authorization) {
    Long userId = requireUserId(authorization);
    List<CanvasDocument> docs = canvasRepository.findByUserId(userId);
    List<CanvasDtos.CanvasSummary> summaries = docs.stream()
        .map(d -> new CanvasDtos.CanvasSummary(d.docId(), d.title(), d.thumbnailUrl(), d.isReversePrompt(), d.updatedAt()))
        .toList();
    return ApiResponse.ok(summaries);
  }

  @GetMapping("/{docId}")
  public ApiResponse<CanvasDtos.CanvasDetail> get(
      @PathVariable String docId,
      @RequestHeader(value = "Authorization", required = false) String authorization) {
    Long userId = requireUserId(authorization);
    Optional<CanvasDocument> doc = canvasRepository.findByDocIdAndUserId(docId, userId);
    if (doc.isEmpty()) {
      return ApiResponse.fail(404, "画布不存在");
    }
    CanvasDocument d = doc.get();
    return ApiResponse.ok(new CanvasDtos.CanvasDetail(d.docId(), d.title(), d.payload(), d.thumbnailUrl(), d.isReversePrompt(), d.createdAt(), d.updatedAt()));
  }

  @PostMapping("/save")
  public ApiResponse<Object> save(
      @RequestBody CanvasDtos.SaveRequest request,
      @RequestHeader(value = "Authorization", required = false) String authorization) {
    Long userId = requireUserId(authorization);
    if (request.docId() == null || request.docId().isBlank()) {
      return ApiResponse.fail(400, "docId 不能为空");
    }
    CanvasDocument doc = new CanvasDocument(
        null,
        request.docId(),
        userId,
        request.title(),
        request.payload(),
        request.thumbnailUrl(),
        request.isReversePrompt(),
        0,
        0
    );
    canvasRepository.save(doc);
    return ApiResponse.ok(java.util.Map.of("docId", request.docId()));
  }

  /**
   * 关闭页面兜底用：navigator.sendBeacon 不能自定义 Authorization 头，
   * 因此走 query 参数传 token。
   * GET 只能 query 串短，因此只用来保存最简信息。
   * POST + body 的 beacon：仍然带 query 里的 token。
   */
  @PostMapping(value = "/beacon", params = "t")
  public ApiResponse<Object> beacon(
      @org.springframework.web.bind.annotation.RequestParam("t") String token,
      @RequestBody CanvasDtos.SaveRequest request) {
    Long userId = tokenService.getUserId(token).orElse(null);
    if (userId == null) {
      return ApiResponse.fail(401, "登录已过期");
    }
    if (request.docId() == null || request.docId().isBlank()) {
      return ApiResponse.fail(400, "docId 不能为空");
    }
    CanvasDocument doc = new CanvasDocument(
        null,
        request.docId(),
        userId,
        request.title(),
        request.payload(),
        request.thumbnailUrl(),
        request.isReversePrompt(),
        0,
        0
    );
    canvasRepository.save(doc);
    return ApiResponse.ok(java.util.Map.of("docId", request.docId()));
  }

  @DeleteMapping("/{docId}")
  public ApiResponse<Object> delete(
      @PathVariable String docId,
      @RequestHeader(value = "Authorization", required = false) String authorization) {
    Long userId = requireUserId(authorization);
    canvasRepository.deleteByDocIdAndUserId(docId, userId);
    return ApiResponse.ok(java.util.Map.of("docId", docId));
  }

  private Long requireUserId(String authorization) {
    String token = parseBearerToken(authorization);
    if (token == null || token.isBlank()) {
      throw new com.youmi.api.common.ApiException(401, "未登录");
    }
    return tokenService.getUserId(token).orElseThrow(() -> new com.youmi.api.common.ApiException(401, "登录已过期"));
  }

  private String parseBearerToken(String authorization) {
    if (authorization == null || !authorization.startsWith("Bearer ")) return "";
    return authorization.substring("Bearer ".length());
  }
}
