package com.youmi.api.prompt;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

@Service
public class ReversePromptTemplateService {
  private final Map<String, Template> templates = buildTemplates();

  public Template get(String category) {
    if (category == null || category.isBlank()) return templates.get("general");
    return templates.getOrDefault(category.trim(), templates.get("general"));
  }

  public List<ReversePromptDtos.CategoryMeta> categories() {
    return templates.entrySet().stream()
        .map(entry -> {
          Template template = entry.getValue();
          return new ReversePromptDtos.CategoryMeta(
              entry.getKey(),
              template.label(),
              template.groups(),
              template.fieldLabels());
        })
        .toList();
  }

  private Map<String, Template> buildTemplates() {
    Map<String, Template> map = new LinkedHashMap<>();
    map.put("general", new Template("通用", generalPrompt(), generalGroups(), generalLabels()));
    map.put("mattress", new Template("床垫", mattressPrompt(), mattressGroups(), mattressLabels()));
    map.put("curtain", new Template("窗帘", curtainPrompt(), curtainGroups(), curtainLabels()));
    map.put("solid_wood_bed", new Template("实木床", solidWoodBedPrompt(), solidWoodBedGroups(), solidWoodBedLabels()));
    return map;
  }

  private String generalPrompt() {
    return """
        【角色与任务】
        你是一位顶级的计算机视觉分析师与图像生成引擎专家。你的任务是深度解析用户上传的参考图，提取所有视觉与空间特征，并严格且仅以 JSON 格式输出解析结果。

        【解析维度与数据结构】
        请输出合法 JSON 对象，字段必须包含：
        {
          "visual_style": {"overall_tone": "", "texture_medium": ""},
          "subject_and_elements": {"core_subject": "", "auxiliary_props": ""},
          "composition_and_camera": {"aspect_ratio": "", "spatial_layout": "", "camera_angle": ""},
          "lighting_and_color": {"background_material": "", "lighting_logic": "", "color_palette": ""},
          "typography_layout": [{"position": "", "font_style": "", "alignment": "", "text_content": ""}]
        }

        【严格输出要求】
        仅输出 JSON，不要解释，不要 Markdown 代码块。所有值使用中文。没有文字时 typography_layout 返回 []。
        """;
  }

  private String mattressPrompt() {
    return """
        【角色与任务】
        你是一位顶级的计算机视觉分析师与图像生成引擎专家，专精于电商床垫产品的视觉拆解与 AI 生图提示词输出。请深度解析参考图，输出可直接用于电商主图和详情页生图的结构化 JSON。

        【解析维度与数据结构】
        请输出合法 JSON 对象，字段必须包含：
        {
          "visual_style": {"overall_tone": "", "texture_medium": ""},
          "subject_and_elements": {"core_subject": "", "auxiliary_props": ""},
          "composition_and_camera": {"display_type": "", "product_angle": "", "aspect_ratio": "", "spatial_layout": "", "camera_angle": "", "shadow_style": "", "text_space": ""},
          "lighting_and_color": {"background_material": "", "lighting_logic": "", "color_palette": ""},
          "mattress_surface": {"fabric_type": "", "pattern": "", "color_main": "", "color_secondary": "", "quilt_style": "", "border_detail": "", "thickness": ""},
          "mattress_structure": {"layer_structure": "", "side_surface": ""},
          "typography_layout": [{"position": "", "font_style": "", "alignment": "", "text_content": ""}]
        }

        【专业要求】
        床垫面料、图案花纹、主辅色需尽量给出准确描述，颜色给色名和 HEX 近似值；绗缝、包边、厚度、分层、侧面外观要用指令性中文描述。
        【严格输出要求】
        仅输出 JSON，不要解释，不要 Markdown 代码块。没有文字时 typography_layout 返回 []。
        """;
  }

