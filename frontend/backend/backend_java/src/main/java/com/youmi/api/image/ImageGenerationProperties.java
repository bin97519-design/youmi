package com.youmi.api.image;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "youmi.image")
public class ImageGenerationProperties {
  private String baseUrl = "https://api.apimart.ai";
  private String generationPath = "/v1/images/generations";
  private String taskPath = "/v1/tasks";
  private String apiKey = "";
  private String fallbackProvider = "gettoken";
  private boolean fallbackEnabled = true;
  private String getTokenBaseUrl = "https://nb.gettoken.cn/openapi/v1";
  private String getTokenApiKey = "";
  private String getTokenQueryPath = "/query";
  private String model = "gpt-image-2";
  private String defaultSize = "9:16";
  private String defaultResolution = "2K";
  private String language = "zh";
  private boolean officialFallback = false;
  private boolean persistGeneratedImages = true;
  private String uploadEndpoint = "http://101.133.149.214/prod-api/api/v1/file/upload";
  private String uploadFieldName = "file";
  private int timeoutSeconds = 60;
  private int uploadTimeoutSeconds = 120;
  private String ossSignPath = "/api/oss/sign";
  // Agnes Image provider
  private String agnesBaseUrl = "https://apihub.agnes-ai.com";
  private String agnesApiKey = "";
  private String agnesGenerationPath = "/v1/images/generations";
  private Map<String, String> modelAliases = defaultModelAliases();

  public String getBaseUrl() {
    return baseUrl;
  }

  public void setBaseUrl(String baseUrl) {
    this.baseUrl = baseUrl;
  }

  public String getGenerationPath() {
    return generationPath;
  }

  public void setGenerationPath(String generationPath) {
    this.generationPath = generationPath;
  }

  public String getTaskPath() {
    return taskPath;
  }

  public void setTaskPath(String taskPath) {
    this.taskPath = taskPath;
  }

  public String getApiKey() {
    return apiKey;
  }

  public void setApiKey(String apiKey) {
    this.apiKey = apiKey;
  }

  public String getFallbackProvider() {
    return fallbackProvider;
  }

  public void setFallbackProvider(String fallbackProvider) {
    this.fallbackProvider = fallbackProvider;
  }

  public boolean isFallbackEnabled() {
    return fallbackEnabled;
  }

  public void setFallbackEnabled(boolean fallbackEnabled) {
    this.fallbackEnabled = fallbackEnabled;
  }

  public String getGetTokenBaseUrl() {
    return getTokenBaseUrl;
  }

  public void setGetTokenBaseUrl(String getTokenBaseUrl) {
    this.getTokenBaseUrl = getTokenBaseUrl;
  }

  public String getGetTokenApiKey() {
    return getTokenApiKey;
  }

  public void setGetTokenApiKey(String getTokenApiKey) {
    this.getTokenApiKey = getTokenApiKey;
  }

  public String getGetTokenQueryPath() {
    return getTokenQueryPath;
  }

  public void setGetTokenQueryPath(String getTokenQueryPath) {
    this.getTokenQueryPath = getTokenQueryPath;
  }

  public String getModel() {
    return model;
  }

  public void setModel(String model) {
    this.model = model;
  }

  public String getDefaultSize() {
    return defaultSize;
  }

  public void setDefaultSize(String defaultSize) {
    this.defaultSize = defaultSize;
  }

  public String getDefaultResolution() {
    return defaultResolution;
  }

  public void setDefaultResolution(String defaultResolution) {
    this.defaultResolution = defaultResolution;
  }

  public String getLanguage() {
    return language;
  }

  public void setLanguage(String language) {
    this.language = language;
  }

  public boolean isOfficialFallback() {
    return officialFallback;
  }

  public void setOfficialFallback(boolean officialFallback) {
    this.officialFallback = officialFallback;
  }

  public boolean isPersistGeneratedImages() {
    return persistGeneratedImages;
  }

  public void setPersistGeneratedImages(boolean persistGeneratedImages) {
    this.persistGeneratedImages = persistGeneratedImages;
  }

  public String getUploadEndpoint() {
    return uploadEndpoint;
  }

