package com.youmi.api.file;

import com.aliyun.oss.HttpMethod;
import com.aliyun.oss.OSS;
import com.aliyun.oss.OSSClientBuilder;
import com.aliyun.oss.model.AbortMultipartUploadRequest;
import com.aliyun.oss.model.CompleteMultipartUploadRequest;
import com.aliyun.oss.model.GeneratePresignedUrlRequest;
import com.aliyun.oss.model.InitiateMultipartUploadRequest;
import com.aliyun.oss.model.InitiateMultipartUploadResult;
import com.aliyun.oss.model.OSSObject;
import com.aliyun.oss.model.ObjectMetadata;
import com.aliyun.oss.model.PartETag;
import com.aliyun.oss.model.SetBucketCORSRequest;
import com.aliyun.oss.model.SetBucketCORSRequest.CORSRule;
import com.aliyuncs.DefaultAcsClient;
import com.aliyuncs.IAcsClient;
import com.aliyuncs.http.MethodType;
import com.aliyuncs.http.ProtocolType;
import com.aliyuncs.profile.DefaultProfile;
import com.aliyuncs.sts.model.v20150401.AssumeRoleRequest;
import com.aliyuncs.sts.model.v20150401.AssumeRoleResponse;
import com.youmi.api.common.ApiException;
import jakarta.annotation.PreDestroy;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.net.URLConnection;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Service
public class OssStorageService {
  private static final Pattern SAFE_DIR = Pattern.compile("^[0-9A-Za-z_./-]+$");

  private final OssStorageProperties properties;
  private volatile OSS client;

  public OssStorageService(OssStorageProperties properties) {
    this.properties = properties;
  }

  public boolean isConfigured() {
    return properties.isConfigured();
  }

  @PreDestroy
  public void shutdown() {
    OSS current = client;
    if (current != null) {
      current.shutdown();
    }
  }

  public String uploadFile(MultipartFile file) {
    try {
      String objectName = buildUploadObjectName(file.getOriginalFilename(), LocalDate.now().toString());
      ObjectMetadata metadata = new ObjectMetadata();
      metadata.setContentType(file.getContentType() == null ? "application/octet-stream" : file.getContentType());
      metadata.setContentLength(file.getSize());
      OSS oss = ossClient();
      oss.putObject(properties.getBucketName(), objectName, file.getInputStream(), metadata);
      return objectName;
    } catch (Exception exception) {
      throw new ApiException(502, "OSS file upload failed: " + exception.getMessage());
    }
  }

  public String uploadStream(InputStream inputStream, String objectName, String contentType) {
    try {
      // 先把输入流完整读入内存，再包装为 ByteArrayInputStream 上传。
      // 避免 OSS SDK 上传重试时 "Failed to reset the request input stream"
      // （普通 InputStream 不支持 reset，导致部分上传静默失败）。ByteArrayInputStream 支持 reset。
      byte[] bytes = toByteArray(inputStream);
      ObjectMetadata metadata = new ObjectMetadata();
      metadata.setContentLength(bytes.length);
      metadata.setContentType(contentType == null || contentType.isBlank() ? "application/octet-stream" : contentType);
      OSS oss = ossClient();
      oss.putObject(properties.getBucketName(), objectName, new ByteArrayInputStream(bytes), metadata);
      return objectName;
    } catch (Exception exception) {
      throw new ApiException(502, "OSS stream upload failed: " + exception.getMessage());
    }
  }

  /** 将输入流完整读入 byte[]，避免流式上传时无法 reset 导致的静默失败 */
  private static byte[] toByteArray(InputStream inputStream) throws Exception {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    byte[] buffer = new byte[8192];
    int bytesRead;
    while ((bytesRead = inputStream.read(buffer)) != -1) {
      out.write(buffer, 0, bytesRead);
    }
    return out.toByteArray();
  }

