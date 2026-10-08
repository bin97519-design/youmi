package com.youmi.api.selection;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import com.youmi.api.admin.AdminAuthService;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class SelectionPoolListControllerTest {
  @Test void listsDefaultToCompactButExplicitFalseRetainsFullContract() throws Exception {
    var auth = mock(AdminAuthService.class);
    var service = mock(SelectionPoolService.class);
    when(auth.requireUserId("Bearer test")).thenReturn(7L);
    when(service.listCompact(7L, null, null, null, null, null, null, 1, 20))
        .thenReturn(new SelectionPoolDtos.ProductSummaryPage(List.of(), 12, 1, 20));
    when(service.list(7L, null, null, null, null, null, null, 1, 20))
        .thenReturn(new SelectionPoolDtos.ProductPage(List.of(), 15, 1, 20));
    var mvc = MockMvcBuilders.standaloneSetup(new SelectionPoolController(auth, service)).build();
    mvc.perform(get("/api/v1/selection-pool/products").header("Authorization", "Bearer test"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(12));
    mvc.perform(get("/api/v1/selection-pool/products?compact=false").header("Authorization", "Bearer test"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(15));
    verify(service).listCompact(7L, null, null, null, null, null, null, 1, 20);
    verify(service).list(7L, null, null, null, null, null, null, 1, 20);
  }
}
