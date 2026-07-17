package com.youmi.api.image;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * 独立回归验证：生图管线「异步持久化落库」状态机 + DB 写入。
 *
 * 验证策略（不依赖真实中转站 / OSS，沙箱连不上 apib.ai、gettoken、proxy）：
 *  - 用真实 ObjectMapper + 真实 ImageGenerationProperties（setter 配置）构造 ImageGenerationClient，
 *    通过包级私有构造器（ossStorageService=null）创建实例；
 *  - 用 Mockito mock 替换字段注入的 JdbcTemplate（@Autowired(required=false)），拦截 persist_status / result_urls 读，
 *    并捕获每一次 UPDATE 的 SQL 与参数，断言“真落库”；
 *  - decidePollResponse / runPersistTask / parseResultUrls 均为 private，通过反射调用；
 *  - persistExecutor（private final）用 RecordingExecutor 替换，捕获异步提交的任务以便断言“异步被提交”；
 *  - 失败路径通过 properties 注入（isPersistGeneratedImages=true + uploadEndpoint 置空）让 persistImageUrls 抛异常，
 *    从而验证 catch 块写 FAILED 且释放 persistingTaskIds 锁（不依赖真实网络）。
 *
 * 覆盖断言：a. PENDING→persisting + 异步提交；b. runPersistTask 成功→DONE+合法 JSON 数组；
 *          c. runPersistTask 异常→FAILED+锁释放；d. 并发幂等（putIfAbsent）→仅一次真实转存；
 *          e. DONE→completed + 永久 URL；f. FAILED→completed + 临时 URL 兜底。
 */
class ImagePersistStateMachineTest {

  // ===================== 反射调用 private 方法 =====================
  @SuppressWarnings("unchecked")
  private static <T> T invoke(Object target, String name, Class<?>[] types, Object... args) throws Exception {
    Method m = ImageGenerationClient.class.getDeclaredMethod(name, types);
    m.setAccessible(true);
    return (T) m.invoke(target, args);
  }

  private static Object decidePollResponse(ImageGenerationClient c, String taskId, List<String> urls) throws Exception {
    return invoke(c, "decidePollResponse", new Class[]{String.class, List.class}, taskId, urls);
  }

  private static void runPersistTask(ImageGenerationClient c, String taskId, List<String> urls) throws Exception {
    invoke(c, "runPersistTask", new Class[]{String.class, List.class}, taskId, urls);
  }

  private static List<String> prImageUrls(Object pr) throws Exception {
    Method m = pr.getClass().getMethod("imageUrls");
    m.setAccessible(true);
    return (List<String>) m.invoke(pr);
  }

  private static String prStatus(Object pr) throws Exception {
    Method m = pr.getClass().getMethod("status");
    m.setAccessible(true);
    return (String) m.invoke(pr);
  }

  @SuppressWarnings("unchecked")
  private static ConcurrentHashMap<String, Boolean> persistingTaskIds(ImageGenerationClient c) throws Exception {
    Field f = ImageGenerationClient.class.getDeclaredField("persistingTaskIds");
    f.setAccessible(true);
    return (ConcurrentHashMap<String, Boolean>) f.get(c);
  }

  // ===================== 测试夹具 =====================
  /** 记录 execute 提交的 Runnable，但不真正执行（由测试按需手动 run）。 */
  static class RecordingExecutor extends ThreadPoolTaskExecutor {
    final AtomicReference<Runnable> captured = new AtomicReference<>();
    final List<Runnable> all = new CopyOnWriteArrayList<>();

    @Override
    public void execute(Runnable task) {
      all.add(task);
      captured.set(task);
    }
  }

  /** 封装一个 ImageGenerationClient + mock JdbcTemplate，拦截持久化状态读写并捕获所有 UPDATE。 */
  static class Fixture {
    final ImageGenerationClient client;
    final JdbcTemplate jdbcTemplate;
    final RecordingExecutor executor;
    final List<Object[]> updates = new CopyOnWriteArrayList<>();
    String currentStatus;   // getPersistState 返回的 persist_status（null → PENDING）
    String currentResultUrls;

