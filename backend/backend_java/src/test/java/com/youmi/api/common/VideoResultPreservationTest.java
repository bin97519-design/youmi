package com.youmi.api.common;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class VideoResultPreservationTest {
  private final ObjectMapper mapper = new ObjectMapper();

  @Test void preservesResultAgainstStaleTimeoutButKeepsGeometry() throws Exception {
    var old = mapper.readTree("[{\"id\":\"v1\",\"type\":\"video\",\"taskId\":\"task1\",\"url\":\"https://example.com/video.mp4\"}]");
    var incoming = mapper.readTree("[{\"id\":\"v1\",\"type\":\"video\",\"taskId\":\"task1\",\"status\":\"failed\",\"url\":\"\",\"x\":900}]");
    VideoResultPreservation.preserve(incoming, old, false);
    assertEquals("https://example.com/video.mp4", incoming.get(0).path("url").asText());
    assertEquals(900, incoming.get(0).path("x").asInt());
    assertEquals("completed", incoming.get(0).path("status").asText());
    var replacement = incoming.deepCopy();
    ((com.fasterxml.jackson.databind.node.ObjectNode) replacement.get(0)).put("taskId", "task2").put("url", "").put("status", "failed");
    VideoResultPreservation.preserve(replacement, old, false);
    assertEquals("", replacement.get(0).path("url").asText());
    var deleted = mapper.readTree("[]");
    VideoResultPreservation.preserve(deleted, old, false);
    assertEquals(0, deleted.size());
  }

  @Test void preservesConversationVideoWithoutRestoringDeletedMessages() throws Exception {
    var old = mapper.readTree("[{\"id\":\"m1\",\"taskId\":\"task1\",\"videoUrl\":\"https://example.com/video.mp4\"}]");
    var incoming = mapper.readTree("[{\"id\":\"m1\",\"taskId\":\"task1\",\"failed\":true}]");
    VideoResultPreservation.preserve(incoming, old, true);
    assertFalse(incoming.get(0).path("failed").asBoolean());
    assertEquals("https://example.com/video.mp4", incoming.get(0).path("videoUrl").asText());
  }
}
