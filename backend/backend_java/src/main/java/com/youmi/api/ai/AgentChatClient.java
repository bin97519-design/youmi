package com.youmi.api.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.image.ModelApiKeyService.ResolvedModelApiKey;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
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
import java.util.function.Consumer;
import javax.net.ssl.SSLHandshakeException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;

@Service
public class AgentChatClient {
  private static final Logger log = LoggerFactory.getLogger(AgentChatClient.class);
  private static final int MAX_HANDSHAKE_ATTEMPTS = 3;
  private static final java.util.concurrent.ScheduledExecutorService STREAM_DEADLINES =
      java.util.concurrent.Executors.newSingleThreadScheduledExecutor(task -> {
        Thread thread = new Thread(task, "agent-stream-deadline");
        thread.setDaemon(true);
        return thread;
      });

  private final ObjectMapper objectMapper;
  private final AgentChatProperties properties;
  private final HttpClient httpClient;
  private AiCallLogService aiCallLogService;
  private final ThreadLocal<Boolean> canvasAgentDropdown = ThreadLocal.withInitial(() -> false);
  private final ThreadLocal<Consumer<AgentContextUsage>> usageListener = new ThreadLocal<>();
  private final ThreadLocal<AgentContextUsage> currentUsage = new ThreadLocal<>();

