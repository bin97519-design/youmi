package com.youmi.api.ecommerce;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.youmi.api.common.ApiException;
import com.youmi.api.credit.MiBizType;
import com.youmi.api.credit.MiValueDtos;
import com.youmi.api.credit.MiValueService;
import com.youmi.api.image.ImageGenerationClient;
import com.youmi.api.image.ImageGenerationDtos;
import com.youmi.api.image.ImageTaskLogService;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Service;

/**
 * 电商套图核心编排服务。
 * 编排策划、确认、生图、进度查询、结果获取全流程。
 */
@Service
public class EcommerceSetService {
  private static final Logger log = LoggerFactory.getLogger(EcommerceSetService.class);

  private final EcommercePlanningService planningService;
  private final EcommercePromptBuilder promptBuilder;
  private final ImageGenerationClient imageGenerationClient;
  private final ImageTaskLogService imageTaskLogService;
  private final MiValueService miValueService;
  private final JdbcTemplate jdbcTemplate;
  private final EcommerceSetProperties properties;
  private final ObjectMapper objectMapper;

  private final Semaphore concurrencyLimiter;
  private final ExecutorService asyncExecutor;

  public EcommerceSetService(
      EcommercePlanningService planningService,
      EcommercePromptBuilder promptBuilder,
      ImageGenerationClient imageGenerationClient,
      ImageTaskLogService imageTaskLogService,
      MiValueService miValueService,
      JdbcTemplate jdbcTemplate,
      EcommerceSetProperties properties,
      ObjectMapper objectMapper) {
    this.planningService = planningService;
    this.promptBuilder = promptBuilder;
    this.imageGenerationClient = imageGenerationClient;
    this.imageTaskLogService = imageTaskLogService;
    this.miValueService = miValueService;
    this.jdbcTemplate = jdbcTemplate;
    this.properties = properties;
    this.objectMapper = objectMapper;
    this.concurrencyLimiter = new Semaphore(properties.getMaxConcurrent());
    this.asyncExecutor = Executors.newFixedThreadPool(properties.getMaxConcurrent() + 1);
  }

  /**
   * 创建策划方案。
   */
  public EcommerceSetDtos.PlanningResponse createPlanning(
      Long userId,
      EcommerceSetDtos.CreatePlanningRequest req) throws Exception {
    if (userId == null) {
      throw new ApiException(401, "未登录");
    }
    if ((req.productImageUrl() == null || req.productImageUrl().isBlank())
        && (req.productDescription() == null || req.productDescription().isBlank())) {
      throw new ApiException(400, "请提供产品图片或产品描述");
    }

    // 调用 AI 生成策划
    EcommerceSetDtos.PlanningData planningData = planningService.generatePlanning(
        req.productImageUrl(), req.productDescription());

    // 生成 setId 并存入 DB
    String setId = generateSetId();
    String planningJson = objectMapper.writeValueAsString(planningData);

    jdbcTemplate.update("""
        INSERT INTO ym_ecommerce_set (set_id, user_id, status, product_image_url, product_description, planning_data)
        VALUES (?, ?, 'PLANNING', ?, ?, ?)
        """,
        setId, userId,
        req.productImageUrl(),
        req.productDescription(),
        planningJson);

    log.info("[ecommerce] Created planning setId={} for userId={}", setId, userId);
    return new EcommerceSetDtos.PlanningResponse(setId, planningData);
  }

  /**
   * 确认策划方案（状态流转为 CONFIRMED）。
   */
  public void confirmPlanning(Long userId, String setId) {
    validateOwnership(userId, setId);
    String currentStatus = getStatus(setId);
    if (!"PLANNING".equals(currentStatus) && !"CONFIRMED".equals(currentStatus)) {
      throw new ApiException(400, "当前状态不允许确认，状态：" + currentStatus);
    }
    jdbcTemplate.update("""
        UPDATE ym_ecommerce_set SET status = 'CONFIRMED', updated_at = NOW() WHERE set_id = ?
        """, setId);
    log.info("[ecommerce] Confirmed planning setId={}", setId);
  }

