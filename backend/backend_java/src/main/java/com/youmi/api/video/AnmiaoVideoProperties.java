package com.youmi.api.video;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;
import java.util.Map;

@Component
@ConfigurationProperties(prefix = "youmi.anmiao-video")
public class AnmiaoVideoProperties {
  private String baseUrl = "https://api.lk888.ai/api/v3/anmiao";
  private String apiKey = "";
  private String apiKey20 = "";
  private String apiKey25 = "";
  private int timeoutSeconds = 120;
  private int miPerSecond = 0;
  private Map<String, Integer> miPerSecondByResolution = Map.of();
  private Map<String, Integer> miPerSecond25ByResolution = Map.of();
  private boolean persistGeneratedVideos = true;

  public String getBaseUrl() { return baseUrl; }
  public void setBaseUrl(String baseUrl) { this.baseUrl = baseUrl; }
  public String getApiKey() { return apiKey; }
  public void setApiKey(String apiKey) { this.apiKey = apiKey; }
  public String getApiKey20() { return apiKey20; }
  public void setApiKey20(String apiKey20) { this.apiKey20 = apiKey20; }
  public String getApiKey25() { return apiKey25; }
  public void setApiKey25(String apiKey25) { this.apiKey25 = apiKey25; }
  public String apiKeyForModel(String model) {
    String dedicated = AnmiaoVideoClient.MODEL25.equals(model) ? apiKey25 : apiKey20;
    return dedicated != null && !dedicated.isBlank() ? dedicated : apiKey;
  }
  public boolean hasDedicatedKey(String model) {
    String dedicated = AnmiaoVideoClient.MODEL25.equals(model) ? apiKey25 : apiKey20;
    return dedicated != null && !dedicated.isBlank();
  }
  public int getTimeoutSeconds() { return timeoutSeconds; }
  public void setTimeoutSeconds(int timeoutSeconds) { this.timeoutSeconds = timeoutSeconds; }
  public int getMiPerSecond() { return miPerSecond; }
  public void setMiPerSecond(int miPerSecond) { this.miPerSecond = miPerSecond; }
  public Map<String, Integer> getMiPerSecondByResolution() { return miPerSecondByResolution; }
  public void setMiPerSecondByResolution(Map<String, Integer> value) {
    miPerSecondByResolution = value == null ? Map.of() : value;
  }
  public Map<String, Integer> getMiPerSecond25ByResolution() { return miPerSecond25ByResolution; }
  public void setMiPerSecond25ByResolution(Map<String, Integer> value) {
    miPerSecond25ByResolution = value == null ? Map.of() : value;
  }
  public boolean isPersistGeneratedVideos() { return persistGeneratedVideos; }
  public void setPersistGeneratedVideos(boolean persistGeneratedVideos) { this.persistGeneratedVideos = persistGeneratedVideos; }

  public boolean isAvailable() {
    String key = apiKeyForModel(AnmiaoVideoClient.MODEL);
    return key != null && !key.isBlank()
        && AnmiaoVideoClient.RESOLUTIONS.stream().anyMatch(resolution -> miPerSecond(resolution) > 0);
  }

  public boolean isAvailable25() {
    String key = apiKeyForModel(AnmiaoVideoClient.MODEL25);
    return key != null && !key.isBlank()
        && AnmiaoVideoClient.RESOLUTIONS25.stream().anyMatch(resolution -> miPerSecond25(resolution) > 0);
  }

  public int miPerSecond(String resolution) {
    Integer value = miPerSecondByResolution.get(resolution);
    int configured = value == null ? 0 : value;
    int rate = configured == 0 && "720p".equals(resolution) ? miPerSecond : configured;
    return rate > 0 && rate <= 10000 ? rate : 0;
  }

  public int miPerSecond25(String resolution) {
    Integer rate = miPerSecond25ByResolution.get(resolution);
    return rate != null && rate > 0 && rate <= 10000 ? rate : 0;
  }

  public Map<String, Integer> availableRates() {
    String key = apiKeyForModel(AnmiaoVideoClient.MODEL);
    if (key == null || key.isBlank())
      return Map.of("480p", 0, "720p", 0, "1080p", 0, "4k", 0);
    return Map.of("480p", miPerSecond("480p"), "720p", miPerSecond("720p"),
        "1080p", miPerSecond("1080p"), "4k", miPerSecond("4k"));
  }

  public Map<String, Integer> availableRates25() {
    String key = apiKeyForModel(AnmiaoVideoClient.MODEL25);
    if (key == null || key.isBlank()) return Map.of("480p", 0, "720p", 0, "1080p", 0);
    return Map.of("480p", miPerSecond25("480p"), "720p", miPerSecond25("720p"),
        "1080p", miPerSecond25("1080p"));
  }

  public String normalizedBaseUrl() {
    String value = baseUrl == null ? "" : baseUrl.trim();
    while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
    return value.isBlank() ? "https://api.lk888.ai/api/v3/anmiao" : value;
  }
}
