package com.youmi.api.image;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.TextNode;
import com.youmi.api.common.ApiException;
import com.youmi.api.file.OssStorageService;
import java.io.ByteArrayInputStream;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
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
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class ImageGenerationClient {
  private static final String PROVIDER_APIMART = "apimart";
  private static final String PROVIDER_GETTOKEN = "gettoken";
  private static final String PROVIDER_PROXY = "proxy";
  private static final String PROVIDER_ANNES = "agnes";
  private static final String GETTOKEN_TASK_PREFIX = PROVIDER_GETTOKEN + ":";
  private static final String PROXY_TASK_PREFIX = PROVIDER_PROXY + ":";
  private static final String AGNES_TASK_PREFIX = PROVIDER_ANNES + ":";
  private static final String APIMART_DIRECT_TASK_PREFIX = "apimart-direct:";
  private static final long PROVIDER_TIMEOUT_MS = 120_000L; // 2 分钟超时阈值（自任务创建起算）
  private static final String BROWSER_USER_AGENT =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
          + "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

  private final ObjectMapper objectMapper;
  private final ImageGenerationProperties properties;
  private final OssStorageService ossStorageService;
  private final HttpClient httpClient;
  private final Map<String, List<String>> persistedImageCache = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<String, FailoverState> failoverStates = new ConcurrentHashMap<>();

  // 下列依赖为字段注入（required=false）：测试构造时可为 null，运行时由 Spring 注入。
  @Autowired(required = false)
  private JdbcTemplate jdbcTemplate;
  // 异步持久化去重：标记正在持久化的复合 taskId（其值 = ym_image_task.task_id）
  private final ConcurrentHashMap<String, Boolean> persistingTaskIds = new ConcurrentHashMap<>();
  // 持久化专用线程池：避免轮询请求内同步阻塞，且不引入自注入造成的循环依赖
  private final ThreadPoolTaskExecutor persistExecutor = buildPersistExecutor();

  @Autowired
  public ImageGenerationClient(
      ObjectMapper objectMapper,
      ImageGenerationProperties properties,
      OssStorageService ossStorageService) {
    this.objectMapper = objectMapper;
    this.properties = properties;
    this.ossStorageService = ossStorageService;
    this.httpClient = HttpClient.newBuilder()
        .version(HttpClient.Version.HTTP_1_1)
        .followRedirects(HttpClient.Redirect.NORMAL)
        .connectTimeout(Duration.ofSeconds(Math.max(3, properties.getTimeoutSeconds())))
        .build();
  }

  ImageGenerationClient(ObjectMapper objectMapper, ImageGenerationProperties properties) {
    this(objectMapper, properties, null);
  }

  /** 构建持久化专用线程池（有界，避免无限制创建线程） */
  private static ThreadPoolTaskExecutor buildPersistExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(4);
    executor.setMaxPoolSize(16);
    executor.setQueueCapacity(64);
    executor.setThreadNamePrefix("img-persist-");
    executor.setWaitForTasksToCompleteOnShutdown(false);
    executor.setDaemon(true);
    executor.initialize();
    return executor;
  }

  public ImageGenerationDtos.StatusResponse status() {
    boolean configured = properties.isConfigured() || properties.isGetTokenConfigured()
        || isProxyConfigured() || properties.isAgnesConfigured();
    return new ImageGenerationDtos.StatusResponse(
        configured,
        properties.normalizedBaseUrl(),
        properties.normalizedGenerationPath(),
        properties.normalizedTaskPath(),
        properties.getModel(),
        properties.getDefaultSize(),
        properties.getDefaultResolution(),
        properties.getModelAliases());
  }

  /** 中转站模式：baseUrl 指向代理服务器且有 generation-path=/api/images/jobs */
  private boolean isProxyConfigured() {
    return properties.isProxyConfigured();
  }

  public ImageGenerationDtos.CreateTaskResponse createTask(ImageGenerationDtos.CreateTaskRequest request)
      throws Exception {
    if (request == null || request.prompt() == null || request.prompt().isBlank()) {
      throw new ApiException(400, "prompt is required");
    }

    if (!properties.isConfigured()
        && !properties.isApimartDirectConfigured()
        && !properties.isGetTokenConfigured()
        && !properties.isAgnesConfigured()
        && !isProxyConfigured()) {
      throw new ApiException(400, "Image generation api key is not configured");
    }

    // Agnes Image 模型优先（同步 API，直接返回图片）
    String resolvedModel = properties.resolveModel(request.model());
    if (properties.isAgnesConfigured() && properties.isAgnesModel(resolvedModel)) {
      return createAgnesTask(request);
    }

    // banana2 / bananapro（gemini-3 系列）走 GetToken 中转站，失败兜底 Proxy
    if (properties.isGetTokenConfigured() && properties.isGetTokenModel(resolvedModel)) {
      try {
        return createGetTokenTask(request);
      } catch (Exception getTokenError) {
        // GetToken 失败，兜底到 Proxy 中转站的 Gemini
        if (isProxyConfigured()) {
          return createProxyTask(request);
        }
        throw getTokenError;
      }
    }

    // gpt-image-2 / dall-e 等：优先走 APIMart 直连（aiuxu.com），失败兜底 Proxy（GetToken 不支持 gpt-image-2，跳过）
    if (properties.isProxyModel(resolvedModel)) {
      boolean apimartConfigured = properties.isApimartDirectConfigured();
      boolean proxyConfigured = isProxyConfigured();
      System.out.println("[image-route] model=" + resolvedModel + " apimartDirect=" + apimartConfigured + " proxy=" + proxyConfigured
          + " apimartBaseUrl=" + properties.normalizedApimartDirectBaseUrl() + " apimartApiKey=" + (properties.getApimartDirectApiKey() != null ? properties.getApimartDirectApiKey().substring(0, Math.min(10, properties.getApimartDirectApiKey().length())) + "..." : "null"));
      if (apimartConfigured) {
        try {
          return createApimartDirectTask(request);
        } catch (Exception apimartError) {
          System.out.println("[image] APIMart-direct failed, trying fallback chain: " + apimartError.getMessage());
          return createFallbackTask(request, apimartError);
        }
      } else {
        if (proxyConfigured) {
          System.out.println("[image-route] APIMart-direct not configured, using Proxy directly");
          return createProxyTask(request);
        }
      }
    }

    if (properties.isConfigured()) {
      try {
        return createApimartTask(request);
      } catch (Exception exception) {
        return createFallbackTask(request, exception);
      }
    }
    if (properties.isGetTokenConfigured()) {
      return createGetTokenTask(request);
    }
    if (isProxyConfigured()) {
      return createProxyTask(request);
    }
    throw new ApiException(502, "Image generation provider request failed");
  }

  private ImageGenerationDtos.CreateTaskResponse createFallbackTask(
      ImageGenerationDtos.CreateTaskRequest request, Exception primaryError) throws Exception {
    if (isProxyConfigured()) {
      try {
        System.out.println("[image] trying Proxy fallback");
        return createProxyTask(request);
      } catch (Exception proxyError) {
        if (primaryError != null) {
          proxyError.addSuppressed(primaryError);
        }
        throw proxyError;
      }
    }
    if (primaryError != null) {
      throw primaryError;
    }
    throw new ApiException(502, "No image fallback provider configured");
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

    registerFailoverState(tasks.get(0).taskId(), request, PROVIDER_APIMART);
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

  /**
   * 中转站代理模式：POST /api/images/jobs → 返回 job_id，结果直传 OSS
   * 支持文生图和图生图（image_objects）
   */
  private ImageGenerationDtos.CreateTaskResponse createProxyTask(ImageGenerationDtos.CreateTaskRequest request)
      throws Exception {
    String resolvedModel = properties.resolveModel(request.model());
    String size = properties.normalizeSize(request.size(), request.ratio());
    String resolution = properties.normalizeResolution(resolvedModel, request.resolution());
    int count = request.requestedCount();
    List<String> imageUrls = request.normalizedImageUrls();

    // gpt-image-2 / Gemini（兜底时从 GetToken fallback 过来）
    String proxyModel = normalizeProxyModel(resolvedModel);
    this.proxyModel = proxyModel;  // 给 pickProxySize 用

    boolean isGemini = proxyModel.startsWith("gemini-");
    String proxySize;
    if (isGemini) {
      // Gemini：直接用 ratio 作为 aspect_ratio，不用 px 尺寸
      proxySize = size;
    } else {
      // gpt-image-2：按 ratio + resolution 计算像素尺寸
      proxySize = pickProxySize(size, resolution);
    }
    System.out.println("[proxy] model=" + resolvedModel + " size=" + size
        + " ratio=" + request.ratio() + " resolution=" + resolution
        + " -> proxySize=" + proxySize);

    Map<String, Object> body = new LinkedHashMap<>();
    body.put("prompt", request.prompt().trim());
    body.put("model", proxyModel);
    if (isGemini) {
      // Gemini：aspect_ratio + image_size
      body.put("aspect_ratio", proxySize);
      body.put("image_size", resolution);
    } else {
      // GPT：像素尺寸 + quality
      body.put("size", proxySize);
      body.put("quality", mapProxyQuality(resolution));
      body.put("moderation", "auto");
    }
    body.put("output_format", request.outputFormat() != null && !request.outputFormat().isBlank()
        ? request.outputFormat() : "png");
    body.put("n", count);

    // 图生图：需要先上传参考图到 OSS，然后传 image_objects
    if (imageUrls != null && !imageUrls.isEmpty()) {
      List<Map<String, String>> imageObjects = new ArrayList<>();
      for (String imageUrl : imageUrls) {
        // 先获取 OSS 直传签名
        Map<String, String> uploaded = uploadReferenceImage(imageUrl);
        imageObjects.add(uploaded);
      }
      body.put("image_objects", imageObjects);
    }

    JsonNode root = sendProxyPost(
        properties.normalizedProxyBaseUrl() + properties.normalizedProxyGenerationPath(), body);

    // 中转站返回 { job_id, poll_url, retry_after_seconds, status }
    String jobId = firstNonBlank(text(root, "job_id"), text(root, "id"));
    if (jobId.isBlank()) {
      throw new ApiException(502, "Proxy did not return job_id");
    }

    List<ImageGenerationDtos.TaskRef> tasks = List.of(
        new ImageGenerationDtos.TaskRef(PROXY_TASK_PREFIX + jobId, text(root, "status")));

    return new ImageGenerationDtos.CreateTaskResponse(
        PROVIDER_PROXY,
        request.model(),
        resolvedModel,
        size,
        resolution,
        count,
        tasks,
        root);
  }

  /**
   * APIMart 直连 GPT-Image-2 标准通道（主通道）
   * 端点：POST https://apib.ai/v1/images/generations
   * 异步：返回 task_id，轮询 GET /v1/tasks/{task_id}
   * 模型名：gpt-image-2，official_fallback=true
   */
  private ImageGenerationDtos.CreateTaskResponse createApimartDirectTask(ImageGenerationDtos.CreateTaskRequest request)
      throws Exception {
    String size = properties.normalizeSize(request.size(), request.ratio());
    String resolution = properties.normalizeResolution("gpt-image-2", request.resolution());
    int count = request.requestedCount();
    String endpoint = properties.normalizedApimartDirectBaseUrl() + properties.normalizedApimartDirectGenerationPath();

    Map<String, Object> body = new LinkedHashMap<>();
    body.put("model", "gpt-image-2");
    body.put("prompt", request.prompt().trim());
    body.put("size", size);
    body.put("resolution", resolution);
    body.put("n", count);
    body.put("official_fallback", true);
    putIfPresent(body, "image_urls", request.normalizedImageUrls());

    JsonNode root = sendApimartDirectPost(endpoint, body);
    List<ImageGenerationDtos.TaskRef> tasks = extractTasks(root).stream()
        .map(task -> new ImageGenerationDtos.TaskRef(APIMART_DIRECT_TASK_PREFIX + task.taskId(), task.status()))
        .toList();
    if (tasks.isEmpty()) {
      throw new ApiException(502, "APIMart direct did not return task_id");
    }

    registerFailoverState(tasks.get(0).taskId(), request, "apimart-direct");
    return new ImageGenerationDtos.CreateTaskResponse(
        "apimart-direct",
        request.model(),
        "gpt-image-2",
        size,
        resolution,
        count,
        tasks,
        root);
  }

  private ImageGenerationDtos.CreateTaskResponse createAgnesTask(ImageGenerationDtos.CreateTaskRequest request)
      throws Exception {
    String resolvedModel = properties.resolveModel(request.model());
    String ratio = properties.normalizeSize(request.size(), request.ratio());
    String resolution = properties.normalizeResolution(resolvedModel, request.resolution());
    int count = request.requestedCount();
    List<String> imageUrls = request.normalizedImageUrls();
    boolean isImageEdit = imageUrls != null && !imageUrls.isEmpty();

    // Agnes 支持语义化参数：size="4K" + ratio="4:3"（速查表 V2）
    // 也支持像素格式 "4096x3072"，但语义化更简洁且由 Agnes 自动计算像素
    String agnesSize = resolutionToAgnesSize(resolution);
    String agnesRatio = normalizeAgnesRatio(ratio);

    Map<String, Object> body = new LinkedHashMap<>();
    body.put("model", resolvedModel);
    body.put("prompt", request.prompt().trim());
    body.put("size", agnesSize);
    body.put("ratio", agnesRatio);

    // 文生图才传 n
    if (!isImageEdit) {
      body.put("n", count);
    }

    // extra_body：包含 response_format 和图生图的 image[]
    Map<String, Object> extraBody = new LinkedHashMap<>();
    extraBody.put("response_format", "url");

    if (isImageEdit) {
      // 图生图：image 数组（Agnes 文档要求）
      extraBody.put("image", imageUrls);
    }

    body.put("extra_body", extraBody);

    String endpoint = properties.normalizedAgnesBaseUrl() + properties.normalizedAgnesGenerationPath();
    String bodyJson = objectMapper.writeValueAsString(body);
    System.out.println("[agnes] model=" + resolvedModel + " isEdit=" + isImageEdit + " size=" + agnesSize + " ratio=" + agnesRatio + " prompt=" + compact(request.prompt()));

    JsonNode root = sendAgnesPost(endpoint, body);

    // Agnes 是同步 API，响应直接包含 data[0].url
    List<String> generatedUrls = new ArrayList<>();
    JsonNode data = root.path("data");
    if (data.isArray()) {
      for (JsonNode item : data) {
        String url = text(item, "url");
        if (!url.isBlank()) addUrl(generatedUrls, url);
        // 也检查 b64_json
        String b64 = text(item, "b64_json");
        if (!b64.isBlank() && url.isBlank()) {
          addUrl(generatedUrls, "data:image/png;base64," + b64);
        }
      }
    }

    if (generatedUrls.isEmpty()) {
      throw new ApiException(502, "Agnes did not return image URLs: " + compact(root.toString()));
    }

    // Agnes 同步返回结果，构造一个已完成的 task ref
    String agnesTaskId = AGNES_TASK_PREFIX + java.util.UUID.randomUUID().toString().replace("-", "");

    // Agnes 返回的 URL 是临时 CDN 链接（platform-outputs.agnes-ai.space），
    // 需要转存到自己的 OSS，否则下载慢且可能过期
    System.out.println("[agnes] persisting " + generatedUrls.size() + " image(s) to OSS...");
    List<String> persistedUrls = persistImageUrls(agnesTaskId, generatedUrls);
    // 用转存后的 URL 替换原始 URL
    generatedUrls = persistedUrls;
    System.out.println("[agnes] persisted to OSS: " + generatedUrls);

    // 缓存结果，这样 getTask 时可以直接返回
    agnesResultCache.put(agnesTaskId, new AgnesCachedResult(generatedUrls, root));

    List<ImageGenerationDtos.TaskRef> tasks = List.of(
        new ImageGenerationDtos.TaskRef(agnesTaskId, "completed"));

    return new ImageGenerationDtos.CreateTaskResponse(
        PROVIDER_ANNES,
        request.model(),
        resolvedModel,
        agnesSize + " " + agnesRatio,
        resolution,
        count,
        tasks,
        root);
  }

  /** Agnes 结果缓存（同步 API 返回后需要缓存给 getTask 查询） */
  private final Map<String, AgnesCachedResult> agnesResultCache = new ConcurrentHashMap<>();

  private record AgnesCachedResult(List<String> imageUrls, JsonNode raw) {}

  /** Agnes HTTP POST：Bearer token 用 agnes-api-key */
  private JsonNode sendAgnesPost(String endpoint, Map<String, Object> body) throws Exception {
    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(endpoint))
        .timeout(Duration.ofSeconds(Math.max(30, properties.getTimeoutSeconds())))
        .header("Authorization", "Bearer " + properties.getAgnesApiKey())
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
        .build();
    return send(request, "Agnes");
  }

  /** 上传参考图到 OSS：1) 获取签名 2) PUT 上传 */
  private Map<String, String> uploadReferenceImage(String imageUrl) throws Exception {
    // 1. 下载参考图
    DownloadedImage image = downloadImage("ref", 0, imageUrl);

    // 2. 获取 OSS 直传签名
    Map<String, Object> signBody = new LinkedHashMap<>();
    signBody.put("fileName", image.filename());
    signBody.put("contentType", image.contentType());
    signBody.put("size", image.bytes().length);

    JsonNode signResult = sendProxyPost(
        properties.normalizedProxyBaseUrl() + properties.normalizedOssSignPath(), signBody);
    String uploadUrl = text(signResult, "upload_url");
    String objectName = firstNonBlank(text(signResult, "object_name"), text(signResult, "objectName"));
    // 中转站签名：url 是签名 URL（会过期），public_url 才是永久 URL
    // 传给 image_objects 的 url 必须用永久 URL，否则代理处理时图片已失效
    String publicUrl = firstNonBlank(text(signResult, "public_url"), text(signResult, "url"));
    String contentType = text(signResult.path("headers"), "Content-Type");
    if (contentType.isBlank()) contentType = image.contentType();

    if (uploadUrl.isBlank()) {
      throw new ApiException(502, "Proxy OSS sign did not return upload_url");
    }

    // 3. PUT 上传到 OSS
    HttpRequest putRequest = HttpRequest.newBuilder()
        .uri(URI.create(uploadUrl))
        .timeout(Duration.ofSeconds(Math.max(10, properties.getUploadTimeoutSeconds())))
        .header("Content-Type", contentType)
        .PUT(HttpRequest.BodyPublishers.ofByteArray(image.bytes()))
        .build();
    HttpResponse<String> putResponse = httpClient.send(putRequest, HttpResponse.BodyHandlers.ofString());
    if (putResponse.statusCode() < 200 || putResponse.statusCode() >= 300) {
      throw new ApiException(502, "OSS PUT upload failed: " + putResponse.statusCode());
    }

    // 返回 image_objects 需要的字段：objectName、contentType、url（签名 URL）
    Map<String, String> result = new LinkedHashMap<>();
    result.put("objectName", objectName);
    result.put("contentType", contentType);
    if (!publicUrl.isBlank()) {
      result.put("url", publicUrl);
    }
    return result;
  }

  private ImageGenerationDtos.CreateTaskResponse createGetTokenTask(ImageGenerationDtos.CreateTaskRequest request)
      throws Exception {
    String resolvedModel = properties.resolveModel(request.model());
    // gemini-3-pro → banana_pro，其余 gemini-3.* → banana2
    // GetToken 中转站路径：/banana2/text-to-image 和 /banana_pro/text-to-image
    String getTokenModel;
    if (resolvedModel != null && resolvedModel.toLowerCase().contains("pro")) {
      getTokenModel = "banana_pro";
    } else {
      getTokenModel = "banana2";
    }
    String size = properties.normalizeSize(request.size(), request.ratio());
    String resolution = properties.normalizeResolution(resolvedModel, request.resolution());
    int count = request.requestedCount();
    String endpoint = properties.normalizedGetTokenBaseUrl() + getTokenGenerationPath(getTokenModel, request.normalizedImageUrls());

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

    registerFailoverState(tasks.get(0).taskId(), request, PROVIDER_GETTOKEN);
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

    // ===== 故障转移检测（透明切换，对调用方完全无感）=====
    FailoverState state = failoverStates.get(cleanTaskId);
    if (state != null && !PROVIDER_ANNES.equals(state.primaryProvider)) {
      long elapsed = System.currentTimeMillis() - state.createdAt;
      boolean timeout = elapsed > PROVIDER_TIMEOUT_MS;

      // 1) 超时即触发切换（无需先查询主任务，避免无谓等待）
      if (!state.failoverTriggered && timeout) {
        triggerBackup(state, "timeout");
      }

      // 2) 已触发且备份任务已创建：直接返回备份任务状态（taskId 仍用原始值，前端无感知）
      if (state.failoverTriggered && state.backupTaskId != null) {
        if (!state.failoverLogged) {
          state.failoverLogged = true;
          System.out.println("[image-failover] " + new java.util.Date()
              + " | reason=provider_" + state.failoverReason + "(" + (elapsed / 1000) + "s)"
              + " | from=" + state.primaryProvider
              + " | to=" + state.backupProvider
              + " | originalTaskId=" + cleanTaskId
              + " | backupTaskId=" + state.backupTaskId);
        }
        ImageGenerationDtos.TaskStatusResponse backupResp = getTaskInternal(state.backupTaskId);
        if (isTerminalStatus(backupResp.status())) {
          failoverStates.remove(cleanTaskId); // 备份已终态，清理防内存泄漏
        }
        return new ImageGenerationDtos.TaskStatusResponse(
            backupResp.provider(),
            cleanTaskId, // 保持原始 taskId，前端不知道发生了切换
            backupResp.status(),
            backupResp.progress(),
            backupResp.imageUrls(),
            backupResp.error(),
            backupResp.raw());
      }
    }
    // ===== 故障转移检测结束 =====

    // 查询主任务状态（纯查询，不含故障转移逻辑，不会递归进入上面分支）。
    // 用 try/catch 包住：GetToken 轮询返回 HTTP 500/599 时，send() 会抛 ApiException
    // 而非把错误放入 error 字段；这里捕获异常并兜底到 proxy，避免把异常原样甩给用户。
    ImageGenerationDtos.TaskStatusResponse primaryResp;
    try {
      primaryResp = getTaskInternal(cleanTaskId);
    } catch (Exception pollError) {
      // 轮询主任务抛异常（如 GetToken 中转站 500/599）：满足前置条件则触发故障转移兜底
      if (state != null && !PROVIDER_ANNES.equals(state.primaryProvider) && !state.failoverTriggered) {
        System.out.println("[image-failover] poll exception, triggering backup: " + pollError.getMessage());
        ImageGenerationDtos.TaskStatusResponse backupResp = pollBackupIfTriggered(cleanTaskId, state);
        if (backupResp != null) {
          return backupResp;
        }
      }
      // 无可用备份（state 为 null / 已触发过 / 备份创建失败）：保持原行为，继续抛出原异常
      throw pollError;
    }

    // 3) 轮询中发现主任务返回失败/错误：同样触发切换（需求 2）
    if (state != null && !PROVIDER_ANNES.equals(state.primaryProvider) && !state.failoverTriggered) {
      if (isTerminalErrorStatus(primaryResp.status(), primaryResp.error())) {
        ImageGenerationDtos.TaskStatusResponse backupResp = pollBackupIfTriggered(cleanTaskId, state);
        if (backupResp != null) {
          return backupResp;
        }
        // 兜底未成功（无可用备份链 / 备份创建失败）：继续返回主任务原始错误响应
      }
    }

    // 主任务已终态（完成或最终失败）：清理追踪状态，防止内存泄漏
    if (state != null && isTerminalStatus(primaryResp.status())) {
      failoverStates.remove(cleanTaskId);
    }
    return primaryResp;
  }

  /**
   * 触发故障转移到备份中转站（如 gettoken → proxy），并立即轮询备份任务状态，
   * 以原始 taskId 透传构造返回（对调用方完全无感）。
   * 仅在「存在可用备份链且尚未触发过」时生效；否则返回 null（由调用方自行处理）。
   */
  private ImageGenerationDtos.TaskStatusResponse pollBackupIfTriggered(String cleanTaskId, FailoverState state)
      throws Exception {
    if (state == null || PROVIDER_ANNES.equals(state.primaryProvider) || state.failoverTriggered) {
      return null;
    }
    triggerBackup(state, "error");
    if (state.failoverTriggered && state.backupTaskId != null) {
      if (!state.failoverLogged) {
        state.failoverLogged = true;
        System.out.println("[image-failover] " + new java.util.Date()
            + " | reason=provider_" + state.failoverReason
            + " | from=" + state.primaryProvider
            + " | to=" + state.backupProvider
            + " | originalTaskId=" + cleanTaskId
            + " | backupTaskId=" + state.backupTaskId);
      }
      ImageGenerationDtos.TaskStatusResponse backupResp = getTaskInternal(state.backupTaskId);
      if (isTerminalStatus(backupResp.status())) {
        failoverStates.remove(cleanTaskId); // 备份已终态，清理防内存泄漏
      }
      return new ImageGenerationDtos.TaskStatusResponse(
          backupResp.provider(),
          cleanTaskId, // 保持原始 taskId，前端不知道发生了切换
          backupResp.status(),
          backupResp.progress(),
          backupResp.imageUrls(),
          backupResp.error(),
          backupResp.raw());
    }
    return null;
  }

  /** 纯查询（不含故障转移逻辑）：根据 taskId 前缀分发到各 provider 查询实现 */
  private ImageGenerationDtos.TaskStatusResponse getTaskInternal(String taskId) throws Exception {
    String cleanTaskId = taskId.trim();
    // Agnes 同步任务：从缓存直接返回
    if (cleanTaskId.startsWith(AGNES_TASK_PREFIX)) {
      return getAgnesTask(cleanTaskId);
    }
    // 优先判断中转站代理任务
    if (cleanTaskId.startsWith(PROXY_TASK_PREFIX)) {
      return getProxyTask(cleanTaskId.substring(PROXY_TASK_PREFIX.length()));
    }
    if (cleanTaskId.startsWith(GETTOKEN_TASK_PREFIX)) {
      return getGetTokenTask(cleanTaskId.substring(GETTOKEN_TASK_PREFIX.length()));
    }
    // APIMart 直连任务
    if (cleanTaskId.startsWith(APIMART_DIRECT_TASK_PREFIX)) {
      return getApimartDirectTask(cleanTaskId.substring(APIMART_DIRECT_TASK_PREFIX.length()));
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
    boolean hasImages = !imageUrls.isEmpty();
    boolean done = isDoneStatus(status) || (hasImages && progress != null && progress >= 100);
    if (done && hasImages) {
      // 不在轮询内同步转存（避免 60s 阻塞 + 前端二次转存）。
      // 立即返回中转站临时 URL，异步触发持久化，状态由 DB 持久化状态决定。
      PollResult pr = decidePollResponse(cleanTaskId, imageUrls);
      imageUrls = pr.imageUrls();
      status = pr.status();
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

  /** 中转站代理任务轮询：GET /api/images/jobs/{job_id} */
  private ImageGenerationDtos.TaskStatusResponse getProxyTask(String jobId) throws Exception {
    if (!properties.isProxyConfigured()) {
      throw new ApiException(400, "Proxy image api key is not configured");
    }
    String cleanJobId = jobId == null ? "" : jobId.trim();
    if (cleanJobId.isBlank()) throw new ApiException(400, "jobId is required");

    String endpoint = properties.normalizedProxyBaseUrl()
        + properties.normalizedProxyTaskPath()
        + "/" + encode(cleanJobId);

    JsonNode root = sendProxyGet(endpoint);
    String status = firstNonBlank(text(root, "status"), "unknown");
    String error = firstNonBlank(
        text(root.path("error"), "message"),
        text(root, "message"));

    // 中转站结果在 result.images[].url / result.images[].public_url
    // 关键：images[].url 是 OSS 签名 URL（带 Expires，默认 15 分钟过期）
    //       images[].public_url 才是 OSS 公共 URL（永久有效），必须优先用它
    List<String> imageUrls = new ArrayList<>();
    JsonNode result = root.path("result");
    JsonNode images = result.path("images");
    if (images.isArray()) {
      for (JsonNode img : images) {
        String url = firstNonBlank(
            text(img, "public_url"),  // 永久公共 URL（首选）
            text(img, "url"));        // 签名 URL 兜底（会过期）
        if (!url.isBlank()) addUrl(imageUrls, url);
      }
    }
    // 也尝试通用提取
    if (imageUrls.isEmpty()) {
      collectImageUrls(result, imageUrls);
    }

    // 中转站已自动上传 OSS，不需要 persistImageUrls

    return new ImageGenerationDtos.TaskStatusResponse(
        PROVIDER_PROXY,
        PROXY_TASK_PREFIX + cleanJobId,
        status,
        null,
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
    boolean hasImages = !imageUrls.isEmpty();
    boolean done = isDoneStatus(status) || (hasImages && progress != null && progress >= 100);
    if (done && hasImages) {
      PollResult pr = decidePollResponse(GETTOKEN_TASK_PREFIX + cleanTaskId, imageUrls);
      imageUrls = pr.imageUrls();
      status = pr.status();
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

  /** APIMart 直连任务轮询：GET /v1/tasks/{task_id} */
  private ImageGenerationDtos.TaskStatusResponse getApimartDirectTask(String taskId) throws Exception {
    if (!properties.isApimartDirectConfigured()) {
      throw new ApiException(400, "APIMart direct api key is not configured");
    }
    String cleanTaskId = taskId == null ? "" : taskId.trim();
    if (cleanTaskId.isBlank()) throw new ApiException(400, "taskId is required");

    String endpoint = properties.normalizedApimartDirectBaseUrl()
        + properties.normalizedApimartDirectTaskPath() + "/" + encode(cleanTaskId);
    if (properties.getLanguage() != null && !properties.getLanguage().isBlank()) {
      endpoint += "?language=" + encode(properties.getLanguage());
    }

    JsonNode root = sendApimartDirectGet(endpoint);
    JsonNode data = firstDataNode(root);
    String status = firstNonBlank(text(data, "status"), "unknown");
    Integer progress = intValue(data, "progress");
    String error = firstNonBlank(
        text(data.path("error"), "message"),
        text(data, "error"),
        text(data, "message"));
    List<String> imageUrls = new ArrayList<>();
    collectImageUrls(data.path("result"), imageUrls);
    collectImageUrls(data, imageUrls);

    System.out.println("[apimart-direct-poll] taskId=" + cleanTaskId + " status=" + status
        + " progress=" + progress + " imageUrls=" + imageUrls.size()
        + " dataKeys=" + (data.isObject() ? iteratorToList(data.fieldNames()) : "not-object")
        + " rawSnippet=" + compact(root.toString()).substring(0, Math.min(200, compact(root.toString()).length())));

    // 有图就当作完成——aiuxu.com 状态词不统一，不应因为状态词不认识而卡住
    boolean hasImages = !imageUrls.isEmpty();
    boolean done = isDoneStatus(status) || (hasImages && progress != null && progress >= 100);
    if (done && hasImages) {
      PollResult pr = decidePollResponse(APIMART_DIRECT_TASK_PREFIX + cleanTaskId, imageUrls);
      imageUrls = pr.imageUrls();
      status = pr.status();
    }

    return new ImageGenerationDtos.TaskStatusResponse(
        "apimart-direct",
        APIMART_DIRECT_TASK_PREFIX + cleanTaskId,
        status.isBlank() ? "unknown" : status,
        progress,
        imageUrls,
        error.isBlank() ? null : error,
        root);
  }

  /** Agnes 同步任务查询：直接从缓存返回已完成结果 */
  private ImageGenerationDtos.TaskStatusResponse getAgnesTask(String agnesTaskId) {
    AgnesCachedResult cached = agnesResultCache.get(agnesTaskId);
    if (cached == null) {
      return new ImageGenerationDtos.TaskStatusResponse(
          PROVIDER_ANNES,
          agnesTaskId,
          "failed",
          null,
          List.of(),
          "Agnes task result expired or not found",
          null);
    }
    return new ImageGenerationDtos.TaskStatusResponse(
        PROVIDER_ANNES,
        agnesTaskId,
        "completed",
        100,
        cached.imageUrls(),
        null,
        cached.raw());
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

  private JsonNode sendProxyPost(String endpoint, Map<String, Object> body) throws Exception {
    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(endpoint))
        .timeout(Duration.ofSeconds(Math.max(5, properties.getTimeoutSeconds())))
        .header("Authorization", "Bearer " + properties.getProxyApiKey())
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
        .build();
    return send(request, "Proxy");
  }

  private JsonNode sendProxyGet(String endpoint) throws Exception {
    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(endpoint))
        .timeout(Duration.ofSeconds(Math.max(5, properties.getTimeoutSeconds())))
        .header("Authorization", "Bearer " + properties.getProxyApiKey())
        .GET()
        .build();
    return send(request, "Proxy");
  }

  private JsonNode sendApimartDirectPost(String endpoint, Map<String, Object> body) throws Exception {
    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(endpoint))
        .timeout(Duration.ofSeconds(Math.max(5, properties.getTimeoutSeconds())))
        .header("Authorization", "Bearer " + properties.getApimartDirectApiKey())
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
        .build();
    return send(request, "APIMart-direct");
  }

  private JsonNode sendApimartDirectGet(String endpoint) throws Exception {
    // aiuxu.com / apib.ai 在 keep-alive 连接被服务端关闭后，Java HttpClient 仍会复用
    // 已关闭的连接导致 GET 永久挂起。这里改用 Java 老 API HttpURLConnection（不共享任何连接池）。
    // 关键：加上时间戳防代理缓存 + 禁用缓存头，避免代理(127.0.0.1:7897)返回旧数据
    String separator = endpoint.contains("?") ? "&" : "?";
    String noCacheEndpoint = endpoint + separator + "_t=" + System.currentTimeMillis();
    java.net.URL url = new java.net.URL(noCacheEndpoint);
    java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
    try {
      conn.setRequestMethod("GET");
      conn.setRequestProperty("Authorization", "Bearer " + properties.getApimartDirectApiKey());
      conn.setRequestProperty("User-Agent", BROWSER_USER_AGENT);
      conn.setRequestProperty("Connection", "close");
      conn.setRequestProperty("Cache-Control", "no-cache, no-store, must-revalidate");
      conn.setRequestProperty("Pragma", "no-cache");
      conn.setConnectTimeout((int) Duration.ofSeconds(Math.max(3, properties.getTimeoutSeconds())).toMillis());
      conn.setReadTimeout((int) Duration.ofSeconds(Math.max(5, properties.getTimeoutSeconds())).toMillis());
      conn.setUseCaches(false);
      int status = conn.getResponseCode();
      java.io.InputStream is = (status >= 200 && status < 300) ? conn.getInputStream() : conn.getErrorStream();
      if (is == null) {
        throw new ApiException(502, "APIMart-direct returned empty body: " + status);
      }
      byte[] bytes;
      try (java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream()) {
        byte[] buf = new byte[8192];
        int n;
        while ((n = is.read(buf)) > 0) {
          baos.write(buf, 0, n);
        }
        bytes = baos.toByteArray();
      }
      String body = new String(bytes, StandardCharsets.UTF_8);
      if (status < 200 || status >= 300) {
        throw new ApiException(502, "APIMart-direct request failed: " + status + " " + compact(body));
      }
      return parseBody(body);
    } catch (java.net.SocketTimeoutException e) {
      throw new ApiException(504, "APIMart-direct request timed out: " + e.getMessage());
    } catch (javax.net.ssl.SSLException e) {
      throw new ApiException(502, "APIMart-direct SSL/HTTP error: " + e.getMessage());
    } catch (java.io.IOException e) {
      String msg = e.getMessage();
      if (msg != null && msg.contains("header parser received no bytes")) {
        throw new ApiException(502, "APIMart-direct received empty response (server may be rate-limiting). Try again in a moment.");
      }
      throw new ApiException(502, "APIMart-direct IO error: " + msg);
    } finally {
      conn.disconnect();
    }
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
    // 外部中转站 keep-alive 行为不规范，服务端关闭空闲连接后 HttpClient 可能复用已关闭的连接
    // 首次失败后重试一次（重建连接），常见于 "header parser received no bytes" 错误
    Exception lastError = null;
    for (int attempt = 0; attempt < 2; attempt++) {
      try {
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        JsonNode root = parseBody(response.body());
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
          String body = compact(response.body());
          if (response.statusCode() == 400 && body != null
              && body.toLowerCase().contains("prompt length")
              && (body.toLowerCase().contains("must less than")
                  || body.toLowerCase().contains("exceed")
                  || body.toLowerCase().contains("too long")
                  || body.toLowerCase().contains("maximum input length"))) {
            // 尝试提取实际长度与上限
            java.util.regex.Pattern p = java.util.regex.Pattern.compile(
                "(?i)prompt length\\s*(\\d+)[^\\d]*?(\\d+)");
            java.util.regex.Matcher m = p.matcher(body);
            String detail = "";
            if (m.find()) {
              detail = "（约 " + m.group(1) + " 字，模型上限约 " + m.group(2) + " 字）";
            }
            throw new ApiException(413, "提示词过长" + detail + "，请精简描述或拆分为多次生成后重试。");
          }
          throw new ApiException(502, providerLabel + " request failed: " + response.statusCode() + " " + body);
        }
        return root;
      } catch (java.net.http.HttpTimeoutException e) {
        if (attempt == 0) { lastError = e; continue; }
        throw new ApiException(504, providerLabel + " request timed out: " + e.getMessage());
      } catch (javax.net.ssl.SSLException e) {
        throw new ApiException(502, providerLabel + " SSL/HTTP error (server closed connection): " + e.getMessage());
      } catch (java.io.IOException e) {
        String msg = e.getMessage();
        if (msg != null && msg.contains("header parser received no bytes")) {
          if (attempt == 0) { lastError = e; continue; }
          throw new ApiException(502, providerLabel + " received empty response (server may be rate-limiting or temporarily unavailable). Try again in a moment.");
        }
        throw new ApiException(502, providerLabel + " IO error: " + msg);
      }
    }
    throw new ApiException(502, providerLabel + " request failed after retry: " + (lastError != null ? lastError.getMessage() : "unknown"));
  }

  private String getTokenGenerationPath(String getTokenModel, List<String> imageUrls) {
    boolean imageToImage = imageUrls != null && !imageUrls.isEmpty();
    return "/" + getTokenModel + (imageToImage ? "/image-to-image" : "/text-to-image");
  }

  private String normalizeGetTokenResolution(String resolution) {
    if (resolution == null || resolution.isBlank()) return "";
    return resolution.trim().toLowerCase();
  }

  // ===== 异步持久化（生图结果落自有 OSS，真源在后端、落库，与前端刷新无关） =====
  // 轮询内【不再】同步转存（避免 60s 阻塞 + 前端二次转存）。
  // done 时立即返回中转站临时 URL，异步触发持久化并把永久 URL 写回 ym_image_task；
  // 轮询返回状态由 DB 持久化状态（persist_status）决定。

  /** 持久化状态：PENDING / DONE / FAILED（null 视为 PENDING） */
  private record PersistState(String status, String resultUrls) {}

  /** 轮询返回决策结果 */
  private record PollResult(List<String> imageUrls, String status) {}

  /**
   * 根据 DB 持久化状态决定本轮轮询返回给前端的 imageUrls 与 status：
   * - DONE   → 返回永久 OSS URL，status=completed（前端停止轮询并插入）
   * - FAILED → 返回中转站临时 URL 兜底，status=completed
   * - PENDING/未知 → 触发异步持久化，返回中转站临时 URL，status=persisting（前端继续轮询）
   */
  private PollResult decidePollResponse(String dbTaskId, List<String> temporaryUrls) {
    PersistState state = getPersistState(dbTaskId);
    String status = state.status() == null ? "PENDING" : state.status().toUpperCase();
    if ("DONE".equals(status)) {
      List<String> permanent = parseResultUrls(state.resultUrls());
      if (permanent != null && !permanent.isEmpty()) {
        return new PollResult(permanent, "completed");
      }
      // DONE 但无可用永久 URL：降级返回临时 URL
      return new PollResult(new ArrayList<>(temporaryUrls), "completed");
    }
    if ("FAILED".equals(status)) {
      // 持久化失败，返回中转站临时 URL 兜底（仍可能过期，但至少先出图）
      return new PollResult(new ArrayList<>(temporaryUrls), "completed");
    }
    // PENDING / 未知：触发异步持久化（幂等），继续轮询
    triggerAsyncPersist(dbTaskId, temporaryUrls);
    return new PollResult(new ArrayList<>(temporaryUrls), "persisting");
  }

  /** 触发异步持久化：提交到专用线程池执行，避免轮询请求内同步阻塞与循环依赖 */
  private void triggerAsyncPersist(String dbTaskId, List<String> temporaryUrls) {
    try {
      List<String> urls = new ArrayList<>(temporaryUrls);
      persistExecutor.execute(() -> runPersistTask(dbTaskId, urls));
    } catch (Exception e) {
      System.out.println("[image-persist] trigger async persist failed for task=" + dbTaskId
          + ": " + e.getMessage());
    }
  }

  /** 读取 ym_image_task 的持久化状态（异常安全，默认 PENDING） */
  private PersistState getPersistState(String taskId) {
    if (jdbcTemplate == null) return new PersistState("PENDING", null);
    try {
      List<PersistState> rows = jdbcTemplate.query(
          "SELECT persist_status, result_urls FROM ym_image_task WHERE task_id = ?",
          (rs, rn) -> new PersistState(rs.getString("persist_status"), rs.getString("result_urls")),
          taskId);
      if (rows.isEmpty()) return new PersistState("PENDING", null);
      PersistState s = rows.get(0);
      return new PersistState(s.status() == null ? "PENDING" : s.status(), s.resultUrls());
    } catch (Exception e) {
      return new PersistState("PENDING", null);
    }
  }

  /** 将 result_urls(JSON 数组字符串) 解析为 URL 列表 */
  private List<String> parseResultUrls(String json) {
    if (json == null || json.isBlank()) return null;
    try {
      JsonNode node = objectMapper.readTree(json);
      if (node.isArray()) {
        List<String> urls = new ArrayList<>();
        for (JsonNode item : node) {
          String u = item.isTextual() ? item.asText() : item.asText("");
          if (u != null && !u.isBlank()) urls.add(u);
        }
        return urls.isEmpty() ? null : urls;
      }
      if (node.isTextual() && !node.asText().isBlank()) return List.of(node.asText());
    } catch (Exception e) {
      System.out.println("[image-persist] parse result_urls failed: " + e.getMessage());
    }
    return null;
  }

  /**
   * 异步持久化任务体：下载中转站临时图 + 上传自有 OSS，结果写回 ym_image_task。
   * 由 persistExecutor 线程池执行；幂等：内存标记 + DB 状态二次确认，避免并发轮询双传。
   */
  private void runPersistTask(String taskId, List<String> temporaryUrls) {
    if (jdbcTemplate == null) return;
    // 并发幂等：已在处理中则跳过
    if (persistingTaskIds.putIfAbsent(taskId, Boolean.TRUE) != null) {
      return;
    }
    try {
      // 二次确认：DB 若已是 DONE 直接跳过（重启/重复触发保护）
      PersistState existing = getPersistState(taskId);
      if ("DONE".equalsIgnoreCase(existing.status())) {
        return;
      }
      // 下载 + 上传（逻辑与原 persistImageUrls 一致）
      List<String> persisted = persistImageUrls(taskId, temporaryUrls);
      String resultJson = objectMapper.writeValueAsString(persisted);
      jdbcTemplate.update(
          "UPDATE ym_image_task SET result_urls = ?, persist_status = 'DONE' WHERE task_id = ?",
          resultJson, taskId);
      System.out.println("[image-persist-async] persisted " + persisted.size()
          + " image(s) for task=" + taskId);
    } catch (Exception e) {
      System.out.println("[image-persist-async] persist failed for task=" + taskId
          + ": " + e.getMessage());
      try {
        jdbcTemplate.update(
            "UPDATE ym_image_task SET persist_status = 'FAILED' WHERE task_id = ? AND persist_status <> 'DONE'",
            taskId);
      } catch (Exception ignore) {
        // 忽略写入失败
      }
    } finally {
      persistingTaskIds.remove(taskId);
    }
  }

  private List<String> persistImageUrls(String taskId, List<String> imageUrls) throws Exception {
    if (!properties.isPersistGeneratedImages()) return imageUrls;
    boolean canUploadDirectly = ossStorageService != null && ossStorageService.isConfigured();
    if (!canUploadDirectly && (properties.getUploadEndpoint() == null || properties.getUploadEndpoint().isBlank())) {
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
    if (ossStorageService != null && ossStorageService.isConfigured()) {
      String objectName = generatedObjectName(taskId, index, image);
      try (ByteArrayInputStream inputStream = new ByteArrayInputStream(image.bytes())) {
        ossStorageService.uploadStream(inputStream, objectName, image.contentType());
      }
      String storedUrl = ossStorageService.getFileUrl(objectName);
      System.out.println("[image-persist] stored generated image to OSS: " + storedUrl);
      return storedUrl;
    }

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

  private String generatedObjectName(String taskId, int index, DownloadedImage image) {
    String filename = image.filename() == null || image.filename().isBlank()
        ? "generated-" + index + "." + extensionFor(image.contentType())
        : image.filename().replaceAll("[^A-Za-z0-9._-]", "_");
    if (filename.length() > 120) {
      filename = filename.substring(filename.length() - 120);
    }
    String safeTaskId = taskId == null ? "task" : taskId.replaceAll("[^A-Za-z0-9._-]", "_");
    if (safeTaskId.length() > 80) {
      safeTaskId = safeTaskId.substring(safeTaskId.length() - 80);
    }
    return java.time.LocalDate.now()
        + "/ai-" + System.currentTimeMillis()
        + "-" + safeTaskId
        + "-" + index
        + "-" + filename;
  }

  private DownloadedImage downloadImage(String taskId, int index, String imageUrl) throws Exception {
    if (imageUrl == null || imageUrl.isBlank()) {
      throw new ApiException(502, "Generated image URL is empty");
    }
    // Use HttpURLConnection instead of HttpClient to avoid HTTP/1.1 keep-alive
    // connection pool pollution (same issue as APIMart polling). External CDN
    // servers may close idle connections without RST, causing partial downloads.
    java.net.HttpURLConnection conn = null;
    try {
      java.net.URL url = new java.net.URL(imageUrl.trim());
      conn = (java.net.HttpURLConnection) url.openConnection();
      conn.setConnectTimeout((int) Duration.ofSeconds(10).toMillis());
      conn.setReadTimeout((int) Duration.ofSeconds(Math.max(30, properties.getTimeoutSeconds())).toMillis());
      conn.setRequestProperty("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8");
      conn.setRequestProperty("User-Agent", BROWSER_USER_AGENT);
      conn.setRequestProperty("Connection", "close");
      conn.setUseCaches(false);
      conn.setInstanceFollowRedirects(true);

      int statusCode = conn.getResponseCode();
      if (statusCode < 200 || statusCode >= 300) {
        throw new ApiException(502, "Generated image download failed: HTTP " + statusCode);
      }

      // Read full response body
      byte[] bytes;
      try (java.io.InputStream in = conn.getInputStream();
           ByteArrayOutputStream out = new ByteArrayOutputStream()) {
        byte[] buffer = new byte[8192];
        int bytesRead;
        while ((bytesRead = in.read(buffer)) != -1) {
          out.write(buffer, 0, bytesRead);
        }
        bytes = out.toByteArray();
      }

      if (bytes == null || bytes.length == 0) {
        throw new ApiException(502, "Generated image download returned empty file");
      }

      String contentType = conn.getContentType();
      if (contentType != null) {
        contentType = contentType.split(";", 2)[0].trim();
      }
      if (contentType == null || contentType.isBlank()) {
        contentType = "image/jpeg";
      }
      return new DownloadedImage(bytes, contentType, imageFileName(taskId, index, imageUrl, contentType));
    } catch (ApiException e) {
      throw e;
    } catch (Exception exception) {
      throw new ApiException(502, "Generated image download request failed: " + exception.getMessage());
    } finally {
      if (conn != null) {
        conn.disconnect();
      }
    }
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

  /**
   * 故障转移内部追踪状态：记录主任务的创建时间、原始请求与主中转站，
   * 用于超时/错误后「透明」切换到备用中转站（重新发起原始请求）。
   */
  private static final class FailoverState {
    final long createdAt;                                     // 主任务创建时间 (System.currentTimeMillis())
    final ImageGenerationDtos.CreateTaskRequest originalRequest; // 原始请求（用于重试备份）
    final String primaryProvider;                             // 主中转站名称
    String backupProvider = null;                             // 备用中转站
    String backupTaskId = null;                               // 备份任务 taskId（懒创建）
    boolean failoverTriggered = false;                        // 是否已触发切换
    boolean failoverLogged = false;                           // 切换日志是否已打印
    String failoverReason = "timeout";                        // 触发原因：timeout / error

    FailoverState(long createdAt, ImageGenerationDtos.CreateTaskRequest originalRequest, String primaryProvider) {
      this.createdAt = createdAt;
      this.originalRequest = originalRequest;
      this.primaryProvider = primaryProvider;
    }
  }

  /** 根据主 provider 与解析后的模型决定备用 provider；无可用备用链时返回 null */
  private String determineBackupProvider(String primaryProvider, String resolvedModel) {
    List<String> providers = determineBackupProviders(primaryProvider, resolvedModel);
    return providers.isEmpty() ? null : providers.get(0);
  }

  private List<String> determineBackupProviders(String primaryProvider, String resolvedModel) {
    if (!properties.isFallbackEnabled()) {
      return List.of();
    }
    if ("apimart-direct".equals(primaryProvider) || PROVIDER_APIMART.equals(primaryProvider)) {
      return isProxyConfigured() ? List.of(PROVIDER_PROXY) : List.of();
    }
    if (PROVIDER_GETTOKEN.equals(primaryProvider)) {
      return isProxyConfigured() ? List.of(PROVIDER_PROXY) : List.of();
    }
    return List.of(); // agnes / proxy have no backup provider.
  }

  /** 按需创建备份任务（懒创建），将返回的 taskId 写入 state.backupTaskId */
  private void createBackupTask(FailoverState state) throws Exception {
    ImageGenerationDtos.CreateTaskResponse response;
    if (PROVIDER_PROXY.equals(state.backupProvider)) {
      response = createProxyTask(state.originalRequest);
    } else if (PROVIDER_GETTOKEN.equals(state.backupProvider)) {
      response = createGetTokenTask(state.originalRequest);
    } else {
      throw new IllegalStateException("未知的备用中转站: " + state.backupProvider);
    }
    if (response.tasks() == null || response.tasks().isEmpty()) {
      throw new ApiException(502, "备用中转站未返回任务");
    }
    String backupTaskId = response.tasks().get(0).taskId();
    state.backupTaskId = backupTaskId;
    String model = state.originalRequest == null ? "unknown"
        : properties.resolveModel(state.originalRequest.model());
    System.out.println("[image-failover] " + new java.util.Date()
        + " | reason=" + state.failoverReason
        + " | from=" + state.primaryProvider
        + " | to=" + state.backupProvider
        + " | model=" + model
        + " | backupTaskId=" + backupTaskId);
  }

  /** 触发故障转移：计算备用 provider 并创建备份任务；失败则重置以便下次轮询重试 */
  private void triggerBackup(FailoverState state, String reason) {
    List<String> backups = determineBackupProviders(
        state.primaryProvider, properties.resolveModel(state.originalRequest.model()));
    if (backups.isEmpty()) return;
    state.failoverReason = reason;
    for (String backup : backups) {
      state.backupProvider = backup;
      try {
        createBackupTask(state);
        state.failoverTriggered = true;
        return;
      } catch (Exception e) {
        System.out.println("[image-failover] backup task create failed"
            + " | to=" + backup
            + " | reason=" + reason
            + " | error=" + e.getMessage());
        state.backupTaskId = null;
      }
    }
    state.backupProvider = null;
    state.failoverReason = "timeout"; // Reset so the next poll can retry the chain.
  }

  /**
   * 注册故障转移追踪状态。仅对「存在可用备用链」的异步 provider 注册，
   * 避免 proxy / agnes（无备用或同步）任务在 map 中泄漏。
   */
  private void registerFailoverState(
      String taskId, ImageGenerationDtos.CreateTaskRequest request, String provider) {
    if (taskId == null || taskId.isBlank()) return;
    if (PROVIDER_PROXY.equals(provider) || PROVIDER_ANNES.equals(provider)) return;
    String backup = determineBackupProvider(provider, properties.resolveModel(request.model()));
    if (backup == null) return; // 无可用备用链，无需追踪
    failoverStates.put(taskId, new FailoverState(System.currentTimeMillis(), request, provider));
  }

  /** 是否为终态（完成或失败）：用于清理追踪状态，防止内存泄漏 */
  private boolean isTerminalStatus(String status) {
    return isDoneStatus(status) || isTerminalErrorStatus(status, null);
  }

  /** 主任务是否返回失败/错误（含 error 字段），用于提前触发切换 */
  private boolean isTerminalErrorStatus(String status, String error) {
    if (error != null && !error.isBlank()) return true;
    if (status == null) return false;
    String s = status.trim().toLowerCase();
    return s.equals("failed") || s.equals("error") || s.equals("cancelled")
        || s.equals("canceled") || s.equals("expired") || s.equals("aborted")
        || s.contains("error") || s.contains("fail");
  }

  private boolean isDoneStatus(String status) {
    if (status == null) return false;
    String normalized = status.trim().toLowerCase();
    return normalized.equals("completed")
        || normalized.equals("succeeded")
        || normalized.equals("success")
        || normalized.equals("done")
        || normalized.equals("finished")
        || normalized.equals("generated")
        || normalized.equals("ready");
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

  private String proxyModel;  // 当前请求的代理模型，供内部判断

  /**
   * gpt-image-2 灵活尺寸计算：
   * 官方规则：
   *   - 任意 WxH，宽高都必须被 16 整除
   *   - 长宽比 1:3 ~ 3:1
   *   - 最大 3840x2160；>2560x1440 为实验性
   *   - 标准尺寸：1024x1024、1536x1024、1024x1536
   *   - 支持 auto
   *
   * 策略：按 targetRatio + resolution 档位直接算 WxH，再对齐到 16 整数倍
   *
   * resolution → 基准短边（px）：
   *   1K → 768    (约 720p)
   *   2K → 1440   (2K QHD 短边)
   *   4K → 2160   (4K UHD 短边，即 3840x2160 的短边)
   */
  private String pickProxySize(String ratio, String resolution) {
    double targetRatio = parseRatio(ratio);
    if (targetRatio <= 0) return "auto";

    int baseShort; // 短边基准（代理最低像素 655360 ≈ 809²，1K档需 ≥1024）
    int maxPixels; // 像素上限（宽*高，代理上限 8294400）
    switch (parseTier(parseResolutionTier(resolution))) {
      case 0: baseShort = 1024; maxPixels = 1024 * 2048; break;      // 1K: 1024短边，≤2M像素
      case 2: baseShort = 2160; maxPixels = 3840 * 2160; break;      // 4K: 2160短边，≤8.3M像素
      default: baseShort = 1440; maxPixels = 2560 * 1440; break;     // 2K: 1440短边，≤3.7M像素
    }

    int w, h;
    if (targetRatio >= 1.0) {
      // 横向或方形：短边=高
      h = baseShort;
      w = (int) Math.round(h * targetRatio);
    } else {
      // 竖向：短边=宽
      w = baseShort;
      h = (int) Math.round(w / targetRatio);
    }

    // 对齐到 16 整数倍（向下取整）
    w = (w / 16) * 16;
    h = (h / 16) * 16;
    // 最小 16
    w = Math.max(16, w);
    h = Math.max(16, h);

    // 像素上限约束：等比缩放
    while ((long) w * h > maxPixels) {
      w = (w * 15 / 16 / 16) * 16;
      h = (h * 15 / 16 / 16) * 16;
    }

    // 长宽比约束 1:3 ~ 3:1
    double actualRatio = (double) w / h;
    if (actualRatio > 3.0) {
      h = (w / 3 / 16) * 16;
    } else if (actualRatio < 1.0 / 3.0) {
      w = (h / 3 / 16) * 16;
    }

    // 最大尺寸约束
    w = Math.min(w, 3840);
    h = Math.min(h, 3840);
    // 重新对齐 16
    w = (w / 16) * 16;
    h = (h / 16) * 16;

    // 安全兜底
    if (w < 16 || h < 16) return "auto";

    return w + "x" + h;
  }

  private double parseRatio(String ratio) {
    if (ratio == null || ratio.isBlank() || ratio.equalsIgnoreCase("auto")) return 1.0;
    String[] parts = ratio.split(":");
    if (parts.length != 2) {
      // 尝试 WIDTHxHEIGHT 格式
      if (ratio.matches("\\d+x\\d+")) {
        String[] dims = ratio.split("x");
        double w = Double.parseDouble(dims[0]);
        double h = Double.parseDouble(dims[1]);
        return w / h;
      }
      return 1.0;
    }
    try {
      double w = Double.parseDouble(parts[0]);
      double h = Double.parseDouble(parts[1]);
      return w / h;
    } catch (NumberFormatException e) {
      return 1.0;
    }
  }

  private String parseResolutionTier(String resolution) {
    if (resolution == null) return "1";
    String s = resolution.trim().toLowerCase();
    if (s.contains("1k") || s.contains("1080") || s.contains("hd")) return "0";
    if (s.contains("4k") || s.contains("2160")) return "2";
    return "1"; // 默认 2K 中等
  }

  private int parseTier(String tier) {
    try { return Integer.parseInt(tier); } catch (Exception e) { return 1; }
  }

  private String encode(String value) {
    return URLEncoder.encode(value, StandardCharsets.UTF_8);
  }

  private String compact(String body) {
    if (body == null || body.isBlank()) return "";
    String compacted = body.replaceAll("\\s+", " ").trim();
    return compacted.length() > 500 ? compacted.substring(0, 500) + "..." : compacted;
  }

  private List<String> iteratorToList(java.util.Iterator<String> it) {
    List<String> list = new ArrayList<>();
    while (it.hasNext()) list.add(it.next());
    return list;
  }

  /**
   * 中转站模型白名单：gpt-image-2 / gpt-image-1.5 / gpt-image-1 / gpt-image-1-mini
   * 不在白名单的模型统一降级到 gpt-image-2
   */
  private String normalizeProxyModel(String model) {
    if (model == null) return "gpt-image-2";
    String m = model.trim().toLowerCase();
    // gpt-image-2
    if (m.equals("gpt-image-2") || m.equals("gpt-image-2-2026-04-21")) {
      return m;
    }
    // Gemini（兜底时从 GetToken fallback 过来）
    if (m.startsWith("gemini-3.1-flash")) return "gemini-3.1-flash-image";
    if (m.startsWith("gemini-3-pro")) return "gemini-3-pro-image";
    return "gpt-image-2";
  }

  /** resolution → quality 映射：1K=low, 2K=medium, 4K=high */
  private String mapProxyQuality(String resolution) {
    if (resolution == null || resolution.isBlank()) return "medium";
    String s = resolution.trim().toLowerCase();
    if (s.contains("1k") || s.contains("low")) return "low";
    if (s.contains("4k") || s.contains("high")) return "high";
    return "medium"; // 2K 默认
  }

  private String pickDallESize(String ratio) { return "1024x1024"; } // removed: dall-e not used

  /**
   * 将 resolution 档位映射为 Agnes 的 size 参数。
   * 速查表：1K → 长边 1024, 2K → 长边 2048, 4K → 长边 4096
   * 规律：nK 长边 = n × 1024px
   * 参考：agnes-image-size-ratio-reference.md
   */
  private String resolutionToAgnesSize(String resolution) {
    int tier = parseTier(parseResolutionTier(resolution));
    switch (tier) {
      case 0: return "1K";
      case 2: return "4K";
      default: return "2K";
    }
  }

  /**
   * 标准化 ratio 为 Agnes 支持的格式。
   * Agnes 支持 6 种标准比例：1:1, 4:3, 3:4, 16:9, 9:16, 21:9
   * 非标准比例 fallback 到最接近的标准比例。
   * 参考：agnes-image-size-ratio-reference.md
   */
  private String normalizeAgnesRatio(String ratio) {
    if (ratio == null || ratio.isBlank()) return "1:1";
    String r = ratio.trim();
    // 已是标准格式直接返回
    if (r.matches("1:1|4:3|3:4|16:9|9:16|21:9")) return r;
    // 按数值匹配最接近的标准比例
    double v = parseRatio(r);
    double[] stdRatios = {1.0, 4.0/3.0, 3.0/4.0, 16.0/9.0, 9.0/16.0, 21.0/9.0};
    String[] stdNames = {"1:1", "4:3", "3:4", "16:9", "9:16", "21:9"};
    int best = 0;
    double minDiff = Double.MAX_VALUE;
    for (int i = 0; i < stdRatios.length; i++) {
      double diff = Math.abs(v - stdRatios[i]);
      if (diff < minDiff) { minDiff = diff; best = i; }
    }
    return stdNames[best];
  }

  private record DownloadedImage(byte[] bytes, String contentType, String filename) {}
}
