package com.youmi.api.image;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.youmi.api.credit.MiValueProperties;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class ImageMiValuePricingServiceTest {
  private ImageMiValuePricingService service;

  @BeforeEach
  void setUp() {
    MiValueProperties properties = new MiValueProperties();
    properties.setImagePrices(Map.of(
        "banana2", Map.of("1K", 8, "2K", 9, "4K", 12),
        "banana-pro", Map.of("1K", 13, "2K", 15, "4K", 21),
        "gpt-image-2", Map.of("1K", 6, "2K", 10, "4K", 15)));
    service = new ImageMiValuePricingService(properties);
  }

  @Test
  void appliesModelResolutionAndCountMatrix() {
    assertEquals(8, service.quote("banana2", "1K", 1).requestedPrice());
    assertEquals(30, service.quote("banana-pro", "2K", 2).requestedPrice());
    assertEquals(60, service.quote("gpt-image-2", "4K", 4).requestedPrice());
  }

  @Test
  void reservesFallbackCostAndSettlesActualProvider() {
    ImageMiValuePricingService.PriceQuote quote = service.quote("gpt image 2", "1K", 2);
    assertEquals(16, quote.reservedPrice());
    assertEquals(12, service.settlementPrice(quote, "apimart"));
    assertEquals(16, service.settlementPrice(quote, "gettoken"));
    assertEquals(16, service.settlementPrice(quote, "lk888"));
  }

  @Test
  void keepsLegacyDefaultsCompatible() {
    assertEquals(10, service.quote(null, null, 1).requestedPrice());
  }
}
