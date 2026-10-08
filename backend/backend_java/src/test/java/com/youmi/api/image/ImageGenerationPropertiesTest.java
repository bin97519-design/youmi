package com.youmi.api.image;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class ImageGenerationPropertiesTest {

  private final ImageGenerationProperties properties = new ImageGenerationProperties();

  @Test
  void teamorouterImagesUseConfiguredCnEndpointAndKeepExplicitOverrides() {
    assertEquals("https://api.teamorouter.cn/v1/images/generations",
        properties.normalizedTeamorouterBaseUrl() + properties.normalizedTeamorouterGenerationPath());
    properties.setTeamorouterBaseUrl(" ");
    assertEquals("https://api.teamorouter.cn/v1", properties.normalizedTeamorouterBaseUrl());
    properties.setTeamorouterBaseUrl("https://images.example/v1/");
    assertEquals("https://images.example/v1", properties.normalizedTeamorouterBaseUrl());
    assertEquals("/images/edits", properties.normalizedTeamorouterEditsPath());
  }

  @ParameterizedTest
  @CsvSource({
      "banana2, banana2",
      "banana-2, banana2",
      "banana-pro, banana-pro",
      "bananapro, banana-pro",
      "'banana pro', banana-pro",
      "banana-2.1, banana-2.1",
      "banana21, banana-2.1",
      "gpt-image-2, gpt-image-2",
      "gpt-image-2.5-sunburst, gpt-image-2.5-sunburst",
      "'GPT imag 2', gpt-image-2",
      "'gpt image 2', gpt-image-2",
      "agnes-image-2.1-flash, agnes-image-2.1-flash",
      "gemini-3.1-flash-image-preview, banana2",
      "gemini-3-pro-image-preview, banana-pro"
  })
  void canonicalDisplayModel_mergesKnownAliases(String input, String expected) {
    assertEquals(expected, properties.canonicalDisplayModel(input));
  }
}