  /**
   * 更新策划数据。
   */
  public EcommerceSetDtos.PlanningResponse updatePlanning(
      Long userId,
      String setId,
      EcommerceSetDtos.UpdatePlanningRequest req) {
    validateOwnership(userId, setId);
    String currentStatus = getStatus(setId);
    if (!"PLANNING".equals(currentStatus) && !"CONFIRMED".equals(currentStatus)) {
      throw new ApiException(400, "当前状态不允许编辑策划，状态：" + currentStatus);
    }

    String planningJson;
    EcommerceSetDtos.PlanningData planningData;
    try {
      planningJson = objectMapper.writeValueAsString(req.planningData());
      planningData = objectMapper.convertValue(req.planningData(), EcommerceSetDtos.PlanningData.class);
    } catch (Exception e) {
      throw new ApiException(400, "策划数据格式不正确：" + e.getMessage());
    }

    jdbcTemplate.update("""
        UPDATE ym_ecommerce_set SET planning_data = ?, status = 'PLANNING', updated_at = NOW() WHERE set_id = ?
        """, planningJson, setId);

    log.info("[ecommerce] Updated planning setId={}", setId);
    return new EcommerceSetDtos.PlanningResponse(setId, planningData);
  }

  /**
   * 启动生图流程。
   * 根据策划数据和配置，创建多个生图任务并异步执行。
   */
  public EcommerceSetDtos.GenerationResponse startGeneration(
      Long userId,
      String setId,
      EcommerceSetDtos.StartGenerationRequest req) throws Exception {
    validateOwnership(userId, setId);

    // 读取策划数据
    EcommerceSetDtos.PlanningData planningData = getPlanningData(setId);
    if (planningData == null || planningData.sellingPoints() == null || planningData.sellingPoints().isEmpty()) {
      throw new ApiException(400, "策划数据为空，请先完成策划");
    }

    String currentStatus = getStatus(setId);
    if (!"PLANNING".equals(currentStatus) && !"CONFIRMED".equals(currentStatus)) {
      throw new ApiException(400, "当前套图已提交，请勿重复生成");
    }

    // 确定模型和平台
    String model = (req.model() != null && !req.model().isBlank())
        ? req.model()
        : properties.getDefaultModel();
    String platform = (req.platform() != null && !req.platform().isBlank())
        ? req.platform()
        : "tmall";
    String textLanguage = (req.textLanguage() != null && !req.textLanguage().isBlank())
        ? req.textLanguage()
        : "中文(简体)";

    // 构建生图任务列表
    List<TaskDef> taskDefs = new ArrayList<>();

    // 主图任务
    EcommerceSetDtos.MainImageConfig mainConfig = req.mainImage();
    if (mainConfig != null && mainConfig.count() > 0) {
      List<EcommerceSetDtos.SellingPoint> matchedPoints = matchSellingPoints(
          planningData.sellingPoints(), mainConfig.sellingPoints());
      int count = Math.max(1, mainConfig.count());
      for (int i = 0; i < count; i++) {
        EcommerceSetDtos.SellingPoint sp = matchedPoints.get(i % matchedPoints.size());
        String prompt = promptBuilder.buildMainImagePrompt(
            sp, planningData, mainConfig, platform, textLanguage);
        taskDefs.add(new TaskDef("MAIN_IMAGE", sp.type(), sp.title(), prompt, mainConfig.ratio()));
      }
    }

    // 详情页任务
    EcommerceSetDtos.DetailPageConfig detailConfig = req.detailPage();
    if (detailConfig != null) {
      int detailCount = Math.max(1, detailConfig.count());
      String detailPrompt = promptBuilder.buildDetailPagePrompt(
          planningData, detailConfig, platform, textLanguage);
      for (int i = 0; i < detailCount; i++) {
        taskDefs.add(new TaskDef("DETAIL_PAGE", "detail_page", "详情页第" + (i + 1) + "张", detailPrompt, detailConfig.ratio()));
      }
    }

    if (taskDefs.isEmpty()) {
      throw new ApiException(400, "没有可生成的任务，请检查主图和详情页配置");
    }

    int claimed = jdbcTemplate.update("""
        UPDATE ym_ecommerce_set SET status = 'STARTING', updated_at = NOW()
        WHERE set_id = ? AND status IN ('PLANNING', 'CONFIRMED')
        """, setId);
    if (claimed == 0) {
      throw new ApiException(409, "套图任务已提交，请勿重复操作");
    }

    List<MiValueDtos.DeductResult> reservations = new ArrayList<>();
    try {
      for (int i = 0; i < taskDefs.size(); i++) {
        reservations.add(miValueService.checkAndDeduct(userId, MiBizType.IMAGE));
      }
    } catch (Exception e) {
      reservations.forEach(item -> miValueService.rollback(userId, item.logId()));
      jdbcTemplate.update(
          "UPDATE ym_ecommerce_set SET status = ?, updated_at = NOW() WHERE set_id = ?",
          currentStatus, setId);
      throw e;
    }

    // 存储生图配置
    String genConfigJson = objectMapper.writeValueAsString(req);
    jdbcTemplate.update("""
        UPDATE ym_ecommerce_set
        SET generation_config = ?, model = ?, platform = ?, status = 'GENERATING',
            total_tasks = ?, completed_tasks = 0, updated_at = NOW()
        WHERE set_id = ?
        """,
        genConfigJson, model, platform, taskDefs.size(), setId);

    // 全部任务记录创建成功后再异步提交，避免半套任务已启动、半套任务未落库。
    List<PendingTask> pendingTasks = new ArrayList<>();
    try {
      for (int sortOrder = 0; sortOrder < taskDefs.size(); sortOrder++) {
        TaskDef def = taskDefs.get(sortOrder);
        MiValueDtos.DeductResult reservation = reservations.get(sortOrder);
        KeyHolder keyHolder = new GeneratedKeyHolder();
        final int currentSortOrder = sortOrder;
        jdbcTemplate.update(connection -> {
          var statement = connection.prepareStatement("""
              INSERT INTO ym_ecommerce_set_task
              (set_id, task_type, selling_point_type, selling_point_title, prompt, ratio,
               status, billing_log_id, sort_order)
              VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
              """, java.sql.Statement.RETURN_GENERATED_KEYS);
          statement.setString(1, setId);
          statement.setString(2, def.taskType);
          statement.setString(3, def.sellingPointType);
          statement.setString(4, def.sellingPointTitle);
          statement.setString(5, def.prompt);
          statement.setString(6, def.ratio);
          statement.setLong(7, reservation.logId());
          statement.setInt(8, currentSortOrder);
          return statement;
        }, keyHolder);

        Number generatedKey = keyHolder.getKey();
        if (generatedKey == null) throw new IllegalStateException("创建套图子任务失败");
        pendingTasks.add(new PendingTask(generatedKey.longValue(), def, reservation.logId()));
      }
    } catch (Exception e) {
      reservations.forEach(item -> miValueService.rollback(userId, item.logId()));
      jdbcTemplate.update("DELETE FROM ym_ecommerce_set_task WHERE set_id = ? AND status = 'PENDING'", setId);
      jdbcTemplate.update(
          "UPDATE ym_ecommerce_set SET status = ?, total_tasks = 0, updated_at = NOW() WHERE set_id = ?",
          currentStatus, setId);
      throw e;
    }

    for (PendingTask pending : pendingTasks) {
      CompletableFuture.runAsync(() -> executeGenerationTask(
          userId, pending.dbId, setId, pending.def, model, pending.def.ratio, pending.billingLogId),
          asyncExecutor);
    }

    log.info("[ecommerce] Started generation setId={} totalTasks={}", setId, taskDefs.size());
    int consumedMi = reservations.stream().mapToInt(MiValueDtos.DeductResult::price).sum();
    return new EcommerceSetDtos.GenerationResponse(
        setId, taskDefs.size(), consumedMi, miValueService.getBalance(userId));
  }

