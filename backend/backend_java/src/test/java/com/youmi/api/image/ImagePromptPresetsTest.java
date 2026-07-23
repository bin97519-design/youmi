package com.youmi.api.image;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

class ImagePromptPresetsTest {
  @Test
  void expandsLayoutCloneAndKeepsRequestOptions() {
    ImageGenerationDtos.CreateTaskRequest request = request("@主图复刻 保持夏季清凉感");

    ImageGenerationDtos.CreateTaskRequest expanded = ImagePromptPresets.expand(request);

    assertTrue(expanded.prompt().contains("图1是需要展示的产品图"));
    assertTrue(expanded.prompt().contains("图2只作为版式与视觉结构参考"));
    assertTrue(expanded.prompt().contains("补充要求：保持夏季清凉感"));
    assertEquals("banana2", expanded.model());
    assertEquals(List.of("product", "reference"), expanded.normalizedImageUrls());
  }

  @Test
  void expandsStyleTransferWithProductIdentityRules() {
    ImageGenerationDtos.CreateTaskRequest expanded =
        ImagePromptPresets.expand(request("@风格迁移"));

    assertTrue(expanded.prompt().contains("产品必须始终是图1中的产品"));
    assertTrue(expanded.prompt().contains("不得复制其中的品牌"));
    assertFalse(expanded.prompt().contains("@风格迁移"));
  }

  @Test
  void leavesRegularPromptsUntouched() {
    ImageGenerationDtos.CreateTaskRequest request = request("生成一张白底产品图");
    assertSame(request, ImagePromptPresets.expand(request));
  }

  private ImageGenerationDtos.CreateTaskRequest request(String prompt) {
    return new ImageGenerationDtos.CreateTaskRequest(
        prompt,
        "banana2",
        "1:1",
        null,
        "2K",
        1,
        null,
        List.of("product", "reference"),
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        "client-task");
  }
}
