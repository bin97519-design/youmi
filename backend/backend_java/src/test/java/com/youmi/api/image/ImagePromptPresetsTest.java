package com.youmi.api.image;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
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

  @Test
  void promotesNoTextRequirementToHighestPriority() {
    ImageGenerationDtos.CreateTaskRequest expanded =
        ImagePromptPresets.expand(request("@主图复刻 画面不要任何文字"));

    assertTrue(expanded.prompt().startsWith("最高优先级硬约束"));
    assertTrue(expanded.prompt().contains("移除两张源图中的全部现成文案"));
  }

  @Test
  void preservesEveryRequestFieldIncludingActualSelectedQuality() throws Exception {
    ObjectMapper mapper = new ObjectMapper();
    ImageGenerationDtos.CreateTaskRequest request = mapper.readValue("""
        {"prompt":"@风格迁移 不要文字","model":"model-api-key:45","size":"3:4","ratio":"3:4",
         "resolution":"4K","n":1,"count":1,"image_urls":["product"],"imageUrls":["reference"],
         "background":"transparent","output_format":"png","moderation":"auto","input_fidelity":"high",
         "output_compression":90,"webhook_url":"https://example.com/callback","client_task_id":"preset-options",
         "horizontal_angle":45,"vertical_angle":15,"distance":2,"seed":123,
         "feature_code":"canvas-image","version":"flare","quality":"max","parameter_profile":"canvas-v3-image",
         "thinking_level":"high","web_search":false,"custom_size":"1536x864"}
        """, ImageGenerationDtos.CreateTaskRequest.class);

    ImageGenerationDtos.CreateTaskRequest expanded = ImagePromptPresets.expand(request);
    ObjectNode originalOptions = mapper.valueToTree(request);
    ObjectNode expandedOptions = mapper.valueToTree(expanded);
    originalOptions.remove("prompt");
    expandedOptions.remove("prompt");
    assertEquals(originalOptions, expandedOptions);
    assertEquals("max", expanded.quality());
    assertEquals("transparent", expanded.background());
    assertEquals("flare", expanded.version());
    assertEquals("canvas-v3-image", expanded.parameterProfile());
    assertEquals("high", expanded.thinkingLevel());
    assertEquals(false, expanded.webSearch());
    assertEquals("1536x864", expanded.customSize());
    assertTrue(expanded.prompt().startsWith("最高优先级硬约束"));
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
