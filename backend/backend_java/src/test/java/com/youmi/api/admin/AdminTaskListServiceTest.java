package com.youmi.api.admin;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.youmi.api.common.ApiException;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class AdminTaskListServiceTest {
  final AdminService images = mock(AdminService.class);
  final AdminVideoStatsService videos = mock(AdminVideoStatsService.class);
  final AdminTaskListService service = new AdminTaskListService(images, videos, new ObjectMapper());
  final List<AdminDtos.ImageTaskRow> imageRows = new ArrayList<>();
  final LocalDateTime start = LocalDateTime.of(2026, 10, 13, 12, 0);
  int fetchedImages;

  @BeforeEach void setup() {
    when(images.imageTaskPage(any(), any(), any(), any(), any(), any(), anyInt(), anyInt(), anyBoolean()))
        .thenAnswer(call -> {
          int page = call.getArgument(6), size = call.getArgument(7);
          long offset = (long) (page - 1) * size;
          var rows = imageRows.stream().skip(offset).limit(size).toList();
          fetchedImages += rows.size();
          return new AdminDtos.ImageTaskPage(rows, call.<Boolean>getArgument(8) ? imageRows.size() : -1, page, size);
        });
    when(videos.taskRows(any(), any(), any(), any(), any(), any())).thenReturn(List.of());
  }

  AdminDtos.ImageTaskRow image(long id, LocalDateTime time) {
    return new AdminDtos.ImageTaskRow(id, "image-" + id, 7L, "User", "provider", "prompt", "image-model",
        "image-model", "3:4", "2K", 1, "completed", 100, 1, BigDecimal.ONE, BigDecimal.ZERO, "",
        time.toString(), time.toString(), time.toString(), false, "[]", "[]", "DONE");
  }

  AdminVideoStatsService.TaskRow video(String id, String type, LocalDateTime time) {
    return new AdminVideoStatsService.TaskRow(id, 7L, "User", type, "provider", "prompt", "video-model",
        "720p", 15.0, "completed", 100, 1, List.of("https://media.test/" + id + ".mp4"), BigDecimal.ONE,
        BigDecimal.ONE, "", time.toString(), time.toString(), time.toString(), "DONE");
  }

  AdminTaskListService.TaskPage page(String kind, int number, int size) {
    return service.tasks(null, kind, null, null, null, null, null, number, size);
  }

  @Test void allTypesShareOneTimeOrderedPageAndKeepTheirResults() {
    imageRows.add(image(1, start.minusSeconds(2)));
    when(videos.taskRows(any(), any(), any(), any(), any(), any())).thenReturn(List.of(
        video("enhance", "VIDEO_ENHANCE", start), video("video", "VIDEO", start.minusSeconds(1))));
    var result = page("all", 1, 10);
    assertEquals(3, result.total());
    assertEquals(List.of("VIDEO_ENHANCE", "VIDEO", "IMAGE"), result.tasks().stream().map(r -> r.get("taskType")).toList());
    assertEquals(List.of("https://media.test/enhance.mp4"), result.tasks().get(0).get("videoUrls"));
    assertEquals("[]", result.tasks().get(2).get("imageUrls"));
  }

  @Test void olderVideosAndImagesRemainAccessibleBeyondFiveHundredTasks() {
    for (int i = 0; i < 650; i++) imageRows.add(image(650 - i, start.minusSeconds(i)));
    when(videos.taskRows(any(), any(), any(), any(), any(), any())).thenReturn(List.of(
        video("old-video", "VIDEO", start.minusSeconds(550).minusNanos(1)),
        video("old-enhance", "VIDEO_ENHANCE", start.minusSeconds(551).minusNanos(1))));
    var result = page("all", 56, 10);
    assertEquals(652, result.total());
    assertEquals(List.of("image-100", "old-video", "image-99", "old-enhance", "image-98", "image-97",
        "image-96", "image-95", "image-94", "image-93"), result.tasks().stream().map(r -> r.get("taskId")).toList());
    assertTrue(fetchedImages <= 100, "Do not preload every preceding image page");
  }

  @Test void paginationMatchesFullMergeAtEveryBoundaryIncludingTiedTimestamps() {
    for (int i = 0; i < 217; i++) imageRows.add(image(217 - i, start.minusSeconds(i / 3)));
    List<AdminVideoStatsService.TaskRow> videoRows = new ArrayList<>();
    for (int i = 0; i < 121; i++) videoRows.add(video("v-" + i, i % 2 == 0 ? "VIDEO" : "VIDEO_ENHANCE", start.minusSeconds(i / 2)));
    when(videos.taskRows(any(), any(), any(), any(), any(), any())).thenReturn(videoRows);
    record Expected(String id, LocalDateTime time, int type, long imageId) { }
    List<Expected> expected = new ArrayList<>();
    imageRows.forEach(r -> expected.add(new Expected(r.taskId(), LocalDateTime.parse(r.createdAt()), 0, r.id())));
    videoRows.forEach(r -> expected.add(new Expected(r.taskId(), LocalDateTime.parse(r.createdAt()), "VIDEO".equals(r.taskType()) ? 1 : 2, 0)));
    expected.sort(Comparator.comparing(Expected::time).reversed().thenComparingInt(Expected::type)
        .thenComparing(Comparator.comparingLong(Expected::imageId).reversed()).thenComparing(Expected::id));
    for (int size : List.of(1, 7, 10, 100)) {
      List<Object> actual = new ArrayList<>();
      for (int p = 1; p <= Math.ceil((double) expected.size() / size) + 1; p++) {
        var result = page("all", p, size);
        assertEquals(expected.size(), result.total());
        assertTrue(result.tasks().size() <= size);
        result.tasks().forEach(r -> actual.add(r.get("taskId")));
      }
      assertEquals(expected.stream().map(Expected::id).toList(), actual);
    }
  }

  @Test void filtersAreAppliedToBothSourcesBeforeAnyPagination() {
    service.tasks(null, "all", "2026-10-01", "2026-10-13", "failed", "shared-model", 7L, 2, 10);
    verify(videos).taskRows(7L, null, "2026-10-01", "2026-10-13", "FAILED", "shared-model");
    verify(images).imageTaskPage(7L, "2026-10-01", "2026-10-13", "FAILED", "shared-model", null, 1, 100, true);
  }

  @Test void separateTabsReuseTheSamePagingAndAuthorizationRules() {
    imageRows.add(image(1, start));
    assertEquals(1, service.tasks(7L, "image", null, null, "", "", 7L, 0, 200).total());
    verify(images).imageTaskPage(7L, null, null, "", "", null, 1, 100, true);
    page("video", 1, 10);
    page("enhance", 1, 10);
    verify(videos).taskRows(null, "VIDEO", null, null, "", null);
    verify(videos).taskRows(null, "VIDEO_ENHANCE", null, null, "", null);
    clearInvocations(images, videos);
    assertEquals(0, service.tasks(7L, "all", null, null, null, null, 8L, 1, 10).total());
    verifyNoInteractions(images, videos);
  }

  @Test void validatesFiltersAndSafelyHandlesLargeOrEmptyPages() {
    assertThrows(ApiException.class, () -> page("bad", 1, 10));
    assertThrows(ApiException.class, () -> service.tasks(null, "all", "invalid", null, null, null, null, 1, 10));
    assertThrows(ApiException.class, () -> service.tasks(null, "all", "2026-10-13", "2026-10-01", null, null, null, 1, 10));
    assertThrows(ApiException.class, () -> service.tasks(null, "all", null, null, "bad", null, null, 1, 10));
    assertTrue(page("all", Integer.MAX_VALUE, 100).tasks().isEmpty());
    assertEquals(0, page("all", 1, 0).total());
  }
}
