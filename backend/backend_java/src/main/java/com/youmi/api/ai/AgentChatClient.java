package com.youmi.api.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.image.ModelApiKeyService.ResolvedModelApiKey;
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
import org.springframework.beans.factory.annotation.Autowired;

@Service
public class AgentChatClient {
  private static final Logger log = LoggerFactory.getLogger(AgentChatClient.class);
  private static final int MAX_HANDSHAKE_ATTEMPTS = 3;

  private final ObjectMapper objectMapper;
  private final AgentChatProperties properties;
  private final HttpClient httpClient;
  private AiCallLogService aiCallLogService;
  private final ThreadLocal<Boolean> canvasAgentDropdown = ThreadLocal.withInitial(() -> false);

  public AgentChatClient(ObjectMapper objectMapper, AgentChatProperties properties) {
    this.objectMapper = objectMapper;
    this.properties = properties;
    this.httpClient = buildHttpClient();
    log.info(
        "Agent model endpoint configured: {}{}",
        properties.normalizedBaseUrl(),
        properties.normalizedChatPath());
  }

  @Autowired(required = false)
  void setAiCallLogService(AiCallLogService aiCallLogService) {
    this.aiCallLogService = aiCallLogService;
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

  public AiChatDtos.CompletionResult completeCanvasAgent(
      List<AiChatDtos.Message> messages, Double temperature) throws Exception {
    canvasAgentDropdown.set(true);
    try {
      return complete(messages, temperature);
    } finally {
      canvasAgentDropdown.remove();
    }
  }

  public AiChatDtos.CompletionResult completeCanvasAgentVision(
      String systemPrompt, String userPrompt, List<String> imageUrls, Double temperature) throws Exception {
    canvasAgentDropdown.set(true);
    try {
      return completeVision(systemPrompt, userPrompt, imageUrls, temperature);
    } finally {
      canvasAgentDropdown.remove();
    }
  }

  public AiChatDtos.CompletionResult completeVision(
      String systemPrompt,
      String userPrompt,
      List<String> imageUrls,
      Double temperature) throws Exception {
    return completeVision(systemPrompt, userPrompt, imageUrls, temperature, null);
  }

  public AiChatDtos.CompletionResult completeVision(
      String systemPrompt, String userPrompt, List<String> imageUrls,
      Double temperature, Integer maxTokens) throws Exception {
    return completeVision(systemPrompt, userPrompt, imageUrls, temperature, maxTokens, null);
  }

  public AiChatDtos.CompletionResult completeVision(
      String systemPrompt, String userPrompt, List<String> imageUrls,
      Double temperature, Integer maxTokens, Duration timeout) throws Exception {
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
    return completeRaw(messages, temperature, maxTokens, timeout);
  }

  public AiChatDtos.CompletionResult completeConfiguredModel(
      ResolvedModelApiKey credential,
      String systemPrompt,
      String userPrompt,
      List<String> imageUrls,
      Double temperature) throws Exception {
    return completeConfiguredModel(credential, systemPrompt, userPrompt, imageUrls,
        temperature, "canvas-agent", "dropdown");
  }

  public AiChatDtos.CompletionResult completeConfiguredModel(
      ResolvedModelApiKey credential,
      String systemPrompt,
      String userPrompt,
      List<String> imageUrls,
      Double temperature,
      String source,
      String selectionMode) throws Exception {
    if (credential == null || credential.apiKey() == null || credential.apiKey().isBlank()) {
      throw new IllegalStateException("识图推理模型 API Key 未配置");
    }
    List<Object> content = new ArrayList<>();
    content.add(Map.of("type", "text", "text", userPrompt == null ? "" : userPrompt));
    if (imageUrls != null) {
      imageUrls.stream()
          .filter(url -> url != null && !url.isBlank() && !url.startsWith("blob:"))
          .map(String::trim)
          .distinct()
          .limit(8)
          .forEach(url -> content.add(Map.of(
              "type", "image_url", "image_url", Map.of("url", url))));
    }
    List<Map<String, Object>> messages = new ArrayList<>();
    if (systemPrompt != null && !systemPrompt.isBlank()) {
      messages.add(Map.of("role", "system", "content", systemPrompt));
    }
    messages.add(Map.of("role", "user", "content", content));

    Map<String, Object> body = new LinkedHashMap<>();
    body.putAll(credential.defaultData());
    body.put("model", credential.model());
    body.put("max_tokens", Math.max(200, properties.getMaxTokens()));
    body.put("temperature", temperature == null ? properties.getTemperature() : temperature);
    body.put("messages", messages);
    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(credential.generationEndpoint()))
        .timeout(Duration.ofSeconds(Math.max(8, properties.getTimeoutSeconds())))
        .header("Authorization", "Bearer " + credential.apiKey())
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
        .build();
    long started = System.nanoTime();
    HttpResponse<String> response;
    try {
      response = sendWithHandshakeRetry(request);
    } catch (Exception error) {
      recordCall(source, "chat", credential.provider(), credential.model(), credential.id(), selectionMode,
          false, null, started, error);
      throw error;
    }
    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      recordCall(source, "chat", credential.provider(), credential.model(), credential.id(), selectionMode,
          false, response.statusCode(), started, null);
    } else {
      recordCall(source, "chat", credential.provider(), credential.model(), credential.id(), selectionMode,
          true, response.statusCode(), started, null);
    }
    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      String detail = compact(response.body())
          .replace(credential.apiKey(), "[redacted]")
          .replaceAll("sk-[A-Za-z0-9_-]+", "[redacted]");
      throw new IllegalStateException(
          "识图推理模型请求失败（HTTP " + response.statusCode() + "）: " + detail);
    }
    String contentText = readContent(objectMapper.readTree(response.body()));
    if (contentText.isBlank()) throw new IllegalStateException("识图推理模型返回内容为空");
    return new AiChatDtos.CompletionResult(credential.provider(), credential.model(), contentText);
  }

  private AiChatDtos.CompletionResult completeRaw(
      List<Map<String, Object>> rawMessages, Double temperature) throws Exception {
    return completeRaw(rawMessages, temperature, null, null);
  }

  private AiChatDtos.CompletionResult completeRaw(
      List<Map<String, Object>> rawMessages, Double temperature, Integer maxTokens, Duration timeout) throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("model", properties.getModel());
    body.put("max_tokens", maxTokens == null ? Math.max(200, properties.getMaxTokens())
        : Math.max(200, Math.min(16000, maxTokens)));
    body.put("temperature", temperature == null ? properties.getTemperature() : temperature);
    body.put("messages", rawMessages);

    String endpoint = properties.normalizedBaseUrl() + properties.normalizedChatPath();
    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(endpoint))
        .timeout(timeout == null ? Duration.ofSeconds(Math.max(8, properties.getTimeoutSeconds())) : timeout)
        .header("Authorization", "Bearer " + properties.getApiKey())
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
        .build();

    long started = System.nanoTime();
    HttpResponse<String> response;
    try {
      response = sendWithHandshakeRetry(request);
    } catch (Exception error) {
      recordCall(canvasAgentDropdown.get() ? "canvas-agent" : "agent-chat", "chat", "teamorouter", properties.getModel(), null,
          canvasAgentDropdown.get() ? "dropdown" : "system_default",
          false, null, started, error);
      throw error;
    }
    recordCall(canvasAgentDropdown.get() ? "canvas-agent" : "agent-chat", "chat", "teamorouter", properties.getModel(), null,
        canvasAgentDropdown.get() ? "dropdown" : "system_default",
        response.statusCode() >= 200 && response.statusCode() < 300, response.statusCode(), started, null);
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

  private void recordCall(String source, String operation, String provider, String model,
      Long apiKeyId, boolean success, Integer httpStatus, long started, Exception error) {
    recordCall(source, operation, provider, model, apiKeyId, "system_default",
        success, httpStatus, started, error);
  }

  private void recordCall(String source, String operation, String provider, String model,
      Long apiKeyId, String selectionMode, boolean success, Integer httpStatus, long started, Exception error) {
    if (aiCallLogService == null) return;
    aiCallLogService.record(source, operation, provider, model, apiKeyId, selectionMode, success, httpStatus,
        (System.nanoTime() - started) / 1_000_000L,
        error == null ? null : error.getClass().getSimpleName());
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
