import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isRetryableImageQueryError,
  queryImageTaskWithRetry,
  shouldRecoverImageQuery,
} from './imageTaskRecovery.js'

test('query retries gateway outages and returns the original task result', async () => {
  let queries = 0
  const delays = []
  const result = { status: 'completed', imageUrls: ['https://example.com/result.png'] }
  const actual = await queryImageTaskWithRetry(
    async () => {
      queries += 1
      if (queries < 3) throw Object.assign(new Error('gateway unavailable'), { status: 502 })
      return result
    },
    { wait: async (ms) => delays.push(ms) },
  )
  assert.equal(actual, result)
  assert.equal(queries, 3)
  assert.deepEqual(delays, [2500, 5000])
})

test('repeated query errors leave the outcome unknown, not generation failed', async () => {
  await assert.rejects(
    queryImageTaskWithRetry(
      async () => {
        throw Object.assign(new Error('gateway unavailable'), { status: 503 })
      },
      { maxAttempts: 2, wait: async () => {} },
    ),
    (error) => error.imageQueryPending === true,
  )
})

test('permission and missing-task errors are not retried', async () => {
  for (const status of [400, 401, 403, 404, 410]) {
    let attempts = 0
    const error = Object.assign(new Error('rejected'), { status })
    await assert.rejects(
      queryImageTaskWithRetry(async () => {
        attempts += 1
        throw error
      }),
      (actual) => actual === error,
    )
    assert.equal(attempts, 1)
  }
})

test('network errors retry, unrelated TypeError does not', () => {
  assert.equal(isRetryableImageQueryError(new TypeError('Failed to fetch')), true)
  assert.equal(isRetryableImageQueryError(new TypeError('Cannot read properties of null')), false)
  assert.equal(isRetryableImageQueryError({ name: 'TimeoutError' }), true)
})

test('unmounted page stops querying without failure', async () => {
  let active = true
  let attempts = 0
  assert.equal(
    await queryImageTaskWithRetry(
      async () => {
        attempts += 1
        throw Object.assign(new Error('bad gateway'), { status: 502 })
      },
      {
        isActive: () => active,
        wait: async () => {
          active = false
        },
      },
    ),
    null,
  )
  assert.equal(attempts, 1)
})

test('a real provider failure is returned without any transport retry', async () => {
  const status = { status: 'failed', error: 'content rejected' }
  assert.equal(await queryImageTaskWithRetry(async () => status), status)
})

test('old gateway-failed layers and messages can recover only using known task IDs', () => {
  assert.equal(
    shouldRecoverImageQuery({
      taskId: 'existing',
      failed: true,
      text: '生成失败：生图失败：接口请求失败：502',
    }),
    true,
  )
  assert.equal(
    shouldRecoverImageQuery({
      taskId: 'existing',
      status: 'failed',
      lastError: '[submitFail] Error: 接口请求失败：502',
    }),
    true,
  )
  assert.equal(shouldRecoverImageQuery({ taskId: 'existing', queryPending: true }), true)
  for (const record of [
    { text: '接口请求失败：502' },
    { taskId: 'existing', text: 'provider returned HTTP 502: content failed' },
    { taskId: 'existing', text: '接口请求失败：502', imageTaskTerminal: true },
    { taskId: 'existing', text: '接口请求失败：502', imageUrl: 'https://example.com/done.png' },
  ])
    assert.equal(shouldRecoverImageQuery(record), false)
})
