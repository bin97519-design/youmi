package com.youmi.api.video;

import java.util.List;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

public final class ProductVideoDtos {
  private ProductVideoDtos() {}

  @JsonIgnoreProperties({"talentMode"})
  public record PlanRequest(String brief, List<String> images, int count, String ratio,
      ShotPlan currentShot, List<ShotContext> contextShots, String productionMode, Integer timelineCount,
      boolean generateAudio, ReferenceVideo referenceVideo, String planningModel, String continuity) {
    public PlanRequest(String brief, List<String> images, int count, String ratio,
        ShotPlan currentShot, List<ShotContext> contextShots, String productionMode, Integer timelineCount,
        boolean generateAudio, ReferenceVideo referenceVideo, String planningModel) {
      this(brief, images, count, ratio, currentShot, contextShots, productionMode, timelineCount,
          generateAudio, referenceVideo, planningModel, null);
    }
    public PlanRequest(String brief, List<String> images, int count, String ratio,
        ShotPlan currentShot, List<ShotContext> contextShots, String productionMode, Integer timelineCount,
        boolean generateAudio, ReferenceVideo referenceVideo) {
      this(brief, images, count, ratio, currentShot, contextShots, productionMode, timelineCount,
          generateAudio, referenceVideo, null);
    }
    public PlanRequest(String brief, List<String> images, int count, String ratio,
        ShotPlan currentShot, List<ShotContext> contextShots, String productionMode, Integer timelineCount,
        boolean generateAudio) {
      this(brief, images, count, ratio, currentShot, contextShots, productionMode, timelineCount,
          generateAudio, null);
    }
    public PlanRequest(String brief, List<String> images, int count, String ratio,
        ShotPlan currentShot, List<ShotContext> contextShots, String productionMode, Integer timelineCount) {
      this(brief, images, count, ratio, currentShot, contextShots, productionMode, timelineCount, false, null);
    }
    public PlanRequest(String brief, List<String> images, int count, String ratio,
        ShotPlan currentShot, List<ShotContext> contextShots, String productionMode) {
      this(brief, images, count, ratio, currentShot, contextShots, productionMode, null);
    }
    public PlanRequest(String brief, List<String> images, int count, String ratio,
        ShotPlan currentShot, List<ShotContext> contextShots) {
      this(brief, images, count, ratio, currentShot, contextShots, null);
    }
  }
  public record ReferenceVideo(String url, String name, double duration, Integer width, Integer height,
      String audioSummary, List<ReferenceFrame> frames, List<ReferenceSegment> segments, String strategy) {
    public ReferenceVideo(String url, String name, double duration, Integer width, Integer height,
        String audioSummary, List<ReferenceFrame> frames, List<ReferenceSegment> segments) {
      this(url, name, duration, width, height, audioSummary, frames, segments, null);
    }
    public ReferenceVideo(String url, String name, double duration, Integer width, Integer height,
        String audioSummary, List<ReferenceFrame> frames) {
      this(url, name, duration, width, height, audioSummary, frames, null);
    }
  }
  public record ReferenceSegment(double start, double end) {}
  public record ReferenceFrame(String url, double time) {}
  public record ShotContext(String title, String purpose, String design, String concept) {}
  public record ShotPlan(String title, String imagePrompt, String motion, String caption, double duration,
      String purpose, String design, String productionMode, List<TimelineBeat> timeline) {
    public ShotPlan(String title, String imagePrompt, String motion, String caption, double duration,
        String purpose, String design) {
      this(title, imagePrompt, motion, caption, duration, purpose, design, null, null);
    }
  }
  public record TimelineBeat(double start, double end, String action, String camera, String transition) {}
  public record PlanSummary(String analysis, String concept) {}
  public record PlanResponse(String provider, List<ShotPlan> shots, PlanSummary summary) {}
  public record Clip(String url, double start, double duration, String caption, String timingMode) {
    public Clip(String url, double start, double duration, String caption) {
      this(url, start, duration, caption, null);
    }
  }
  public record ComposeRequest(List<Clip> clips, String ratio, String musicUrl, double musicVolume,
      boolean keepOriginalAudio) {
    public ComposeRequest(List<Clip> clips, String ratio, String musicUrl, double musicVolume) {
      this(clips, ratio, musicUrl, musicVolume, false);
    }
  }
  public record Composition(String id, String status, int progress, String url, String error) {}
  public record PublishRequest(Long productId, String compositionId) {}
}