  /**
   * 异步执行单个生图任务。
   */
  private void executeGenerationTask(
      Long userId, long dbId, String setId, TaskDef def, String model, String ratio,
      long billingLogId) {
    try {
      concurrencyLimiter.acquire();
      try {
        // 更新状态为 SUBMITTED
        jdbcTemplate.update("""
            UPDATE ym_ecommerce_set_task SET status = 'SUBMITTED', updated_at = NOW() WHERE id = ?
            """, dbId);

        // 构建生图请求
        ImageGenerationDtos.CreateTaskRequest request = new ImageGenerationDtos.CreateTaskRequest(
            def.prompt,     // prompt
            model,          // model
            null,           // size
            ratio,          // ratio
            null,           // resolution
            1,              // n
            1,              // count
            null,           // imageUrlsSnake
            null,           // imageUrls
            null,           // background
            null,           // outputFormat
            null,           // moderation
            null,           // inputFidelity
            null,           // outputCompression
            null,           // webhookUrl
            "ecommerce:" + setId + ":" + dbId + ":" + billingLogId
        );

        // 调用图片生成
        ImageGenerationDtos.CreateTaskResponse response = imageGenerationClient.createTask(request, userId);
        imageTaskLogService.recordCreated(userId, request, response);

        // 更新 task_id 和状态
        String providerTaskId = "";
        if (response.tasks() != null && !response.tasks().isEmpty()) {
          providerTaskId = response.tasks().get(0).taskId();
        }
        if (providerTaskId == null || providerTaskId.isBlank()) {
          throw new IllegalStateException("生图服务未返回任务编号");
        }
        miValueService.linkTask(billingLogId, providerTaskId);
        miValueService.commit(billingLogId);
        jdbcTemplate.update("""
            UPDATE ym_ecommerce_set_task
            SET task_id = ?, status = 'PROCESSING', updated_at = NOW()
            WHERE id = ?
            """,
            providerTaskId, dbId);

        log.info("[ecommerce] Task submitted dbId={} providerTaskId={}", dbId, providerTaskId);
      } finally {
        concurrencyLimiter.release();
      }
    } catch (Exception e) {
      miValueService.rollback(userId, billingLogId);
      log.error("[ecommerce] Task failed dbId={}: {}", dbId, e.getMessage());
      try {
        jdbcTemplate.update("""
            UPDATE ym_ecommerce_set_task
            SET status = 'FAILED', error_message = ?, updated_at = NOW()
            WHERE id = ?
            """,
            truncate(e.getMessage(), 500), dbId);
        // 更新主表完成计数
        updateCompletedCount(setId);
      } catch (Exception ex) {
        log.error("[ecommerce] Failed to update task status dbId={}: {}", dbId, ex.getMessage());
      }
    }
  }