    Fixture(boolean persist, String uploadEndpoint) throws Exception {
      ImageGenerationProperties props = new ImageGenerationProperties();
      props.setPersistGeneratedImages(persist);
      if (uploadEndpoint != null) {
        props.setUploadEndpoint(uploadEndpoint);
      }
      client = new ImageGenerationClient(new ObjectMapper(), props);

      jdbcTemplate = mock(JdbcTemplate.class);
      when(jdbcTemplate.query(anyString(), any(RowMapper.class), any())).thenAnswer(inv -> {
        ResultSet rs = mock(ResultSet.class);
        when(rs.getString("persist_status")).thenReturn(currentStatus);
        when(rs.getString("result_urls")).thenReturn(currentResultUrls);
        Object row = ((RowMapper<?>) inv.getArgument(1)).mapRow(rs, 0);
        return List.of(row);
      });
      when(jdbcTemplate.update(anyString(), any(Object[].class))).thenAnswer(inv -> {
        updates.add(inv.getArguments()); // 扁平化后的全部实参：getArguments()[0]=SQL，其后为各 ?
        return 1;
      });

      ReflectionTestUtils.setField(client, "jdbcTemplate", jdbcTemplate);
      executor = new RecordingExecutor();
      ReflectionTestUtils.setField(client, "persistExecutor", executor);
    }

    void setPersistState(String status, String resultUrls) {
      this.currentStatus = status;
      this.currentResultUrls = resultUrls;
    }

    Object[] doneUpdate() {
      return updates.stream().filter(u -> u[0].toString().contains("persist_status = 'DONE'")).findFirst().orElse(null);
    }

    Object[] failedUpdate() {
      return updates.stream().filter(u -> u[0].toString().contains("persist_status = 'FAILED'")).findFirst().orElse(null);
    }
  }

  // ===================== a. PENDING → persisting + 异步提交 =====================
  @Test
  void pending_triggersAsyncPersist_andReturnsPersisting() throws Exception {
    Fixture fx = new Fixture(false, null);
    fx.setPersistState(null, null); // PENDING

    List<String> temp = List.of("https://temp.host/a.png");
    Object pr = decidePollResponse(fx.client, "apimart-direct:t1", temp);

    assertEquals("persisting", prStatus(pr), "PENDING 应返回 status=persisting（前端继续轮询）");
    assertEquals(temp, prImageUrls(pr), "PENDING 应返回中转站临时 URL 兜底");

    // 断言：异步持久化任务确实被提交
    assertNotNull(fx.executor.captured.get(), "PENDING 时应异步提交持久化任务到 persistExecutor");

    // 手动执行被提交的异步任务，证明其确实会把结果以 DONE 落库（端到端）
    fx.executor.captured.get().run();
    Object[] done = fx.doneUpdate();
    assertNotNull(done, "异步任务执行后应以 DONE 落库");
    String json = (String) done[1]; // getArguments()[1] = result_urls 参数
    List<?> parsed = new ObjectMapper().readValue(json, List.class);
    assertEquals(1, parsed.size(), "result_urls 应为合法 JSON 数组");
  }

  @Test
  void repeatedPolling_enqueuesOnlyOnePersistTask() throws Exception {
    Fixture fx = new Fixture(false, null);
    fx.setPersistState(null, null);

    String taskId = "apimart-direct:repeated-poll";
    List<String> temp = List.of("https://temp.host/a.png");
    for (int i = 0; i < 100; i++) {
      Object pr = decidePollResponse(fx.client, taskId, temp);
      assertEquals("persisting", prStatus(pr));
    }

    assertEquals(1, fx.executor.all.size(), "同一任务重复轮询只能进入队列一次");
    assertTrue(persistingTaskIds(fx.client).containsKey(taskId), "排队期间应持有去重标记");

    fx.executor.captured.get().run();
    assertFalse(persistingTaskIds(fx.client).containsKey(taskId), "转存结束后应释放去重标记");
  }