  private String curtainPrompt() {
    return """
        【角色与任务】
        你是一位顶级的计算机视觉分析师与图像生成引擎专家，专精于电商窗帘产品的视觉拆解与 AI 生图提示词输出。请深度解析参考图，输出可直接用于电商主图和详情页生图的结构化 JSON。

        【解析维度与数据结构】
        请输出合法 JSON 对象，字段必须包含：
        {
          "visual_style": {"overall_tone": "", "texture_medium": ""},
          "subject_and_elements": {"core_subject": "", "auxiliary_props": ""},
          "composition_and_camera": {"display_type": "", "product_angle": "", "aspect_ratio": "", "spatial_layout": "", "camera_angle": "", "shadow_style": "", "text_space": ""},
          "lighting_and_color": {"background_material": "", "lighting_logic": "", "color_palette": ""},
          "curtain_detail": {"fabric_type": "", "pattern": "", "color_main": "", "color_secondary": "", "edge_detail": "", "header_style": "", "thickness": ""},
          "curtain_drape": {"fold_type": "", "opening_state": "", "drape_direction": ""},
          "curtain_scene": {"room_style": "", "wall_color": "", "floor_material": "", "furniture_visible": "", "lighting_source": ""},
          "typography_layout": [{"position": "", "font_style": "", "alignment": "", "text_content": ""}]
        }

        【专业要求】
        窗帘面料、花纹、主辅色、帘边、帘头、厚度、褶皱、开合状态、垂坠方向和空间搭配要具体可执行，颜色给色名和 HEX 近似值。
        【严格输出要求】
        仅输出 JSON，不要解释，不要 Markdown 代码块。没有文字时 typography_layout 返回 []。
        """;
  }

  private String solidWoodBedPrompt() {
    return """
        【角色与任务】
        你是一位顶级的计算机视觉分析师与图像生成引擎专家，专精于电商实木床产品的视觉拆解与 AI 生图提示词输出。请深度解析参考图，输出可直接用于电商主图和详情页生图的结构化 JSON。

        【解析维度与数据结构】
        请输出合法 JSON 对象，字段必须包含：
        {
          "visual_style": {"overall_tone": "", "texture_medium": ""},
          "subject_and_elements": {"core_subject": "", "auxiliary_props": ""},
          "composition_and_camera": {"display_type": "", "product_angle": "", "aspect_ratio": "", "spatial_layout": "", "camera_angle": "", "shadow_style": "", "text_space": ""},
          "lighting_and_color": {"background_material": "", "lighting_logic": "", "color_palette": ""},
          "bed_wood": {"wood_species": "", "wood_color": "", "wood_grain": "", "surface_finish": "", "carving_detail": "", "headboard_shape": "", "headboard_height": ""},
          "bed_structure": {"frame_style": "", "leg_design": "", "footboard": "", "side_rail": "", "slat_type": "", "mattress_visible": ""},
          "typography_layout": [{"position": "", "font_style": "", "alignment": "", "text_content": ""}]
        }

        【专业要求】
        木材品种、木色、木纹、表面工艺、床头造型、床架结构、床腿、床尾、床板和可见床垫要具体可执行，颜色给色名和 HEX 近似值。
        【严格输出要求】
        仅输出 JSON，不要解释，不要 Markdown 代码块。没有文字时 typography_layout 返回 []。
        """;
  }

  private List<ReversePromptDtos.GroupMeta> generalGroups() {
    return List.of(
        new ReversePromptDtos.GroupMeta("画面氛围", List.of("visual_style", "composition_and_camera", "lighting_and_color")),
        new ReversePromptDtos.GroupMeta("核心主体", List.of("subject_and_elements")),
        new ReversePromptDtos.GroupMeta("文字排版", List.of("typography_layout")));
  }

  private List<ReversePromptDtos.GroupMeta> mattressGroups() {
    return List.of(
        new ReversePromptDtos.GroupMeta("画面氛围", List.of("visual_style", "composition_and_camera", "lighting_and_color")),
        new ReversePromptDtos.GroupMeta("核心主体", List.of("subject_and_elements")),
        new ReversePromptDtos.GroupMeta("床垫专业", List.of("mattress_surface", "mattress_structure")),
        new ReversePromptDtos.GroupMeta("文字排版", List.of("typography_layout")));
  }

  private List<ReversePromptDtos.GroupMeta> curtainGroups() {
    return List.of(
        new ReversePromptDtos.GroupMeta("画面氛围", List.of("visual_style", "composition_and_camera", "lighting_and_color")),
        new ReversePromptDtos.GroupMeta("核心主体", List.of("subject_and_elements")),
        new ReversePromptDtos.GroupMeta("窗帘专业", List.of("curtain_detail", "curtain_drape", "curtain_scene")),
        new ReversePromptDtos.GroupMeta("文字排版", List.of("typography_layout")));
  }

