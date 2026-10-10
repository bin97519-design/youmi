package com.youmi.api.video;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.mock.env.MockEnvironment;

class AnmiaoVideoPropertiesTest {
  @Test void dedicatedSd20KeyDoesNotEnableSd25() {
    var environment = new MockEnvironment()
        .withProperty("youmi.anmiao-video.api-key-20", "test-sd20-key")
        .withProperty("youmi.anmiao-video.mi-per-second", "5")
        .withProperty("youmi.anmiao-video.mi-per-second-25-by-resolution.720p", "7");
    var properties = Binder.get(environment)
        .bind("youmi.anmiao-video", Bindable.of(AnmiaoVideoProperties.class)).get();
    assertTrue(properties.isAvailable());
    assertFalse(properties.isAvailable25());
    assertEquals(5, properties.availableRates().get("720p"));
    assertEquals(0, properties.availableRates25().get("720p"));
    assertEquals("test-sd20-key", properties.apiKeyForModel(AnmiaoVideoClient.MODEL));
    assertEquals("", properties.apiKeyForModel(AnmiaoVideoClient.MODEL25));
    properties.setApiKey25("test-sd25-key");
    assertTrue(properties.isAvailable25());
    assertEquals("test-sd25-key", properties.apiKeyForModel(AnmiaoVideoClient.MODEL25));
  }

  @Test void bindsEachResolutionRateWithoutBorrowingTheLegacy720pRate() {
    var environment = new MockEnvironment()
        .withProperty("youmi.anmiao-video.api-key", "configured-key")
        .withProperty("youmi.anmiao-video.mi-per-second", "5")
        .withProperty("youmi.anmiao-video.mi-per-second-by-resolution.480p", "1")
        .withProperty("youmi.anmiao-video.mi-per-second-by-resolution.720p", "2")
        .withProperty("youmi.anmiao-video.mi-per-second-by-resolution.1080p", "3")
        .withProperty("youmi.anmiao-video.mi-per-second-by-resolution.4k", "4")
        .withProperty("youmi.anmiao-video.mi-per-second-25-by-resolution.480p", "5")
        .withProperty("youmi.anmiao-video.mi-per-second-25-by-resolution.720p", "6")
        .withProperty("youmi.anmiao-video.mi-per-second-25-by-resolution.1080p", "7");
    var properties = Binder.get(environment)
        .bind("youmi.anmiao-video", Bindable.of(AnmiaoVideoProperties.class)).get();

    assertEquals(1, properties.miPerSecond("480p"));
    assertEquals(2, properties.miPerSecond("720p"));
    assertEquals(3, properties.miPerSecond("1080p"));
    assertEquals(4, properties.miPerSecond("4k"));
    assertEquals(5, properties.miPerSecond25("480p"));
    assertEquals(6, properties.miPerSecond25("720p"));
    assertEquals(7, properties.miPerSecond25("1080p"));
    assertTrue(properties.isAvailable());
    assertTrue(properties.isAvailable25());
  }

  @Test void hidesUnpricedRatesAndRetainsLegacy720pCompatibility() {
    var properties = new AnmiaoVideoProperties();
    properties.setApiKey("configured-key");
    properties.setMiPerSecond(5);

    assertEquals(0, properties.availableRates().get("480p"));
    assertEquals(5, properties.availableRates().get("720p"));
    assertEquals(0, properties.availableRates().get("1080p"));
    assertEquals(0, properties.availableRates().get("4k"));
    properties.setApiKey("");
    assertFalse(properties.isAvailable());
    assertFalse(properties.isAvailable25());
    assertEquals(0, properties.availableRates().get("720p"));
  }

  @Test void exposesRatesWhenModelManagementProvidesTheCredential() {
    var properties = new AnmiaoVideoProperties();
    properties.setMiPerSecondByResolution(java.util.Map.of("480p", 3));
    properties.setMiPerSecond25ByResolution(java.util.Map.of("480p", 4));

    assertEquals(0, properties.availableRates().get("480p"));
    assertEquals(0, properties.availableRates25().get("480p"));
    assertEquals(3, properties.availableRates(true).get("480p"));
    assertEquals(4, properties.availableRates25(true).get("480p"));
  }
}