  public void setUploadEndpoint(String uploadEndpoint) {
    this.uploadEndpoint = uploadEndpoint;
  }

  public String getUploadFieldName() {
    return uploadFieldName;
  }

  public void setUploadFieldName(String uploadFieldName) {
    this.uploadFieldName = uploadFieldName;
  }

  public int getTimeoutSeconds() {
    return timeoutSeconds;
  }

  public void setTimeoutSeconds(int timeoutSeconds) {
    this.timeoutSeconds = timeoutSeconds;
  }

  public int getUploadTimeoutSeconds() {
    return uploadTimeoutSeconds;
  }

  public void setUploadTimeoutSeconds(int uploadTimeoutSeconds) {
    this.uploadTimeoutSeconds = uploadTimeoutSeconds;
  }

  public Map<String, String> getModelAliases() {
    return modelAliases;
  }

  public void setModelAliases(Map<String, String> modelAliases) {
    this.modelAliases = modelAliases == null ? defaultModelAliases() : modelAliases;
  }

  public boolean isConfigured() {
    return apiKey != null && !apiKey.isBlank();
  }

  public boolean isGetTokenConfigured() {
    return getTokenApiKey != null && !getTokenApiKey.isBlank();
  }

  public String resolveModel(String requestedModel) {
    String value = requestedModel == null || requestedModel.isBlank() ? model : requestedModel.trim();
    String direct = modelAliases.get(value);
    if (direct != null) return direct;

    String normalized = normalizeAlias(value);
    String mapped = modelAliases.get(normalized);
    return mapped == null ? value : mapped;
  }

  public String normalizeResolution(String resolvedModel, String requestedResolution) {
    String value = requestedResolution == null || requestedResolution.isBlank() ? defaultResolution : requestedResolution.trim();
    if (value.isBlank()) return value;
    if ("gpt-image-2".equalsIgnoreCase(resolvedModel)) {
      return value.toLowerCase(Locale.ROOT);
    }
    return value.toUpperCase(Locale.ROOT);
  }

  public String normalizeSize(String requestedSize, String requestedRatio) {
    String value = requestedSize == null || requestedSize.isBlank() ? requestedRatio : requestedSize;
    if (value == null || value.isBlank() || value.equalsIgnoreCase("auto") || value.contains("智能")) {
      return defaultSize;
    }
    return value.trim();
  }

  public boolean shouldSendResolution(String resolvedModel) {
    return resolvedModel == null || !resolvedModel.endsWith("-official");
  }

  public String normalizedBaseUrl() {
    if (baseUrl == null || baseUrl.isBlank()) return "";
    return baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
  }

  public String normalizedGenerationPath() {
    if (generationPath == null || generationPath.isBlank()) return "/v1/images/generations";
    return generationPath.startsWith("/") ? generationPath : "/" + generationPath;
  }

  public String normalizedTaskPath() {
    if (taskPath == null || taskPath.isBlank()) return "/v1/tasks";
    return taskPath.startsWith("/") ? taskPath : "/" + taskPath;
  }

  public String normalizedGetTokenBaseUrl() {
    if (getTokenBaseUrl == null || getTokenBaseUrl.isBlank()) return "";
    return getTokenBaseUrl.endsWith("/") ? getTokenBaseUrl.substring(0, getTokenBaseUrl.length() - 1) : getTokenBaseUrl;
  }

  public String normalizedGetTokenQueryPath() {
    if (getTokenQueryPath == null || getTokenQueryPath.isBlank()) return "/query";
    return getTokenQueryPath.startsWith("/") ? getTokenQueryPath : "/" + getTokenQueryPath;
  }

  public String getOssSignPath() {
    return ossSignPath;
  }

  public void setOssSignPath(String ossSignPath) {
    this.ossSignPath = ossSignPath;
  }

  public String normalizedOssSignPath() {
    if (ossSignPath == null || ossSignPath.isBlank()) return "/api/oss/sign";
    return ossSignPath.startsWith("/") ? ossSignPath : "/" + ossSignPath;
  }

