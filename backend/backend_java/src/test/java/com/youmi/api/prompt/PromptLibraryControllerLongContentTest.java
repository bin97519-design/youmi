package com.youmi.api.prompt;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.*;
import com.youmi.api.admin.AdminAuthService;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class PromptLibraryControllerLongContentTest {
  @Test
  void acceptsVideoCategoryWhenSavingEditingAndFiltering() {
    var repository = mock(PromptLibraryRepository.class);
    var auth = mock(AdminAuthService.class);
    when(auth.requireUserId("Bearer test")).thenReturn(1L);
    var controller = new PromptLibraryController(repository, auth);
    String content = "分镜设计\n".repeat(1000) + "口播设计与结尾";
    var request = new PromptLibraryDtos.SaveRequest("视频脚本", content, "VIDEO", List.of("分镜"), "AGENT");
    var saved = new PromptLibraryDtos.PromptResponse(2L, "PERSONAL", "视频脚本", content,
        "VIDEO", List.of("分镜"), "AGENT", 0, null, 0, 0);
    when(repository.createPersonal(1L, "视频脚本", content, "VIDEO", List.of("分镜"), "AGENT"))
        .thenReturn(saved);
    when(repository.updatePersonal(2L, 1L, "视频脚本", content, "VIDEO", List.of("分镜"), "AGENT"))
        .thenReturn(java.util.Optional.of(saved));
    assertEquals("VIDEO", controller.create("Bearer test", request).data().category());
    assertEquals(content, controller.update("Bearer test", 2L, request).data().content());
    controller.list("Bearer test", "mine", "", "VIDEO");
    verify(repository).findVisible(1L, "mine", "", "VIDEO");
  }

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
