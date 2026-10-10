package com.youmi.api.image;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.credit.MiBizType;
import com.youmi.api.credit.MiValueDtos;
import com.youmi.api.credit.MiValueProperties;
import com.youmi.api.credit.MiValueService;
import java.util.List;
import java.util.Map;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class ImageTaskControllerTest {
  @Test
  void createUsesReportedProviderCostInsteadOfConfiguredEstimate() throws Exception {
    Long userId = 7L;
    String taskId = "apimart-direct:task-123";
    var auth = mock(AdminAuthService.class);
    var generation = mock(ImageGenerationClient.class);
    var ledger = mock(MiValueService.class);
    var jdbc = mock(JdbcTemplate.class);
    var mapper = new ObjectMapper();
    var taskLogs = new ImageTaskLogService(jdbc, mapper);
    var properties = new MiValueProperties();
    properties.setImagePrices(Map.of(
        "banana2", Map.of("1K", 8, "2K", 9, "4K", 12),
        "gpt-image-2", Map.of("1K", 6, "2K", 10, "4K", 15)));
    var pricing = new ImageMiValuePricingService(properties);
    var controller = new ImageTaskController(generation, taskLogs, auth, ledger, pricing);
    var request = new ImageGenerationDtos.CreateTaskRequest(
        "画一朵花", "gpt-image-2", "1024x1024", "1:1", "1K",
        1, null, List.of(), List.of(), null, null, null, null, null, null, null);
    var providerResponse = new ImageGenerationDtos.CreateTaskResponse(
        "apimart-direct", "gpt-image-2", "gpt-image-2", "1024x1024", "1K", 1,
        List.of(new ImageGenerationDtos.TaskRef(taskId, "submitted")),
        mapper.readTree("{\"cost\":0.21}"));

    when(auth.requireUserId("Bearer test-token")).thenReturn(userId);
    when(ledger.checkAndDeduct(userId, MiBizType.IMAGE, new BigDecimal("8.00")))
        .thenReturn(new MiValueDtos.DeductResult(99L, 0, 0, 8, MiBizType.IMAGE));
    when(generation.createTask(request, userId)).thenReturn(providerResponse);

    var result = controller.create("Bearer test-token", request).data();

    assertEquals(new BigDecimal("21.00"), result.consumedMi());
    verify(ledger).settleActualByTaskId(taskId, new BigDecimal("21.00"));
    verify(ledger, never()).settle(any(Long.class), any(Integer.class));
  }
}
