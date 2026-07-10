package com.youmi.api.video;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;

/**
 * 视频生成模块的 DTO 集合。
 */
public class VideoGenerationDtos {

  /** 视频创建请求体 */
  public record CreateTaskRequest(
      @JsonProperty("prompt") String prompt,
      @JsonProperty("model") String model,
      @JsonProperty("ratio") String ratio,
      @JsonProperty("durationSeconds") Integer durationSeconds) {
  }

  /** 视频创建响应（含米值回填字段） */
  public static class CreateTaskResponse {
    private String provider;
    private String model;
    private String taskId;
    private String status;
    private List<String> videoUrls = new ArrayList<>();
    private JsonNode raw;
    private int consumedMi = 0;
    private int balance = 0;

    public String getProvider() {
      return provider;
    }

    public void setProvider(String provider) {
      this.provider = provider;
    }

    public String getModel() {
      return model;
    }

    public void setModel(String model) {
      this.model = model;
    }

    public String getTaskId() {
      return taskId;
    }

    public void setTaskId(String taskId) {
      this.taskId = taskId;
    }

    public String getStatus() {
      return status;
    }

    public void setStatus(String status) {
      this.status = status;
    }

    public List<String> getVideoUrls() {
      return videoUrls;
    }

    public void setVideoUrls(List<String> videoUrls) {
      this.videoUrls = videoUrls == null ? new ArrayList<>() : videoUrls;
    }

    public JsonNode getRaw() {
      return raw;
    }

    public void setRaw(JsonNode raw) {
      this.raw = raw;
    }

    public int getConsumedMi() {
      return consumedMi;
    }

    public void setConsumedMi(int consumedMi) {
      this.consumedMi = consumedMi;
    }

    public int getBalance() {
      return balance;
    }

    public void setBalance(int balance) {
      this.balance = balance;
    }
  }

  /** 视频任务状态（轮询）响应 */
  public static class TaskStatusResponse {
    private String provider;
    private String taskId;
    private String status;
    private Integer progress;
    private List<String> videoUrls = new ArrayList<>();
    private String error;
    private JsonNode raw;

    public String getProvider() {
      return provider;
    }

    public void setProvider(String provider) {
      this.provider = provider;
    }

    public String getTaskId() {
      return taskId;
    }

    public void setTaskId(String taskId) {
      this.taskId = taskId;
    }

    public String getStatus() {
      return status;
    }

    public void setStatus(String status) {
      this.status = status;
    }

    public Integer getProgress() {
      return progress;
    }

    public void setProgress(Integer progress) {
      this.progress = progress;
    }

    public List<String> getVideoUrls() {
      return videoUrls;
    }

    public void setVideoUrls(List<String> videoUrls) {
      this.videoUrls = videoUrls == null ? new ArrayList<>() : videoUrls;
    }

    public String getError() {
      return error;
    }

    public void setError(String error) {
      this.error = error;
    }

    public JsonNode getRaw() {
      return raw;
    }

    public void setRaw(JsonNode raw) {
      this.raw = raw;
    }
  }
}
