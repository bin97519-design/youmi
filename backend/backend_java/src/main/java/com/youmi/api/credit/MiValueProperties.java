package com.youmi.api.credit;

import java.util.HashMap;
import java.util.Map;
import java.math.BigDecimal;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * 米值计费配置。单价只能从此处获取，业务代码禁止硬编码数值。
 *
 * <p>对应 application.yml 中的 {@code youmi.credit.prices.{IMAGE,VIDEO}}。
 */
@Component
@ConfigurationProperties(prefix = "youmi.credit")
public class MiValueProperties {
  /** 各业务类型的固定单价（米值/次）。例：IMAGE=10，VIDEO=50 */
  private Map<String, Object> prices = new HashMap<>();
  private Map<String, Map<String, Object>> imagePrices = new HashMap<>();

  public Map<String, Object> getPrices() {
    return prices;
  }

  public void setPrices(Map<String, ?> prices) {
    this.prices = new HashMap<>();
    if (prices != null) prices.forEach(this.prices::put);
  }

  public Map<String, Map<String, Object>> getImagePrices() {
    return imagePrices;
  }

  public void setImagePrices(Map<String, ? extends Map<String, ?>> imagePrices) {
    this.imagePrices = new HashMap<>();
    if (imagePrices != null) imagePrices.forEach((key, value) -> {
      Map<String, Object> normalized = new HashMap<>();
      value.forEach(normalized::put);
      this.imagePrices.put(key, normalized);
    });
  }

  public BigDecimal getImagePrice(String model, String resolution) {
    String modelKey = normalizeModel(model);
    String resolutionKey = normalizeResolution(resolution);
    Map<String, Object> modelPrices = imagePrices.get(modelKey);
    if (modelPrices == null) {
      throw new IllegalArgumentException("Unsupported image model: " + model);
    }
    Object configuredPrice = modelPrices.entrySet().stream()
        .filter(entry -> entry.getKey().equalsIgnoreCase(resolutionKey))
        .map(Map.Entry::getValue)
        .findFirst()
        .orElse(null);
    BigDecimal price = configuredPrice == null ? null : new BigDecimal(configuredPrice.toString());
    if (price == null || price.signum() < 0) {
      throw new IllegalArgumentException(
          "Unsupported image resolution " + resolution + " for model " + modelKey);
    }
    return price.setScale(2, java.math.RoundingMode.HALF_UP);
  }

  public static String normalizeModel(String model) {
    String value = model == null ? "" : model.trim().toLowerCase();
    String compact = value.replaceAll("[\\s_\\-]+", "");
    if (compact.equals("banana2") || value.startsWith("gemini-3.1-flash")) return "banana2";
    if (compact.equals("bananapro") || compact.equals("bananaproapi")
        || value.startsWith("gemini-3-pro")) return "banana-pro";
    if (value.equals("banana-2.1") || compact.equals("banana21")) return "banana-2.1";
    if (value.equals("gpt-image-2.5-sunburst") || compact.equals("gptimage25sunburst")
        || compact.equals("gptimage2.5sunburst")
        || compact.equals("gptimage2.5sunburstapi")) {
      return "gpt-image-2.5-sunburst";
    }
    // Database-configured GPT-image2.5 uses the generic GPT Image estimate.
    // The final charge is replaced by the provider status response's cost field.
    if (value.equals("gpt-image2.5") || compact.equals("gptimage2.5")
        || compact.equals("gptimage25")) {
      return "gpt-image-2";
    }
    if (compact.equals("gptimage2") || compact.equals("gptimag2") || value.startsWith("gpt-image-2")) {
      return "gpt-image-2";
    }
    if (value.equals("wavespeed-ai/qwen-image/edit-multiple-angles")
        || compact.equals("qwenmultiangle")) {
      return "qwen-multi-angle";
    }
    return value;
  }

  public static String normalizeResolution(String resolution) {
    String value = resolution == null ? "" : resolution.trim().toUpperCase();
    if (!value.equals("1K") && !value.equals("2K") && !value.equals("4K")) {
      throw new IllegalArgumentException("Unsupported image resolution: " + resolution);
    }
    return value;
  }

  /**
   * 取指定业务类型的单价。
   *
   * @param bizType 业务类型
   * @return 单价（米值/次）；ADMIN_ADJUST 无单价返回 0
   * @throws IllegalStateException 当业务类型未配置单价时（开发期配置错误）
   */
  public BigDecimal getPrice(MiBizType bizType) {
    Object configuredPrice = prices.get(bizType.name());
    BigDecimal price = configuredPrice == null ? null : new BigDecimal(configuredPrice.toString());
    if (price == null) {
      if (bizType == MiBizType.ADMIN_ADJUST) {
        return BigDecimal.ZERO.setScale(2);
      }
      throw new IllegalStateException("未配置米值单价: " + bizType);
    }
    return price.setScale(2, java.math.RoundingMode.HALF_UP);
  }
}
