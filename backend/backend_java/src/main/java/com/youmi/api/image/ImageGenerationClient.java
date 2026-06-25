package com.youmi.api.image;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.TextNode;
import com.youmi.api.common.ApiException;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Service;

@Service
public class ImageGenerationClient {
  private static final String PROVIDER_APIMART = "apimart";
  private static final String PROVIDER_GETTOKEN = "gettoken";
  private static final String GETTOKEN_TASK_PREFIX = PROVIDER_GETTOKEN + ":";
  private static final String BROWSER_USER_AGENT =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
          + "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

  private final ObjectMapper objectMapper;
  private final ImageGenerationProperties properties;
  private final HttpClient httpClient;
  private final Map<String, List<String>> persistedImageCache = new ConcurrentHashMap<>();

  public ImageGenerationClient(ObjectMapper objectMapper, ImageGenerationProperties properties) {
    this.objectMapper = objectMapper;
    this.properties = properties;
    this.httpClient = HttpClient.newBuilder()
        .version(HttpClient.Version.HTTP_1_1)
        .followRedirects(HttpClient.Redirect.NORMAL)
        .connectTimeout(Duration.ofSeconds(Math.max(3, properties.getTimeoutSeconds())))
        .build();
  }

  public ImageGenerationDtos.StatusResponse status() {
    return new ImageGenerationDtos.StatusResponse(
        properties.isConfigured() || properties.isGetTokenConfigured(),
        properties.normalizedBaseUrl(),
        properties.normalizedGenerationPath(),
        properties.normalizedTaskPath(),
        properties.getModel(),
        properties.getDefaultSize(),
        properties.getDefaultResolution(),
        properties.getModelAliases());
  }

  public ImageGenerationDtos.CreateTaskResponse createTask(ImageGenerationDtos.CreateTaskRequest request)
      throws Exception {
    if (request == null || request.prompt() == null || request.prompt().isBlank()) {
      throw new ApiException(400, "prompt is required");
    }

    if (!properties.isConfigured() && !properties.isGetTokenConfigured()) {
      throw new ApiException(400, "Image generation api key is not configured");
    }

    if (properties.isConfigured()) {
      try {
        return createApimartTask(request);
      } catch (Exception exception) {
        if (!shouldFallbackToGetToken()) throw exception;
      }
    }
    if (properties.isGetTokenConfigured()) {
      return createGetTokenTask(request);
    }
    throw new ApiException(502, "Image generation provider request failed");
  }

  private boolean shouldFallbackToGetToken() {
    return properties.isFallbackEnabled()
        && properties.isGetTokenConfigured()
        && "gettoken".equalsIgnoreCase(String.valueOf(properties.getFallbackProvider()).trim());
  }

  private ImageGenerationDtos.CreateTaskResponse createApimartTask(ImageGenerationDtos.CreateTaskRequest request)
      throws Exception {

    String resolvedModel = properties.resolveModel(request.model());
    String size = properties.normalizeSize(request.size(), request.ratio());
    String resolution = properties.normalizeResolution(resolvedModel, request.resolution());
    int count = request.requestedCount();

    Map<String, Object> body = new LinkedHashMap<>();
    body.put("model", resolvedModel);
    body.put("prompt", request.prompt().trim());
    body.put("size", size);
    body.put("n", count);
    if (properties.shouldSendResolution(resolvedModel) && resolution != null && !resolution.isBlank()) {
      body.put("resolution", resolution);
    }
    putIfPresent(body, "image_urls", request.normalizedImageUrls());
    putIfPresent(body, "background", request.background());
    putIfPresent(body, "output_format", request.outputFormat());
    putIfPresent(body, "moderation", request.moderation());
    putIfPresent(body, "input_fidelity", request.inputFidelity());
    if (request.outputCompression() != null) {
      body.put("output_compression", request.outputCompression());
    }
    putIfPresent(body, "webhook_url", request.webhookUrl());

    JsonNode root = sendPost(properties.normalizedBaseUrl() + properties.normalizedGenerationPath(), body);
    List<ImageGenerationDtos.TaskRef> tasks = extractTasks(root);
    if (tasks.isEmpty()) {
      throw new ApiException(502, "APIMart did not return task_id");
    }

    return new ImageGenerationDtos.CreateTaskResponse(
        PROVIDER_APIMART,
        request.model(),
        resolvedModel,
        size,
        resolution,
        count,
        tasks,
        root);
  }