  /**
   * 轮询进度，同时更新正在处理的任务状态。
   */
  public EcommerceSetDtos.ProgressResponse pollProgress(Long userId, String setId) {
    validateOwnership(userId, setId);
    String mainStatus = getStatus(setId);
    if (mainStatus == null) {
      throw new ApiException(404, "套图不存在：" + setId);
    }

    // 查询所有任务
    List<Map<String, Object>> tasks = jdbcTemplate.queryForList(
        "SELECT id, task_id, task_type, selling_point_type, selling_point_title, " +
            "status, progress, image_url, thumbnail_url FROM ym_ecommerce_set_task WHERE set_id = ? ORDER BY sort_order",
        setId);

    List<EcommerceSetDtos.ProgressItem> items = new ArrayList<>();
    int completed = 0;
    int failed = 0;

    for (Map<String, Object> task : tasks) {
      String taskStatus = String.valueOf(task.get("status"));
      String providerTaskId = task.get("task_id") != null ? String.valueOf(task.get("task_id")) : "";
      long dbId = ((Number) task.get("id")).longValue();

      // 对处理中的任务，查询最新状态
      if (("PROCESSING".equals(taskStatus) || "SUBMITTED".equals(taskStatus))
          && providerTaskId != null && !providerTaskId.isBlank() && !"null".equals(providerTaskId)) {
        try {
          ImageGenerationDtos.TaskStatusResponse statusResp = imageGenerationClient.getTask(providerTaskId);
          imageTaskLogService.recordStatus(statusResp);

          String newStatus = normalizeStatus(statusResp.status());
          int newProgress = statusResp.progress() != null ? statusResp.progress() : 0;
          String imageUrl = "";
          if (statusResp.imageUrls() != null && !statusResp.imageUrls().isEmpty()) {
            imageUrl = statusResp.imageUrls().get(0);
          }
          String errorMessage = statusResp.error();

          // 更新 DB
          if (isDoneStatus(newStatus)) {
            jdbcTemplate.update("""
                UPDATE ym_ecommerce_set_task
                SET status = 'COMPLETED', progress = 100, image_url = ?, updated_at = NOW()
                WHERE id = ?
                """,
                imageUrl, dbId);
            taskStatus = "COMPLETED";
            miValueService.commitByTaskId(providerTaskId);
          } else if ("failed".equalsIgnoreCase(newStatus) || errorMessage != null) {
            jdbcTemplate.update("""
                UPDATE ym_ecommerce_set_task
                SET status = 'FAILED', error_message = ?, updated_at = NOW()
                WHERE id = ?
                """,
                truncate(errorMessage, 500), dbId);
            taskStatus = "FAILED";
            miValueService.rollbackByTaskId(userId, providerTaskId);
          } else {
            jdbcTemplate.update("""
                UPDATE ym_ecommerce_set_task
                SET progress = ?, updated_at = NOW() WHERE id = ?
                """,
                newProgress, dbId);
          }
        } catch (Exception e) {
          log.warn("[ecommerce] Failed to poll task status dbId={}: {}", dbId, e.getMessage());
        }
      }

      // 重新获取最新状态
      String latestStatus = taskStatus;
      int latestProgress = task.get("progress") != null ? ((Number) task.get("progress")).intValue() : 0;
      String latestImageUrl = task.get("image_url") != null ? String.valueOf(task.get("image_url")) : null;

      // 对 COMPLETED/FAILED 的任务，重新读 DB 获取最新数据
      if ("COMPLETED".equals(taskStatus) || "FAILED".equals(taskStatus)) {
        Map<String, Object> latest = jdbcTemplate.queryForMap(
            "SELECT status, progress, image_url FROM ym_ecommerce_set_task WHERE id = ?", dbId);
        latestStatus = String.valueOf(latest.get("status"));
        latestProgress = latest.get("progress") != null ? ((Number) latest.get("progress")).intValue() : 0;
        latestImageUrl = latest.get("image_url") != null ? String.valueOf(latest.get("image_url")) : null;
        if ("null".equals(latestImageUrl)) latestImageUrl = null;
      }

      if ("COMPLETED".equals(latestStatus)) {
        completed++;
      } else if ("FAILED".equals(latestStatus)) {
        failed++;
      }

      items.add(new EcommerceSetDtos.ProgressItem(
          providerTaskId,
          String.valueOf(task.get("task_type")),
          task.get("selling_point_type") != null ? String.valueOf(task.get("selling_point_type")) : null,
          task.get("selling_point_title") != null ? String.valueOf(task.get("selling_point_title")) : null,
          latestStatus,
          latestProgress,
          latestImageUrl
      ));
    }

    // 更新主表完成计数
    int total = tasks.size();
    int finished = completed + failed;
    if (finished > 0) {
      jdbcTemplate.update("""
          UPDATE ym_ecommerce_set SET completed_tasks = ?, updated_at = NOW() WHERE set_id = ?
          """, finished, setId);
    }

    // 成功和失败都属于终态，避免一张失败导致整套任务永远停在生成中。
    if (finished >= total && total > 0) {
      String terminalStatus = failed > 0 ? "PARTIAL_FAILED" : "COMPLETED";
      jdbcTemplate.update("""
          UPDATE ym_ecommerce_set SET status = ?, updated_at = NOW() WHERE set_id = ?
          """, terminalStatus, setId);
      mainStatus = terminalStatus;
    }

    return new EcommerceSetDtos.ProgressResponse(
        setId, mainStatus, completed, failed, finished, total, items);
  }

