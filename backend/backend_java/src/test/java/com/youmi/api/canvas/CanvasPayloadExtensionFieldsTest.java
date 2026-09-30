package com.youmi.api.canvas;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class CanvasPayloadExtensionFieldsTest {

  private final ObjectMapper objectMapper = new ObjectMapper();

  @Test
  void preservesMultipleVideoTasksAndTheirIndependentAssets() throws Exception {
    String json = """
        {"productVideo":{"version":2,"tasks":[
          {"id":"task-a","title":"Curtain","createdAt":100,"updatedAt":200,
            "references":[{"id":"a","url":"a.png"}],"shots":[{"id":"shot-a","approvedImageId":"frame-a","videos":[{"taskId":"remote-a","status":"processing"}]}]},
          {"id":"task-b","title":"Mattress","references":[],"shots":[],"composition":{"id":"render-b","status":"completed","url":"b.mp4"}}
        ]}}
        """;
    var payload = objectMapper.readValue(json, CanvasPayload.class);
    var result = objectMapper.readTree(objectMapper.writeValueAsString(payload));
    assertEquals(objectMapper.readTree(json).path("productVideo"), result.path("productVideo"));
  }

  @Test
  void preservesProductVideoWorkflowApprovalsVersionsAndTasks() throws Exception {
    String json = """
        {"productVideo":{"version":1,"references":[{"id":"local-upload","url":"image.png"}],
        "shots":[{"id":"shot-1","approvedImageId":"image-1","kept":true,
        "images":[{"id":"image-1","url":"frame.png"}],
        "videos":[{"id":"video-1","taskId":"remote-1","status":"processing","request":{"first_frame_url":"frame.png"}}]}],
        "composition":{"id":"render-1","status":"processing"}}}
        """;
    var payload = objectMapper.readValue(json, CanvasPayload.class);
    var result = objectMapper.readTree(objectMapper.writeValueAsString(payload));
    assertEquals(objectMapper.readTree(json).path("productVideo"), result.path("productVideo"));
  }

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
