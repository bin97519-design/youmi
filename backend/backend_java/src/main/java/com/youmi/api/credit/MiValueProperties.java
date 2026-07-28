package com.youmi.api.credit;

import java.util.HashMap;
import java.util.Map;
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
  private Map<String, Integer> prices = new HashMap<>();
  private Map<String, Map<String, Integer>> imagePrices = new HashMap<>();

  public Map<String, Integer> getPrices() {
    return prices;
  }

  public void setPrices(Map<String, Integer> prices) {
    this.prices = prices == null ? new HashMap<>() : prices;
  }

  public Map<String, Map<String, Integer>> getImagePrices() {
    return imagePrices;
  }

  public void setImagePrices(Map<String, Map<String, Integer>> imagePrices) {
    this.imagePrices = imagePrices == null ? new HashMap<>() : imagePrices;
  }

  public int getImagePrice(String model, String resolution) {
    String modelKey = normalizeModel(model);
    String resolutionKey = normalizeResolution(resolution);
    Map<String, Integer> modelPrices = imagePrices.get(modelKey);
    if (modelPrices == null) {
      throw new IllegalArgumentException("Unsupported image model: " + model);
    }
    Integer price = modelPrices.entrySet().stream()
        .filter(entry -> entry.getKey().equalsIgnoreCase(resolutionKey))
        .map(Map.Entry::getValue)
        .findFirst()
        .orElse(null);
    if (price == null || price < 0) {
      throw new IllegalArgumentException(
          "Unsupported image resolution " + resolution + " for model " + modelKey);
    }
    return price;
  }

  public static String normalizeModel(String model) {
    String value = model == null ? "" : model.trim().toLowerCase();
    String compact = value.replaceAll("[\\s_\\-]+", "");
    if (compact.equals("banana2") || value.startsWith("gemini-3.1-flash")) return "banana2";
    if (compact.equals("bananapro") || value.startsWith("gemini-3-pro")) return "banana-pro";
    if (compact.equals("gptimage2") || compact.equals("gptimag2") || value.startsWith("gpt-image-2")) {
      return "gpt-image-2";
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
  public int getPrice(MiBizType bizType) {
    Integer price = prices.get(bizType.name());
    if (price == null) {
      if (bizType == MiBizType.ADMIN_ADJUST) {
        return 0;
      }
      throw new IllegalStateException("未配置米值单价: " + bizType);
    }
    return price;
  }
}
