package com.youmi.api.credential;

import com.fasterxml.jackson.databind.JsonNode;

public final class CredentialDtos {
  private CredentialDtos() {}

  public record CreatePairingCodeRequest(String label) {}

  public record PairingCodeView(String pairingCode, String expiresAt) {}

  public record PairDeviceRequest(
      String pairingCode,
      String deviceInstanceId,
      String deviceName) {}

  public record PairDeviceView(
      String deviceId,
      String deviceToken,
      String pairedAt) {}

  public record DeviceHeartbeatView(
      String deviceId,
      String status,
      String lastSeenAt,
      long offlineAfterSeconds) {}

  public record EncryptionKeyView(String keyId, JsonNode publicKeyJwk) {}

  public record TransportEnvelope(
      String keyId,
      String wrappedKey,
      String iv,
      String ciphertext) {}

  public record UploadCredentialRequest(
      String platform,
      String accountId,
      String accountName,
      String shopId,
      String shopName,
      String capturedAt,
      JsonNode environment,
      TransportEnvelope encryptedPayload) {}

  public record CredentialView(
      String credentialId,
      String platform,
      String accountId,
      String accountName,
      String shopId,
      String shopName,
      String status,
      String deviceId,
      String deviceName,
      String deviceStatus,
      boolean available,
      long credentialVersion,
      String capturedAt,
      String lastValidatedAt,
      String deviceLastSeenAt,
      String updatedAt) {}

  public record DisableCredentialView(
      String credentialId,
      String status,
      boolean available,
      String disabledAt) {}

  public record LeaseCredentialRequest(
      String platform,
      String shopId,
      String accountId,
      String purpose,
      String taskId,
      String runId,
      Integer requestedLeaseSeconds) {}

  public record CredentialLeaseView(
      String leaseId,
      String credentialId,
      String platform,
      String accountId,
      String accountName,
      String shopId,
      String shopName,
      long credentialVersion,
      String leasedAt,
      String expiresAt,
      JsonNode session) {}

  public record ExtendLeaseRequest(Integer requestedLeaseSeconds) {}

  public record CredentialLeaseStatusView(
      String leaseId,
      String status,
      String heartbeatAt,
      String expiresAt) {}

  public record InvalidateLeaseRequest(String reason) {}
}
