package com.youmi.api.image;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

public class ImageDetectDtos {

  public record DetectRequest(String imageUrl, String layerId) {}

  public record DetectResponse(
      List<DetectedElement> imageInfo,
      String url) {}

  @JsonInclude(JsonInclude.Include.ALWAYS)
  public record DetectedElement(
      @JsonProperty("object_name") String objectName,
      @JsonProperty("box2d") List<Double> box2d,
      @JsonProperty("box_2d") List<Double> box2dUnderscore) {
    public DetectedElement(String objectName, List<Double> box2d) {
      this(objectName, box2d, box2d);
    }
  }
}
