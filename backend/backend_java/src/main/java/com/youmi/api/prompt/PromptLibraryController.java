package com.youmi.api.prompt;

import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiException;
import com.youmi.api.common.ApiResponse;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/prompt-library")
public class PromptLibraryController {
  private static final Set<String> VIEWS = Set.of("all", "mine", "public", "recent");
  private static final Set<String> CATEGORIES = Set.of(
      "ALL", "GENERAL", "MAIN_IMAGE", "DETAIL", "SCENE", "SELLING_POINT", "EDIT", "OTHER");
  private static final Set<String> SOURCES = Set.of(
      "MANUAL", "INPUT", "AGENT", "REVERSE", "HISTORY", "PUBLIC");

  private final PromptLibraryRepository repository;
  private final AdminAuthService adminAuthService;

  public PromptLibraryController(
      PromptLibraryRepository repository,
      AdminAuthService adminAuthService) {
    this.repository = repository;
    this.adminAuthService = adminAuthService;
  }

  @GetMapping
  public ApiResponse<List<PromptLibraryDtos.PromptResponse>> list(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestParam(defaultValue = "all") String view,
      @RequestParam(defaultValue = "") String query,
      @RequestParam(defaultValue = "ALL") String category) {
    Long userId = adminAuthService.requireUserId(authorization);
    String cleanView = cleanView(view);
    String cleanCategory = cleanEnum(category, CATEGORIES, "ALL");
    return ApiResponse.ok(repository.findVisible(userId, cleanView, clean(query, 120), cleanCategory));
  }

  @PostMapping
  public ApiResponse<PromptLibraryDtos.PromptResponse> create(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody PromptLibraryDtos.SaveRequest request) {
    Long userId = adminAuthService.requireUserId(authorization);
    ValidatedPrompt prompt = validate(request);
    return ApiResponse.ok(repository.createPersonal(
        userId,
        prompt.title(),
        prompt.content(),
        prompt.category(),
        prompt.tags(),
        prompt.source()));
  }

  @PutMapping("/{id}")
  public ApiResponse<PromptLibraryDtos.PromptResponse> update(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable Long id,
      @RequestBody PromptLibraryDtos.SaveRequest request) {
    Long userId = adminAuthService.requireUserId(authorization);
    ValidatedPrompt prompt = validate(request);
    return ApiResponse.ok(repository.updatePersonal(
        id,
        userId,
        prompt.title(),
        prompt.content(),
        prompt.category(),
        prompt.tags(),
        prompt.source()).orElseThrow(() -> new ApiException(404, "提示词不存在或无权修改")));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Map<String, Long>> delete(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable Long id) {
    Long userId = adminAuthService.requireUserId(authorization);
    if (!repository.deletePersonal(id, userId)) {
      throw new ApiException(404, "提示词不存在或无权删除");
    }
    return ApiResponse.ok(Map.of("id", id));
  }

  @PostMapping("/{id}/use")
  public ApiResponse<PromptLibraryDtos.PromptResponse> markUsed(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable Long id) {
    Long userId = adminAuthService.requireUserId(authorization);
    return ApiResponse.ok(repository.markUsed(id, userId)
        .orElseThrow(() -> new ApiException(404, "提示词不存在")));
  }

  private ValidatedPrompt validate(PromptLibraryDtos.SaveRequest request) {
    String content = clean(request == null ? "" : request.content(), 12000);
    if (content.isBlank()) throw new ApiException(400, "提示词内容不能为空");
    String title = clean(request == null ? "" : request.title(), 128);
    if (title.isBlank()) {
      title = content.length() > 24 ? content.substring(0, 24) + "…" : content;
    }
    String category = cleanEnum(
        request == null ? "" : request.category(), CATEGORIES, "OTHER");
    if ("ALL".equals(category)) category = "OTHER";
    String source = cleanEnum(request == null ? "" : request.source(), SOURCES, "MANUAL");
    List<String> tags = sanitizeTags(request == null ? List.of() : request.tags());
    return new ValidatedPrompt(title, content, category, tags, source);
  }

  private List<String> sanitizeTags(List<String> values) {
    if (values == null) return List.of();
    LinkedHashSet<String> tags = new LinkedHashSet<>();
    for (String value : values) {
      String tag = clean(value, 24);
      if (!tag.isBlank()) tags.add(tag);
      if (tags.size() >= 12) break;
    }
    return List.copyOf(tags);
  }

  private String cleanEnum(String value, Set<String> allowed, String fallback) {
    String cleaned = value == null ? "" : value.trim().toUpperCase();
    return allowed.contains(cleaned) ? cleaned : fallback;
  }

  private String cleanView(String value) {
    String cleaned = value == null ? "" : value.trim().toLowerCase();
    return VIEWS.contains(cleaned) ? cleaned : "all";
  }

  private String clean(String value, int maxLength) {
    if (value == null) return "";
    String cleaned = value.trim();
    return cleaned.length() > maxLength ? cleaned.substring(0, maxLength) : cleaned;
  }

  private record ValidatedPrompt(
      String title,
      String content,
      String category,
      List<String> tags,
      String source) {}
}
