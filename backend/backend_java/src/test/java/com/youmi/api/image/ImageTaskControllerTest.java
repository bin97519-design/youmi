package com.youmi.api.image;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiException;
import com.youmi.api.credit.MiBizType;
import com.youmi.api.credit.MiValueDtos;
import com.youmi.api.credit.MiValueProperties;
import com.youmi.api.credit.MiValueService;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class ImageTaskControllerTest {
  @Test
  void rejectsMultiImageCreateBeforeBillingOrProviderCall() {
    var auth = mock(AdminAuthService.class);
    var generation = mock(ImageGenerationClient.class);
    var taskLogs = mock(ImageTaskLogService.class);
    var ledger = mock(MiValueService.class);
    var pricing = mock(ImageMiValuePricingService.class);
    var controller = new ImageTaskController(generation, taskLogs, auth, ledger, pricing);
    var request = request(2, "multi-image-client");

    when(auth.requireUserId("Bearer test-token")).thenReturn(7L);

    ApiException error = assertThrows(
        ApiException.class, () -> controller.create("Bearer test-token", request));

    assertEquals(400, error.getCode());
    assertTrue(error.getMessage().contains("1 张"));
    verifyNoInteractions(generation, taskLogs, ledger, pricing);
  }

  @Test
  void definitiveValidationRejectionRollsBackAndReleasesSubmittingClaim() throws Exception {
    Long userId = 7L;
    String clientTaskId = "validation-rejection";
    var auth = mock(AdminAuthService.class);
    var generation = mock(ImageGenerationClient.class);
    var taskLogs = mock(ImageTaskLogService.class);
    var ledger = mock(MiValueService.class);
    var controller = new ImageTaskController(
        generation, taskLogs, auth, ledger, pricingWithGptImagePrice());
    var request = request(1, clientTaskId);

    when(auth.requireUserId("Bearer test-token")).thenReturn(userId);
    when(taskLogs.tryClaimClientTask(userId, clientTaskId)).thenReturn(true);
    when(ledger.checkAndDeduct(userId, MiBizType.IMAGE, new BigDecimal("6.00")))
        .thenReturn(new MiValueDtos.DeductResult(99L, 20, 14, 6, MiBizType.IMAGE));
    when(generation.createTask(request, userId))
        .thenThrow(new ApiException(400, "prompt is required"));

    ApiException error = assertThrows(
        ApiException.class, () -> controller.create("Bearer test-token", request));

    assertEquals(400, error.getCode());
    verify(ledger).rollback(userId, 99L);
    verify(taskLogs).releaseRejectedClientTaskClaim(userId, clientTaskId, 99L);
    verify(taskLogs, never()).markClientTaskUnknown(any(), any(), any());
  }

  @Test
  void transportFailureKeepsReservationAndMarksClaimUnknown() throws Exception {
    Long userId = 7L;
    String clientTaskId = "network-unknown";
    var auth = mock(AdminAuthService.class);
    var generation = mock(ImageGenerationClient.class);
    var taskLogs = mock(ImageTaskLogService.class);
    var ledger = mock(MiValueService.class);
    var controller = new ImageTaskController(
        generation, taskLogs, auth, ledger, pricingWithGptImagePrice());
    var request = request(1, clientTaskId);

    when(auth.requireUserId("Bearer test-token")).thenReturn(userId);
    when(taskLogs.tryClaimClientTask(userId, clientTaskId)).thenReturn(true);
    when(ledger.checkAndDeduct(userId, MiBizType.IMAGE, new BigDecimal("6.00")))
        .thenReturn(new MiValueDtos.DeductResult(100L, 20, 14, 6, MiBizType.IMAGE));
    when(generation.createTask(request, userId))
        .thenThrow(new ApiException(504, "provider request timed out"));

    ApiException error = assertThrows(
        ApiException.class, () -> controller.create("Bearer test-token", request));

    assertEquals(502, error.getCode());
    assertTrue(error.getMessage().contains("结果待确认"));
    verify(taskLogs).markClientTaskUnknown(userId, clientTaskId, "provider request timed out");
    verify(ledger, never()).rollback(userId, 100L);
    verify(taskLogs, never()).releaseRejectedClientTaskClaim(any(), any(), any());
  }

  @Test
  void resolveExposesRequestClaimStateAndConservativeRetryFlag() {
    Long userId = 7L;
    String clientTaskId = "unknown-client";
    var auth = mock(AdminAuthService.class);
    var generation = mock(ImageGenerationClient.class);
    var taskLogs = mock(ImageTaskLogService.class);
    var ledger = mock(MiValueService.class);
    var pricing = mock(ImageMiValuePricingService.class);
    var controller = new ImageTaskController(generation, taskLogs, auth, ledger, pricing);

    when(auth.requireUserId("Bearer test-token")).thenReturn(userId);
    when(taskLogs.findClientTaskClaim(userId, clientTaskId)).thenReturn(
        new ImageTaskLogService.ClientTaskClaim(
            "UNKNOWN", null, 101L, "provider request timed out"));

    Map<String, Object> result = controller.resolveByClientTaskId(
        clientTaskId, "Bearer test-token").data();

    assertFalse((Boolean) result.get("exists"));
    assertEquals("UNKNOWN", result.get("claim_status"));
    assertEquals(101L, result.get("billing_log_id"));
    assertFalse((Boolean) result.get("in_flight"));
    assertTrue((Boolean) result.get("delivery_unknown"));
    assertFalse((Boolean) result.get("retry_safe"));

    when(taskLogs.findClientTaskClaim(userId, clientTaskId)).thenReturn(
        new ImageTaskLogService.ClientTaskClaim(
            "SUBMITTING", null, 102L, null));
    Map<String, Object> submitting = controller.resolveByClientTaskId(
        clientTaskId, "Bearer test-token").data();
    assertTrue((Boolean) submitting.get("in_flight"));
    assertFalse((Boolean) submitting.get("delivery_unknown"));
    assertFalse((Boolean) submitting.get("retry_safe"));
  }

  @Test
  void resolveOnlyAllowsRetryWhenTaskAndClaimAreBothAbsent() {
    var auth = mock(AdminAuthService.class);
    var generation = mock(ImageGenerationClient.class);
    var taskLogs = mock(ImageTaskLogService.class);
    var ledger = mock(MiValueService.class);
    var pricing = mock(ImageMiValuePricingService.class);
    var controller = new ImageTaskController(generation, taskLogs, auth, ledger, pricing);
    when(auth.requireUserId("Bearer test-token")).thenReturn(7L);

    Map<String, Object> result = controller.resolveByClientTaskId(
        "unused-client", "Bearer test-token").data();

    assertFalse((Boolean) result.get("exists"));
    assertTrue((Boolean) result.get("retry_safe"));
  }

  @Test
  void allowsMappedModelWithoutFixedPriceAndCreatesZeroEstimate() throws Exception {
    Long userId = 7L;
    String taskId = "lk888:task-123";
    var auth = mock(AdminAuthService.class);
    var generation = mock(ImageGenerationClient.class);
    var ledger = mock(MiValueService.class);
    var jdbc = mock(JdbcTemplate.class);
    var modelApiKeys = mock(ModelApiKeyService.class);
    var mapper = new ObjectMapper();
    var taskLogs = new ImageTaskLogService(jdbc, mapper);
    var pricing = new ImageMiValuePricingService(new MiValueProperties());
    var controller = new ImageTaskController(generation, taskLogs, auth, ledger, pricing);
    controller.setModelApiKeyService(modelApiKeys);
    var request = new ImageGenerationDtos.CreateTaskRequest(
        "画一朵花", "image-2.5快速", "1024x1024", "1:1", "2K",
        1, null, List.of(), List.of(), null, null, null, null, null, null, null,
        null, null, null, null, "product-video-image");
    var providerResponse = new ImageGenerationDtos.CreateTaskResponse(
        "Custom Gateway", "image-2.5快速", "image-2.5快速", "1024x1024", "2K", 1,
        List.of(new ImageGenerationDtos.TaskRef(taskId, "submitted")), mapper.readTree("{}"));

    when(auth.requireUserId("Bearer test-token")).thenReturn(userId);
    when(modelApiKeys.resolve("image-2.5快速", ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION,
        "product-video-image"))
        .thenReturn(Optional.of(new ModelApiKeyService.ResolvedModelApiKey(
            5L, "image-2.5快速", "Custom Gateway", "https://api.example", "/generate", "/status",
            "secret", Map.of())));
    when(ledger.checkAndDeduct(userId, MiBizType.IMAGE, new BigDecimal("0.00")))
        .thenReturn(new MiValueDtos.DeductResult(99L, 0, 0, 0, MiBizType.IMAGE));
    when(generation.createTask(request, userId)).thenReturn(providerResponse);

    var result = controller.create("Bearer test-token", request).data();

    assertEquals(new BigDecimal("0.00"), result.consumedMi());
    verify(ledger).settle(99L, new BigDecimal("0.00"));
  }

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

  private ImageGenerationDtos.CreateTaskRequest request(int count, String clientTaskId) {
    return new ImageGenerationDtos.CreateTaskRequest(
        "画一朵花", "gpt-image-2", "1024x1024", "1:1", "1K",
        count, null, List.of(), List.of(), null, null, null, null, null, null, clientTaskId);
  }

  private ImageMiValuePricingService pricingWithGptImagePrice() {
    var properties = new MiValueProperties();
    properties.setImagePrices(Map.of(
        "banana2", Map.of("1K", 6, "2K", 10, "4K", 15),
        "gpt-image-2", Map.of("1K", 6, "2K", 10, "4K", 15)));
    return new ImageMiValuePricingService(properties);
  }
}
