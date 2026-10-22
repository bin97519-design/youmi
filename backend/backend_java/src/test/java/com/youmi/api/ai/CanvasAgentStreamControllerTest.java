package com.youmi.api.ai;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.youmi.api.admin.AdminAuthService;
import jakarta.servlet.AsyncEvent;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockAsyncContext;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@WebMvcTest(CanvasAgentController.class)
class CanvasAgentStreamControllerTest {
  @Autowired private MockMvc mvc;
  @Autowired private CanvasAgentController controller;
  @MockBean private CanvasAgentService agent;
  @MockBean private CanvasAgentRepository repository;
  @MockBean private AdminAuthService auth;

  private static final String REQUEST = """
      {"canvasId":"image-stream-test","conversationId":"reference-image-test",
       "instruction":"根据商品图生成卧室场景","agentModel":"default",
       "referenceLayerIds":["product-image"],"layers":[
         {"id":"product-image","name":"商品图.jpg","type":"image",
          "url":"https://media.example/product.jpg"}]}
      """;

  @BeforeEach void login() {
    when(auth.requireUserId("Bearer test-token")).thenReturn(123L);
  }

  @Test void realMvcDeadlineCoversSlowImageFirstTokenWithoutSleepingThirtySeconds() throws Exception {
    var entered = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    when(agent.chatStreamWithUsage(any(), any(), any(), any())).thenAnswer(invocation -> {
      entered.countDown();
      assertTrue(release.await(5, TimeUnit.SECONDS));
      invocation.<Consumer<String>>getArgument(2).accept("图片方案已整理");
      return draft();
    });

    MvcResult result = startStream();
    try {
      assertTrue(entered.await(2, TimeUnit.SECONDS));
      // This is the real MVC/Servlet async timeout, not a mocked upstream timer.
      // The old unconfigured Tomcat deadline was 30,000 ms even while awaiting a first token.
      assertEquals(1_860_000L, result.getRequest().getAsyncContext().getTimeout());
      assertTrue(result.getRequest().getAsyncContext().getTimeout() > 30_000L);
      assertFalse(result.getResponse().getContentAsString().contains("\"type\":\"result\""));
    } finally {
      release.countDown();
    }
    result.getAsyncResult(2_000);
    String body = mvc.perform(asyncDispatch(result)).andExpect(status().isOk())
        .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    assertTrue(body.contains("\"type\":\"reply_delta\""));
    assertTrue(body.contains("\"type\":\"result\""));
    assertTrue(body.contains("图片方案已整理"));
    verifyUsage("SUCCESS");
    verify(repository, times(1)).recordUsage(anyLong(), anyString(), anyString(), anyString(),
        anyString(), anyString(), anyString(), anyLong(), anyInt(), anyInt(), anyInt(), anyString());
  }

  @Test void servletTimeoutIsRecordedOnceAndLateModelCompletionCannotRecordSuccess() throws Exception {
    var entered = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var finished = new CountDownLatch(1);
    when(agent.chatStreamWithUsage(any(), any(), any(), any())).thenAnswer(invocation -> {
      entered.countDown();
      // Ignore cancellation only in this fixture to exercise a provider completing after timeout.
      try {
        boolean released = false;
        while (!released) {
          try {
            released = release.await(5, TimeUnit.SECONDS);
            if (!released) throw new IllegalStateException("test fixture was not released");
          } catch (InterruptedException cancelled) {
            // The Servlet cancels the worker before invoking its timeout interceptors.
          }
        }
        return draft();
      } finally {
        finished.countDown();
      }
    });

    MvcResult result = startStream();
    try {
      assertTrue(entered.await(2, TimeUnit.SECONDS));
      MockAsyncContext context = (MockAsyncContext) result.getRequest().getAsyncContext();
      // Trigger the actual registered Servlet listener; no wall-clock timeout is needed.
      for (var listener : List.copyOf(context.getListeners())) {
        listener.onTimeout(new AsyncEvent(context));
      }
      verifyUsage("FAILED");
    } finally {
      release.countDown();
    }
    assertTrue(finished.await(2, TimeUnit.SECONDS));
    verify(repository, timeout(1_000).times(1)).recordUsage(anyLong(), anyString(), anyString(),
        anyString(), anyString(), anyString(), anyString(), anyLong(), anyInt(), anyInt(),
        anyInt(), anyString());
    verify(repository, never()).recordUsage(anyLong(), anyString(), anyString(), anyString(),
        anyString(), anyString(), eq("SUCCESS"), anyLong(), anyInt(), anyInt(), anyInt(), anyString());
  }

  @Test void disconnectedOutputIsVisibleAsOneFailureWithoutCallingTheModel() throws Exception {
    var requestBody = new com.fasterxml.jackson.databind.ObjectMapper()
        .readValue(REQUEST, CanvasAgentDtos.ChatRequest.class);
    var stream = controller.chatStream("Bearer test-token", requestBody,
        new MockHttpServletRequest(), new MockHttpServletResponse());
    stream.writeTo(new OutputStream() {
      @Override public void write(int value) throws IOException {
        throw new IOException("test client disconnected");
      }
    });
    verifyNoInteractions(agent);
    verifyUsage("FAILED");
    verify(repository, times(1)).recordUsage(anyLong(), anyString(), anyString(), anyString(),
        anyString(), anyString(), anyString(), anyLong(), anyInt(), anyInt(), anyInt(), anyString());
  }

  private MvcResult startStream() throws Exception {
    return mvc.perform(post("/api/ai/canvas-agent/chat/stream")
            .header("Authorization", "Bearer test-token")
            .contentType(MediaType.APPLICATION_JSON).content(REQUEST))
        .andExpect(request().asyncStarted()).andReturn();
  }

  @Test void streamExplicitlyDeclaresNdjsonEvenWhenReturningAnErrorEvent() throws Exception {
    when(agent.chatStreamWithUsage(any(), any(), any(), any()))
        .thenThrow(new IllegalArgumentException("请输入要求"));
    var pending = startStream();
    pending.getAsyncResult(5_000);
    var result = mvc.perform(asyncDispatch(pending)).andExpect(status().isOk())
        .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.content()
            .contentTypeCompatibleWith("application/x-ndjson"))
        .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.header()
            .string("X-Accel-Buffering", "no")).andReturn();
    String body = result.getResponse().getContentAsString(StandardCharsets.UTF_8);
    assertTrue(body.contains("\"type\":\"thinking\""));
    assertTrue(body.contains("\"type\":\"error\""));
    assertTrue(body.contains("请输入要求"));
    verifyUsage("FAILED");
  }

  private void verifyUsage(String status) {
    verify(repository).recordUsage(eq(123L), eq("image-stream-test"), eq("reference-image-test"),
        eq("CHAT_STREAM"), anyString(), anyString(), eq(status), anyLong(), anyInt(), anyInt(),
        eq(0), anyString());
  }

  private CanvasAgentDtos.ChatResponse draft() {
    return new CanvasAgentDtos.ChatResponse("test-provider", "test-model", "图片方案已整理", "",
        "床垫卧室场景", List.of("床垫卧室场景"), List.of("product-image"), "banana2",
        List.of("banana2"), "16:9", "2K", 1, true, "image", null);
  }
}
