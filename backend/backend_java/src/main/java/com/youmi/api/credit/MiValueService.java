package com.youmi.api.credit;

import com.youmi.api.auth.UserRepository;
import java.util.Optional;
import org.springframework.stereotype.Service;

/**
 * 米值计费服务层。承载「先扣后生成、失败回滚、可审计」的核心闭环逻辑。
 *
 * <p>设计要点：
 * <ul>
 *   <li>扣减成功 = 余额已减少（原子 SQL 保证）；后续只有 commit/rollback 改流水状态，不动余额，
 *       保证扣减与流水最终一致。</li>
 *   <li>余额不足或并发 race 时抛出 {@link MiValueInsufficientException}(HTTP 402)，绝不发起外部调用。</li>
 *   <li>回滚是幂等的：仅当流水处于 PENDING/SUCCESS 时才退款，重复调用不会多退。</li>
 * </ul>
 */
@Service
public class MiValueService {
  private final MiValueRepository repository;
  private final MiValueProperties properties;
  private final UserRepository userRepository;

  public MiValueService(
      MiValueRepository repository,
      MiValueProperties properties,
      UserRepository userRepository) {
    this.repository = repository;
    this.properties = properties;
    this.userRepository = userRepository;
  }

  /**
   * 校验并原子扣减。仅当扣减成功后写入 PENDING 流水。
   *
   * @return 扣减明细（含自增流水 id）
   * @throws MiValueInsufficientException 余额不足或并发竞争失败（HTTP 402）
   */
  public MiValueDtos.DeductResult checkAndDeduct(Long userId, MiBizType bizType) {
    int price = properties.getPrice(bizType);
    int balance = repository.getBalance(userId);
    if (balance < price) {
      throw new MiValueInsufficientException(balance);
    }
    int affected = repository.deductAtomic(userId, price);
    if (affected == 0) {
      // 并发 race：在 getBalance 之后、扣减之前被其他请求抢先扣光
      throw new MiValueInsufficientException(balance);
    }
    long logId = repository.insertLog(
        userId, bizType, null, price, balance, balance - price, "PENDING", null);
    return new MiValueDtos.DeductResult(logId, balance, balance - price, price, bizType);
  }

  /** 生成成功：将 PENDING 流水置为 SUCCESS（不动余额） */
  public void commit(Long logId) {
    repository.setLogStatus(logId, "SUCCESS");
  }

  /** 按 task_id 确认成功（异步轮询到终态 SUCCESS 时调用，幂等） */
  public void commitByTaskId(String taskId) {
    repository.findLogByTaskId(taskId)
        .ifPresent(row -> repository.setLogStatus(row.logId(), "SUCCESS"));
  }

  /** 生成失败：幂等回滚——仅当流水处于 PENDING/SUCCESS 时才退回米值 */
  public void rollback(Long userId, Long logId) {
    Optional<MiValueRepository.LogRow> row = repository.findLogById(logId);
    int price = row.map(MiValueRepository.LogRow::price).orElse(0);
    if (repository.markRollback(logId) > 0 && price > 0) {
      repository.refund(userId, price);
    }
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

  /** 查询用户当前余额 */
  public int getBalance(Long userId) {
    return repository.getBalance(userId);
  }

  /**
   * 管理后台调账：写一条 ADMIN_ADJUST 流水（status=SUCCESS）并调整余额（不允许负余额）。
   *
   * @return 调账前后的余额快照
   */
  public MiValueDtos.DeductResult adjustByAdmin(Long userId, int delta, String reason) {
    int before = repository.getBalance(userId);
    repository.adminAdjust(userId, delta);
    int after = repository.getBalance(userId);
    long logId = repository.insertLog(
        userId, MiBizType.ADMIN_ADJUST, null, Math.abs(delta),
        before, after, "SUCCESS", null, reason);
    return new MiValueDtos.DeductResult(logId, before, after, delta, MiBizType.ADMIN_ADJUST);
  }
}
