package com.youmi.api.selection;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.youmi.api.common.ApiException;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class SelectionPoolService {
  private static final int MAX_BATCH_SIZE = 200;
  private static final Set<String> COLLECT_STATUSES =
      Set.of("PENDING", "COLLECTING", "COLLECTED", "FAILED");
  private static final Set<String> COLLECT_SOURCES =
      Set.of("DETAIL", "URL_BATCH", "SHOP", "MANUAL", "PACKAGE", "EXTENSION");

  private final SelectionPoolRepository repository;
  private final ObjectMapper objectMapper;

  public SelectionPoolService(SelectionPoolRepository repository, ObjectMapper objectMapper) {
    this.repository = repository;
    this.objectMapper = objectMapper;
  }

  @Transactional
  public SelectionPoolDtos.ProductView upsert(Long userId, SelectionPoolDtos.ProductUpsertRequest request) {
    return upsertWithResult(userId, request).view();
  }

  @Transactional
  public SelectionPoolDtos.BulkUpsertResult bulkUpsert(
      Long userId, SelectionPoolDtos.BulkUpsertRequest request) {
    List<SelectionPoolDtos.ProductUpsertRequest> products = request == null ? null : request.products();
    validateBatch(products, "待入库商品");
    int created = 0;
    int updated = 0;
    List<SelectionPoolDtos.ProductView> views = new ArrayList<>();
    for (SelectionPoolDtos.ProductUpsertRequest product : products) {
      UpsertResult result = upsertWithResult(userId, product);
      if (result.created()) created++; else updated++;
      views.add(result.view());
    }
    return new SelectionPoolDtos.BulkUpsertResult(created, updated, views);
  }

  public SelectionPoolDtos.ProductPage list(
      Long userId, String keyword, String platform, String collectStatus, String publishStatus,
      Long tagId, Boolean hasAiEdit, Integer page, Integer pageSize) {
    int safePage = page == null ? 1 : Math.max(1, page);
    int safePageSize = pageSize == null ? 20 : Math.max(1, Math.min(100, pageSize));
    String safeKeyword = optional(keyword);
    String safePlatform = upperOptional(platform);
    String safeCollectStatus = upperOptional(collectStatus);
    String safePublishStatus = upperOptional(publishStatus);
    List<SelectionProduct> rows = repository.list(
        userId, safeKeyword, safePlatform, safeCollectStatus, safePublishStatus,
        tagId, hasAiEdit, safePage, safePageSize);
    long total = repository.count(
        userId, safeKeyword, safePlatform, safeCollectStatus, safePublishStatus, tagId, hasAiEdit);
    return new SelectionPoolDtos.ProductPage(
        rows.stream().map(product -> toView(userId, product)).toList(), total, safePage, safePageSize);
  }

  public SelectionPoolDtos.ProductView get(Long userId, Long id) {
    return toView(userId, requireProduct(userId, id));
  }

  @Transactional
  public SelectionPoolDtos.ProductView update(
      Long userId, Long id, SelectionPoolDtos.ProductPatchRequest request) {
    SelectionProduct current = requireProduct(userId, id);
    String title = request != null && StringUtils.hasText(request.title())
        ? limit(request.title().trim(), 512) : current.title();
    String cover = request != null && request.coverImageUrl() != null
        ? limit(optional(request.coverImageUrl()), 1024) : current.coverImageUrl();
    String sourceUrl = request != null && request.sourceUrl() != null
        ? limit(optional(request.sourceUrl()), 1024) : current.sourceUrl();
    ObjectNode working = request != null && request.productData() != null
        ? asObject(request.productData()) : asObject(readJson(current.productData()));
    working = standardizeProductData(
        working, current.sourcePlatform(), current.sourceProductId(), title, sourceUrl, cover,
        current.collectSource());
    boolean hasAiEdit = request != null && request.hasAiEdit() != null
        ? request.hasAiEdit() : current.hasAiEdit();
    int qualityScore = calculateQuality(title, cover, sourceUrl, working);
    String workingJson = writeJson(working);
    repository.updateWorkingCopy(
        userId, id, title, cover, sourceUrl, workingJson, hasAiEdit, qualityScore);
    repository.insertRevision(id, userId, workingJson, current.rawSnapshot(), "EDIT");
    return get(userId, id);
  }

  @Transactional
  public int delete(Long userId, SelectionPoolDtos.BatchDeleteRequest request) {
    List<Long> ids = request == null ? null : request.productRowIds();
    validateIds(ids, "待删除商品");
    return repository.softDelete(userId, distinct(ids));
  }

  public List<SelectionPoolDtos.TagView> listTags(Long userId) {
    return repository.listTags(userId);
  }

  @Transactional
  public SelectionPoolDtos.TagView createTag(Long userId, SelectionPoolDtos.TagSaveRequest request) {
    String name = requireText(request == null ? null : request.name(), "标签名称不能为空", 32);
    if (repository.tagNameExists(userId, name, null)) throw new ApiException(400, "标签名称已存在");
    String color = normalizeColor(request == null ? null : request.color());
    Long id = repository.insertTag(userId, name, color);
    return new SelectionPoolDtos.TagView(id, name, color, 0);
  }

  @Transactional
  public SelectionPoolDtos.TagView updateTag(
      Long userId, Long id, SelectionPoolDtos.TagSaveRequest request) {
    String name = requireText(request == null ? null : request.name(), "标签名称不能为空", 32);
    if (repository.tagNameExists(userId, name, id)) throw new ApiException(400, "标签名称已存在");
    String color = normalizeColor(request == null ? null : request.color());
    if (repository.updateTag(userId, id, name, color) == 0) throw new ApiException(404, "标签不存在");
    return new SelectionPoolDtos.TagView(id, name, color, 0);
  }

  @Transactional
  public void deleteTag(Long userId, Long id) {
    if (repository.deleteTag(userId, id) == 0) throw new ApiException(404, "标签不存在");
  }

  @Transactional
  public void assignTags(Long userId, SelectionPoolDtos.TagAssignRequest request) {
    List<Long> productIds = request == null ? null : request.productRowIds();
    validateIds(productIds, "待设置标签商品");
    List<Long> tagIds = request.tagIds() == null ? List.of() : distinct(request.tagIds());
    if (tagIds.size() > 20) throw new ApiException(400, "单个商品最多设置 20 个标签");
    repository.replaceTags(userId, distinct(productIds), tagIds);
  }

  @Transactional
  public SelectionPoolDtos.MigrationTaskView createMigrationTask(
      Long userId, SelectionPoolDtos.MigrationCreateRequest request) {
    List<Long> requestedIds = request == null ? null : request.productRowIds();
    validateIds(requestedIds, "待搬家商品");
    List<Long> productIds = distinct(requestedIds);
    String targetPlatform = requireText(request.targetPlatform(), "请选择目标平台", 32)
        .toUpperCase(Locale.ROOT);
    List<SelectionProduct> products = productIds.stream()
        .map(id -> requireProduct(userId, id))
        .toList();
    List<Long> unavailable = products.stream()
        .filter(product -> !"COLLECTED".equals(product.collectStatus()))
        .map(SelectionProduct::id)
        .toList();
    if (!unavailable.isEmpty()) {
      throw new ApiException(400, "存在尚未采集完成的商品：" + unavailable);
    }
    String taskId = "move_" + System.currentTimeMillis() + "_"
        + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    repository.createMigrationTask(
        taskId, userId, targetPlatform, optional(request.targetShopRef()),
        writeJson(request.options()), products);
    return repository.findMigrationTask(userId, taskId)
        .orElseThrow(() -> new ApiException(500, "搬家任务创建失败"));
  }

  public SelectionPoolDtos.MigrationTaskView getMigrationTask(Long userId, String taskId) {
    return repository.findMigrationTask(userId, taskId)
        .orElseThrow(() -> new ApiException(404, "搬家任务不存在"));
  }

  public List<SelectionPoolDtos.MigrationTaskView> listMigrationTasks(Long userId) {
    return repository.listMigrationTasks(userId);
  }

  public SelectionPoolDtos.MigrationHandoffView getMigrationHandoff(
      Long userId, String taskId) {
    SelectionPoolDtos.MigrationTaskView task = getMigrationTask(userId, taskId);
    List<SelectionPoolDtos.MigrationItemHandoff> items =
        repository.listMigrationHandoffItems(userId, taskId);
    if (items.isEmpty()) throw new ApiException(400, "该任务没有等待发布的商品");
    return new SelectionPoolDtos.MigrationHandoffView(task, items);
  }

  @Transactional
  public SelectionPoolDtos.MigrationHandoffView claimMigrationTask(
      Long userId, String taskId) {
    getMigrationTask(userId, taskId);
    if (repository.claimMigrationTask(userId, taskId) == 0)
      throw new ApiException(400, "该任务已完成，不能再次接管");
    return getMigrationHandoff(userId, taskId);
  }

  @Transactional
  public SelectionPoolDtos.MigrationTaskView updateMigrationItemResult(
      Long userId, String taskId, SelectionPoolDtos.MigrationItemResultRequest request) {
    getMigrationTask(userId, taskId);
    if (request == null || request.sequenceNo() == null || request.sequenceNo() < 1) {
      throw new ApiException(400, "搬家商品序号不正确");
    }
    String status = requireText(request.status(), "搬家结果不能为空", 32)
        .toUpperCase(Locale.ROOT);
    if (!List.of("PUBLISHED", "DRAFTED", "FAILED", "NEEDS_REVIEW").contains(status)) {
      throw new ApiException(400, "不支持的搬家结果：" + status);
    }
    repository.updateMigrationItemResult(
        userId, taskId, request.sequenceNo(), status,
        limit(optional(request.targetProductId()), 128),
        limit(optional(request.targetUrl()), 1024),
        limit(optional(request.errorCode()), 64),
        limit(optional(request.errorMessage()), 1024));
    return getMigrationTask(userId, taskId);
  }

  private UpsertResult upsertWithResult(Long userId, SelectionPoolDtos.ProductUpsertRequest request) {
    if (request == null) throw new ApiException(400, "商品数据不能为空");
    String platform = requireText(request.sourcePlatform(), "来源平台不能为空", 32)
        .toUpperCase(Locale.ROOT);
    String productId = optional(request.sourceProductId());
    if (!StringUtils.hasText(productId)) {
      if (!"LOCAL".equals(platform)) throw new ApiException(400, "来源商品 ID 不能为空");
      productId = "local_" + UUID.randomUUID().toString().replace("-", "");
    }
    productId = limit(productId, 128);
    String title = requireText(request.title(), "商品标题不能为空", 512);
    String sourceUrl = limit(optional(request.sourceUrl()), 1024);
    String cover = limit(optional(request.coverImageUrl()), 1024);
    String collectSource = upperOr(request.collectSource(), "MANUAL");
    if (!COLLECT_SOURCES.contains(collectSource)) throw new ApiException(400, "不支持的入库方式：" + collectSource);
    String collectStatus = upperOr(request.collectStatus(), "COLLECTED");
    if (!COLLECT_STATUSES.contains(collectStatus)) throw new ApiException(400, "不支持的采集状态：" + collectStatus);

    ObjectNode working = asObject(request.productData());
    working.put("sourcePlatform", platform);
    working.put("sourceProductId", productId);
    working.put("title", title);
    if (StringUtils.hasText(sourceUrl)) working.put("sourceUrl", sourceUrl);
    if (StringUtils.hasText(cover)) working.put("coverImageUrl", cover);
    working = standardizeProductData(
        working, platform, productId, title, sourceUrl, cover, collectSource);
    JsonNode raw = request.rawSnapshot() == null ? working.deepCopy() : request.rawSnapshot();
    int qualityScore = request.qualityScore() == null
        ? calculateQuality(title, cover, sourceUrl, working)
        : Math.max(0, Math.min(100, request.qualityScore()));
    String workingJson = writeJson(working);
    String rawJson = writeJson(raw);

    Optional<SelectionProduct> existing = repository.findBySourceKey(userId, platform, productId);
    Long rowId;
    boolean created;
    if (existing.isPresent()) {
      rowId = existing.get().id();
      repository.updateCollected(
          rowId, sourceUrl, title, cover, workingJson, collectSource, collectStatus,
          qualityScore, request.originProductRowId(), optional(request.originProductId()));
      created = false;
    } else {
      rowId = repository.insert(
          userId, platform, productId, sourceUrl, title, cover, workingJson, rawJson,
          collectSource, collectStatus, qualityScore, request.originProductRowId(),
          optional(request.originProductId()));
      created = true;
    }
    repository.insertRevision(rowId, userId, workingJson, rawJson, created ? "CREATE" : "RECOLLECT");
    return new UpsertResult(created, get(userId, rowId));
  }

  private SelectionProduct requireProduct(Long userId, Long id) {
    return repository.findById(userId, id).orElseThrow(() -> new ApiException(404, "商品不存在"));
  }

  private SelectionPoolDtos.ProductView toView(Long userId, SelectionProduct product) {
    return new SelectionPoolDtos.ProductView(
        product.id(), product.sourcePlatform(), product.sourceProductId(), product.sourceUrl(),
        product.title(), product.coverImageUrl(), readJson(product.productData()),
        readJson(product.rawSnapshot()), product.collectSource(), product.collectStatus(),
        product.publishStatus(), product.hasAiEdit(), product.qualityScore(),
        product.originProductRowId(), product.originProductId(), product.lastCollectError(),
        time(product.lastCollectedAt()), time(product.createdAt()), time(product.updatedAt()),
        repository.listTagsForProduct(userId, product.id()));
  }

  private int calculateQuality(String title, String cover, String sourceUrl, JsonNode data) {
    int score = StringUtils.hasText(title) ? 25 : 0;
    if (StringUtils.hasText(cover)) score += 25;
    if (StringUtils.hasText(sourceUrl)) score += 15;
    if (data != null && data.hasNonNull("price") && !data.path("price").asText().isBlank()) score += 20;
    if (data != null && data.path("images").isArray() && !data.path("images").isEmpty()) score += 15;
    return Math.min(100, score);
  }

  private ObjectNode standardizeProductData(
      ObjectNode working,
      String platform,
      String productId,
      String title,
      String sourceUrl,
      String cover,
      String collectSource) {
    working.put("formatVersion", "YOUMI_PRODUCT_V1");
    String productType = optional(working.path("productType").asText());
    if (productType == null) {
      productType = "LOCAL".equalsIgnoreCase(platform) ? "CUSTOM" : "COLLECTED";
    }
    working.put("productType", productType.toUpperCase(Locale.ROOT));
    working.put("title", title);
    working.put("sourcePlatform", platform);
    working.put("sourceProductId", productId);
    if (StringUtils.hasText(sourceUrl)) working.put("sourceUrl", sourceUrl);
    if (StringUtils.hasText(cover)) working.put("coverImageUrl", cover);

    ObjectNode source = objectCopy(working.path("source"));
    source.put("platform", platform);
    source.put("productId", productId);
    if (StringUtils.hasText(sourceUrl)) source.put("url", sourceUrl);
    working.set("source", source);

    ObjectNode category = objectCopy(working.path("category"));
    putTextIfMissing(category, "id", working.path("categoryId").asText());
    putTextIfMissing(category, "name", working.path("categoryName").asText());
    putTextIfMissing(category, "path", working.path("categoryPath").asText());
    working.set("category", category);
    working.put("categoryId", category.path("id").asText(""));
    working.put("categoryName", category.path("name").asText(""));
    working.put("categoryPath", category.path("path").asText(""));

    ObjectNode pricing = objectCopy(working.path("pricing"));
    putTextIfMissing(pricing, "salePrice", working.path("price").asText());
    putTextIfMissing(pricing, "originalPrice", working.path("originalPrice").asText());
    putTextIfMissing(pricing, "currency", "CNY");
    working.set("pricing", pricing);
    working.put("price", pricing.path("salePrice").asText(""));
    working.put("originalPrice", pricing.path("originalPrice").asText(""));

    ObjectNode inventory = objectCopy(working.path("inventory"));
    if (!inventory.has("defaultStock")) {
      inventory.put("defaultStock", Math.max(0, working.path("defaultStock").asInt(0)));
    }
    working.set("inventory", inventory);
    working.put("defaultStock", Math.max(0, inventory.path("defaultStock").asInt(0)));

    ObjectNode media = objectCopy(working.path("media"));
    media.set("mainImages", firstArray(
        media.path("mainImages"), working.path("mainImagesGroup").path("images"), working.path("images")));
    media.set("portraitImages", firstArray(
        media.path("portraitImages"), working.path("threeToFourImages")));
    media.set("skuImages", firstArray(media.path("skuImages"), working.path("skuImages")));
    media.set("detailImages", firstArray(media.path("detailImages"), working.path("detailImages")));
    media.set("mainVideos", firstArray(
        media.path("mainVideos"), working.path("mainVideos"), working.path("videos")));
    media.set("detailVideos", firstArray(media.path("detailVideos"), working.path("detailVideos")));
    working.set("media", media);

    JsonNode attributes = firstObject(working.path("attributes"), working.path("parameters"));
    JsonNode skuGroups = firstArray(
        working.path("skuGroups"), working.path("saleProperties"), working.path("specList"));
    JsonNode skus = firstArray(working.path("skus"), working.path("sku"), working.path("skuList"));
    working.set("attributes", attributes.deepCopy());
    working.set("parameters", attributes.deepCopy());
    working.set("skuGroups", skuGroups.deepCopy());
    working.set("saleProperties", skuGroups.deepCopy());
    working.set("specList", skuGroups.deepCopy());
    working.set("skus", skus.deepCopy());
    working.set("sku", skus.deepCopy());
    working.set("skuList", skus.deepCopy());
    return working;
  }

  private ObjectNode objectCopy(JsonNode value) {
    return value != null && value.isObject()
        ? (ObjectNode) value.deepCopy()
        : objectMapper.createObjectNode();
  }

  private JsonNode firstArray(JsonNode... values) {
    for (JsonNode value : values) {
      if (value != null && value.isArray() && !value.isEmpty()) return value.deepCopy();
    }
    return objectMapper.createArrayNode();
  }

  private JsonNode firstObject(JsonNode... values) {
    for (JsonNode value : values) {
      if (value != null && value.isObject() && !value.isEmpty()) return value.deepCopy();
    }
    return objectMapper.createObjectNode();
  }

  private void putTextIfMissing(ObjectNode node, String field, String value) {
    if (!StringUtils.hasText(node.path(field).asText()) && StringUtils.hasText(value)) {
      node.put(field, value.trim());
    }
  }

  private ObjectNode asObject(JsonNode value) {
    if (value == null || value.isNull()) return objectMapper.createObjectNode();
    if (!value.isObject()) throw new ApiException(400, "productData 必须是 JSON 对象");
    return (ObjectNode) value.deepCopy();
  }

  private JsonNode readJson(String value) {
    if (!StringUtils.hasText(value)) return objectMapper.createObjectNode();
    try {
      return objectMapper.readTree(value);
    } catch (JsonProcessingException exception) {
      return objectMapper.createObjectNode().put("_invalidJson", true);
    }
  }

  private String writeJson(JsonNode value) {
    try {
      return objectMapper.writeValueAsString(value == null ? objectMapper.createObjectNode() : value);
    } catch (JsonProcessingException exception) {
      throw new ApiException(400, "商品 JSON 数据格式错误", exception);
    }
  }

  private void validateBatch(List<?> values, String label) {
    if (values == null || values.isEmpty()) throw new ApiException(400, label + "不能为空");
    if (values.size() > MAX_BATCH_SIZE) throw new ApiException(400, "单批最多处理 " + MAX_BATCH_SIZE + " 个商品");
  }

  private void validateIds(List<Long> ids, String label) {
    validateBatch(ids, label);
    if (ids.stream().anyMatch(id -> id == null || id <= 0)) throw new ApiException(400, label + "包含无效 ID");
  }

  private List<Long> distinct(List<Long> values) {
    return new ArrayList<>(new LinkedHashSet<>(values));
  }

  private String requireText(String value, String message, int maxLength) {
    if (!StringUtils.hasText(value)) throw new ApiException(400, message);
    return limit(value.trim(), maxLength);
  }

  private String optional(String value) {
    return StringUtils.hasText(value) ? value.trim() : null;
  }

  private String upperOptional(String value) {
    String text = optional(value);
    return text == null ? null : text.toUpperCase(Locale.ROOT);
  }

  private String upperOr(String value, String fallback) {
    String text = upperOptional(value);
    return text == null ? fallback : text;
  }

  private String limit(String value, int maxLength) {
    if (value == null) return null;
    return value.length() <= maxLength ? value : value.substring(0, maxLength);
  }

  private String normalizeColor(String value) {
    String color = StringUtils.hasText(value) ? value.trim() : "#7C5CFC";
    return color.matches("^#[0-9a-fA-F]{6}$") ? color.toUpperCase(Locale.ROOT) : "#7C5CFC";
  }

  private String time(LocalDateTime value) {
    return value == null ? null : value.toString();
  }

  private record UpsertResult(boolean created, SelectionPoolDtos.ProductView view) {}
}

