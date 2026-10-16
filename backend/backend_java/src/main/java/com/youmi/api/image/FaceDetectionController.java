package com.youmi.api.image;

import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.ai.CanvasAgentService;
import com.youmi.api.common.ApiException;
import com.youmi.api.common.ApiResponse;
import java.net.URI;
import java.util.List;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/image")
public class FaceDetectionController {
  private final CanvasAgentService agent;
  private final AdminAuthService auth;

  public FaceDetectionController(CanvasAgentService agent, AdminAuthService auth) {
    this.agent = agent;
    this.auth = auth;
  }

  public record Request(String imageUrl) {}
  public record Face(String id, List<Double> box) {}
  public record Response(List<Face> faces) {}

  @PostMapping("/detect-faces")
  public ApiResponse<Response> detect(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody Request request) throws Exception {
    auth.requireUserId(authorization);
    String url = request == null ? null : request.imageUrl();
    validateImage(url);
    // No backend URL download: the configured vision client receives the image.
    var faces = agent.detectImageFaces(url);
    return ApiResponse.ok(new Response(java.util.stream.IntStream.range(0, faces.size())
        .mapToObj(i -> new Face("face-" + (i + 1), faces.get(i).box2d())).toList()));
  }

  static void validateImage(String url) {
    if (url == null || url.isBlank()) throw new ApiException(400, "请先选择图片");
    if (url.startsWith("data:image/")) {
      if (url.length() > 8_000_000 || !url.matches("(?s)^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=\\r\\n]+$"))
        throw new ApiException(400, "图片格式无效或过大，请使用PNG、JPEG或WebP图片");
      return;
    }
    try {
      URI uri = URI.create(url);
      String host = uri.getHost();
      if (url.length() > 4096 || !"https".equalsIgnoreCase(uri.getScheme()) || host == null
          || uri.getUserInfo() != null || host.equalsIgnoreCase("localhost")
          || host.endsWith(".local") || host.contains(":") || host.matches("[0-9.]+"))
        throw new IllegalArgumentException();
    } catch (IllegalArgumentException error) {
      throw new ApiException(400, "请选择可访问的HTTPS图片，或上传本地图片后重试");
    }
  }
}
