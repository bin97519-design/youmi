package com.youmi.api.credential;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.MGF1ParameterSpec;
import java.util.Base64;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.OAEPParameterSpec;
import javax.crypto.spec.PSource;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Service;

@Service
public class CredentialTransportCrypto {
  private static final int MAX_PLAINTEXT_BYTES = 256 * 1024;
  private final ObjectMapper objectMapper;
  private final KeyPair keyPair;
  private final String keyId;

  public CredentialTransportCrypto(ObjectMapper objectMapper) {
    this.objectMapper = objectMapper;
    try {
      KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
      generator.initialize(3072);
      this.keyPair = generator.generateKeyPair();
      this.keyId = UUID.randomUUID().toString();
    } catch (Exception error) {
      throw new IllegalStateException("无法初始化凭证传输密钥", error);
    }
  }

  public CredentialDtos.EncryptionKeyView publicKey() {
    RSAPublicKey publicKey = (RSAPublicKey) keyPair.getPublic();
    var jwk = objectMapper.createObjectNode();
    jwk.put("kty", "RSA");
    jwk.put("alg", "RSA-OAEP-256");
    jwk.put("use", "enc");
    jwk.putArray("key_ops").add("encrypt");
    jwk.put("n", unsignedBase64(publicKey.getModulus().toByteArray()));
    jwk.put("e", unsignedBase64(publicKey.getPublicExponent().toByteArray()));
    return new CredentialDtos.EncryptionKeyView(keyId, jwk);
  }

  public byte[] decrypt(CredentialDtos.TransportEnvelope envelope) {
    if (envelope == null || !keyId.equals(envelope.keyId())) {
      throw new ApiException(409, "传输加密密钥已轮换，请重新同步");
    }
    try {
      byte[] wrappedKey = decode(envelope.wrappedKey(), 1024);
      byte[] iv = decode(envelope.iv(), 32);
      byte[] ciphertext = decode(envelope.ciphertext(), MAX_PLAINTEXT_BYTES + 32);
      if (iv.length != 12) throw new ApiException(400, "加密载荷 IV 无效");

      Cipher rsa = Cipher.getInstance("RSA/ECB/OAEPPadding");
      rsa.init(Cipher.DECRYPT_MODE, keyPair.getPrivate(), new OAEPParameterSpec(
          "SHA-256", "MGF1", MGF1ParameterSpec.SHA256, PSource.PSpecified.DEFAULT));
      byte[] aesKey = rsa.doFinal(wrappedKey);
      if (aesKey.length != 32) throw new ApiException(400, "加密载荷密钥无效");

      Cipher aes = Cipher.getInstance("AES/GCM/NoPadding");
      aes.init(Cipher.DECRYPT_MODE, new SecretKeySpec(aesKey, "AES"), new GCMParameterSpec(128, iv));
      byte[] plaintext = aes.doFinal(ciphertext);
      if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new ApiException(400, "会话凭证载荷过大");
      return plaintext;
    } catch (ApiException error) {
      throw error;
    } catch (Exception error) {
      throw new ApiException(400, "无法解密会话凭证载荷");
    }
  }

  private byte[] decode(String value, int maxBytes) {
    if (value == null || value.isBlank() || value.length() > maxBytes * 2) {
      throw new ApiException(400, "加密载荷格式无效");
    }
    try {
      byte[] decoded = Base64.getUrlDecoder().decode(value);
      if (decoded.length > maxBytes) throw new ApiException(400, "加密载荷过大");
      return decoded;
    } catch (IllegalArgumentException error) {
      throw new ApiException(400, "加密载荷格式无效");
    }
  }

  private String unsignedBase64(byte[] value) {
    int offset = value.length > 1 && value[0] == 0 ? 1 : 0;
    byte[] unsigned = java.util.Arrays.copyOfRange(value, offset, value.length);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(unsigned);
  }
}
