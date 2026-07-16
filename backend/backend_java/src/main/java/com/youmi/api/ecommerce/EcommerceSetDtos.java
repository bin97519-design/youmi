package com.youmi.api.ecommerce;

import java.util.List;
import java.util.Map;

public class EcommerceSetDtos {

  /** 创建策划请求 */
  public record CreatePlanningRequest(
      String productImageUrl,
      String productDescription) {}

  /** 更新策划请求 */
  public record UpdatePlanningRequest(
      Map<String, Object> planningData) {}

  /** 开始生图请求 */
  public record StartGenerationRequest(
      String platform,
      MainImageConfig mainImage,
      DetailPageConfig detailPage,
      String model,
      String textLanguage) {}

  /** 主图配置 */
  public record MainImageConfig(
      String type,
      List<String> sellingPoints,
      int count,
      String ratio) {}

  /** 详情页配置 */
  public record DetailPageConfig(
      String mode,
      String ratio,
      int count,
      String style,
      String notes) {}

  /** 策划响应 */
  public record PlanningResponse(
      String setId,
      PlanningData planning) {}

  /** 生图启动响应 */
  public record GenerationResponse(
      String setId,
      int totalTasks,
      int consumedMi,
      int balance) {}

  /** 进度响应 */
  public record ProgressResponse(
      String setId,
      String status,
      int completed,
      int failed,
      int finished,
      int total,
      List<ProgressItem> items) {}

  /** 单任务进度项 */
  public record ProgressItem(
      String taskId,
      String taskType,
      String sellingPointType,
      String sellingPointTitle,
      String status,
      int progress,
      String imageUrl) {}

  /** 结果响应 */
  public record ResultResponse(
      String setId,
      List<ResultImage> mainImages,
      List<ResultImage> detailPages) {}

  /** 单张结果图片 */
  public record ResultImage(
      long id,
      String taskId,
      String taskType,
      String sellingPointType,
      String sellingPointTitle,
      String imageUrl,
      String thumbnailUrl,
      String status,
      String errorMessage) {}

  /** 单张失败图片重试响应 */
  public record RetryResponse(
      long imageId,
      String status,
      int consumedMi,
      int balance) {}

  /** 当前用户最近生成、可作为产品参考的图片 */
  public record SourceImage(
      String taskId,
      String imageUrl,
      String prompt,
      String createdAt) {}

  /** 画布导入响应 */
  public record CanvasImportResponse(
      String fileUrl,
      String fileName) {}

  /** 策划数据（AI 返回的结构化数据） */
  public record PlanningData(
      String productName,
      String category,
      String material,
      String craftsmanship,
      List<SellingPoint> sellingPoints,
      String audienceProfile,
      List<String> usageScenarios) {}

  /** 单个卖点 */
  public record SellingPoint(
      String type,
      String title,
      String description,
      String visualDirection) {}
}
