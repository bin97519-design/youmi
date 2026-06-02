package com.youmi.api.ai;

import com.youmi.api.common.ApiResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/ai")
public class AiController {
  private final AiChatClient aiChatClient;

  public AiController(AiChatClient aiChatClient) {
    this.aiChatClient = aiChatClient;
  }

  @GetMapping("/status")
  public ApiResponse<AiChatDtos.StatusResponse> status() {
    return ApiResponse.ok(aiChatClient.status());
  }
}
