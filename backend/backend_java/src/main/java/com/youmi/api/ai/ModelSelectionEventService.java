package com.youmi.api.ai;

import com.youmi.api.common.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class ModelSelectionEventService {
  private static final java.util.Set<String> FEATURE_CODES = java.util.Set.of(
      "canvas-creation-image", "product-video-planning", "product-video-image", "product-video-video");
  private final JdbcTemplate jdbc;

  public ModelSelectionEventService(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public void record(long userId, ModelSelectionEventDtos.CreateRequest request) {
    if (request == null || !FEATURE_CODES.contains(request.featureCode())) {
      throw new ApiException(400, "不支持的模型选择埋点功能");
    }
    String featureCode = request.featureCode();
    String model = request.model() == null ? "" : request.model().trim();
    if (model.isEmpty() || model.length() > 128 || request.selected() == null) {
      throw new ApiException(400, "模型选择埋点参数无效");
    }
    jdbc.update("""
        INSERT INTO ym_ai_model_selection_event (user_id, feature_code, model, selected)
        VALUES (?, ?, ?, ?)
        """, userId, featureCode, model, request.selected());
  }
}
