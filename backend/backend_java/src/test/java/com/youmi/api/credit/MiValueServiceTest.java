package com.youmi.api.credit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.youmi.api.auth.UserRepository;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * 米值服务层单测：直接构造 {@link MiValueService}，mock 其依赖 {@link MiValueRepository} /
 * {@link MiValueProperties} / {@link UserRepository}，聚焦于「先扣后生成、失败回滚、幂等」的业务逻辑，
 * 不依赖数据库与外网。
 */
@ExtendWith(MockitoExtension.class)
@DisplayName("米值服务层单测（mock MiValueRepository）")
class MiValueServiceTest {

  @Mock
  private MiValueRepository repository;
  @Mock
  private MiValueProperties properties;
  @Mock
  private UserRepository userRepository;

  private MiValueService service;

  private static final Long USER = 99001L;

  @BeforeEach
  void setUp() {
    service = new MiValueService(repository, properties, userRepository);
  }

  // ============ 余额充足：扣减成功并写 PENDING 流水 ============
  @Test
  @DisplayName("余额充足：checkAndDeduct 返回 afterBalance=before-price 且插入 PENDING 流水")
  void checkAndDeduct_sufficientBalance_insertsPending() {
    when(properties.getPrice(MiBizType.IMAGE)).thenReturn(10);
    when(repository.getBalance(USER)).thenReturn(100);
    when(repository.deductAtomic(USER, 10)).thenReturn(1);
    when(repository.insertLog(eq(USER), eq(MiBizType.IMAGE), any(), eq(10), eq(100), eq(90),
        eq("PENDING"), any())).thenReturn(123L);

    MiValueDtos.DeductResult result = service.checkAndDeduct(USER, MiBizType.IMAGE);

    assertEquals(123L, result.logId());
    assertEquals(100, result.beforeBalance());
    assertEquals(90, result.afterBalance());
    assertEquals(10, result.price());
    assertEquals(MiBizType.IMAGE, result.bizType());
    verify(repository).deductAtomic(USER, 10);
    verify(repository).insertLog(eq(USER), eq(MiBizType.IMAGE), any(), eq(10), eq(100), eq(90),
        eq("PENDING"), any());
  }

  // ============ 余额不足：抛 402，绝不发起外部调用 ============
  @Test
  @DisplayName("余额不足：抛 MiValueInsufficientException(402) 且不扣减、不插流水")
  void checkAndDeduct_insufficient_throws402_noSideEffects() {
    when(properties.getPrice(MiBizType.IMAGE)).thenReturn(10);
    when(repository.getBalance(USER)).thenReturn(5);

    MiValueInsufficientException ex = assertThrows(MiValueInsufficientException.class,
        () -> service.checkAndDeduct(USER, MiBizType.IMAGE));

    assertEquals(402, ex.getCode());
    verify(repository, never()).deductAtomic(anyLong(), anyInt());
    verify(repository, never()).insertLog(anyLong(), any(), any(), anyInt(), anyInt(), anyInt(),
        anyString(), any(), any());
  }

  // ============ 扣减并发守卫：deductAtomic 返回 0 即视作不足 ============
  @Test
  @DisplayName("扣减并发守卫：deductAtomic 返回 0（被抢先扣光）时抛 402 且不再插流水")
  void checkAndDeduct_deductAtomicZero_throws402() {
    when(properties.getPrice(MiBizType.IMAGE)).thenReturn(10);
    when(repository.getBalance(USER)).thenReturn(100);
    when(repository.deductAtomic(USER, 10)).thenReturn(0);

    MiValueInsufficientException ex = assertThrows(MiValueInsufficientException.class,
        () -> service.checkAndDeduct(USER, MiBizType.IMAGE));
    assertEquals(402, ex.getCode());
    verify(repository, never()).insertLog(anyLong(), any(), any(), anyInt(), anyInt(), anyInt(),
        anyString(), any(), any());
  }

