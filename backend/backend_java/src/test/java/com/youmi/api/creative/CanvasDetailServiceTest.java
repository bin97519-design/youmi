package com.youmi.api.creative;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

class CanvasDetailServiceTest {
  @Test
  void createsDistinctNativeDetailScreens() {
    CanvasCreativeDtos.DetailRequest request = new CanvasCreativeDtos.DetailRequest(
        "轻量保温杯，磨砂杯身，适合办公室使用",
        List.of("product"),
        List.of(),
        6,
        "淘宝",
        "简洁明亮",
        "9:16",
        "balanced");

    List<CanvasDetailService.ScreenDraft> screens =
        CanvasDetailService.baseDrafts(request, 6);

    assertEquals(6, screens.size());
    assertEquals("首屏主视觉", screens.get(0).title());
    assertEquals("细节证明", screens.get(3).title());
    assertEquals(6, screens.stream().map(CanvasDetailService.ScreenDraft::title).distinct().count());
    assertTrue(screens.stream().allMatch(screen -> screen.referenceIndex() == null));
  }
}