  public String uploadUrlToObject(String sourceUrl, String objectName) {
    try {
      URL url = new URL(sourceUrl);
      URLConnection connection = url.openConnection();
      connection.setConnectTimeout(15000);
      connection.setReadTimeout(120000);
      connection.setRequestProperty("User-Agent", "Mozilla/5.0");
      String contentType = connection.getContentType();
      try (InputStream inputStream = connection.getInputStream()) {
        return uploadStream(inputStream, objectName, contentType);
      }
    } catch (Exception exception) {
      throw new ApiException(502, "Remote file upload to OSS failed: " + exception.getMessage());
    }
  }

  public String getFileUrl(String objectName) {
    return buildPublicFileUrl(objectName);
  }

  public String getPresignedFileUrl(String objectName) {
    try {
      OSS oss = ossClient();
      Date expiration = new Date(System.currentTimeMillis() + 7 * 24 * 60 * 60 * 1000L);
      return oss.generatePresignedUrl(properties.getBucketName(), objectName, expiration).toString();
    } catch (Exception exception) {
      throw new ApiException(502, "Get OSS file URL failed: " + exception.getMessage());
    }
  }

  public Map<String, Object> createPutUploadSignature(
      String originalFileName,
      String contentType,
      String dir,
      Integer expireSeconds) {
    try {
      OSS oss = ossClient();
      int seconds = expireSeconds == null ? 300 : Math.max(60, Math.min(expireSeconds, 1800));
      String objectName = buildUploadObjectName(originalFileName, dir);
      Date expiration = new Date(System.currentTimeMillis() + seconds * 1000L);
      String safeContentType =
          contentType == null || contentType.isBlank() ? "application/octet-stream" : contentType;
      GeneratePresignedUrlRequest request =
          new GeneratePresignedUrlRequest(properties.getBucketName(), objectName, HttpMethod.PUT);
      request.setExpiration(expiration);
      request.setContentType(safeContentType);
      URL uploadUrl = oss.generatePresignedUrl(request);

      Map<String, Object> result = new LinkedHashMap<>();
      result.put("method", "PUT");
      result.put("uploadUrl", uploadUrl.toString());
      result.put("objectName", objectName);
      result.put("url", getFileUrl(objectName));
      result.put("expireSeconds", seconds);
      Map<String, String> headers = new LinkedHashMap<>();
      headers.put("Content-Type", safeContentType);
      result.put("headers", headers);
      return result;
    } catch (Exception exception) {
      throw new ApiException(502, "Create OSS direct upload signature failed: " + exception.getMessage());
    }
  }

  public Map<String, Object> configureDirectUploadCors() {
    try {
      properties.requireConfigured();
      OSS oss = ossClient();
      List<CORSRule> rules = new ArrayList<>();
      try {
        rules.addAll(oss.getBucketCORSRules(properties.getBucketName()));
      } catch (Exception ignored) {
        // Buckets without CORS rules return an OSS error; start from an empty rule set.
      }

      CORSRule uploadRule = new CORSRule();
      for (String origin : properties.getCorsAllowedOrigins()) {
        if (!isBlank(origin)) {
          uploadRule.addAllowdOrigin(origin.trim());
        }
      }
      uploadRule.addAllowedMethod("PUT");
      uploadRule.addAllowedMethod("POST");
      uploadRule.addAllowedMethod("GET");
      uploadRule.addAllowedMethod("HEAD");
      uploadRule.addAllowedHeader("*");
      uploadRule.addExposeHeader("ETag");
      uploadRule.addExposeHeader("x-oss-request-id");
      uploadRule.setMaxAgeSeconds(3600);

      if (!uploadRule.getAllowedOrigins().isEmpty()) {
        rules.removeIf(rule -> sameOrigins(rule.getAllowedOrigins(), uploadRule.getAllowedOrigins()));
        rules.add(uploadRule);
      }

      SetBucketCORSRequest request = new SetBucketCORSRequest(properties.getBucketName());
      request.setCorsRules(rules);
      oss.setBucketCORS(request);

      Map<String, Object> result = new LinkedHashMap<>();
      result.put("bucket", properties.getBucketName());
      result.put("allowedOrigins", uploadRule.getAllowedOrigins());
      result.put("ruleCount", rules.size());
      return result;
    } catch (Exception exception) {
      throw new ApiException(502, "Configure OSS CORS failed: " + exception.getMessage());
    }
  }

