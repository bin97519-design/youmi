package com.youmi.api.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class DashScopeClient {
  private static final Logger log = LoggerFactory.getLogger(DashScopeClient.class);
  private final ObjectMapper objectMapper;
  private final DashScopeProperties properties;
  private final HttpClient httpClient;

  public DashScopeClient(ObjectMapper objectMapper, DashScopeProperties properties) {
    this.objectMapper = objectMapper;
    this.properties = properties;
    this.httpClient = HttpClient.newBuilder()
        .version(HttpClient.Version.HTTP_1_1)
        .connectTimeout(Duration.ofSeconds(Math.max(3, properties.getTimeoutSeconds())))
        .build();
  }

  public boolean isConfigured() {
    return properties.isConfigured();
  }

  public String model() {
    return properties.getModel();
  }

  public List<MiniMaxM3Client.ImageElement> detectImageElements(String imageUrl) throws Exception {
    String system = """
        你是一个高精度的图像元素检测专家。你的任务是输出精确到像素级别的 bounding box 坐标。

        【核心原则：文字框必须 0 误差贴合文字】
        - 文字框的四条边必须严格贴着文字笔画的边缘像素，像裁纸刀切出来的一样
        - 文字框内部不能有不属于该行文字的空白区域
        - 每个框只包含一行文字，绝不合并多行

        【检测规则 — 文字检测（最高优先级）】
        1. 逐行检测，一行 = 一个框：
           - 水平排列的文字行，无论字号大小、颜色深浅、是否倾斜，一行一个框
           - 同一行内文字如果分左右两段对齐（如左对齐标题 + 右对齐价格），检测为一行的一个框
           - 如果两行文字之间有明显行间距（超过字高的一半），必须分两个框
           - 竖排文字同样逐列检测

        2. 文字框坐标精度要求（非常重要）：
           - top：取该行文字最高笔画的顶部坐标。如果是中文，top 必须紧贴"字头"顶部像素
           - bottom：取该行文字最低笔画的底部坐标。中文字底、英文下行字母（g/j/y）底部
           - left：取该行文字最左侧像素的 x 坐标
           - right：取该行文字最右侧像素的 x 坐标
           - 坐标值精确到 0.001（三位小数），不要四舍五入到整数

        3. 文字框常见错误（必须避免）：
           ✘ 框比文字高一倍 → 把上下大片空白包进去了
           ✘ left 坐标偏左很多 → 把左边的空白/装饰区域包进去了
           ✘ right 偏右很多 → 把右边空白包进去了
           ✘ 两行文字合并在一个框里
           ✘ 框太小，文字被裁切了一部分

        4. 特殊文字处理：
           - 品牌Logo中的文字：与Logo一起框（一个整体的Logo框）
           - 水印/半透明文字：也要检测，坐标同样精确
           - 按钮上的文字：单独框文字，不框整个按钮
           - 装饰性花体字：按实际笔画范围框

        【检测规则 — 其他元素】
        5. 人物不拆分：
           - 一个完整的人物（含头、手、身体、腿）→ 只画一个框

        6. 散落物体规则：
           - 散落的每支笔/铅笔/尺子 → 各自一个框
           - 笔筒/笔盒 → 只框容器
           - 空中飞舞的笔 → 单独一个框

        7. 大主体物各一个框（床垫、沙发、桌子等）

        8. 忽略：纯背景、空白区域、装饰线条、阴影、极小的噪点

        【元素命名规则 — 非常重要】
        - 必须用颜色+物体名称的方式命名，让元素更易识别
        - 示例：
          * "蓝色床垫" 而不是 "床垫"
          * "绿色笔" 而不是 "笔"
          * "红色沙发" 而不是 "沙发"
          * "年轻女性" 而不是 "女性"
          * "空中的笔" 而不是 "笔"（表示位置/状态）
          * "白色T恤" 而不是 "T恤"
          * "黑色背包" 而不是 "背包"
        - 如果颜色不明显，可以用材质或状态描述：
          * "皮质沙发"、"木制桌子"、"透明玻璃杯"
          * "飞舞的树叶"、"倒放的杯子"

        【边界精度 — 通用要求】
        - box_2d 必须是最小包围矩形，四边紧贴元素最外侧像素
        - 禁止留空白边距（padding = 0）
        - 禁止裁切到元素内部

        【示例 — 假设图宽 800px 高 1200px】
        以一张电商主图为例：
        - top=0.058 处有一行主标题"爆款直降"（红色字体）→ object_name: "红色主标题", [0.058, 0.190, 0.100, 0.810]
        - top=0.105 处有一行副标题"限时特惠"（白色字体）→ object_name: "白色副标题", [0.105, 0.230, 0.136, 0.770]
        - top=0.130 处有价格"¥199"（红色大字）→ object_name: "红色价格", [0.130, 0.350, 0.170, 0.590]
        - 图片中央有年轻女性 → object_name: "年轻女性", [0.200, 0.250, 0.850, 0.750]
        - 左下角有蓝色沙发 → object_name: "蓝色沙发", [0.600, 0.050, 0.950, 0.450]
        - 沙发上有绿色靠垫 → object_name: "绿色靠垫", [0.650, 0.150, 0.780, 0.350]

        【输出格式】
        - object_name: 元素名称（中文，必须包含颜色/材质/状态描述）
        - **重要**：同一类元素出现多次时，名称必须带数字序号。例如图片中有4行说明文字 → "红色说明文字1" "红色说明文字2" "白色说明文字3" "白色说明文字4"。有3个茶杯 → "白色茶杯1" "白色茶杯2" "蓝色茶杯3"。绝对不允许出现重名。
        - box_2d: [top, left, bottom, right]，0.0~1.0 浮点数，保留 3 位小数
          * 必须满足 top < bottom 且 left < right

        【自检清单（输出前逐项核对）】
        1. 是否所有文字行都已检测？逐行扫视图片，一行都不能漏
        2. 每个文字框的四边是否紧贴文字笔画？有没有留空白？
        3. 有没有把两行合并到一个框里？
        4. 所有坐标都满足 top < bottom 且 left < right？
        5. 所有 object_name 是否唯一？如果出现同名必须加数字序号
        6. 每个元素名称是否包含颜色/材质/状态描述？

        只输出 JSON 数组，不要任何其他文字。""";

    String prompt = """
        请以最高精度检测图中所有元素。

        文字检测（最优先）：逐行框选所有可见文字，一行不漏。每框四边必须紧贴文字笔画像素，不留任何空白边距。行间距明显的必须分行。

        其他元素：人物一个整框、散落笔类各一框、大物各一框。

        【元素命名 — 非常重要】
        - 必须用"颜色+物体名称"方式命名，例如："蓝色床垫"、"绿色笔"、"年轻女性"、"空中的笔"
        - 同类元素出现多次时加数字后缀，例如："绿色笔1" "绿色笔2" "红色笔3"
        - 绝不要出现重复的名字，也不要出现没有颜色/材质描述的名字

        输出前完成自检：是否遗漏文字行？每框是否紧贴文字？是否误合并多行？是否有重名？每个名字是否有颜色描述？

        只输出 JSON 数组。""";

    List<Map<String, Object>> content = new ArrayList<>();
    content.add(Map.of("type", "text", "text", prompt));
    content.add(Map.of("type", "image_url", "image_url", Map.of("url", imageUrl)));

    Map<String, Object> userMessage = new LinkedHashMap<>();
    userMessage.put("role", "user");
    userMessage.put("content", content);

    Map<String, Object> systemMessage = new LinkedHashMap<>();
    systemMessage.put("role", "system");
    systemMessage.put("content", system);

    Map<String, Object> body = new LinkedHashMap<>();
    body.put("model", properties.getModel());
    body.put("max_tokens", Math.max(200, properties.getMaxTokens()));
    body.put("temperature", properties.getTemperature());
    body.put("messages", List.of(systemMessage, userMessage));

    String text = sendChat(body);
    log.info("[detect] DashScope raw response (first 500 chars): {}", text.length() > 500 ? text.substring(0, 500) + "..." : text);

    // 提取 JSON 数组
    String json = extractJsonArray(text);
    if (json == null || json.isBlank()) {
      return List.of();
    }

    JsonNode array = objectMapper.readTree(json);
    log.info("[detect] Parsed {} elements from model response", array.isArray() ? array.size() : 0);
    List<MiniMaxM3Client.ImageElement> elements = new ArrayList<>();
    if (array.isArray()) {
      for (JsonNode node : array) {
        // 兼容多种字段名: box_2d / box.2d / bbox_2d / box2d / bbox
        String name = node.path("object_name").asText(
            node.path("name").asText(
                node.path("object").asText("")));

        JsonNode box = null;
        String boxKey = null;
        for (String key : List.of("box_2d", "box.2d", "bbox_2d", "box2d", "bbox")) {
          JsonNode candidate = node.get(key);
          if (candidate != null && candidate.isArray()) { box = candidate; boxKey = key; break; }
        }

        List<Double> coords = new ArrayList<>();
        if (box != null && box.isArray()) {
          for (JsonNode b : box) {
            coords.add(b.asDouble(0.0));
          }
        }

        if (name.isEmpty() || coords.size() != 4) continue;

        // 去除名称中括号部分（如 "文字 (Text)" → "文字"）
        name = name.replaceAll("\\s*\\([^)]*\\)\\s*", "").trim();

        // Qwen3.7-plus 原生输出 [top, left, bottom, right]（与提示词要求一致）
        // swap 为 [left, top, right, bottom] = [x1, y1, x2, y2]，全链路统一
        List<Double> fixed = new ArrayList<>();
        for (double v : coords) {
          fixed.add(Math.max(0.0, Math.min(1.0, v)));
        }
        // [top, left, bottom, right] → [left, top, right, bottom]
        double tmp0 = fixed.get(0);
        fixed.set(0, fixed.get(1)); // left = 原 left
        fixed.set(1, tmp0);         // top = 原 top
        double tmp2 = fixed.get(2);
        fixed.set(2, fixed.get(3)); // right = 原 right
        fixed.set(3, tmp2);         // bottom = 原 bottom
        // 确保 left < right 且 top < bottom
        if (fixed.get(0) > fixed.get(2)) { double t = fixed.get(0); fixed.set(0, fixed.get(2)); fixed.set(2, t); }
        if (fixed.get(1) > fixed.get(3)) { double t = fixed.get(1); fixed.set(1, fixed.get(3)); fixed.set(3, t); }
        // 保留3位小数
        for (int i = 0; i < 4; i++) {
          fixed.set(i, Math.round(fixed.get(i) * 1000.0) / 1000.0);
        }

        // 日志
        log.info("[detect] {} | key={} | raw={} | fixed=[{},{},{},{}]",
            name, boxKey, coords, fixed.get(0), fixed.get(1), fixed.get(2), fixed.get(3));

        if (isValidBox(fixed)) {
          elements.add(new MiniMaxM3Client.ImageElement(name, fixed));
        }
      }
    }

    // ====== 坐标格式：[x1, y1, x2, y2] = [left, top, right, bottom] ======
    // Qwen 原生输出 [top, left, bottom, right]，已在上方 swap 为 [left, top, right, bottom]
    // 全链路统一使用 [left, top, right, bottom]

    // 元素名称去重：同名字追加编号
    Map<String, Integer> nameCounts = new LinkedHashMap<>();
    for (MiniMaxM3Client.ImageElement el : elements) {
      nameCounts.merge(el.objectName(), 1, Integer::sum);
    }
    Map<String, Integer> nameSeq = new LinkedHashMap<>();
    List<MiniMaxM3Client.ImageElement> deduped = new ArrayList<>();
    for (MiniMaxM3Client.ImageElement el : elements) {
      String n = el.objectName();
      if (nameCounts.get(n) > 1) {
        int seq = nameSeq.merge(n, 1, Integer::sum);
        deduped.add(new MiniMaxM3Client.ImageElement(n + seq, el.box2d()));
      } else {
        deduped.add(el);
      }
    }
    return deduped;
  }

  private String sendChat(Map<String, Object> body) throws Exception {
    String endpoint = properties.normalizedBaseUrl() + properties.normalizedChatPath();
    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(endpoint))
        .timeout(Duration.ofSeconds(Math.max(8, properties.getTimeoutSeconds())))
        .header("Authorization", "Bearer " + properties.getApiKey())
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
        .build();

    HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
    log.info("DashScope response status: {}", response.statusCode());
    if (response.statusCode() >= 300) {
      log.error("DashScope error body: {}", compact(response.body()));
    } else {
      log.debug("DashScope response body: {}", compact(response.body()));
    }
    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      throw new IllegalStateException(
          "DashScope request failed: " + response.statusCode() + " " + compact(response.body()));
    }

    JsonNode root = objectMapper.readTree(response.body());
    String content = readContent(root);
    if (content.isBlank()) {
      throw new IllegalStateException("DashScope returned empty content");
    }
    return content;
  }

  private String readContent(JsonNode root) {
    JsonNode choices = root.path("choices");
    if (choices.isArray() && choices.size() > 0) {
      JsonNode message = choices.get(0).path("message");
      if (!message.isMissingNode()) {
        return message.path("content").asText("").trim();
      }
    }
    return root.path("content").asText("").trim();
  }

  private String extractJsonArray(String text) {
    if (text == null || text.isBlank()) return null;
    int start = text.indexOf('[');
    int end = text.lastIndexOf(']');
    if (start >= 0 && end > start) {
      return text.substring(start, end + 1);
    }
    return null;
  }

  private boolean isValidBox(List<Double> coords) {
    // box_2d = [x1, y1, x2, y2] = [left, top, right, bottom]
    double x1 = coords.get(0);
    double y1 = coords.get(1);
    double x2 = coords.get(2);
    double y2 = coords.get(3);
    if (x1 < -0.01 || y1 < -0.01 || x2 < -0.01 || y2 < -0.01) return false;
    if (x1 > 1.01 || y1 > 1.01 || x2 > 1.01 || y2 > 1.01) return false;
    x1 = Math.max(0, Math.min(1, x1));
    y1 = Math.max(0, Math.min(1, y1));
    x2 = Math.max(0, Math.min(1, x2));
    y2 = Math.max(0, Math.min(1, y2));
    if (x2 <= x1 + 0.0005 || y2 <= y1 + 0.0005) return false;
    double width = x2 - x1;
    double height = y2 - y1;
    double area = width * height;
    // 面积下限放宽：文字可能很小（0.005%），上限仍保持 99%
    if (area < 0.00005 || area > 0.99) return false;
    // 宽高比大幅放宽：文字可能是很长的单行（100:1）或很短的竖排（1:100）
    double ratio = width / Math.max(height, 0.0001);
    if (ratio > 100 || ratio < 0.01) return false;
    return true;
  }

  private String compact(String body) {
    if (body == null || body.isBlank()) return "";
    String compacted = body.replaceAll("\\s+", " ").trim();
    return compacted.length() > 400 ? compacted.substring(0, 400) + "..." : compacted;
  }
}
