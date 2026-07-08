package com.youmi.api.ecommerce;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "youmi.ecommerce-set")
public class EcommerceSetProperties {
  private int maxConcurrent = 3;
  private int retryCount = 2;
  private String defaultModel = "gpt-image-2";
  private String planningModel = "qwen3.7-plus";
  private long pollIntervalMs = 2000;
  private String planningSystemPrompt = DEFAULT_PLANNING_PROMPT;
  private Map<String, String> sellingPointTemplates = new LinkedHashMap<>();

  private static final String DEFAULT_PLANNING_PROMPT = """
      你是电商产品策划专家。根据用户提供的产品图片和描述，生成结构化的电商套图策划方案。

      必须输出严格的JSON格式，不要输出任何JSON之外的内容：
      {
        "productName": "产品名称",
        "category": "品类",
        "material": "材质",
        "craftsmanship": "工艺",
        "sellingPoints": [
          {
            "type": "core",
            "title": "卖点标题",
            "description": "卖点描述（用于生图prompt构建）",
            "visualDirection": "画面视觉方向指导"
          }
        ],
        "audienceProfile": "人群画像描述",
        "usageScenarios": ["场景1", "场景2"]
      }

      sellingPoints的type必须是以下之一：
      - core: 核心卖点（产品最突出的优势）
      - scene: 使用场景（产品在实际生活中的应用）
      - sku_white_bg: 白底SKU展示图
      - product_size: 产品尺寸对比展示
      - product_detail: 产品细节特写
      - scene_render: 场景渲染效果图
      - function_demo: 功能演示展示
      - material_craft: 材质工艺展示
      - spec_param: 规格参数展示
      - product_compare: 产品对比展示
      - gift_box: 礼盒赠品展示
      - festival_promo: 节日大促氛围图

      要求：
      1. 至少生成5个不同类型的卖点
      2. 每个卖点的description要详细，包含产品特征和视觉要素
      3. visualDirection要具体指导画面构图、色调、氛围
      4. 根据产品特性选择最合适的卖点类型组合
      """;

  public EcommerceSetProperties() {
    sellingPointTemplates.put("core", "突出产品核心卖点，{description}，{visualDirection}");
    sellingPointTemplates.put("scene", "展示产品使用场景，{description}，{visualDirection}");
    sellingPointTemplates.put("sku_white_bg", "白底SKU展示图，产品居中，{visualDirection}");
    sellingPointTemplates.put("product_size", "产品尺寸对比展示，{description}，{visualDirection}");
    sellingPointTemplates.put("product_detail", "产品细节特写，{description}，{visualDirection}");
    sellingPointTemplates.put("scene_render", "场景渲染效果图，{description}，{visualDirection}");
    sellingPointTemplates.put("function_demo", "功能演示展示，{description}，{visualDirection}");
    sellingPointTemplates.put("material_craft", "材质工艺展示，{description}，{visualDirection}");
    sellingPointTemplates.put("spec_param", "规格参数展示，{description}，{visualDirection}");
    sellingPointTemplates.put("product_compare", "产品对比展示，{description}，{visualDirection}");
    sellingPointTemplates.put("gift_box", "礼盒赠品展示，{description}，{visualDirection}");
    sellingPointTemplates.put("festival_promo", "节日大促氛围图，{description}，{visualDirection}");
  }

  public int getMaxConcurrent() {
    return maxConcurrent;
  }

  public void setMaxConcurrent(int maxConcurrent) {
    this.maxConcurrent = maxConcurrent;
  }

  public int getRetryCount() {
    return retryCount;
  }

  public void setRetryCount(int retryCount) {
    this.retryCount = retryCount;
  }

  public String getDefaultModel() {
    return defaultModel;
  }

  public void setDefaultModel(String defaultModel) {
    this.defaultModel = defaultModel;
  }

  public String getPlanningModel() {
    return planningModel;
  }

  public void setPlanningModel(String planningModel) {
    this.planningModel = planningModel;
  }

  public long getPollIntervalMs() {
    return pollIntervalMs;
  }

  public void setPollIntervalMs(long pollIntervalMs) {
    this.pollIntervalMs = pollIntervalMs;
  }

  public String getPlanningSystemPrompt() {
    return planningSystemPrompt;
  }

  public void setPlanningSystemPrompt(String planningSystemPrompt) {
    this.planningSystemPrompt = planningSystemPrompt;
  }

  public Map<String, String> getSellingPointTemplates() {
    return sellingPointTemplates;
  }

  public void setSellingPointTemplates(Map<String, String> sellingPointTemplates) {
    this.sellingPointTemplates = sellingPointTemplates == null ? new LinkedHashMap<>() : sellingPointTemplates;
  }
}
