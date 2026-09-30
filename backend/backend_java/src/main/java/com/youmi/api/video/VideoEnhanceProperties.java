package com.youmi.api.video;

import java.math.BigDecimal;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "youmi.video-enhance")
public class VideoEnhanceProperties {
  private String baseUrl = "https://api.lk888.ai";
  private String apiKey = "";
  private BigDecimal baseMiPerSecond = new BigDecimal("0.2");
  private long maxInputBytes = 512L * 1024 * 1024;
  private long maxOutputBytes = 2L * 1024 * 1024 * 1024;
  public String getBaseUrl() { return baseUrl; }
  public void setBaseUrl(String value) { baseUrl = value; }
  public String getApiKey() { return apiKey; }
  public void setApiKey(String value) { apiKey = value; }
  public BigDecimal getBaseMiPerSecond() { return baseMiPerSecond; }
  public void setBaseMiPerSecond(BigDecimal value) { baseMiPerSecond = value; }
  public long getMaxInputBytes() { return maxInputBytes; }
  public void setMaxInputBytes(long value) { maxInputBytes = value; }
  public long getMaxOutputBytes() { return maxOutputBytes; }
  public void setMaxOutputBytes(long value) { maxOutputBytes = value; }
  public boolean configured() {
    return apiKey != null && !apiKey.isBlank() && baseMiPerSecond != null
        && baseMiPerSecond.signum() > 0 && baseMiPerSecond.compareTo(new BigDecimal("10000")) <= 0;
  }
}
