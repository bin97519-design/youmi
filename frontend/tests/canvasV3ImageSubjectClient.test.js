import test from 'node:test'
import assert from 'node:assert/strict'
import {
  generateSubjectDescription,
  subjectDescriptionFromAnalysis,
} from '../src/features/canvas-v3/sync/imageSubjectClient.js'

const success = (subject) => ({ code: 0, data: { promptJson: { subject_and_elements: subject } } })
const response = (payload, ok = true, status = 200) => ({ ok, status, json: async () => payload })
test('subject analysis uses the real general category and passes authorization and cancellation', async () => {
  const calls = []
  const controller = new AbortController()
  const result = await generateSubjectDescription(
    { imageUrl: 'https://example.com/a.png', signal: controller.signal },
    {
      path: (path) => `/base${path}`,
      headers: () => ({ Authorization: 'Bearer user-token' }),
      fetcher: async (url, options) => {
        calls.push({ url, options })
        return response(
          success({ core_subject: '蓝发双辫，黑色背心', auxiliary_props: '背景海报' }),
        )
      },
    },
  )
  assert.equal(result, '蓝发双辫，黑色背心')
  assert.equal(calls[0].url, '/base/api/prompt/analyze-image')
  assert.equal(calls[0].options.signal, controller.signal)
  assert.equal(calls[0].options.headers.Authorization, 'Bearer user-token')
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    category: 'general',
    imageUrl: 'https://example.com/a.png',
    thinkingEnabled: false,
  })
})
test('inline images use imageBase64 and invalid URLs never make a request', async () => {
  const calls = []
  const fetcher = async (_url, options) => {
    calls.push(JSON.parse(options.body))
    return response(success('蓝发人物'))
  }
  await generateSubjectDescription({ imageUrl: 'data:image/png;base64,AAAA' }, { fetcher })
  assert.equal(calls[0].imageBase64, 'data:image/png;base64,AAAA')
  assert.equal(calls[0].imageUrl, undefined)
  for (const imageUrl of [
    'javascript:evil()',
    'blob:temporary',
    'data:image/svg+xml;base64,AAAA',
    'https://user:secret@example.com/a.png',
  ])
    await assert.rejects(generateSubjectDescription({ imageUrl }, { fetcher }), /地址无效/)
  assert.equal(calls.length, 1)
})
test('description only extracts meaningful subject facts, including array service responses', () => {
  assert.equal(
    subjectDescriptionFromAnalysis(success(['蓝发双辫', { core_subject: '黑色背心' }]).data),
    '蓝发双辫；黑色背心',
  )
  assert.equal(
    subjectDescriptionFromAnalysis(success({ core_subject: ' 蓝发\n 人物 ' }).data),
    '蓝发 人物',
  )
  assert.equal(
    subjectDescriptionFromAnalysis(success({ core_subject: '主'.repeat(200) }).data).length,
    100,
  )
  for (const value of [undefined, {}, { auxiliary_props: '海报' }, '未知', '无主体', 'N/A', 'a\0b'])
    assert.throws(() => subjectDescriptionFromAnalysis(success(value).data), /未返回可用/)
  assert.throws(
    () =>
      subjectDescriptionFromAnalysis({
        promptText: 'A full prompt',
        promptJson: { generation_prompt: '完整生图提示词' },
      }),
    /未返回可用/,
  )
})
test('backend configuration and HTTP errors are surfaced, without a fabricated fallback', async () => {
  const imageUrl = 'https://example.com/a.png'
  await assert.rejects(
    generateSubjectDescription(
      { imageUrl },
      {
        fetcher: async () =>
          response(
            { code: 503, message: '获取提示词需要启用 gpt-5.6-luna 模型并配置密钥' },
            false,
            503,
          ),
      },
    ),
    /配置密钥/,
  )
  await assert.rejects(
    generateSubjectDescription(
      { imageUrl },
      { fetcher: async () => response({ code: 0, data: {} }) },
    ),
    /未返回可用/,
  )
  await assert.rejects(
    generateSubjectDescription({ imageUrl }, { fetcher: async () => response(null, false, 502) }),
    /502/,
  )
})
test('abort before and after response parsing prevents a stale result from being applied', async () => {
  const first = new AbortController()
  first.abort()
  let count = 0
  await assert.rejects(
    generateSubjectDescription(
      { imageUrl: 'https://example.com/a.png', signal: first.signal },
      {
        fetcher: async () => {
          count++
          return response(success('主体特征'))
        },
      },
    ),
    { name: 'AbortError' },
  )
  assert.equal(count, 0)
  const second = new AbortController()
  await assert.rejects(
    generateSubjectDescription(
      { imageUrl: 'https://example.com/a.png', signal: second.signal },
      {
        fetcher: async () => ({
          ok: true,
          json: async () => {
            second.abort()
            return success('过时结果')
          },
        }),
      },
    ),
    { name: 'AbortError' },
  )
})
