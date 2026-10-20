package com.youmi.api.canvas;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.youmi.api.admin.AdminAuthService;
import com.youmi.api.common.ApiException;
import com.youmi.api.common.GlobalExceptionHandler;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class CharacterAssetControllerTest {
  private MockMvc mvc;
  private CharacterAssetService service;
  private AdminAuthService auth;

  @BeforeEach
  void setUp() {
    service = mock(CharacterAssetService.class);
    auth = mock(AdminAuthService.class);
    when(auth.requireUserId("Bearer owner")).thenReturn(7L);
    when(auth.requireUserId(null)).thenThrow(new ApiException(401, "未登录"));
    mvc = MockMvcBuilders.standaloneSetup(new CharacterAssetController(service, auth))
        .setControllerAdvice(new GlobalExceptionHandler()).build();
  }

  @Test
  void listUsesSessionOwnerAndIsNotScopedToProject() throws Exception {
    when(service.list(7L)).thenReturn(List.of(asset()));
    mvc.perform(get("/api/canvas/characters").header("Authorization", "Bearer owner")
            .param("userId", "999").param("canvasId", "some-other-project"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.code").value(0))
        .andExpect(jsonPath("$.data[0].id").value("character-a"))
        .andExpect(jsonPath("$.data[0].config.outfit").value("居家服"));
    verify(service).list(7L);
    verify(service, never()).list(999L);
  }

  @Test
  void listSaveGetAndDeleteAllRequireAuthentication() throws Exception {
    mvc.perform(get("/api/canvas/characters")).andExpect(status().isUnauthorized());
    mvc.perform(get("/api/canvas/characters/character-a")).andExpect(status().isUnauthorized());
    mvc.perform(delete("/api/canvas/characters/character-a")).andExpect(status().isUnauthorized());
    mvc.perform(post("/api/canvas/characters").contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"角色\"}"))
        .andExpect(status().isUnauthorized());
    verify(service, never()).list(any());
    verify(service, never()).save(any(), any());
  }

  @Test
  void saveReturnsDurableAssetAndDoesNotAcceptAnOwnerFromBody() throws Exception {
    when(service.save(eq(7L), any())).thenReturn(asset());
    mvc.perform(post("/api/canvas/characters").header("Authorization", "Bearer owner")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"角色\",\"config\":{\"outfit\":\"居家服\"}}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.name").value("讲解员"))
        .andExpect(jsonPath("$.data.createdAt").value(1000))
        .andExpect(jsonPath("$.data.userId").doesNotExist());
    verify(service).save(eq(7L), any());
  }

  @Test
  void getAndDeletePassSessionOwnerAndNotFoundDoesNotLeakAnotherAsset() throws Exception {
    when(service.get(7L, "character-a")).thenReturn(asset());
    mvc.perform(get("/api/canvas/characters/character-a").header("Authorization", "Bearer owner"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.id").value("character-a"));
    mvc.perform(delete("/api/canvas/characters/character-a").header("Authorization", "Bearer owner"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.id").value("character-a"));
    verify(service).delete(7L, "character-a");
    doThrow(new ApiException(404, "角色不存在或无权删除")).when(service).delete(7L, "other-owner");
    mvc.perform(delete("/api/canvas/characters/other-owner").header("Authorization", "Bearer owner"))
        .andExpect(status().isNotFound()).andExpect(jsonPath("$.data").isEmpty());
  }

  private CharacterAssetDtos.CharacterAsset asset() {
    return new CharacterAssetDtos.CharacterAsset("character-a", "讲解员", "家居讲解", "女", "成年", "东亚",
        "https://assets.example/character.jpg", "https://assets.example/cover.jpg", Map.of("outfit", "居家服"),
        1000L, 2000L);
  }
}
