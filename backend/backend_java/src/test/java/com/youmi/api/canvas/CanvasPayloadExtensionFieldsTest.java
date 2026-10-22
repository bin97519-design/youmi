package com.youmi.api.canvas;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class CanvasPayloadExtensionFieldsTest {

  private final ObjectMapper objectMapper = new ObjectMapper();

  @Test
  void preservesMainVideo2SeparatelyWithFullScriptsMaterialsAndPendingJobs() throws Exception {
    String script = "根据以下分镜描述生成：图1【日式窗帘】【情景种草】真实短视频，不生成任何字幕\n分镜设计：\n完整动态过程。\n口播设计：\n无口播。".repeat(300);
    var original = objectMapper.createObjectNode();
    original.putObject("productVideo").putArray("tasks").addObject().put("id", "original-task").put("motion", "原版脚本");
    var task = original.putObject("productVideo2").putArray("tasks").addObject();
    task.put("id", "video2-task").put("planner", "main_video_2");
    task.putObject("video2").put("sellingPoints", "用户已确认卖点").putObject("firstFrame").put("url", "original-frame.png");
    task.putArray("references").addObject().put("url", "original-product.png");
    task.putObject("planJob").put("id", "durable-job").put("status", "processing");
    task.putArray("shots").addObject().put("motion", script).putArray("videos").addObject().put("taskId", "remote-task").put("status", "processing");
    var decoded = objectMapper.readValue(original.toString(), CanvasPayload.class);
    var restored = objectMapper.valueToTree(decoded);
    assertEquals(original.path("productVideo"), restored.path("productVideo"));
    assertEquals(original.path("productVideo2"), restored.path("productVideo2"));
    assertEquals(script, restored.path("productVideo2").path("tasks").path(0).path("shots").path(0).path("motion").asText());
  }

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