  public Map<String, Object> createStsUploadCredential(String dir, Integer durationSeconds) {
    try {
      properties.requireConfigured();
      if (isBlank(properties.getStsRoleArn())) {
        throw new IllegalStateException("oss.sts-role-arn must be configured");
      }
      String safeDir = normalizeDir(dir);
      long seconds = durationSeconds == null
          ? safeDurationSeconds()
          : Math.max(900L, Math.min(durationSeconds.longValue(), 43200L));
      String regionId = blankToDefault(properties.getStsRegionId(), "cn-shanghai");
      String stsEndpoint = blankToDefault(properties.getStsEndpoint(), "sts.cn-shanghai.aliyuncs.com");
      DefaultProfile.addEndpoint(regionId, "Sts", stsEndpoint);
      DefaultProfile profile =
          DefaultProfile.getProfile(regionId, properties.getAccessKeyId(), properties.getAccessKeySecret());
      IAcsClient client = new DefaultAcsClient(profile);

      AssumeRoleRequest request = new AssumeRoleRequest();
      request.setSysProtocol(ProtocolType.HTTPS);
      request.setSysMethod(MethodType.POST);
      request.setRoleArn(properties.getStsRoleArn());
      request.setRoleSessionName(safeRoleSessionName());
      request.setDurationSeconds(seconds);
      request.setPolicy(resolveStsPolicy(safeDir));

      AssumeRoleResponse response = client.getAcsResponse(request);
      AssumeRoleResponse.Credentials credentials = response.getCredentials();
      Map<String, Object> result = new LinkedHashMap<>();
      result.put("accessKeyId", credentials.getAccessKeyId());
      result.put("accessKeySecret", credentials.getAccessKeySecret());
      result.put("securityToken", credentials.getSecurityToken());
      result.put("expiration", credentials.getExpiration());
      result.put("bucket", properties.getBucketName());
      result.put("region", regionId);
      result.put("endpoint", properties.resolveEndpoint());
      result.put("dir", safeDir);
      result.put("policy", request.getPolicy());
      return result;
    } catch (Exception exception) {
      throw new ApiException(502, "Create OSS STS credential failed: " + exception.getMessage());
    }
  }

  public Map<String, Object> initMultipartUpload(String originalFileName, String contentType, String dir) {
    try {
      OSS oss = ossClient();
      String objectName = buildUploadObjectName(originalFileName, dir);
      ObjectMetadata metadata = new ObjectMetadata();
      metadata.setContentType(contentType == null || contentType.isBlank() ? "application/octet-stream" : contentType);
      InitiateMultipartUploadRequest request =
          new InitiateMultipartUploadRequest(properties.getBucketName(), objectName, metadata);
      InitiateMultipartUploadResult init = oss.initiateMultipartUpload(request);
      Map<String, Object> result = new LinkedHashMap<>();
      result.put("uploadId", init.getUploadId());
      result.put("objectName", objectName);
      result.put("url", getFileUrl(objectName));
      result.put("bucket", properties.getBucketName());
      return result;
    } catch (Exception exception) {
      throw new ApiException(502, "Init OSS multipart upload failed: " + exception.getMessage());
    }
  }

