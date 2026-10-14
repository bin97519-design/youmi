package com.youmi.api.ai;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiException;
import com.youmi.api.common.GlobalExceptionHandler;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class CanvasAgentTextNodeControllerTest {
  final CanvasAgentService service = mock(CanvasAgentService.class);
  final CanvasAgentRepository repository = mock(CanvasAgentRepository.class);
  final AdminAuthService auth = mock(AdminAuthService.class);
  final org.springframework.test.web.servlet.MockMvc mvc = MockMvcBuilders
      .standaloneSetup(new CanvasAgentController(service, repository, auth))
      .setControllerAdvice(new GlobalExceptionHandler()).build();
  final String body = """
      {"canvasId":"canvas","layerId":"node","instruction":"write","text":"old","agentModel":"luna","imageUrls":[],"referenceTexts":[]}
      """;

  @Test void requiresLoginBeforeAnyModelCall() throws Exception {
    when(auth.requireUserId(null)).thenThrow(new ApiException(401, "login required"));
    mvc.perform(post("/api/ai/canvas-agent/text").contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().isUnauthorized());
    verifyNoInteractions(service, repository);
  }

  @Test void returnsTextOnlyAndRecordsTextUsageWithoutMediaGenerationAuthorization() throws Exception {
    when(auth.requireUserId("Bearer test")).thenReturn(1L);
    when(service.writeTextNode(any())).thenReturn(new CanvasAgentDtos.TextNodeResponse("agent", "luna", "new"));
    mvc.perform(post("/api/ai/canvas-agent/text").header("Authorization", "Bearer test")
        .contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isOk())
        .andExpect(jsonPath("$.data.text").value("new")).andExpect(jsonPath("$.data.readyToGenerate").doesNotExist());
    verify(repository).recordUsage(eq(1L), eq("canvas"), eq("text-node-node"), eq("TEXT"), eq("agent"), eq("luna"), eq("SUCCESS"), anyLong(), eq(8), eq(3), eq(0), eq(""));
  }
}
