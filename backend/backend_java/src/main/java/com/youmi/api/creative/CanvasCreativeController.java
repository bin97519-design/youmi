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

  public CanvasCreativeController(CanvasCreativeService canvasCreativeService) {
    this.canvasCreativeService = canvasCreativeService;
  }

  @PostMapping("/demands")
  public ApiResponse<CanvasCreativeDtos.DemandResponse> generateDemands(
      @RequestBody CanvasCreativeDtos.DemandRequest request) {
    return ApiResponse.ok(canvasCreativeService.generateDemands(request));
  }
}
