import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createImageTaskClient,
  imageTaskRequest,
  imageTaskResult,
  imageTaskBatchResult,
  imageModelOptions,
  imageTaskQueryFailure,
} from '../src/features/canvas-v3/sync/imageTaskClient.js'

test('builds one idempotent image request using connected image and text inputs', () => {
  const result = imageTaskRequest(
    {
      data: {
        model: 'banana-pro-api',
        prompt: '清晨',
        params: { ratio: '16:9', resolution: '4K', count: '2张', background: '透明背景' },
      },
    },
    [
      { data: { kind: 'text', title: '创意', prompt: '暖色阳光' } },
      { data: { kind: 'image', assetUrl: 'https://example.com/ref.png' } },
      { data: { kind: 'image', assetUrl: 'https://example.com/ref.png' } },
      { data: { kind: 'video', assetUrl: 'https://example.com/video.mp4' } },
    ],
    'stable-request-id',
  )
  assert.equal(result.prompt, '清晨\n\n创意：\n暖色阳光')
  assert.deepEqual(result.image_urls, ['https://example.com/ref.png'])
  assert.equal(result.n, 2)
  assert.equal(result.client_task_id, 'stable-request-id')
  assert.equal(result.output_format, 'png')
  assert.equal(result.feature_code, 'canvas-image')
})

test('never invents progress or a completed state without returned media', () => {
  assert.equal(imageTaskResult({ status: 'running', progress: null }).progress, null)
  assert.equal(imageTaskResult({ status: 'completed', imageUrls: [] }).state, 'running')
  assert.equal(imageTaskResult({ status: 'running', progress: 2 }).progress, 2)
  assert.equal(
    imageTaskResult({
      status: 'persisting',
      imageUrls: ['https://example.com/temp.png'],
      persistStatus: 'pending',
    }).persistPending,
    true,
  )
  assert.equal(imageTaskResult({ status: 'CANCELLED' }).state, 'failed')
})

test('a failed member does not stop queries for the rest of a multi-image batch', () => {
  const failed = imageTaskResult({ status: 'failed', error: 'provider failed' })
  const running = imageTaskResult({ status: 'running', progress: 40 })
  const success = imageTaskResult({
    status: 'completed',
    progress: 100,
    imageUrls: ['https://example.com/ready.png'],
  })
  assert.equal(imageTaskBatchResult([failed, running]).state, 'running')
  const result = imageTaskBatchResult([failed, success])
  assert.equal(result.state, 'succeeded')
  assert.deepEqual(result.urls, ['https://example.com/ready.png'])
  assert.match(result.error, /部分图片/)
})

test('a transport error on create is uncertain and is never automatically reposted', async () => {
  const calls = []
  const client = createImageTaskClient({
    fetcher: async (url, options) => {
      calls.push({ url, options })
      if (options.method === 'POST') throw new TypeError('network timeout')
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: 0, data: { exists: true, task_id: 'original-task' } }),
      }
    },
  })
  await assert.rejects(
    client.create({ client_task_id: 'stable-id' }),
    (error) => error.deliveryUnknown === true,
  )
  const recovered = await client.resolve('stable-id')
  assert.equal(recovered.task_id, 'original-task')
  assert.equal(calls.filter((call) => call.options.method === 'POST').length, 1)
  assert.match(calls[1].url, /by-client-task-id/)
})

test('distinguishes a rejected submission from an unknown provider outcome', async () => {
  const client = createImageTaskClient({
    fetcher: async () => ({
      ok: false,
      status: 402,
      json: async () => ({ code: 402, message: '米值不足' }),
    }),
  })
  await assert.rejects(
    client.create({}),
    (error) => error.status === 402 && !error.deliveryUnknown && error.message === '米值不足',
  )
})

test('a malformed success or timeout response to create remains uncertain', async () => {
  for (const response of [
    { ok: true, status: 200, json: async () => null },
    {
      ok: true,
      status: 200,
      json: async () => ({ code: 50301, message: 'provider outcome unavailable' }),
    },
    { ok: false, status: 408, json: async () => ({ message: 'request timeout' }) },
    {
      ok: false,
      status: 409,
      json: async () => ({ code: 409, message: '该图片任务正在提交' }),
    },
  ]) {
    const client = createImageTaskClient({ fetcher: async () => response })
    await assert.rejects(client.create({}), (error) => error.deliveryUnknown === true)
  }

  const queryClient = createImageTaskClient({ fetcher: async () => Promise.reject(new Error()) })
  await assert.rejects(queryClient.get('task'), (error) => error.deliveryUnknown === false)
})

test('an explicit pre-dispatch rejection is the only safe nonzero 2xx create response', async () => {
  for (const payload of [
    { code: 42201, message: 'validation failed', retry_safe: true },
    { code: 42202, message: 'validation failed', phase: 'pre_dispatch' },
    { code: 42203, message: 'validation failed', data: { retry_safe: true } },
    { code: 42204, message: 'validation failed', data: { phase: 'PRE_DISPATCH' } },
  ]) {
    const client = createImageTaskClient({
      fetcher: async () => ({ ok: true, status: 200, json: async () => payload }),
    })
    await assert.rejects(
      client.create({}),
      (error) => error.deliveryUnknown === false && error.status === payload.code,
    )
  }
})

test('maps configured display aliases to the same provider routes as the existing canvas', () => {
  const options = imageModelOptions([
    { value: 'banana-pro', label: '香蕉 Pro' },
    { value: 'GPT-image2.5', label: '快速' },
    { value: 'GPT-image2.5', label: '高质' },
  ])
  assert.deepEqual(
    options.map((option) => option.value),
    ['banana-pro-api', 'GPT-image2.5', 'gpt-image2.5-sunburst-api'],
  )
})

test('a 404 query cannot discard a successful sibling or pretend generation failed', () => {
  const success = {
    ...imageTaskResult({ status: 'completed', imageUrls: ['https://example.com/ready.png'] }),
    taskId: 'first',
  }
  const missing = imageTaskQueryFailure({ status: 404 }, 'second')
  const partial = imageTaskBatchResult([success, missing])
  assert.equal(partial.state, 'succeeded')
  assert.deepEqual(partial.urls, ['https://example.com/ready.png'])
  assert.deepEqual(partial.unresolvedTaskIds, ['second'])
  assert.match(partial.queryMessage, /404/)
  assert.doesNotMatch(partial.queryMessage, /连接中断/)
  assert.equal(imageTaskBatchResult([missing]).state, 'blocked')
  assert.equal(missing.retryable, false)
})

test('temporary query failures keep successful results visible and only retry GET', () => {
  const success = {
    ...imageTaskResult({ status: 'completed', imageUrls: ['https://example.com/ready.png'] }),
    taskId: 'first',
  }
  const temporary = imageTaskQueryFailure({ status: 503 }, 'second')
  const batch = imageTaskBatchResult([success, temporary])
  assert.equal(batch.state, 'running')
  assert.equal(batch.urls.length, 1)
  assert.equal(temporary.retryable, true)
  assert.equal(imageTaskQueryFailure({ status: 401 }, 'second').retryable, false)
})
