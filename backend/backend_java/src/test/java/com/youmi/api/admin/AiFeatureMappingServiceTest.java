package com.youmi.api.admin;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.youmi.api.image.ModelApiKeyService;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class AiFeatureMappingServiceTest {
  @Test
  void exposesSeparateProductVideoImageAndVideoMappings() {
    var keys = mock(ModelApiKeyService.class);
    var repository = mock(AiFeatureMappingRepository.class);
    when(keys.list()).thenReturn(java.util.List.of());
    when(repository.find(anyString())).thenReturn(Optional.empty());
    var service = new AiFeatureMappingService(keys, repository);

    var mappings = service.list();

    var image = mappings.stream().filter(row -> row.featureCode().equals("product-video-image"))
        .findFirst().orElseThrow();
    var video = mappings.stream().filter(row -> row.featureCode().equals("product-video-video"))
        .findFirst().orElseThrow();
    assertEquals(ModelApiKeyService.MODEL_TYPE_IMAGE_GENERATION, image.modelType());
    assertEquals(ModelApiKeyService.MODEL_TYPE_VIDEO_GENERATION, video.modelType());
    assertEquals("dropdown", image.selectionMode());
    assertEquals("dropdown", video.selectionMode());

    var enhancement = mappings.stream().filter(row -> row.featureCode().equals("video-enhancement"))
        .findFirst().orElseThrow();
    assertEquals(ModelApiKeyService.MODEL_TYPE_VIDEO_ENHANCEMENT, enhancement.modelType());
    assertEquals("system_default", enhancement.selectionMode());
    assertFalse(enhancement.configured());
    assertTrue(enhancement.fallbackRoute().contains("超分密钥"));
  }
}
