package com.youmi.api.video;

import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiResponse;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/product-videos/plan-tasks")
public class ProductVideoPlanJobController {
  private final AdminAuthService auth;
  private final ProductVideoPlanJobs jobs;

  public ProductVideoPlanJobController(AdminAuthService auth, ProductVideoPlanJobs jobs) {
    this.auth = auth;
    this.jobs = jobs;
  }

  @PostMapping
  public ApiResponse<?> create(@RequestHeader(value = "Authorization", required = false) String token,
      @RequestBody ProductVideoPlanJobs.CreateRequest request) throws Exception {
    return ApiResponse.ok(jobs.create(auth.requireUserId(token), request));
  }

  @GetMapping("/{id}")
  public ApiResponse<?> get(@RequestHeader(value = "Authorization", required = false) String token,
      @PathVariable String id) throws Exception {
    return ApiResponse.ok(jobs.get(auth.requireUserId(token), id));
  }

  @PostMapping("/{id}/retry")
  public ApiResponse<?> retry(@RequestHeader(value = "Authorization", required = false) String token,
      @PathVariable String id) throws Exception {
    return ApiResponse.ok(jobs.retry(auth.requireUserId(token), id));
  }
}
