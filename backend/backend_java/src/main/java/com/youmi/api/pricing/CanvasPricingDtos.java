package com.youmi.api.pricing;

/** Public estimates contain neither credentials nor source media/prompt data. */
public final class CanvasPricingDtos {
  private CanvasPricingDtos() {}

  public record Estimate(boolean available, String amount, String minAmount, String maxAmount,
      String unit, String kind, String message, String source, String model,
      Long pricingUpdatedAt, Long expiresAt, String platformUnit, String sourceAmount,
      String sourceMinAmount, String sourceMaxAmount, int conversionMultiplier) {}
}
