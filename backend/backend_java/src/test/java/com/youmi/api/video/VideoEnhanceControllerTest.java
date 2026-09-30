package com.youmi.api.video;

import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiException;
import com.youmi.api.common.GlobalExceptionHandler;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class VideoEnhanceControllerTest {
  final AdminAuthService auth = mock(AdminAuthService.class);
  final VideoEnhanceJobs jobs = mock(VideoEnhanceJobs.class);
  MockMvc mvc;
  @BeforeEach void setup() {
    when(auth.requireUserId("Bearer test")).thenReturn(7L);
    when(auth.requireUserId(null)).thenThrow(new ApiException(401, "未登录"));
    mvc = MockMvcBuilders.standaloneSetup(new VideoEnhanceController(auth, jobs))
        .setControllerAdvice(new GlobalExceptionHandler()).build();
  }
  @Test void routesRequireAuthenticationAndUseSessionUser() throws Exception {
    mvc.perform(get("/api/video-enhancements/capabilities")).andExpect(status().isUnauthorized());
    mvc.perform(get("/api/video-enhancements/capabilities").header("Authorization", "Bearer test"))
        .andExpect(jsonPath("$.data.available").value(false));
    when(jobs.list(7L, "https://owned/video.mp4")).thenReturn(List.of());
    mvc.perform(get("/api/video-enhancements/tasks").param("sourceUrl", "https://owned/video.mp4").header("Authorization", "Bearer test"))
        .andExpect(status().isOk());
    verify(jobs).list(7L, "https://owned/video.mp4");
    mvc.perform(get("/api/video-enhancements/tasks/job").header("Authorization", "Bearer test")).andExpect(status().isOk());
    verify(jobs).get(7L, "job");
  }
  @Test void acceptsOnlyServerQuoteForSubmissionAndBindsSettings() throws Exception {
    mvc.perform(post("/api/video-enhancements/quotes").header("Authorization", "Bearer test").contentType(MediaType.APPLICATION_JSON)
        .content("{\"sourceUrl\":\"https://owned/video.mp4\",\"settings\":{\"resolution\":\"8k\",\"fps\":\"120\",\"toolVersion\":\"professional\",\"scene\":\"ugc\",\"enhanceStyle\":\"hd\"}}"))
        .andExpect(status().isOk());
    verify(jobs).quote(eq(7L), argThat(request -> request.settings().toolVersion().equals("professional")
        && request.settings().resolution().equals("8k") && request.settings().fps().equals("120")));
    mvc.perform(post("/api/video-enhancements/tasks").header("Authorization", "Bearer test").contentType(MediaType.APPLICATION_JSON)
        .content("{\"quoteId\":\"job\",\"price\":1,\"userId\":1234}"))
        .andExpect(status().isOk());
    verify(jobs).create(7L, "job");
    mvc.perform(delete("/api/video-enhancements/quotes/job").header("Authorization", "Bearer test"))
        .andExpect(status().isOk());
    verify(jobs).discardQuote(7L, "job");
  }
}