  /**
   * 获取生图结果。
   */
  public EcommerceSetDtos.ResultResponse getResult(Long userId, String setId) {
    validateOwnership(userId, setId);
    String mainStatus = getStatus(setId);
    if (mainStatus == null) {
      throw new ApiException(404, "套图不存在：" + setId);
    }

    List<Map<String, Object>> tasks = jdbcTemplate.queryForList(
        "SELECT id, task_id, task_type, selling_point_type, selling_point_title, " +
            "image_url, thumbnail_url, status, error_message " +
            "FROM ym_ecommerce_set_task WHERE set_id = ? ORDER BY sort_order",
        setId);

    List<EcommerceSetDtos.ResultImage> mainImages = new ArrayList<>();
    List<EcommerceSetDtos.ResultImage> detailPages = new ArrayList<>();

    for (Map<String, Object> task : tasks) {
      long id = ((Number) task.get("id")).longValue();
      String imageUrl = task.get("image_url") != null ? String.valueOf(task.get("image_url")) : null;
      String thumbnailUrl = task.get("thumbnail_url") != null ? String.valueOf(task.get("thumbnail_url")) : null;
      if ("null".equals(imageUrl)) imageUrl = null;
      if ("null".equals(thumbnailUrl)) thumbnailUrl = null;

      EcommerceSetDtos.ResultImage img = new EcommerceSetDtos.ResultImage(
          id,
          task.get("task_id") != null ? String.valueOf(task.get("task_id")) : null,
          String.valueOf(task.get("task_type")),
          task.get("selling_point_type") != null ? String.valueOf(task.get("selling_point_type")) : null,
          task.get("selling_point_title") != null ? String.valueOf(task.get("selling_point_title")) : null,
          imageUrl,
          thumbnailUrl,
          String.valueOf(task.get("status")),
          task.get("error_message") != null ? String.valueOf(task.get("error_message")) : null
      );

      if ("MAIN_IMAGE".equals(String.valueOf(task.get("task_type")))) {
        mainImages.add(img);
      } else {
        detailPages.add(img);
      }
    }

    return new EcommerceSetDtos.ResultResponse(setId, mainImages, detailPages);
  }

