import test from 'node:test'
import assert from 'node:assert/strict'
import { videoTaskRequest } from '../src/features/canvas-v3/sync/videoTaskClient.js'
import { WANXIANG_MODEL } from '../src/features/canvas-v3/config/wanxiangParameters.js'
import {
  assertWanxiangRequestReady,
  resolveWanxiangRoute,
} from '../src/features/canvas-v3/sync/wanxiangTaskRequest.js'

const route = (value = 'model-api-key:wan') => ({
  value,
  model: WANXIANG_MODEL,
  label: '自定义名称',
})
const node = (params = {}, extra = {}) => ({
  id: 'wan-target',
  data: {
    kind: 'video',
    model: 'model-api-key:wan',
    prompt: '图1的人跳视频1的舞蹈',
    params,
    ...extra,
  },
})
const ref = (kind, index = 1, extra = {}) => ({
  id: `${kind}-${index}`,
  data: { kind, assetUrl: `https://example.test/${kind}-${index}`, ...extra },
})

test('Wanxiang requests contain only documented params and exact managed route with separate metadata', () => {
  const input = node(
    {
      version: 'prime',
      resolution: '1080P',
      duration: 'auto',
      ratio: '3:4',
      audio: false,
      prompt_extend: true,
      count: '4个',
      quality: 'high',
      seed: 99,
      mode: '首尾帧',
      aspect_ratio: '21:9',
      notify_url: 'https://example.test/wrong-place',
    },
    { mode: '首尾帧', switches: { 联网搜索: true }, notify_url: 'https://example.test/webhook' },
  )
  const image = ref('image')
  const refs = [
    ref('audio', 1, { mediaDuration: 4 }),
    image,
    ref('video', 1, { mediaDuration: 6.5 }),
    image,
    ref('image', 2, { assetUrl: image.data.assetUrl }),
    ref('audio', 2, { durationSeconds: '5.5' }),
    { data: { kind: 'text', title: '场景', prompt: '夜色中的广场' } },
  ]
  const before = structuredClone({ input, refs })
  const result = videoTaskRequest(input, refs, 'wan-stable-key', route())
  assert.deepEqual(result, {
    model: 'model-api-key:wan',
    prompt: '图1的人跳视频1的舞蹈\n\n场景：\n夜色中的广场',
    parameter_profile: 'canvas-v3-wanxiang30',
    wanxiang_params: {
      version: 'prime',
      resolution: '1080P',
      duration: 'auto',
      ratio: '3:4',
      audio: false,
      prompt_extend: true,
      image_url: [image.data.assetUrl, image.data.assetUrl],
      video_url: ['https://example.test/video-1'],
      audio_url: ['https://example.test/audio-1', 'https://example.test/audio-2'],
    },
    reference_image_urls: [image.data.assetUrl, image.data.assetUrl],
    reference_videos: [{ url: 'https://example.test/video-1', durationSeconds: 6.5 }],
    reference_audios: ['https://example.test/audio-1', 'https://example.test/audio-2'],
    reference_audio_media: [
      { url: 'https://example.test/audio-1', durationSeconds: 4 },
      { url: 'https://example.test/audio-2', durationSeconds: 5.5 },
    ],
    webhook_url: 'https://example.test/webhook',
    client_task_id: 'wan-stable-key',
    feature_code: 'canvas-video',
  })
  assert.deepEqual({ input, refs }, before)
  assertWanxiangRequestReady(result)
})

test('one or two Wanxiang images remain references and media-only prompts are supported', () => {
  for (const refs of [[ref('image')], [ref('image'), ref('image', 2)]]) {
    const result = videoTaskRequest(
      node({}, { prompt: '', mode: '首尾帧' }),
      refs,
      'images',
      route(),
    )
    assert.equal(result.prompt, '')
    assert.equal(result.wanxiang_params.image_url.length, refs.length)
    assert.equal(Object.hasOwn(result, 'first_frame_url'), false)
    assert.equal(Object.hasOwn(result, 'last_frame_url'), false)
    assert.equal(Object.hasOwn(result, 'mode'), false)
  }
  assert.throws(
    () => videoTaskRequest(node({}, { prompt: '' }), [], 'none', route()),
    /请输入视频提示词/,
  )
})