  public String getAgnesBaseUrl() {
    return agnesBaseUrl;
  }

  public void setAgnesBaseUrl(String agnesBaseUrl) {
    this.agnesBaseUrl = agnesBaseUrl;
  }

  public String getAgnesApiKey() {
    return agnesApiKey;
  }

  public void setAgnesApiKey(String agnesApiKey) {
    this.agnesApiKey = agnesApiKey;
  }

  public String getAgnesGenerationPath() {
    return agnesGenerationPath;
  }

  public void setAgnesGenerationPath(String agnesGenerationPath) {
    this.agnesGenerationPath = agnesGenerationPath;
  }

  public boolean isAgnesConfigured() {
    return agnesApiKey != null && !agnesApiKey.isBlank();
  }

  public String normalizedAgnesBaseUrl() {
    if (agnesBaseUrl == null || agnesBaseUrl.isBlank()) return "https://apihub.agnes-ai.com";
    return agnesBaseUrl.endsWith("/") ? agnesBaseUrl.substring(0, agnesBaseUrl.length() - 1) : agnesBaseUrl;
  }

  public String normalizedAgnesGenerationPath() {
    if (agnesGenerationPath == null || agnesGenerationPath.isBlank()) return "/v1/images/generations";
    return agnesGenerationPath.startsWith("/") ? agnesGenerationPath : "/" + agnesGenerationPath;
  }

  /** 判断请求的模型是否应走 Agnes provider */
  public boolean isAgnesModel(String resolvedModel) {
    if (resolvedModel == null) return false;
    String m = resolvedModel.trim().toLowerCase();
    return m.startsWith("agnes-image");
  }

  private static String normalizeAlias(String value) {
    return value == null ? "" : value.toLowerCase(Locale.ROOT).replaceAll("[\\s_\\-]+", "");
  }

  private static Map<String, String> defaultModelAliases() {
    Map<String, String> aliases = new LinkedHashMap<>();
    aliases.put("banana2", "gemini-3.1-flash-image-preview");
    aliases.put("nanobanana2", "gemini-3.1-flash-image-preview");
    aliases.put("gemini31flash", "gemini-3.1-flash-image-preview");
    aliases.put("gemini-3.1-flash-image-preview", "gemini-3.1-flash-image-preview");
    aliases.put("gemini-3.1-flash-image-preview-official", "gemini-3.1-flash-image-preview-official");
    aliases.put("bananapro", "gemini-3-pro-image-preview");
    aliases.put("nanobananapro", "gemini-3-pro-image-preview");
    aliases.put("gemini3pro", "gemini-3-pro-image-preview");
    aliases.put("gemini-3-pro-image-preview", "gemini-3-pro-image-preview");
    aliases.put("gptimag2", "gpt-image-2");
    aliases.put("gptimage2", "gpt-image-2");
    aliases.put("gpt-image-2", "gpt-image-2");
    aliases.put("gpt-img-2", "gpt-image-2");
    aliases.put("gptimg2", "gpt-image-2");
    // 兼容用户手抖写法：空格分隔 / 错误拼写
    aliases.put("gpt imag 2", "gpt-image-2");
    aliases.put("gpt image 2", "gpt-image-2");
    aliases.put("gpt-image-1.5", "gpt-image-1.5");
    aliases.put("gpt-image-1", "gpt-image-1");
    aliases.put("gpt-image-1-mini", "gpt-image-1-mini");
    aliases.put("dall-e-2", "dall-e-2");
    aliases.put("dall-e-3", "dall-e-3");
    aliases.put("dall-e-3-2024", "dall-e-3");
    // Agnes Image 2.1 Flash 系列
    aliases.put("agnesimage21flash", "agnes-image-2.1-flash");
    aliases.put("agnes-image-2.1-flash", "agnes-image-2.1-flash");
    aliases.put("agnes21flash", "agnes-image-2.1-flash");
    aliases.put("agnes2.1flash", "agnes-image-2.1-flash");
    aliases.put("\u7531\u524dimg2", "gpt-image-2");
    aliases.put("\u7531\u524d3.0", "gpt-image-2");
    return aliases;
  }
}
