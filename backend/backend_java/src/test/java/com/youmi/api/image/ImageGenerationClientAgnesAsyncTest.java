package com.youmi.api.image;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

class ImageGenerationClientAgnesAsyncTest {

  @Test
  void createReturnsBeforeSynchronousAgnesProviderCompletes() throws Exception {
    CountDownLatch requestStarted = new CountDownLatch(1);
    CountDownLatch releaseProvider = new CountDownLatch(1);
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/v1/images/generations", exchange -> {
      requestStarted.countDown();
      try {
        try {
          releaseProvider.await(5, TimeUnit.SECONDS);
        } catch (InterruptedException interrupted) {
          Thread.currentThread().interrupt();
        }
        byte[] body = "{\"data\":[{\"url\":\"https://cdn.example.com/agnes.png\"}]}"
            .getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(200, body.length);
        exchange.getResponseBody().write(body);
      } finally {
        exchange.close();
      }
    });
    server.start();

    try {
      ImageGenerationProperties properties = new ImageGenerationProperties();
      properties.setAgnesApiKey("test-agnes-key");
      properties.setAgnesBaseUrl("http://127.0.0.1:" + server.getAddress().getPort());
      properties.setPersistGeneratedImages(false);
      ImageGenerationClient client = new ImageGenerationClient(new ObjectMapper(), properties);
      ImageGenerationDtos.CreateTaskRequest request = new ImageGenerationDtos.CreateTaskRequest(
          "a product", "agnes-image-2.1-flash", "1:1", "1:1", "2K",
          null, null, null, null, null, null, null, null, null, null, "client-agnes-1");

      ImageGenerationDtos.CreateTaskResponse created = assertTimeoutPreemptively(
          Duration.ofSeconds(1), () -> client.createTask(request, 7L));
      String taskId = created.tasks().get(0).taskId();

      assertEquals("submitted", created.tasks().get(0).status());
      assertTrue(requestStarted.await(1, TimeUnit.SECONDS));
      assertEquals("processing", client.getTask(taskId).status());

      releaseProvider.countDown();
      ImageGenerationDtos.TaskStatusResponse status = awaitTerminal(client, taskId);
      assertEquals("completed", status.status());
      assertEquals("https://cdn.example.com/agnes.png", status.imageUrls().get(0));
    } finally {
      releaseProvider.countDown();
      server.stop(0);
    }
  }

  private ImageGenerationDtos.TaskStatusResponse awaitTerminal(
      ImageGenerationClient client, String taskId) throws Exception {
    ImageGenerationDtos.TaskStatusResponse status = client.getTask(taskId);
    for (int i = 0; i < 30 && "processing".equals(status.status()); i++) {
      Thread.sleep(50);
      status = client.getTask(taskId);
    }
    return status;
  }
}
