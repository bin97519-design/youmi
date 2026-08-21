package com.youmi.api.selection;

import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiResponse;
import java.util.List;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/selection-pool")
@CrossOrigin(originPatterns = {"chrome-extension://*", "http://localhost:*", "http://127.0.0.1:*"})
public class SelectionPoolController {
  private final AdminAuthService authService;
  private final SelectionPoolService service;

  public SelectionPoolController(AdminAuthService authService, SelectionPoolService service) {
    this.authService = authService;
    this.service = service;
  }

  @PostMapping("/products")
  public ApiResponse<SelectionPoolDtos.ProductView> upsert(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody SelectionPoolDtos.ProductUpsertRequest request) {
    return ApiResponse.ok("商品已进入选品库", service.upsert(authService.requireUserId(authorization), request));
  }

  @PostMapping("/products/bulk")
  public ApiResponse<SelectionPoolDtos.BulkUpsertResult> bulkUpsert(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody SelectionPoolDtos.BulkUpsertRequest request) {
    return ApiResponse.ok("批量入库完成", service.bulkUpsert(authService.requireUserId(authorization), request));
  }

  @GetMapping("/products")
  public ApiResponse<SelectionPoolDtos.ProductPage> list(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestParam(required = false) String keyword,
      @RequestParam(required = false) String platform,
      @RequestParam(required = false) String collectStatus,
      @RequestParam(required = false) String publishStatus,
      @RequestParam(required = false) Long tagId,
      @RequestParam(required = false) Boolean hasAiEdit,
      @RequestParam(defaultValue = "1") Integer page,
      @RequestParam(defaultValue = "20") Integer pageSize) {
    return ApiResponse.ok(service.list(
        authService.requireUserId(authorization), keyword, platform, collectStatus,
        publishStatus, tagId, hasAiEdit, page, pageSize));
  }

  @GetMapping("/products/{id}")
  public ApiResponse<SelectionPoolDtos.ProductView> get(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable Long id) {
    return ApiResponse.ok(service.get(authService.requireUserId(authorization), id));
  }

  @PutMapping("/products/{id}")
  public ApiResponse<SelectionPoolDtos.ProductView> update(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable Long id,
      @RequestBody SelectionPoolDtos.ProductPatchRequest request) {
    return ApiResponse.ok("商品已更新", service.update(authService.requireUserId(authorization), id, request));
  }

  @PostMapping("/products/delete")
  public ApiResponse<Integer> delete(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody SelectionPoolDtos.BatchDeleteRequest request) {
    return ApiResponse.ok("商品已移入回收站", service.delete(authService.requireUserId(authorization), request));
  }

  @GetMapping("/tags")
  public ApiResponse<List<SelectionPoolDtos.TagView>> tags(
      @RequestHeader(value = "Authorization", required = false) String authorization) {
    return ApiResponse.ok(service.listTags(authService.requireUserId(authorization)));
  }

  @PostMapping("/tags")
  public ApiResponse<SelectionPoolDtos.TagView> createTag(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody SelectionPoolDtos.TagSaveRequest request) {
    return ApiResponse.ok("标签已创建", service.createTag(authService.requireUserId(authorization), request));
  }

  @PutMapping("/tags/{id}")
  public ApiResponse<SelectionPoolDtos.TagView> updateTag(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable Long id,
      @RequestBody SelectionPoolDtos.TagSaveRequest request) {
    return ApiResponse.ok("标签已更新", service.updateTag(authService.requireUserId(authorization), id, request));
  }

  @DeleteMapping("/tags/{id}")
  public ApiResponse<Void> deleteTag(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable Long id) {
    service.deleteTag(authService.requireUserId(authorization), id);
    return ApiResponse.ok("标签已删除", null);
  }

  @PutMapping("/products/tags")
  public ApiResponse<Void> assignTags(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody SelectionPoolDtos.TagAssignRequest request) {
    service.assignTags(authService.requireUserId(authorization), request);
    return ApiResponse.ok("商品标签已更新", null);
  }

  @PostMapping("/migration-tasks")
  public ApiResponse<SelectionPoolDtos.MigrationTaskView> createMigrationTask(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody SelectionPoolDtos.MigrationCreateRequest request) {
    return ApiResponse.ok("搬家任务已排队", service.createMigrationTask(authService.requireUserId(authorization), request));
  }

  @GetMapping("/migration-tasks")
  public ApiResponse<List<SelectionPoolDtos.MigrationTaskView>> listMigrationTasks(
      @RequestHeader(value = "Authorization", required = false) String authorization) {
    return ApiResponse.ok(service.listMigrationTasks(authService.requireUserId(authorization)));
  }

  @GetMapping("/migration-tasks/{taskId}")
  public ApiResponse<SelectionPoolDtos.MigrationTaskView> getMigrationTask(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable String taskId) {
    return ApiResponse.ok(service.getMigrationTask(authService.requireUserId(authorization), taskId));
  }

  @GetMapping("/migration-tasks/{taskId}/handoff")
  public ApiResponse<SelectionPoolDtos.MigrationHandoffView> getMigrationHandoff(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable String taskId) {
    return ApiResponse.ok(service.getMigrationHandoff(
        authService.requireUserId(authorization), taskId));
  }

  @PostMapping("/migration-tasks/{taskId}/claim")
  public ApiResponse<SelectionPoolDtos.MigrationHandoffView> claimMigrationTask(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable String taskId) {
    return ApiResponse.ok("发布浏览器已接管任务", service.claimMigrationTask(
        authService.requireUserId(authorization), taskId));
  }

  @PostMapping("/migration-tasks/{taskId}/items/result")
  public ApiResponse<SelectionPoolDtos.MigrationTaskView> updateMigrationItemResult(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable String taskId,
      @RequestBody SelectionPoolDtos.MigrationItemResultRequest request) {
    return ApiResponse.ok("搬家结果已记录", service.updateMigrationItemResult(
        authService.requireUserId(authorization), taskId, request));
  }
}

