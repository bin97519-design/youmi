package com.youmi.api.credential;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CredentialService {
  private static final Duration PAIRING_TTL = Duration.ofMinutes(10);
  private static final Duration REQUEST_SKEW = Duration.ofMinutes(5);
  private static final Duration DEVICE_OFFLINE_AFTER = Duration.ofMinutes(5);
  private static final int DEFAULT_LEASE_SECONDS = 900;
  private static final int MIN_LEASE_SECONDS = 60;
  private static final int MAX_LEASE_SECONDS = 900;

  private final CredentialRepository repository;
  private final CredentialTransportCrypto transportCrypto;
  private final CredentialVault vault;
  private final SycmCredentialPolicy sycmPolicy;
  private final WdtCredentialPolicy wdtPolicy;
  private final ObjectMapper objectMapper;
  private final Clock clock;

  @Autowired
  public CredentialService(
      CredentialRepository repository,
      CredentialTransportCrypto transportCrypto,
      CredentialVault vault,
      SycmCredentialPolicy sycmPolicy,
      WdtCredentialPolicy wdtPolicy,
      ObjectMapper objectMapper) {
    this(repository, transportCrypto, vault, sycmPolicy, wdtPolicy, objectMapper, Clock.systemUTC());
  }

  CredentialService(
      CredentialRepository repository,
      CredentialTransportCrypto transportCrypto,
      CredentialVault vault,
      SycmCredentialPolicy sycmPolicy,
      WdtCredentialPolicy wdtPolicy,
      ObjectMapper objectMapper,
      Clock clock) {
    this.repository = repository;
    this.transportCrypto = transportCrypto;
    this.vault = vault;
    this.sycmPolicy = sycmPolicy;
    this.wdtPolicy = wdtPolicy;
    this.objectMapper = objectMapper;
    this.clock = clock;
  }

  public CredentialDtos.PairingCodeView createPairingCode(long userId, String requestedLabel) {
    String code = pairingCode();
    Instant expiresAt = clock.instant().plus(PAIRING_TTL);
    repository.insertPairingCode(
        UUID.randomUUID().toString(), userId, CredentialSecurity.sha256Hex(normalizeCode(code)),
        limit(requestedLabel, 80, "有米AI登录凭证插件"), LocalDateTime.ofInstant(expiresAt, ZoneOffset.UTC));
    return new CredentialDtos.PairingCodeView(code, expiresAt.toString());
  }

  @Transactional
  public CredentialDtos.PairDeviceView pair(CredentialDtos.PairDeviceRequest request) {
    if (request == null) throw new ApiException(400, "请输入配对码");
    String codeHash = CredentialSecurity.sha256Hex(normalizeCode(request.pairingCode()));
    CredentialRepository.PairingCodeRow code = repository.findPairingCodeForUpdate(codeHash)
        .orElseThrow(() -> new ApiException(400, "配对码无效或已过期"));
    LocalDateTime now = LocalDateTime.ofInstant(clock.instant(), ZoneOffset.UTC);
    if (code.consumedAt() != null || !code.expiresAt().isAfter(now)) {
      throw new ApiException(400, "配对码无效或已过期");
    }
    if (repository.consumePairingCode(code.id()) != 1) {
      throw new ApiException(409, "配对码已被使用");
    }
    String instanceId = required(request.deviceInstanceId(), "设备实例 ID", 128);
    String name = limit(request.deviceName(), 80, "浏览器凭证插件");
    String deviceId = UUID.randomUUID().toString();
    String token = "ymdv_" + CredentialSecurity.randomToken(32);
    repository.insertDevice(
        deviceId, code.userId(), instanceId, name, CredentialSecurity.sha256Hex(token), now);
    repository.audit(code.userId(), deviceId, null, "DEVICE_PAIRED", "device=" + mask(instanceId));
    return new CredentialDtos.PairDeviceView(deviceId, token, clock.instant().toString());
  }

  public CredentialDtos.EncryptionKeyView encryptionKey() {
    return transportCrypto.publicKey();
  }

  @Transactional
  public CredentialDtos.CredentialView upload(
      String deviceToken, String timestamp, String nonce, String signature, String rawBody) {
    CredentialRepository.DeviceRow device = authenticateDevice(deviceToken);
    verifySignedRequest(device, timestamp, nonce, signature, rawBody);
    registerNonce(device, nonce);

    CredentialDtos.UploadCredentialRequest request = readRequest(rawBody);
    String platform = supportedPlatform(request.platform());
    Instant capturedAt = parseCapturedAt(request.capturedAt());
    byte[] plaintext = transportCrypto.decrypt(request.encryptedPayload());
    ValidatedCredential validated = validateCredential(platform, plaintext, request);
    CredentialVault.VaultPayload encrypted = vault.encrypt(validated.json().getBytes(StandardCharsets.UTF_8));

    String accountId = validated.accountId();
    String shopId = validated.shopId();
    String accountName = validated.accountName();
    String shopName = validated.shopName();
    String status = accountId.isBlank() || shopId.isBlank() ? "PENDING_IDENTITY" : "CAPTURED";
    String identityKey = CredentialSecurity.sha256Hex(String.join("|",
        String.valueOf(device.userId()), platform, shopId, accountId, device.id()));
    String environmentJson = safeJson(request.environment());
    LocalDateTime captured = LocalDateTime.ofInstant(capturedAt, ZoneOffset.UTC);
    LocalDateTime expiresAt = validated.expiresAt() == null
        ? null : LocalDateTime.ofInstant(validated.expiresAt(), ZoneOffset.UTC);

    CredentialRepository.CredentialRow existing =
        repository.findCredentialForUpdate(device.userId(), identityKey).orElse(null);
    String credentialId;
    long version;
    if (existing == null) {
      credentialId = UUID.randomUUID().toString();
      repository.insertCredential(
          credentialId, device.userId(), platform, identityKey, device.id(), accountId, accountName,
          shopId, shopName, status, captured, expiresAt, environmentJson, encrypted);
      version = 1L;
    } else {
      credentialId = existing.id();
      version = repository.updateCredential(
          credentialId, device.id(), accountId, accountName, shopId, shopName,
          status, captured, expiresAt, environmentJson, encrypted);
    }
    repository.touchDevice(device.id(), utcNow());
    repository.audit(device.userId(), device.id(), credentialId, "CREDENTIAL_UPLOADED",
        "platform=" + platform + ",cookies=" + validated.cookieCount() + ",version=" + version);
    return repository.listForDevice(device.id(), onlineCutoff(), utcNow()).stream()
        .filter(item -> credentialId.equals(item.credentialId()))
        .findFirst().orElseThrow(() -> new IllegalStateException("凭证上传后无法读取状态"));
  }

  public List<CredentialDtos.CredentialView> listForUser(long userId) {
    return repository.listForUser(userId, onlineCutoff(), utcNow());
  }

  public List<CredentialDtos.CredentialView> listForDevice(String deviceToken) {
    CredentialRepository.DeviceRow device = authenticateDevice(deviceToken);
    return repository.listForDevice(device.id(), onlineCutoff(), utcNow());
  }

  @Transactional
  public CredentialDtos.DisableCredentialView disable(long userId, String requestedCredentialId) {
    String credentialId = required(requestedCredentialId, "凭证 ID", 64);
    if (!credentialId.matches("[A-Za-z0-9_-]{1,64}")) {
      throw new ApiException(400, "凭证 ID 无效");
    }

    CredentialRepository.OwnedCredentialRow credential = repository
        .findOwnedCredentialForUpdate(userId, credentialId)
        .orElseThrow(() -> new ApiException(404, "凭证不存在或已删除"));
    if ("DISABLED".equals(credential.status()) && credential.disabledAt() != null) {
      return disabledView(credentialId, credential.disabledAt());
    }

    LocalDateTime disabledAt = utcNow();
    repository.invalidateActiveLeasesForCredential(
        userId, credentialId, disabledAt, "credential disabled by user");
    repository.disableCredential(userId, credentialId, disabledAt);
    repository.audit(userId, credential.sourceDeviceId(), credentialId,
        "CREDENTIAL_DISABLED_BY_USER", "credential=" + mask(credentialId));
    return disabledView(credentialId, disabledAt);
  }

  @Transactional
  public CredentialDtos.CredentialLeaseView lease(
      long userId, CredentialDtos.LeaseCredentialRequest request) {
    if (request == null) throw new ApiException(400, "凭证租用请求无效");
    String platform = supportedPlatform(request.platform());
    String shopId = required(request.shopId(), "店铺 ID", 128);
    String accountId = optional(request.accountId(), 128);
    String purpose = required(request.purpose(), "租用用途", 80);
    String taskId = required(request.taskId(), "任务 ID", 128);
    String runId = required(request.runId(), "运行 ID", 128);
    int leaseSeconds = leaseSeconds(request.requestedLeaseSeconds());
    LocalDateTime now = utcNow();

    repository.expireLeases(userId, now);
    CredentialRepository.LeasableCredentialRow credential = repository
        .findLeasableCredentialForUpdate(
            userId, platform, shopId, accountId, now, onlineCutoff())
        .orElseThrow(() -> new ApiException(409, "暂无在线可用的" + platformName(platform) + "凭证"));
    String leaseId = UUID.randomUUID().toString();
    LocalDateTime expiresAt = now.plusSeconds(leaseSeconds);
    repository.insertLease(
        leaseId, credential, userId, purpose, taskId, runId, now, expiresAt);
    repository.touchCredentialLastUsed(credential.id(), now);

    JsonNode session = decryptSession(credential);
    repository.audit(userId, credential.sourceDeviceId(), credential.id(), "LEASE_CREATED",
        "lease=" + mask(leaseId) + ",purpose=" + limit(purpose, 40, "task"));
    return new CredentialDtos.CredentialLeaseView(
        leaseId, credential.id(), credential.platform(), credential.accountId(),
        credential.accountName(), credential.shopId(), credential.shopName(),
        credential.credentialVersion(), now.toString(), expiresAt.toString(), session);
  }

  @Transactional
  public CredentialDtos.CredentialLeaseStatusView heartbeatLease(
      long userId, String requestedLeaseId, CredentialDtos.ExtendLeaseRequest request) {
    String leaseId = required(requestedLeaseId, "租约 ID", 64);
    LocalDateTime now = utcNow();
    repository.expireLeases(userId, now);
    CredentialRepository.LeaseRow lease = findLease(userId, leaseId);
    if (!"ACTIVE".equals(lease.status()) || !lease.expiresAt().isAfter(now)) {
      throw new ApiException(409, "凭证租约已结束，请重新租用");
    }
    if (!isDeviceOnline(lease)) {
      repository.finishLease(leaseId, "EXPIRED", now, "source device offline");
      repository.audit(userId, lease.sourceDeviceId(), lease.credentialId(), "LEASE_EXPIRED",
          "lease=" + mask(leaseId) + ",reason=device_offline");
      throw new ApiException(409, "凭证来源设备已离线，请重新打开对应平台页面");
    }
    int seconds = leaseSeconds(request == null ? null : request.requestedLeaseSeconds());
    LocalDateTime expiresAt = now.plusSeconds(seconds);
    if (repository.heartbeatLease(leaseId, now, expiresAt) != 1) {
      throw new ApiException(409, "凭证租约已结束，请重新租用");
    }
    repository.audit(userId, lease.sourceDeviceId(), lease.credentialId(), "LEASE_HEARTBEAT",
        "lease=" + mask(leaseId));
    return new CredentialDtos.CredentialLeaseStatusView(
        leaseId, "ACTIVE", now.toString(), expiresAt.toString());
  }

  @Transactional
  public CredentialDtos.CredentialLeaseStatusView releaseLease(long userId, String requestedLeaseId) {
    String leaseId = required(requestedLeaseId, "租约 ID", 64);
    LocalDateTime now = utcNow();
    repository.expireLeases(userId, now);
    CredentialRepository.LeaseRow lease = findLease(userId, leaseId);
    if ("ACTIVE".equals(lease.status())) {
      repository.finishLease(leaseId, "RELEASED", now, null);
      repository.audit(userId, lease.sourceDeviceId(), lease.credentialId(), "LEASE_RELEASED",
          "lease=" + mask(leaseId));
      return new CredentialDtos.CredentialLeaseStatusView(
          leaseId, "RELEASED", lease.heartbeatAt().toString(), lease.expiresAt().toString());
    }
    return leaseStatus(lease);
  }

  @Transactional
  public CredentialDtos.CredentialLeaseStatusView invalidateLease(
      long userId, String requestedLeaseId, CredentialDtos.InvalidateLeaseRequest request) {
    String leaseId = required(requestedLeaseId, "租约 ID", 64);
    String reason = limit(request == null ? null : request.reason(), 256, "登录态已失效");
    LocalDateTime now = utcNow();
    repository.expireLeases(userId, now);
    CredentialRepository.LeaseRow lease = findLease(userId, leaseId);
    if (!"ACTIVE".equals(lease.status())) {
      throw new ApiException(409, "凭证租约已结束，不能再标记失效");
    }
    if (repository.finishLease(leaseId, "INVALIDATED", now, reason) != 1) {
      throw new ApiException(409, "凭证租约已结束，不能再标记失效");
    }
    repository.invalidateCredentialVersion(
        lease.credentialId(), lease.credentialVersion(), reason);
    repository.audit(userId, lease.sourceDeviceId(), lease.credentialId(), "LEASE_INVALIDATED",
        "lease=" + mask(leaseId) + ",reason=" + reason);
    return new CredentialDtos.CredentialLeaseStatusView(
        leaseId, "INVALIDATED", lease.heartbeatAt().toString(), lease.expiresAt().toString());
  }

  @Transactional
  public CredentialDtos.DeviceHeartbeatView heartbeat(
      String deviceToken, String timestamp, String nonce, String signature, String rawBody) {
    CredentialRepository.DeviceRow device = authenticateDevice(deviceToken);
    String body = rawBody == null ? "" : rawBody;
    verifySignedRequest(device, timestamp, nonce, signature, body);
    registerNonce(device, nonce);
    LocalDateTime seenAt = utcNow();
    repository.touchDevice(device.id(), seenAt);
    return new CredentialDtos.DeviceHeartbeatView(
        device.id(), "ONLINE", seenAt.toString(), DEVICE_OFFLINE_AFTER.toSeconds());
  }

  private void registerNonce(CredentialRepository.DeviceRow device, String nonce) {
    LocalDateTime now = utcNow();
    repository.deleteExpiredNonces(device.id(), now);
    try {
      repository.insertNonce(
          device.id(), nonce,
          LocalDateTime.ofInstant(clock.instant().plus(REQUEST_SKEW), ZoneOffset.UTC));
    } catch (DuplicateKeyException error) {
      throw new ApiException(409, "重复的设备请求");
    }
  }

  private LocalDateTime utcNow() {
    return LocalDateTime.ofInstant(clock.instant(), ZoneOffset.UTC);
  }

  private LocalDateTime onlineCutoff() {
    return LocalDateTime.ofInstant(clock.instant().minus(DEVICE_OFFLINE_AFTER), ZoneOffset.UTC);
  }

  private CredentialRepository.LeaseRow findLease(long userId, String leaseId) {
    return repository.findLeaseForUpdate(userId, leaseId)
        .orElseThrow(() -> new ApiException(404, "凭证租约不存在"));
  }

  private CredentialDtos.CredentialLeaseStatusView leaseStatus(
      CredentialRepository.LeaseRow lease) {
    return new CredentialDtos.CredentialLeaseStatusView(
        lease.id(), lease.status(), lease.heartbeatAt().toString(), lease.expiresAt().toString());
  }

  private CredentialDtos.DisableCredentialView disabledView(
      String credentialId, LocalDateTime disabledAt) {
    return new CredentialDtos.DisableCredentialView(
        credentialId, "DISABLED", false, disabledAt.toString());
  }

  private boolean isDeviceOnline(CredentialRepository.LeaseRow lease) {
    return "ACTIVE".equals(lease.deviceStatus())
        && lease.deviceLastSeenAt() != null
        && !lease.deviceLastSeenAt().isBefore(onlineCutoff());
  }

  private JsonNode decryptSession(CredentialRepository.LeasableCredentialRow credential) {
    CredentialVault.VaultPayload payload = new CredentialVault.VaultPayload(
        credential.encryptedPayload(), credential.encryptedDek(),
        credential.encryptionKeyVersion());
    byte[] plaintext = vault.decrypt(payload);
    try {
      JsonNode session = objectMapper.readTree(plaintext);
      if (session == null || !session.isObject()) {
        throw new ApiException(500, "会话凭证内容无效");
      }
      return session;
    } catch (ApiException error) {
      throw error;
    } catch (Exception error) {
      throw new ApiException(500, "无法读取会话凭证", error);
    }
  }

  private ValidatedCredential validateCredential(
      String platform, byte[] plaintext, CredentialDtos.UploadCredentialRequest request) {
    if ("wdt".equals(platform)) {
      WdtCredentialPolicy.ValidatedPayload validated = wdtPolicy.validate(plaintext);
      return new ValidatedCredential(
          validated.json(), validated.cookieCount(), validated.accountId(),
          validated.accountName(), validated.shopId(), validated.shopName(),
          validated.expiresAt());
    }
    SycmCredentialPolicy.ValidatedPayload validated = sycmPolicy.validate(plaintext);
    return new ValidatedCredential(
        validated.json(), validated.cookieCount(),
        optional(request.accountId(), 128), optional(request.accountName(), 128),
        optional(request.shopId(), 128), optional(request.shopName(), 128), null);
  }

  private String supportedPlatform(String value) {
    String platform = normalize(value);
    if (!"sycm".equals(platform) && !"wdt".equals(platform)) {
      throw new ApiException(400, "仅支持生意参谋或旺店通凭证");
    }
    return platform;
  }

  private String platformName(String platform) {
    return "wdt".equals(platform) ? "旺店通" : "生意参谋";
  }

  private int leaseSeconds(Integer requested) {
    if (requested == null) return DEFAULT_LEASE_SECONDS;
    return Math.max(MIN_LEASE_SECONDS, Math.min(MAX_LEASE_SECONDS, requested));
  }

  private CredentialRepository.DeviceRow authenticateDevice(String token) {
    String clean = token == null ? "" : token.trim();
    if (!clean.startsWith("ymdv_") || clean.length() > 256) {
      throw new ApiException(401, "设备凭证无效");
    }
    return repository.findActiveDeviceByTokenHash(CredentialSecurity.sha256Hex(clean))
        .orElseThrow(() -> new ApiException(401, "设备凭证无效或已撤销"));
  }

  private void verifySignedRequest(
      CredentialRepository.DeviceRow device, String timestamp, String nonce,
      String signature, String rawBody) {
    Instant sentAt;
    try {
      sentAt = Instant.ofEpochMilli(Long.parseLong(timestamp));
    } catch (Exception error) {
      throw new ApiException(401, "设备请求时间无效");
    }
    if (Duration.between(sentAt, clock.instant()).abs().compareTo(REQUEST_SKEW) > 0) {
      throw new ApiException(401, "设备请求已过期");
    }
    if (nonce == null || !nonce.matches("[A-Za-z0-9_-]{16,128}")) {
      throw new ApiException(401, "设备请求 nonce 无效");
    }
    String canonical = timestamp + "\n" + nonce + "\n" + CredentialSecurity.sha256Hex(rawBody);
    String expected = CredentialSecurity.hmacHex(
        CredentialSecurity.hexBytes(device.tokenHash()), canonical);
    if (!CredentialSecurity.secureEquals(expected, signature == null ? "" : signature.toLowerCase(Locale.ROOT))) {
      throw new ApiException(401, "设备请求签名无效");
    }
  }

  private CredentialDtos.UploadCredentialRequest readRequest(String rawBody) {
    try {
      if (rawBody == null || rawBody.isBlank() || rawBody.length() > 600_000) {
        throw new ApiException(400, "凭证上传请求无效");
      }
      return objectMapper.readValue(rawBody, CredentialDtos.UploadCredentialRequest.class);
    } catch (ApiException error) {
      throw error;
    } catch (Exception error) {
      throw new ApiException(400, "凭证上传请求格式无效");
    }
  }

  private Instant parseCapturedAt(String value) {
    try {
      Instant instant = Instant.parse(required(value, "采集时间", 64));
      if (Duration.between(instant, clock.instant()).abs().compareTo(Duration.ofHours(24)) > 0) {
        throw new ApiException(400, "采集时间超出允许范围");
      }
      return instant;
    } catch (DateTimeParseException error) {
      throw new ApiException(400, "采集时间格式无效");
    }
  }

  private String safeJson(com.fasterxml.jackson.databind.JsonNode value) {
    if (value == null || value.isNull()) return "{}";
    try {
      String json = objectMapper.writeValueAsString(value);
      if (json.length() > 8192) throw new ApiException(400, "浏览器环境信息过大");
      return json;
    } catch (JsonProcessingException error) {
      throw new ApiException(400, "浏览器环境信息格式无效");
    }
  }

  private String pairingCode() {
    StringBuilder value = new StringBuilder();
    while (value.length() < 8) {
      value.append(CredentialSecurity.randomToken(8)
          .replace("-", "").replace("_", "").toUpperCase(Locale.ROOT));
    }
    String raw = value.toString();
    return raw.substring(0, 4) + "-" + raw.substring(4, 8);
  }

  private String normalizeCode(String value) {
    String clean = value == null ? "" : value.replaceAll("[^A-Za-z0-9]", "").toUpperCase(Locale.ROOT);
    if (clean.length() != 8) throw new ApiException(400, "配对码格式无效");
    return clean;
  }

  private String normalize(String value) {
    return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
  }

  private String required(String value, String label, int maxLength) {
    String clean = value == null ? "" : value.trim();
    if (clean.isBlank() || clean.length() > maxLength) throw new ApiException(400, label + "无效");
    return clean;
  }

  private String optional(String value, int maxLength) {
    String clean = value == null ? "" : value.trim();
    if (clean.length() > maxLength) throw new ApiException(400, "身份字段过长");
    return clean;
  }

  private String limit(String value, int maxLength, String fallback) {
    String clean = value == null ? "" : value.trim();
    if (clean.isBlank()) clean = fallback;
    return clean.length() > maxLength ? clean.substring(0, maxLength) : clean;
  }

  private String mask(String value) {
    if (value == null || value.length() <= 6) return "***";
    return value.substring(0, 3) + "***" + value.substring(value.length() - 3);
  }

  private record ValidatedCredential(
      String json,
      int cookieCount,
      String accountId,
      String accountName,
      String shopId,
      String shopName,
      Instant expiresAt) {}
}
