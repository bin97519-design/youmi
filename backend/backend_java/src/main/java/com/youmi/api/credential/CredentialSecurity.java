package com.youmi.api.credential;

import com.youmi.api.common.ApiException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

final class CredentialSecurity {
  private static final SecureRandom RANDOM = new SecureRandom();

  private CredentialSecurity() {}

  static String randomToken(int bytes) {
    byte[] value = new byte[bytes];
    RANDOM.nextBytes(value);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
  }

  static String sha256Hex(String value) {
    try {
      return HexFormat.of().formatHex(
          MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    } catch (Exception error) {
      throw new IllegalStateException("SHA-256 is unavailable", error);
    }
  }

  static byte[] hexBytes(String value) {
    try {
      return HexFormat.of().parseHex(value);
    } catch (IllegalArgumentException error) {
      throw new ApiException(401, "设备凭证无效");
    }
  }

  static String hmacHex(byte[] key, String value) {
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(key, "HmacSHA256"));
      return HexFormat.of().formatHex(mac.doFinal(value.getBytes(StandardCharsets.UTF_8)));
    } catch (Exception error) {
      throw new IllegalStateException("HMAC-SHA256 is unavailable", error);
    }
  }

  static boolean secureEquals(String expected, String actual) {
    return MessageDigest.isEqual(
        expected.getBytes(StandardCharsets.US_ASCII),
        (actual == null ? "" : actual).getBytes(StandardCharsets.US_ASCII));
  }
}
