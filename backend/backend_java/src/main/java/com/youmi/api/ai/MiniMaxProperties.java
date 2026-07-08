package com.youmi.api.ai;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "youmi.minimax")
public class MiniMaxProperties {
  private String baseUrl = "https://api.minimaxi.com/anthropic";
  private String messagesPath = "/v1/messages";
  private String apiKey = "";
  private String model = "MiniMax-M3";
  private int maxTokens = 900;
  private double temperature = 0.6;
  private int timeoutSeconds = 60;

  public String getBaseUrl() {
    return baseUrl;
  }

  public void setBaseUrl(String baseUrl) {
    this.baseUrl = baseUrl;
  }

  public String getMessagesPath() {
    return messagesPath;
  }

  public void setMessagesPath(String messagesPath) {
    this.messagesPath = messagesPath;
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

  public String normalizedMessagesPath() {
    if (messagesPath == null || messagesPath.isBlank()) return "/v1/messages";
    return messagesPath.startsWith("/") ? messagesPath : "/" + messagesPath;
  }
}
