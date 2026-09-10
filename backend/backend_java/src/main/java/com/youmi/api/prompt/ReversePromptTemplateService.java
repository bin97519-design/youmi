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
          "content_role": {"display_type": "", "conversion_goal": "", "visual_focus": ""},
          "visual_style": {"overall_tone": "", "texture_medium": ""},
          "subject_and_elements": {"core_subject": "", "auxiliary_props": ""},
          "product_identity": {"category": "", "silhouette": "", "proportion": "", "apparent_thickness": "", "display_state": "", "surface_pattern": "", "edge_binding": "", "color_zones": "", "visible_markings": "", "fold_structure": "", "count": "", "accessories": "", "unknown_facts": ""},
          "composition_and_camera": {"aspect_ratio": "", "spatial_layout": "", "camera_angle": "", "product_bbox": "", "product_occupancy": "", "crop_relation": "", "depth_layers": ""},
          "scene_and_environment": {"scene_type": "", "background": "", "foreground": "", "midground": "", "props": "", "surface_material": "", "depth_of_field": ""},
          "people_and_actions": [{"count": "", "demographic": "", "wardrobe": "", "bbox": "", "pose": "", "action": "", "gaze": "", "product_relation": ""}],
          "lighting_and_color": {"background_material": "", "key_light_direction": "", "light_softness": "", "shadow_logic": "", "color_temperature": "", "brightness_contrast": "", "color_palette": [{"name": "", "hex": "", "ratio": ""}]},
          "typography_layout": [{"block_type": "", "bbox": "", "font_style": "", "font_weight": "", "font_color": "", "alignment": "", "hierarchy": "", "text_content": "", "brand_content": ""}],
          "generation_prompt": "",
          "negative_prompt": ""
        }

        【视觉指纹要求】
        content_role 必须判断本图是首屏主视觉、场景体验、整体展示、细节拼图、材质微距、结构分层、功能说明或组合对比，并说明唯一视觉焦点。product_identity 只记录图片直接可见的产品事实：轮廓、长宽比例、厚度体感、摆放/折叠状态、表面纹理、包边、色块、可见印花标记、数量和配件；不可见的内部层数、材质和参数必须写入 unknown_facts，不得推断。所有 bbox 使用画面左上角为原点的 x,y,w,h 百分比（0-100）。准确记录主体占比、裁切、前中后景、人物数量与位置、非特定人群特征、穿搭、姿态、动作、视线和人物与产品关系；无人物时 people_and_actions 返回 []。记录主光方向、软硬、阴影、近似色温、明暗对比及主辅色 HEX 与面积比例。文字块必须逐块记录版式几何与字体气质，并将品牌、Logo、价格、认证和水印放入 brand_content 标识。

        【生图提示词要求】
        generation_prompt 必须是一段可直接提交给图像生成模型的完整中文提示词，长度 200-500 字。按主体、场景、构图、镜头、光线、色彩、材质和文字排版组织，准确描述需要保持的主体结构、比例、材质、视角及画面文字。不得出现 JSON 字段名、分析过程或“高级感”“好看”等空泛词。
        negative_prompt 必须用中文列出需要避免的主体变形、比例错误、材质错误、透视错误、乱码、水印、Logo 和多余元素。

        【严格输出要求】
        仅输出 JSON，不要解释，不要 Markdown 代码块。所有值使用中文。没有文字时 typography_layout 返回 []。generation_prompt 和 negative_prompt 必须是字符串。
        """;
  }

  private String mattressPrompt() {
    return """
        【角色与任务】
        你是一位顶级的计算机视觉分析师与图像生成引擎专家，专精于电商床垫产品的视觉拆解与 AI 生图提示词输出。请深度解析参考图，输出可直接用于电商主图和详情页生图的结构化 JSON。

        【解析维度与数据结构】
        请输出合法 JSON 对象，字段必须包含：
        {
          "content_role": {"display_type": "", "conversion_goal": "", "visual_focus": ""},
          "visual_style": {"overall_tone": "", "texture_medium": ""},
          "subject_and_elements": {"core_subject": "", "auxiliary_props": ""},
          "product_identity": {"category": "", "silhouette": "", "proportion": "", "apparent_thickness": "", "display_state": "", "surface_pattern": "", "edge_binding": "", "color_zones": "", "visible_markings": "", "fold_structure": "", "count": "", "accessories": "", "unknown_facts": ""},
          "composition_and_camera": {"display_type": "", "product_angle": "", "aspect_ratio": "", "spatial_layout": "", "camera_angle": "", "shadow_style": "", "text_space": "", "product_bbox": "", "product_occupancy": "", "crop_relation": "", "depth_layers": ""},
          "scene_and_environment": {"scene_type": "", "background": "", "foreground": "", "midground": "", "props": "", "surface_material": "", "depth_of_field": ""},
          "people_and_actions": [{"count": "", "demographic": "", "wardrobe": "", "bbox": "", "pose": "", "action": "", "gaze": "", "product_relation": ""}],
          "lighting_and_color": {"background_material": "", "key_light_direction": "", "light_softness": "", "shadow_logic": "", "color_temperature": "", "brightness_contrast": "", "color_palette": [{"name": "", "hex": "", "ratio": ""}]},
          "mattress_surface": {"fabric_type": "", "pattern": "", "color_main": "", "color_secondary": "", "quilt_style": "", "border_detail": "", "thickness": ""},
          "mattress_structure": {"layer_structure": "", "side_surface": ""},
          "typography_layout": [{"block_type": "", "bbox": "", "font_style": "", "font_weight": "", "font_color": "", "alignment": "", "hierarchy": "", "text_content": "", "brand_content": ""}],
          "generation_prompt": "",
          "negative_prompt": ""
        }

        【专业要求】
        床垫面料、图案花纹、主辅色需尽量给出准确描述，颜色给色名和 HEX 近似值；绗缝、包边、厚度、折叠和侧面外观要用指令性中文描述。product_identity 只记录图片直接可见的轮廓、长宽比例、厚度体感、折叠状态、表面纹理、包边、色块、可见印花标记、数量和配件；图片未展示截面时 mattress_structure.layer_structure 必须为空，并把内部层数与材质列入 unknown_facts，禁止推断。content_role 必须识别本图唯一展示任务。所有 bbox 使用 x,y,w,h 百分比（0-100）；准确记录产品占比与展示状态、人物数量与位置、非特定人群特征、穿搭、姿态动作、人物与床垫关系、完整场景道具与前中后景。无人物时 people_and_actions 返回 []。记录主光方向、软硬、阴影、近似色温、明暗对比、主辅色 HEX 与面积比例；文字逐块记录几何位置和字体层级，品牌、Logo、价格、认证和水印写入 brand_content。
        【生图提示词要求】
        generation_prompt 必须是一段可直接提交给图像生成模型的完整中文提示词，长度 200-500 字。按床垫主体、面料与纹理、床垫结构、场景、构图、镜头、光线、色彩和文字排版组织，明确需要保持的产品结构、比例、材质、视角及画面文字。不得出现 JSON 字段名、分析过程或空泛形容词。
        negative_prompt 必须用中文列出需要避免的床垫结构变形、绗缝错乱、材质失真、比例错误、透视错误、乱码、水印、Logo 和多余元素。

        【严格输出要求】
        仅输出 JSON，不要解释，不要 Markdown 代码块。没有文字时 typography_layout 返回 []。generation_prompt 和 negative_prompt 必须是字符串。
        """;
  }

  private String curtainPrompt() {
    return """
        【角色与任务】
        你是一位顶级的计算机视觉分析师与图像生成引擎专家，专精于电商窗帘产品的视觉拆解与 AI 生图提示词输出。请深度解析参考图，输出可直接用于电商主图和详情页生图的结构化 JSON。

        【解析维度与数据结构】
        请输出合法 JSON 对象，字段必须包含：
        {
          "content_role": {"display_type": "", "conversion_goal": "", "visual_focus": ""},
          "visual_style": {"overall_tone": "", "texture_medium": ""},
          "subject_and_elements": {"core_subject": "", "auxiliary_props": ""},
          "product_identity": {"category": "", "silhouette": "", "proportion": "", "apparent_thickness": "", "display_state": "", "surface_pattern": "", "edge_binding": "", "color_zones": "", "visible_markings": "", "fold_structure": "", "count": "", "accessories": "", "unknown_facts": ""},
          "composition_and_camera": {"display_type": "", "product_angle": "", "aspect_ratio": "", "spatial_layout": "", "camera_angle": "", "shadow_style": "", "text_space": "", "product_bbox": "", "product_occupancy": "", "crop_relation": "", "depth_layers": ""},
          "scene_and_environment": {"scene_type": "", "background": "", "foreground": "", "midground": "", "props": "", "surface_material": "", "depth_of_field": ""},
          "people_and_actions": [{"count": "", "demographic": "", "wardrobe": "", "bbox": "", "pose": "", "action": "", "gaze": "", "product_relation": ""}],
          "lighting_and_color": {"background_material": "", "key_light_direction": "", "light_softness": "", "shadow_logic": "", "color_temperature": "", "brightness_contrast": "", "color_palette": [{"name": "", "hex": "", "ratio": ""}]},
          "curtain_detail": {"fabric_type": "", "pattern": "", "color_main": "", "color_secondary": "", "edge_detail": "", "header_style": "", "thickness": ""},
          "curtain_drape": {"fold_type": "", "opening_state": "", "drape_direction": ""},
          "curtain_scene": {"room_style": "", "wall_color": "", "floor_material": "", "furniture_visible": "", "lighting_source": ""},
          "typography_layout": [{"block_type": "", "bbox": "", "font_style": "", "font_weight": "", "font_color": "", "alignment": "", "hierarchy": "", "text_content": "", "brand_content": ""}],
          "generation_prompt": "",
          "negative_prompt": ""
        }

        【专业要求】
        窗帘面料、花纹、主辅色、帘边、帘头、厚度、褶皱、开合状态、垂坠方向和空间搭配要具体可执行，颜色给色名和 HEX 近似值。product_identity 只记录图片直接可见的轮廓、比例、厚度、褶皱/开合、纹理、帘边、色块、标记和配件，不可见材质参数写入 unknown_facts，不得推断。content_role 必须识别唯一展示任务；所有 bbox 使用 x,y,w,h 百分比（0-100）。准确记录主体占比、人物非特定特征与动作、人物和窗帘关系、场景道具与前中后景；无人物时 people_and_actions 返回 []。记录光线方向、软硬、阴影、近似色温、明暗对比、主辅色 HEX 与面积比例；文字逐块记录几何位置和字体层级，品牌资产写入 brand_content。
        【生图提示词要求】
        generation_prompt 必须是一段可直接提交给图像生成模型的完整中文提示词，长度 200-500 字。按窗帘主体、面料与褶皱、开合状态、室内场景、构图、镜头、光线、色彩和文字排版组织，明确需要保持的产品结构、比例、材质、视角及画面文字。不得出现 JSON 字段名、分析过程或空泛形容词。
        negative_prompt 必须用中文列出需要避免的窗帘结构变形、褶皱错乱、材质失真、比例错误、透视错误、乱码、水印、Logo 和多余元素。

        【严格输出要求】
        仅输出 JSON，不要解释，不要 Markdown 代码块。没有文字时 typography_layout 返回 []。generation_prompt 和 negative_prompt 必须是字符串。
        """;
  }

  private String solidWoodBedPrompt() {
    return """
        【角色与任务】
        你是一位顶级的计算机视觉分析师与图像生成引擎专家，专精于电商实木床产品的视觉拆解与 AI 生图提示词输出。请深度解析参考图，输出可直接用于电商主图和详情页生图的结构化 JSON。

        【解析维度与数据结构】
        请输出合法 JSON 对象，字段必须包含：
        {
          "content_role": {"display_type": "", "conversion_goal": "", "visual_focus": ""},
          "visual_style": {"overall_tone": "", "texture_medium": ""},
          "subject_and_elements": {"core_subject": "", "auxiliary_props": ""},
          "product_identity": {"category": "", "silhouette": "", "proportion": "", "apparent_thickness": "", "display_state": "", "surface_pattern": "", "edge_binding": "", "color_zones": "", "visible_markings": "", "fold_structure": "", "count": "", "accessories": "", "unknown_facts": ""},
          "composition_and_camera": {"display_type": "", "product_angle": "", "aspect_ratio": "", "spatial_layout": "", "camera_angle": "", "shadow_style": "", "text_space": "", "product_bbox": "", "product_occupancy": "", "crop_relation": "", "depth_layers": ""},
          "scene_and_environment": {"scene_type": "", "background": "", "foreground": "", "midground": "", "props": "", "surface_material": "", "depth_of_field": ""},
          "people_and_actions": [{"count": "", "demographic": "", "wardrobe": "", "bbox": "", "pose": "", "action": "", "gaze": "", "product_relation": ""}],
          "lighting_and_color": {"background_material": "", "key_light_direction": "", "light_softness": "", "shadow_logic": "", "color_temperature": "", "brightness_contrast": "", "color_palette": [{"name": "", "hex": "", "ratio": ""}]},
          "bed_wood": {"wood_species": "", "wood_color": "", "wood_grain": "", "surface_finish": "", "carving_detail": "", "headboard_shape": "", "headboard_height": ""},
          "bed_structure": {"frame_style": "", "leg_design": "", "footboard": "", "side_rail": "", "slat_type": "", "mattress_visible": ""},
          "typography_layout": [{"block_type": "", "bbox": "", "font_style": "", "font_weight": "", "font_color": "", "alignment": "", "hierarchy": "", "text_content": "", "brand_content": ""}],
          "generation_prompt": "",
          "negative_prompt": ""
        }

        【专业要求】
        木材品种、木色、木纹、表面工艺、床头造型、床架结构、床腿、床尾、床板和可见床垫要具体可执行，颜色给色名和 HEX 近似值。product_identity 只记录图片直接可见的轮廓、比例、结构、木纹/表面、边缘、色块、标记和配件；无法从图片确认的木种、内部连接和参数写入 unknown_facts，不得推断。content_role 必须识别唯一展示任务；所有 bbox 使用 x,y,w,h 百分比（0-100）。准确记录主体占比、人物非特定特征与动作、人物和产品关系、场景道具与前中后景；无人物时 people_and_actions 返回 []。记录光线方向、软硬、阴影、近似色温、明暗对比、主辅色 HEX 与面积比例；文字逐块记录几何位置和字体层级，品牌资产写入 brand_content。
        【生图提示词要求】
        generation_prompt 必须是一段可直接提交给图像生成模型的完整中文提示词，长度 200-500 字。按实木床主体、木材与工艺、床架结构、场景、构图、镜头、光线、色彩和文字排版组织，明确需要保持的产品结构、比例、材质、视角及画面文字。不得出现 JSON 字段名、分析过程或空泛形容词。
        negative_prompt 必须用中文列出需要避免的床架结构变形、木纹失真、材质错误、比例错误、透视错误、乱码、水印、Logo 和多余元素。

        【严格输出要求】
        仅输出 JSON，不要解释，不要 Markdown 代码块。没有文字时 typography_layout 返回 []。generation_prompt 和 negative_prompt 必须是字符串。
        """;
  }

  private List<ReversePromptDtos.GroupMeta> generalGroups() {
    return List.of(
        new ReversePromptDtos.GroupMeta("画面职责", List.of("content_role")),
        new ReversePromptDtos.GroupMeta("画面氛围", List.of("visual_style", "composition_and_camera", "scene_and_environment", "people_and_actions", "lighting_and_color")),
        new ReversePromptDtos.GroupMeta("核心主体", List.of("subject_and_elements", "product_identity")),
        new ReversePromptDtos.GroupMeta("文字排版", List.of("typography_layout")));
  }

  private List<ReversePromptDtos.GroupMeta> mattressGroups() {
    return List.of(
        new ReversePromptDtos.GroupMeta("画面职责", List.of("content_role")),
        new ReversePromptDtos.GroupMeta("画面氛围", List.of("visual_style", "composition_and_camera", "scene_and_environment", "people_and_actions", "lighting_and_color")),
        new ReversePromptDtos.GroupMeta("核心主体", List.of("subject_and_elements", "product_identity")),
        new ReversePromptDtos.GroupMeta("床垫专业", List.of("mattress_surface", "mattress_structure")),
        new ReversePromptDtos.GroupMeta("文字排版", List.of("typography_layout")));
  }

  private List<ReversePromptDtos.GroupMeta> curtainGroups() {
    return List.of(
        new ReversePromptDtos.GroupMeta("画面职责", List.of("content_role")),
        new ReversePromptDtos.GroupMeta("画面氛围", List.of("visual_style", "composition_and_camera", "scene_and_environment", "people_and_actions", "lighting_and_color")),
        new ReversePromptDtos.GroupMeta("核心主体", List.of("subject_and_elements", "product_identity")),
        new ReversePromptDtos.GroupMeta("窗帘专业", List.of("curtain_detail", "curtain_drape", "curtain_scene")),
        new ReversePromptDtos.GroupMeta("文字排版", List.of("typography_layout")));
  }

  private List<ReversePromptDtos.GroupMeta> solidWoodBedGroups() {
    return List.of(
        new ReversePromptDtos.GroupMeta("画面职责", List.of("content_role")),
        new ReversePromptDtos.GroupMeta("画面氛围", List.of("visual_style", "composition_and_camera", "scene_and_environment", "people_and_actions", "lighting_and_color")),
        new ReversePromptDtos.GroupMeta("核心主体", List.of("subject_and_elements", "product_identity")),
        new ReversePromptDtos.GroupMeta("实木床专业", List.of("bed_wood", "bed_structure")),
        new ReversePromptDtos.GroupMeta("文字排版", List.of("typography_layout")));
  }

  private Map<String, String> generalLabels() {
    Map<String, String> labels = baseLabels();
    labels.put("content_role", "本图职责");
    labels.put("visual_style", "视觉风格");
    labels.put("subject_and_elements", "主体与元素");
    labels.put("product_identity", "可见产品身份");
    labels.put("composition_and_camera", "构图与镜头");
    labels.put("scene_and_environment", "场景与空间");
    labels.put("people_and_actions", "人物与动作");
    labels.put("lighting_and_color", "光线与色彩");
    labels.put("typography_layout", "文字排版");
    labels.put("overall_tone", "整体调性");
    labels.put("texture_medium", "媒介质感");
    labels.put("core_subject", "核心主体");
    labels.put("auxiliary_props", "辅助元素");
    labels.put("category", "产品类目");
    labels.put("silhouette", "外轮廓");
    labels.put("proportion", "长宽比例");
    labels.put("apparent_thickness", "厚度体感");
    labels.put("display_state", "摆放状态");
    labels.put("surface_pattern", "表面纹理");
    labels.put("edge_binding", "包边与侧面");
    labels.put("color_zones", "色块分布");
    labels.put("visible_markings", "可见印花标记");
    labels.put("fold_structure", "折叠结构");
    labels.put("accessories", "可见配件");
    labels.put("unknown_facts", "不可见未知事实");
    labels.put("display_type", "展示类型");
    labels.put("conversion_goal", "转化目标");
    labels.put("visual_focus", "视觉焦点");
    labels.put("aspect_ratio", "画幅比例");
    labels.put("spatial_layout", "空间布局");
    labels.put("camera_angle", "镜头角度");
    labels.put("product_bbox", "产品框坐标");
    labels.put("product_occupancy", "产品占比");
    labels.put("crop_relation", "裁切关系");
    labels.put("depth_layers", "景深层级");
    labels.put("scene_type", "场景类型");
    labels.put("background", "背景");
    labels.put("foreground", "前景");
    labels.put("midground", "中景");
    labels.put("props", "场景道具");
    labels.put("surface_material", "承托面材质");
    labels.put("depth_of_field", "景深");
    labels.put("count", "人物数量");
    labels.put("demographic", "人物特征");
    labels.put("wardrobe", "人物穿搭");
    labels.put("bbox", "区域坐标");
    labels.put("pose", "人物姿态");
    labels.put("action", "人物动作");
    labels.put("gaze", "人物视线");
    labels.put("product_relation", "人与产品关系");
    labels.put("background_material", "背景材质");
    labels.put("key_light_direction", "主光方向");
    labels.put("light_softness", "光线软硬");
    labels.put("shadow_logic", "阴影逻辑");
    labels.put("color_temperature", "色温");
    labels.put("brightness_contrast", "明暗对比");
    labels.put("color_palette", "色彩方案");
    labels.put("name", "色彩名称");
    labels.put("hex", "HEX");
    labels.put("ratio", "面积比例");
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
    labels.put("generation_prompt", "可直接生图提示词");
    labels.put("negative_prompt", "禁止项");
    labels.put("position", "文字位置");
    labels.put("block_type", "信息块类型");
    labels.put("bbox", "区域坐标");
    labels.put("font_style", "字体风格");
    labels.put("font_weight", "字体字重");
    labels.put("font_color", "字体颜色");
    labels.put("alignment", "对齐方式");
    labels.put("hierarchy", "信息层级");
    labels.put("text_content", "文字内容");
    labels.put("brand_content", "品牌与禁用内容");
    return labels;
  }

  public record Template(
      String label,
      String systemPrompt,
      List<ReversePromptDtos.GroupMeta> groups,
      Map<String, String> fieldLabels) {}
}
