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
  private final AiChatClient aiChatClient;
  private final MiniMaxM3Client miniMaxM3Client;

  public AiController(AiChatClient aiChatClient, MiniMaxM3Client miniMaxM3Client) {
    this.aiChatClient = aiChatClient;
    this.miniMaxM3Client = miniMaxM3Client;
  }

  @GetMapping("/status")
  public ApiResponse<AiChatDtos.StatusResponse> status() {
    return ApiResponse.ok(aiChatClient.status());
  }

  @PostMapping("/optimize-product-info")
  public ApiResponse<AiChatDtos.OptimizeProductInfoResponse> optimizeProductInfo(
      @RequestBody AiChatDtos.OptimizeProductInfoRequest request) throws Exception {
    return ApiResponse.ok(miniMaxM3Client.optimizeProductInfo(request.productInfo(), request.productImages()));
  }
}
