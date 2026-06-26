package com.youmi.api.detail;

import java.util.List;
import java.util.Map;

public final class DetailCloneDtos {
  private DetailCloneDtos() {}

  public record DeconstructRequest(
      List<String> competitorImages,
      String productInfo,
      String cloneStrength) {}

  public record DeconstructResponse(
      String provider,
      String model,
      List<SliceContract> sliceContracts) {}

  public record MappingRequest(
      String productInfo,
      List<String> productImages,
      String cloneStrength,
      List<SliceContract> sliceContracts) {}

  public record MappingResponse(
      String provider,
      String model,
      List<MappingContract> mappingContracts) {}

  public record ExtractImagesRequest(String url) {}

  public record ExtractImagesResponse(
      String url,
      List<String> imageUrls) {}

  public record ExtractTmallDetailRequest(
      String itemId,
      String url) {}

  public record ExtractTmallDetailResponse(
      String itemId,
      String url,
      List<String> imageUrls) {}

  public record CutImagesRequest(
      List<String> imageUrls,
      List<Double> cutLines) {}

  public record CutImagesResponse(
      List<String> imageUrls,
      List<Double> cutLines,
      Integer sourceImageCount,
      Integer outputImageCount) {}

  public record SliceContract(
      Integer index,
      String role,
      String layoutSkeleton,
      List<String> visualLanguage,
      List<String> textHierarchy,
      String subjectRole,
      List<String> portableElements,
      List<String> claimsToDrop,
      String generationScope) {}

  public record MappingContract(
      Integer sliceIndex,
      String aRole,
      String newProductRole,
      List<String> keepFromA,
      List<String> replaceWithProduct,
      Map<String, Object> variableSlots,
      List<String> forbidden,
      String generationHint) {}
}
