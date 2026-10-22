import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isKlingOmniApiModel,
  klingOmniApiModelForMode,
  klingOmniModeForModel,
} from '../src/features/canvas-v3/config/klingOmniIdentity.js'
import {
  createVideoTaskClient,
  videoTaskRequest,
} from '../src/features/canvas-v3/sync/videoTaskClient.js'

const models = {
  视频参考: 'kling-v3-omni-videoref',
  参考生: 'kling-v3-omni-cankao',
  首尾帧: 'kling-v3-omni-shouweizhen',
}
const node = (mode = '参考生', params = {}, model = models[mode]) => ({
  id: 'omni-target',
  data: { kind: 'video', model, mode, prompt: '镜头缓慢推进，保持主体外观', params },
})
const ref = (kind, index, extra = {}) => ({
  id: `source-${kind}-${index}`,
  data: {
    kind,
    assetUrl: `https://example.test/${kind}-${index}.${kind === 'video' ? 'mp4' : 'png'}`,
    ...extra,
  },
})
const readyVideo = (index = 1, extra = {}) =>
  ref('video', index, {
    mediaDuration: 6,
    mediaWidth: 1280,
    fileSize: 1024,
    mimeType: 'video/mp4',
    ...extra,
  })

test('Omni API identities distinguish all three actual contracts and never infer identity from display labels', () => {
  for (const [mode, model] of Object.entries(models)) {
    assert.equal(klingOmniApiModelForMode(mode), model)
    for (const identity of [
      model,
      model.toUpperCase(),
      { value: 'opaque', model, label: 'Custom' },
    ]) {
      assert.equal(isKlingOmniApiModel(identity), true)
      assert.equal(klingOmniModeForModel(identity), mode)
    }
  }
  for (const identity of [
    'Kling 3.0',
    '可灵-Omni',
    'kling-v3-omni',
    null,
    undefined,
    {},
    { value: 'opaque', label: '可灵-Omni' },
    { value: models.参考生, model: 'some-other-video', label: '可灵-Omni' },
  ]) {
    assert.equal(isKlingOmniApiModel(identity), false)
    assert.equal(klingOmniModeForModel(identity), '')
  }
  assert.equal(klingOmniApiModelForMode('文生视频'), '')
})

test('reference generation sends only documented scalars and exact routing identity without legacy options', () => {
  const input = node(
    '参考生',
    {
      mode: 'pro',
      duration: '15',
      aspect_ratio: '9:16',
      count: '4个',
      resolution: '4K',
      ratio: '21:9',
      version: '快速',
      audio: false,
      keep_original_sound: 'no',
      refer_type: 'base',
      images: ['not-used'],
      video: 'not-used',
      notify_url: 'https://example.test/hook',
    },
    'model-api-key:88',
  )
  const modelOption = { value: input.data.model, model: models.参考生, label: '可灵-Omni' }
  const before = structuredClone(input)
  const result = videoTaskRequest(input, [], 'omni-stable-key', modelOption)
  assert.deepEqual(result, {
    model: 'model-api-key:88',
    prompt: input.data.prompt,
    parameter_profile: 'canvas-v3-kling-omni',
    omni_params: { mode: 'pro', duration: '15', aspect_ratio: '9:16' },
    reference_image_urls: [],
    reference_videos: [],
    reference_audios: [],
    client_task_id: 'omni-stable-key',
    feature_code: 'canvas-video',
  })
  assert.deepEqual(input, before)
})

test('first/last preserves connected node order and same URLs from distinct nodes without positional legacy fields', () => {
  const sameUrl = 'https://example.test/loop.png'
  const first = ref('image', 1, { assetUrl: sameUrl })
  const last = ref('image', 2, { assetUrl: sameUrl })
  const result = videoTaskRequest(
    node('首尾帧', {
      mode: 'std',
      duration: 10,
      aspect_ratio: '9:16',
      ratio: '9:16',
      resolution: '4K',
    }),
    [last, first, last],
    'frames',
  )
  assert.deepEqual(result.reference_image_urls, [sameUrl, sameUrl])
  assert.deepEqual(result.omni_params, { mode: 'std', duration: '10' })
  assert.deepEqual(result.reference_videos, [])
  for (const key of [
    'first_frame_url',
    'last_frame_url',
    'ratio',
    'durationSeconds',
    'resolution',
    'mode',
  ])
    assert.equal(Object.hasOwn(result, key), false, key)
  const reordered = videoTaskRequest(node('首尾帧'), [ref('image', 2), ref('image', 1)], 'ordered')
  assert.deepEqual(reordered.reference_image_urls, [
    'https://example.test/image-2.png',
    'https://example.test/image-1.png',
  ])
})

