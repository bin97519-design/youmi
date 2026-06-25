package com.youmi.api.image;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

public class ImageDetectDtos {

  public record DetectRequest(String imageUrl, String layerId) {}

  public record DetectResponse(
      List<DetectedElement> imageInfo,
      String url) {}

  public record DetectedElement(
      @JsonProperty("object_name") String objectName,
      @JsonProperty("box_2d") List<Double> box2d) {}
}
