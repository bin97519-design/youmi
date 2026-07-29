package com.youmi.api.file;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.youmi.api.common.GlobalExceptionHandler;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class PublicReportFileControllerTest {
  @TempDir
  java.nio.file.Path tempDir;

  @Test
  void uploadsWithoutAuthorizationAndCreatesDateFolder() throws Exception {
    Clock clock = Clock.fixed(
        Instant.parse("2026-07-24T03:00:00Z"),
        ZoneId.of("Asia/Shanghai"));
    PublicReportFileController controller = new PublicReportFileController(tempDir, clock);
    MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
        .setControllerAdvice(new GlobalExceptionHandler())
        .build();
    MockMultipartFile file = new MockMultipartFile(
        "file",
        "日报.txt",
        "text/plain",
        "report-content".getBytes(StandardCharsets.UTF_8));

    mockMvc.perform(multipart("/api/public/report-files/upload").file(file))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.code").value(0))
        .andExpect(jsonPath("$.data.dateFolder").value("260724"))
        .andExpect(jsonPath("$.data.originalName").value("日报.txt"))
        .andExpect(jsonPath("$.data.relativePath").value(
            org.hamcrest.Matchers.startsWith("260724/日报-")));

    try (var files = Files.list(tempDir.resolve("260724"))) {
      org.junit.jupiter.api.Assertions.assertEquals(1, files.count());
    }
  }
}
