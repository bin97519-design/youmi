package com.youmi.api.admin;

import com.youmi.api.canvas.CanvasDocument;
import com.youmi.api.canvas.CanvasDtos;
import com.youmi.api.canvas.CanvasRepository;
import com.youmi.api.common.ApiResponse;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 管理员画布通道：提供跨用户的全局画布访问能力。
 *
 * <p>所有端点第一句均调用 {@link AdminAuthService#requireAdmin(String)}，
 * 非 ADMIN 角色会直接抛出 403，因此全局仓储方法（findAll / findByDocId / deleteByDocId）
 * 永远在管理员校验之后才会被调用，普通用户数据隔离不受影响。
 */
@RestController
@RequestMapping("/api/admin/canvas")
public class AdminCanvasController {
  private final CanvasRepository canvasRepository;
  private final AdminAuthService adminAuthService;

  public AdminCanvasController(CanvasRepository canvasRepository, AdminAuthService adminAuthService) {
    this.canvasRepository = canvasRepository;
    this.adminAuthService = adminAuthService;
  }

  /**
   * 管理员全局画布列表。
   * 可选 userId 过滤：传入时只查该用户，否则返回全部用户画布。
   */
  @GetMapping("/list")
  public ApiResponse<List<CanvasDtos.AdminCanvasSummary>> list(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestParam(value = "userId", required = false) Long userId) {
    adminAuthService.requireAdmin(authorization);
    List<CanvasDocument> docs = (userId != null)
        ? canvasRepository.findByUserId(userId)
        : canvasRepository.findAll();
    List<CanvasDtos.AdminCanvasSummary> summaries = docs.stream()
        .map(d -> new CanvasDtos.AdminCanvasSummary(
            d.userId(), d.docId(), d.title(), d.thumbnailUrl(), d.isReversePrompt(), d.updatedAt()))
        .toList();
    return ApiResponse.ok(summaries);
  }

  /**
   * 管理员按 docId 查看任意用户的画布详情。
   */
  @GetMapping("/{docId}")
  public ApiResponse<CanvasDtos.AdminCanvasDetail> get(
      @PathVariable String docId,
      @RequestHeader(value = "Authorization", required = false) String authorization) {
    adminAuthService.requireAdmin(authorization);
    Optional<CanvasDocument> doc = canvasRepository.findByDocId(docId);
    if (doc.isEmpty()) {
      return ApiResponse.fail(404, "画布不存在");
    }
    CanvasDocument d = doc.get();
    return ApiResponse.ok(new CanvasDtos.AdminCanvasDetail(
        d.userId(), d.docId(), d.title(), d.payload(), d.thumbnailUrl(),
        d.isReversePrompt(), d.createdAt(), d.updatedAt()));
  }

  /**
   * 管理员按 docId 删除任意用户的画布。
   */
  @DeleteMapping("/{docId}")
  public ApiResponse<Object> delete(
      @PathVariable String docId,
      @RequestHeader(value = "Authorization", required = false) String authorization) {
    adminAuthService.requireAdmin(authorization);
    canvasRepository.deleteByDocId(docId);
    return ApiResponse.ok(Map.of("docId", docId));
  }
}
