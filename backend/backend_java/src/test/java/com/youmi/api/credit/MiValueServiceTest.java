package com.youmi.api.credit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.youmi.api.auth.UserRepository;
import java.math.BigDecimal;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
@DisplayName("米值消费记录服务")
class MiValueServiceTest {
  @Mock private MiValueRepository repository;
  @Mock private MiValueProperties properties;
  @Mock private UserRepository userRepository;

  private MiValueService service;
  private static final Long USER = 99001L;

  @BeforeEach
  void setUp() {
    service = new MiValueService(repository, properties, userRepository);
  }

  @Test
  @DisplayName("不检查账户余额，只登记待确认消费")
  void recordsPendingConsumptionWithoutBalanceGate() {
    when(properties.getPrice(MiBizType.IMAGE)).thenReturn(new BigDecimal("10.00"));
    when(repository.insertLog(eq(USER), eq(MiBizType.IMAGE), any(), eq(new BigDecimal("10.00")), eq(0), eq(0),
        eq("PENDING"), any())).thenReturn(123L);

    MiValueDtos.DeductResult result = service.checkAndDeduct(USER, MiBizType.IMAGE);

    assertEquals(123L, result.logId());
    assertEquals(new BigDecimal("10.00"), result.price());
    assertEquals(new BigDecimal("0.00"), result.beforeBalance());
    assertEquals(new BigDecimal("0.00"), result.afterBalance());
    verify(repository, never()).getBalance(USER);
    verify(repository, never()).deductAtomic(USER, 10);
  }

  @Test
  @DisplayName("实际供应商价格结算只修正消费金额，不操作余额")
  void settlesActualConsumptionWithoutRefund() {
    MiValueRepository.LogRow row =
        new MiValueRepository.LogRow(11L, USER, 8, "PENDING", "IMAGE");
    when(repository.findLogById(11L)).thenReturn(Optional.of(row));

    MiValueDtos.DeductResult result = service.settle(11L, 6);

    assertEquals(new BigDecimal("6.00"), result.price());
    assertEquals(new BigDecimal("0.00"), result.afterBalance());
    verify(repository).settle(11L, new BigDecimal("6.00"), 0);
    verify(repository, never()).refund(USER, 2);
  }

  @Test
  @DisplayName("失败任务标记回滚，不执行余额退款")
  void rollbackOnlyInvalidatesConsumption() {
    service.rollback(USER, 77L);

    verify(repository).markRollback(77L);
    verify(repository, never()).refund(eq(USER), anyInt());
  }

  @Test
  @DisplayName("成功任务确认消费流水")
  void commitsConsumptionByTaskId() {
    MiValueRepository.LogRow row =
        new MiValueRepository.LogRow(10L, USER, 10, "PENDING", "IMAGE");
    when(repository.findLogByTaskId("task-x")).thenReturn(Optional.of(row));

    service.commitByTaskId("task-x");

    verify(repository).setLogStatus(10L, "SUCCESS");
  }

  @Test
  @DisplayName("供应商实际成本可以覆盖已成功的预估消费")
  void settlesActualConsumptionByTaskId() {
    service.settleActualByTaskId("task-cost", 7);

    verify(repository).settleActualByTaskId("task-cost", new BigDecimal("7.00"));
  }

  @Test
  @DisplayName("余额调账已停用")
  void balanceAdjustmentIsDisabled() {
    assertThrows(UnsupportedOperationException.class,
        () -> service.adjustByAdmin(USER, 50, "充值"));
    verify(repository, never()).adminAdjust(USER, 50);
  }

  @Test
  @DisplayName("查询个人累计成功消费")
  void returnsAccumulatedConsumption() {
    when(repository.getConsumedMi(USER)).thenReturn(new BigDecimal("321.00"));
    assertEquals(new BigDecimal("321.00"), service.getConsumedMi(USER));
  }
}
