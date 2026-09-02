package com.youmi.api.video;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "youmi.video")
public class VideoGenerationProperties {
  private String baseUrl = "https://new.thqllm.com/v1";
  private String apiKey = "";
  private int timeoutSeconds = 120;
  private int downloadTimeoutSeconds = 600;
  private boolean persistGeneratedVideos = true;

  public String getBaseUrl() {
    return baseUrl;
  }

  public void setBaseUrl(String baseUrl) {
    this.baseUrl = baseUrl;
  }

  public String getApiKey() {
    return apiKey;
  }

  public void setApiKey(String apiKey) {
    this.apiKey = apiKey;
  }

  public int getTimeoutSeconds() {
    return timeoutSeconds;
  }

  public void setTimeoutSeconds(int timeoutSeconds) {
    this.timeoutSeconds = timeoutSeconds;
  }

  public int getDownloadTimeoutSeconds() {
    return downloadTimeoutSeconds;
  }

  public void setDownloadTimeoutSeconds(int downloadTimeoutSeconds) {
    this.downloadTimeoutSeconds = downloadTimeoutSeconds;
  }

  public boolean isPersistGeneratedVideos() {
    return persistGeneratedVideos;
  }

  public void setPersistGeneratedVideos(boolean persistGeneratedVideos) {
    this.persistGeneratedVideos = persistGeneratedVideos;
  }

  public boolean isConfigured() {
    return apiKey != null && !apiKey.isBlank();
  }

  public String normalizedBaseUrl() {
    String value = baseUrl == null ? "" : baseUrl.trim();
    while (value.endsWith("/")) {
      value = value.substring(0, value.length() - 1);
    }
    return value.isBlank() ? "https://new.thqllm.com/v1" : value;
  }
}
