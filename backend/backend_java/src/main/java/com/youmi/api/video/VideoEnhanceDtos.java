package com.youmi.api.video;

import com.youmi.api.common.ApiException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

public final class VideoEnhanceDtos {
  private VideoEnhanceDtos() { }
  static final Map<String, Integer> RESOLUTIONS = Map.of("720p", 1, "1080p", 2, "2k", 4, "4k", 8, "8k", 32);
  static final Map<String, Integer> FPS = Map.of("keep", 1, "60", 2, "120", 4);
  static final Map<String, Integer> VERSIONS = Map.of("standard", 1, "professional", 10);
  public record Settings(String resolution, String fps, String toolVersion, String scene, String enhanceStyle) {
    public void validate() {
      if (resolution == null || !RESOLUTIONS.containsKey(resolution) || fps == null || !FPS.containsKey(fps)
          || toolVersion == null || !VERSIONS.containsKey(toolVersion)
          || scene == null || !Set.of("aigc", "short_series", "ugc", "old_film").contains(scene)
          || enhanceStyle == null || !Set.of("natural", "hd").contains(enhanceStyle)) {
        throw new ApiException(400, "请选择有效的超分参数");
      }
    }
    Map<String, Object> params(String videoUrl) {
      validate();
      Map<String, Object> result = new LinkedHashMap<>();
      result.put("video_url", videoUrl);
      result.put("resolution", resolution);
      result.put("fps", fps);
      result.put("tool_version", toolVersion);
      result.put("enhance_style", enhanceStyle);
      if ("standard".equals(toolVersion)) result.put("scene", scene);
      return result;
    }
    int price(double duration, BigDecimal base) {
      validate();
      if (!Double.isFinite(duration) || duration <= 0 || duration > 600) throw new ApiException(400, "源视频时长须在 10 分钟以内");
      if (base == null || base.signum() <= 0) throw new ApiException(503, "超分价格尚未配置");
      try {
        return base.multiply(BigDecimal.valueOf(Math.ceil(duration)))
            .multiply(BigDecimal.valueOf(RESOLUTIONS.get(resolution) * FPS.get(fps) * VERSIONS.get(toolVersion)))
            .setScale(0, RoundingMode.CEILING).intValueExact();
      } catch (ArithmeticException error) { throw new ApiException(503, "超分价格配置异常"); }
    }
  }
  public record QuoteRequest(String sourceUrl, Settings settings) { }
  public record CreateRequest(String quoteId) { }
  public record Metadata(double duration, int width, int height) {
    void validate() {
      if (!Double.isFinite(duration) || duration <= 0 || duration > 600) throw new ApiException(400, "源视频时长须在 10 分钟以内");
      if (Math.min(width, height) < 360 || Math.min(width, height) > 1440 || Math.max(width, height) > 2560) {
        throw new ApiException(400, "源视频短边须为 360～1440 像素，长边不超过 2560 像素");
      }
    }
  }
  public record Task(String id, String sourceObject, Settings settings, Metadata metadata, int price,
      long createdAt, long expiresAt, String status, String providerTaskId, Integer progress,
      String stage, String error, String resultUrl, String providerResultUrl) {
    Task state(String status, String providerId, Integer progress, String stage, String error, String result, String providerResult) {
      return new Task(id, sourceObject, settings, metadata, price, createdAt, expiresAt,
          status, providerId, progress, stage, error, result, providerResult);
    }
  }
}
