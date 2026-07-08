package com.youmi.api.canvas;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.ArrayList;
import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public class CanvasPayload {
  public List<CanvasLayer> layers = new ArrayList<>();
  public List<CanvasChatMessage> chat = new ArrayList<>();
  public CanvasView view = new CanvasView();
  public Object reversePromptLastResult;  // Object: 可能是字符串或嵌套 JSON
  public boolean reversePromptPromptCleared;
  public String reversePromptLastAppliedKey;
  public CanvasUi ui = new CanvasUi();  // 画布级 UI 偏好（视觉框开关等）

  // 以下字段后端仅做透传（序列化/反序列化原样保留），不解析内部结构
  public Object connections;           // 连接线数组 [{id, fromLayerId, fromPort, toLayerId, toPort}]
  public Object generationHistory;     // 生图历史数组 [{id, prompt, model, ratio, resolution, imageUrl, ...}]
  public Object chatConfig;            // 对话窗口模型参数 {model, ratio, resolution}
  public Object detectedElements;      // 视觉框检测结果缓存（按图层ID索引的对象）

  /** 画布级 UI 状态，独立于图层。 */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public static class CanvasUi {
    public boolean detectionVisible = true;  // 视觉框默认显示
  }

  @JsonIgnoreProperties(ignoreUnknown = true)
  public static class CanvasLayer {
    public String id;
    public String name;
    public String url;
    public String thumbnailUrl;
    public int naturalWidth;
    public int naturalHeight;
    public int width;
    public int height;
    public int x;
    public int y;
    public int zIndex;
    public boolean visible;
    public boolean locked;
    public String type;
    public String status;
    public int progress;
    public String statusText;
    public String previewUrl;
    public CanvasLayerDetection detection;  // 视觉框自动识别结果（持久化到画布文档）
  }

  /** 单个图层的视觉框检测结果。检测由前端在图层 onLoad 时自动触发，结果存到后端以便刷新/重启恢复。 */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public static class CanvasLayerDetection {
    public String status;            // pending | done | failed
    public String cacheKey;          // 通常是 layer.url，用于跨画布去重
    public List<CanvasDetectedBox> boxes = new ArrayList<>();
    public long updatedAt;
    public String errorMessage;      // status=failed 时填
  }

  @JsonIgnoreProperties(ignoreUnknown = true)
  public static class CanvasDetectedBox {
    public String name;              // 元素名（来自后端 object_name）
    public List<Double> box2d = new ArrayList<>();  // [top, left, bottom, right] 0~1000 归一化
  }

  @JsonIgnoreProperties(ignoreUnknown = true)
  public static class CanvasChatMessage {
    public String id;
    public String role;
    public String text;
    public long createdAt;
  }

  @JsonIgnoreProperties(ignoreUnknown = true)
  public static class CanvasView {
    public double scale = 1;
    public CanvasOffset offset = new CanvasOffset();
  }

  @JsonIgnoreProperties(ignoreUnknown = true)
  public static class CanvasOffset {
    public int x = 0;
    public int y = 0;
  }
}
