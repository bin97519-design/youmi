package com.youmi.api.ai;

import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiResponse;
import java.util.Map;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/ai/model-selection-events")
public class ModelSelectionEventController {
  private final AdminAuthService authService;
  private final ModelSelectionEventService eventService;

  public ModelSelectionEventController(AdminAuthService authService, ModelSelectionEventService eventService) {
    this.authService = authService;
    this.eventService = eventService;
  }

  @PostMapping
  public ApiResponse<Map<String, Boolean>> create(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody ModelSelectionEventDtos.CreateRequest request) {
    eventService.record(authService.requireUserId(authorization), request);
    return ApiResponse.ok(Map.of("recorded", true));
  }
}
