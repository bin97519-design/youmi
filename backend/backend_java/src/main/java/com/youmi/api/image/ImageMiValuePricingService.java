package com.youmi.api.image;

import com.youmi.api.credit.MiValueProperties;
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
    int unitPrice = properties.getImagePrice(canonicalModel, canonicalResolution);
    int fallbackUnitPrice = canonicalModel.equals("gpt-image-2")
        ? properties.getImagePrice("banana2", canonicalResolution)
        : unitPrice;
    int reservedUnitPrice = Math.max(unitPrice, fallbackUnitPrice);
    return new PriceQuote(
        canonicalModel,
        canonicalResolution,
        normalizedCount,
        unitPrice,
        reservedUnitPrice,
        normalizedCount * unitPrice,
        normalizedCount * reservedUnitPrice);
  }

  public int settlementPrice(PriceQuote quote, String provider) {
    if (quote == null) throw new IllegalArgumentException("Image price quote is required");
    String providerName = provider == null ? "" : provider.trim().toLowerCase();
    if (quote.model().equals("gpt-image-2")
        && (providerName.contains("gettoken") || providerName.contains("lk888"))) {
      return properties.getImagePrice("banana2", quote.resolution()) * quote.count();
    }
    return quote.requestedPrice();
  }

  public record PriceQuote(
      String model,
      String resolution,
      int count,
      int unitPrice,
      int reservedUnitPrice,
      int requestedPrice,
      int reservedPrice) {}
}