test('video reference feature and instruction transformation use separate active whitelist settings', () => {
  const refs = [readyVideo(), ref('image', 1)]
  const params = {
    refer_type: 'feature',
    mode: 'pro',
    duration: '10',
    aspect_ratio: '1:1',
    keep_original_sound: 'no',
  }
  const feature = videoTaskRequest(node('视频参考', params), refs, 'feature')
  assert.deepEqual(feature.omni_params, params)
  assert.deepEqual(feature.reference_videos, [{ url: refs[0].data.assetUrl, durationSeconds: 6 }])
  assert.deepEqual(feature.reference_image_urls, [refs[1].data.assetUrl])
  const base = videoTaskRequest(
    node('视频参考', { ...params, refer_type: 'base', duration: 'bad' }),
    refs,
    'base',
  )
  assert.deepEqual(base.omni_params, { refer_type: 'base', mode: 'pro' })
  assert.equal(Object.hasOwn(base.omni_params, 'duration'), false)
  assert.equal(Object.hasOwn(base.omni_params, 'aspect_ratio'), false)
  assert.equal(Object.hasOwn(base.omni_params, 'keep_original_sound'), false)
})

test('video reference duration comes only from real media metadata, never from generation settings', () => {
  const source = readyVideo(1, {
    mediaDuration: undefined,
    generation: { params: { duration: 30 } },
  })
  assert.deepEqual(
    videoTaskRequest(node('视频参考'), [source], 'unknown-duration').reference_videos,
    [{ url: source.data.assetUrl }],
  )
  source.data.durationSeconds = '7.5'
  assert.deepEqual(
    videoTaskRequest(node('视频参考'), [source], 'duration-seconds').reference_videos,
    [{ url: source.data.assetUrl, durationSeconds: 7.5 }],
  )
  source.data.mediaDuration = 4
  assert.equal(
    videoTaskRequest(node('视频参考'), [source], 'real').reference_videos[0].durationSeconds,
    4,
  )
})

test('mismatched or unknown outer mode and route metadata fail before request creation', () => {
  for (const [mode, api] of Object.entries(models)) {
    for (const [otherMode, otherApi] of Object.entries(models)) {
      if (mode === otherMode) continue
      assert.throws(
        () =>
          videoTaskRequest(node(mode, {}, api), [], 'mismatch', {
            value: api,
            model: otherApi,
            label: '可灵-Omni',
          }),
        /线路与视频生成模式不匹配/,
      )
    }
  }
  assert.throws(
    () =>
      videoTaskRequest(node('参考生', {}, models.参考生), [], 'spoof', {
        value: models.参考生,
        model: 'other-video',
        label: '可灵-Omni',
      }),
    /不匹配/,
  )
  assert.throws(
    () => videoTaskRequest(node('文生视频', {}, models.参考生), [], 'unknown'),
    /请选择.*视频生成模式/,
  )
  assert.throws(
    () => videoTaskRequest(node('参考生', {}, 'Kling 3.0'), [], 'placeholder'),
    /尚未接入/,
  )
})

test('missing and excess required media and unsupported audio are rejected from actual linked inputs', () => {
  assert.throws(() => videoTaskRequest(node('首尾帧'), [], 'missing'), /首尾帧需连接/)
  assert.throws(
    () =>
      videoTaskRequest(
        node('首尾帧'),
        [1, 2, 3].map((i) => ref('image', i)),
        'excess',
      ),
    /最多支持 2/,
  )
  assert.throws(
    () =>
      videoTaskRequest(
        node('参考生'),
        Array.from({ length: 8 }, (_, i) => ref('image', i)),
        'excess',
      ),
    /最多支持 7/,
  )
  assert.throws(
    () => videoTaskRequest(node('参考生'), [readyVideo()], 'wrong-video'),
    /不支持参考视频/,
  )
  assert.throws(
    () => videoTaskRequest(node('参考生'), [ref('audio', 1)], 'audio'),
    /不支持单独音频/,
  )
  assert.throws(() => videoTaskRequest(node('视频参考'), [], 'missing'), /需连接 1 个参考视频/)
  assert.throws(
    () => videoTaskRequest(node('视频参考'), [readyVideo(1), readyVideo(2)], 'excess'),
    /最多支持 1/,
  )
  assert.throws(
    () =>
      videoTaskRequest(
        node('视频参考'),
        [readyVideo(), ...Array.from({ length: 5 }, (_, i) => ref('image', i))],
        'excess',
      ),
    /最多支持 4/,
  )
})

test('direct API identity must agree with intent even when route metadata declares the intended API', () => {
  for (const [mode, intendedApi] of Object.entries(models)) {
    const refs = mode === '视频参考' ? [readyVideo()] : mode === '首尾帧' ? [ref('image', 1)] : []
    const modelOption = { value: 'opaque-route', model: intendedApi, label: '可灵-Omni' }
    for (const [otherMode, conflictingApi] of Object.entries(models)) {
      if (mode === otherMode) continue
      for (const model of [conflictingApi, ` ${conflictingApi.toUpperCase()} `]) {
        assert.throws(
          () => videoTaskRequest(node(mode, {}, model), refs, 'direct-mismatch', modelOption),
          /线路与视频生成模式不匹配/,
        )
      }
    }
    assert.equal(
      videoTaskRequest(node(mode, {}, intendedApi), refs, 'matching-direct', modelOption).model,
      intendedApi,
    )
    assert.equal(
      videoTaskRequest(node(mode, {}, modelOption.value), refs, 'opaque-route', modelOption).model,
      modelOption.value,
    )
  }
})

