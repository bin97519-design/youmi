package com.youmi.api.ai;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "youmi.gem-agent")
public class GemAgentProperties {
  private String baseUrl = "https://api.lk888.ai";
  private String apiKey = "";
  private int timeoutSeconds = 120;
  private int maxTokens = 8000;

  public String getBaseUrl() { return baseUrl; }
  public void setBaseUrl(String value) { baseUrl = value; }
  public String getApiKey() { return apiKey; }
  public void setApiKey(String value) { apiKey = value; }
  public int getTimeoutSeconds() { return timeoutSeconds; }
  public void setTimeoutSeconds(int value) { timeoutSeconds = value; }
  public int getMaxTokens() { return maxTokens; }
  public void setMaxTokens(int value) { maxTokens = value; }
  public boolean isConfigured() { return apiKey != null && !apiKey.isBlank(); }
}