  /** 仅重试当前用户套图中的单张失败图片。 */
  public EcommerceSetDtos.RetryResponse retryImage(Long userId, String setId, long imageId) {
    validateOwnership(userId, setId);
    List<Map<String, Object>> rows = jdbcTemplate.queryForList("""
        SELECT t.id, t.task_type, t.selling_point_type, t.selling_point_title, t.prompt,
               t.ratio, t.status, t.retry_count, s.model
        FROM ym_ecommerce_set_task t
        JOIN ym_ecommerce_set s ON s.set_id = t.set_id
        WHERE t.id = ? AND t.set_id = ? AND s.user_id = ?
        """, imageId, setId, userId);
    if (rows.isEmpty()) {
      throw new ApiException(404, "套图图片不存在");
    }
    Map<String, Object> row = rows.get(0);
    if (!"FAILED".equals(String.valueOf(row.get("status")))) {
      throw new ApiException(400, "只有失败图片可以重试");
    }

    MiValueDtos.DeductResult reservation = miValueService.checkAndDeduct(userId, MiBizType.IMAGE);
    int affected = jdbcTemplate.update("""
        UPDATE ym_ecommerce_set_task
        SET task_id = NULL, status = 'PENDING', progress = 0, image_url = NULL,
            thumbnail_url = NULL, error_message = NULL, billing_log_id = ?,
            retry_count = retry_count + 1, updated_at = NOW()
        WHERE id = ? AND set_id = ? AND status = 'FAILED'
        """, reservation.logId(), imageId, setId);
    if (affected == 0) {
      miValueService.rollback(userId, reservation.logId());
      throw new ApiException(409, "图片已在重试，请勿重复操作");
    }
    jdbcTemplate.update("""
        UPDATE ym_ecommerce_set SET status = 'GENERATING', updated_at = NOW() WHERE set_id = ?
        """, setId);

    TaskDef def = new TaskDef(
        String.valueOf(row.get("task_type")),
        row.get("selling_point_type") == null ? null : String.valueOf(row.get("selling_point_type")),
        row.get("selling_point_title") == null ? null : String.valueOf(row.get("selling_point_title")),
        String.valueOf(row.get("prompt")),
        row.get("ratio") == null ? null : String.valueOf(row.get("ratio")));
    String model = row.get("model") == null ? properties.getDefaultModel() : String.valueOf(row.get("model"));
    CompletableFuture.runAsync(() -> executeGenerationTask(
        userId, imageId, setId, def, model, def.ratio, reservation.logId()), asyncExecutor);

    return new EcommerceSetDtos.RetryResponse(
        imageId, "PENDING", reservation.price(), miValueService.getBalance(userId));
  }