test('Wanxiang accepts documented scalar representations but rejects explicit invalid values without fallback', () => {
  const valid = videoTaskRequest(
    node({ duration: 2, audio: 'false', prompt_extend: 'true' }),
    [],
    'valid',
    route(),
  )
  assert.equal(valid.wanxiang_params.duration, '2')
  assert.equal(valid.wanxiang_params.audio, false)
  assert.equal(valid.wanxiang_params.prompt_extend, true)
  for (const [key, value] of [
    ['duration', 1],
    ['duration', 31],
    ['duration', 2.5],
    ['duration', '2.0'],
    ['duration', 'automatic'],
    ['version', '快速'],
    ['resolution', '4K'],
    ['ratio', '21:9'],
    ['ratio', 'Auto'],
    ['audio', 'yes'],
    ['prompt_extend', 1],
  ])
    assert.throws(
      () => videoTaskRequest(node({ [key]: value }), [], 'invalid', route()),
      /参数无效/,
    )
})

test('Wanxiang limits and unknown actual media durations fail before transport', () => {
  for (const [refs, params, message] of [
    [Array.from({ length: 11 }, (_, i) => ref('image', i)), {}, /10张/],
    [Array.from({ length: 6 }, (_, i) => ref('video', i, { mediaDuration: 1 })), {}, /5段参考视频/],
    [Array.from({ length: 6 }, (_, i) => ref('audio', i, { mediaDuration: 1 })), {}, /5段参考音频/],
    [[ref('video', 1, { mediaDuration: 15.1 })], {}, /视频总时长不能超过15/],
    [[ref('audio', 1, { mediaDuration: 15.1 })], {}, /音频总时长不能超过15/],
    [[ref('video', 1, { mediaDuration: 8 })], { duration: '23' }, /合计不能超过30/],
    [[ref('video', 1, { generation: { params: { duration: 8 } } })], {}, /实际时长/],
    [[ref('audio')], {}, /实际时长/],
  ])
    assert.throws(() => videoTaskRequest(node(params), refs, 'invalid', route()), message)
  assert.doesNotThrow(() =>
    videoTaskRequest(
      node({ duration: 'auto' }),
      [ref('video', 1, { mediaDuration: 15 })],
      'auto',
      route(),
    ),
  )
})

test('Wanxiang data images can only exist during upload preparation, never at POST boundary', () => {
  const request = videoTaskRequest(
    node(),
    [ref('image', 1, { assetUrl: 'data:image/png;base64,aGVsbG8=' })],
    'upload',
    route(),
  )
  assert.throws(() => assertWanxiangRequestReady(request), /上传未完成/)
  assert.throws(
    () =>
      videoTaskRequest(
        node(),
        [ref('image', 1, { assetUrl: 'blob:local-image' })],
        'blob',
        route(),
      ),
    /尚待上传/,
  )
  for (const url of ['file:///local.png', 'https://secret@example.test/ref.png'])
    assert.throws(
      () => videoTaskRequest(node(), [ref('image', 1, { assetUrl: url })], 'url', route()),
      /HTTP/,
    )
})

test('Wanxiang route selection is explicit, family-scoped and cannot silently replace deleted opaque routes', () => {
  const first = route('model-api-key:one'),
    second = route('model-api-key:two')
  assert.equal(resolveWanxiangRoute('万相 3.0', [first]), first)
  assert.equal(resolveWanxiangRoute(WANXIANG_MODEL, [first]), first)
  assert.equal(resolveWanxiangRoute(second.value, [first, second]), second)
  assert.throws(
    () => resolveWanxiangRoute('万相 3.0', []),
    /尚未配置.*wan3\.0-video-quannengcankao/,
  )
  assert.throws(() => resolveWanxiangRoute('万相 3.0', [first, second]), /多条线路/)
  assert.throws(() => resolveWanxiangRoute('model-api-key:deleted', [first]), /已失效/)
  assert.throws(
    () =>
      resolveWanxiangRoute('万相 3.0', [
        { value: 'wrong', model: 'other-api', label: '万相 3.0 全能' },
      ]),
    /尚未配置/,
  )
  assert.throws(
    () =>
      videoTaskRequest(node({}, { model: WANXIANG_MODEL }), [], 'wrong', {
        value: 'model-api-key:wan',
        model: 'seedance-2.0-anci',
        label: '万相 3.0 全能',
      }),
    /参数配置不匹配/,
  )
})
