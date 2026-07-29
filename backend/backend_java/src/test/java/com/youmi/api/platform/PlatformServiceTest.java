package com.youmi.api.platform;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.youmi.api.common.ApiException;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;

class PlatformServiceTest {
  @Mock
  private PlatformRepository repository;

  private PlatformService service;

  @BeforeEach
  void setUp() {
    MockitoAnnotations.openMocks(this);
    service = new PlatformService(repository);
  }

  @Test
  void createNormalizesCodeAndReturnsCreatedPlatform() {
    Platform created = platform(7L, "小红书", "XHS", "ACTIVE", 50);
    when(repository.insert("小红书", "XHS", "ACTIVE", 50)).thenReturn(7L);
    when(repository.findById(7L)).thenReturn(Optional.of(created));

    PlatformDtos.PlatformView result =
        service.create(new PlatformDtos.PlatformCreateRequest(" 小红书 ", "xhs", 50));

    assertEquals("XHS", result.code());
    assertEquals("小红书", result.name());
  }

  @Test
  void updateSynchronizesLegacyShopPlatformName() {
    Platform before = platform(1L, "淘宝", "TAOBAO", "ACTIVE", 10);
    Platform after = platform(1L, "淘宝平台", "TAOBAO", "ACTIVE", 10);
    when(repository.findById(1L))
        .thenReturn(Optional.of(before))
        .thenReturn(Optional.of(after));

    PlatformDtos.PlatformView result =
        service.update(1L, new PlatformDtos.PlatformUpdateRequest("淘宝平台", null, null));

    assertEquals("淘宝平台", result.name());
    verify(repository).syncLegacyShopPlatformName(1L, "淘宝平台");
  }

  @Test
  void deleteRejectsPlatformThatStillOwnsShops() {
    when(repository.findById(1L))
        .thenReturn(Optional.of(platform(1L, "淘宝", "TAOBAO", "ACTIVE", 10)));
    when(repository.countShops(1L)).thenReturn(2L);

    ApiException exception = assertThrows(ApiException.class, () -> service.delete(1L));

    assertEquals("该平台下仍有店铺，无法删除", exception.getMessage());
  }

  private Platform platform(Long id, String name, String code, String status, int sortOrder) {
    return new Platform(id, name, code, status, sortOrder, null, null);
  }
}
