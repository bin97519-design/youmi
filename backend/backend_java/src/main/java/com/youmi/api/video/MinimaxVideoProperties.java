package com.youmi.api.video;

import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "youmi.minimax-video")
public class MinimaxVideoProperties {
  private String baseUrl = "https://api.lk888.ai";
  private String apiKey = "";
  private int timeoutSeconds = 120;
  private Map<String, Integer> miPerSecondByResolution = Map.of();
  private boolean persistGeneratedVideos = true;

  public String getBaseUrl() { return baseUrl; }
  public void setBaseUrl(String value) { baseUrl = value; }
  public String getApiKey() { return apiKey; }
  public void setApiKey(String value) { apiKey = value; }
  public int getTimeoutSeconds() { return timeoutSeconds; }
  public void setTimeoutSeconds(int value) { timeoutSeconds = value; }
  public Map<String, Integer> getMiPerSecondByResolution() { return miPerSecondByResolution; }
  public void setMiPerSecondByResolution(Map<String, Integer> value) {
    miPerSecondByResolution = value == null ? Map.of() : value;
  }
  public boolean isPersistGeneratedVideos() { return persistGeneratedVideos; }
  public void setPersistGeneratedVideos(boolean value) { persistGeneratedVideos = value; }
  public boolean hasKey() { return apiKey != null && !apiKey.isBlank(); }
  public int rate(String resolution) {
    Integer value = miPerSecondByResolution.get(resolution);
    return value != null && value > 0 && value <= 10000 ? value : 0;
  }
  public boolean isAvailable() {
    return hasKey() && MinimaxVideoClient.RESOLUTIONS.stream().anyMatch(value -> rate(value) > 0);
  }
  public Map<String, Integer> availableRates() {
    return availableRates(false);
  }
  public Map<String, Integer> availableRates(boolean configuredModelKey) {
    boolean available = hasKey() || configuredModelKey;
    return Map.of("768p", available ? rate("768p") : 0, "1080p", available ? rate("1080p") : 0,
        "2k", available ? rate("2k") : 0, "4k", available ? rate("4k") : 0);
  }
  public String normalizedBaseUrl() {
    String value = baseUrl == null || baseUrl.isBlank() ? "https://api.lk888.ai" : baseUrl.trim();
    return value.replaceAll("/+$", "");
  }
}
