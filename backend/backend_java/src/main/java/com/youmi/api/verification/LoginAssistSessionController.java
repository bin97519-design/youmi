package com.youmi.api.verification;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import org.springframework.web.bind.annotation.RestController;

/**
 * Short-lived, end-to-end encrypted relay used when a desktop browser needs human login help.
 * The server only stores RSA public keys and ciphertext. Plaintext credentials never reach it.
 */
@RestController
@RequestMapping("/api")
public class LoginAssistSessionController {
  private static final Duration SESSION_TTL = Duration.ofMinutes(10);
  private static final SecureRandom RANDOM = new SecureRandom();
  private static final int MAX_CIPHERTEXT_LENGTH = 8192;

  private final AuthService authService;
  private final ObjectMapper objectMapper;
  private final Clock clock;
  private final String publicBaseUrl;
  private final ConcurrentHashMap<String, LoginAssistSession> sessions = new ConcurrentHashMap<>();

  @Autowired
  public LoginAssistSessionController(
      AuthService authService,
      ObjectMapper objectMapper,
      @Value("${youmi.verification.public-base-url:https://101.133.149.214/youmi-api}")
          String publicBaseUrl) {
    this(authService, objectMapper, Clock.systemUTC(), publicBaseUrl);
  }

  LoginAssistSessionController(
      AuthService authService, ObjectMapper objectMapper, Clock clock, String publicBaseUrl) {
    this.authService = authService;
    this.objectMapper = objectMapper;
    this.clock = clock;
    this.publicBaseUrl = publicBaseUrl.replaceAll("/+$", "");
  }

  @PostMapping("/login-assist-sessions")
  public ApiResponse<Map<String, Object>> create(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody CreateRequest request) {
    AuthDtos.UserProfile user = currentUser(authorization);
    requireSecurePublicUrl();
    cleanupExpired();
    if (request == null || !"sycm_login".equals(normalize(request.purpose()))) {
      throw new ApiException(400, "不支持的登录协助用途");
    }
    String origin = normalize(request.origin());
    if (!"https://sycm.taobao.com".equals(origin)) {
      throw new ApiException(400, "登录协助仅允许用于生意参谋");
    }
    String publicKeyJwk = normalize(request.publicKeyJwk());
    validatePublicKey(publicKeyJwk);
    String label = normalize(request.label());
    if (label.isBlank()) label = "生意参谋登录协助";
    if (label.length() > 80) label = label.substring(0, 80);

    long ownerId = user.id();
    sessions.entrySet().removeIf(entry -> entry.getValue().ownerId == ownerId
        && "sycm_login".equals(entry.getValue().purpose));
    String id = randomId();
    Instant expiresAt = clock.instant().plus(SESSION_TTL);
    sessions.put(id, new LoginAssistSession(
        id, ownerId, "sycm_login", origin, label, publicKeyJwk, expiresAt));

    Map<String, Object> data = new LinkedHashMap<>();
    data.put("id", id);
    data.put("status", "active");
    data.put("stage", "credentials");
    data.put("expiresAt", expiresAt.toString());
    data.put("assistUrl", publicBaseUrl + "/api/public/login-assist-sessions/" + id);
    return ApiResponse.ok(data);
  }

  @GetMapping("/login-assist-sessions/{id}")
  public ApiResponse<Map<String, Object>> poll(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable String id) {
    LoginAssistSession session = ownedSession(authorization, id);
    Map<String, Object> data = snapshot(session, false);
    synchronized (session) {
      if (!session.ciphertext.isBlank()) {
        data.put("payloadStage", session.payloadStage.apiValue);
        data.put("ciphertext", session.ciphertext);
        session.ciphertext = "";
        session.payloadStage = null;
      }
    }
    return ApiResponse.ok(data);
  }

  @PostMapping("/login-assist-sessions/{id}/state")
  public ApiResponse<Map<String, Object>> updateState(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable String id,
      @RequestBody StateRequest request) {
    LoginAssistSession session = ownedSession(authorization, id);
    SessionStatus status = parseStatus(request == null ? null : request.status());
    AssistStage stage = parseStage(request == null ? null : request.stage());
    String message = normalize(request == null ? null : request.message());
    if (message.length() > 160) message = message.substring(0, 160);
    synchronized (session) {
      if (status != null) session.status = status;
      if (stage != null) session.stage = stage;
      session.message = message;
      if (session.status != SessionStatus.ACTIVE) {
        session.ciphertext = "";
        session.payloadStage = null;
      }
    }
    return ApiResponse.ok(snapshot(session, false));
  }