  public <T> T withContextUsage(Consumer<AgentContextUsage> listener,
      java.util.concurrent.Callable<T> work) throws Exception {
    var previousListener = usageListener.get();
    var previousUsage = currentUsage.get();
    usageListener.set(listener);
    try { return work.call(); }
    finally {
      if (previousListener == null) usageListener.remove(); else usageListener.set(previousListener);
      if (previousUsage == null) currentUsage.remove(); else currentUsage.set(previousUsage);
    }
  }

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
    return completeCanvasAgentVision(systemPrompt, userPrompt, imageUrls, temperature, null);
  }

  public AiChatDtos.CompletionResult completeCanvasAgentVision(
      String systemPrompt, String userPrompt, List<String> imageUrls, Double temperature,
      Integer maxTokens) throws Exception {
    canvasAgentDropdown.set(true);
    try {
      return completeVision(systemPrompt, userPrompt, imageUrls, temperature, maxTokens);
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
    return completeVisionForModel(properties.getModel(), systemPrompt, userPrompt, imageUrls,
        temperature, maxTokens, timeout);
  }

  public AiChatDtos.CompletionResult completeVisionForModel(
      String model, String systemPrompt, String userPrompt, List<String> imageUrls,
      Double temperature) throws Exception {
    return completeVisionForModel(model, systemPrompt, userPrompt, imageUrls, temperature, null, null);
  }

  private AiChatDtos.CompletionResult completeVisionForModel(
      String model, String systemPrompt, String userPrompt, List<String> imageUrls,
      Double temperature, Integer maxTokens, Duration timeout) throws Exception {
    requireConfigured();
    if (model == null || model.isBlank()) throw new IllegalArgumentException("Agent vision model is empty");
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
    return completeRaw(messages, temperature, maxTokens, timeout, model);
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
    return completeConfiguredModel(credential, systemPrompt, userPrompt, imageUrls, temperature,
        source, selectionMode, null);
  }

  public AiChatDtos.CompletionResult completeConfiguredModel(
      ResolvedModelApiKey credential, String systemPrompt, String userPrompt, List<String> imageUrls,
      Double temperature, String source, String selectionMode, Integer maxTokens) throws Exception {
    return completeConfiguredModel(credential, systemPrompt, userPrompt, imageUrls, temperature,
        source, selectionMode, maxTokens, null);
  }

  public AiChatDtos.CompletionResult completeConfiguredModel(
      ResolvedModelApiKey credential, String systemPrompt, String userPrompt, List<String> imageUrls,
      Double temperature, String source, String selectionMode, Integer maxTokens, Duration timeout) throws Exception {
    return completeConfiguredMedia(credential, systemPrompt, userPrompt, imageUrls, temperature,
        source, selectionMode, maxTokens, timeout, null);
  }

  public AiChatDtos.CompletionResult completeConfiguredMedia(
      ResolvedModelApiKey credential, String systemPrompt, String userPrompt, List<String> imageUrls,
      Double temperature, String source, String selectionMode, Integer maxTokens, Duration timeout,
      Map<String, Object> videoPart) throws Exception {
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
    body.remove("youmi_context_budget_tokens");
    body.put("model", credential.model());
    int tokenBudget = maxTokens == null ? Math.max("canvas-agent".equals(source) ? 16000 : 200, properties.getMaxTokens())
        : Math.max(200, Math.min(16000, maxTokens));
    if (maxTokens == null && "canvas-agent".equals(source)
        && userPrompt != null && userPrompt.length() > 8000) tokenBudget = Math.max(tokenBudget, 16000);
    body.put("max_tokens", tokenBudget);
    body.put("temperature", temperature == null ? properties.getTemperature() : temperature);
    body.put("messages", messages);
    boolean gemini = GeminiChatProtocol.supports(credential);
    if (videoPart != null && !gemini)
      throw new IllegalArgumentException("参考视频完整分析需要支持原生视频输入的 Gemini 策划模型，请选择 GEM 3 Pro");
    if (gemini) body = GeminiChatProtocol.body(credential, systemPrompt, userPrompt, imageUrls,
        body.get("temperature"), body.get("max_tokens"), videoPart);
    if ("product-video2-planning".equals(source)) {
      body.remove("response_format");
      if (gemini && body.get("generationConfig") instanceof Map<?, ?> generation) {
        var config = new LinkedHashMap<String, Object>();
        generation.forEach((name, value) -> config.put(String.valueOf(name), value));
        config.remove("responseSchema"); config.remove("responseJsonSchema");
        config.put("responseMimeType", videoPart == null ? "text/plain" : "application/json");
        body.put("generationConfig", config);
      }
    }
    publishEstimatedUsage(credential, systemPrompt, userPrompt, imageUrls);
    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(gemini ? GeminiChatProtocol.endpoint(credential, false) : credential.generationEndpoint()))
        .timeout(timeout == null ? configuredTimeout(source) : timeout)
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
    }
    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      String detail = compact(response.body())
          .replace(credential.apiKey(), "[redacted]")
          .replaceAll("sk-[A-Za-z0-9_-]+", "[redacted]");
      throw new IllegalStateException(
          "识图推理模型请求失败（HTTP " + response.statusCode() + "）: " + detail);
    }
    JsonNode responseRoot = objectMapper.readTree(response.body());
    publishReportedUsage(responseRoot);
    String contentText = readContent(responseRoot);
    try {
      AgentReplyIntegrity.requireCompleteOutput(responseRoot);
      AgentReplyIntegrity.requireNotBlocked(contentText);
    } catch (AgentReplyIntegrity.BlockedReply error) {
      recordCall(source, "chat", credential.provider(), credential.model(), credential.id(), selectionMode,
          false, response.statusCode(), started, error);
      throw error;
    } catch (AgentReplyIntegrity.IncompleteReply error) {
      // Empty length-limited replies retain the existing one-time budget retry below.
      if (!contentText.isBlank()) {
        recordCall(source, "chat", credential.provider(), credential.model(), credential.id(), selectionMode,
            false, response.statusCode(), started, error);
        throw error;
      }
    }
    if (contentText.isBlank()) {
      String finishReason = responseRoot.path("choices").path(0).path("finish_reason").asText("unknown");
      if (gemini) {
        String nativeReason = responseRoot.path("candidates").path(0).path("finishReason")
            .asText(responseRoot.path("promptFeedback").path("blockReason").asText("unknown"));
        finishReason = "MAX_TOKENS".equals(nativeReason) ? "length"
            : List.of("SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "RECITATION").contains(nativeReason)
                ? "content_filter" : nativeReason;
      }
      log.warn("Configured model returned no text: model={}, finishReason={}, completionTokens={}, budget={}",
          credential.model(), finishReason, responseRoot.path("usage").path("completion_tokens").asInt(-1), tokenBudget);
      if ("length".equals(finishReason) && tokenBudget < 16000) {
        return completeConfiguredMedia(credential, systemPrompt, userPrompt, imageUrls, temperature,
            source, selectionMode, 16000, timeout, videoPart);
      }
      if ("length".equals(finishReason))
        throw new IllegalStateException("模型输出额度已耗尽但未返回正文，请分段策划或减少本轮参考图后重试");
      if ("content_filter".equals(finishReason))
        throw new IllegalStateException("模型通道过滤了本次内容，请调整输入后重试");
      throw new IllegalStateException("模型通道未返回回复正文（结束原因：" + finishReason + "），请稍后重试");
    }
    recordCall(source, "chat", credential.provider(), credential.model(), credential.id(), selectionMode,
        true, response.statusCode(), started, null);
    return new AiChatDtos.CompletionResult(credential.provider(), credential.model(), contentText);
  }

  /**
   * Streams an OpenAI-compatible chat completion while preserving the configured database
   * credential and request defaults. Providers that ignore {@code stream=true} and return a
   * regular completion are supported as a compatibility fallback.
   */
  public AiChatDtos.CompletionResult completeConfiguredModelStream(
      ResolvedModelApiKey credential,
      String systemPrompt,
      String userPrompt,
      List<String> imageUrls,
      Double temperature,
      String source,
      String selectionMode,
      Integer maxTokens,
      Consumer<String> onDelta) throws Exception {
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
    body.remove("youmi_context_budget_tokens");
    body.put("model", credential.model());
    body.put("max_tokens", maxTokens == null ? Math.max("canvas-agent".equals(source) ? 16000 : 200, properties.getMaxTokens())
        : Math.max(200, Math.min(16000, maxTokens)));
    body.put("temperature", temperature == null ? properties.getTemperature() : temperature);
    body.put("messages", messages);
    body.put("stream", true);
    boolean gemini = GeminiChatProtocol.supports(credential);
    if (gemini) {
      body = GeminiChatProtocol.body(credential, systemPrompt, userPrompt, imageUrls,
          body.get("temperature"), body.get("max_tokens"));
      body.put("stream", true);
    }
    else if (usageListener.get() != null) body.putIfAbsent("stream_options", Map.of("include_usage", true));
    publishEstimatedUsage(credential, systemPrompt, userPrompt, imageUrls);
    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(gemini ? GeminiChatProtocol.endpoint(credential, true) : credential.generationEndpoint()))
        .timeout(configuredTimeout(source))
        .header("Authorization", "Bearer " + credential.apiKey())
        .header("Content-Type", "application/json")
        .header("Accept", "text/event-stream")
        .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
        .build();

    long started = System.nanoTime();
    HttpResponse<InputStream> response;
    try {
      response = sendStreamWithHandshakeRetry(request);
      log.info("Agent stream upstream headers received: model={}, elapsedMs={}, status={}",
          credential.model(), (System.nanoTime() - started) / 1_000_000L, response.statusCode());
    } catch (Exception error) {
      recordCall(source, "chat", credential.provider(), credential.model(), credential.id(), selectionMode,
          false, null, started, error);
      throw error;
    }
    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      String responseBody;
      try (InputStream input = response.body()) {
        responseBody = new String(input.readAllBytes(), StandardCharsets.UTF_8);
      }
      recordCall(source, "chat", credential.provider(), credential.model(), credential.id(), selectionMode,
          false, response.statusCode(), started, null);
      String detail = compact(responseBody)
          .replace(credential.apiKey(), "[redacted]")
          .replaceAll("sk-[A-Za-z0-9_-]+", "[redacted]");
      throw new IllegalStateException(
          "识图推理模型请求失败（HTTP " + response.statusCode() + "）: " + detail);
    }

    StringBuilder completed = new StringBuilder();
    Consumer<String> deltaConsumer = onDelta == null ? ignored -> { } : onDelta;
    var timedOut = new java.util.concurrent.atomic.AtomicBoolean(false);
    long remainingNanos = Math.max(1, request.timeout().orElse(configuredTimeout(source)).toNanos()
        - (System.nanoTime() - started));
    var deadline = STREAM_DEADLINES.schedule(() -> {
      timedOut.set(true);
      try { response.body().close(); } catch (IOException ignored) { }
    }, remainingNanos, java.util.concurrent.TimeUnit.NANOSECONDS);
    try (InputStream input = response.body();
        BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
      String line;
      StringBuilder regularResponse = new StringBuilder();
      while ((line = reader.readLine()) != null) {
        if (line.isBlank() || line.startsWith(":")) continue;
        if (!line.startsWith("data:")) {
          regularResponse.append(line);
          continue;
        }
        String payload = line.substring(5).trim();
        if (payload.isBlank()) continue;
        if ("[DONE]".equals(payload)) break;
        emitStreamingPayload(payload, completed, deltaConsumer);
      }
      if (!regularResponse.isEmpty()) {
        JsonNode root = objectMapper.readTree(regularResponse.toString());
        publishReportedUsage(root);
        AgentReplyIntegrity.requireCompleteOutput(root);
        String value = readContent(root);
        if (!value.isBlank()) {
          completed.append(value);
          deltaConsumer.accept(value);
        }
      }
      AgentReplyIntegrity.requireNotBlocked(completed.toString());
    } catch (Exception error) {
      if (timedOut.get()) error = new java.net.http.HttpTimeoutException("模型回复等待超时");
      recordCall(source, "chat", credential.provider(), credential.model(), credential.id(), selectionMode,
          false, response.statusCode(), started, error);
      throw error;
    } finally {
      deadline.cancel(false);
    }
    if (timedOut.get()) throw new java.net.http.HttpTimeoutException("模型回复等待超时");
    recordCall(source, "chat", credential.provider(), credential.model(), credential.id(), selectionMode,
        true, response.statusCode(), started, null);
    if (completed.isEmpty()) throw new IllegalStateException("识图推理模型返回内容为空");
    return new AiChatDtos.CompletionResult(
        credential.provider(), credential.model(), completed.toString());
  }

  private void emitStreamingPayload(
      String payload, StringBuilder completed, Consumer<String> onDelta) throws Exception {
    JsonNode root = objectMapper.readTree(payload);
    publishReportedUsage(root);
    AgentReplyIntegrity.requireCompleteOutput(root);
    if (root.has("candidates")) {
      String value = GeminiChatProtocol.text(root);
      if (!value.isEmpty()) { completed.append(value); onDelta.accept(value); }
      return;
    }
    JsonNode choices = root.path("choices");
    if (!choices.isArray() || choices.isEmpty()) return;
    JsonNode choice = choices.get(0);
    JsonNode content = choice.path("delta").path("content");
    if (content.isMissingNode() || content.isNull()) {
      content = choice.path("message").path("content");
    }
    String value = readTextContent(content);
    if (value.isEmpty()) return;
    completed.append(value);
    onDelta.accept(value);
  }

  private AiChatDtos.CompletionResult completeRaw(
      List<Map<String, Object>> rawMessages, Double temperature) throws Exception {
    return completeRaw(rawMessages, temperature, null, null);
  }

  private AiChatDtos.CompletionResult completeRaw(
      List<Map<String, Object>> rawMessages, Double temperature, Integer maxTokens, Duration timeout) throws Exception {
    return completeRaw(rawMessages, temperature, maxTokens, timeout, properties.getModel());
  }

  private AiChatDtos.CompletionResult completeRaw(
      List<Map<String, Object>> rawMessages, Double temperature, Integer maxTokens, Duration timeout,
      String model) throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("model", model);
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
      recordCall(canvasAgentDropdown.get() ? "canvas-agent" : "agent-chat", "chat", "teamorouter", model, null,
          canvasAgentDropdown.get() ? "dropdown" : "system_default",
          false, null, started, error);
      throw error;
    }
    log.info("Agent model response status: {}", response.statusCode());
    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      recordCall(canvasAgentDropdown.get() ? "canvas-agent" : "agent-chat", "chat", "teamorouter", model, null,
          canvasAgentDropdown.get() ? "dropdown" : "system_default", false, response.statusCode(), started, null);
      throw new IllegalStateException(
          "Agent model request failed: " + response.statusCode() + " " + compact(response.body()));
    }

    String content;
    try {
      JsonNode responseRoot = objectMapper.readTree(response.body());
      AgentReplyIntegrity.requireCompleteOutput(responseRoot);
      content = readContent(responseRoot);
      AgentReplyIntegrity.requireNotBlocked(content);
    } catch (Exception error) {
      recordCall(canvasAgentDropdown.get() ? "canvas-agent" : "agent-chat", "chat", "teamorouter", model, null,
          canvasAgentDropdown.get() ? "dropdown" : "system_default", false, response.statusCode(), started, error);
      throw error;
    }
    if (content.isBlank()) {
      throw new IllegalStateException("Agent model returned empty content");
    }
    recordCall(canvasAgentDropdown.get() ? "canvas-agent" : "agent-chat", "chat", "teamorouter", model, null,
        canvasAgentDropdown.get() ? "dropdown" : "system_default", true, response.statusCode(), started, null);
    return new AiChatDtos.CompletionResult("teamorouter", model, content);
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

  private HttpResponse<InputStream> sendStreamWithHandshakeRetry(HttpRequest request)
      throws IOException, InterruptedException {
    for (int attempt = 1; attempt <= MAX_HANDSHAKE_ATTEMPTS; attempt++) {
      try {
        HttpClient client = attempt == 1 ? httpClient : buildHttpClient();
        return client.send(request, HttpResponse.BodyHandlers.ofInputStream());
      } catch (IOException error) {
        if (!isHandshakeFailure(error) || attempt == MAX_HANDSHAKE_ATTEMPTS) throw error;
        log.warn(
            "Agent HTTPS streaming handshake failed (attempt {}/{}), retrying with a new connection: {}",
            attempt, MAX_HANDSHAKE_ATTEMPTS, error.getMessage());
        Thread.sleep(300L * attempt);
      }
    }
    throw new IOException("Agent streaming request failed after HTTPS handshake retries");
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
    if (root.has("candidates")) return GeminiChatProtocol.text(root);
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

  private Duration configuredTimeout(String source) {
    return Duration.ofSeconds(Math.max("canvas-agent".equals(source) ? 1800 : 8,
        properties.getTimeoutSeconds()));
  }

  private void publishEstimatedUsage(ResolvedModelApiKey key, String system, String prompt, List<String> images) {
    if (usageListener.get() == null) return;
    long budget = contextBudgetTokens(key);
    long imageEstimate = images == null ? 0 : images.stream().filter(value -> value != null && !value.isBlank()).distinct().limit(8).count() * 1024;
    publishUsage(new AgentContextUsage(key.model(), AgentContextUsage.estimate(system)
        + AgentContextUsage.estimate(prompt) + imageEstimate, 0, budget, true));
  }

  public long contextBudgetTokens(ResolvedModelApiKey key) {
    long budget = properties.getContextBudgetTokens();
    Object override = key == null ? null : key.defaultData().get("youmi_context_budget_tokens");
    if (override != null) {
      try { budget = Long.parseLong(override.toString()); } catch (NumberFormatException ignored) { }
    }
    return budget < 1024 ? 100000 : budget;
  }

  private void publishReportedUsage(JsonNode root) {
    var previous = currentUsage.get();
    if (usageListener.get() == null || previous == null) return;
    JsonNode usage = root.has("usageMetadata") ? root.path("usageMetadata") : root.path("usage");
    if (!usage.isObject()) return;
    long input = usage.path("promptTokenCount").asLong(usage.path("prompt_tokens").asLong(-1));
    if (input < 0) return;
    long output = usage.path("candidatesTokenCount").asLong(usage.path("completion_tokens").asLong(-1));
    if (usage.has("thoughtsTokenCount")) output = Math.max(0, output) + usage.path("thoughtsTokenCount").asLong(0);
    publishUsage(new AgentContextUsage(previous.model(), input, Math.max(0, output), previous.budgetTokens(), output < 0));
  }

  private void publishUsage(AgentContextUsage usage) {
    currentUsage.set(usage);
    if (usageListener.get() != null) usageListener.get().accept(usage);
  }

  private String readTextContent(JsonNode content) {
    if (content == null || content.isMissingNode() || content.isNull()) return "";
    if (content.isTextual()) return content.asText("");
    if (!content.isArray()) return "";
    StringBuilder text = new StringBuilder();
    for (JsonNode item : content) {
      String value = item.path("text").asText(item.path("content").asText(""));
      if (!value.isEmpty()) text.append(value);
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
