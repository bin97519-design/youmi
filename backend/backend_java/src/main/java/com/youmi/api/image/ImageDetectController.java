package com.youmi.api.image;

import com.youmi.api.ai.DashScopeClient;
import com.youmi.api.ai.VisionElement;
import com.youmi.api.ai.XfyunVisionClient;
import com.youmi.api.common.ApiResponse;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/image")
public class ImageDetectController {
  private static final Logger log = LoggerFactory.getLogger(ImageDetectController.class);
  private static final HttpClient httpClient = HttpClient.newBuilder()
      .connectTimeout(Duration.ofSeconds(10))
      .followRedirects(HttpClient.Redirect.ALWAYS)
      .build();

  private final XfyunVisionClient xfyunVisionClient;
  private final DashScopeClient dashScopeClient;

  public ImageDetectController(XfyunVisionClient xfyunVisionClient, DashScopeClient dashScopeClient) {
    this.xfyunVisionClient = xfyunVisionClient;
    this.dashScopeClient = dashScopeClient;
  }

  /**
   * 将图片 URL 解析为 base64 data URI。
   * 如果已经是 data: URI 则直接返回；否则从远程下载并编码。
   */
  private String resolveImageAsBase64(String imageUrl) throws Exception {
    if (imageUrl == null || imageUrl.isBlank()) {
      throw new IllegalArgumentException("imageUrl is empty");
    }
    if (imageUrl.startsWith("data:")) {
      return imageUrl;
    }
    log.info("Downloading image for base64 encode: {}", imageUrl);
    HttpRequest req = HttpRequest.newBuilder()
        .uri(URI.create(imageUrl))
        .timeout(Duration.ofSeconds(15))
        .GET()
        .build();
    HttpResponse<byte[]> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofByteArray());
    if (resp.statusCode() >= 300) {
      throw new IllegalStateException("Image download failed: HTTP " + resp.statusCode());
    }
    byte[] bytes = resp.body();
    String contentType = resp.headers().firstValue("Content-Type").orElse("image/png");
    String b64 = Base64.getEncoder().encodeToString(bytes);
    String dataUri = "data:" + contentType + ";base64," + b64;
    log.info("Image downloaded and encoded: {} bytes → data URI ({} chars)",
        bytes.length, dataUri.length());
    return dataUri;
  }

  @PostMapping(value = "/detect-elements", produces = "application/json;charset=UTF-8")
  public ApiResponse<ImageDetectDtos.DetectResponse> detectElements(
      @RequestBody ImageDetectDtos.DetectRequest request) {

    String imageUri;
    try {
      imageUri = resolveImageAsBase64(request.imageUrl());
    } catch (Exception e) {
      log.error("Failed to resolve image URL: {}", request.imageUrl(), e);
      return ApiResponse.fail(500, "图片加载失败：" + e.getMessage());
    }

    // Use Xfyun vision first.
    if (xfyunVisionClient.isConfigured()) {
      try {
        log.info("Detecting elements with Xfyun vision (model: {})", xfyunVisionClient.model());
        List<VisionElement> detected = xfyunVisionClient.detectImageElements(imageUri);
        List<ImageDetectDtos.DetectedElement> elements = detected.stream()
            .map(el -> new ImageDetectDtos.DetectedElement(el.objectName(), el.box2d()))
            .toList();
        return ApiResponse.ok(new ImageDetectDtos.DetectResponse(elements, request.imageUrl()));
      } catch (Exception e) {
        log.error("Xfyun vision detect failed, fallback to DashScope", e);
        // Fallback to DashScope below.
      }
    }

    // Fallback to DashScope.
    if (dashScopeClient.isConfigured()) {
      try {
        log.info("Detecting elements with DashScope (model: {})", dashScopeClient.model());
        List<VisionElement> detected = dashScopeClient.detectImageElements(imageUri);
        List<ImageDetectDtos.DetectedElement> elements = detected.stream()
            .map(el -> new ImageDetectDtos.DetectedElement(el.objectName(), el.box2d()))
            .toList();
        return ApiResponse.ok(new ImageDetectDtos.DetectResponse(elements, request.imageUrl()));
      } catch (Exception e) {
        log.error("DashScope detect failed", e);
        return ApiResponse.fail(500, "元素检测失败：" + e.getMessage());
      }
    }

    log.warn("No detect API configured (Xfyun vision or DashScope)");
    return ApiResponse.ok(new ImageDetectDtos.DetectResponse(List.of(), request.imageUrl()));
  }
}
