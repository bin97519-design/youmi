package com.youmi.api.pricing;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiException;
import org.junit.jupiter.api.Test;

class CanvasPricingControllerTest {
  @Test void authenticationHappensBeforeAnyPriceRead() {
    AdminAuthService auth = mock(AdminAuthService.class);
    CanvasPricingService service = mock(CanvasPricingService.class);
    when(auth.requireUserId(null)).thenThrow(new ApiException(401, "请先登录"));
    var controller = new CanvasPricingController(auth, service);
    assertThrows(ApiException.class, () -> controller.estimate(null, new ObjectMapper().createObjectNode()));
    verifyNoInteractions(service);
  }

  @Test void authenticatedEstimateUsesStandardEnvelopeWithoutSettlement() {
    AdminAuthService auth = mock(AdminAuthService.class);
    CanvasPricingService service = mock(CanvasPricingService.class);
    when(auth.requireUserId("Bearer session")).thenReturn(7L);
    var body = new ObjectMapper().createObjectNode();
    var estimate = new CanvasPricingDtos.Estimate(false, null, null, null, "米值", "estimate", "暂无报价",
        "platform-pricing", "minimax-h3", null, null, "算力", null, null, null, 100);
    when(service.estimate(body)).thenReturn(estimate);
    var response = new CanvasPricingController(auth, service).estimate("Bearer session", body);
    assertEquals(0, response.code()); assertSame(estimate, response.data());
    var ordered = inOrder(auth, service); ordered.verify(auth).requireUserId("Bearer session"); ordered.verify(service).estimate(body);
    verifyNoMoreInteractions(auth, service);
  }
}
