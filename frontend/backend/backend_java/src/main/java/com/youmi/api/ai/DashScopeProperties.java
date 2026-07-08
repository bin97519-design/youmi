package com.youmi.api.ai;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "youmi.dashscope")
public class DashScopeProperties {
  private String baseUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1";
  private String chatPath = "/chat/completions";
  private String apiKey = "";
  private String model = "qwen3.7-plus";
  private int maxTokens = 4000;
  private double temperature = 0.0;
  private int timeoutSeconds = 60;

  public String getBaseUrl() {
    return baseUrl;
  }

  public void setBaseUrl(String baseUrl) {
    this.baseUrl = baseUrl;
  }

  public String getChatPath() {
    return chatPath;
  }

  public void setChatPath(String chatPath) {
    this.chatPath = chatPath;
  }

  public String getApiKey() {
    return apiKey;
  }

  public void setApiKey(String apiKey) {
    this.apiKey = apiKey;
  }

  public String getModel() {
    return model;
  }

  public void setModel(String model) {
    this.model = model;
  }

  public int getMaxTokens() {
    return maxTokens;
  }

  public void setMaxTokens(int maxTokens) {
    this.maxTokens = maxTokens;
  }

  public double getTemperature() {
    return temperature;
  }

  public void setTemperature(double temperature) {
    this.temperature = temperature;
  }

  public int getTimeoutSeconds() {
    return timeoutSeconds;
  }

  public void setTimeoutSeconds(int timeoutSeconds) {
    this.timeoutSeconds = timeoutSeconds;
  }

  public boolean isConfigured() {
    return apiKey != null && !apiKey.isBlank();
  }

  public String normalizedBaseUrl() {
    if (baseUrl == null || baseUrl.isBlank()) return "";
    return baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
  }

  public String normalizedChatPath() {
    if (chatPath == null || chatPath.isBlank()) return "/chat/completions";
    return chatPath.startsWith("/") ? chatPath : "/" + chatPath;
  }
}
