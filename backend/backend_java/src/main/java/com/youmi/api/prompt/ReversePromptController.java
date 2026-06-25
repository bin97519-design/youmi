package com.youmi.api.prompt;

import com.youmi.api.common.ApiResponse;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/prompt")
public class ReversePromptController {
  private final ReversePromptService reversePromptService;

  public ReversePromptController(ReversePromptService reversePromptService) {
    this.reversePromptService = reversePromptService;
  }

  @GetMapping("/categories")
  public ApiResponse<List<ReversePromptDtos.CategoryMeta>> categories() {
    return ApiResponse.ok(reversePromptService.categories());
  }

  @PostMapping("/analyze-image")
  public ApiResponse<ReversePromptDtos.AnalyzeImageResponse> analyzeImage(
      @RequestBody ReversePromptDtos.AnalyzeImageRequest request) throws Exception {
    return ApiResponse.ok(reversePromptService.analyze(request));
  }
}