  @GetMapping(value = "/public/login-assist-sessions/{id}", produces = MediaType.TEXT_HTML_VALUE)
  public ResponseEntity<String> page(@PathVariable String id) {
    LoginAssistSession session = publicSession(id);
    if (session == null) {
      return html(HttpStatus.GONE, expiredHtml(), "");
    }
    String nonce = randomId();
    return html(HttpStatus.OK, assistHtml(session, nonce), nonce);
  }

  @GetMapping(
      value = "/public/login-assist-sessions/{id}/status",
      produces = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<Map<String, Object>> publicStatus(@PathVariable String id) {
    LoginAssistSession session = publicSession(id);
    if (session == null) {
      return ResponseEntity.status(HttpStatus.GONE)
          .cacheControl(CacheControl.noStore())
          .body(Map.of("status", "expired"));
    }
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(snapshot(session, true));
  }

  @PostMapping(
      value = "/public/login-assist-sessions/{id}/submit",
      consumes = MediaType.APPLICATION_JSON_VALUE,
      produces = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<Map<String, Object>> submit(
      @PathVariable String id,
      @RequestBody SubmitRequest request) {
    LoginAssistSession session = publicSession(id);
    if (session == null) {
      return ResponseEntity.status(HttpStatus.GONE)
          .cacheControl(CacheControl.noStore())
          .body(Map.of("status", "expired", "message", "登录协助链接已失效"));
    }
    AssistStage submittedStage = parseStage(request == null ? null : request.stage());
    String ciphertext = normalize(request == null ? null : request.ciphertext());
    if (submittedStage == null || submittedStage == AssistStage.WAITING) {
      throw new ApiException(400, "无效的登录协助阶段");
    }
    if (ciphertext.isBlank() || ciphertext.length() > MAX_CIPHERTEXT_LENGTH
        || !ciphertext.matches("[A-Za-z0-9_\\-+/=]+")) {
      throw new ApiException(400, "加密数据格式无效");
    }
    synchronized (session) {
      if (session.status != SessionStatus.ACTIVE || session.stage != submittedStage) {
        throw new ApiException(409, "登录步骤已更新，请刷新页面后重试");
      }
      if (!session.ciphertext.isBlank()) {
        throw new ApiException(409, "信息已提交，正在等待本机处理");
      }
      session.ciphertext = ciphertext;
      session.payloadStage = submittedStage;
      session.stage = AssistStage.WAITING;
      session.message = "信息已安全提交，正在等待本机处理";
    }
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(Map.of("status", "submitted"));
  }

  private Map<String, Object> snapshot(LoginAssistSession session, boolean includePublicKey) {
    synchronized (session) {
      Map<String, Object> data = new LinkedHashMap<>();
      data.put("id", session.id);
      data.put("status", session.status.apiValue);
      data.put("stage", session.stage.apiValue);
      data.put("label", session.label);
      data.put("message", session.message);
      data.put("expiresAt", session.expiresAt.toString());
      if (includePublicKey) data.put("publicKeyJwk", session.publicKeyJwk);
      return data;
    }
  }

  private LoginAssistSession ownedSession(String authorization, String id) {
    AuthDtos.UserProfile user = currentUser(authorization);
    LoginAssistSession session = sessions.get(id);
    if (session == null || session.ownerId != user.id()) {
      throw new ApiException(404, "登录协助会话不存在");
    }
    if (session.expiresAt.isBefore(clock.instant())) {
      sessions.remove(id);
      throw new ApiException(404, "登录协助会话已过期");
    }
    return session;
  }

  private LoginAssistSession publicSession(String id) {
    LoginAssistSession session = sessions.get(id);
    if (session == null) return null;
    if (session.expiresAt.isBefore(clock.instant())) {
      sessions.remove(id);
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

  private void validatePublicKey(String publicKeyJwk) {
    if (publicKeyJwk.isBlank() || publicKeyJwk.length() > 4096) {
      throw new ApiException(400, "缺少本机加密公钥");
    }
    try {
      JsonNode jwk = objectMapper.readTree(publicKeyJwk);
      if (!"RSA".equals(jwk.path("kty").asText())
          || jwk.path("n").asText().length() < 300
          || jwk.path("e").asText().isBlank()) {
        throw new IllegalArgumentException("invalid jwk");
      }
    } catch (Exception error) {
      throw new ApiException(400, "本机加密公钥格式无效");
    }
  }

  private void requireSecurePublicUrl() {
    if (!publicBaseUrl.startsWith("https://")
        && !publicBaseUrl.startsWith("http://127.0.0.1")
        && !publicBaseUrl.startsWith("http://localhost")) {
      throw new ApiException(400, "登录协助页面必须使用 HTTPS");
    }
  }

  private void cleanupExpired() {
    Instant now = clock.instant();
    sessions.entrySet().removeIf(entry -> entry.getValue().expiresAt.isBefore(now));
  }

  private String randomId() {
    byte[] bytes = new byte[24];
    RANDOM.nextBytes(bytes);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
  }

  private SessionStatus parseStatus(String value) {
    String normalized = normalize(value);
    if (normalized.isBlank()) return null;
    for (SessionStatus status : SessionStatus.values()) {
      if (status.apiValue.equals(normalized)) return status;
    }
    throw new ApiException(400, "无效的登录协助状态");
  }

  private AssistStage parseStage(String value) {
    String normalized = normalize(value);
    if (normalized.isBlank()) return null;
    for (AssistStage stage : AssistStage.values()) {
      if (stage.apiValue.equals(normalized)) return stage;
    }
    throw new ApiException(400, "无效的登录协助步骤");
  }

  private String normalize(String value) {
    return value == null ? "" : value.trim();
  }

  private ResponseEntity<String> html(HttpStatus status, String content, String nonce) {
    String scriptPolicy = nonce.isBlank() ? "'none'" : "'nonce-" + nonce + "'";
    return ResponseEntity.status(status)
        .cacheControl(CacheControl.noStore())
        .header(HttpHeaders.PRAGMA, "no-cache")
        .header("Content-Security-Policy",
            "default-src 'none'; style-src 'unsafe-inline'; script-src " + scriptPolicy
                + "; connect-src 'self'; form-action 'none'; frame-ancestors 'none'")
        .header("X-Content-Type-Options", "nosniff")
        .header("X-Robots-Tag", "noindex, nofollow, noarchive")
        .header("Referrer-Policy", "no-referrer")
        .contentType(MediaType.parseMediaType("text/html;charset=UTF-8"))
        .body(content);
  }

  private String expiredHtml() {
    return page("登录协助链接已失效",
        "<p class=\"done\">链接已过期、已完成或不存在，请让有米AI重新发起登录协助。</p>", "");
  }

  private String assistHtml(LoginAssistSession session, String nonce) {
    String script = """
        <script nonce="%s">
        const statusUrl = location.pathname + '/status';
        const submitUrl = location.pathname + '/submit';
        const root = document.getElementById('root');
        let lastStage = '';
        const esc = value => String(value || '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
        const bytesToBase64 = bytes => { let out=''; bytes.forEach(b => out += String.fromCharCode(b)); return btoa(out); };
        async function encrypt(publicKeyJwk, value) {
          const key = await crypto.subtle.importKey('jwk', JSON.parse(publicKeyJwk), {name:'RSA-OAEP',hash:'SHA-256'}, false, ['encrypt']);
          const data = new TextEncoder().encode(JSON.stringify(value));
          return bytesToBase64(new Uint8Array(await crypto.subtle.encrypt({name:'RSA-OAEP'}, key, data)));
        }
        function render(data) {
          if (data.status === 'completed') { root.innerHTML='<div class="success">✓</div><h1>登录完成</h1><p class="done">本机有米AI已恢复生意参谋任务，可以关闭此页面。</p>'; return; }
          if (data.status === 'failed' || data.status === 'expired') { root.innerHTML='<h1>登录协助已结束</h1><p class="error">'+esc(data.message || '请联系任务发起人重新尝试')+'</p>'; return; }
          if (data.stage === 'waiting') { root.innerHTML='<div class="spinner"></div><h1>正在安全处理</h1><p class="done">'+esc(data.message || '请保持页面打开，本机正在继续登录')+'</p>'; return; }
          const sms = data.stage === 'sms';
          root.innerHTML='<h1>'+esc(data.label)+'</h1><p class="hint">'+(sms ? '验证码只用于本次生意参谋登录。' : '账号和密码会在此设备上加密，服务器只中转密文。')+'</p>'
            +'<form id="assistForm">'
            +(sms ? '<label>手机验证码</label><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required>'
              : '<label>生意参谋账号</label><input name="account" autocomplete="username" required><label>密码</label><input name="password" type="password" autocomplete="current-password" required>')
            +'<button type="submit">安全提交并继续</button><p id="error" class="error"></p></form>'
            +'<p class="expire">链接 10 分钟内有效，请勿转发。</p>';
          document.getElementById('assistForm').addEventListener('submit', async event => {
            event.preventDefault(); const form = new FormData(event.currentTarget); const button = event.currentTarget.querySelector('button'); const error = document.getElementById('error');
            button.disabled=true; error.textContent='';
            try {
              const value = sms ? {code:String(form.get('code') || '').replace(/\\s+/g,'')} : {account:String(form.get('account') || '').trim(),password:String(form.get('password') || '')};
              const ciphertext = await encrypt(data.publicKeyJwk, value);
              const response = await fetch(submitUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stage:data.stage,ciphertext})});
              const result = await response.json(); if(!response.ok) throw new Error(result.message || '提交失败'); lastStage=''; await refresh();
            } catch (e) { error.textContent=e.message || String(e); button.disabled=false; }
          });
        }
        async function refresh() {
          try { const response=await fetch(statusUrl,{cache:'no-store'}); const data=await response.json(); const marker=data.status+':'+data.stage+':'+(data.message||''); if(marker!==lastStage){lastStage=marker;render(data);} }
          catch(e){ root.innerHTML='<h1>连接中断</h1><p class="error">请刷新页面后重试。</p>'; }
        }
        refresh(); setInterval(refresh,2000);
        </script>
        """.formatted(nonce);
    return page(escape(session.label), "<div id=\"root\"></div>" + script, nonce);
  }

  private String page(String title, String body, String nonce) {
    return "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">"
        + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,maximum-scale=1\">"
        + "<title>" + title + "</title><style>"
        + "*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f4f7fb;color:#152033;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",\"PingFang SC\",\"Microsoft YaHei\",sans-serif}"
        + "main{width:min(100%,430px);background:#fff;border:1px solid #e2e8f2;border-radius:12px;padding:30px 24px;box-shadow:0 18px 46px rgba(35,58,95,.12)}"
        + "h1{margin:0 0 10px;font-size:23px}.hint,.expire,.done{color:#6b7890;font-size:14px;line-height:1.65}.expire{text-align:center;margin:18px 0 0}label{display:block;margin:20px 0 8px;font-size:14px;font-weight:650}"
        + "input{width:100%;height:48px;padding:0 14px;border:1px solid #cfd9e8;border-radius:8px;font-size:16px;outline:0}input:focus{border-color:#3377f6;box-shadow:0 0 0 3px rgba(51,119,246,.12)}"
        + "button{width:100%;height:48px;margin-top:18px;border:0;border-radius:8px;background:#3478f6;color:#fff;font-size:16px;font-weight:650}button:disabled{opacity:.55}.error{color:#d9363e;font-size:14px;line-height:1.6}.success{width:54px;height:54px;margin:8px auto 20px;border-radius:50%;display:grid;place-items:center;background:#e9f8ef;color:#16a05d;font-size:28px}.spinner{width:42px;height:42px;margin:8px auto 24px;border:4px solid #e5ecf8;border-top-color:#3478f6;border-radius:50%;animation:spin .9s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}"
        + "</style></head><body><main>" + body + "</main></body></html>";
  }

  private String escape(String value) {
    return value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")
        .replace("'", "&#39;");
  }

  public record CreateRequest(
      String purpose, String origin, String label, String publicKeyJwk) {
  }

  public record StateRequest(String status, String stage, String message) {
  }

  public record SubmitRequest(String stage, String ciphertext) {
  }

  private enum SessionStatus {
    ACTIVE("active"), COMPLETED("completed"), FAILED("failed");
    private final String apiValue;
    SessionStatus(String apiValue) { this.apiValue = apiValue; }
  }

  private enum AssistStage {
    CREDENTIALS("credentials"), SMS("sms"), WAITING("waiting");
    private final String apiValue;
    AssistStage(String apiValue) { this.apiValue = apiValue; }
  }

  private static final class LoginAssistSession {
    private final String id;
    private final long ownerId;
    private final String purpose;
    private final String origin;
    private final String label;
    private final String publicKeyJwk;
    private final Instant expiresAt;
    private SessionStatus status = SessionStatus.ACTIVE;
    private AssistStage stage = AssistStage.CREDENTIALS;
    private String message = "请填写生意参谋登录信息";
    private String ciphertext = "";
    private AssistStage payloadStage;

    private LoginAssistSession(
        String id, long ownerId, String purpose, String origin, String label,
        String publicKeyJwk, Instant expiresAt) {
      this.id = id;
      this.ownerId = ownerId;
      this.purpose = purpose;
      this.origin = origin;
      this.label = label;
      this.publicKeyJwk = publicKeyJwk;
      this.expiresAt = expiresAt;
    }
  }
}
