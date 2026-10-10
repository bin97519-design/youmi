package com.youmi.api.image;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.youmi.api.credit.MiValueProperties;
import java.util.Map;
import java.math.BigDecimal;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.source.ConfigurationPropertySources;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.MutablePropertySources;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;

class ImageMiValuePricingServiceTest {
  private ImageMiValuePricingService service;

  @BeforeEach
  void setUp() {
    MiValueProperties properties = new MiValueProperties();
    properties.setImagePrices(Map.of(
        "banana2", Map.of("1K", 8, "2K", 9, "4K", 12),
        "banana-pro", Map.of("1K", 13, "2K", 15, "4K", 21),
        "banana-2.1", Map.of("1K", 8, "2K", 9, "4K", 12),
        "gpt-image-2", Map.of("1K", 6, "2K", 10, "4K", 15),
        "gpt-image-2.5-sunburst", Map.of("1K", 11, "2K", 11, "4K", 18),
        "qwen-multi-angle", Map.of("1K", 20, "2K", 20, "4K", 20)));
    service = new ImageMiValuePricingService(properties);
  }

  @Test
  void appliesModelResolutionAndCountMatrix() {
    assertEquals(new BigDecimal("8.00"), service.quote("banana2", "1K", 1).requestedPrice());
    assertEquals(new BigDecimal("30.00"), service.quote("banana-pro", "2K", 2).requestedPrice());
    assertEquals(new BigDecimal("18.00"), service.quote("banana-2.1", "2K", 2).requestedPrice());
    assertEquals(new BigDecimal("60.00"), service.quote("gpt-image-2", "4K", 4).requestedPrice());
    assertEquals(new BigDecimal("15.00"), service.quote("GPT-image2.5", "4K", 1).requestedPrice());
    assertEquals(new BigDecimal("36.00"), service.quote("gpt-image-2.5-sunburst", "4K", 2).requestedPrice());
    assertEquals(new BigDecimal("18.00"), service.quote("gpt-image2.5-sunburst-api", "4K", 1).requestedPrice());
    assertEquals(
        new BigDecimal("20.00"),
        service.quote("wavespeed-ai/qwen-image/edit-multiple-angles", "1K", 1)
            .requestedPrice());
  }

  @Test
  void reservesFallbackCostAndSettlesActualProvider() {
    ImageMiValuePricingService.PriceQuote quote = service.quote("gpt image 2", "1K", 2);
    assertEquals(new BigDecimal("16.00"), quote.reservedPrice());
    assertEquals(new BigDecimal("12.00"), service.settlementPrice(quote, "apimart"));
    assertEquals(new BigDecimal("16.00"), service.settlementPrice(quote, "gettoken"));
    assertEquals(new BigDecimal("16.00"), service.settlementPrice(quote, "lk888"));
  }

  @Test
  void createsZeroEstimateQuoteForProviderReportedPricing() {
    ImageMiValuePricingService.PriceQuote quote =
        service.reportedCostQuote("image-2.5快速", "2K", 1);

    assertEquals(new BigDecimal("0.00"), quote.requestedPrice());
    assertEquals(new BigDecimal("0.00"), quote.reservedPrice());
    assertEquals("2K", quote.resolution());
  }

  @Test
  void keepsLegacyDefaultsCompatible() {
    assertEquals(new BigDecimal("10.00"), service.quote(null, null, 1).requestedPrice());
  }

  @Test
  void bindsSunburstPriceFromApplicationYaml() throws Exception {
    MutablePropertySources propertySources = new MutablePropertySources();
    for (PropertySource<?> source : new YamlPropertySourceLoader()
        .load("application", new ClassPathResource("application.yml"))) {
      propertySources.addLast(source);
    }
    MiValueProperties properties = new Binder(ConfigurationPropertySources.from(propertySources))
        .bind("youmi.credit", Bindable.of(MiValueProperties.class))
        .orElseThrow(() -> new IllegalStateException("youmi.credit configuration is missing"));

    assertEquals(new BigDecimal("18.00"), properties.getImagePrice("gpt-image-2.5-sunburst", "4K"));
    assertEquals(new BigDecimal("12.00"), properties.getImagePrice("banana-2.1", "4K"));
  }

}
