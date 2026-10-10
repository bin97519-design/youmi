package com.youmi.api.image;

import com.youmi.api.credit.MiValueProperties;
import java.math.BigDecimal;
import org.springframework.stereotype.Service;

@Service
public class ImageMiValuePricingService {
  private final MiValueProperties properties;

  public ImageMiValuePricingService(MiValueProperties properties) {
    this.properties = properties;
  }

  public PriceQuote quote(String model, String resolution, int count) {
    String canonicalModel = MiValueProperties.normalizeModel(
        model == null || model.isBlank() ? "gpt-image-2" : model);
    String canonicalResolution = MiValueProperties.normalizeResolution(
        resolution == null || resolution.isBlank() ? "2K" : resolution);
    int normalizedCount = Math.max(1, Math.min(4, count));
    BigDecimal unitPrice = properties.getImagePrice(canonicalModel, canonicalResolution)
        .setScale(2, java.math.RoundingMode.HALF_UP);
    BigDecimal fallbackUnitPrice = canonicalModel.equals("gpt-image-2")
        ? properties.getImagePrice("banana2", canonicalResolution)
        : unitPrice;
    BigDecimal reservedUnitPrice = unitPrice.max(fallbackUnitPrice);
    return new PriceQuote(
        canonicalModel,
        canonicalResolution,
        normalizedCount,
        unitPrice,
        reservedUnitPrice,
        unitPrice.multiply(BigDecimal.valueOf(normalizedCount)),
        reservedUnitPrice.multiply(BigDecimal.valueOf(normalizedCount)));
  }

  public PriceQuote reportedCostQuote(String model, String resolution, int count) {
    String canonicalModel = MiValueProperties.normalizeModel(
        model == null || model.isBlank() ? "gpt-image-2" : model);
    String canonicalResolution = MiValueProperties.normalizeResolution(
        resolution == null || resolution.isBlank() ? "2K" : resolution);
    int normalizedCount = Math.max(1, Math.min(4, count));
    BigDecimal zero = BigDecimal.ZERO.setScale(2, java.math.RoundingMode.HALF_UP);
    return new PriceQuote(canonicalModel, canonicalResolution, normalizedCount, zero, zero, zero, zero);
  }

  public BigDecimal settlementPrice(PriceQuote quote, String provider) {
    if (quote == null) throw new IllegalArgumentException("Image price quote is required");
    String providerName = provider == null ? "" : provider.trim().toLowerCase();
    if (quote.model().equals("gpt-image-2")
        && (providerName.contains("gettoken") || providerName.contains("lk888"))) {
      return properties.getImagePrice("banana2", quote.resolution())
        .multiply(BigDecimal.valueOf(quote.count())).setScale(2, java.math.RoundingMode.HALF_UP);
    }
    return quote.requestedPrice();
  }

  public record PriceQuote(
      String model,
      String resolution,
      int count,
      BigDecimal unitPrice,
      BigDecimal reservedUnitPrice,
      BigDecimal requestedPrice,
      BigDecimal reservedPrice) {}
}