  public Map<String, Object> createMultipartPartSignature(
      String objectName,
      String uploadId,
      Integer partNumber,
      Integer expireSeconds) {
    try {
      OSS oss = ossClient();
      if (isBlank(objectName) || isBlank(uploadId)) {
        throw new IllegalArgumentException("objectName and uploadId are required");
      }
      int safePartNumber = partNumber == null ? 0 : partNumber;
      if (safePartNumber < 1 || safePartNumber > 10000) {
        throw new IllegalArgumentException("partNumber must be 1-10000");
      }
      int seconds = expireSeconds == null ? 900 : Math.max(60, Math.min(expireSeconds, 3600));
      Date expiration = new Date(System.currentTimeMillis() + seconds * 1000L);
      GeneratePresignedUrlRequest request =
          new GeneratePresignedUrlRequest(properties.getBucketName(), objectName, HttpMethod.PUT);
      request.setExpiration(expiration);
      request.addQueryParameter("partNumber", String.valueOf(safePartNumber));
      request.addQueryParameter("uploadId", uploadId);
      URL uploadUrl = oss.generatePresignedUrl(request);
      Map<String, Object> result = new LinkedHashMap<>();
      result.put("method", "PUT");
      result.put("uploadUrl", uploadUrl.toString());
      result.put("partNumber", safePartNumber);
      result.put("expireSeconds", seconds);
      return result;
    } catch (Exception exception) {
      throw new ApiException(502, "Create OSS multipart part signature failed: " + exception.getMessage());
    }
  }

  public Map<String, Object> completeMultipartUpload(
      String objectName,
      String uploadId,
      List<Map<String, Object>> parts) {
    try {
      OSS oss = ossClient();
      if (isBlank(objectName) || isBlank(uploadId)) {
        throw new IllegalArgumentException("objectName and uploadId are required");
      }
      if (parts == null || parts.isEmpty()) {
        throw new IllegalArgumentException("parts are required");
      }
      List<PartETag> etags = parts.stream()
          .map(item -> new PartETag(intValue(item.get("partNumber")), stringValue(item.get("eTag"))))
          .sorted(Comparator.comparingInt(PartETag::getPartNumber))
          .collect(java.util.stream.Collectors.toCollection(ArrayList::new));
      CompleteMultipartUploadRequest request =
          new CompleteMultipartUploadRequest(properties.getBucketName(), objectName, uploadId, etags);
      oss.completeMultipartUpload(request);
      Map<String, Object> result = new LinkedHashMap<>();
      result.put("objectName", objectName);
      result.put("url", getFileUrl(objectName));
      return result;
    } catch (Exception exception) {
      throw new ApiException(502, "Complete OSS multipart upload failed: " + exception.getMessage());
    }
  }

  public void abortMultipartUpload(String objectName, String uploadId) {
    if (isBlank(objectName) || isBlank(uploadId)) return;
    try {
      OSS oss = ossClient();
      oss.abortMultipartUpload(new AbortMultipartUploadRequest(properties.getBucketName(), objectName, uploadId));
    } catch (Exception exception) {
      throw new ApiException(502, "Abort OSS multipart upload failed: " + exception.getMessage());
    }
  }

  public InputStream openObjectStream(String objectName) {
    try {
      OSSObject object = ossClient().getObject(properties.getBucketName(), objectName);
      return object.getObjectContent();
    } catch (Exception exception) {
      throw new ApiException(502, "Open OSS object stream failed: " + exception.getMessage());
    }
  }

  public String objectNameFromFileUrl(String fileUrl) {
    if (isBlank(fileUrl)) return null;
    try {
      String path = new URL(fileUrl).getPath();
      String prefix = "/" + properties.getBucketName() + "/";
      int index = path.indexOf(prefix);
      if (index >= 0) return path.substring(index + prefix.length());
      return path.startsWith("/") ? path.substring(1) : path;
    } catch (Exception exception) {
      return null;
    }
  }

  public void deleteFile(String objectName) {
    try {
      OSS oss = ossClient();
      oss.deleteObject(properties.getBucketName(), objectName);
    } catch (Exception exception) {
      throw new ApiException(502, "Delete OSS file failed: " + exception.getMessage());
    }
  }

  private OSS ossClient() {
    properties.requireConfigured();
    OSS current = client;
    if (current == null) {
      synchronized (this) {
        current = client;
        if (current == null) {
          current = new OSSClientBuilder()
              .build(properties.resolveEndpoint(), properties.getAccessKeyId(), properties.getAccessKeySecret());
          client = current;
        }
      }
    }
    return current;
  }

