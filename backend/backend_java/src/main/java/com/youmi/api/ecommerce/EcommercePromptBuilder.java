package com.youmi.api.ecommerce;

import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * 电商套图 prompt 构建服务。
 * 将策划卖点转化为生图 prompt。
 */
@Service
public class EcommercePromptBuilder {
  private static final Logger log = LoggerFactory.getLogger(EcommercePromptBuilder.class);

  private final EcommerceSetProperties properties;

  public EcommercePromptBuilder(EcommerceSetProperties properties) {
    this.properties = properties;
  }

  /**
   * 根据卖点构建主图生图 prompt。
   *
   * @param sellingPoint 卖点
   * @param planning     完整策划数据
   * @param config       主图配置
   * @param platform     电商平台（tmall/jd/pdd 等）
   * @return 生图 prompt
   */
  public String buildMainImagePrompt(
      EcommerceSetDtos.SellingPoint sellingPoint,
      EcommerceSetDtos.PlanningData planning,
      EcommerceSetDtos.MainImageConfig config,
      String platform) {
    String template = getSellingPointTemplate(sellingPoint.type());
    String prompt = template
        .replace("{description}", sellingPoint.description())
        .replace("{visualDirection}", sellingPoint.visualDirection());

    // 加入产品基础信息增强 prompt
    StringBuilder sb = new StringBuilder();
    sb.append("产品：").append(planning.productName());

    if (planning.category() != null && !planning.category().isBlank()) {
      sb.append("，品类：").append(planning.category());
    }
    if (planning.material() != null && !planning.material().isBlank()) {
      sb.append("，材质：").append(planning.material());
    }

    sb.append("。").append(prompt);

    // 平台规范约束
    sb.append(applyPlatformConstraints(platform, "main_image"));

    // 主图通用质量要求
    sb.append(" 高清商品摄影风格，专业打光，构图精准，色彩准确还原。");

    log.debug("[prompt] main image for sellingPoint type={}: {}", sellingPoint.type(), compact(sb.toString()));
    return sb.toString();
  }

  /**
   * 根据策划数据构建详情页生图 prompt。
   *
   * @param planning 完整策划数据
   * @param config   详情页配置
   * @param platform 电商平台
   * @return 生图 prompt
   */
  public String buildDetailPagePrompt(
      EcommerceSetDtos.PlanningData planning,
      EcommerceSetDtos.DetailPageConfig config,
      String platform) {
    StringBuilder sb = new StringBuilder();

    sb.append("电商详情页设计：").append(planning.productName());

    if (planning.category() != null && !planning.category().isBlank()) {
      sb.append("，").append(planning.category());
    }
    if (planning.material() != null && !planning.material().isBlank()) {
      sb.append("，").append(planning.material());
    }
    if (planning.craftsmanship() != null && !planning.craftsmanship().isBlank()) {
      sb.append("，").append(planning.craftsmanship());
    }

    // 详列卖点
    List<EcommerceSetDtos.SellingPoint> points = planning.sellingPoints();
    if (points != null && !points.isEmpty()) {
      sb.append("。核心卖点：");
      for (int i = 0; i < points.size(); i++) {
        if (i > 0) sb.append("；");
        sb.append(points.get(i).title());
      }
    }

    // 使用场景
    List<String> scenarios = planning.usageScenarios();
    if (scenarios != null && !scenarios.isEmpty()) {
      sb.append("。使用场景：");
      sb.append(String.join("、", scenarios));
    }

    // 详情页风格
    String mode = config != null && config.mode() != null ? config.mode() : "comprehensive";
    sb.append("。详情页风格：");
    switch (mode) {
      case "minimalist" -> sb.append("极简风格，留白充足，突出产品本身");
      case "luxury" -> sb.append("奢华风格，高级质感，暗调光影");
      case "lifestyle" -> sb.append("生活方式风格，场景融入，温馨氛围");
      default -> sb.append("综合风格，信息丰富，层次分明");
    }

    // 平台规范
    sb.append(applyPlatformConstraints(platform, "detail_page"));

    // 详情页通用质量要求
    sb.append(" 专业电商详情页排版，高清产品图，统一色调，规范字体。");

    log.debug("[prompt] detail page: {}", compact(sb.toString()));
    return sb.toString();
  }

  /**
   * 获取卖点模板，不存在则使用默认模板。
   */
  private String getSellingPointTemplate(String type) {
    Map<String, String> templates = properties.getSellingPointTemplates();
    if (type != null && templates.containsKey(type)) {
      return templates.get(type);
    }
    return "电商产品展示图，{description}，{visualDirection}";
  }

  /**
   * 根据平台类型追加约束条件。
   */
  private String applyPlatformConstraints(String platform, String imageType) {
    if (platform == null || platform.isBlank()) return "";
    StringBuilder sb = new StringBuilder();
    String p = platform.trim().toLowerCase();

    switch (p) {
      case "tmall", "天猫" -> {
        if ("main_image".equals(imageType)) {
          sb.append(" 天猫主图规范：白底图优先，图片清晰无水印，品牌Logo左上角。");
        } else {
          sb.append(" 天猫详情页规范：宽度790px，品牌统一调性。");
        }
      }
      case "jd", "京东" -> {
        if ("main_image".equals(imageType)) {
          sb.append(" 京东主图规范：白底图，无水印无拼图，产品居中展示。");
        } else {
          sb.append(" 京东详情页规范：宽度750px，白底为主。");
        }
      }
      case "pdd", "拼多多" -> {
        if ("main_image".equals(imageType)) {
          sb.append(" 拼多多主图规范：背景简洁，卖点文字突出，价格醒目。");
        } else {
          sb.append(" 拼多多详情页规范：信息直白，促销氛围强。");
        }
      }
      case "douyin", "抖音" -> {
        sb.append(" 抖音电商风格：年轻潮流，视觉冲击力强，短视频封面感。");
      }
      default -> {
        // 通用规范
        sb.append(" 电商平台通用规范：图片清晰，无水印，产品展示规范。");
      }
    }
    return sb.toString();
  }

  private String compact(String text) {
    if (text == null || text.isBlank()) return "";
    String compacted = text.replaceAll("\\s+", " ").trim();
    return compacted.length() > 200 ? compacted.substring(0, 200) + "..." : compacted;
  }
}
