package com.youmi.api.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import javax.net.ssl.SSLHandshakeException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class AgentChatClient {
  private static final Logger log = LoggerFactory.getLogger(AgentChatClient.class);
  private static final int MAX_HANDSHAKE_ATTEMPTS = 3;

  private final ObjectMapper objectMapper;
  private final AgentChatProperties properties;
  private final HttpClient httpClient;

  public AgentChatClient(ObjectMapper objectMapper, AgentChatProperties properties) {
    this.objectMapper = objectMapper;
    this.properties = properties;
    this.httpClient = buildHttpClient();
    log.info(
        "Agent model endpoint configured: {}{}",
        properties.normalizedBaseUrl(),
        properties.normalizedChatPath());
  }

  private HttpClient buildHttpClient() {
    return HttpClient.newBuilder()
        .version(HttpClient.Version.HTTP_1_1)
        .connectTimeout(Duration.ofSeconds(Math.max(3, properties.getTimeoutSeconds())))
        .build();
  }

  public boolean isConfigured() {
    return properties.isConfigured();
  }

  public String model() {
    return properties.getModel();
  }

  public AiChatDtos.CompletionResult complete(
      List<AiChatDtos.Message> messages, Double temperature) throws Exception {
    requireConfigured();
    List<Map<String, Object>> rawMessages = messages == null
        ? List.of()
        : messages.stream()
            .map(message -> Map.<String, Object>of(
                "role", message.role(),
                "content", message.content()))
            .toList();
    return completeRaw(rawMessages, temperature);
  }

  public AiChatDtos.CompletionResult completeVision(
      String systemPrompt,
      String userPrompt,
      List<String> imageUrls,
      Double temperature) throws Exception {
    requireConfigured();
    List<Map<String, Object>> content = new ArrayList<>();
    content.add(Map.of("type", "text", "text", userPrompt == null ? "" : userPrompt));
    if (imageUrls != null) {
      imageUrls.stream()
          .filter(url -> url != null && !url.isBlank() && !url.startsWith("blob:"))
          .map(String::trim)
          .distinct()
          .limit(8)
          .forEach(url -> content.add(Map.of(
              "type", "image_url",
              "image_url", Map.of("url", url))));
    }

    List<Map<String, Object>> messages = new ArrayList<>();
    if (systemPrompt != null && !systemPrompt.isBlank()) {
      messages.add(Map.of("role", "system", "content", systemPrompt));
    }
    messages.add(Map.of("role", "user", "content", content));
    return completeRaw(messages, temperature);
  }

  private AiChatDtos.CompletionResult completeRaw(
      List<Map<String, Object>> rawMessages, Double temperature) throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("model", properties.getModel());
    body.put("max_tokens", Math.max(200, properties.getMaxTokens()));
    body.put("temperature", temperature == null ? properties.getTemperature() : temperature);
    body.put("messages", rawMessages);

    String endpoint = properties.normalizedBaseUrl() + properties.normalizedChatPath();
    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(endpoint))
        .timeout(Duration.ofSeconds(Math.max(8, properties.getTimeoutSeconds())))
        .header("Authorization", "Bearer " + properties.getApiKey())
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
        .build();

    HttpResponse<String> response = sendWithHandshakeRetry(request);
    log.info("Agent model response status: {}", response.statusCode());
    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      throw new IllegalStateException(
          "Agent model request failed: " + response.statusCode() + " " + compact(response.body()));
    }

    String content = readContent(objectMapper.readTree(response.body()));
    if (content.isBlank()) {
      throw new IllegalStateException("Agent model returned empty content");
    }
    return new AiChatDtos.CompletionResult("teamorouter", properties.getModel(), content);
  }

  private HttpResponse<String> sendWithHandshakeRetry(HttpRequest request)
      throws IOException, InterruptedException {
    for (int attempt = 1; attempt <= MAX_HANDSHAKE_ATTEMPTS; attempt++) {
      try {
        HttpClient client = attempt == 1 ? httpClient : buildHttpClient();
        return client.send(
            request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
      } catch (IOException error) {
        if (!isHandshakeFailure(error) || attempt == MAX_HANDSHAKE_ATTEMPTS) {
          throw error;
        }
        log.warn(
            "Agent HTTPS handshake failed (attempt {}/{}), retrying with a new connection: {}",
            attempt,
            MAX_HANDSHAKE_ATTEMPTS,
            error.getMessage());
        Thread.sleep(300L * attempt);
      }
    }
    throw new IOException("Agent model request failed after HTTPS handshake retries");
  }

  private boolean isHandshakeFailure(Throwable error) {
    Throwable current = error;
    while (current != null) {
      if (current instanceof SSLHandshakeException) return true;
      current = current.getCause();
    }
    return false;
  }

  private String readContent(JsonNode root) {
    JsonNode choices = root.path("choices");
    if (!choices.isArray() || choices.isEmpty()) return "";
    JsonNode content = choices.get(0).path("message").path("content");
    if (content.isTextual()) return content.asText("").trim();
    if (!content.isArray()) return "";

    StringBuilder text = new StringBuilder();
    for (JsonNode item : content) {
      String value = item.path("text").asText(item.path("content").asText(""));
      if (!value.isBlank()) {
        if (!text.isEmpty()) text.append('\n');
        text.append(value.trim());
      }
    }
    return text.toString();
  }

  private void requireConfigured() {
    if (!properties.isConfigured()) {
      throw new IllegalStateException("Agent model api key is not configured");
    }
  }

  private String compact(String value) {
    if (value == null) return "";
    String cleaned = value.replaceAll("\\s+", " ").trim();
    return cleaned.length() > 1000 ? cleaned.substring(0, 1000) + "..." : cleaned;
  }
}
