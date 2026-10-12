package com.youmi.api.image;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.youmi.api.ai.CanvasAgentService;
import com.youmi.api.ai.VisionElement;
import com.youmi.api.common.ApiException;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class ImageDetectControllerTest {
  private static final String IMAGE = "data:image/png;base64,dGVzdA==";
  private final CanvasAgentService agent = mock(CanvasAgentService.class);
  private MockMvc mvc;

  @BeforeEach void setup() {
    mvc = MockMvcBuilders.standaloneSetup(new ImageDetectController(agent)).build();
  }

  @Test void ignoresOldAgentSelectionFieldsAndPreservesTheCanvasResponseSchema() throws Exception {
    when(agent.detectImageElements(IMAGE))
        .thenReturn(List.of(new VisionElement("绿色窗帘", List.of(0.2, 0.1, 0.8, 0.9))));
    mvc.perform(post("/api/image/detect-elements").contentType(MediaType.APPLICATION_JSON)
        .content("{\"imageUrl\":\"" + IMAGE + "\",\"layerId\":\"image-1\",\"agentModel\":\"gem-3.8-flash\"}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0))
        .andExpect(jsonPath("$.data.url").value(IMAGE))
        .andExpect(jsonPath("$.data.imageInfo[0].object_name").value("绿色窗帘"))
        .andExpect(jsonPath("$.data.imageInfo[0].box2d[0]").value(0.2))
        .andExpect(jsonPath("$.data.imageInfo[0].box_2d[0]").value(0.2));
    verify(agent).detectImageElements(IMAGE);
  }

  @Test void requestsNeedOnlyTheImageAndLayerId() throws Exception {
    when(agent.detectImageElements(IMAGE)).thenReturn(List.of());
    mvc.perform(post("/api/image/detect-elements").contentType(MediaType.APPLICATION_JSON)
        .content("{\"imageUrl\":\"" + IMAGE + "\",\"layerId\":\"image-1\"}"))
        .andExpect(jsonPath("$.code").value(0)).andExpect(jsonPath("$.data.imageInfo").isEmpty());
    verify(agent).detectImageElements(IMAGE);
  }

  @Test void reportsModelErrorsWithoutReturningSuccess() throws Exception {
    when(agent.detectImageElements(IMAGE)).thenThrow(new ApiException(503, "Agent 未配置密钥"));
    mvc.perform(post("/api/image/detect-elements").contentType(MediaType.APPLICATION_JSON)
        .content("{\"imageUrl\":\"" + IMAGE + "\"}"))
        .andExpect(jsonPath("$.code").value(503))
        .andExpect(jsonPath("$.message").value("Agent 未配置密钥"))
        .andExpect(jsonPath("$.data").doesNotExist());
    verify(agent, times(1)).detectImageElements(IMAGE);
  }

  @Test void rejectsMissingImagesBeforeCallingAgent() throws Exception {
    mvc.perform(post("/api/image/detect-elements").contentType(MediaType.APPLICATION_JSON).content("{}"))
        .andExpect(jsonPath("$.code").value(400));
    verifyNoInteractions(agent);
  }
}
