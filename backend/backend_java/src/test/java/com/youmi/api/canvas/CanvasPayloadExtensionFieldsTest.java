package com.youmi.api.canvas;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class CanvasPayloadExtensionFieldsTest {

  private final ObjectMapper objectMapper = new ObjectMapper();

  @Test
  void preservesReversePromptFieldsAcrossCanvasPayloadRoundTrip() throws Exception {
    String json = """
        {
          "layers": [{
            "id": "layer-1",
            "name": "image",
            "reversePromptText": "subject: curtain",
            "reversePromptJson": {"subject_and_elements": {"core_subject": "curtain"}},
            "reversePromptFieldLabels": {"subject_and_elements": "subject"},
            "reversePromptCategory": "curtain",
            "genMeta": {"model": "banana2"}
          }]
        }
        """;

    CanvasPayload payload = objectMapper.readValue(json, CanvasPayload.class);
    JsonNode saved = objectMapper.readTree(objectMapper.writeValueAsString(payload));
    JsonNode layer = saved.path("layers").get(0);

    assertEquals("subject: curtain", layer.path("reversePromptText").asText());
    assertEquals("curtain", layer.path("reversePromptJson")
        .path("subject_and_elements").path("core_subject").asText());
    assertEquals("subject", layer.path("reversePromptFieldLabels")
        .path("subject_and_elements").asText());
    assertEquals("curtain", layer.path("reversePromptCategory").asText());
    assertEquals("banana2", layer.path("genMeta").path("model").asText());
    assertTrue(layer.has("reversePromptText"));
  }
}
