package com.youmi.api.canvas;

import java.util.Map;

/** User-owned character library data. Config is inert editor metadata, never executable instructions. */
public final class CharacterAssetDtos {
  private CharacterAssetDtos() {}

  public record SaveRequest(
      String id,
      String name,
      String description,
      String gender,
      String ageGroup,
      String culture,
      String imageUrl,
      String coverUrl,
      Map<String, Object> config) {}

  public record CharacterAsset(
      String id,
      String name,
      String description,
      String gender,
      String ageGroup,
      String culture,
      String imageUrl,
      String coverUrl,
      Map<String, Object> config,
      long createdAt,
      long updatedAt) {}
}
