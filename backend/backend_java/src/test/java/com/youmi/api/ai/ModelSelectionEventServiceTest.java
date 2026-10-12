package com.youmi.api.ai;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.youmi.api.common.ApiException;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class ModelSelectionEventServiceTest {
  @Test
  void recordsVideoEnhancementModelUsage() {
    var jdbc = mock(JdbcTemplate.class);
    var service = new ModelSelectionEventService(jdbc);

    service.record(12L, new ModelSelectionEventDtos.CreateRequest("video-enhancement", "video-enhance", true));

    verify(jdbc).update(contains("INSERT INTO ym_ai_model_selection_event"), eq(12L),
        eq("video-enhancement"), eq("video-enhance"), eq(true));
  }

  @Test
  void rejectsBlankVideoEnhancementModel() {
    var service = new ModelSelectionEventService(mock(JdbcTemplate.class));
    assertThrows(ApiException.class, () -> service.record(12L,
        new ModelSelectionEventDtos.CreateRequest("video-enhancement", " ", true)));
  }
}