  private ImageGenerationDtos.CreateTaskResponse createGetTokenTask(ImageGenerationDtos.CreateTaskRequest request)
      throws Exception {
    String resolvedModel = properties.resolveModel(request.model());
    String getTokenModel = "banana2";
    String size = properties.normalizeSize(request.size(), request.ratio());
    String resolution = properties.normalizeResolution(resolvedModel, request.resolution());
    int count = request.requestedCount();
    String endpoint = properties.normalizedGetTokenBaseUrl() + getTokenBanana2GenerationPath(request.normalizedImageUrls());

    Map<String, Object> body = new LinkedHashMap<>();
    body.put("prompt", request.prompt().trim());
    putIfPresent(body, "aspectRatio", size);
    putIfPresent(body, "resolution", normalizeGetTokenResolution(resolution));
    putIfPresent(body, "imageUrls", request.normalizedImageUrls());
    putIfPresent(body, "webhookUrl", request.webhookUrl());
    if (count > 1) body.put("n", count);

    JsonNode root = sendGetTokenPost(endpoint, body);
    List<ImageGenerationDtos.TaskRef> tasks = extractTasks(root).stream()
        .map(task -> new ImageGenerationDtos.TaskRef(GETTOKEN_TASK_PREFIX + task.taskId(), task.status()))
        .toList();
    if (tasks.isEmpty()) {
      throw new ApiException(502, "GetToken did not return taskId");
    }

    return new ImageGenerationDtos.CreateTaskResponse(
        PROVIDER_GETTOKEN,
        request.model(),
        getTokenModel,
        size,
        resolution,
        count,
        tasks,
        root);
  }

  public ImageGenerationDtos.TaskStatusResponse getTask(String taskId) throws Exception {
    if (taskId == null || taskId.isBlank()) {
      throw new ApiException(400, "taskId is required");
    }
    String cleanTaskId = taskId.trim();
    if (cleanTaskId.startsWith(GETTOKEN_TASK_PREFIX)) {
      return getGetTokenTask(cleanTaskId.substring(GETTOKEN_TASK_PREFIX.length()));
    }
    if (!properties.isConfigured()) {
      throw new ApiException(400, "APIMart image api key is not configured");
    }

    String endpoint = properties.normalizedBaseUrl() + properties.normalizedTaskPath() + "/" + encode(cleanTaskId);
    if (properties.getLanguage() != null && !properties.getLanguage().isBlank()) {
      endpoint += "?language=" + encode(properties.getLanguage());
    }

    JsonNode root = sendGet(endpoint);
    JsonNode data = firstDataNode(root);
    String status = text(data, "status");
    if (status.isBlank()) status = text(root, "status");
    Integer progress = intValue(data, "progress");
    if (progress == null) progress = intValue(data, "percent");
    if (progress == null) progress = intValue(data, "percentage");
    String error = firstNonBlank(
        text(data.path("error"), "message"),
        text(data, "error"),
        text(data, "message"),
        text(root, "message"));

    List<String> imageUrls = new ArrayList<>();
    collectImageUrls(data.path("result"), imageUrls);
    collectImageUrls(data, imageUrls);
    if (isDoneStatus(status) && !imageUrls.isEmpty()) {
      List<String> temporaryUrls = new ArrayList<>(imageUrls);
      imageUrls = persistImageUrls(cleanTaskId, imageUrls);
      replaceImageUrls(root, temporaryUrls, imageUrls);
    }

    return new ImageGenerationDtos.TaskStatusResponse(
        "apimart",
        cleanTaskId,
        status.isBlank() ? "unknown" : status,
        progress,
        imageUrls,
        error.isBlank() ? null : error,
        root);
  }

