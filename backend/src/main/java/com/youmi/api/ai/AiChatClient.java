package com.youmi.api.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

@Service
public class AiChatClient {
  private final ObjectMapper objectMapper;
  private final AiProperties properties;
  private final HttpClient httpClient;

  public AiChatClient(ObjectMapper objectMapper, AiProperties properties) {
    this.objectMapper = objectMapper;
    this.properties = properties;
    this.httpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(Math.max(3, properties.getTimeoutSeconds())))
        .build();
  }

  public boolean isConfigured() {
    return properties.isConfigured();
  }

  public String model() {
    return properties.getModel();
  }

  public AiChatDtos.StatusResponse status() {
    return new AiChatDtos.StatusResponse(
        properties.isConfigured(),
        properties.normalizedBaseUrl(),
        properties.normalizedChatPath(),
        properties.getModel(),
        properties.getTemperature(),
        properties.getTimeoutSeconds());
  }

  public AiChatDtos.CompletionResult complete(List<AiChatDtos.Message> messages, Double temperature)
      throws Exception {
    List<Map<String, Object>> payloadMessages = messages.stream()
        .map(message -> {
          Map<String, Object> item = new LinkedHashMap<>();
          item.put("role", message.role());
          item.put("content", message.content());
          return item;
        })
        .toList();
    return completeRaw(payloadMessages, temperature);
  }

  public AiChatDtos.CompletionResult completeRaw(List<Map<String, Object>> messages, Double temperature)
      throws Exception {
    if (!properties.isConfigured()) {
      throw new IllegalStateException("AI provider api key is not configured");
    }

    Map<String, Object> body = new LinkedHashMap<>();
    body.put("model", properties.getModel());
    body.put("temperature", temperature == null ? properties.getTemperature() : temperature);
    body.put("messages", messages);

    String endpoint = properties.normalizedBaseUrl() + properties.normalizedChatPath();
    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(endpoint))
        .timeout(Duration.ofSeconds(Math.max(5, properties.getTimeoutSeconds())))
        .header("Authorization", "Bearer " + properties.getApiKey())
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
        .build();

    HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      throw new IllegalStateException(
          "AI provider request failed: " + response.statusCode() + " " + compact(response.body()));
    }

    JsonNode root = objectMapper.readTree(response.body());
    String content = root.path("choices").path(0).path("message").path("content").asText();
    if (content == null || content.isBlank()) {
      throw new IllegalStateException("AI provider returned empty content");
    }
    return new AiChatDtos.CompletionResult("openai-compatible", properties.getModel(), content);
  }

  private String compact(String body) {
    if (body == null || body.isBlank()) return "";
    String compacted = body.replaceAll("\\s+", " ").trim();
    return compacted.length() > 400 ? compacted.substring(0, 400) + "..." : compacted;
  }
}
