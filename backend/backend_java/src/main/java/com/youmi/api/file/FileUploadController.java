package com.youmi.api.file;

import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiException;
import com.youmi.api.common.ApiResponse;
import java.io.InputStream;
import java.net.URL;
import java.net.URLConnection;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping({"/api/file", "/api/v1/file"})
public class FileUploadController {
  private final OssStorageService ossStorageService;
  private final AdminAuthService adminAuthService;

  @Value("${youmi.file.upload-dir:uploads}")
  private String uploadDir;

  @Value("${youmi.file.public-prefix:/uploads}")
  private String publicPrefix;

  public FileUploadController(OssStorageService ossStorageService, AdminAuthService adminAuthService) {
    this.ossStorageService = ossStorageService;
    this.adminAuthService = adminAuthService;
  }

  @PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public ApiResponse<Map<String, Object>> upload(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestParam("file") MultipartFile file) throws Exception {
    Long userId = adminAuthService.requireUserId(authorization);
    if (file == null || file.isEmpty()) {
      throw new ApiException(400, "上传文件不能为空");
    }
    if (ossStorageService.isConfigured()) {
      String objectName = ossStorageService.uploadFile(
          file, ossStorageService.scopeUserDir(userId, LocalDate.now().toString()));
      String url = ossStorageService.getFileUrl(objectName);
      Map<String, Object> data = uploadResult(url, objectName, file.getOriginalFilename(), file.getSize(), file.getContentType());
      data.put("storage", "oss");
      return ApiResponse.ok(data);
    }
    Map<String, Object> data = saveLocalFile(userId, file);
    data.put("storage", "local");
    return ApiResponse.ok(data);
  }

  @PostMapping("/oss-sign")
  public ApiResponse<Map<String, Object>> createOssUploadSignature(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody Map<String, Object> request) {
    Long userId = adminAuthService.requireUserId(authorization);
    String fileName = stringValue(request, "fileName");
    String contentType = stringValue(request, "contentType");
    String dir = stringValue(request, "dir");
    Integer expireSeconds = numberValue(request == null ? null : request.get("expireSeconds"));
    return ApiResponse.ok(ossStorageService.createPutUploadSignature(
        fileName, contentType, ossStorageService.scopeUserDir(userId, dir), expireSeconds));
  }

  @PostMapping("/oss-cors")
  public ApiResponse<Map<String, Object>> configureOssCors(
      @RequestHeader(value = "Authorization", required = false) String authorization) {
    adminAuthService.requireAdmin(authorization);
    return ApiResponse.ok(ossStorageService.configureDirectUploadCors());
  }

  @PostMapping("/oss-sts")
  public ApiResponse<Map<String, Object>> createOssStsCredential(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody(required = false) Map<String, Object> request) {
    Long userId = adminAuthService.requireUserId(authorization);
    String dir = stringValue(request, "dir");
    Integer durationSeconds = numberValue(request == null ? null : request.get("durationSeconds"));
    return ApiResponse.ok(ossStorageService.createStsUploadCredential(
        ossStorageService.scopeUserDir(userId, dir), durationSeconds));
  }

  @PostMapping("/oss-multipart/init")
  public ApiResponse<Map<String, Object>> initOssMultipartUpload(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody Map<String, Object> request) {
    Long userId = adminAuthService.requireUserId(authorization);
    String fileName = stringValue(request, "fileName");
    String contentType = stringValue(request, "contentType");
    String dir = stringValue(request, "dir");
    return ApiResponse.ok(ossStorageService.initMultipartUpload(
        fileName, contentType, ossStorageService.scopeUserDir(userId, dir)));
  }

  @PostMapping("/oss-multipart/part-sign")
  public ApiResponse<Map<String, Object>> createOssMultipartPartSignature(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody Map<String, Object> request) {
    Long userId = adminAuthService.requireUserId(authorization);
    String objectName = stringValue(request, "objectName");
    objectName = ossStorageService.requireUserObject(userId, objectName);
    String uploadId = stringValue(request, "uploadId");
    Integer partNumber = numberValue(request == null ? null : request.get("partNumber"));
    Integer expireSeconds = numberValue(request == null ? null : request.get("expireSeconds"));
    return ApiResponse.ok(ossStorageService.createMultipartPartSignature(objectName, uploadId, partNumber, expireSeconds));
  }

