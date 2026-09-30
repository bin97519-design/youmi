const RETRYABLE_QUERY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

export function isRetryableImageQueryError(error) {
  if (RETRYABLE_QUERY_STATUSES.has(Number(error?.status))) return true
  return (
    ['AbortError', 'TimeoutError'].includes(error?.name) ||
    (error?.name === 'TypeError' && /fetch|network|load failed/i.test(error?.message || ''))
  )
}

export function imageQueryPendingError(cause) {
  const error = new Error('图片结果暂未确认，请稍后继续查询原任务')
  error.imageQueryPending = true
  error.cause = cause
  return error
}

export function shouldRecoverImageQuery(record) {
  if (!record?.taskId || record.imageUrl || record.imageTaskTerminal) return false
  if (record.queryPending) return true
  // Migrate only the old transport-error message, never an upstream task failure.
  return /接口请求失败[：:]\s*(?:408|425|429|500|502|503|504)\b/.test(
    `${record.lastError || ''} ${record.text || ''}`,
  )
}

export async function queryImageTaskWithRetry(
  query,
  {
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    isActive = () => true,
    onRetry = () => {},
    maxAttempts = 12,
  } = {},
) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (!isActive()) return null
    try {
      return await query()
    } catch (error) {
      if (!isActive()) return null
      if (!isRetryableImageQueryError(error)) throw error
      if (attempt === maxAttempts - 1) throw imageQueryPendingError(error)
      onRetry(error, attempt + 1)
      await wait(Math.min(10000, 2500 * (attempt + 1)))
    }
  }
  throw imageQueryPendingError()
}
