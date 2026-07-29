package com.youmi.api.verification;

import com.youmi.api.auth.AuthDtos;
import com.youmi.api.auth.AuthService;
import com.youmi.api.common.ApiException;
import com.youmi.api.common.ApiResponse;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
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

@RestController
@RequestMapping("/api")
public class VerificationSessionController {
  private static final Duration SESSION_TTL = Duration.ofMinutes(5);
  private static final SecureRandom RANDOM = new SecureRandom();

  private final AuthService authService;
  private final Clock clock;
  private final String publicBaseUrl;
  private final ConcurrentHashMap<String, VerificationSession> sessions =
      new ConcurrentHashMap<>();

  @Autowired
  public VerificationSessionController(
      AuthService authService,
      @Value("${youmi.verification.public-base-url:https://101.133.149.214/youmi-api}")
          String publicBaseUrl) {
    this(authService, Clock.systemUTC(), publicBaseUrl);
  }

  VerificationSessionController(AuthService authService, Clock clock, String publicBaseUrl) {
    this.authService = authService;
    this.clock = clock;
    this.publicBaseUrl = publicBaseUrl.replaceAll("/+$", "");
  }

  @PostMapping("/verification-sessions")
  public ApiResponse<Map<String, Object>> create(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody(required = false) CreateRequest request) {
    AuthDtos.UserProfile user = currentUser(authorization);
    requireSecurePublicUrl();
    cleanupExpired();

    String purpose = request == null || request.purpose() == null
        ? "huice_sms"
        : request.purpose().trim();
    if (!"huice_sms".equals(purpose)) {
      throw new ApiException(400, "不支持的验证用途");
    }
    String label = request == null || request.label() == null
        ? "慧策手机验证码"
        : request.label().trim();
    if (label.isBlank()) label = "慧策手机验证码";
    if (label.length() > 80) label = label.substring(0, 80);

    long ownerId = user.id();
    sessions.entrySet().removeIf(entry ->
        entry.getValue().ownerId() == ownerId && purpose.equals(entry.getValue().purpose()));
    String id = randomId();
    Instant expiresAt = clock.instant().plus(SESSION_TTL);
    sessions.put(id, new VerificationSession(
        id, ownerId, purpose, label, expiresAt, "", SessionStatus.PENDING));

    Map<String, Object> data = new LinkedHashMap<>();
    data.put("id", id);
    data.put("status", "pending");
    data.put("expiresAt", expiresAt.toString());
    data.put("verificationUrl", publicBaseUrl + "/api/public/verification-sessions/" + id);
    return ApiResponse.ok(data);
  }

  @GetMapping("/verification-sessions/{id}")
  public ApiResponse<Map<String, Object>> poll(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable String id) {
    AuthDtos.UserProfile user = currentUser(authorization);
    VerificationSession session = sessions.get(id);
    if (session == null || session.ownerId() != user.id()) {
      throw new ApiException(404, "验证会话不存在");
    }
    if (session.expiresAt().isBefore(clock.instant())) {
      sessions.remove(id);
      throw new ApiException(404, "验证会话已过期");
    }
    Map<String, Object> data = new LinkedHashMap<>();
    data.put("id", id);
    data.put("expiresAt", session.expiresAt().toString());
    if (session.status() == SessionStatus.SUBMITTED) {
      sessions.remove(id);
      data.put("status", "submitted");
      data.put("code", session.code());
    } else {
      data.put("status", "pending");
    }
    return ApiResponse.ok(data);
  }

  @GetMapping(
      value = "/public/verification-sessions/{id}",
      produces = MediaType.TEXT_HTML_VALUE)
  public ResponseEntity<String> form(@PathVariable String id) {
    VerificationSession session = validPublicSession(id);
    if (session == null) {
      return html(HttpStatus.GONE, resultHtml(
          "验证链接已失效",
          "链接已过期、已使用或不存在。请回到有米AI重新运行任务。"));
    }
    return html(HttpStatus.OK, formHtml(session));
  }

  @PostMapping(
      value = "/public/verification-sessions/{id}",
      consumes = MediaType.APPLICATION_FORM_URLENCODED_VALUE,
      produces = MediaType.TEXT_HTML_VALUE)
  public ResponseEntity<String> submit(
      @PathVariable String id,
      @RequestParam("code") String code) {
    VerificationSession session = validPublicSession(id);
    if (session == null) {
      return html(HttpStatus.GONE, resultHtml(
          "验证链接已失效",
          "链接已过期、已使用或不存在。请回到有米AI重新运行任务。"));
    }
    String normalizedCode = code == null ? "" : code.replaceAll("\\s+", "");
    if (!normalizedCode.matches("\\d{4,8}")) {
      return html(HttpStatus.BAD_REQUEST, formHtml(session, "请输入 4-8 位数字验证码"));
    }
    sessions.computeIfPresent(id, (key, current) -> new VerificationSession(
        current.id(),
        current.ownerId(),
        current.purpose(),
        current.label(),
        current.expiresAt(),
        normalizedCode,
        SessionStatus.SUBMITTED));
    return html(HttpStatus.OK, resultHtml(
        "验证码已提交",
        "有米AI 正在继续完成慧策登录。这个页面可以关闭了。"));
  }

