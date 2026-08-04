package com.youmi.api.credit;

import com.youmi.api.auth.UserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 米值消费记录服务。米值不是预付余额，生成前只创建待确认流水，成功后计入消费，失败则回滚流水。
 */
@Service
public class MiValueService {
  private final MiValueRepository repository;
  private final MiValueProperties properties;

  public MiValueService(
      MiValueRepository repository,
      MiValueProperties properties,
      UserRepository ignoredUserRepository) {
    this.repository = repository;
    this.properties = properties;
  }

  /** 创建 PENDING 消费流水，保留旧方法名以兼容现有调用方。 */
  public MiValueDtos.DeductResult checkAndDeduct(Long userId, MiBizType bizType) {
    return checkAndDeduct(userId, bizType, properties.getPrice(bizType));
  }

  @Transactional
  public MiValueDtos.DeductResult checkAndDeduct(Long userId, MiBizType bizType, int price) {
    if (price < 0) throw new IllegalArgumentException("Mi value price must not be negative");
    // Mi value is consumption accounting, not a prepaid balance. Keep the legacy
    // method name for callers, but only create an auditable pending record here.
    long logId = repository.insertLog(
        userId, bizType, null, price, 0, 0, "PENDING", null);
    return new MiValueDtos.DeductResult(logId, 0, 0, price, bizType);
  }

  @Transactional
  public MiValueDtos.DeductResult settle(Long logId, int settledPrice) {
    MiValueRepository.LogRow row = repository.findLogById(logId)
        .orElseThrow(() -> new IllegalArgumentException("Mi value log not found: " + logId));
    if (settledPrice < 0 || settledPrice > row.price()) {
      throw new IllegalArgumentException("Settled price exceeds reserved price");
    }
    repository.settle(logId, settledPrice, 0);
    return new MiValueDtos.DeductResult(
        logId, 0, 0, settledPrice, MiBizType.valueOf(row.bizType()));
  }

  /** 生成成功：将 PENDING 流水置为 SUCCESS。 */
  public void commit(Long logId) {
    repository.setLogStatus(logId, "SUCCESS");
  }

  /** 按 task_id 确认成功（异步轮询到终态 SUCCESS 时调用，幂等） */
  public void commitByTaskId(String taskId) {
    repository.findLogByTaskId(taskId)
        .ifPresent(row -> repository.setLogStatus(row.logId(), "SUCCESS"));
  }

  /** 生成失败：幂等标记为 ROLLBACK，不计入消费。 */
  public void rollback(Long userId, Long logId) {
    repository.markRollback(logId);
  }

  /** 生成失败（已知 userId）：按 task_id 回滚 */
  public void rollbackByTaskId(Long userId, String taskId) {
    repository.findLogByTaskId(taskId)
        .ifPresent(row -> rollback(row.userId(), row.logId()));
  }

  /** 生成失败（未知 userId）：按 task_id 内部查 user_id 后回滚 */
  public void rollbackByTaskId(String taskId) {
    repository.findLogByTaskId(taskId)
        .ifPresent(row -> rollback(row.userId(), row.logId()));
  }

  /** 关联外部任务 id 到流水（供异步终态回滚/确认） */
  public void linkTask(Long logId, String taskId) {
    if (taskId != null && !taskId.isBlank()) {
      repository.setTaskId(logId, taskId);
    }
  }

  public boolean isTaskOwnedByUser(Long userId, String taskId, MiBizType bizType) {
    return repository.isTaskOwnedByUser(taskId, userId, bizType);
  }

  /** 兼容旧响应字段；米值余额账户已取消，固定返回 0。 */
  public int getBalance(Long userId) {
    return 0;
  }

  public int getConsumedMi(Long userId) {
    return repository.getConsumedMi(userId);
  }

  /** 米值余额账户已取消，不再支持充值或调账。 */
  public MiValueDtos.DeductResult adjustByAdmin(Long userId, int delta, String reason) {
    throw new UnsupportedOperationException("Mi value balance accounts have been removed");
  }
}
