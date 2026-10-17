package com.youmi.api.prompt;

import static org.junit.jupiter.api.Assertions.assertEquals;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class PromptLibraryControllerLongContentTest {
  @Test
  void preservesLongChinesePromptInsteadOfTruncatingIt() throws Exception {
    String content = "完整提示词内容与换行\n".repeat(10000) + "结尾必须保留";
    var controller = new PromptLibraryController(null, null);
    var request = new PromptLibraryDtos.SaveRequest("长提示词", content, "GENERAL", List.of(), "MANUAL");
    Object validated = ReflectionTestUtils.invokeMethod(controller, "validate", request);
    var accessor = validated.getClass().getDeclaredMethod("content");
    accessor.setAccessible(true);
    assertEquals(content, accessor.invoke(validated));
  }
}
