package com.youmi.api.credential;

import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.auth.UserAccount;
import com.youmi.api.common.ApiException;
import com.youmi.api.common.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class CredentialController {
  private final CredentialService service;
  private final AdminAuthService authService;
  private final boolean requireHttps;

  public CredentialController(
      CredentialService service,
      AdminAuthService authService,
      @Value("${youmi.credentials.require-https:true}") boolean requireHttps) {
    this.service = service;
    this.authService = authService;
    this.requireHttps = requireHttps;
  }

  @PostMapping("/credential-devices/pairing-codes")
  public ApiResponse<CredentialDtos.PairingCodeView> createPairingCode(
      HttpServletRequest servletRequest,
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody(required = false) CredentialDtos.CreatePairingCodeRequest request) {
    requireSecureTransport(servletRequest);
    UserAccount user = authService.requireLogin(authorization);
    return ApiResponse.ok(service.createPairingCode(
        user.id(), request == null ? null : request.label()));
  }

  @PostMapping("/credential-devices/pair")
  public ApiResponse<CredentialDtos.PairDeviceView> pair(
      HttpServletRequest servletRequest,
      @RequestBody CredentialDtos.PairDeviceRequest request) {
    requireSecureTransport(servletRequest);
    return ApiResponse.ok(service.pair(request));
  }

  @GetMapping("/credential-devices/encryption-key")
  public ApiResponse<CredentialDtos.EncryptionKeyView> encryptionKey(
      HttpServletRequest servletRequest) {
    requireSecureTransport(servletRequest);
    return ApiResponse.ok(service.encryptionKey());
  }

  @PostMapping(
      value = "/credential-devices/heartbeat",
      consumes = MediaType.APPLICATION_JSON_VALUE)
  public ApiResponse<CredentialDtos.DeviceHeartbeatView> heartbeat(
      HttpServletRequest servletRequest,
      @RequestHeader(value = "X-Youmi-Device-Token", required = false) String deviceToken,
      @RequestHeader(value = "X-Youmi-Timestamp", required = false) String timestamp,
      @RequestHeader(value = "X-Youmi-Nonce", required = false) String nonce,
      @RequestHeader(value = "X-Youmi-Signature", required = false) String signature,
      @RequestBody(required = false) String rawBody) {
    requireSecureTransport(servletRequest);
    return ApiResponse.ok(service.heartbeat(deviceToken, timestamp, nonce, signature, rawBody));
  }

  @PostMapping(
      value = "/session-credentials/upload",
      consumes = MediaType.APPLICATION_JSON_VALUE)
  public ApiResponse<CredentialDtos.CredentialView> upload(
      HttpServletRequest servletRequest,
      @RequestHeader(value = "X-Youmi-Device-Token", required = false) String deviceToken,
      @RequestHeader(value = "X-Youmi-Timestamp", required = false) String timestamp,
      @RequestHeader(value = "X-Youmi-Nonce", required = false) String nonce,
      @RequestHeader(value = "X-Youmi-Signature", required = false) String signature,
      @RequestBody String rawBody) {
    requireSecureTransport(servletRequest);
    return ApiResponse.ok("生意参谋登录凭证已安全同步",
        service.upload(deviceToken, timestamp, nonce, signature, rawBody));
  }

  @GetMapping("/session-credentials")
  public ApiResponse<List<CredentialDtos.CredentialView>> listForUser(
      HttpServletRequest servletRequest,
      @RequestHeader(value = "Authorization", required = false) String authorization) {
    requireSecureTransport(servletRequest);
    UserAccount user = authService.requireLogin(authorization);
    return ApiResponse.ok(service.listForUser(user.id()));
  }

  @PostMapping("/session-credential-leases")
  public ApiResponse<CredentialDtos.CredentialLeaseView> lease(
      HttpServletRequest servletRequest,
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody CredentialDtos.LeaseCredentialRequest request) {
    requireSecureTransport(servletRequest);
    UserAccount user = authService.requireLogin(authorization);
    return ApiResponse.ok(service.lease(user.id(), request));
  }

  @PostMapping("/session-credential-leases/{leaseId}/heartbeat")
  public ApiResponse<CredentialDtos.CredentialLeaseStatusView> heartbeatLease(
      HttpServletRequest servletRequest,
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable String leaseId,
      @RequestBody(required = false) CredentialDtos.ExtendLeaseRequest request) {
    requireSecureTransport(servletRequest);
    UserAccount user = authService.requireLogin(authorization);
    return ApiResponse.ok(service.heartbeatLease(user.id(), leaseId, request));
  }

  @PostMapping("/session-credential-leases/{leaseId}/release")
  public ApiResponse<CredentialDtos.CredentialLeaseStatusView> releaseLease(
      HttpServletRequest servletRequest,
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable String leaseId) {
    requireSecureTransport(servletRequest);
    UserAccount user = authService.requireLogin(authorization);
    return ApiResponse.ok(service.releaseLease(user.id(), leaseId));
  }

  @PostMapping("/session-credential-leases/{leaseId}/invalidate")
  public ApiResponse<CredentialDtos.CredentialLeaseStatusView> invalidateLease(
      HttpServletRequest servletRequest,
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable String leaseId,
      @RequestBody(required = false) CredentialDtos.InvalidateLeaseRequest request) {
    requireSecureTransport(servletRequest);
    UserAccount user = authService.requireLogin(authorization);
    return ApiResponse.ok(service.invalidateLease(user.id(), leaseId, request));
  }

  @GetMapping("/credential-devices/me/session-credentials")
  public ApiResponse<List<CredentialDtos.CredentialView>> listForDevice(
      HttpServletRequest servletRequest,
      @RequestHeader(value = "X-Youmi-Device-Token", required = false) String deviceToken) {
    requireSecureTransport(servletRequest);
    return ApiResponse.ok(service.listForDevice(deviceToken));
  }

  private void requireSecureTransport(HttpServletRequest request) {
    if (!requireHttps) return;
    String forwardedProto = request.getHeader("X-Forwarded-Proto");
    if (request.isSecure() || "https".equalsIgnoreCase(forwardedProto)) return;
    throw new ApiException(426, "凭证接口仅允许通过 HTTPS 访问");
  }
}
