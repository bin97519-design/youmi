package com.youmi.api.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.youmi.api.image.ModelApiKeyService.ResolvedModelApiKey;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Native Gemini transport for configured chat models. */
final class GeminiChatProtocol {
  private GeminiChatProtocol() {}

  static boolean supports(ResolvedModelApiKey key) {
    return "gem-3-pro".equalsIgnoreCase(key.model())
        || key.generationPath().contains(":generateContent")
        || key.generationPath().contains(":streamGenerateContent");
  }

  static String endpoint(ResolvedModelApiKey key, boolean streaming) {
    String path = key.generationPath();
    if (!path.contains(":generateContent") && !path.contains(":streamGenerateContent"))
      path = "/v1beta/models/" + key.model() + ":generateContent";
    path = path.replace(":streamGenerateContent", ":generateContent");
    if (streaming) path = path.replace(":generateContent", ":streamGenerateContent");
    String url = key.baseUrl() + path;
    return streaming ? url + (url.contains("?") ? "&" : "?") + "alt=sse" : url;
  }

  static Map<String, Object> body(ResolvedModelApiKey key, String system, String prompt,
      List<String> images, Object temperature, Object maxTokens) {
    return body(key, system, prompt, images, temperature, maxTokens, null);
  }

  static Map<String, Object> body(ResolvedModelApiKey key, String system, String prompt,
      List<String> images, Object temperature, Object maxTokens, Map<String, Object> videoPart) {
    Map<String, Object> result = new LinkedHashMap<>(key.defaultData());
    result.remove("model");
    result.remove("messages");
    result.remove("stream");
    result.remove("max_tokens");
    result.remove("temperature");
    result.remove("youmi_context_budget_tokens");
    Map<String, Object> config = new LinkedHashMap<>();
    if (result.get("generationConfig") instanceof Map<?, ?> defaults)
      defaults.forEach((k, v) -> config.put(String.valueOf(k), v));
    config.put("temperature", temperature);
    config.put("maxOutputTokens", maxTokens);
    result.put("generationConfig", config);
    if (system != null && !system.isBlank())
      result.put("systemInstruction", Map.of("parts", List.of(Map.of("text", system))));
    List<Object> parts = new ArrayList<>();
    parts.add(Map.of("text", prompt == null ? "" : prompt));
    if (images != null) images.stream().filter(url -> url != null && !url.isBlank())
        .map(String::trim).filter(url -> !url.startsWith("blob:")).distinct().limit(8)
        .forEach(url -> parts.add(imagePart(url)));
    if (videoPart != null) parts.add(videoPart);
    result.put("contents", List.of(Map.of("role", "user", "parts", parts)));
    return result;
  }

  private static Map<String, Object> imagePart(String url) {
    if (url.startsWith("data:")) {
      int separator = url.indexOf(";base64,");
      if (separator < 0) throw new IllegalArgumentException("Gemini 图片需使用 URL 或 base64 data URL");
      return Map.of("inlineData", Map.of("mimeType", url.substring(5, separator),
          "data", url.substring(separator + 8)));
    }
    String path = java.net.URI.create(url).getPath().toLowerCase(java.util.Locale.ROOT);
    String mime = path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp"
        : path.endsWith(".gif") ? "image/gif" : "image/jpeg";
    return Map.of("fileData", Map.of("mimeType", mime, "fileUri", url));
  }

  static String text(JsonNode root) {
    StringBuilder result = new StringBuilder();
    for (JsonNode part : root.path("candidates").path(0).path("content").path("parts"))
      if (!part.path("thought").asBoolean(false)) result.append(part.path("text").asText(""));
    return result.toString();
  }
}
