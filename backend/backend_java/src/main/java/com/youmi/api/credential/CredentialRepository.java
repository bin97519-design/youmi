package com.youmi.api.credential;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class CredentialRepository {
  private final JdbcTemplate jdbcTemplate;

  public CredentialRepository(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public void insertPairingCode(
      String id, long userId, String codeHash, String label, LocalDateTime expiresAt) {
    jdbcTemplate.update("""
        INSERT INTO ym_credential_pairing_code
          (id, user_id, code_hash, label, expires_at)
        VALUES (?, ?, ?, ?, ?)
        """, id, userId, codeHash, label, Timestamp.valueOf(expiresAt));
  }

  public Optional<PairingCodeRow> findPairingCodeForUpdate(String codeHash) {
    List<PairingCodeRow> rows = jdbcTemplate.query("""
        SELECT id, user_id, expires_at, consumed_at
        FROM ym_credential_pairing_code
        WHERE code_hash = ?
        FOR UPDATE
        """, (rs, rowNum) -> new PairingCodeRow(
            rs.getString("id"), rs.getLong("user_id"),
            rs.getTimestamp("expires_at").toLocalDateTime(),
            rs.getTimestamp("consumed_at") == null
                ? null : rs.getTimestamp("consumed_at").toLocalDateTime()), codeHash);
    return rows.stream().findFirst();
  }

  public int consumePairingCode(String id) {
    return jdbcTemplate.update("""
        UPDATE ym_credential_pairing_code
        SET consumed_at = CURRENT_TIMESTAMP
        WHERE id = ? AND consumed_at IS NULL
        """, id);
  }

  public void insertDevice(
      String id, long userId, String instanceId, String name, String tokenHash,
      LocalDateTime seenAt) {
    jdbcTemplate.update("""
        INSERT INTO ym_credential_device
          (id, user_id, device_instance_id, device_name, token_hash, status, last_seen_at)
        VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)
        """, id, userId, instanceId, name, tokenHash, Timestamp.valueOf(seenAt));
  }

  public Optional<DeviceRow> findActiveDeviceByTokenHash(String tokenHash) {
    List<DeviceRow> rows = jdbcTemplate.query("""
        SELECT id, user_id, device_instance_id, device_name, token_hash, status, last_seen_at
        FROM ym_credential_device
        WHERE token_hash = ? AND status = 'ACTIVE'
        """, (rs, rowNum) -> new DeviceRow(
            rs.getString("id"), rs.getLong("user_id"), rs.getString("device_instance_id"),
            rs.getString("device_name"), rs.getString("token_hash"), rs.getString("status"),
            rs.getTimestamp("last_seen_at") == null
                ? null : rs.getTimestamp("last_seen_at").toLocalDateTime()), tokenHash);
    return rows.stream().findFirst();
  }

  public void touchDevice(String deviceId, LocalDateTime seenAt) {
    jdbcTemplate.update(
        "UPDATE ym_credential_device SET last_seen_at = ? WHERE id = ?",
        Timestamp.valueOf(seenAt), deviceId);
  }

  public void deleteExpiredNonces(String deviceId, LocalDateTime now) {
    jdbcTemplate.update(
        "DELETE FROM ym_credential_upload_nonce WHERE device_id = ? AND expires_at < ?",
        deviceId, Timestamp.valueOf(now));
  }

  public void insertNonce(String deviceId, String nonce, LocalDateTime expiresAt) {
    try {
      jdbcTemplate.update("""
          INSERT INTO ym_credential_upload_nonce (device_id, nonce, expires_at)
          VALUES (?, ?, ?)
          """, deviceId, nonce, Timestamp.valueOf(expiresAt));
    } catch (DuplicateKeyException error) {
      throw error;
    }
  }

  public Optional<CredentialRow> findCredentialForUpdate(long userId, String identityKey) {
    List<CredentialRow> rows = jdbcTemplate.query("""
        SELECT id, credential_version
        FROM ym_session_credential
        WHERE user_id = ? AND identity_key = ?
        FOR UPDATE
        """, (rs, rowNum) -> new CredentialRow(
            rs.getString("id"), rs.getLong("credential_version")), userId, identityKey);
    return rows.stream().findFirst();
  }

  public void insertCredential(
      String id, long userId, String platform, String identityKey, String sourceDeviceId,
      String accountId, String accountName, String shopId, String shopName,
      String status, LocalDateTime capturedAt, LocalDateTime expiresAt, String environmentJson,
      CredentialVault.VaultPayload vaultPayload) {
    jdbcTemplate.update("""
        INSERT INTO ym_session_credential
          (id, user_id, platform, account_id, account_name, shop_id, shop_name, identity_key,
           source_device_id, encrypted_payload, encrypted_dek, encryption_key_version,
           credential_version, environment_json, status, max_concurrency, captured_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 1, ?, ?)
        """, id, userId, platform, accountId, accountName, shopId, shopName, identityKey,
        sourceDeviceId, vaultPayload.encryptedPayload(), vaultPayload.encryptedDek(),
        vaultPayload.keyVersion(), environmentJson, status, Timestamp.valueOf(capturedAt),
        timestamp(expiresAt));
  }

  public long updateCredential(
      String id, String sourceDeviceId, String accountId, String accountName,
      String shopId, String shopName, String status, LocalDateTime capturedAt,
      LocalDateTime expiresAt, String environmentJson, CredentialVault.VaultPayload vaultPayload) {
    jdbcTemplate.update("""
        UPDATE ym_session_credential
        SET account_id = ?, account_name = ?, shop_id = ?, shop_name = ?, source_device_id = ?,
            encrypted_payload = ?, encrypted_dek = ?, encryption_key_version = ?,
            credential_version = credential_version + 1, environment_json = ?, status = ?,
            captured_at = ?, expires_at = ?, last_error_code = NULL, last_error_message_masked = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """, accountId, accountName, shopId, shopName, sourceDeviceId,
        vaultPayload.encryptedPayload(), vaultPayload.encryptedDek(), vaultPayload.keyVersion(),
        environmentJson, status, Timestamp.valueOf(capturedAt), timestamp(expiresAt), id);
    Long version = jdbcTemplate.queryForObject(
        "SELECT credential_version FROM ym_session_credential WHERE id = ?", Long.class, id);
    return version == null ? 1L : version;
  }

  public int expireLeases(long userId, LocalDateTime now) {
    return jdbcTemplate.update("""
        UPDATE ym_session_credential_lease
        SET status = 'EXPIRED', released_at = ?
        WHERE user_id = ? AND status = 'ACTIVE' AND expires_at <= ?
        """, Timestamp.valueOf(now), userId, Timestamp.valueOf(now));
  }

  public Optional<LeasableCredentialRow> findLeasableCredentialForUpdate(
      long userId, String platform, String shopId, String accountId,
      LocalDateTime now, LocalDateTime onlineCutoff) {
    List<LeasableCredentialRow> rows = jdbcTemplate.query("""
        SELECT c.id, c.platform, c.account_id, c.account_name, c.shop_id, c.shop_name,
               c.source_device_id, c.encrypted_payload, c.encrypted_dek,
               c.encryption_key_version, c.credential_version
        FROM ym_session_credential c
        INNER JOIN ym_credential_device d ON d.id = c.source_device_id
        WHERE c.user_id = ?
          AND c.platform = ?
          AND c.shop_id = ?
          AND (? = '' OR c.account_id = ?)
          AND c.status IN ('CAPTURED', 'HEALTHY')
          AND (c.expires_at IS NULL OR c.expires_at > ?)
          AND d.status = 'ACTIVE'
          AND d.last_seen_at >= ?
          AND (
            SELECT COUNT(*)
            FROM ym_session_credential_lease l
            WHERE l.credential_id = c.id
              AND l.status = 'ACTIVE'
              AND l.expires_at > ?
          ) < c.max_concurrency
        ORDER BY CASE WHEN c.last_used_at IS NULL THEN 0 ELSE 1 END,
                 c.last_used_at ASC, c.updated_at DESC
        LIMIT 1
        FOR UPDATE
        """, (rs, rowNum) -> new LeasableCredentialRow(
            rs.getString("id"), rs.getString("platform"), rs.getString("account_id"),
            rs.getString("account_name"), rs.getString("shop_id"), rs.getString("shop_name"),
            rs.getString("source_device_id"), rs.getString("encrypted_payload"),
            rs.getString("encrypted_dek"), rs.getString("encryption_key_version"),
            rs.getLong("credential_version")),
        userId, platform, shopId, accountId, accountId, Timestamp.valueOf(now),
        Timestamp.valueOf(onlineCutoff), Timestamp.valueOf(now));
    return rows.stream().findFirst();
  }

  public void insertLease(
      String id, LeasableCredentialRow credential, long userId, String purpose,
      String taskId, String runId, LocalDateTime leasedAt, LocalDateTime expiresAt) {
    jdbcTemplate.update("""
        INSERT INTO ym_session_credential_lease
          (id, credential_id, credential_version, user_id, purpose, task_id, run_id,
           status, leased_at, heartbeat_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)
        """, id, credential.id(), credential.credentialVersion(), userId, purpose, taskId, runId,
        Timestamp.valueOf(leasedAt), Timestamp.valueOf(leasedAt), Timestamp.valueOf(expiresAt));
  }

  public void touchCredentialLastUsed(String credentialId, LocalDateTime usedAt) {
    jdbcTemplate.update(
        "UPDATE ym_session_credential SET last_used_at = ? WHERE id = ?",
        Timestamp.valueOf(usedAt), credentialId);
  }

  public Optional<LeaseRow> findLeaseForUpdate(long userId, String leaseId) {
    List<LeaseRow> rows = jdbcTemplate.query("""
        SELECT l.id, l.credential_id, l.credential_version, l.status, l.leased_at,
               l.heartbeat_at, l.expires_at, l.released_at, c.source_device_id,
               d.status AS device_status, d.last_seen_at AS device_last_seen_at
        FROM ym_session_credential_lease l
        INNER JOIN ym_session_credential c ON c.id = l.credential_id
        INNER JOIN ym_credential_device d ON d.id = c.source_device_id
        WHERE l.user_id = ? AND l.id = ?
        FOR UPDATE
        """, (rs, rowNum) -> new LeaseRow(
            rs.getString("id"), rs.getString("credential_id"),
            rs.getLong("credential_version"), rs.getString("source_device_id"),
            rs.getString("status"), timestamp(rs.getTimestamp("leased_at")),
            timestamp(rs.getTimestamp("heartbeat_at")), timestamp(rs.getTimestamp("expires_at")),
            timestamp(rs.getTimestamp("released_at")), rs.getString("device_status"),
            timestamp(rs.getTimestamp("device_last_seen_at"))), userId, leaseId);
    return rows.stream().findFirst();
  }

  public int heartbeatLease(
      String leaseId, LocalDateTime heartbeatAt, LocalDateTime expiresAt) {
    return jdbcTemplate.update("""
        UPDATE ym_session_credential_lease
        SET heartbeat_at = ?, expires_at = ?
        WHERE id = ? AND status = 'ACTIVE'
        """, Timestamp.valueOf(heartbeatAt), Timestamp.valueOf(expiresAt), leaseId);
  }

  public int finishLease(String leaseId, String status, LocalDateTime releasedAt, String reason) {
    return jdbcTemplate.update("""
        UPDATE ym_session_credential_lease
        SET status = ?, released_at = ?, invalidate_reason = ?
        WHERE id = ? AND status = 'ACTIVE'
        """, status, Timestamp.valueOf(releasedAt), reason, leaseId);
  }

  public int invalidateCredentialVersion(
      String credentialId, long credentialVersion, String reason) {
    return jdbcTemplate.update("""
        UPDATE ym_session_credential
        SET status = 'NEEDS_LOGIN', last_error_code = 'SESSION_INVALID',
            last_error_message_masked = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND credential_version = ?
        """, reason, credentialId, credentialVersion);
  }

  public List<CredentialDtos.CredentialView> listForUser(
      long userId, LocalDateTime onlineCutoff, LocalDateTime now) {
    return list("WHERE c.user_id = ?", userId, onlineCutoff, now);
  }

  public List<CredentialDtos.CredentialView> listForDevice(
      String deviceId, LocalDateTime onlineCutoff, LocalDateTime now) {
    return list("WHERE c.source_device_id = ?", deviceId, onlineCutoff, now);
  }

  private List<CredentialDtos.CredentialView> list(
      String where, Object argument, LocalDateTime onlineCutoff, LocalDateTime now) {
    return jdbcTemplate.query("""
        SELECT c.id, c.platform, c.account_id, c.account_name, c.shop_id, c.shop_name,
               c.status AS credential_status, c.credential_version, c.captured_at,
               c.expires_at, c.last_validated_at, c.updated_at, d.status AS device_status,
               d.last_seen_at AS device_last_seen_at
        FROM ym_session_credential c
        LEFT JOIN ym_credential_device d ON d.id = c.source_device_id
        """ + where + " ORDER BY c.updated_at DESC", (rs, rowNum) -> {
          String storedStatus = rs.getString("credential_status");
          String storedDeviceStatus = rs.getString("device_status");
          Timestamp lastSeen = rs.getTimestamp("device_last_seen_at");
          boolean online = "ACTIVE".equals(storedDeviceStatus)
              && lastSeen != null
              && !lastSeen.toLocalDateTime().isBefore(onlineCutoff);
          Timestamp credentialExpiry = rs.getTimestamp("expires_at");
          boolean expired = credentialExpiry != null
              && !credentialExpiry.toLocalDateTime().isAfter(now);
          String deviceStatus = !"ACTIVE".equals(storedDeviceStatus)
              ? "REVOKED" : online ? "ONLINE" : "OFFLINE";
          String effectiveStatus = online ? (expired ? "EXPIRED" : storedStatus) : deviceStatus;
          boolean available = online && !expired
              && ("CAPTURED".equals(storedStatus) || "HEALTHY".equals(storedStatus));
          return new CredentialDtos.CredentialView(
              rs.getString("id"), rs.getString("platform"), rs.getString("account_id"),
              rs.getString("account_name"), rs.getString("shop_id"), rs.getString("shop_name"),
              effectiveStatus, deviceStatus, available, rs.getLong("credential_version"),
              iso(rs.getTimestamp("captured_at")), iso(rs.getTimestamp("last_validated_at")),
              iso(lastSeen), iso(rs.getTimestamp("updated_at")));
        }, argument);
  }

  public void audit(long userId, String deviceId, String credentialId, String action, String detail) {
    jdbcTemplate.update("""
        INSERT INTO ym_credential_audit_log
          (user_id, device_id, credential_id, action, detail_masked)
        VALUES (?, ?, ?, ?, ?)
        """, userId, deviceId, credentialId, action, detail);
  }

  private String iso(Timestamp value) {
    return value == null ? null : value.toLocalDateTime().toString();
  }

  private LocalDateTime timestamp(Timestamp value) {
    return value == null ? null : value.toLocalDateTime();
  }

  private Timestamp timestamp(LocalDateTime value) {
    return value == null ? null : Timestamp.valueOf(value);
  }

  public record PairingCodeRow(
      String id, long userId, LocalDateTime expiresAt, LocalDateTime consumedAt) {}

  public record DeviceRow(
      String id, long userId, String instanceId, String name, String tokenHash,
      String status, LocalDateTime lastSeenAt) {}

  public record CredentialRow(String id, long version) {}

  public record LeasableCredentialRow(
      String id, String platform, String accountId, String accountName,
      String shopId, String shopName, String sourceDeviceId, String encryptedPayload,
      String encryptedDek, String encryptionKeyVersion, long credentialVersion) {}

  public record LeaseRow(
      String id, String credentialId, long credentialVersion, String sourceDeviceId,
      String status, LocalDateTime leasedAt, LocalDateTime heartbeatAt,
      LocalDateTime expiresAt, LocalDateTime releasedAt, String deviceStatus,
      LocalDateTime deviceLastSeenAt) {}
}
