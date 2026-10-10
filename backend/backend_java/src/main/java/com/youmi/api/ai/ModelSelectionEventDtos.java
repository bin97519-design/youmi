package com.youmi.api.ai;

import com.fasterxml.jackson.annotation.JsonProperty;

public final class ModelSelectionEventDtos {
  private ModelSelectionEventDtos() {}

  public record CreateRequest(
      @JsonProperty("feature_code") String featureCode,
      String model,
      Boolean selected) {}
}