test('known video metadata and invalid URLs are preflighted without contacting the video host', () => {
  for (const [data, message] of [
    [{ mediaDuration: 2.9 }, /3～10/],
    [{ mediaDuration: 10.1 }, /3～10/],
    [{ mediaWidth: 699 }, /不能小于 700/],
    [{ fileSize: 100 * 1024 * 1024 + 1 }, /不能超过 100MB/],
    [{ mimeType: 'video/webm' }, /仅支持 mp4 \/ mov/],
    [{ assetUrl: '' }, /尚未就绪/],
    [{ assetUrl: 'file:///C:/private.mp4' }, /HTTP\(S\)/],
    [{ assetUrl: 'https://user:pass@example.test/v.mp4' }, /HTTP\(S\)/],
  ]) {
    assert.throws(
      () => videoTaskRequest(node('视频参考'), [readyVideo(1, data)], 'bad-media'),
      message,
    )
  }
  for (const duration of [3, 10]) {
    const result = videoTaskRequest(
      node('视频参考'),
      [
        readyVideo(1, {
          mediaDuration: duration,
          mediaWidth: 700,
          fileSize: 100 * 1024 * 1024,
          mimeType: 'video/quicktime',
        }),
      ],
      'boundary',
    )
    assert.equal(result.reference_videos[0].durationSeconds, duration)
  }
})

test('local image data can await store upload, but unresolved blobs or malformed image data cannot be submitted', () => {
  const dataUrl = 'data:image/png;base64,aGVsbG8='
  const result = videoTaskRequest(node('首尾帧'), [ref('image', 1, { assetUrl: dataUrl })], 'local')
  assert.deepEqual(result.reference_image_urls, [dataUrl])
  assert.throws(
    () =>
      videoTaskRequest(
        node('首尾帧'),
        [ref('image', 1, { assetUrl: 'data:text/html;base64,aGVsbG8=' })],
        'bad',
      ),
    /HTTP\(S\)/,
  )
  assert.throws(
    () =>
      videoTaskRequest(
        node('首尾帧'),
        [{ kind: 'image', url: 'blob:https://example.test/id' }],
        'blob',
      ),
    /尚待上传/,
  )
})

test('invalid active API enums are rejected instead of silently replacing explicit user settings', () => {
  for (const [mode, params, refs, message] of [
    ['参考生', { duration: '6' }, [], /视频时长必须选择/],
    ['参考生', { mode: 'high' }, [], /生成模式必须选择/],
    ['参考生', { aspect_ratio: 'Auto' }, [], /画面比例必须选择/],
    ['视频参考', { refer_type: 'edit' }, [readyVideo()], /参考类型必须选择/],
    ['视频参考', { duration: '15' }, [readyVideo()], /视频时长必须选择/],
    ['视频参考', { keep_original_sound: false }, [readyVideo()], /保留原声必须选择/],
  ])
    assert.throws(() => videoTaskRequest(node(mode, params), refs, 'invalid-enum'), message)
})

test('reference-generation text-only requires content and merges connected text nodes in graph order', () => {
  const input = node('参考生')
  input.data.prompt = ' '
  assert.throws(() => videoTaskRequest(input, [], 'empty'), /请输入视频提示词/)
  const refs = [
    { data: { kind: 'script', title: '镜头', prompt: '平稳推进' } },
    { data: { kind: 'text', title: '角色', prompt: '保留服装' } },
  ]
  assert.equal(videoTaskRequest(input, refs, 'text').prompt, '镜头：\n平稳推进\n\n角色：\n保留服装')
  assert.equal(videoTaskRequest(input, [ref('image', 1)], 'media-only').prompt, '')
})

test('Omni bodies use the same mocked video transport without changing create or query endpoints', async () => {
  const calls = []
  const client = createVideoTaskClient({
    fetcher: async (url, options) => {
      calls.push({ url, options })
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: 0, data: { taskId: 'mock-only' } }),
      }
    },
  })
  const body = videoTaskRequest(node('参考生'), [], 'mock-key')
  assert.deepEqual(await client.create(body), { taskId: 'mock-only' })
  assert.equal(calls[0].url, '/api/video-tasks')
  assert.equal(calls[0].options.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].options.body), body)
  await client.get('task/id')
  assert.equal(calls[1].url, '/api/video-tasks/task%2Fid')
})