  public List<EcommerceSetDtos.SourceImage> getRecentSourceImages(Long userId, int requestedLimit) {
    if (userId == null) throw new ApiException(401, "未登录");
    int limit = Math.max(1, Math.min(50, requestedLimit));
    List<Map<String, Object>> rows = jdbcTemplate.queryForList("""
        SELECT task_id, prompt, COALESCE(result_urls, image_urls) AS urls, created_at
        FROM ym_image_task
        WHERE user_id = ? AND COALESCE(result_urls, image_urls) IS NOT NULL
          AND COALESCE(result_urls, image_urls) <> ''
        ORDER BY COALESCE(completed_at, updated_at, created_at) DESC
        LIMIT ?
        """, userId, limit);
    List<EcommerceSetDtos.SourceImage> images = new ArrayList<>();
    for (Map<String, Object> row : rows) {
      String url = firstImageUrl(row.get("urls"));
      if (url == null || url.isBlank()) continue;
      images.add(new EcommerceSetDtos.SourceImage(
          String.valueOf(row.get("task_id")),
          url,
          row.get("prompt") == null ? "" : String.valueOf(row.get("prompt")),
          row.get("created_at") == null ? "" : String.valueOf(row.get("created_at"))));
    }
    return images;
  }

  /**
   * 导入图片到画布。
   * 将生成的图片 URL 保存为画布文档。
   */
  public EcommerceSetDtos.CanvasImportResponse importToCanvas(Long userId, String setId, Long imageId) throws Exception {
    validateOwnership(userId, setId);

    Map<String, Object> task = jdbcTemplate.queryForMap(
        "SELECT image_url, selling_point_title FROM ym_ecommerce_set_task WHERE id = ? AND set_id = ?",
        imageId, setId);

    String imageUrl = task.get("image_url") != null ? String.valueOf(task.get("image_url")) : null;
    if (imageUrl == null || imageUrl.isBlank() || "null".equals(imageUrl)) {
      throw new ApiException(400, "该图片尚未生成完成");
    }

    String title = task.get("selling_point_title") != null ? String.valueOf(task.get("selling_point_title")) : "电商套图";
    String fileName = title.replaceAll("[\\\\/:*?\"<>|]", "_") + ".png";

    log.info("[ecommerce] Imported image to canvas setId={} imageId={}", setId, imageId);
    return new EcommerceSetDtos.CanvasImportResponse(imageUrl, fileName);
  }

  // ==================== 私有方法 ====================

  private List<EcommerceSetDtos.SellingPoint> matchSellingPoints(
      List<EcommerceSetDtos.SellingPoint> available,
      List<String> selectedTypes) {
    if (selectedTypes == null || selectedTypes.isEmpty()) {
      return available;
    }
    List<String> normalizedSelected = selectedTypes.stream()
        .map(this::normalizeSellingPointType)
        .toList();
    List<EcommerceSetDtos.SellingPoint> matched = available.stream()
        .filter(point -> normalizedSelected.contains(normalizeSellingPointType(point.type())))
        .toList();
    // UI 中包含 SKU、白底图等画面类型，不一定对应 AI 策划类型；无匹配时按策划顺序生成。
    return matched.isEmpty() ? available : matched;
  }