  // ===================== b. runPersistTask 成功 → DONE + 合法 JSON 数组 =====================
  @Test
  void runPersistTask_success_writesDoneWithValidJsonArray() throws Exception {
    Fixture fx = new Fixture(false, null);
    fx.setPersistState(null, null); // PENDING → 允许进入持久化体

    List<String> urls = List.of("https://temp.host/a.png", "https://temp.host/b.png");
    runPersistTask(fx.client, "apimart-direct:t2", urls);

    Object[] done = fx.doneUpdate();
    assertNotNull(done, "成功路径应写 persist_status='DONE'");
    // UPDATE ... SET result_urls = ?, persist_status = 'DONE' WHERE task_id = ?
    String json = (String) done[1]; // result_urls
    assertEquals("apimart-direct:t2", done[2], "UPDATE 的 WHERE 条件必须是该 taskId，不能错行");
    List<?> parsed = new ObjectMapper().readValue(json, List.class);
    assertEquals(2, parsed.size(), "result_urls JSON 数组应含全部图");
    assertEquals("https://temp.host/a.png", parsed.get(0));
  }

  // ===================== c. runPersistTask 异常 → FAILED + 释放锁 =====================
  @Test
  void runPersistTask_failure_writesFailedAndReleasesLock() throws Exception {
    // persist 开启 + uploadEndpoint 置空 → persistImageUrls 抛异常（模拟上传/转存失败）
    Fixture fx = new Fixture(true, "");
    fx.setPersistState(null, null);

    List<String> urls = List.of("https://temp.host/a.png");
    runPersistTask(fx.client, "apimart-direct:t3", urls);

    Object[] failed = fx.failedUpdate();
    assertNotNull(failed, "异常路径应写 persist_status='FAILED'");
    assertEquals("apimart-direct:t3", failed[1], "FAILED 的 WHERE 条件必须是该 taskId");

    // 关键：finally 必须 remove(taskId)，否则后续轮询会被永久阻塞在 persisting
    assertFalse(persistingTaskIds(fx.client).containsKey("apimart-direct:t3"),
        "finally 必须释放 persistingTaskIds 锁，否则幂等去重失效、轮询卡死");
  }