  @PostMapping("/oss-multipart/complete")
  @SuppressWarnings("unchecked")
  public ApiResponse<Map<String, Object>> completeOssMultipartUpload(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody Map<String, Object> request) {
    Long userId = adminAuthService.requireUserId(authorization);
    String objectName = stringValue(request, "objectName");
    objectName = ossStorageService.requireUserObject(userId, objectName);
    String uploadId = stringValue(request, "uploadId");
    Object parts = request == null ? null : request.get("parts");
    return ApiResponse.ok(
        ossStorageService.completeMultipartUpload(objectName, uploadId, (List<Map<String, Object>>) parts));
  }

  @PostMapping("/oss-multipart/abort")
  public ApiResponse<Void> abortOssMultipartUpload(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody Map<String, Object> request) {
    Long userId = adminAuthService.requireUserId(authorization);
    String objectName = ossStorageService.requireUserObject(userId, stringValue(request, "objectName"));
    ossStorageService.abortMultipartUpload(objectName, stringValue(request, "uploadId"));
    return ApiResponse.ok(null);
  }

  @GetMapping("/url/{fileName}")
  public ApiResponse<String> getFileUrl(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable String fileName) {
    Long userId = adminAuthService.requireUserId(authorization);
    return ApiResponse.ok(ossStorageService.getFileUrl(
        ossStorageService.requireUserObject(userId, fileName)));
  }

  @GetMapping("/url")
  public ApiResponse<String> getFileUrlByQuery(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestParam String fileName) {
    Long userId = adminAuthService.requireUserId(authorization);
    return ApiResponse.ok(ossStorageService.getFileUrl(
        ossStorageService.requireUserObject(userId, fileName)));
  }

  @DeleteMapping("/{fileName}")
  public ApiResponse<Void> deleteFile(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable String fileName) {
    Long userId = adminAuthService.requireUserId(authorization);
    ossStorageService.deleteFile(ossStorageService.requireUserObject(userId, fileName));
    return ApiResponse.ok(null);
  }

  @PostMapping("/upload-from-url")
  public ApiResponse<Map<String, Object>> uploadFromUrl(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody Map<String, String> request) throws Exception {
    Long userId = adminAuthService.requireUserId(authorization);
    String fileUrl = request == null ? "" : request.get("url");
    if (fileUrl == null || fileUrl.isBlank()) {
      throw new ApiException(400, "url 不能为空");
    }
    URL url = new URL(fileUrl);
    URLConnection connection = url.openConnection();
    connection.setConnectTimeout(15000);
    connection.setReadTimeout(120000);
    connection.setRequestProperty("User-Agent", "Mozilla/5.0");

    String contentType = connection.getContentType();
    int contentLength = connection.getContentLength();
    if (contentLength > 50 * 1024 * 1024) {
      throw new ApiException(400, "文件不能超过 50MB");
    }

    String extension = extension(null, contentType);
    String requestedDir = request == null ? null : request.get("dir");
    String objectName = ossStorageService.scopeUserDir(userId, requestedDir)
        + "/ai-" + System.currentTimeMillis() + extension;
    if (ossStorageService.isConfigured()) {
      try (InputStream inputStream = connection.getInputStream()) {
        ossStorageService.uploadStream(inputStream, objectName, contentType);
      }
      String permanentUrl = ossStorageService.getFileUrl(objectName);
      Map<String, Object> data = uploadResult(permanentUrl, objectName, objectName, contentLength, contentType);
      data.put("storage", "oss");
      return ApiResponse.ok(data);
    }

    try (InputStream inputStream = connection.getInputStream()) {
      Map<String, Object> data = saveLocalStream(
          userId, inputStream, objectName, contentType, contentLength);
      data.put("storage", "local");
      return ApiResponse.ok(data);
    }
  }

