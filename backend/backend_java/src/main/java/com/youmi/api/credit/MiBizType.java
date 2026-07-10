package com.youmi.api.credit;

/**
 * 米值业务类型。
 *
 * <p>仅 IMAGE / VIDEO 会真实扣减米值；ADMIN_ADJUST 用于管理后台手动调账（仅做审计流水，不扣减）。
 */
public enum MiBizType {
  /** 文生图 / 图生图 */
  IMAGE,
  /** 视频生成 */
  VIDEO,
  /** 管理后台手动调整余额（审计用途，不扣减） */
  ADMIN_ADJUST
}