  private VerificationSession validPublicSession(String id) {
    VerificationSession session = sessions.get(id);
    if (session == null) {
      return null;
    }
    if (session.expiresAt().isBefore(clock.instant())) {
      sessions.remove(id);
      return null;
    }
    if (session.status() == SessionStatus.SUBMITTED) {
      return null;
    }
    return session;
  }

  private AuthDtos.UserProfile currentUser(String authorization) {
    String token = authorization != null && authorization.startsWith("Bearer ")
        ? authorization.substring("Bearer ".length()).trim()
        : "";
    return authService.currentUser(token).user();
  }

  private void requireSecurePublicUrl() {
    if (!publicBaseUrl.startsWith("https://")
        && !publicBaseUrl.startsWith("http://127.0.0.1")
        && !publicBaseUrl.startsWith("http://localhost")) {
      throw new ApiException(400, "手机验证码页面必须使用 HTTPS");
    }
  }

  private void cleanupExpired() {
    Instant now = clock.instant();
    sessions.entrySet().removeIf(entry -> entry.getValue().expiresAt().isBefore(now));
  }

  private String randomId() {
    byte[] bytes = new byte[24];
    RANDOM.nextBytes(bytes);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
  }

  private ResponseEntity<String> html(HttpStatus status, String content) {
    return ResponseEntity.status(status)
        .cacheControl(CacheControl.noStore())
        .header(HttpHeaders.PRAGMA, "no-cache")
        .header("Content-Security-Policy",
            "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'")
        .header("X-Content-Type-Options", "nosniff")
        .header("X-Robots-Tag", "noindex, nofollow, noarchive")
        .header("Referrer-Policy", "no-referrer")
        .contentType(MediaType.parseMediaType("text/html;charset=UTF-8"))
        .body(content);
  }

  private String formHtml(VerificationSession session) {
    return formHtml(session, "");
  }

  private String formHtml(VerificationSession session, String error) {
    String errorHtml = error.isBlank() ? "" : "<p class=\"error\">" + escape(error) + "</p>";
    return page(
        escape(session.label()),
        "<p class=\"hint\">验证码仅用于当前这一次慧策登录，提交后立即失效。</p>"
            + errorHtml
            + "<form method=\"post\">"
            + "<label for=\"code\">手机验证码</label>"
            + "<input id=\"code\" name=\"code\" inputmode=\"numeric\" autocomplete=\"one-time-code\""
            + " pattern=\"[0-9]{4,8}\" maxlength=\"8\" autofocus required>"
            + "<button type=\"submit\">确认并继续登录</button>"
            + "</form>"
            + "<p class=\"expire\">链接 5 分钟内有效，请勿转发。</p>");
  }

  private String resultHtml(String title, String message) {
    return page(escape(title),
        "<div class=\"success\">✓</div><p class=\"done\">" + escape(message) + "</p>");
  }

  private String page(String title, String body) {
    return "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">"
        + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,maximum-scale=1\">"
        + "<title>" + title + "</title><style>"
        + "*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;"
        + "padding:24px;background:#f4f7fb;color:#152033;font-family:-apple-system,BlinkMacSystemFont,"
        + "\"Segoe UI\",\"PingFang SC\",\"Microsoft YaHei\",sans-serif}"
        + "main{width:min(100%,420px);background:#fff;border:1px solid #e2e8f2;border-radius:12px;"
        + "padding:30px 24px;box-shadow:0 18px 46px rgba(35,58,95,.12)}"
        + "h1{margin:0 0 10px;font-size:23px;letter-spacing:0}.hint,.expire{color:#6b7890;font-size:14px;"
        + "line-height:1.65}.expire{margin:18px 0 0;text-align:center}label{display:block;margin:24px 0 8px;"
        + "font-size:14px;font-weight:650}input{width:100%;height:50px;padding:0 14px;border:1px solid #cfd9e8;"
        + "border-radius:8px;font-size:22px;letter-spacing:6px;outline:0}input:focus{border-color:#3377f6;"
        + "box-shadow:0 0 0 3px rgba(51,119,246,.12)}button{width:100%;height:48px;margin-top:16px;border:0;"
        + "border-radius:8px;background:#3478f6;color:#fff;font-size:16px;font-weight:650}.error{color:#d9363e;"
        + "font-size:14px}.success{width:54px;height:54px;margin:8px auto 20px;border-radius:50%;display:grid;"
        + "place-items:center;background:#e9f8ef;color:#16a05d;font-size:28px}.done{text-align:center;"
        + "line-height:1.7;color:#42516a}</style></head><body><main><h1>" + title + "</h1>"
        + body + "</main></body></html>";
  }

  private String escape(String value) {
    return value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")
        .replace("'", "&#39;");
  }

  public record CreateRequest(String purpose, String label) {
  }

  private enum SessionStatus {
    PENDING,
    SUBMITTED
  }

  private record VerificationSession(
      String id,
      long ownerId,
      String purpose,
      String label,
      Instant expiresAt,
      String code,
      SessionStatus status) {
  }
}
