package com.youmi.api.credential;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.Locale;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class WdtCredentialPolicy {
  private static final String HOST = "erp.huice.com";
  private static final String TOKEN_COOKIE = "X-HC-TOKEN";

  private final ObjectMapper objectMapper;
  private final Clock clock;

  @Autowired
  public WdtCredentialPolicy(ObjectMapper objectMapper) {
    this(objectMapper, Clock.systemUTC());
  }

  WdtCredentialPolicy(ObjectMapper objectMapper, Clock clock) {
    this.objectMapper = objectMapper;
    this.clock = clock;
  }

  public ValidatedPayload validate(byte[] plaintext) {
    try {
      JsonNode root = objectMapper.readTree(plaintext);
      if (root == null || !root.isObject() || root.path("schemaVersion").asInt() != 1) {
        throw new ApiException(400, "旺店通会话凭证版本无效");
      }
      requireWdtUrl(root.path("origin").asText());
      requireWdtUrl(root.path("pageUrl").asText());

      JsonNode cookies = root.path("cookies");
      if (!cookies.isArray() || cookies.size() != 1) {
        throw new ApiException(400, "旺店通会话必须且只能包含登录令牌");
      }
      JsonNode cookie = cookies.get(0);
      String name = cookie.path("name").asText();
      String value = cookie.path("value").asText();
      String domain = normalizeDomain(cookie.path("domain").asText());
      if (!TOKEN_COOKIE.equalsIgnoreCase(name) || !HOST.equals(domain)
          || value.isBlank() || value.length() > 20_000) {
        throw new ApiException(400, "旺店通登录令牌格式无效");
      }
      validateEmptyStorage(root.path("storage").path("localStorage"));
      validateEmptyStorage(root.path("storage").path("sessionStorage"));

      JsonNode claims = parseJwtClaims(value);
      long expirySeconds = claims.path("exp").asLong(0L);
      if (expirySeconds <= 0L) throw new ApiException(400, "旺店通登录令牌缺少有效期");
      Instant expiresAt = Instant.ofEpochSecond(expirySeconds);
      if (!expiresAt.isAfter(clock.instant())) {
        throw new ApiException(400, "旺店通登录令牌已过期，请重新登录后同步");
      }

      String shopId = firstClaim(claims, "sid", "tenantId", "sellerId", "shopId", "companyId");
      String accountId = firstClaim(claims, "ud", "uid", "userId", "sub", "un");
      if (shopId.isBlank()) shopId = accountId;
      if (accountId.isBlank()) accountId = shopId;
      if (shopId.isBlank() || accountId.isBlank()) {
        throw new ApiException(400, "旺店通登录令牌缺少店铺或账号标识");
      }
      String shopName = firstClaim(claims, "sn", "shopName", "tenantName", "companyName");
      String accountName = firstClaim(claims, "un", "userName", "username", "name", "nickName");
      if (shopName.isBlank()) shopName = shopId;
      if (accountName.isBlank()) accountName = accountId;

      return new ValidatedPayload(
          new String(plaintext, StandardCharsets.UTF_8), 1,
          accountId, accountName, shopId, shopName, expiresAt);
    } catch (ApiException error) {
      throw error;
    } catch (Exception error) {
      throw new ApiException(400, "旺店通会话凭证格式无效");
    }
  }

  private JsonNode parseJwtClaims(String token) {
    String[] parts = token.split("\\.", -1);
    if (parts.length < 2 || parts[1].isBlank()) {
      throw new ApiException(400, "旺店通登录令牌格式无效");
    }
    try {
      JsonNode claims = objectMapper.readTree(Base64.getUrlDecoder().decode(parts[1]));
      if (claims == null || !claims.isObject()) {
        throw new ApiException(400, "旺店通登录令牌内容无效");
      }
      return claims;
    } catch (IllegalArgumentException error) {
      throw new ApiException(400, "旺店通登录令牌编码无效");
    } catch (Exception error) {
      throw new ApiException(400, "旺店通登录令牌内容无效");
    }
  }

  private void validateEmptyStorage(JsonNode storage) {
    if (storage.isMissingNode() || storage.isNull()) return;
    if (!storage.isObject() || !storage.isEmpty()) {
      throw new ApiException(400, "旺店通会话不允许附带浏览器存储字段");
    }
  }

  private void requireWdtUrl(String value) {
    try {
      URI uri = URI.create(value);
      if (!"https".equalsIgnoreCase(uri.getScheme()) || !HOST.equalsIgnoreCase(uri.getHost())) {
        throw new ApiException(400, "会话凭证来源不是旺店通");
      }
    } catch (IllegalArgumentException error) {
      throw new ApiException(400, "旺店通来源地址无效");
    }
  }

  private String firstClaim(JsonNode claims, String... names) {
    for (String name : names) {
      JsonNode value = claims.get(name);
      if (value == null || value.isNull() || value.isContainerNode()) continue;
      String clean = value.asText("").trim();
      if (!clean.isBlank()) return clean.length() > 128 ? clean.substring(0, 128) : clean;
    }
    return "";
  }

  private String normalizeDomain(String value) {
    return value == null ? "" : value.trim().toLowerCase(Locale.ROOT).replaceFirst("^\\.", "");
  }

  public record ValidatedPayload(
      String json,
      int cookieCount,
      String accountId,
      String accountName,
      String shopId,
      String shopName,
      Instant expiresAt) {}
}
