package com.youmi.api.platform;

import com.youmi.api.common.ApiException;
import java.util.List;
import java.util.Locale;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class PlatformService {
  private final PlatformRepository platformRepository;

  public PlatformService(PlatformRepository platformRepository) {
    this.platformRepository = platformRepository;
  }

  @Transactional
  public PlatformDtos.PlatformView create(PlatformDtos.PlatformCreateRequest request) {
    String name = required(request == null ? null : request.name(), "平台名称不能为空");
    String code = normalizeCode(request == null ? null : request.code());
    int sortOrder = normalizeSortOrder(request == null ? null : request.sortOrder());
    try {
      Long id = platformRepository.insert(name, code, "ACTIVE", sortOrder);
      return get(id);
    } catch (DuplicateKeyException exception) {
      throw new ApiException(400, "平台名称或编码已存在");
    }
  }

  @Transactional
  public PlatformDtos.PlatformView update(Long id, PlatformDtos.PlatformUpdateRequest request) {
    Platform platform = platformRepository.findById(id)
        .orElseThrow(() -> new ApiException(404, "平台不存在"));
    String name = StringUtils.hasText(request == null ? null : request.name())
        ? request.name().trim()
        : platform.name();
    String status = normalizeStatus(request == null ? null : request.status(), platform.status());
    int sortOrder = request != null && request.sortOrder() != null
        ? normalizeSortOrder(request.sortOrder())
        : platform.sortOrder();
    try {
      platformRepository.update(id, name, status, sortOrder);
      platformRepository.syncLegacyShopPlatformName(id, name);
      return get(id);
    } catch (DuplicateKeyException exception) {
      throw new ApiException(400, "平台名称已存在");
    }
  }

  public List<PlatformDtos.PlatformView> list() {
    return platformRepository.findAll().stream().map(this::toView).toList();
  }

  public List<PlatformDtos.PlatformPublicView> listActive() {
    return platformRepository.findActive().stream()
        .map(item -> new PlatformDtos.PlatformPublicView(item.id(), item.name(), item.code()))
        .toList();
  }

  public PlatformDtos.PlatformView get(Long id) {
    return platformRepository.findById(id)
        .map(this::toView)
        .orElseThrow(() -> new ApiException(404, "平台不存在"));
  }

  @Transactional
  public void delete(Long id) {
    platformRepository.findById(id)
        .orElseThrow(() -> new ApiException(404, "平台不存在"));
    if (platformRepository.countShops(id) > 0) {
      throw new ApiException(400, "该平台下仍有店铺，无法删除");
    }
    platformRepository.deleteById(id);
  }

  private PlatformDtos.PlatformView toView(Platform platform) {
    return new PlatformDtos.PlatformView(
        platform.id(),
        platform.name(),
        platform.code(),
        platform.status(),
        platform.sortOrder(),
        platform.createdAt(),
        platform.updatedAt());
  }

  private String required(String value, String message) {
    if (!StringUtils.hasText(value)) throw new ApiException(400, message);
    return value.trim();
  }

  private String normalizeCode(String value) {
    String code = required(value, "平台编码不能为空")
        .toUpperCase(Locale.ROOT)
        .replaceAll("[^A-Z0-9_-]", "_");
    if (code.length() > 32) code = code.substring(0, 32);
    return code;
  }

  private String normalizeStatus(String value, String fallback) {
    if (!StringUtils.hasText(value)) return fallback;
    String normalized = value.trim().toUpperCase(Locale.ROOT);
    return List.of("ACTIVE", "DISABLED").contains(normalized) ? normalized : fallback;
  }

  private int normalizeSortOrder(Integer value) {
    return value == null ? 100 : Math.max(0, Math.min(9999, value));
  }
}
