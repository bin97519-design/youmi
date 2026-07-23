package com.youmi.api.creative;

import com.youmi.api.common.ApiResponse;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/canvas-creative")
public class CanvasCreativeController {
  private final CanvasCreativeService canvasCreativeService;
  private final CanvasDetailService canvasDetailService;

  public CanvasCreativeController(
      CanvasCreativeService canvasCreativeService,
      CanvasDetailService canvasDetailService) {
    this.canvasCreativeService = canvasCreativeService;
    this.canvasDetailService = canvasDetailService;
  }

  @PostMapping("/demands")
  public ApiResponse<CanvasCreativeDtos.DemandResponse> generateDemands(
      @RequestBody CanvasCreativeDtos.DemandRequest request) {
    return ApiResponse.ok(canvasCreativeService.generateDemands(request));
  }

  @PostMapping("/detail-plan")
  public ApiResponse<CanvasCreativeDtos.DetailResponse> generateDetailPlan(
      @RequestBody CanvasCreativeDtos.DetailRequest request) {
    return ApiResponse.ok(canvasDetailService.generateDetailPlan(request));
  }
}
