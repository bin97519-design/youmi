package com.youmi.api.admin;

import com.youmi.api.common.ApiResponse;
import com.youmi.api.file.OssStorageProperties;
import com.youmi.api.file.OssStorageService;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/admin/oss")
public class AdminOssController {
  private final AdminAuthService adminAuthService;
  private final OssStorageProperties properties;
  private final OssStorageService ossStorageService;

  public AdminOssController(
      AdminAuthService adminAuthService,
      OssStorageProperties properties,
      OssStorageService ossStorageService) {
    this.adminAuthService = adminAuthService;
    this.properties = properties;
    this.ossStorageService = ossStorageService;
  }

  @GetMapping("/status")
  public ApiResponse<Map<String, Object>> status(
      @RequestHeader(value = "Authorization", required = false) String authorization) {
    adminAuthService.requireAdmin(authorization);
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("configured", properties.isConfigured());
    result.put("bucket", properties.getBucketName());
    result.put("endpoint", properties.getEndpoint());
    result.put("customDomain", properties.getCustomDomain());
    return ApiResponse.ok(result);
  }

  @GetMapping("/objects")
  public ApiResponse<Map<String, Object>> list(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestParam(value = "prefix", required = false) String prefix,
      @RequestParam(value = "marker", required = false) String marker,
      @RequestParam(value = "limit", required = false) Integer limit) {
    adminAuthService.requireAdmin(authorization);
    return ApiResponse.ok(ossStorageService.listAdminObjects(prefix, marker, limit));
  }

  @PostMapping(value = "/objects", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public ApiResponse<Map<String, Object>> upload(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestParam("file") MultipartFile file,
      @RequestParam("key") String key) {
    adminAuthService.requireAdmin(authorization);
    return ApiResponse.ok(ossStorageService.uploadAdminObject(file, key));
  }

  @DeleteMapping("/objects")
  public ApiResponse<Map<String, Object>> delete(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestParam("key") String key) {
    adminAuthService.requireAdmin(authorization);
    String objectName = ossStorageService.normalizeAdminObjectName(key);
    ossStorageService.deleteFile(objectName);
    return ApiResponse.ok(Map.of("key", objectName));
  }

  @PostMapping("/objects/date-preview")
  public ApiResponse<Map<String, Object>> previewDateDeletion(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody DateDeletionRequest request) {
    adminAuthService.requireAdmin(authorization);
    return ApiResponse.ok(ossStorageService.previewAdminDateDeletion(
        request.prefix(), request.fromDate(), request.toDate()));
  }

  @PostMapping("/objects/delete-by-date")
  public ApiResponse<Map<String, Object>> deleteByDate(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody DateDeletionRequest request) {
    adminAuthService.requireAdmin(authorization);
    return ApiResponse.ok(ossStorageService.deleteAdminObjectsByDate(
        request.prefix(), request.fromDate(), request.toDate()));
  }

  public record DateDeletionRequest(String prefix, String fromDate, String toDate) {}
}
