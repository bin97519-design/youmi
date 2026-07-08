package com.youmi.api.prompt;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.ai.AiChatDtos;
import com.youmi.api.ai.MiniMaxM3Client;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class ReversePromptService {
  private final ObjectMapper objectMapper;
  private final MiniMaxM3Client miniMaxM3Client;
  private final ReversePromptTemplateService templateService;

  public ReversePromptService(
      ObjectMapper objectMapper,
      MiniMaxM3Client miniMaxM3Client,
      ReversePromptTemplateService templateService) {
    this.objectMapper = objectMapper;
    this.miniMaxM3Client = miniMaxM3Client;
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

    AiChatDtos.CompletionResult result = miniMaxM3Client.completeVision(
        "你是电商图片结构化视觉解析助手。必须严格输出 JSON，不输出 Markdown，不解释过程。",
        template.systemPrompt(),
        images.stream().limit(1).toList(),
        0.15,
        4096);
    String raw = result.content() == null ? "" : result.content().trim();
    JsonNode promptJson = parseJson(raw);
    String promptText = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(promptJson);
    return new ReversePromptDtos.AnalyzeImageResponse(
        result.provider(),
        result.model(),
        request == null || request.category() == null || request.category().isBlank() ? "general" : request.category(),
        template.label(),
        promptJson,
        promptText,
        template.groups(),
        template.fieldLabels(),
        raw);
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
