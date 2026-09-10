package com.youmi.api.sycm;

import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiResponse;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/sycm/chat-records")
public class SycmChatController {
  private final AdminAuthService auth;
  private final SycmChatService service;

  public SycmChatController(AdminAuthService auth, SycmChatService service) {
    this.auth = auth;
    this.service = service;
  }

  @PostMapping("/batch")
  public ApiResponse<SycmChatDtos.ImportResult> ingest(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody SycmChatDtos.ImportRequest request) {
    return ApiResponse.ok(service.ingest(auth.requireLogin(authorization).id(), request));
  }

  @GetMapping
  public ApiResponse<SycmChatDtos.Page> list(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestParam String shopId,
      @RequestParam(required = false) String startDate,
      @RequestParam(required = false) String endDate,
      @RequestParam(required = false) String agentId,
      @RequestParam(required = false) String buyerId,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "100") int pageSize) {
    return ApiResponse.ok(service.list(auth.requireLogin(authorization).id(), shopId,
        startDate, endDate, agentId, buyerId, page, pageSize));
  }
}
