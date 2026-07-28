package com.youmi.api.shop;

import com.youmi.api.common.ApiException;
import com.youmi.api.platform.Platform;
import com.youmi.api.platform.PlatformRepository;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

/**
 * 店铺业务逻辑。
 *
 * <p>负责店铺 CRUD 与公开列表，所有校验失败统一抛出 {@link ApiException}(400, ...)。
 */
@Service
public class ShopService {
  private final ShopRepository shopRepository;
  private final PlatformRepository platformRepository;

  public ShopService(ShopRepository shopRepository, PlatformRepository platformRepository) {
    this.shopRepository = shopRepository;
    this.platformRepository = platformRepository;
  }

  @Transactional
  public ShopDtos.ShopView createShop(ShopDtos.ShopCreateRequest request) {
    String name = normalizeRequired(request.name(), "店铺名称不能为空");
    String code = normalizeRequired(request.code(), "店铺编码不能为空")
        .toUpperCase(java.util.Locale.ROOT);
    if (shopRepository.findByCode(code).isPresent()) {
      throw new ApiException(400, "店铺编码已存在");
    }
    Platform platform = resolvePlatform(request.platformId(), request.platform());
    Long id = shopRepository.insert(name, code, platform.id(), platform.name(), "ACTIVE");
    return getShop(id);
  }

  @Transactional
  public ShopDtos.ShopView updateShop(Long id, ShopDtos.ShopUpdateRequest request) {
    Shop shop = shopRepository.findById(id).orElseThrow(() -> new ApiException(404, "店铺不存在"));
    String name = StringUtils.hasText(request.name()) ? request.name().trim() : shop.name();
    String status = normalizeStatus(request.status(), shop.status());
    Platform platform = request.platformId() == null
        ? platformRepository.findById(shop.platformId())
            .orElseThrow(() -> new ApiException(400, "店铺所属平台不存在"))
        : resolvePlatform(request.platformId(), null);
    shopRepository.update(id, name, platform.id(), platform.name(), status);
    return getShop(id);
  }

  public List<ShopDtos.ShopView> listShops(String status) {
    List<Shop> shops = StringUtils.hasText(status)
        ? shopRepository.findByStatus(status.trim().toUpperCase(java.util.Locale.ROOT))
        : shopRepository.findAll();
    return shops.stream().map(this::toView).toList();
  }

  @Transactional
  public void deleteShop(Long id) {
    shopRepository.findById(id).orElseThrow(() -> new ApiException(404, "店铺不存在"));
    long boundUsers = shopRepository.countUsersByShopId(id);
    if (boundUsers > 0) {
      throw new ApiException(400, "该店铺下仍有账号，无法删除");
    }
    shopRepository.deleteById(id);
  }

  /** 公开列表：仅返回 ACTIVE 店铺的 id/name/code，供注册页下拉取数。 */
  public List<ShopDtos.ShopPublicView> listActiveShops() {
    return shopRepository.findActive().stream()
        .map(shop -> new ShopDtos.ShopPublicView(
            shop.id(),
            shop.name(),
            shop.code(),
            shop.platformId(),
            shop.platformCode(),
            shop.platformName()))
        .toList();
  }

  public ShopDtos.ShopView getShop(Long id) {
    Shop shop = shopRepository.findById(id).orElseThrow(() -> new ApiException(404, "店铺不存在"));
    return toView(shop);
  }

  private ShopDtos.ShopView toView(Shop shop) {
    return new ShopDtos.ShopView(
        shop.id(),
        shop.name(),
        shop.code(),
        shop.platformId(),
        shop.platformCode(),
        shop.platformName(),
        shop.platformName(),
        shop.status(),
        shop.createdAt(),
        shop.updatedAt());
  }

  private String normalizeRequired(String value, String message) {
    if (!StringUtils.hasText(value)) throw new ApiException(400, message);
    return value.trim();
  }

  private String normalizeStatus(String value, String fallback) {
    if (!StringUtils.hasText(value)) return fallback;
    String normalized = value.trim().toUpperCase(java.util.Locale.ROOT);
    return List.of("ACTIVE", "DISABLED").contains(normalized) ? normalized : fallback;
  }

  private Platform resolvePlatform(Long platformId, String legacyPlatform) {
    Platform platform;
    if (platformId != null) {
      platform = platformRepository.findById(platformId)
          .orElseThrow(() -> new ApiException(400, "请选择有效的平台"));
    } else if (StringUtils.hasText(legacyPlatform)) {
      platform = platformRepository.findByNameOrCode(legacyPlatform.trim())
          .orElseThrow(() -> new ApiException(400, "请选择有效的平台"));
    } else {
      platform = platformRepository.findByCode("OTHER")
          .orElseThrow(() -> new ApiException(500, "默认平台未初始化"));
    }
    if (!"ACTIVE".equals(platform.status())) {
      throw new ApiException(400, "请选择已启用的平台");
    }
    return platform;
  }
}
