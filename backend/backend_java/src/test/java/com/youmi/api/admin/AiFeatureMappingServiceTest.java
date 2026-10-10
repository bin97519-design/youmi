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
  }
}