  private ImageGenerationDtos.TaskStatusResponse getGetTokenTask(String taskId) throws Exception {
    if (!properties.isGetTokenConfigured()) {
      throw new ApiException(400, "GetToken image api key is not configured");
    }
    String cleanTaskId = taskId == null ? "" : taskId.trim();
    if (cleanTaskId.isBlank()) throw new ApiException(400, "taskId is required");

    Map<String, Object> body = new LinkedHashMap<>();
    body.put("taskId", cleanTaskId);
    JsonNode root = sendGetTokenPost(properties.normalizedGetTokenBaseUrl() + properties.normalizedGetTokenQueryPath(), body);
    String status = firstNonBlank(text(root, "status"), text(firstDataNode(root), "status"));
    Integer progress = intValue(root, "progress");
    String error = firstNonBlank(text(root, "errorMessage"), text(root, "error"), text(root, "message"));
    List<String> imageUrls = new ArrayList<>();
    collectImageUrls(root.path("results"), imageUrls);
    collectImageUrls(root, imageUrls);
    if (isDoneStatus(status) && !imageUrls.isEmpty()) {
      List<String> temporaryUrls = new ArrayList<>(imageUrls);
      imageUrls = persistImageUrls(GETTOKEN_TASK_PREFIX + cleanTaskId, imageUrls);
      replaceImageUrls(root, temporaryUrls, imageUrls);
    }
    return new ImageGenerationDtos.TaskStatusResponse(
        PROVIDER_GETTOKEN,
        GETTOKEN_TASK_PREFIX + cleanTaskId,
        status.isBlank() ? "unknown" : status,
        progress,
        imageUrls,
        error.isBlank() ? null : error,
        root);
  }

