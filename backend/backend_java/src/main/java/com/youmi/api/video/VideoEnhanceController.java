package com.youmi.api.video;

import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiResponse;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/video-enhancements")
public class VideoEnhanceController {
  private final AdminAuthService auth;
  private final VideoEnhanceJobs jobs;
  public VideoEnhanceController(AdminAuthService auth, VideoEnhanceJobs jobs) { this.auth = auth; this.jobs = jobs; }
  @GetMapping("/capabilities")
  public ApiResponse<?> capabilities(@RequestHeader(value = "Authorization", required = false) String token) {
    auth.requireUserId(token);
    return ApiResponse.ok(Map.of("available", jobs.available()));
  }
  @PostMapping("/quotes")
  public ApiResponse<?> quote(@RequestHeader(value = "Authorization", required = false) String token,
      @RequestBody VideoEnhanceDtos.QuoteRequest request) throws Exception {
    return ApiResponse.ok(jobs.quote(auth.requireUserId(token), request));
  }
  @PostMapping("/tasks")
  public ApiResponse<?> create(@RequestHeader(value = "Authorization", required = false) String token,
      @RequestBody VideoEnhanceDtos.CreateRequest request) throws Exception {
    return ApiResponse.ok(jobs.create(auth.requireUserId(token), request == null ? null : request.quoteId()));
  }
  @DeleteMapping("/quotes/{id}")
  public ApiResponse<?> discard(@RequestHeader(value = "Authorization", required = false) String token,
      @PathVariable String id) throws Exception {
    jobs.discardQuote(auth.requireUserId(token), id);
    return ApiResponse.ok(Map.of("discarded", true));
  }
  @GetMapping("/tasks")
  public ApiResponse<?> list(@RequestHeader(value = "Authorization", required = false) String token,
      @RequestParam String sourceUrl) throws Exception {
    return ApiResponse.ok(jobs.list(auth.requireUserId(token), sourceUrl));
  }
  @GetMapping("/tasks/{id}")
  public ApiResponse<?> get(@RequestHeader(value = "Authorization", required = false) String token,
      @PathVariable String id) throws Exception { return ApiResponse.ok(jobs.get(auth.requireUserId(token), id)); }
}
