package com.youmi.api.pricing;

import com.fasterxml.jackson.databind.JsonNode;
import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiResponse;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/canvas-pricing")
public class CanvasPricingController {
  private final AdminAuthService auth;
  private final CanvasPricingService pricing;

  public CanvasPricingController(AdminAuthService auth, CanvasPricingService pricing) {
    this.auth = auth;
    this.pricing = pricing;
  }

  @PostMapping("/estimate")
  public ApiResponse<CanvasPricingDtos.Estimate> estimate(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody JsonNode request) {
    auth.requireUserId(authorization);
    return ApiResponse.ok(pricing.estimate(request));
  }
}
