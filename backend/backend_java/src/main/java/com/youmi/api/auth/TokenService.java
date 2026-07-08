package com.youmi.api.auth;

import java.io.*;
import java.nio.file.*;
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
  private final Path fallbackFile;

  public TokenService(StringRedisTemplate redisTemplate, @Value("${youmi.auth.token-ttl-seconds}") long ttlSeconds) {
    this.redisTemplate = redisTemplate;
    this.ttl = Duration.ofSeconds(ttlSeconds);
    this.fallbackFile = Paths.get(System.getProperty("user.home"), ".youmi-tokens.json");
    loadFallbackFromFile();
  }

  private void loadFallbackFromFile() {
    try {
      if (Files.exists(fallbackFile)) {
        String json = Files.readString(fallbackFile);
        for (String line : json.split("\n")) {
          if (line.isBlank()) continue;
          String[] parts = line.split("::", 3);
          if (parts.length == 3) {
            try {
              fallbackTokens.put(parts[0], new FallbackToken(Long.parseLong(parts[1]), Instant.parse(parts[2])));
            } catch (Exception ignored) {}
          }
        }
      }
    } catch (Exception e) {
      log.warn("Failed to load fallback tokens: {}", e.getMessage());
    }
  }

  private void saveFallbackToFile() {
    try {
      StringBuilder sb = new StringBuilder();
      for (Map.Entry<String, FallbackToken> e : fallbackTokens.entrySet()) {
        if (e.getValue().expiresAt().isAfter(Instant.now()))
          sb.append(e.getKey()).append("::").append(e.getValue().userId()).append("::").append(e.getValue().expiresAt()).append("\n");
      }
      Files.writeString(fallbackFile, sb.toString());
    } catch (Exception ex) {
      log.warn("Failed to save fallback tokens: {}", ex.getMessage());
    }
  }

  public String createToken(Long userId) {
    String token = UUID.randomUUID().toString().replace("-", "");
    String key = PREFIX + token;
    FallbackToken fb = new FallbackToken(userId, Instant.now().plus(ttl));
    try {
      redisTemplate.opsForValue().set(key, String.valueOf(userId), ttl);
      // 同步写文件备份
      fallbackTokens.put(token, fb);
      saveFallbackToFile();
    } catch (RuntimeException e) {
      log.warn("Redis unavailable, using file fallback: {}", e.getMessage());
      fallbackTokens.put(token, fb);
      saveFallbackToFile();
    }
    return token;
  }

  public Optional<Long> getUserId(String token) {
    if (token == null || token.isBlank()) return Optional.empty();
    String key = PREFIX + token;
    try {
      String userId = redisTemplate.opsForValue().get(key);
      if (userId != null && !userId.isBlank()) {
        redisTemplate.expire(key, ttl);
        return Optional.of(Long.valueOf(userId));
      }
    } catch (RuntimeException e) {
      log.warn("Redis read failed, trying file fallback: {}", e.getMessage());
    }
    // 文件降级
    FallbackToken fb = fallbackTokens.get(token);
    if (fb == null) { loadFallbackFromFile(); fb = fallbackTokens.get(token); }
    if (fb == null) return Optional.empty();
    if (fb.expiresAt().isBefore(Instant.now())) {
      fallbackTokens.remove(token); saveFallbackToFile();
      return Optional.empty();
    }
    fallbackTokens.put(token, new FallbackToken(fb.userId(), Instant.now().plus(ttl)));
    saveFallbackToFile();
    return Optional.of(fb.userId());
  }

  public void revoke(String token) {
    if (token == null || token.isBlank()) return;
    fallbackTokens.remove(token);
    saveFallbackToFile();
    try { redisTemplate.delete(PREFIX + token); } catch (RuntimeException ignored) {}
  }

  private record FallbackToken(Long userId, Instant expiresAt) {}
}
