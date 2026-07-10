package com.youmi.api.credit;

import java.util.HashMap;
import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * 米值计费配置。单价只能从此处获取，业务代码禁止硬编码数值。
 *
 * <p>对应 application.yml 中的 {@code youmi.credit.prices.{IMAGE,VIDEO}}。
 */
@Component
@ConfigurationProperties(prefix = "youmi.credit")
public class MiValueProperties {
  /** 各业务类型的固定单价（米值/次）。例：IMAGE=10，VIDEO=50 */
  private Map<String, Integer> prices = new HashMap<>();

  public Map<String, Integer> getPrices() {
    return prices;
  }

  public void setPrices(Map<String, Integer> prices) {
    this.prices = prices == null ? new HashMap<>() : prices;
  }

  /**
   * 取指定业务类型的单价。
   *
   * @param bizType 业务类型
   * @return 单价（米值/次）；ADMIN_ADJUST 无单价返回 0
   * @throws IllegalStateException 当业务类型未配置单价时（开发期配置错误）
   */
  public int getPrice(MiBizType bizType) {
    Integer price = prices.get(bizType.name());
    if (price == null) {
      if (bizType == MiBizType.ADMIN_ADJUST) {
        return 0;
      }
      throw new IllegalStateException("未配置米值单价: " + bizType);
    }
    return price;
  }
}
