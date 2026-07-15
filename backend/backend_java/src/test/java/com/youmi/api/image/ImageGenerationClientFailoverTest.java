package com.youmi.api.image;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.youmi.api.common.ApiException;
import java.io.IOException;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * 回归验证：gettoken 轮询阶段（getTaskInternal → getGetTokenTask → sendGetTokenPost → send）
 * 返回 HTTP 500/599 抛 ApiException 时，getTask 的 try/catch 必须捕获异常并触发 proxy 兜底，
 * 以原始 taskId 透传返回，而不是把异常原样甩给调用方。
 *
 * 同时覆盖「轮询返回带 error 字段的成功响应（不抛异常）」的错误字段分支（574–583 行）。
 *
 * 测试策略：用真实 ObjectMapper + 真实 ImageGenerationProperties（通过 setter 配置 proxy 中转站），
 * 仅用 Mockito 替换底层的 java.net.http.HttpClient（通过 ReflectionTestUtils 注入），
 * 让 gettoken 端点返回 500/599/带 error 字段，proxy 端点返回正常 job_id / status。
 * FailoverState 为私有内部类，通过反射构造并直接注入 failoverStates 映射。
 */
class ImageGenerationClientFailoverTest {

  private HttpClient mockHttpClient;

  // ============ 异常路径：500 ============
  @Test
  void getToken500PollException_triggersProxyFailover() throws Exception {
    ImageGenerationClient client = buildClient(500, "{\"error\":\"internal server error\"}", true);
    JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
    ReflectionTestUtils.setField(client, "jdbcTemplate", jdbcTemplate);

    ImageGenerationDtos.TaskStatusResponse resp = client.getTask("gettoken:xxx");

    assertNotNull(resp, "getTask 不应抛异常，应返回 proxy 兜底响应");
    assertEquals("gettoken:xxx", resp.taskId(), "taskId 必须透传为原始值（前端无感知）");
    assertEquals("proxy", resp.provider(), "异常路径应已切到 proxy 中转站");

    // 证明：确实命中了 proxy 中转站（47.90.226.52）与失败的 gettoken 主站
    verify(mockHttpClient, atLeastOnce()).send(
        argThat(req -> req.uri().toString().contains("47.90.226.52")), any());
    verify(mockHttpClient, atLeastOnce()).send(
        argThat(req -> req.uri().toString().contains("gettoken")), any());
    verify(jdbcTemplate).update(
        "UPDATE ym_image_task SET provider = ? WHERE task_id = ?", "proxy", "gettoken:xxx");
  }

