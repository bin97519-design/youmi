package com.youmi.api.video;

import java.util.List;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

public final class ProductVideoDtos {
  private ProductVideoDtos() {}

  @JsonIgnoreProperties({"talentMode"})
  public record PlanRequest(String brief, List<String> images, int count, String ratio,
      ShotPlan currentShot, List<ShotContext> contextShots, String productionMode, Integer timelineCount,
      boolean generateAudio, ReferenceVideo referenceVideo, String planningModel, String continuity,
      List<ReferenceImageRole> imageRoles) {
    public PlanRequest(String brief, List<String> images, int count, String ratio,
        ShotPlan currentShot, List<ShotContext> contextShots, String productionMode, Integer timelineCount,
        boolean generateAudio, ReferenceVideo referenceVideo, String planningModel, String continuity) {
      this(brief, images, count, ratio, currentShot, contextShots, productionMode, timelineCount,
          generateAudio, referenceVideo, planningModel, continuity, null);
    }
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
  public record ReferenceImageRole(int imageIndex, String role) {}
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
  public record ReversePromptRequest(ReferenceVideo referenceVideo, String planningModel, int shotCount) {}
  public record ReversePromptResponse(String provider, String model, String promptText,
      double duration, int frameCount) {}
  public record ShotContext(String title, String purpose, String design, String concept,
      ShotConnection connection, boolean current, String motion, Double duration) {
    public ShotContext(String title, String purpose, String design, String concept,
        ShotConnection connection, boolean current) {
      this(title, purpose, design, concept, connection, current, null, null);
    }
    public ShotContext(String title, String purpose, String design, String concept) {
      this(title, purpose, design, concept, null, false, null, null);
    }
  }
  public record RefineRequest(String planJobId, String shotId, PlanRequest request) {}
  public record ShotConnection(String startState, String endState, String type, String transition) {}
  public record ShotPlan(String title, String imagePrompt, String motion, String caption, double duration,
      String purpose, String design, String productionMode, List<TimelineBeat> timeline, ShotConnection connection) {
    public ShotPlan(String title, String imagePrompt, String motion, String caption, double duration,
        String purpose, String design, String productionMode, List<TimelineBeat> timeline) {
      this(title, imagePrompt, motion, caption, duration, purpose, design, productionMode, timeline, null);
    }
    public ShotPlan(String title, String imagePrompt, String motion, String caption, double duration,
        String purpose, String design) {
      this(title, imagePrompt, motion, caption, duration, purpose, design, null, null);
    }
  }
  public record TimelineBeat(double start, double end, String action, String camera, String transition,
      String startState, String endState, String transitionType, String description) {
    public TimelineBeat(double start, double end, String action, String camera, String transition) {
      this(start, end, action, camera, transition, null, null, null, null);
    }
  }
  public record TimelineRefineRequest(PlanRequest request, int index) {}
  public record PlanSummary(String analysis, String concept) {}
  public record PlanResponse(String provider, List<ShotPlan> shots, PlanSummary summary) {}
  public record Clip(String url, double start, double duration, String caption, String timingMode) {
    public Clip(String url, double start, double duration, String caption) {
      this(url, start, duration, caption, null);
    }
  }
  public record ComposeRequest(List<Clip> clips, String ratio, String musicUrl, double musicVolume,
      boolean keepOriginalAudio, String resolution, boolean smoothAudio, String continuityReviewId) {
    public ComposeRequest(List<Clip> clips, String ratio, String musicUrl, double musicVolume,
        boolean keepOriginalAudio, String resolution, boolean smoothAudio) {
      this(clips, ratio, musicUrl, musicVolume, keepOriginalAudio, resolution, smoothAudio, null);
    }
    public ComposeRequest(List<Clip> clips, String ratio, String musicUrl, double musicVolume,
        boolean keepOriginalAudio, String resolution) {
      this(clips, ratio, musicUrl, musicVolume, keepOriginalAudio, resolution, false);
    }
    public ComposeRequest(List<Clip> clips, String ratio, String musicUrl, double musicVolume,
        boolean keepOriginalAudio) {
      this(clips, ratio, musicUrl, musicVolume, keepOriginalAudio, null, false);
    }
    public ComposeRequest(List<Clip> clips, String ratio, String musicUrl, double musicVolume) {
      this(clips, ratio, musicUrl, musicVolume, false, null);
    }
  }
  public record Composition(String id, String status, int progress, String url, String error) {}
  public record PublishRequest(Long productId, String compositionId) {}
}
