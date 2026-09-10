package com.youmi.api.credential;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import org.springframework.stereotype.Component;

@Component
public class SycmCredentialPolicy {
  private static final Set<String> COOKIE_NAMES = lowerSet(
      "_tb_token_", "cookie2", "t", "tracknick", "unb", "uc1", "uc3", "sgcookie",
      "csg", "lgc", "_l_g_", "cookie17", "dnk", "skt", "_nk_", "_m_h5_tk",
      "_m_h5_tk_enc", "isg", "l", "tfstk");
  private static final Set<String> STORAGE_NAMES = lowerSet(
      "token", "csrfToken", "accessToken", "refreshToken", "sessionId", "sid", "m_h5_tk");

  private final ObjectMapper objectMapper;

  public SycmCredentialPolicy(ObjectMapper objectMapper) {
    this.objectMapper = objectMapper;
  }

  public ValidatedPayload validate(byte[] plaintext) {
    try {
      JsonNode root = objectMapper.readTree(plaintext);
      if (root == null || !root.isObject() || root.path("schemaVersion").asInt() != 1) {
        throw new ApiException(400, "生意参谋会话凭证版本无效");
      }
      requireSycmUrl(root.path("origin").asText());
      requireSycmUrl(root.path("pageUrl").asText());
      JsonNode cookies = root.path("cookies");
      if (!cookies.isArray() || cookies.isEmpty() || cookies.size() > 64) {
        throw new ApiException(400, "生意参谋 Cookie 数量无效");
      }
      for (JsonNode cookie : cookies) validateCookie(cookie);
      validateStorage(root.path("storage").path("localStorage"));
      validateStorage(root.path("storage").path("sessionStorage"));
      return new ValidatedPayload(new String(plaintext, StandardCharsets.UTF_8), cookies.size());
    } catch (ApiException error) {
      throw error;
    } catch (Exception error) {
      throw new ApiException(400, "生意参谋会话凭证格式无效");
    }
  }

  private void validateCookie(JsonNode cookie) {
    String name = cookie.path("name").asText();
    String value = cookie.path("value").asText();
    String domain = normalizeDomain(cookie.path("domain").asText());
    if (!COOKIE_NAMES.contains(name.toLowerCase(Locale.ROOT))) {
      throw new ApiException(400, "会话凭证包含未授权 Cookie 字段");
    }
    if (!isTaobaoDomain(domain) || value.isBlank() || value.length() > 20_000) {
      throw new ApiException(400, "会话凭证 Cookie 格式无效");
    }
  }

  private void validateStorage(JsonNode storage) {
    if (storage.isMissingNode() || storage.isNull()) return;
    if (!storage.isObject() || storage.size() > STORAGE_NAMES.size()) {
      throw new ApiException(400, "会话凭证存储字段格式无效");
    }
    storage.fields().forEachRemaining(entry -> {
      if (!STORAGE_NAMES.contains(entry.getKey().toLowerCase(Locale.ROOT))) {
        throw new ApiException(400, "会话凭证包含未授权存储字段");
      }
      String value = entry.getValue().asText();
      if (value.isBlank() || value.length() > 20_000) {
        throw new ApiException(400, "会话凭证存储字段格式无效");
      }
    });
  }

  private void requireSycmUrl(String value) {
    try {
      URI uri = URI.create(value);
      if (!"https".equalsIgnoreCase(uri.getScheme()) || !"sycm.taobao.com".equalsIgnoreCase(uri.getHost())) {
        throw new ApiException(400, "会话凭证来源不是生意参谋");
      }
    } catch (IllegalArgumentException error) {
      throw new ApiException(400, "生意参谋来源地址无效");
    }
  }

  private boolean isTaobaoDomain(String domain) {
    return domain.equals("taobao.com") || domain.endsWith(".taobao.com")
        || domain.equals("tmall.com") || domain.endsWith(".tmall.com");
  }

  private String normalizeDomain(String value) {
    return value == null ? "" : value.trim().toLowerCase(Locale.ROOT).replaceFirst("^\\.", "");
  }

  private static Set<String> lowerSet(String... values) {
    Set<String> result = new HashSet<>();
    for (String value : values) result.add(value.toLowerCase(Locale.ROOT));
    return Set.copyOf(result);
  }

  public record ValidatedPayload(String json, int cookieCount) {}
}