  private String firstImageUrl(Object rawValue) {
    if (rawValue == null) return null;
    String raw = String.valueOf(rawValue).trim();
    if (raw.isBlank()) return null;
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
    try {
      JsonNode node = objectMapper.readTree(raw);
      if (node.isArray() && !node.isEmpty()) {
        JsonNode first = node.get(0);
        if (first.isTextual()) return first.asText();
        if (first.hasNonNull("url")) return first.get("url").asText();
      }
    } catch (Exception ignored) {
      log.debug("[ecommerce] Skip malformed history image urls");
    }
    return null;
  }

  private String normalizeSellingPointType(String type) {
    if (type == null) return "";
    return switch (type.trim()) {
      case "场景使用", "场景渲染" -> "使用场景";
      case "产品尺寸", "规格参数" -> "尺寸规格";
      case "产品细节", "材质工艺" -> "材质工艺";
      case "礼盒赠品" -> "包装展示";
      case "节日大促" -> "促销信息";
      default -> type.trim();
    };
  }

  private String generateSetId() {
    return "es_" + UUID.randomUUID().toString().replace("-", "").substring(0, 16);
  }

  private void validateOwnership(Long userId, String setId) {
    if (userId == null) {
      throw new ApiException(401, "未登录");
    }
    Integer count = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM ym_ecommerce_set WHERE set_id = ? AND user_id = ?",
        Integer.class, setId, userId);
    if (count == null || count == 0) {
      throw new ApiException(403, "无权访问此套图");
    }
  }

  private String getStatus(String setId) {
    List<String> statuses = jdbcTemplate.queryForList(
        "SELECT status FROM ym_ecommerce_set WHERE set_id = ?",
        String.class, setId);
    return statuses.isEmpty() ? null : statuses.get(0);
  }

  private EcommerceSetDtos.PlanningData getPlanningData(String setId) {
    try {
      String json = jdbcTemplate.queryForObject(
          "SELECT planning_data FROM ym_ecommerce_set WHERE set_id = ?",
          String.class, setId);
      if (json == null || json.isBlank()) return null;
      return objectMapper.readValue(json, EcommerceSetDtos.PlanningData.class);
    } catch (Exception e) {
      log.error("[ecommerce] Failed to parse planning data for setId={}: {}", setId, e.getMessage());
      return null;
    }
  }

  private void updateCompletedCount(String setId) {
    try {
      Integer completed = jdbcTemplate.queryForObject(
          "SELECT COUNT(*) FROM ym_ecommerce_set_task WHERE set_id = ? AND status IN ('COMPLETED', 'FAILED')",
          Integer.class, setId);
      if (completed != null) {
        jdbcTemplate.update("""
            UPDATE ym_ecommerce_set SET completed_tasks = ?, updated_at = NOW() WHERE set_id = ?
            """, completed, setId);
      }
    } catch (Exception e) {
      log.warn("[ecommerce] Failed to update completed count for setId={}: {}", setId, e.getMessage());
    }
  }

  private boolean isDoneStatus(String status) {
    if (status == null) return false;
    String s = status.trim().toLowerCase();
    return s.equals("completed") || s.equals("succeeded") || s.equals("success") || s.equals("done");
  }

  private String normalizeStatus(String status) {
    if (status == null || status.isBlank()) return "unknown";
    return status.trim().toLowerCase();
  }

  private String truncate(String s, int maxLen) {
    if (s == null) return null;
    return s.length() > maxLen ? s.substring(0, maxLen) : s;
  }

  /** 内部任务定义 */
  private record TaskDef(
      String taskType,
      String sellingPointType,
      String sellingPointTitle,
      String prompt,
      String ratio) {}

  private record PendingTask(long dbId, TaskDef def, long billingLogId) {}
}
