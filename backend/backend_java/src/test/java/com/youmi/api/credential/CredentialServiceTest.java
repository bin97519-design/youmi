package com.youmi.api.credential;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.spec.MGF1ParameterSpec;
import java.security.spec.RSAPublicKeySpec;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.List;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.OAEPParameterSpec;
import javax.crypto.spec.PSource;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class CredentialServiceTest {
  private static final Instant NOW = Instant.parse("2026-09-03T04:00:00Z");

  private ObjectMapper objectMapper;
  private JdbcTemplate jdbcTemplate;
  private CredentialRepository repository;
  private CredentialTransportCrypto transportCrypto;
  private CredentialVault vault;
  private CredentialService service;

  @BeforeEach
  void setUp() {
    var dataSource = new DriverManagerDataSource(
        "jdbc:h2:mem:credential-center;MODE=MySQL;DB_CLOSE_DELAY=-1", "sa", "");
    jdbcTemplate = new JdbcTemplate(dataSource);
    resetSchema();
    objectMapper = new ObjectMapper();
    repository = new CredentialRepository(jdbcTemplate);
    transportCrypto = new CredentialTransportCrypto(objectMapper);
    String masterKey = Base64.getEncoder().encodeToString("0123456789abcdef0123456789abcdef"
        .getBytes(StandardCharsets.UTF_8));
    vault = new CredentialVault(masterKey, "test-v1");
    service = new CredentialService(
        repository, transportCrypto, vault, new SycmCredentialPolicy(objectMapper),
        new WdtCredentialPolicy(objectMapper, Clock.fixed(NOW, ZoneOffset.UTC)),
        objectMapper, Clock.fixed(NOW, ZoneOffset.UTC));
  }

  @Test
  void pairsDeviceAndStoresOnlyEncryptedCredentialWithServerVersioning() throws Exception {
    CredentialDtos.PairingCodeView pairing = service.createPairingCode(42L, "测试浏览器");
    CredentialDtos.PairDeviceView device = service.pair(new CredentialDtos.PairDeviceRequest(
        pairing.pairingCode(), "extension-instance-1", "测试浏览器"));

    String body = uploadBody();
    String nonce = "nonce_1234567890123456";
    CredentialDtos.CredentialView first = service.upload(
        device.deviceToken(), String.valueOf(NOW.toEpochMilli()), nonce,
        signature(device.deviceToken(), NOW.toEpochMilli(), nonce, body), body);

    assertEquals("CAPTURED", first.status());
    assertEquals(device.deviceId(), first.deviceId());
    assertEquals("测试浏览器", first.deviceName());
    assertEquals("ONLINE", first.deviceStatus());
    assertTrue(first.available());
    assertEquals(1L, first.credentialVersion());
    String encryptedPayload = jdbcTemplate.queryForObject(
        "SELECT encrypted_payload FROM ym_session_credential", String.class);
    assertFalse(encryptedPayload.contains("secret-cookie-value"));
    CredentialVault.VaultPayload stored = new CredentialVault.VaultPayload(
        encryptedPayload,
        jdbcTemplate.queryForObject("SELECT encrypted_dek FROM ym_session_credential", String.class),
        "test-v1");
    assertTrue(new String(vault.decryptForTest(stored), StandardCharsets.UTF_8)
        .contains("secret-cookie-value"));

    ApiException replay = assertThrows(ApiException.class, () -> service.upload(
        device.deviceToken(), String.valueOf(NOW.toEpochMilli()), nonce,
        signature(device.deviceToken(), NOW.toEpochMilli(), nonce, body), body));
    assertEquals(409, replay.getCode());

    String secondNonce = "nonce_2345678901234567";
    CredentialDtos.CredentialView second = service.upload(
        device.deviceToken(), String.valueOf(NOW.toEpochMilli()), secondNonce,
        signature(device.deviceToken(), NOW.toEpochMilli(), secondNonce, body), body);
    assertEquals(2L, second.credentialVersion());
    assertEquals(1, service.listForUser(42L).size());
  }

  @Test
  void marksCredentialOfflineAfterFiveMinutesAndHeartbeatRestoresIt() throws Exception {
    CredentialDtos.PairingCodeView pairing = service.createPairingCode(42L, "心跳测试浏览器");
    CredentialDtos.PairDeviceView device = service.pair(new CredentialDtos.PairDeviceRequest(
        pairing.pairingCode(), "heartbeat-instance", "心跳测试浏览器"));
    String uploadBody = uploadBody();
    String uploadNonce = "nonce_heartbeat_upload_1";
    service.upload(
        device.deviceToken(), String.valueOf(NOW.toEpochMilli()), uploadNonce,
        signature(device.deviceToken(), NOW.toEpochMilli(), uploadNonce, uploadBody), uploadBody);

    Instant offlineAt = NOW.plusSeconds(301);
    CredentialService offlineService = new CredentialService(
        repository, transportCrypto, vault, new SycmCredentialPolicy(objectMapper),
        new WdtCredentialPolicy(objectMapper, Clock.fixed(offlineAt, ZoneOffset.UTC)),
        objectMapper, Clock.fixed(offlineAt, ZoneOffset.UTC));
    CredentialDtos.CredentialView offline = offlineService.listForUser(42L).get(0);
    assertEquals("OFFLINE", offline.status());
    assertEquals("OFFLINE", offline.deviceStatus());
    assertFalse(offline.available());

    String heartbeatBody = "{}";
    String heartbeatNonce = "nonce_heartbeat_restore_1";
    CredentialDtos.DeviceHeartbeatView heartbeat = offlineService.heartbeat(
        device.deviceToken(), String.valueOf(offlineAt.toEpochMilli()), heartbeatNonce,
        signature(device.deviceToken(), offlineAt.toEpochMilli(), heartbeatNonce, heartbeatBody),
        heartbeatBody);
    assertEquals("ONLINE", heartbeat.status());
    assertEquals(300L, heartbeat.offlineAfterSeconds());

    CredentialDtos.CredentialView restored = offlineService.listForUser(42L).get(0);
    assertEquals("CAPTURED", restored.status());
    assertEquals("ONLINE", restored.deviceStatus());
    assertTrue(restored.available());
  }

  @Test
  void listsTheSourceDeviceForEachCredential() throws Exception {
    CredentialDtos.PairingCodeView firstPairing = service.createPairingCode(42L, "办公室电脑-A");
    CredentialDtos.PairDeviceView firstDevice = service.pair(new CredentialDtos.PairDeviceRequest(
        firstPairing.pairingCode(), "device-a", "办公室电脑-A"));
    CredentialDtos.PairingCodeView secondPairing = service.createPairingCode(42L, "仓库电脑-B");
    CredentialDtos.PairDeviceView secondDevice = service.pair(new CredentialDtos.PairDeviceRequest(
        secondPairing.pairingCode(), "device-b", "仓库电脑-B"));
    String body = uploadBody();

    service.upload(firstDevice.deviceToken(), String.valueOf(NOW.toEpochMilli()),
        "nonce_device_a_upload_12",
        signature(firstDevice.deviceToken(), NOW.toEpochMilli(),
            "nonce_device_a_upload_12", body), body);
    service.upload(secondDevice.deviceToken(), String.valueOf(NOW.toEpochMilli()),
        "nonce_device_b_upload_12",
        signature(secondDevice.deviceToken(), NOW.toEpochMilli(),
            "nonce_device_b_upload_12", body), body);

    List<CredentialDtos.CredentialView> credentials = service.listForUser(42L);
    assertEquals(2, credentials.size());
    assertTrue(credentials.stream().anyMatch(item -> firstDevice.deviceId().equals(item.deviceId())
        && "办公室电脑-A".equals(item.deviceName())));
    assertTrue(credentials.stream().anyMatch(item -> secondDevice.deviceId().equals(item.deviceId())
        && "仓库电脑-B".equals(item.deviceName())));
  }

  @Test
  void rejectsNonWhitelistedCookieBeforePersisting() throws Exception {
    CredentialDtos.PairingCodeView pairing = service.createPairingCode(42L, "测试浏览器");
    CredentialDtos.PairDeviceView device = service.pair(new CredentialDtos.PairDeviceRequest(
        pairing.pairingCode(), "extension-instance-2", "测试浏览器"));
    String body = uploadBody("not_allowed_cookie");
    String nonce = "nonce_3456789012345678";

    ApiException error = assertThrows(ApiException.class, () -> service.upload(
        device.deviceToken(), String.valueOf(NOW.toEpochMilli()), nonce,
        signature(device.deviceToken(), NOW.toEpochMilli(), nonce, body), body));
    assertEquals(400, error.getCode());
    Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM ym_session_credential", Integer.class);
    assertEquals(0, count);
  }

  @Test
  void uploadsAndLeasesWdtTokenUsingIdentityFromJwtClaims() throws Exception {
    CredentialDtos.PairingCodeView pairing = service.createPairingCode(42L, "旺店通测试浏览器");
    CredentialDtos.PairDeviceView device = service.pair(new CredentialDtos.PairDeviceRequest(
        pairing.pairingCode(), "wdt-extension-instance", "旺店通测试浏览器"));
    String token = wdtToken(NOW.plusSeconds(3600));
    String body = wdtUploadBody(token);
    String nonce = "nonce_wdt_upload_123456";

    CredentialDtos.CredentialView uploaded = service.upload(
        device.deviceToken(), String.valueOf(NOW.toEpochMilli()), nonce,
        signature(device.deviceToken(), NOW.toEpochMilli(), nonce, body), body);

    assertEquals("wdt", uploaded.platform());
    assertEquals("tenant-1", uploaded.shopId());
    assertEquals("测试旺店通店铺", uploaded.shopName());
    assertEquals("user-1", uploaded.accountId());
    assertEquals("测试操作员", uploaded.accountName());
    assertEquals(LocalDateTime.ofInstant(NOW.plusSeconds(3600), ZoneOffset.UTC),
        jdbcTemplate.queryForObject(
            "SELECT expires_at FROM ym_session_credential", LocalDateTime.class));
    String encryptedPayload = jdbcTemplate.queryForObject(
        "SELECT encrypted_payload FROM ym_session_credential", String.class);
    assertFalse(encryptedPayload.contains(token));

    CredentialDtos.CredentialLeaseView lease = service.lease(
        42L, new CredentialDtos.LeaseCredentialRequest(
            "wdt", "tenant-1", null, "wdt-orders", "task-wdt", "run-wdt", 120));
    assertEquals("wdt", lease.platform());
    assertEquals(token, lease.session().path("cookies").get(0).path("value").asText());
  }

  @Test
  void rejectsExpiredWdtToken() throws Exception {
    CredentialDtos.PairingCodeView pairing = service.createPairingCode(42L, "旺店通过期测试");
    CredentialDtos.PairDeviceView device = service.pair(new CredentialDtos.PairDeviceRequest(
        pairing.pairingCode(), "wdt-expired-instance", "旺店通过期测试"));
    String body = wdtUploadBody(wdtToken(NOW.minusSeconds(1)));
    String nonce = "nonce_wdt_expired_1234";

    ApiException error = assertThrows(ApiException.class, () -> service.upload(
        device.deviceToken(), String.valueOf(NOW.toEpochMilli()), nonce,
        signature(device.deviceToken(), NOW.toEpochMilli(), nonce, body), body));

    assertEquals(400, error.getCode());
    assertEquals(0, jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM ym_session_credential", Integer.class));
  }

  @Test
  void leasesDecryptsHeartbeatsAndReleasesCredentialExclusively() throws Exception {
    CredentialDtos.PairingCodeView pairing = service.createPairingCode(42L, "租约测试浏览器");
    CredentialDtos.PairDeviceView device = service.pair(new CredentialDtos.PairDeviceRequest(
        pairing.pairingCode(), "lease-instance", "租约测试浏览器"));
    String body = uploadBody();
    String uploadNonce = "nonce_lease_upload_12345";
    service.upload(
        device.deviceToken(), String.valueOf(NOW.toEpochMilli()), uploadNonce,
        signature(device.deviceToken(), NOW.toEpochMilli(), uploadNonce, body), body);

    CredentialDtos.LeaseCredentialRequest request = new CredentialDtos.LeaseCredentialRequest(
        "sycm", "shop-1", null, "sycm-report", "task-1", "run-1", 120);
    CredentialDtos.CredentialLeaseView lease = service.lease(42L, request);
    assertEquals("secret-cookie-value", lease.session().path("cookies").get(0).path("value").asText());
    assertFalse(service.listForUser(42L).get(0).available());
    assertEquals(
        LocalDateTime.ofInstant(NOW.plusSeconds(120), ZoneOffset.UTC).toString(),
        lease.expiresAt());

    ApiException busy = assertThrows(ApiException.class, () -> service.lease(
        42L, new CredentialDtos.LeaseCredentialRequest(
            "sycm", "shop-1", null, "sycm-report", "task-2", "run-2", 120)));
    assertEquals(409, busy.getCode());

    CredentialDtos.CredentialLeaseStatusView heartbeat = service.heartbeatLease(
        42L, lease.leaseId(), new CredentialDtos.ExtendLeaseRequest(300));
    assertEquals("ACTIVE", heartbeat.status());
    assertEquals(
        LocalDateTime.ofInstant(NOW.plusSeconds(300), ZoneOffset.UTC).toString(),
        heartbeat.expiresAt());

    CredentialDtos.CredentialLeaseStatusView released = service.releaseLease(42L, lease.leaseId());
    assertEquals("RELEASED", released.status());
    assertTrue(service.listForUser(42L).get(0).available());
    CredentialDtos.CredentialLeaseView next = service.lease(
        42L, new CredentialDtos.LeaseCredentialRequest(
            "sycm", "shop-1", "account-1", "sycm-report", "task-2", "run-2", 120));
    assertFalse(next.leaseId().equals(lease.leaseId()));
  }

  @Test
  void blocksOfflineCredentialAndInvalidatesOnlyLeasedVersion() throws Exception {
    CredentialDtos.PairingCodeView pairing = service.createPairingCode(42L, "离线租约测试");
    CredentialDtos.PairDeviceView device = service.pair(new CredentialDtos.PairDeviceRequest(
        pairing.pairingCode(), "offline-lease-instance", "离线租约测试"));
    String body = uploadBody();
    String nonce = "nonce_offline_lease_123";
    service.upload(
        device.deviceToken(), String.valueOf(NOW.toEpochMilli()), nonce,
        signature(device.deviceToken(), NOW.toEpochMilli(), nonce, body), body);

    CredentialDtos.CredentialLeaseView lease = service.lease(
        42L, new CredentialDtos.LeaseCredentialRequest(
            "sycm", "shop-1", null, "sycm-report", "task-1", "run-1", 120));
    CredentialDtos.CredentialLeaseStatusView invalidated = service.invalidateLease(
        42L, lease.leaseId(), new CredentialDtos.InvalidateLeaseRequest("cookie expired"));
    assertEquals("INVALIDATED", invalidated.status());
    assertEquals("NEEDS_LOGIN", jdbcTemplate.queryForObject(
        "SELECT status FROM ym_session_credential", String.class));

    String refreshedNonce = "nonce_refreshed_lease_12";
    service.upload(
        device.deviceToken(), String.valueOf(NOW.toEpochMilli()), refreshedNonce,
        signature(device.deviceToken(), NOW.toEpochMilli(), refreshedNonce, body), body);
    CredentialDtos.CredentialLeaseView refreshed = service.lease(
        42L, new CredentialDtos.LeaseCredentialRequest(
            "sycm", "shop-1", null, "sycm-report", "task-2", "run-2", 120));
    jdbcTemplate.update(
        "UPDATE ym_session_credential_lease SET credential_version = 1 WHERE id = ?",
        refreshed.leaseId());
    service.invalidateLease(
        42L, refreshed.leaseId(), new CredentialDtos.InvalidateLeaseRequest("stale worker"));
    assertEquals("CAPTURED", jdbcTemplate.queryForObject(
        "SELECT status FROM ym_session_credential", String.class));

    CredentialDtos.CredentialLeaseView activeLease = service.lease(
        42L, new CredentialDtos.LeaseCredentialRequest(
            "sycm", "shop-1", null, "sycm-report", "task-3", "run-3", 900));

    CredentialService offlineService = new CredentialService(
        repository, transportCrypto, vault, new SycmCredentialPolicy(objectMapper),
        new WdtCredentialPolicy(objectMapper, Clock.fixed(NOW.plusSeconds(301), ZoneOffset.UTC)), objectMapper,
        Clock.fixed(NOW.plusSeconds(301), ZoneOffset.UTC));
    ApiException heartbeatOffline = assertThrows(ApiException.class, () ->
        offlineService.heartbeatLease(
            42L, activeLease.leaseId(), new CredentialDtos.ExtendLeaseRequest(900)));
    assertEquals(409, heartbeatOffline.getCode());
    assertEquals("EXPIRED", jdbcTemplate.queryForObject(
        "SELECT status FROM ym_session_credential_lease WHERE id = ?",
        String.class, activeLease.leaseId()));
    ApiException offline = assertThrows(ApiException.class, () -> offlineService.lease(
        42L, new CredentialDtos.LeaseCredentialRequest(
            "sycm", "shop-1", null, "sycm-report", "task-4", "run-4", 120)));
    assertEquals(409, offline.getCode());
  }

  @Test
  void disablesCredentialInvalidatesLeaseAndIsIdempotent() throws Exception {
    CredentialDtos.PairingCodeView pairing = service.createPairingCode(42L, "停用测试浏览器");
    CredentialDtos.PairDeviceView device = service.pair(new CredentialDtos.PairDeviceRequest(
        pairing.pairingCode(), "disable-instance", "办公室电脑-A"));
    String body = uploadBody();
    String nonce = "nonce_disable_upload_123";
    CredentialDtos.CredentialView uploaded = service.upload(
        device.deviceToken(), String.valueOf(NOW.toEpochMilli()), nonce,
        signature(device.deviceToken(), NOW.toEpochMilli(), nonce, body), body);
    CredentialDtos.CredentialLeaseView lease = service.lease(
        42L, new CredentialDtos.LeaseCredentialRequest(
            "sycm", "shop-1", null, "sycm-report", "task-disable", "run-disable", 120));

    CredentialDtos.DisableCredentialView disabled = service.disable(42L, uploaded.credentialId());
    assertEquals(uploaded.credentialId(), disabled.credentialId());
    assertEquals("DISABLED", disabled.status());
    assertFalse(disabled.available());
    assertEquals(LocalDateTime.ofInstant(NOW, ZoneOffset.UTC).toString(), disabled.disabledAt());
    assertEquals("INVALIDATED", jdbcTemplate.queryForObject(
        "SELECT status FROM ym_session_credential_lease WHERE id = ?", String.class,
        lease.leaseId()));

    CredentialDtos.CredentialView listed = service.listForUser(42L).get(0);
    assertEquals("DISABLED", listed.status());
    assertFalse(listed.available());
    assertEquals("办公室电脑-A", listed.deviceName());

    CredentialDtos.DisableCredentialView repeated = service.disable(42L, uploaded.credentialId());
    assertEquals(disabled.disabledAt(), repeated.disabledAt());
    assertEquals(1, jdbcTemplate.queryForObject("""
        SELECT COUNT(*) FROM ym_credential_audit_log
        WHERE credential_id = ? AND action = 'CREDENTIAL_DISABLED_BY_USER'
        """, Integer.class, uploaded.credentialId()));

    ApiException heartbeat = assertThrows(ApiException.class, () -> service.heartbeatLease(
        42L, lease.leaseId(), new CredentialDtos.ExtendLeaseRequest(120)));
    assertEquals(409, heartbeat.getCode());
    ApiException unavailable = assertThrows(ApiException.class, () -> service.lease(
        42L, new CredentialDtos.LeaseCredentialRequest(
            "sycm", "shop-1", null, "sycm-report", "task-next", "run-next", 120)));
    assertEquals(409, unavailable.getCode());
    ApiException foreignUser = assertThrows(
        ApiException.class, () -> service.disable(99L, uploaded.credentialId()));
    assertEquals(404, foreignUser.getCode());
  }

  @Test
  void disablesOfflineCredentialWithoutUnbindingDevice() throws Exception {
    CredentialDtos.PairingCodeView pairing = service.createPairingCode(42L, "离线停用测试");
    CredentialDtos.PairDeviceView device = service.pair(new CredentialDtos.PairDeviceRequest(
        pairing.pairingCode(), "offline-disable-instance", "仓库电脑-B"));
    String body = uploadBody();
    String nonce = "nonce_offline_disable_12";
    CredentialDtos.CredentialView uploaded = service.upload(
        device.deviceToken(), String.valueOf(NOW.toEpochMilli()), nonce,
        signature(device.deviceToken(), NOW.toEpochMilli(), nonce, body), body);

    CredentialService offlineService = new CredentialService(
        repository, transportCrypto, vault, new SycmCredentialPolicy(objectMapper),
        new WdtCredentialPolicy(objectMapper, Clock.fixed(NOW.plusSeconds(301), ZoneOffset.UTC)),
        objectMapper, Clock.fixed(NOW.plusSeconds(301), ZoneOffset.UTC));
    CredentialDtos.DisableCredentialView disabled =
        offlineService.disable(42L, uploaded.credentialId());

    assertEquals("DISABLED", disabled.status());
    assertEquals("ACTIVE", jdbcTemplate.queryForObject(
        "SELECT status FROM ym_credential_device WHERE id = ?", String.class, device.deviceId()));
  }

  @Test
  void aNewUploadRestoresADisabledCredential() throws Exception {
    CredentialDtos.PairingCodeView pairing = service.createPairingCode(42L, "重新同步测试");
    CredentialDtos.PairDeviceView device = service.pair(new CredentialDtos.PairDeviceRequest(
        pairing.pairingCode(), "resync-instance", "重新同步测试"));
    String body = uploadBody();
    CredentialDtos.CredentialView uploaded = service.upload(
        device.deviceToken(), String.valueOf(NOW.toEpochMilli()), "nonce_resync_upload_123",
        signature(device.deviceToken(), NOW.toEpochMilli(), "nonce_resync_upload_123", body), body);
    service.disable(42L, uploaded.credentialId());

    CredentialDtos.CredentialView restored = service.upload(
        device.deviceToken(), String.valueOf(NOW.toEpochMilli()), "nonce_resync_upload_456",
        signature(device.deviceToken(), NOW.toEpochMilli(), "nonce_resync_upload_456", body), body);

    assertEquals("CAPTURED", restored.status());
    assertTrue(restored.available());
    assertEquals(null, jdbcTemplate.queryForObject(
        "SELECT disabled_at FROM ym_session_credential WHERE id = ?",
        LocalDateTime.class, uploaded.credentialId()));
  }

  private String uploadBody() throws Exception {
    return uploadBody("cookie2");
  }

  private String uploadBody(String cookieName) throws Exception {
    var payload = objectMapper.createObjectNode();
    payload.put("schemaVersion", 1);
    payload.put("origin", "https://sycm.taobao.com");
    payload.put("pageUrl", "https://sycm.taobao.com/portal/home.htm");
    payload.put("capturedAt", NOW.toString());
    payload.put("userAgent", "test-agent");
    var cookie = payload.putArray("cookies").addObject();
    cookie.put("name", cookieName);
    cookie.put("value", "secret-cookie-value");
    cookie.put("domain", ".taobao.com");
    cookie.put("path", "/");
    payload.putObject("storage").putObject("localStorage");

    CredentialDtos.EncryptionKeyView keyView = transportCrypto.publicKey();
    CredentialDtos.TransportEnvelope envelope = encrypt(
        objectMapper.writeValueAsBytes(payload), keyView);
    CredentialDtos.UploadCredentialRequest request = new CredentialDtos.UploadCredentialRequest(
        "sycm", "account-1", "测试账号", "shop-1", "测试店铺", NOW.toString(),
        objectMapper.createObjectNode().put("userAgent", "test-agent"), envelope);
    return objectMapper.writeValueAsString(request);
  }

  private String wdtUploadBody(String token) throws Exception {
    var payload = objectMapper.createObjectNode();
    payload.put("schemaVersion", 1);
    payload.put("origin", "https://erp.huice.com");
    payload.put("pageUrl", "https://erp.huice.com/");
    payload.put("capturedAt", NOW.toString());
    payload.put("userAgent", "test-agent");
    var cookie = payload.putArray("cookies").addObject();
    cookie.put("name", "X-HC-TOKEN");
    cookie.put("value", token);
    cookie.put("domain", "erp.huice.com");
    cookie.put("path", "/");
    var storage = payload.putObject("storage");
    storage.putObject("localStorage");
    storage.putObject("sessionStorage");

    CredentialDtos.EncryptionKeyView keyView = transportCrypto.publicKey();
    CredentialDtos.TransportEnvelope envelope = encrypt(
        objectMapper.writeValueAsBytes(payload), keyView);
    CredentialDtos.UploadCredentialRequest request = new CredentialDtos.UploadCredentialRequest(
        "wdt", "spoofed-account", "伪造账号", "spoofed-shop", "伪造店铺", NOW.toString(),
        objectMapper.createObjectNode().put("userAgent", "test-agent"), envelope);
    return objectMapper.writeValueAsString(request);
  }

  private String wdtToken(Instant expiresAt) throws Exception {
    var claims = objectMapper.createObjectNode();
    claims.put("exp", expiresAt.getEpochSecond());
    claims.put("sid", "tenant-1");
    claims.put("sn", "测试旺店通店铺");
    claims.put("ud", "user-1");
    claims.put("un", "测试操作员");
    return encode("{\"alg\":\"none\"}".getBytes(StandardCharsets.UTF_8)) + "."
        + encode(objectMapper.writeValueAsBytes(claims)) + ".test-signature";
  }

  private CredentialDtos.TransportEnvelope encrypt(
      byte[] plaintext, CredentialDtos.EncryptionKeyView keyView) throws Exception {
    byte[] n = Base64.getUrlDecoder().decode(keyView.publicKeyJwk().path("n").asText());
    byte[] e = Base64.getUrlDecoder().decode(keyView.publicKeyJwk().path("e").asText());
    PublicKey publicKey = KeyFactory.getInstance("RSA").generatePublic(
        new RSAPublicKeySpec(new BigInteger(1, n), new BigInteger(1, e)));
    byte[] aesKey = "abcdef0123456789abcdef0123456789".getBytes(StandardCharsets.UTF_8);
    byte[] iv = "0123456789ab".getBytes(StandardCharsets.UTF_8);

    Cipher rsa = Cipher.getInstance("RSA/ECB/OAEPPadding");
    rsa.init(Cipher.ENCRYPT_MODE, publicKey, new OAEPParameterSpec(
        "SHA-256", "MGF1", MGF1ParameterSpec.SHA256, PSource.PSpecified.DEFAULT));
    Cipher aes = Cipher.getInstance("AES/GCM/NoPadding");
    aes.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(aesKey, "AES"), new GCMParameterSpec(128, iv));
    return new CredentialDtos.TransportEnvelope(
        keyView.keyId(), encode(rsa.doFinal(aesKey)), encode(iv), encode(aes.doFinal(plaintext)));
  }

  private String signature(String token, long timestamp, String nonce, String body) {
    String canonical = timestamp + "\n" + nonce + "\n" + CredentialSecurity.sha256Hex(body);
    return CredentialSecurity.hmacHex(
        CredentialSecurity.hexBytes(CredentialSecurity.sha256Hex(token)), canonical);
  }

  private String encode(byte[] value) {
    return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
  }

  private void resetSchema() {
    jdbcTemplate.execute("DROP ALL OBJECTS");
    jdbcTemplate.execute("""
        CREATE TABLE ym_credential_pairing_code (
          id VARCHAR(64) PRIMARY KEY, user_id BIGINT NOT NULL, code_hash CHAR(64) UNIQUE NOT NULL,
          label VARCHAR(80) NOT NULL, expires_at TIMESTAMP NOT NULL, consumed_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)
        """);
    jdbcTemplate.execute("""
        CREATE TABLE ym_credential_device (
          id VARCHAR(64) PRIMARY KEY, user_id BIGINT NOT NULL, device_instance_id VARCHAR(128) NOT NULL,
          device_name VARCHAR(80) NOT NULL, token_hash CHAR(64) UNIQUE NOT NULL,
          status VARCHAR(20) NOT NULL, last_seen_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          revoked_at TIMESTAMP)
        """);
    jdbcTemplate.execute("""
        CREATE TABLE ym_credential_upload_nonce (
          device_id VARCHAR(64) NOT NULL, nonce VARCHAR(128) NOT NULL, expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(device_id, nonce))
        """);
    jdbcTemplate.execute("""
        CREATE TABLE ym_session_credential (
          id VARCHAR(64) PRIMARY KEY, user_id BIGINT NOT NULL, platform VARCHAR(32) NOT NULL,
          account_id VARCHAR(128) NOT NULL, account_name VARCHAR(128) NOT NULL,
          shop_id VARCHAR(128) NOT NULL, shop_name VARCHAR(128) NOT NULL, identity_key CHAR(64) NOT NULL,
          source_device_id VARCHAR(64) NOT NULL, encrypted_payload CLOB NOT NULL, encrypted_dek CLOB NOT NULL,
          encryption_key_version VARCHAR(32) NOT NULL, credential_version BIGINT NOT NULL,
          environment_json CLOB, status VARCHAR(32) NOT NULL, max_concurrency INT NOT NULL,
          disabled_at TIMESTAMP,
          captured_at TIMESTAMP NOT NULL, expires_at TIMESTAMP, last_validated_at TIMESTAMP,
          last_used_at TIMESTAMP, last_error_code VARCHAR(64), last_error_message_masked VARCHAR(512),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, identity_key))
        """);
    jdbcTemplate.execute("""
        CREATE TABLE ym_session_credential_lease (
          id VARCHAR(64) PRIMARY KEY, credential_id VARCHAR(64) NOT NULL,
          credential_version BIGINT NOT NULL, user_id BIGINT NOT NULL,
          purpose VARCHAR(80) NOT NULL, task_id VARCHAR(128) NOT NULL, run_id VARCHAR(128) NOT NULL,
          status VARCHAR(20) NOT NULL, leased_at TIMESTAMP NOT NULL,
          heartbeat_at TIMESTAMP NOT NULL, expires_at TIMESTAMP NOT NULL,
          released_at TIMESTAMP, invalidate_reason VARCHAR(256))
        """);
    jdbcTemplate.execute("""
        CREATE TABLE ym_credential_audit_log (
          id BIGINT AUTO_INCREMENT PRIMARY KEY, user_id BIGINT NOT NULL, device_id VARCHAR(64),
          credential_id VARCHAR(64), action VARCHAR(64) NOT NULL, detail_masked VARCHAR(512),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)
        """);
  }
}
