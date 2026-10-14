package com.youmi.api.video;

import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiResponse;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/video-playback")
public class VideoPlaybackController {
  private final AdminAuthService auth;
  private final VideoPlaybackService service;

  public VideoPlaybackController(AdminAuthService auth, VideoPlaybackService service) {
    this.auth = auth;
    this.service = service;
  }

  public record Request(String sourceUrl) {}

  @PostMapping
  public ApiResponse<VideoPlaybackService.Result> create(
      @RequestHeader(value = "Authorization", required = false) String token,
      @RequestBody Request request) throws Exception {
    return ApiResponse.ok(service.create(auth.requireUserId(token), request == null ? null : request.sourceUrl()));
  }

  @GetMapping("/{id}")
  public ApiResponse<VideoPlaybackService.Result> get(
      @RequestHeader(value = "Authorization", required = false) String token,
      @PathVariable String id) throws Exception {
    return ApiResponse.ok(service.get(auth.requireUserId(token), id));
  }
}
