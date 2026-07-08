package com.youmi.api.file;

import java.util.ArrayList;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "youmi.oss")
public class OssStorageProperties {
  private boolean enabled = true;
  private String endpoint = "";
  private String accessKeyId = "";
  private String accessKeySecret = "";
  private String bucketName = "";
  private String customDomain = "";
  private String stsRegionId = "cn-shanghai";
  private String stsEndpoint = "sts.cn-shanghai.aliyuncs.com";
  private String stsRoleArn = "";
  private String stsRoleSessionName = "youmi-upload";
  private Integer stsDurationSeconds = 3600;
  private String stsPolicy = "";
  private boolean corsAutoConfigure = true;
  private List<String> corsAllowedOrigins = new ArrayList<>(
      List.of("http://127.0.0.1:5174", "http://localhost:5174", "http://101.133.149.214"));

  public boolean isEnabled() {
    return enabled;
  }

  public void setEnabled(boolean enabled) {
    this.enabled = enabled;
  }

  public String getEndpoint() {
    return endpoint;
  }

  public void setEndpoint(String endpoint) {
    this.endpoint = endpoint;
  }

  public String getAccessKeyId() {
    return accessKeyId;
  }

  public void setAccessKeyId(String accessKeyId) {
    this.accessKeyId = accessKeyId;
  }

  public String getAccessKeySecret() {
    return accessKeySecret;
  }

  public void setAccessKeySecret(String accessKeySecret) {
    this.accessKeySecret = accessKeySecret;
  }

  public String getBucketName() {
    return bucketName;
  }

  public void setBucketName(String bucketName) {
    this.bucketName = bucketName;
  }

  public String getCustomDomain() {
    return customDomain;
  }

  public void setCustomDomain(String customDomain) {
    this.customDomain = customDomain;
  }

  public String getStsRegionId() {
    return stsRegionId;
  }

  public void setStsRegionId(String stsRegionId) {
    this.stsRegionId = stsRegionId;
  }

  public String getStsEndpoint() {
    return stsEndpoint;
  }

  public void setStsEndpoint(String stsEndpoint) {
    this.stsEndpoint = stsEndpoint;
  }

  public String getStsRoleArn() {
    return stsRoleArn;
  }

  public void setStsRoleArn(String stsRoleArn) {
    this.stsRoleArn = stsRoleArn;
  }

  public String getStsRoleSessionName() {
    return stsRoleSessionName;
  }

  public void setStsRoleSessionName(String stsRoleSessionName) {
    this.stsRoleSessionName = stsRoleSessionName;
  }

  public Integer getStsDurationSeconds() {
    return stsDurationSeconds;
  }

  public void setStsDurationSeconds(Integer stsDurationSeconds) {
    this.stsDurationSeconds = stsDurationSeconds;
  }

  public String getStsPolicy() {
    return stsPolicy;
  }

  public void setStsPolicy(String stsPolicy) {
    this.stsPolicy = stsPolicy;
  }

  public boolean isCorsAutoConfigure() {
    return corsAutoConfigure;
  }

  public void setCorsAutoConfigure(boolean corsAutoConfigure) {
    this.corsAutoConfigure = corsAutoConfigure;
  }

  public List<String> getCorsAllowedOrigins() {
    return corsAllowedOrigins;
  }

  public void setCorsAllowedOrigins(List<String> corsAllowedOrigins) {
    this.corsAllowedOrigins = corsAllowedOrigins;
  }

  public boolean isConfigured() {
    return enabled
        && !isBlank(endpoint)
        && !isBlank(accessKeyId)
        && !isBlank(accessKeySecret)
        && !isBlank(bucketName);
  }

  public String resolveEndpoint() {
    requireConfigured("oss.endpoint", endpoint);
    return endpoint.startsWith("http") ? endpoint : "https://" + endpoint;
  }

  public String fileUrlEndpoint() {
    if (!isBlank(customDomain)) {
      return customDomain.startsWith("http") ? customDomain : "https://" + customDomain;
    }
    return resolveEndpoint();
  }

  public void requireConfigured() {
    requireConfigured("oss.endpoint", endpoint);
    requireConfigured("oss.access-key-id", accessKeyId);
    requireConfigured("oss.access-key-secret", accessKeySecret);
    requireConfigured("oss.bucket-name", bucketName);
  }

  private static void requireConfigured(String name, String value) {
    if (isBlank(value)) throw new IllegalStateException(name + " must be configured");
  }

  private static boolean isBlank(String value) {
    return value == null || value.isBlank();
  }
}