  @Test
  void apimartNetworkFailure_goesDirectlyToProxyWithoutAlternateDomain() throws Exception {
    ImageGenerationProperties props = new ImageGenerationProperties();
    props.setApimartDirectApiKey("test-apimart-key");
    props.setApimartDirectBaseUrl("https://apib.ai");
    props.setProxyApiKey("test-proxy-key");
    props.setProxyBaseUrl("http://47.90.226.52");
    props.setProxyGenerationPath("/api/images/jobs");
    props.setProxyTaskPath("/api/images/jobs");
    props.setPersistGeneratedImages(false);
    props.setTimeoutSeconds(5);

    ImageGenerationClient client = new ImageGenerationClient(new ObjectMapper(), props);
    mockHttpClient = mock(HttpClient.class);
    when(mockHttpClient.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
        .thenAnswer(inv -> {
          HttpRequest request = inv.getArgument(0);
          if (request.uri().toString().contains("apib.ai")) {
            throw new IOException("APIMart unavailable");
          }
          return mockResponse(200, "{\"job_id\":\"proxy-job\",\"status\":\"submitted\"}");
        });
    ReflectionTestUtils.setField(client, "httpClient", mockHttpClient);

    ImageGenerationDtos.CreateTaskRequest request = new ImageGenerationDtos.CreateTaskRequest(
        "a product", "gpt-image-2", "1:1", "1:1", "2K",
        null, null, null, null, null, null, null, null, null, null, null);
    ImageGenerationDtos.CreateTaskResponse response = client.createTask(request);

    assertEquals("proxy", response.provider());
    verify(mockHttpClient, never()).send(
        argThat(req -> req.uri().toString().contains("aiuxu.com")), any());
    verify(mockHttpClient, atLeastOnce()).send(
        argThat(req -> req.uri().toString().contains("47.90.226.52")), any());
  }

  @Test
  void timedOutApimartCompleted_doesNotTriggerProxyFailover() throws Exception {
    HttpServer server = jsonServer("""
        {"data":{"status":"completed","progress":100,
        "result":{"images":[{"url":"https://cdn.example.com/final.png"}]}}}
        """, null);
    try {
      ImageGenerationClient client = newApimartDirectClient(serverBaseUrl(server));
      String taskId = "apimart-direct:done-task";
      ImageGenerationDtos.CreateTaskRequest request = gptImageRequest();
      getFailoverStates(client).put(taskId,
          newFailoverState(request, "apimart-direct", System.currentTimeMillis() - 121_000L));

      ImageGenerationDtos.TaskStatusResponse response = client.getTask(taskId);

      assertEquals("apimart-direct", response.provider());
      assertEquals("persisting", response.status());
      assertEquals(1, response.imageUrls().size());
      assertFalse(getFailoverStates(client).containsKey(taskId));
      verify(mockHttpClient, never()).send(
          argThat(req -> req.uri().toString().contains("47.90.226.52")), any());
    } finally {
      server.stop(0);
    }
  }

  @Test
  void timedOutApimartProcessing_checksPrimaryBeforeProxyFailover() throws Exception {
    AtomicInteger sequence = new AtomicInteger();
    AtomicInteger primaryOrder = new AtomicInteger();
    AtomicInteger proxyOrder = new AtomicInteger();
    HttpServer server = jsonServer(
        "{\"data\":{\"status\":\"processing\",\"progress\":50}}",
        () -> primaryOrder.compareAndSet(0, sequence.incrementAndGet()));
    try {
      ImageGenerationClient client = newApimartDirectClient(serverBaseUrl(server));
      when(mockHttpClient.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
          .thenAnswer(inv -> {
            HttpRequest request = inv.getArgument(0);
            if ("POST".equalsIgnoreCase(request.method())) {
              proxyOrder.compareAndSet(0, sequence.incrementAndGet());
              return mockResponse(200, "{\"job_id\":\"proxy-timeout\",\"status\":\"submitted\"}");
            }
            return mockResponse(200, "{\"status\":\"completed\",\"progress\":100}");
          });

      String taskId = "apimart-direct:slow-task";
      getFailoverStates(client).put(taskId,
          newFailoverState(gptImageRequest(), "apimart-direct", System.currentTimeMillis() - 121_000L));

      ImageGenerationDtos.TaskStatusResponse response = client.getTask(taskId);

      assertEquals("proxy", response.provider());
      assertEquals(taskId, response.taskId());
      assertTrue(primaryOrder.get() > 0);
      assertTrue(proxyOrder.get() > primaryOrder.get(), "Primary must be polled before proxy failover");
    } finally {
      server.stop(0);
    }
  }

  @Test
  void completedConcurrentPoll_preventsStaleTimeoutFailover() throws Exception {
    CountDownLatch processingRequestEntered = new CountDownLatch(1);
    CountDownLatch releaseProcessingResponse = new CountDownLatch(1);
    AtomicInteger requests = new AtomicInteger();
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.setExecutor(command -> {
      Thread worker = new Thread(command);
      worker.setDaemon(true);
      worker.start();
    });
    server.createContext("/", exchange -> {
      if (requests.incrementAndGet() == 1) {
        processingRequestEntered.countDown();
        try {
          releaseProcessingResponse.await(3, TimeUnit.SECONDS);
        } catch (InterruptedException interrupted) {
          Thread.currentThread().interrupt();
        }
        sendJson(exchange, "{\"data\":{\"status\":\"processing\",\"progress\":50}}");
      } else {
        sendJson(exchange, """
            {"data":{"status":"completed","progress":100,
            "result":{"images":[{"url":"https://cdn.example.com/final.png"}]}}}
            """);
      }
    });
    server.start();
    try {
      ImageGenerationClient client = newApimartDirectClient(serverBaseUrl(server));
      String taskId = "apimart-direct:concurrent-task";
      getFailoverStates(client).put(taskId,
          newFailoverState(gptImageRequest(), "apimart-direct", System.currentTimeMillis() - 121_000L));

      AtomicReference<ImageGenerationDtos.TaskStatusResponse> slowResponse = new AtomicReference<>();
      AtomicReference<Throwable> slowError = new AtomicReference<>();
      Thread slowPoll = new Thread(() -> {
        try {
          slowResponse.set(client.getTask(taskId));
        } catch (Throwable error) {
          slowError.set(error);
        }
      });
      slowPoll.start();
      assertTrue(processingRequestEntered.await(3, TimeUnit.SECONDS));

      ImageGenerationDtos.TaskStatusResponse completedResponse = client.getTask(taskId);
      releaseProcessingResponse.countDown();
      slowPoll.join(3_000L);

      assertEquals("apimart-direct", completedResponse.provider());
      assertEquals("persisting", completedResponse.status());
      assertNotNull(slowResponse.get());
      assertEquals("apimart-direct", slowResponse.get().provider());
      assertEquals("processing", slowResponse.get().status());
      assertNull(slowError.get());
      verify(mockHttpClient, never()).send(
          argThat(req -> req.uri().toString().contains("47.90.226.52")), any());
    } finally {
      releaseProcessingResponse.countDown();
      server.stop(0);
    }
  }

  // ============ 异常路径：599 ============
  @Test
  void getToken599PollException_triggersProxyFailover() throws Exception {
    ImageGenerationClient client = buildClient(599, "{\"error\":\"bad gateway\"}", true);

    ImageGenerationDtos.TaskStatusResponse resp = client.getTask("gettoken:xxx");

    assertNotNull(resp);
    assertEquals("gettoken:xxx", resp.taskId());
    assertEquals("proxy", resp.provider());
    verify(mockHttpClient, atLeastOnce()).send(
        argThat(req -> req.uri().toString().contains("47.90.226.52")), any());
  }

  // ============ error 字段路径：轮询返回 200 但带 error 字段（不抛异常）============
  @Test
  void getTokenErrorFieldResponse_triggersProxyFailover() throws Exception {
    ImageGenerationClient client = buildClient(200, "{\"errorMessage\":\"generation failed\"}", true);

    ImageGenerationDtos.TaskStatusResponse resp = client.getTask("gettoken:xxx");

    assertNotNull(resp);
    assertEquals("gettoken:xxx", resp.taskId());
    assertEquals("proxy", resp.provider());
    verify(mockHttpClient, atLeastOnce()).send(
        argThat(req -> req.uri().toString().contains("47.90.226.52")), any());
  }

  @Test
  void getTokenPreviewUrl_isNotCountedAsGeneratedImage() throws Exception {
    ImageGenerationClient client = buildClient(200, """
        {
          "status":"SUCCESS",
          "previewType":"image",
          "previewUrl":"https://cdn.example.com/preview.jpg",
          "results":[{"outputType":"jpg","url":"https://cdn.example.com/final.jpg"}]
        }
        """, true);

    ImageGenerationDtos.TaskStatusResponse resp = client.getTask("gettoken:xxx");

    assertEquals(1, resp.imageUrls().size(), "GetToken previewUrl 不能计入生成结果");
    assertEquals("https://cdn.example.com/final.jpg", resp.imageUrls().get(0));
  }

  // ============ 反向用例：proxy 未配置（无可用备份）→ 异常原样抛出，保留旧行为 ============
  @Test
  void getTokenPollException_noProxyConfigured_rethrowsOriginalException() throws Exception {
    ImageGenerationClient client = buildClient(500, "{\"error\":\"internal\"}", false);

    ApiException ex = assertThrows(ApiException.class, () -> client.getTask("gettoken:xxx"));
    assertNotNull(ex);
    // 确认未触发任何 proxy 兜底调用
    verify(mockHttpClient, never()).send(
        argThat(req -> req.uri().toString().contains("47.90.226.52")), any());
  }

  // ============ 新增回归：apimart 主通道（PROVIDER_APIMART）兜底直奔 Proxy，不再经 GetToken ============
  //
  // 本次修复把 apimart 兜底链里的 GetToken 一跳删掉：
  //   - 创建期（createApimartTask 抛异常）：line 127-138 改为 isProxyConfigured() 时直奔 createProxyTask。
  //   - 轮询期（determineBackupProvider）：case PROVIDER_APIMART -> isProxyConfigured() ? PROXY : null。
  //
  // 注：本 property 模型中 apimart 主通道与 proxy 中转站共用 baseUrl/generationPath，
  //     故「proxy 已配置」(generationPath 含 /api/images/jobs) 时主通道地址即 47.90.226.52。
  //     为走到 createApimartTask（PROVIDER_APIMART）分支，模型必须是「非 proxy/gettoken/agnes」的 apimart 主通道模型；
  //     gpt-image-2 等会被 isProxyModel 提前拦截、直接走 proxy，无法命中本路径（已在代码注释中说明）。

  /** apimart 主通道创建失败（500）→ 直奔 Proxy 中转站；核心断言：GetToken 完全未被调用 */
  @Test
  void apimartCreateFailure_fallsBackDirectlyToProxy() throws Exception {
    ImageGenerationClient client = newApimartClient();

    // 第 1 次 send（apimart 主通道创建）返回 500 → 触发兜底；第 2 次 send（proxy 创建）返回 job_id。
    when(mockHttpClient.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
        .thenAnswer(inv -> mockResponse(500, "{\"error\":\"apimart internal error\"}"))
        .thenAnswer(inv -> mockResponse(200, "{\"job_id\":\"px\"}"));

    ImageGenerationDtos.CreateTaskRequest req = new ImageGenerationDtos.CreateTaskRequest(
        "a cat", "stable-diffusion-3", "1:1", "1:1", "2K",
        null, null, null, null, null, null, null, null, null, null, null);

    ImageGenerationDtos.CreateTaskResponse resp = client.createTask(req);

    assertNotNull(resp, "apimart 创建失败后不应抛异常，应返回 proxy 兜底响应");
    assertEquals("proxy", resp.provider(), "apimart 创建失败应直接切换到 Proxy");
    assertEquals("proxy:px", resp.tasks().get(0).taskId(), "兜底任务应落在 Proxy");

    // 核心断言：命中 proxy（47.90.226.52）且 GetToken（nb.gettoken.cn）完全没被调用
    verify(mockHttpClient, never()).send(
        argThat(r -> r.uri().toString().contains("gettoken")), any());
    verify(mockHttpClient, atLeastOnce()).send(
        argThat(r -> r.uri().toString().contains("47.90.226.52")), any());
  }

  /**
   * apimart 主通道轮询失败（500）→ 直奔 Proxy 中转站；核心断言：GetToken 完全未被调用、原始 taskId 透传。
   *
   * 重要契约说明：apimart 主通道（createApimartTask）在注册 FailoverState 与返回 CreateTaskResponse 时
   * 使用的是【原始 task id，不带 "apimart:" 前缀】（与 gettoken/apimart-direct/proxy/agnes 带前缀不同）。
   * 因此真实调用链路是：createTask 拿到原始 id "xxx"，再以 getTask("xxx") 轮询。
   * 下面的断言据此使用 "xxx" 作为原始 taskId（而非 "apimart:xxx"），与源码实际行为一致。
   */
  @Test
  void apimartPollFailure_fallsBackDirectlyToProxy() throws Exception {
    ImageGenerationClient client = newApimartClient();

    when(mockHttpClient.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
        .thenAnswer(inv -> {
          HttpRequest req = inv.getArgument(0);
          String uri = req.uri().toString();
          String method = req.method();
          if (uri.contains("/v1/images/generations") && "POST".equalsIgnoreCase(method)) {
            return mockResponse(200, "{\"task_id\":\"xxx\"}");
          }
          // apimart 主通道轮询端点（原始 task id，无 apimart: 前缀）返回 500（模拟主站故障）
          if (uri.contains("/v1/tasks/xxx")) return mockResponse(500, "{\"error\":\"apimart poll failed\"}");
          if (uri.contains("gettoken") && uri.contains("/query")) {
            return mockResponse(200, "{\"status\":\"completed\"}");
          }
          if (uri.contains("gettoken")) {
            return mockResponse(200, "{\"taskId\":\"gt-backup\"}");
          }
          if (uri.contains("/api/images/jobs") && "POST".equalsIgnoreCase(method)) {
            return mockResponse(200, "{\"job_id\":\"px\"}");
          }
          if (uri.contains("/api/images/jobs")) return mockResponse(200, "{\"status\":\"completed\"}");
          return mockResponse(200, "{\"status\":\"completed\"}");
        });

    ImageGenerationDtos.CreateTaskRequest req = new ImageGenerationDtos.CreateTaskRequest(
        "a cat", "stable-diffusion-3", "1:1", "1:1", "2K",
        null, null, null, null, null, null, null, null, null, null, null);

    // 1) submitTask 成功：apimart 主通道创建成功，注册 primaryProvider=apimart（key 为原始 task id）
    ImageGenerationDtos.CreateTaskResponse created = client.createTask(req);
    assertNotNull(created);
    assertEquals("apimart", created.provider());
    assertEquals("xxx", created.tasks().get(0).taskId(), "apimart 主通道返回原始 task id（无前缀）");

    // 2) getTask 轮询：apimart 主站返回 500 → 触发 proxy 兜底（注意主通道 task id 无 apimart: 前缀）
    ImageGenerationDtos.TaskStatusResponse resp = client.getTask("xxx");

    assertNotNull(resp, "apimart 轮询失败不应抛异常，应返回 proxy 兜底响应");
    assertEquals("proxy", resp.provider(), "apimart 轮询失败应直接切换到 Proxy");
    assertEquals("xxx", resp.taskId(), "taskId 必须透传为原始值（前端无感知）");

    // 核心断言：命中 Proxy，GetToken 完全未被调用
    verify(mockHttpClient, never()).send(
        argThat(r -> r.uri().toString().contains("gettoken")), any());
    verify(mockHttpClient, atLeastOnce()).send(
        argThat(r -> r.uri().toString().contains("47.90.226.52")), any());
  }

  // ============ 构造辅助 ============

  private ImageGenerationClient buildClient(int gettokenStatus, String gettokenBody, boolean proxyConfigured)
      throws Exception {
    ImageGenerationProperties props = new ImageGenerationProperties();
    if (proxyConfigured) {
      props.setApiKey("test-apimart-key");          // isConfigured()=true
      props.setGenerationPath("/v1/images/generations");
      props.setBaseUrl("https://api.apimart.test");
      props.setProxyApiKey("test-proxy-key");
      props.setProxyBaseUrl("http://47.90.226.52");
      props.setProxyGenerationPath("/api/images/jobs");
      props.setProxyTaskPath("/api/images/jobs");
    } else {
      props.setApiKey("");                          // isConfigured()=false → isProxyConfigured()=false
      props.setGenerationPath("/v1/images/generations");
      props.setProxyApiKey("");
    }
    props.setGetTokenApiKey("test-gettoken-key");   // isGetTokenConfigured()=true
    props.setGetTokenBaseUrl("https://nb.gettoken.cn/openapi/v1");
    props.setGetTokenQueryPath("/query");
    props.setTaskPath("/v1/tasks");
    props.setPersistGeneratedImages(false);         // 避免 OSS 上传逻辑干扰
    props.setTimeoutSeconds(5);

    ImageGenerationClient client = new ImageGenerationClient(new ObjectMapper(), props);

    mockHttpClient = mock(HttpClient.class);
    when(mockHttpClient.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
        .thenAnswer(inv -> {
          HttpRequest req = inv.getArgument(0);
          String uri = req.uri().toString();
          if (uri.contains("gettoken")) {
            return mockResponse(gettokenStatus, gettokenBody);
          }
          // proxy：创建任务返回 job_id；查询任务返回 completed
          if (uri.contains("/api/images/jobs") && "POST".equalsIgnoreCase(req.method())) {
            return mockResponse(200, "{\"job_id\":\"job123\"}");
          }
          if (uri.contains("/api/images/jobs")) {
            return mockResponse(200, "{\"status\":\"completed\"}");
          }
          return mockResponse(200, "{\"status\":\"completed\"}");
        });
    // 注入 mock HttpClient（覆盖 final 字段）
    ReflectionTestUtils.setField(client, "httpClient", mockHttpClient);

    // 注册 FailoverState：primaryProvider=gettoken，未触发过，存在可用 proxy 备份链
    ImageGenerationDtos.CreateTaskRequest req = new ImageGenerationDtos.CreateTaskRequest(
        "a cat", "gemini-3-pro-image-preview", "1:1", "1:1", "2K",
        null, null, null, null, null, null, null, null, null, null, null);
    Object state = newFailoverState(client, req, "gettoken");
    getFailoverStates(client).put("gettoken:xxx", state);

    return client;
  }

  /**
   * 构造一个「apimart 主通道 + proxy 中转站均已配置」的客户端，并注入 mock HttpClient。
   * - apiKey 非空 → isConfigured()=true
   * - generationPath 含 /api/images/jobs 且 baseUrl=47.90.226.52 → isProxyConfigured()=true（proxy 中转站）
   * - 同时故意配置 getTokenApiKey（nb.gettoken.cn）→ 用于证明 apimart 兜底不会绕去 GetToken
   * 该 helper 不破坏已有的 4 个 gettoken 用例（它们各自使用 buildClient）。
   */
  private ImageGenerationClient newApimartClient() {
    ImageGenerationProperties props = new ImageGenerationProperties();
    props.setApiKey("test-apimart-key");          // isConfigured()=true
    props.setGenerationPath("/v1/images/generations");
    props.setBaseUrl("https://api.apimart.test");
    props.setProxyApiKey("test-proxy-key");
    props.setProxyBaseUrl("http://47.90.226.52");
    props.setProxyGenerationPath("/api/images/jobs");
    props.setProxyTaskPath("/api/images/jobs");
    props.setTaskPath("/v1/tasks");
    props.setGetTokenApiKey("test-gettoken-key"); // 故意配置 GetToken，证明兜底不会绕过去
    props.setGetTokenBaseUrl("https://nb.gettoken.cn/openapi/v1");
    props.setGetTokenQueryPath("/query");
    props.setTimeoutSeconds(5);
    props.setPersistGeneratedImages(false);       // 避免 OSS 上传逻辑干扰

    ImageGenerationClient client = new ImageGenerationClient(new ObjectMapper(), props);
    mockHttpClient = mock(HttpClient.class);
    ReflectionTestUtils.setField(client, "httpClient", mockHttpClient);
    return client;
  }

  private ImageGenerationClient newApimartDirectClient(String baseUrl) {
    ImageGenerationProperties props = new ImageGenerationProperties();
    props.setApimartDirectApiKey("test-apimart-key");
    props.setApimartDirectBaseUrl(baseUrl);
    props.setApimartDirectTaskPath("/v1/tasks");
    props.setProxyApiKey("test-proxy-key");
    props.setProxyBaseUrl("http://47.90.226.52");
    props.setProxyGenerationPath("/api/images/jobs");
    props.setProxyTaskPath("/api/images/jobs");
    props.setPersistGeneratedImages(false);
    props.setTimeoutSeconds(5);

    ImageGenerationClient client = new ImageGenerationClient(new ObjectMapper(), props);
    mockHttpClient = mock(HttpClient.class);
    ReflectionTestUtils.setField(client, "httpClient", mockHttpClient);
    return client;
  }

  private HttpServer jsonServer(String body, Runnable beforeResponse) throws IOException {
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/", exchange -> {
      if (beforeResponse != null) beforeResponse.run();
      sendJson(exchange, body);
    });
    server.start();
    return server;
  }

  private void sendJson(HttpExchange exchange, String body) throws IOException {
    byte[] payload = body.getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
    exchange.sendResponseHeaders(200, payload.length);
    exchange.getResponseBody().write(payload);
    exchange.close();
  }

  private String serverBaseUrl(HttpServer server) {
    return "http://127.0.0.1:" + server.getAddress().getPort();
  }

  private ImageGenerationDtos.CreateTaskRequest gptImageRequest() {
    return new ImageGenerationDtos.CreateTaskRequest(
        "a product", "gpt-image-2", "1:1", "1:1", "2K",
        null, null, null, null, null, null, null, null, null, null, null);
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> getFailoverStates(ImageGenerationClient client) throws Exception {
    Field f = ImageGenerationClient.class.getDeclaredField("failoverStates");
    f.setAccessible(true);
    return (Map<String, Object>) f.get(client);
  }

  private Object newFailoverState(ImageGenerationClient client,
      ImageGenerationDtos.CreateTaskRequest req, String primaryProvider) throws Exception {
    return newFailoverState(req, primaryProvider, System.currentTimeMillis());
  }

  private Object newFailoverState(ImageGenerationDtos.CreateTaskRequest req,
      String primaryProvider, long createdAt) throws Exception {
    Class<?> fsClass = Class.forName("com.youmi.api.image.ImageGenerationClient$FailoverState");
    Constructor<?> ctor = fsClass.getDeclaredConstructor(
        long.class, ImageGenerationDtos.CreateTaskRequest.class, String.class);
    ctor.setAccessible(true);
    return ctor.newInstance(createdAt, req, primaryProvider);
  }

  @SuppressWarnings("unchecked")
  private HttpResponse<String> mockResponse(int status, String body) {
    HttpResponse<String> resp = mock(HttpResponse.class);
    when(resp.statusCode()).thenReturn(status);
    when(resp.body()).thenReturn(body);
    return resp;
  }
}