  // ===================== d. 并发幂等：putIfAbsent → 仅一次真实转存 =====================
  @Test
  void runPersistTask_concurrent_onlyOneRealPersist() throws Exception {
    JdbcTemplate jt = mock(JdbcTemplate.class);
    CountDownLatch enteredQuery = new CountDownLatch(1);
    CountDownLatch releaseQuery = new CountDownLatch(1);
    AtomicInteger queryCalls = new AtomicInteger();
    when(jt.query(anyString(), any(RowMapper.class), any())).thenAnswer(inv -> {
      queryCalls.incrementAndGet();
      enteredQuery.countDown();
      releaseQuery.await(2, TimeUnit.SECONDS); // 占据持久化体，模拟“正在转存”
      ResultSet rs = mock(ResultSet.class);
      when(rs.getString("persist_status")).thenReturn(null); // PENDING
      when(rs.getString("result_urls")).thenReturn(null);
      Object row = ((RowMapper<?>) inv.getArgument(1)).mapRow(rs, 0);
      return List.of(row);
    });
    List<Object[]> updates = new CopyOnWriteArrayList<>();
    when(jt.update(anyString(), any(Object[].class))).thenAnswer(inv -> {
      updates.add(inv.getArguments());
      return 1;
    });

    RecordingExecutor exec = new RecordingExecutor();
    ImageGenerationProperties props = new ImageGenerationProperties();
    props.setPersistGeneratedImages(false);
    ImageGenerationClient client = new ImageGenerationClient(new ObjectMapper(), props);
    ReflectionTestUtils.setField(client, "jdbcTemplate", jt);
    ReflectionTestUtils.setField(client, "persistExecutor", exec);

    String taskId = "conc:1";
    List<String> urls = List.of("https://temp.host/x.png");
    Thread t1 = new Thread(() -> {
      try {
        runPersistTask(client, taskId, urls);
      } catch (Exception ignored) {
      }
    });
    Thread t2 = new Thread(() -> {
      try {
        runPersistTask(client, taskId, urls);
      } catch (Exception ignored) {
      }
    });
    t1.start();
    t2.start();
    assertTrue(enteredQuery.await(3, TimeUnit.SECONDS), "至少有一个 runPersistTask 进入持久化体");
    Thread.sleep(150); // 让另一个线程命中 putIfAbsent 并直接 return
    releaseQuery.countDown();
    t1.join(3000);
    t2.join(3000);

    assertEquals(1, queryCalls.get(), "并发时仅一个 runPersistTask 真正进入持久化体（putIfAbsent 去重生效）");
    long doneCount = updates.stream().filter(u -> u[0].toString().contains("persist_status = 'DONE'")).count();
    assertEquals(1, doneCount, "仅一次真实转存（DONE 落库），不双传");
    assertFalse(persistingTaskIds(client).containsKey(taskId), "并发结束后锁应被释放");
  }

  // ===================== e. DONE → completed + 永久 URL =====================
  @Test
  void done_returnsCompletedWithPermanentUrl() throws Exception {
    Fixture fx = new Fixture(false, null);
    fx.setPersistState("DONE", "[\"https://oss.example/perm1.png\",\"https://oss.example/perm2.png\"]");

    List<String> temp = List.of("https://temp.host/a.png");
    Object pr = decidePollResponse(fx.client, "apimart-direct:t5", temp);

    assertEquals("completed", prStatus(pr), "DONE 应返回 status=completed（前端停止轮询并插入）");
    assertEquals(List.of("https://oss.example/perm1.png", "https://oss.example/perm2.png"), prImageUrls(pr),
        "DONE 应返回永久 OSS URL（来自 result_urls），而非过期临时 URL");
  }

  // ===================== f. FAILED → completed + 临时 URL 兜底 =====================
  @Test
  void failed_returnsCompletedWithTempUrlFallback() throws Exception {
    Fixture fx = new Fixture(false, null);
    fx.setPersistState("FAILED", null);

    List<String> temp = List.of("https://temp.host/a.png");
    Object pr = decidePollResponse(fx.client, "apimart-direct:t6", temp);

    assertEquals("completed", prStatus(pr), "FAILED 应返回 status=completed（至少先出图）");
    assertEquals(temp, prImageUrls(pr), "FAILED 应返回中转站临时 URL 兜底，不应误用空永久 URL");
  }

  // ===================== 附加：parseResultUrls 健壮性 =====================
  @Test
  void parseResultUrls_handlesValidAndInvalid() throws Exception {
    Fixture fx = new Fixture(false, null);
    List<String> a = invoke(fx.client, "parseResultUrls", new Class[]{String.class}, "[\"u1\",\"u2\"]");
    assertEquals(new ArrayList<>(List.of("u1", "u2")), new ArrayList<>(a));

    List<String> b = invoke(fx.client, "parseResultUrls", new Class[]{String.class}, "\"justone\"");
    assertEquals(List.of("justone"), b);

    List<String> c = invoke(fx.client, "parseResultUrls", new Class[]{String.class}, "");
    assertNull(c, "空串应返回 null");

    List<String> d = invoke(fx.client, "parseResultUrls", new Class[]{String.class}, "not-json");
    assertNull(d, "非法 JSON 应返回 null（降级到临时 URL）");
  }
}
