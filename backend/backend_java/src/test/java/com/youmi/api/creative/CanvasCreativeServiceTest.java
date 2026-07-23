package com.youmi.api.creative;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.ai.AiChatClient;
import com.youmi.api.ai.AiProperties;
import com.youmi.api.ai.MiniMaxM3Client;
import com.youmi.api.ai.MiniMaxProperties;
import com.youmi.api.common.ApiException;
import java.util.List;
import org.junit.jupiter.api.Test;

class CanvasCreativeServiceTest {
  private final ObjectMapper objectMapper = new ObjectMapper();
  private final CanvasCreativeService service = new CanvasCreativeService(
      objectMapper,
      new AiChatClient(objectMapper, new AiProperties()),
      new MiniMaxM3Client(objectMapper, new MiniMaxProperties()));

  @Test
  void createsStableDemandDirectionsWithoutAConfiguredProvider() {
    CanvasCreativeDtos.DemandResponse response = service.generateDemands(
        new CanvasCreativeDtos.DemandRequest(
            "轻量保温杯，磨砂杯身，适合办公室使用",
            List.of("https://example.com/product.png"),
            6,
            "淘宝",
            "简洁明亮"));

    assertEquals("fallback", response.provider());
    assertEquals(6, response.cards().size());
    assertEquals(List.of("人群", "场景", "需求"), response.cards().stream()
        .limit(3)
        .map(CanvasCreativeDtos.DemandCard::dimension)
        .toList());
    assertTrue(response.cards().get(0).imagePrompt().contains("唯一产品外观来源"));
    assertTrue(response.cards().get(0).imagePrompt().contains("不添加未经提供的数字"));
  }

  @Test
  void capsDemandCount() {
    CanvasCreativeDtos.DemandResponse response = service.generateDemands(
        new CanvasCreativeDtos.DemandRequest(
            "产品信息",
            List.of("product"),
            99,
            null,
            null));

    assertEquals(12, response.cards().size());
    assertEquals("demand-12", response.cards().get(11).id());
  }

  @Test
  void requiresProductInformationAndAnImage() {
    assertThrows(
        ApiException.class,
        () -> service.generateDemands(
            new CanvasCreativeDtos.DemandRequest(
                "",
                List.of(),
                6,
                null,
                null)));
  }
}