  private String buildPublicFileUrl(String objectName) {
    String endpoint = properties.fileUrlEndpoint();
    if (!isBlank(properties.getCustomDomain())) {
      return trimEnd(endpoint, "/") + "/" + objectName;
    }
    String host = endpoint.replaceFirst("^https?://", "");
    return "https://" + properties.getBucketName() + "." + host + "/" + objectName;
  }

  private String buildUploadObjectName(String originalFileName, String dir) {
    String extension = extensionOf(originalFileName);
    String safeDir = normalizeDir(dir);
    return safeDir + "/" + UUID.randomUUID().toString().replace("-", "") + extension;
  }

  private String normalizeDir(String dir) {
    String value = isBlank(dir) ? LocalDate.now().toString() : dir.trim();
    value = value.replace("\\", "/");
    while (value.startsWith("/")) value = value.substring(1);
    while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
    if (value.isBlank()) value = LocalDate.now().toString();
    if (value.contains("..") || !SAFE_DIR.matcher(value).matches()) {
      throw new IllegalArgumentException("Invalid OSS upload dir");
    }
    return value;
  }

  private String extensionOf(String originalFileName) {
    if (isBlank(originalFileName)) return "";
    String name = originalFileName.trim();
    int slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
    if (slash >= 0) name = name.substring(slash + 1);
    int dot = name.lastIndexOf('.');
    if (dot < 0 || dot == name.length() - 1) return "";
    String extension = name.substring(dot).toLowerCase();
    if (extension.length() > 16 || !extension.matches("\\.[0-9a-z]+")) return "";
    return extension;
  }

  private int intValue(Object value) {
    if (value instanceof Number number) return number.intValue();
    return Integer.parseInt(String.valueOf(value));
  }

  private String stringValue(Object value) {
    if (value == null || String.valueOf(value).isBlank()) {
      throw new IllegalArgumentException("part eTag is required");
    }
    String text = String.valueOf(value);
    if (text.startsWith("\"") && text.endsWith("\"") && text.length() > 1) {
      return text.substring(1, text.length() - 1);
    }
    return text;
  }

  private long safeDurationSeconds() {
    Integer seconds = properties.getStsDurationSeconds();
    return seconds == null ? 3600L : seconds.longValue();
  }

  private String safeRoleSessionName() {
    String value = properties.getStsRoleSessionName();
    if (isBlank(value)) return "youmi-upload";
    return value.replaceAll("[^0-9A-Za-z.@_-]", "-");
  }

  private String resolveStsPolicy(String safeDir) {
    if (!isBlank(properties.getStsPolicy())) return properties.getStsPolicy();
    String resource = "acs:oss:*:*:" + properties.getBucketName() + "/" + safeDir + "/*";
    return """
        {
          "Version": "1",
          "Statement": [
            {
              "Effect": "Allow",
              "Action": [
                "oss:PutObject",
                "oss:GetObject",
                "oss:AbortMultipartUpload",
                "oss:ListParts"
              ],
              "Resource": [
                "%s"
              ]
            }
          ]
        }
        """.formatted(resource).replace("\n", "").replace("  ", "");
  }

  private static String blankToDefault(String value, String defaultValue) {
    return isBlank(value) ? defaultValue : value.trim();
  }

  private static String trimEnd(String value, String suffix) {
    String result = value;
    while (result.endsWith(suffix)) result = result.substring(0, result.length() - suffix.length());
    return result;
  }

  private static boolean sameOrigins(List<String> left, List<String> right) {
    if (left == null || right == null || left.size() != right.size()) return false;
    return left.stream().map(String::trim).sorted().toList()
        .equals(right.stream().map(String::trim).sorted().toList());
  }

  private static boolean isBlank(String value) {
    return value == null || value.isBlank();
  }
}


