package com.youmi.api.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import java.util.List;
import org.junit.jupiter.api.Test;

class VisionJsonSupportTest {
  private final ObjectMapper objectMapper = new ObjectMapper();

  @Test
  void normalizesLeadingZeroesOnlyOutsideStrings() throws Exception {
    String response = """
        ```json
        [{"object_name":"编号001","box_2d":[00.125,01,000,0.900]}]
        ```
        """;

    String json = VisionJsonSupport.extractNormalizedJsonArray(response);
    JsonNode parsed = objectMapper.readTree(json);

    assertEquals("编号001", parsed.get(0).get("object_name").asText());
    assertEquals(0.125, parsed.get(0).get("box_2d").get(0).asDouble());
    assertEquals(1.0, parsed.get(0).get("box_2d").get(1).asDouble());
    assertEquals(0.0, parsed.get(0).get("box_2d").get(2).asDouble());
    assertEquals(0.9, parsed.get(0).get("box_2d").get(3).asDouble());
  }

  @Test
  void keepsValidJsonNumbersUnchanged() {
    String json = "[{\"box_2d\":[0.0,0.125,1.0,0.998]}]";
    assertEquals(json, VisionJsonSupport.extractNormalizedJsonArray(json));
  }

  @Test void convertsRectangularImageCoordinatesWithoutSwappingAxesTwice() {
    var elements = VisionJsonSupport.parseElements(objectMapper, """
        {"elements":[{"object_name":"标题001","box_2d":[00.125,0.250,0.200,0.750]}]}
        """);
    assertEquals("标题001", elements.get(0).objectName());
    assertEquals(List.of(0.25, 0.125, 0.75, 0.2), elements.get(0).box2d());
  }

  @Test void supportsThousandScaleAndLegacyBoxAliases() {
    var elements = VisionJsonSupport.parseElements(objectMapper, """
        ```json
        [{"name":"窗帘","bbox":[100,200,900,800]},
         {"object":"沙发","box2d":[0.5,0.1,0.8,0.4]}]
        ```
        """);
    assertEquals(List.of(0.2, 0.1, 0.8, 0.9), elements.get(0).box2d());
    assertEquals(List.of(0.1, 0.5, 0.4, 0.8), elements.get(1).box2d());
  }

  @Test void uniqueNamesCannotCollideWithExistingNumberedNames() {
    var elements = VisionJsonSupport.parseElements(objectMapper, """
        [{"object_name":"茶杯","box_2d":[0.1,0.2,0.3,0.4]},
         {"object_name":"茶杯","box_2d":[0.2,0.3,0.4,0.5]},
         {"object_name":"茶杯1","box_2d":[0.3,0.4,0.5,0.6]}]
        """);
    assertEquals(List.of("茶杯2", "茶杯3", "茶杯1"), elements.stream().map(VisionElement::objectName).toList());
  }

  @Test void skipsInvalidCoordinatesInsteadOfAddingWholeImageBoxes() {
    var elements = VisionJsonSupport.parseElements(objectMapper, """
        [{"object_name":"bad","box_2d":["0.1",0.2,0.3,0.4]},
         {"object_name":"reversed","box_2d":[0.9,0.2,0.1,0.8]},
         {"object_name":"flat","box_2d":[0.1,0.2,0.1,0.8]},
         {"object_name":"missing","box_2d":[0.1,0.2,0.3]},
         {"object_name":"valid","box_2d":[0.12345,0.2,0.9,1.02]}]
        """);
    assertEquals(1, elements.size());
    assertEquals(List.of(0.2, 0.123, 1.0, 0.9), elements.get(0).box2d());
  }

  @Test void emptyDetectionIsValidButMalformedOrAllInvalidResultsAreErrors() {
    assertTrue(VisionJsonSupport.parseElements(objectMapper, "{\"elements\":[]}").isEmpty());
    for (String response : new String[] {"no result", "[broken]", "[{\"object_name\":\"bad\"}]"}) {
      assertEquals(502, assertThrows(ApiException.class,
          () -> VisionJsonSupport.parseElements(objectMapper, response)).getCode());
    }
  }
}
