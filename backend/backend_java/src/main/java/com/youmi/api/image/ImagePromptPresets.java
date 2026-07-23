package com.youmi.api.image;

import java.util.List;

final class ImagePromptPresets {
  private static final String STYLE_TRANSFER = String.join("\n",
      "共有两张参考图：图1是需要保持真实外观的产品图，图2是视觉风格参考图。",
      "任务：保持图1产品的形状、结构、材质、颜色、纹理、比例与标识准确不变，将整张图重构为图2的视觉风格。",
      "风格对齐范围：配色与色温、光线方向与软硬、背景场景、构图节奏、信息层级、字体气质、质感和整体氛围。",
      "产品必须始终是图1中的产品，不得混合图2主体的结构或外观。",
      "图2仅提供视觉语言，不得复制其中的品牌、商品名称、价格、销量、促销、证书、型号、专属卖点或水印。",
      "图1已有且清晰可辨的品牌信息可以保留；无法确认的文字宁可省略，不得生成错字、乱码或伪文字。",
      "输出一张完成度高、可直接用于电商展示的图片，画幅比例与图1一致，只输出最终图片。");

  private static final String LAYOUT_CLONE = String.join("\n",
      "共有两张参考图：图1是需要展示的产品图，图2是版式与构图参考图。",
      "任务：借鉴图2的信息结构、主体位置、留白、背景关系、光影组织和视觉节奏，为图1产品重新制作一张电商主图。",
      "产品外观必须完全来自图1，保持形状、结构、材质、颜色、纹理、比例和标识准确，不得替换、变形或混入图2商品特征。",
      "图2只作为版式与视觉结构参考，不得复制其中的品牌、商品名称、价格、销量、促销、证书、型号、专属卖点或水印。",
      "文案只允许表达图1产品已提供的信息；没有可靠依据的数字、功效、资质和承诺一律不写。",
      "所有可见文字使用简体中文短句，清晰可读；无法稳定呈现时减少文字，不得生成错字、乱码或伪文字。",
      "输出一张干净、真实、层次明确、可直接用于电商展示的图片，画幅比例与图1一致，只输出最终图片。");

  private ImagePromptPresets() {}

  static ImageGenerationDtos.CreateTaskRequest expand(ImageGenerationDtos.CreateTaskRequest request) {
    if (request == null || request.prompt() == null) return request;
    String prompt = request.prompt().trim();
    PresetMatch match = match(prompt);
    if (match == null) return request;
    String expanded = match.extra().isBlank()
        ? match.template()
        : match.template() + "\n补充要求：" + match.extra();
    return new ImageGenerationDtos.CreateTaskRequest(
        expanded,
        request.model(),
        request.size(),
        request.ratio(),
        request.resolution(),
        request.n(),
        request.count(),
        request.imageUrlsSnake(),
        request.imageUrls(),
        request.background(),
        request.outputFormat(),
        request.moderation(),
        request.inputFidelity(),
        request.outputCompression(),
        request.webhookUrl(),
        request.clientTaskId());
  }

  private static PresetMatch match(String prompt) {
    for (String prefix : List.of("@风格迁移", "@风格统一", "@style-transfer")) {
      if (prompt.startsWith(prefix)) {
        return new PresetMatch(STYLE_TRANSFER, prompt.substring(prefix.length()).trim());
      }
    }
    for (String prefix : List.of("@主图复刻", "@版式复刻", "@layout-clone")) {
      if (prompt.startsWith(prefix)) {
        return new PresetMatch(LAYOUT_CLONE, prompt.substring(prefix.length()).trim());
      }
    }
    return null;
  }

  private record PresetMatch(String template, String extra) {}
}
