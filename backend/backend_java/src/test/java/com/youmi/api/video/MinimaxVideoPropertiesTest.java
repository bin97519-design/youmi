package com.youmi.api.video;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.mock.env.MockEnvironment;

class MinimaxVideoPropertiesTest {
  @Test void bindsAllTiersAndHidesRatesUntilKeyIsConfigured() {
    var environment = new MockEnvironment()
        .withProperty("youmi.minimax-video.api-key", "test-only")
        .withProperty("youmi.minimax-video.mi-per-second-by-resolution.768p", "5")
        .withProperty("youmi.minimax-video.mi-per-second-by-resolution.1080p", "10")
        .withProperty("youmi.minimax-video.mi-per-second-by-resolution.2k", "15")
        .withProperty("youmi.minimax-video.mi-per-second-by-resolution.4k", "30");
    var properties = Binder.get(environment).bind("youmi.minimax-video", Bindable.of(MinimaxVideoProperties.class)).get();
    assertTrue(properties.isAvailable());
    assertEquals(5, properties.rate("768p"));
    assertEquals(10, properties.rate("1080p"));
    assertEquals(15, properties.rate("2k"));
    assertEquals(30, properties.rate("4k"));
    assertEquals(0, properties.rate("720p"));
    properties.setApiKey("");
    assertFalse(properties.isAvailable());
    assertTrue(properties.availableRates().values().stream().allMatch(rate -> rate == 0));
  }
}
