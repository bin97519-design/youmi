package com.youmi.api.detail;

import com.youmi.api.common.ApiResponse;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/detail-page")
public class DetailPromptController {
  private final DetailPromptService detailPromptService;

  public DetailPromptController(DetailPromptService detailPromptService) {
    this.detailPromptService = detailPromptService;
  }

  @PostMapping("/prompts")
  public ApiResponse<DetailPromptDtos.PromptResponse> generatePrompts(
      @RequestBody DetailPromptDtos.PromptRequest request) {
    return ApiResponse.ok(detailPromptService.generatePrompts(request));
  }
}