  private List<ReversePromptDtos.GroupMeta> solidWoodBedGroups() {
    return List.of(
        new ReversePromptDtos.GroupMeta("画面氛围", List.of("visual_style", "composition_and_camera", "lighting_and_color")),
        new ReversePromptDtos.GroupMeta("核心主体", List.of("subject_and_elements")),
        new ReversePromptDtos.GroupMeta("实木床专业", List.of("bed_wood", "bed_structure")),
        new ReversePromptDtos.GroupMeta("文字排版", List.of("typography_layout")));
  }

  private Map<String, String> generalLabels() {
    Map<String, String> labels = baseLabels();
    labels.put("visual_style", "视觉风格");
    labels.put("subject_and_elements", "主体与元素");
    labels.put("composition_and_camera", "构图与镜头");
    labels.put("lighting_and_color", "光线与色彩");
    labels.put("typography_layout", "文字排版");
    labels.put("overall_tone", "整体调性");
    labels.put("texture_medium", "媒介质感");
    labels.put("core_subject", "核心主体");
    labels.put("auxiliary_props", "辅助元素");
    labels.put("aspect_ratio", "画幅比例");
    labels.put("spatial_layout", "空间布局");
    labels.put("camera_angle", "镜头角度");
    labels.put("background_material", "背景材质");
    labels.put("lighting_logic", "光照逻辑");
    labels.put("color_palette", "色彩方案");
    return labels;
  }

  private Map<String, String> mattressLabels() {
    Map<String, String> labels = generalLabels();
    labels.put("mattress_surface", "面层细节");
    labels.put("mattress_structure", "结构分区");
    labels.put("display_type", "展示类型");
    labels.put("product_angle", "产品角度");
    labels.put("shadow_style", "阴影样式");
    labels.put("text_space", "留白方向");
    labels.put("fabric_type", "面料材质");
    labels.put("pattern", "图案花纹");
    labels.put("color_main", "主色+HEX");
    labels.put("color_secondary", "辅色+HEX");
    labels.put("quilt_style", "绗缝工艺");
    labels.put("border_detail", "边缘处理");
    labels.put("thickness", "厚度体感");
    labels.put("layer_structure", "分层结构");
    labels.put("side_surface", "侧面外观");
    return labels;
  }

  private Map<String, String> curtainLabels() {
    Map<String, String> labels = mattressLabels();
    labels.put("curtain_detail", "帘面细节");
    labels.put("curtain_drape", "褶皱垂坠");
    labels.put("curtain_scene", "搭配场景");
    labels.put("edge_detail", "帘边处理");
    labels.put("header_style", "帘头款式");
    labels.put("fold_type", "褶皱类型");
    labels.put("opening_state", "开合状态");
    labels.put("drape_direction", "垂坠方向");
    labels.put("room_style", "空间风格");
    labels.put("wall_color", "墙面颜色");
    labels.put("floor_material", "地面材质");
    labels.put("furniture_visible", "可见家具");
    labels.put("lighting_source", "场景光源");
    return labels;
  }

  private Map<String, String> solidWoodBedLabels() {
    Map<String, String> labels = mattressLabels();
    labels.put("bed_wood", "木材质感");
    labels.put("bed_structure", "床架结构");
    labels.put("wood_species", "木材品种");
    labels.put("wood_color", "木色+HEX");
    labels.put("wood_grain", "木纹特征");
    labels.put("surface_finish", "表面工艺");
    labels.put("carving_detail", "雕花装饰");
    labels.put("headboard_shape", "床头造型");
    labels.put("headboard_height", "床头高度");
    labels.put("frame_style", "床架款式");
    labels.put("leg_design", "床腿设计");
    labels.put("footboard", "床尾设计");
    labels.put("side_rail", "床侧/床帮");
    labels.put("slat_type", "床板类型");
    labels.put("mattress_visible", "可见床垫");
    return labels;
  }

  private Map<String, String> baseLabels() {
    Map<String, String> labels = new LinkedHashMap<>();
    labels.put("position", "文字位置");
    labels.put("font_style", "字体风格");
    labels.put("alignment", "对齐方式");
    labels.put("text_content", "文字内容");
    return labels;
  }

  public record Template(
      String label,
      String systemPrompt,
      List<ReversePromptDtos.GroupMeta> groups,
      Map<String, String> fieldLabels) {}
}
