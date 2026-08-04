package com.youmi.api.prompt;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.ai.AiChatDtos;
import com.youmi.api.ai.DashScopeClient;
import com.youmi.api.ai.XfyunVisionClient;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class ReversePromptService {
  private static final Logger log = LoggerFactory.getLogger(ReversePromptService.class);
  private final ObjectMapper objectMapper;
  private final DashScopeClient dashScopeClient;
  private final XfyunVisionClient xfyunVisionClient;
  private final ReversePromptTemplateService templateService;

  public ReversePromptService(
      ObjectMapper objectMapper,
      DashScopeClient dashScopeClient,
      XfyunVisionClient xfyunVisionClient,
      ReversePromptTemplateService templateService) {
    this.objectMapper = objectMapper;
    this.dashScopeClient = dashScopeClient;
    this.xfyunVisionClient = xfyunVisionClient;
    this.templateService = templateService;
  }

  public List<ReversePromptDtos.CategoryMeta> categories() {
    return templateService.categories();
  }

  public ReversePromptDtos.AnalyzeImageResponse analyze(ReversePromptDtos.AnalyzeImageRequest request) throws Exception {
    ReversePromptTemplateService.Template template = templateService.get(request == null ? "" : request.category());
    List<String> images = new ArrayList<>();
    if (request != null && request.imageUrl() != null && !request.imageUrl().isBlank()) {
      images.add(request.imageUrl().trim());
    }
    if (request != null && request.imageBase64() != null && !request.imageBase64().isBlank()) {
      images.add(toDataUrl(request.imageBase64().trim()));
    }
    if (images.isEmpty()) {
      throw new IllegalArgumentException("请提供图片 URL 或图片 base64");
    }

    String systemPrompt =
        "你是电商图片视觉解析与生图提示词专家。必须严格输出合法 JSON，不输出 Markdown，不解释过程。";
    AiChatDtos.CompletionResult visionResult = analyzeWithFallback(
        systemPrompt,
        template.systemPrompt(),
        images.get(0));
    String provider = visionResult.provider();
    String model = visionResult.model();
    String raw = visionResult.content();
    raw = raw == null ? "" : raw.trim();
    JsonNode promptJson = parseJson(raw);
    String promptText = buildPromptText(promptJson, template.fieldLabels());
    return new ReversePromptDtos.AnalyzeImageResponse(
        provider,
        model,
        request == null || request.category() == null || request.category().isBlank() ? "general" : request.category(),
        template.label(),
        promptJson,
        promptText,
        template.groups(),
        template.fieldLabels(),
        raw);
  }

  private AiChatDtos.CompletionResult analyzeWithFallback(
      String systemPrompt,
      String prompt,
      String imageUrl) throws Exception {
    if (!xfyunVisionClient.isConfigured()) {
      return analyzeWithDashScope(systemPrompt, prompt, imageUrl);
    }

    try {
      String content = xfyunVisionClient.analyzeImage(systemPrompt, prompt, imageUrl);
      return new AiChatDtos.CompletionResult("xfyun", xfyunVisionClient.model(), content);
    } catch (InterruptedException exception) {
      Thread.currentThread().interrupt();
      throw exception;
    } catch (Exception exception) {
      if (!isTransientVisionFailure(exception)) throw exception;
      if (!dashScopeClient.isConfigured()) {
        throw new IllegalStateException("讯飞视觉服务繁忙，请稍后重试", exception);
      }
      log.warn(
          "Xfyun vision is temporarily unavailable; falling back to DashScope model {}",
          dashScopeClient.model());
      try {
        return analyzeWithDashScope(systemPrompt, prompt, imageUrl);
      } catch (Exception fallbackException) {
        fallbackException.addSuppressed(exception);
        throw fallbackException;
      }
    }
  }

  private AiChatDtos.CompletionResult analyzeWithDashScope(
      String systemPrompt,
      String prompt,
      String imageUrl) throws Exception {
    return dashScopeClient.completeVision(
        systemPrompt,
        prompt,
        List.of(imageUrl),
        0.15,
        4096);
  }

  private boolean isTransientVisionFailure(Exception exception) {
    Throwable current = exception;
    while (current != null) {
      String message = String.valueOf(current.getMessage()).toLowerCase(Locale.ROOT);
      if (message.contains("transient")
          || message.contains("system is busy")
          || message.contains("10310")
          || message.contains("timeout")
          || message.contains("timed out")
          || message.contains("connection")
          || message.contains(" 429")
          || message.contains(" 500")
          || message.contains(" 502")
          || message.contains(" 503")
          || message.contains(" 504")) {
        return true;
      }
      current = current.getCause();
    }
    return false;
  }

  private String buildPromptText(JsonNode promptJson, Map<String, String> fieldLabels) {
    String structuredPrompt = buildStructuredPromptText(promptJson, fieldLabels);
    String generationPrompt = promptFieldText(promptJson, "generation_prompt");
    if (structuredPrompt.isBlank()) structuredPrompt = generationPrompt;
    String negativePrompt = promptFieldText(promptJson, "negative_prompt");
    if (negativePrompt.isBlank()) return structuredPrompt;
    return structuredPrompt + "\n避免出现：" + negativePrompt;
  }

  private String buildStructuredPromptText(JsonNode promptJson, Map<String, String> fieldLabels) {
    if (promptJson == null || !promptJson.isObject()) return "";
    List<String> fieldOrder = List.of(
        "subject_and_elements",
        "mattress_surface",
        "mattress_structure",
        "curtain_detail",
        "curtain_drape",
        "curtain_scene",
        "bed_wood",
        "bed_structure",
        "composition_and_camera",
        "lighting_and_color",
        "visual_style",
        "typography_layout");
    List<String> lines = new ArrayList<>();
    for (String fieldName : fieldOrder) {
      appendStructuredLine(lines, fieldName, promptJson.get(fieldName), fieldLabels);
    }
    Iterator<Map.Entry<String, JsonNode>> fields = promptJson.fields();
    while (fields.hasNext()) {
      Map.Entry<String, JsonNode> field = fields.next();
      if (fieldOrder.contains(field.getKey())
          || "generation_prompt".equals(field.getKey())
          || "negative_prompt".equals(field.getKey())) {
        continue;
      }
      appendStructuredLine(lines, field.getKey(), field.getValue(), fieldLabels);
    }
    if (lines.isEmpty()) return "";
    lines.set(0, "提示词：" + lines.get(0));
    return String.join("\n", lines);
  }

  private void appendStructuredLine(
      List<String> lines,
      String fieldName,
      JsonNode value,
      Map<String, String> fieldLabels) {
    String text = readableValue(value, fieldLabels);
    if (!text.isBlank()) {
      lines.add(fieldLabels.getOrDefault(fieldName, fieldName) + "：" + text);
    }
  }

  private String readableValue(JsonNode value, Map<String, String> fieldLabels) {
    if (value == null || value.isNull()) return "";
    if (value.isValueNode()) return value.asText().trim();
    List<String> parts = new ArrayList<>();
    if (value.isArray()) {
      value.forEach(item -> {
        String text = readableValue(item, fieldLabels);
        if (!text.isBlank()) parts.add(text);
      });
      return String.join("；", parts);
    }
    value.fields().forEachRemaining(field -> {
      String text = readableValue(field.getValue(), fieldLabels);
      if (!text.isBlank()) {
        parts.add(fieldLabels.getOrDefault(field.getKey(), field.getKey()) + "：" + text);
      }
    });
    return String.join("，", parts);
  }

  private String promptFieldText(JsonNode promptJson, String fieldName) {
    if (promptJson == null) return "";
    JsonNode value = promptJson.get(fieldName);
    if (value == null || value.isNull()) return "";
    if (value.isTextual()) return value.asText().trim();
    if (value.isArray()) {
      List<String> parts = new ArrayList<>();
      value.forEach(item -> {
        String text = item.isTextual() ? item.asText().trim() : item.toString();
        if (!text.isBlank()) parts.add(text);
      });
      return String.join("、", parts);
    }
    return value.toString();
  }

  private JsonNode parseJson(String raw) throws Exception {
    String json = extractJson(raw);
    if (json.isBlank()) {
      throw new IllegalStateException("模型没有返回可用 JSON");
    }
    return objectMapper.readTree(json);
  }

  private String extractJson(String raw) {
    if (raw == null) return "";
    String text = raw.trim();
    if (text.startsWith("```")) {
      int firstLine = text.indexOf('\n');
      int lastFence = text.lastIndexOf("```");
      if (firstLine >= 0 && lastFence > firstLine) {
        text = text.substring(firstLine + 1, lastFence).trim();
      }
    }
    if (text.startsWith("{") && text.endsWith("}")) return text;
    int start = text.indexOf('{');
    int end = text.lastIndexOf('}');
    return start >= 0 && end > start ? text.substring(start, end + 1) : "";
  }

  private String toDataUrl(String value) {
    if (value.startsWith("data:")) return value;
    return "data:image/jpeg;base64," + value;
  }
}
