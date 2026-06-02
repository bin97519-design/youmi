package com.youmi.api.auth;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class TokenService {
  private static final String PREFIX = "youmi:auth:token:";
  private static final Logger log = LoggerFactory.getLogger(TokenService.class);

  private final StringRedisTemplate redisTemplate;
  private final Duration ttl;
  private final Map<String, FallbackToken> fallbackTokens = new ConcurrentHashMap<>();

  public TokenService(StringRedisTemplate redisTemplate, @Value("${youmi.auth.token-ttl-seconds}") long ttlSeconds) {
    this.redisTemplate = redisTemplate;
    this.ttl = Duration.ofSeconds(ttlSeconds);
  }

  public String createToken(Long userId) {
    String token = UUID.randomUUID().toString().replace("-", "");
    try {
      redisTemplate.opsForValue().set(PREFIX + token, String.valueOf(userId), ttl);
    } catch (RuntimeException error) {
      log.warn("Redis unavailable, using in-memory auth token fallback: {}", error.getMessage());
      fallbackTokens.put(token, new FallbackToken(userId, Instant.now().plus(ttl)));
    }
    return token;
  }

  public Optional<Long> getUserId(String token) {
    if (token == null || token.isBlank()) return Optional.empty();
    try {
      String userId = redisTemplate.opsForValue().get(PREFIX + token);
      if (userId == null || userId.isBlank()) return Optional.empty();
      redisTemplate.expire(PREFIX + token, ttl);
      return Optional.of(Long.valueOf(userId));
    } catch (RuntimeException error) {
      log.warn("Redis unavailable while reading token, using in-memory fallback: {}", error.getMessage());
      return getFallbackUserId(token);
    }
  }

  public void revoke(String token) {
    if (token == null || token.isBlank()) return;
    fallbackTokens.remove(token);
    try {
      redisTemplate.delete(PREFIX + token);
    } catch (RuntimeException error) {
      log.warn("Redis unavailable while revoking token: {}", error.getMessage());
    }
  }

  private Optional<Long> getFallbackUserId(String token) {
    FallbackToken fallback = fallbackTokens.get(token);
    if (fallback == null) return Optional.empty();
    if (fallback.expiresAt().isBefore(Instant.now())) {
      fallbackTokens.remove(token);
      return Optional.empty();
    }
    fallbackTokens.put(token, new FallbackToken(fallback.userId(), Instant.now().plus(ttl)));
    return Optional.of(fallback.userId());
  }

  private record FallbackToken(Long userId, Instant expiresAt) {
  }
}
