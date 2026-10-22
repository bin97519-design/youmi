package com.youmi.api.ai;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiException;
import com.youmi.api.common.GlobalExceptionHandler;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class CanvasAgentVideoControllerTest {
  private final CanvasAgentService agent = mock(CanvasAgentService.class);
  private final CanvasAgentRepository repository = mock(CanvasAgentRepository.class);
  private final AdminAuthService auth = mock(AdminAuthService.class);
  private MockMvc mvc;

  private static final String REQUEST = """
      {"canvasId":"1968","instruction":"","agentModel":"default","referenceVideo":{
        "url":"https://media.example/video.mp4","name":"reference.mp4","duration":105,
        "width":1080,"height":1920,"frames":[
          {"url":"https://media.example/frame-1.jpg","time":0},
          {"url":"https://media.example/frame-2.jpg","time":104.5}
        ]
      }}
      """;

  @BeforeEach void setup() throws Exception {
    when(agent.prepareContext(any(), any(), any())).thenAnswer(call -> call.getArgument(1));
    mvc = MockMvcBuilders.standaloneSetup(new CanvasAgentController(agent, repository, auth))
        .setControllerAdvice(new GlobalExceptionHandler()).build();
  }

  @Test void bindsVideoMetadataAndReturnsCopyablePromptWithoutGenerationAuthorization() throws Exception {
    when(auth.requireUserId("Bearer test-token")).thenReturn(123L);
    when(agent.chat(any())).thenReturn(new CanvasAgentDtos.ChatResponse(
        "agent", "gpt-5.6-luna", "已分析抽样画面", "", "完整时间轴",
        List.of("完整时间轴"), List.of(), "banana2", List.of("banana2"),
        "9:16", "2K", 1, false, "video", 105));

    mvc.perform(post("/api/ai/canvas-agent/chat").header("Authorization", "Bearer test-token")
        .contentType(MediaType.APPLICATION_JSON).content(REQUEST))
        .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0))
        .andExpect(jsonPath("$.data.generationType").value("video"))
        .andExpect(jsonPath("$.data.readyToGenerate").value(false))
        .andExpect(jsonPath("$.data.durationSeconds").value(105))
        .andExpect(jsonPath("$.data.draftPrompts[0]").value("完整时间轴"));
    var request = ArgumentCaptor.forClass(CanvasAgentDtos.ChatRequest.class);
    verify(agent).chat(request.capture());
    var video = request.getValue().referenceVideo();
    assertEquals("https://media.example/video.mp4", video.url());
    assertEquals("reference.mp4", video.name());
    assertEquals(105, video.duration());
    assertEquals(1080, video.width());
    assertEquals(1920, video.height());
    assertEquals(List.of(0.0, 104.5), video.frames().stream().map(CanvasAgentDtos.VideoFrame::time).toList());
  }

  @Test void requiresLoginBeforeVideoRecognition() throws Exception {
    when(auth.requireUserId(null)).thenThrow(new ApiException(401, "请先登录"));
    mvc.perform(post("/api/ai/canvas-agent/chat").contentType(MediaType.APPLICATION_JSON).content(REQUEST))
        .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value(401));
    verifyNoInteractions(agent, repository);
  }
}
