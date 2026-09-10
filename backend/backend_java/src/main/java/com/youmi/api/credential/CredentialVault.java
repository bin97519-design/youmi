package com.youmi.api.credential;

import com.youmi.api.common.ApiException;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class CredentialVault {
  private static final SecureRandom RANDOM = new SecureRandom();
  private final SecretKey masterKey;
  private final String keyVersion;

  public CredentialVault(
      @Value("${youmi.credentials.master-key:}") String encodedMasterKey,
      @Value("${youmi.credentials.master-key-version:v1}") String keyVersion) {
    this.masterKey = parseMasterKey(encodedMasterKey);
    this.keyVersion = keyVersion == null || keyVersion.isBlank() ? "v1" : keyVersion.trim();
  }

  public VaultPayload encrypt(byte[] plaintext) {
    if (masterKey == null) {
      throw new ApiException(503, "凭证中心主密钥未配置");
    }
    try {
      KeyGenerator generator = KeyGenerator.getInstance("AES");
      generator.init(256);
      SecretKey dataKey = generator.generateKey();
      String encryptedPayload = encryptWithKey(dataKey, plaintext);
      String encryptedDek = encryptWithKey(masterKey, dataKey.getEncoded());
      return new VaultPayload(encryptedPayload, encryptedDek, keyVersion);
    } catch (ApiException error) {
      throw error;
    } catch (Exception error) {
      throw new IllegalStateException("无法加密会话凭证", error);
    }
  }

  public byte[] decrypt(VaultPayload payload) {
    if (masterKey == null) {
      throw new ApiException(503, "凭证中心主密钥未配置");
    }
    byte[] dek = decryptWithKey(masterKey, payload.encryptedDek());
    return decryptWithKey(new SecretKeySpec(dek, "AES"), payload.encryptedPayload());
  }

  byte[] decryptForTest(VaultPayload payload) {
    return decrypt(payload);
  }

  private String encryptWithKey(SecretKey key, byte[] value) throws Exception {
    byte[] iv = new byte[12];
    RANDOM.nextBytes(iv);
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, iv));
    byte[] ciphertext = cipher.doFinal(value);
    return encode(iv) + "." + encode(ciphertext);
  }

  private byte[] decryptWithKey(SecretKey key, String value) {
    try {
      String[] parts = value.split("\\.", 2);
      if (parts.length != 2) throw new IllegalArgumentException("Invalid envelope");
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, decode(parts[0])));
      return cipher.doFinal(decode(parts[1]));
    } catch (Exception error) {
      throw new IllegalStateException("无法解密会话凭证", error);
    }
  }

  private SecretKey parseMasterKey(String value) {
    if (value == null || value.isBlank()) return null;
    try {
      byte[] raw = Base64.getDecoder().decode(value.trim());
      if (raw.length != 32) throw new IllegalArgumentException("Master key must be 32 bytes");
      return new SecretKeySpec(raw, "AES");
    } catch (IllegalArgumentException error) {
      throw new IllegalStateException("YOUMI_CREDENTIAL_MASTER_KEY 必须是 32 字节密钥的 Base64", error);
    }
  }

  private String encode(byte[] value) {
    return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
  }

  private byte[] decode(String value) {
    return Base64.getUrlDecoder().decode(value);
  }

  public record VaultPayload(String encryptedPayload, String encryptedDek, String keyVersion) {}
}
