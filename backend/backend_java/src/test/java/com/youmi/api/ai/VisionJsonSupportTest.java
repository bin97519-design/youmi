package com.youmi.api.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
}
