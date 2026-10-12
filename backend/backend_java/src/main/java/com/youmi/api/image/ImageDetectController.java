package com.youmi.api.image;

import com.youmi.api.ai.CanvasAgentService;
import com.youmi.api.ai.VisionElement;
import com.youmi.api.common.ApiException;
import com.youmi.api.common.ApiResponse;
import java.io.IOException;
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

  private final CanvasAgentService canvasAgentService;

  public ImageDetectController(CanvasAgentService canvasAgentService) {
    this.canvasAgentService = canvasAgentService;
    log.info("Image element detection uses fixed Agent model: {}", CanvasAgentService.IMAGE_DETECTION_MODEL);
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
    IOException lastError = null;
    for (int attempt = 1; attempt <= 2; attempt++) {
      try {
        return downloadImageAsBase64(imageUrl);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw e;
      } catch (IOException e) {
        lastError = e;
        if (attempt >= 2) throw e;
        log.warn("Image download transient failure, retrying once: {}", e.getMessage());
        Thread.sleep(300L);
      }
    }
    throw lastError == null ? new IOException("Image download failed") : lastError;
  }

  private String downloadImageAsBase64(String imageUrl) throws Exception {
    log.info("Downloading image for base64 encode: {}", imageUrl);
    HttpRequest req = HttpRequest.newBuilder()
        .uri(URI.create(imageUrl))
        .timeout(Duration.ofSeconds(20))
        .GET()
        .build();
    HttpResponse<byte[]> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofByteArray());
    if (resp.statusCode() == 429 || resp.statusCode() >= 500) {
      throw new IOException("Image download transient response: HTTP " + resp.statusCode());
    }
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

    if (request == null || request.imageUrl() == null || request.imageUrl().isBlank()) {
      return ApiResponse.fail(400, "请先选择需要分层的图片");
    }

    String imageUri;
    try {
      imageUri = resolveImageAsBase64(request.imageUrl());
    } catch (Exception e) {
      log.error("Failed to resolve image URL: {}", request.imageUrl(), e);
      return ApiResponse.fail(500, "图片加载失败：" + e.getMessage());
    }

    try {
      List<VisionElement> detected = canvasAgentService.detectImageElements(imageUri);
      List<ImageDetectDtos.DetectedElement> elements = detected.stream()
          .map(el -> new ImageDetectDtos.DetectedElement(el.objectName(), el.box2d()))
          .toList();
      return ApiResponse.ok(new ImageDetectDtos.DetectResponse(elements, request.imageUrl()));
    } catch (ApiException e) {
      return ApiResponse.fail(e.getCode(), e.getMessage());
    } catch (Exception e) {
      if (e instanceof InterruptedException) Thread.currentThread().interrupt();
      log.error("Agent image element detection failed", e);
      return ApiResponse.fail(500, "智能分层失败：" + e.getMessage());
    }
  }

}