  private JsonNode sendPost(String endpoint, Map<String, Object> body) throws Exception {
    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(endpoint))
        .timeout(Duration.ofSeconds(Math.max(5, properties.getTimeoutSeconds())))
        .header("Authorization", "Bearer " + properties.getApiKey())
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
        .build();
    return send(request);
  }

  private JsonNode sendGetTokenPost(String endpoint, Map<String, Object> body) throws Exception {
    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(endpoint))
        .timeout(Duration.ofSeconds(Math.max(5, properties.getTimeoutSeconds())))
        .header("Authorization", "Bearer " + properties.getGetTokenApiKey())
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
        .build();
    return send(request, "GetToken");
  }

  private JsonNode sendGet(String endpoint) throws Exception {
    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(endpoint))
        .timeout(Duration.ofSeconds(Math.max(5, properties.getTimeoutSeconds())))
        .header("Authorization", "Bearer " + properties.getApiKey())
        .GET()
        .build();
    return send(request);
  }

  private JsonNode send(HttpRequest request) throws Exception {
    return send(request, "APIMart");
  }

  private JsonNode send(HttpRequest request, String providerLabel) throws Exception {
    HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
    JsonNode root = parseBody(response.body());
    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      throw new ApiException(502, providerLabel + " request failed: " + response.statusCode() + " " + compact(response.body()));
    }
    return root;
  }

  private String getTokenBanana2GenerationPath(List<String> imageUrls) {
    boolean imageToImage = imageUrls != null && !imageUrls.isEmpty();
    return "/banana2" + (imageToImage ? "/image-to-image" : "/text-to-image");
  }

  private String normalizeGetTokenResolution(String resolution) {
    if (resolution == null || resolution.isBlank()) return "";
    return resolution.trim().toLowerCase();
  }

  private List<String> persistImageUrls(String taskId, List<String> imageUrls) throws Exception {
    if (!properties.isPersistGeneratedImages()) return imageUrls;
    if (properties.getUploadEndpoint() == null || properties.getUploadEndpoint().isBlank()) {
      throw new ApiException(502, "Generated image persistence is enabled, but upload endpoint is not configured");
    }

    List<String> cached = persistedImageCache.get(taskId);
    if (cached != null && !cached.isEmpty()) return cached;

    synchronized (persistedImageCache) {
      cached = persistedImageCache.get(taskId);
      if (cached != null && !cached.isEmpty()) return cached;

      List<String> persisted = new ArrayList<>();
      for (int index = 0; index < imageUrls.size(); index += 1) {
        persisted.add(persistImageUrl(taskId, index, imageUrls.get(index)));
      }
      persistedImageCache.put(taskId, persisted);
      return persisted;
    }
  }

  private String persistImageUrl(String taskId, int index, String imageUrl) throws Exception {
    DownloadedImage image = downloadImage(taskId, index, imageUrl);
    String boundary = "----YoumiUploadBoundary" + System.currentTimeMillis() + Math.abs(imageUrl.hashCode());
    byte[] body = multipartBody(boundary, image);

    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(properties.getUploadEndpoint().trim()))
        .version(HttpClient.Version.HTTP_1_1)
        .timeout(Duration.ofSeconds(Math.max(10, properties.getUploadTimeoutSeconds())))
        .header("Accept", "application/json, text/plain, */*")
        .header("User-Agent", BROWSER_USER_AGENT)
        .header("Content-Type", "multipart/form-data; boundary=" + boundary)
        .POST(HttpRequest.BodyPublishers.ofByteArray(body))
        .build();
    HttpResponse<String> response;
    try {
      response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
    } catch (Exception exception) {
      throw new ApiException(502, "Generated image OSS upload request failed: " + exception.getMessage());
    }
    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      throw new ApiException(502, "Generated image OSS upload failed: " + response.statusCode() + " " + compact(response.body()));
    }

    JsonNode root = parseUploadBody(response.body());
    String uploadedUrl = extractUploadUrl(root);
    if (uploadedUrl.isBlank()) {
      throw new ApiException(502, "Generated image OSS upload succeeded, but no URL was returned");
    }
    return normalizeUploadedUrl(uploadedUrl);
  }

  private DownloadedImage downloadImage(String taskId, int index, String imageUrl) throws Exception {
    if (imageUrl == null || imageUrl.isBlank()) {
      throw new ApiException(502, "Generated image URL is empty");
    }
    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(imageUrl.trim()))
        .version(HttpClient.Version.HTTP_1_1)
        .timeout(Duration.ofSeconds(Math.max(10, properties.getTimeoutSeconds())))
        .header("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8")
        .header("User-Agent", BROWSER_USER_AGENT)
        .GET()
        .build();
    HttpResponse<byte[]> response;
    try {
      response = httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
    } catch (Exception exception) {
      throw new ApiException(502, "Generated image download request failed: " + exception.getMessage());
    }
    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      throw new ApiException(502, "Generated image download failed: " + response.statusCode());
    }
    byte[] bytes = response.body();
    if (bytes == null || bytes.length == 0) {
      throw new ApiException(502, "Generated image download returned empty file");
    }
    String contentType = response.headers().firstValue("Content-Type")
        .map(value -> value.split(";", 2)[0].trim())
        .filter(value -> !value.isBlank())
        .orElse("image/jpeg");
    return new DownloadedImage(bytes, contentType, imageFileName(taskId, index, imageUrl, contentType));
  }

  private byte[] multipartBody(String boundary, DownloadedImage image) throws Exception {
    String fieldName = properties.getUploadFieldName() == null || properties.getUploadFieldName().isBlank()
        ? "file"
        : properties.getUploadFieldName().trim();
    ByteArrayOutputStream output = new ByteArrayOutputStream();
    output.write(("--" + boundary + "\r\n").getBytes(StandardCharsets.UTF_8));
    output.write(("Content-Disposition: form-data; name=\"" + fieldName + "\"; filename=\"" + image.filename() + "\"\r\n").getBytes(StandardCharsets.UTF_8));
    output.write(("Content-Type: " + image.contentType() + "\r\n\r\n").getBytes(StandardCharsets.UTF_8));
    output.write(image.bytes());
    output.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
    return output.toByteArray();
  }

  private JsonNode parseUploadBody(String body) throws Exception {
    if (body == null || body.isBlank()) {
      throw new ApiException(502, "OSS upload returned empty body");
    }
    return objectMapper.readTree(body);
  }

  private String extractUploadUrl(JsonNode node) {
    if (node == null || node.isMissingNode() || node.isNull()) return "";
    if (node.isTextual()) {
      String value = node.asText().trim();
      return looksLikeStoredUrl(value) ? value : "";
    }
    if (node.isArray()) {
      for (JsonNode item : node) {
        String url = extractUploadUrl(item);
        if (!url.isBlank()) return url;
      }
      return "";
    }
    if (!node.isObject()) return "";

    String direct = firstNonBlank(
        text(node, "url"),
        text(node, "fileUrl"),
        text(node, "file_url"),
        text(node, "fullUrl"),
        text(node, "full_url"),
        text(node, "path"),
        text(node, "src"));
    if (looksLikeStoredUrl(direct)) return direct.trim();

    String nested = firstNonBlank(
        extractUploadUrl(node.path("data")),
        extractUploadUrl(node.path("result")),
        extractUploadUrl(node.path("file")));
    if (!nested.isBlank()) return nested;

    Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
    while (fields.hasNext()) {
      Map.Entry<String, JsonNode> field = fields.next();
      String name = field.getKey().toLowerCase();
      if (name.contains("url") || name.endsWith("path")) {
        String url = extractUploadUrl(field.getValue());
        if (!url.isBlank()) return url;
      }
    }
    return "";
  }

  private String normalizeUploadedUrl(String value) {
    String trimmed = value == null ? "" : value.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
    if (trimmed.startsWith("/uploads/")) return trimmed;
    if (!trimmed.startsWith("/")) return trimmed;

    URI endpoint = URI.create(properties.getUploadEndpoint().trim());
    String port = endpoint.getPort() > -1 ? ":" + endpoint.getPort() : "";
    return endpoint.getScheme() + "://" + endpoint.getHost() + port + trimmed;
  }

  private JsonNode parseBody(String body) throws Exception {
    if (body == null || body.isBlank()) {
      throw new ApiException(502, "APIMart returned empty body");
    }
    return objectMapper.readTree(body);
  }

  private List<ImageGenerationDtos.TaskRef> extractTasks(JsonNode root) {
    List<ImageGenerationDtos.TaskRef> tasks = new ArrayList<>();
    JsonNode data = root.path("data");
    if (data.isArray()) {
      for (JsonNode item : data) addTask(tasks, item);
    } else if (data.isObject()) {
      addTask(tasks, data);
    }
    if (tasks.isEmpty()) addTask(tasks, root);
    return tasks;
  }

  private void addTask(List<ImageGenerationDtos.TaskRef> tasks, JsonNode node) {
    if (node == null || node.isMissingNode() || node.isNull()) return;
    String taskId = firstNonBlank(text(node, "task_id"), text(node, "taskId"), text(node, "id"));
    if (taskId.isBlank()) return;
    tasks.add(new ImageGenerationDtos.TaskRef(taskId, text(node, "status")));
  }

  private JsonNode firstDataNode(JsonNode root) {
    JsonNode data = root.path("data");
    if (data.isArray() && data.size() > 0) return data.get(0);
    if (data.isObject()) return data;
    return root;
  }

  private void collectImageUrls(JsonNode node, List<String> urls) {
    if (node == null || node.isMissingNode() || node.isNull()) return;
    if (node.isTextual() && looksLikeImageUrl(node.asText())) {
      addUrl(urls, node.asText());
      return;
    }
    if (node.isArray()) {
      for (JsonNode item : node) collectImageUrls(item, urls);
      return;
    }
    if (!node.isObject()) return;

    JsonNode images = node.path("images");
    if (images.isArray()) {
      for (JsonNode image : images) {
        collectImageUrls(image.path("url"), urls);
        collectImageUrls(image.path("urls"), urls);
      }
    }
    collectImageUrls(node.path("image_urls"), urls);
    collectImageUrls(node.path("imageUrls"), urls);
    collectImageUrls(node.path("output_urls"), urls);
    collectImageUrls(node.path("url"), urls);

    Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
    while (fields.hasNext()) {
      Map.Entry<String, JsonNode> field = fields.next();
      String name = field.getKey().toLowerCase();
      if (name.contains("image") || name.contains("url") || name.equals("result")) {
        collectImageUrls(field.getValue(), urls);
      }
    }
  }

  private void addUrl(List<String> urls, String value) {
    if (value == null || value.isBlank()) return;
    String trimmed = value.trim();
    if (!urls.contains(trimmed)) urls.add(trimmed);
  }

  private void replaceImageUrls(JsonNode root, List<String> sourceUrls, List<String> replacementUrls) {
    if (root == null || sourceUrls == null || replacementUrls == null) return;
    Map<String, String> replacements = new LinkedHashMap<>();
    int size = Math.min(sourceUrls.size(), replacementUrls.size());
    for (int index = 0; index < size; index += 1) {
      String source = sourceUrls.get(index);
      String replacement = replacementUrls.get(index);
      if (source != null && !source.isBlank() && replacement != null && !replacement.isBlank()) {
        replacements.put(source.trim(), replacement.trim());
      }
    }
    if (!replacements.isEmpty()) replaceImageUrls(root, replacements);
  }

  private void replaceImageUrls(JsonNode node, Map<String, String> replacements) {
    if (node == null || node.isMissingNode() || node.isNull()) return;
    if (node.isObject()) {
      ObjectNode objectNode = (ObjectNode) node;
      Iterator<Map.Entry<String, JsonNode>> fields = objectNode.fields();
      List<Map.Entry<String, String>> pending = new ArrayList<>();
      while (fields.hasNext()) {
        Map.Entry<String, JsonNode> field = fields.next();
        JsonNode value = field.getValue();
        if (value.isTextual()) {
          String replacement = replacements.get(value.asText().trim());
          if (replacement != null) pending.add(Map.entry(field.getKey(), replacement));
        } else {
          replaceImageUrls(value, replacements);
        }
      }
      for (Map.Entry<String, String> entry : pending) {
        objectNode.put(entry.getKey(), entry.getValue());
      }
      return;
    }
    if (node.isArray()) {
      ArrayNode arrayNode = (ArrayNode) node;
      for (int index = 0; index < arrayNode.size(); index += 1) {
        JsonNode value = arrayNode.get(index);
        if (value.isTextual()) {
          String replacement = replacements.get(value.asText().trim());
          if (replacement != null) arrayNode.set(index, TextNode.valueOf(replacement));
        } else {
          replaceImageUrls(value, replacements);
        }
      }
    }
  }

  private boolean looksLikeImageUrl(String value) {
    if (value == null) return false;
    String lower = value.toLowerCase();
    return lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("data:image/");
  }

  private boolean looksLikeStoredUrl(String value) {
    if (value == null || value.isBlank()) return false;
    String trimmed = value.trim();
    return trimmed.startsWith("http://")
        || trimmed.startsWith("https://")
        || trimmed.startsWith("/");
  }

  private boolean isDoneStatus(String status) {
    if (status == null) return false;
    String normalized = status.trim().toLowerCase();
    return normalized.equals("completed")
        || normalized.equals("succeeded")
        || normalized.equals("success")
        || normalized.equals("done");
  }

  private String imageFileName(String taskId, int index, String imageUrl, String contentType) {
    String extension = extensionFor(contentType);
    try {
      String path = URI.create(imageUrl).getPath();
      if (path != null && path.contains("/")) {
        String name = path.substring(path.lastIndexOf('/') + 1).replaceAll("[^A-Za-z0-9._-]", "_");
        if (!name.isBlank() && name.contains(".")) {
          return name.length() > 160 ? name.substring(name.length() - 160) : name;
        }
      }
    } catch (IllegalArgumentException ignored) {
      // Use the deterministic fallback below when the temporary URL is unusual.
    }
    return "youmi-generated-" + taskId.replaceAll("[^A-Za-z0-9._-]", "_") + "-" + index + "." + extension;
  }

  private String extensionFor(String contentType) {
    if (contentType == null) return "jpg";
    String lower = contentType.toLowerCase();
    if (lower.contains("png")) return "png";
    if (lower.contains("webp")) return "webp";
    if (lower.contains("gif")) return "gif";
    if (lower.contains("jpeg") || lower.contains("jpg")) return "jpg";
    return "jpg";
  }

  private void putIfPresent(Map<String, Object> body, String key, String value) {
    if (value != null && !value.isBlank()) body.put(key, value.trim());
  }

  private void putIfPresent(Map<String, Object> body, String key, List<String> values) {
    if (values != null && !values.isEmpty()) body.put(key, values);
  }

  private String text(JsonNode node, String field) {
    if (node == null || node.isMissingNode() || node.isNull()) return "";
    JsonNode value = node.path(field);
    return value.isTextual() || value.isNumber() || value.isBoolean() ? value.asText() : "";
  }

  private Integer intValue(JsonNode node, String field) {
    if (node == null || node.isMissingNode() || node.isNull()) return null;
    JsonNode value = node.path(field);
    if (value.isInt() || value.isLong()) return value.asInt();
    if (value.isTextual()) {
      try {
        return Integer.parseInt(value.asText().replace("%", "").trim());
      } catch (NumberFormatException ignored) {
        return null;
      }
    }
    return null;
  }

  private String firstNonBlank(String... values) {
    for (String value : values) {
      if (value != null && !value.isBlank()) return value;
    }
    return "";
  }

  private String encode(String value) {
    return URLEncoder.encode(value, StandardCharsets.UTF_8);
  }

  private String compact(String body) {
    if (body == null || body.isBlank()) return "";
    String compacted = body.replaceAll("\\s+", " ").trim();
    return compacted.length() > 500 ? compacted.substring(0, 500) + "..." : compacted;
  }

  private record DownloadedImage(byte[] bytes, String contentType, String filename) {}
}
