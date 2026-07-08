package com.youmi.api.detail;

import com.youmi.api.common.ApiResponse;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/detail-clone")
public class DetailCloneController {
  private final DetailCloneService detailCloneService;

  public DetailCloneController(DetailCloneService detailCloneService) {
    this.detailCloneService = detailCloneService;
  }

  @PostMapping("/deconstruct")
  public ApiResponse<DetailCloneDtos.DeconstructResponse> deconstruct(
      @RequestBody DetailCloneDtos.DeconstructRequest request) {
    return ApiResponse.ok(detailCloneService.deconstruct(request));
  }

  @PostMapping("/map")
  public ApiResponse<DetailCloneDtos.MappingResponse> map(
      @RequestBody DetailCloneDtos.MappingRequest request) {
    return ApiResponse.ok(detailCloneService.map(request));
  }

  @PostMapping("/extract-images")
  public ApiResponse<DetailCloneDtos.ExtractImagesResponse> extractImages(
      @RequestBody DetailCloneDtos.ExtractImagesRequest request) {
    return ApiResponse.ok(detailCloneService.extractImages(request));
  }

  @PostMapping("/extract-tmall-detail")
  public ApiResponse<DetailCloneDtos.ExtractTmallDetailResponse> extractTmallDetail(
      @RequestBody DetailCloneDtos.ExtractTmallDetailRequest request) {
    return ApiResponse.ok(detailCloneService.extractTmallDetail(request));
  }

  @PostMapping("/cut-images")
  public ApiResponse<DetailCloneDtos.CutImagesResponse> cutImages(
      @RequestBody DetailCloneDtos.CutImagesRequest request) {
    return ApiResponse.ok(detailCloneService.cutImages(request));
  }
}