  /**
   * 刷新签名 URL：前端传入过期或即将过期的 URL，后端反推 objectName 后重新签名返回新 URL。
   * 用于对话窗口缩略图等场景，防止签名过期导致图片裂图。
   */
  @PostMapping("/refresh-url")
  public ApiResponse<Map<String, Object>> refreshUrl(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody Map<String, String> request) {
    Long userId = adminAuthService.requireUserId(authorization);
    String url = request == null ? "" : request.get("url");
    if (url == null || url.isBlank()) {
      throw new ApiException(400, "url 不能为空");
    }
    if (!ossStorageService.isConfigured()) {
      throw new ApiException(400, "OSS 未配置");
    }
    String objectName = ossStorageService.objectNameFromFileUrl(url);
    if (objectName == null || objectName.isBlank()) {
      throw new ApiException(400, "无法从 URL 解析 objectName");
    }
    objectName = ossStorageService.requireUserObject(userId, objectName);
    // 重新签名，7 天有效期
    String freshUrl = ossStorageService.getPresignedFileUrl(objectName);
    Map<String, Object> data = new LinkedHashMap<>();
    data.put("url", freshUrl);
    data.put("objectName", objectName);
    return ApiResponse.ok(data);
  }

  private Map<String, Object> saveLocalFile(Long userId, MultipartFile file) throws Exception {
    return saveLocalStream(
        userId,
        file.getInputStream(),
        file.getOriginalFilename(),
        file.getContentType(),
        file.getSize());
  }

  private Map<String, Object> saveLocalStream(
      Long userId,
      InputStream inputStream,
      String originalName,
      String contentType,
      long size) throws Exception {
    String ext = extension(originalName, contentType);
    String day = LocalDate.now().toString();
    String filename = System.currentTimeMillis() + "-" + UUID.randomUUID().toString().replace("-", "") + ext;
    Path targetDir = Paths.get(uploadDir).toAbsolutePath().normalize()
        .resolve("users").resolve(String.valueOf(userId)).resolve(day);
    Files.createDirectories(targetDir);
    Path target = targetDir.resolve(filename).normalize();
    if (!target.startsWith(targetDir)) {
      throw new ApiException(400, "文件名不合法");
    }
    Files.copy(inputStream, target);

    String prefix = publicPrefix == null || publicPrefix.isBlank() ? "/uploads" : publicPrefix.trim();
    if (!prefix.startsWith("/")) prefix = "/" + prefix;
    if (prefix.endsWith("/")) prefix = prefix.substring(0, prefix.length() - 1);
    String scopedName = "users/" + userId + "/" + day + "/" + filename;
    String url = prefix + "/" + scopedName;
    return uploadResult(url, scopedName, originalName, size, contentType);
  }

  private Map<String, Object> uploadResult(
      String url,
      String fileName,
      String originalName,
      long size,
      String contentType) {
    Map<String, Object> data = new LinkedHashMap<>();
    data.put("url", url);
    data.put("fileUrl", url);
    data.put("fullUrl", url);
    data.put("fileName", fileName);
    data.put("name", fileName);
    data.put("originalName", originalName);
    data.put("size", size);
    data.put("contentType", contentType);
    return data;
  }

  private String extension(String filename, String contentType) {
    if (filename != null) {
      String safeName = filename.replace("\\", "/");
      int index = safeName.lastIndexOf('.');
      if (index >= 0 && index < safeName.length() - 1) {
        String ext = safeName.substring(index).toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9.]", "");
        if (!ext.isBlank() && ext.length() <= 12) return ext;
      }
    }
    String type = contentType == null ? "" : contentType.toLowerCase(Locale.ROOT);
    if (type.contains("png")) return ".png";
    if (type.contains("webp")) return ".webp";
    if (type.contains("gif")) return ".gif";
    if (type.contains("jpeg") || type.contains("jpg")) return ".jpg";
    return ".png";
  }

  private static String stringValue(Map<String, Object> request, String key) {
    if (request == null) return "";
    Object value = request.get(key);
    return value == null ? "" : String.valueOf(value);
  }

  private static Integer numberValue(Object value) {
    if (value == null || String.valueOf(value).isBlank()) return null;
    if (value instanceof Number number) return number.intValue();
    return Integer.parseInt(String.valueOf(value));
  }
}