  // ============ 回滚幂等：重复 rollback 仅退款一次 ============
  @Test
  @DisplayName("回滚幂等：连续两次 rollback 同一 logId，仅首次退款（markRollback 守卫生效）")
  void rollback_idempotent_onlyRefundsOnce() {
    long logId = 777L;
    MiValueRepository.LogRow row = new MiValueRepository.LogRow(logId, USER, 10, "PENDING", "IMAGE");
    when(repository.findLogById(logId)).thenReturn(Optional.of(row));
    // 第一次 markRollback 命中（PENDING→ROLLBACK 返回 1），第二次被守卫挡掉（返回 0）
    when(repository.markRollback(logId)).thenReturn(1, 0);

    service.rollback(USER, logId);
    service.rollback(USER, logId);

    verify(repository, times(2)).markRollback(logId);
    verify(repository, times(1)).refund(USER, 10);
  }

  @Test
  @DisplayName("回滚：流水已 ROLLBACK 时 markRollback 返回 0，不再退款")
  void rollback_alreadyRolledBack_noRefund() {
    long logId = 778L;
    MiValueRepository.LogRow row = new MiValueRepository.LogRow(logId, USER, 10, "ROLLBACK", "IMAGE");
    when(repository.findLogById(logId)).thenReturn(Optional.of(row));
    when(repository.markRollback(logId)).thenReturn(0);

    service.rollback(USER, logId);

    verify(repository, times(1)).markRollback(logId);
    verify(repository, never()).refund(anyLong(), anyInt());
  }

  // ============ 异步终态回滚 / 确认（闸门闭环的另一半） ============
  @Test
  @DisplayName("按 taskId 确认成功：commitByTaskId 将 PENDING 流水置为 SUCCESS")
  void commitByTaskId_success() {
    MiValueRepository.LogRow row = new MiValueRepository.LogRow(10L, USER, 10, "PENDING", "IMAGE");
    when(repository.findLogByTaskId("task-x")).thenReturn(Optional.of(row));

    service.commitByTaskId("task-x");

    verify(repository).setLogStatus(10L, "SUCCESS");
  }

  @Test
  @DisplayName("按 taskId 回滚：rollbackByTaskId 找到流水后幂等回滚（仅退款一次）")
  void rollbackByTaskId_idempotent() {
    MiValueRepository.LogRow row = new MiValueRepository.LogRow(11L, USER, 10, "PENDING", "IMAGE");
    when(repository.findLogByTaskId("task-y")).thenReturn(Optional.of(row));
    when(repository.findLogById(11L)).thenReturn(Optional.of(row));
    when(repository.markRollback(11L)).thenReturn(1, 0);

    service.rollbackByTaskId(USER, "task-y");
    service.rollbackByTaskId(USER, "task-y");

    verify(repository, times(2)).markRollback(11L);
    verify(repository, times(1)).refund(USER, 10);
  }

  // ============ 管理后台调账 ============
  @Test
  @DisplayName("管理调账：正 delta 正确调用 adminAdjust 并写 ADMIN_ADJUST 流水")
  void adjustByAdmin_positiveDelta() {
    when(repository.getBalance(USER)).thenReturn(100, 150);
    when(repository.insertLog(eq(USER), eq(MiBizType.ADMIN_ADJUST), any(), eq(50), eq(100),
        eq(150), eq("SUCCESS"), any(), eq("充值"))).thenReturn(555L);

    MiValueDtos.DeductResult r = service.adjustByAdmin(USER, 50, "充值");
    assertEquals(150, r.afterBalance());
    verify(repository).adminAdjust(USER, 50);
    verify(repository).insertLog(eq(USER), eq(MiBizType.ADMIN_ADJUST), any(), eq(50), eq(100),
        eq(150), eq("SUCCESS"), any(), eq("充值"));
  }

  @Test
  @DisplayName("管理调账：负 delta 也正确调用 adminAdjust（负到 0 的边界由 SQL GREATEST 保证，见仓储集成测试）")
  void adjustByAdmin_negativeDelta() {
    when(repository.getBalance(USER)).thenReturn(50, 20);
    when(repository.insertLog(eq(USER), eq(MiBizType.ADMIN_ADJUST), any(), eq(30), eq(50),
        eq(20), eq("SUCCESS"), any(), eq("扣减"))).thenReturn(556L);

    MiValueDtos.DeductResult r = service.adjustByAdmin(USER, -30, "扣减");
    assertEquals(20, r.afterBalance());
    verify(repository).adminAdjust(USER, -30);
  }
}
