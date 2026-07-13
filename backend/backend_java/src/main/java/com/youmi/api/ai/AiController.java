package com.youmi.api.ai;

import com.youmi.api.common.ApiResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/ai")
public class AiController {
  private final DashScopeClient dashScopeClient;

  public AiController(DashScopeClient dashScopeClient) {
    this.dashScopeClient = dashScopeClient;
  }

  @GetMapping("/status")
  public ApiResponse<AiChatDtos.StatusResponse> status() {
    return ApiResponse.ok(dashScopeClient.status());
  }

  @PostMapping("/optimize-product-info")
  public ApiResponse<AiChatDtos.OptimizeProductInfoResponse> optimizeProductInfo(
      @RequestBody AiChatDtos.OptimizeProductInfoRequest request) throws Exception {
    return ApiResponse.ok(dashScopeClient.optimizeProductInfo(request.productInfo(), request.productImages()));
  }
}
