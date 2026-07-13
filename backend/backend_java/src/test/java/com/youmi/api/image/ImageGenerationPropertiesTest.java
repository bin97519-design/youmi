package com.youmi.api.image;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class ImageGenerationPropertiesTest {

  private final ImageGenerationProperties properties = new ImageGenerationProperties();

  @ParameterizedTest
  @CsvSource({
      "banana2, banana2",
      "banana-2, banana2",
      "banana-pro, banana-pro",
      "bananapro, banana-pro",
      "'banana pro', banana-pro",
      "gpt-image-2, gpt-image-2",
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
