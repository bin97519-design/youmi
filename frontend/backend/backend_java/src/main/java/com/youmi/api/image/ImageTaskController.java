package com.youmi.api.image;

import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiResponse;
import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.OutputStream;

@RestController
@RequestMapping("/api/image-tasks")
public class ImageTaskController {
  private final ImageGenerationClient imageGenerationClient;
  private final ImageTaskLogService imageTaskLogService;
  private final AdminAuthService adminAuthService;

  public ImageTaskController(
      ImageGenerationClient imageGenerationClient,
      ImageTaskLogService imageTaskLogService,
      AdminAuthService adminAuthService) {
    this.imageGenerationClient = imageGenerationClient;
    this.imageTaskLogService = imageTaskLogService;
    this.adminAuthService = adminAuthService;
  }

  @GetMapping("/status")
  public ApiResponse<ImageGenerationDtos.StatusResponse> status() {
    return ApiResponse.ok(imageGenerationClient.status());
  }

  @PostMapping
  public ApiResponse<ImageGenerationDtos.CreateTaskResponse> create(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody ImageGenerationDtos.CreateTaskRequest request) throws Exception {
    ImageGenerationDtos.CreateTaskResponse response = imageGenerationClient.createTask(request);
    imageTaskLogService.recordCreated(adminAuthService.optionalUserId(authorization), request, response);
    return ApiResponse.ok(response);
  }

  @GetMapping("/{taskId}")
  public ApiResponse<ImageGenerationDtos.TaskStatusResponse> get(@PathVariable String taskId)
      throws Exception {
    ImageGenerationDtos.TaskStatusResponse response = imageGenerationClient.getTask(taskId);
    imageTaskLogService.recordStatus(response);
    return ApiResponse.ok(response);
  }

  /**
   * 图片代理下载接口：解决前端下载跨域图片时 a.download 无效的问题。
   * 后端边从 CDN 接收边向前端流式发送，大图片也能快速开始下载，无需等待完整缓冲。
   */
  @GetMapping("/proxy-download")
  public void proxyDownload(@RequestParam("url") String imageUrl, HttpServletResponse response) throws IOException {
    URI uri;
    try {
      uri = new URI(imageUrl);
    } catch (Exception e) {
      response.sendError(HttpStatus.BAD_REQUEST.value());
      return;
    }
    if (!"https".equals(uri.getScheme()) && !"http".equals(uri.getScheme())) {
      response.sendError(HttpStatus.BAD_REQUEST.value());
      return;
    }
    String host = uri.getHost();
    if (host == null) {
      response.sendError(HttpStatus.BAD_REQUEST.value());
      return;
    }

    // 从 URL 提取文件名和 Content-Type
    String path = uri.getPath();
    String filename = path.substring(path.lastIndexOf('/') + 1);
    if (filename.isBlank()) filename = "image.png";
    String contentType = "application/octet-stream";
    if (filename.endsWith(".png")) contentType = "image/png";
    else if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) contentType = "image/jpeg";
    else if (filename.endsWith(".webp")) contentType = "image/webp";
    else if (filename.endsWith(".gif")) contentType = "image/gif";

    java.net.http.HttpClient client = java.net.http.HttpClient.newBuilder()
        .followRedirects(java.net.http.HttpClient.Redirect.NORMAL)
        .connectTimeout(java.time.Duration.ofSeconds(10))
        .build();
    java.net.http.HttpRequest req = java.net.http.HttpRequest.newBuilder()
        .uri(uri)
        .timeout(java.time.Duration.ofSeconds(120))
        .build();

    java.net.http.HttpResponse<java.io.InputStream> resp;
    try {
      resp = client.send(req, java.net.http.HttpResponse.BodyHandlers.ofInputStream());
    } catch (java.net.http.HttpTimeoutException e) {
      response.sendError(HttpStatus.GATEWAY_TIMEOUT.value(), "Upstream CDN timeout");
      return;
    } catch (Exception e) {
      response.sendError(HttpStatus.BAD_GATEWAY.value(), e.getMessage());
      return;
    }

    if (resp.statusCode() != 200) {
      response.sendError(HttpStatus.BAD_GATEWAY.value(), "Upstream returned " + resp.statusCode());
      return;
    }

    // 设置响应头
    response.setContentType(contentType);
    response.setHeader("Content-Disposition",
        "attachment; filename=\"" + URLEncoder.encode(filename, StandardCharsets.UTF_8) + "\"");
    response.setHeader("Access-Control-Allow-Origin", "*");

    // 流式传输：从 CDN 读取数据，边读边写给前端
    try (java.io.InputStream in = resp.body();
         OutputStream out = response.getOutputStream()) {
      byte[] buffer = new byte[8192];
      int bytesRead;
      while ((bytesRead = in.read(buffer)) != -1) {
        out.write(buffer, 0, bytesRead);
        out.flush();
      }
    }
  }
}
