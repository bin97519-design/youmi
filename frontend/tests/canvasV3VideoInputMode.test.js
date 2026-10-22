import test from 'node:test'
import assert from 'node:assert/strict'
import {
  collectVideoInputMedia,
  deriveVideoInputMode,
} from '../src/features/canvas-v3/config/videoInputMode.js'
import {
  MINIMAX_H3_MODEL,
  SEEDANCE25_MODEL,
  videoModelControls,
  videoModelParams,
} from '../src/features/canvas-v3/config/videoModelParameters.js'
import { videoTaskRequest } from '../src/features/canvas-v3/sync/videoTaskClient.js'

const media = (kind, index = 1, extra = {}) => ({
  id: `${kind}-${index}`,
  data: { kind, assetUrl: `https://example.test/${kind}-${index}`, ...extra },
})
const node = (model, extra = {}) => ({
  data: {
    kind: 'video',
    model,
    prompt: '向前推进',
    mode: '不应使用的旧保存模式',
    params: {
      ratio: '16:9',
      resolution: model === MINIMAX_H3_MODEL ? '768P' : '720P',
      duration: 5,
      count: '1个',
    },
    ...extra,
  },
})

test('actual media kinds select text, first frame, first/last, image reference and multimodal automatically', () => {
  for (const model of [SEEDANCE25_MODEL, MINIMAX_H3_MODEL]) {
    for (const [references, id, frames] of [
      [[], 'text', false],
      [[media('image')], 'first-frame', true],
      [[media('image', 1), media('image', 2)], 'first-last', true],
      [[media('image', 1), media('image', 2), media('image', 3)], 'reference-image', false],
      [[media('audio')], 'multimodal', false],
      [[media('video')], 'multimodal', false],
      [[media('image', 1), media('image', 2), media('audio')], 'multimodal', false],
    ]) {
      const input = deriveVideoInputMode(model, references)
      assert.equal(input.id, id)
      assert.equal(input.frames, frames)
      assert.equal(input.error, '')
      assert.equal(input.hasMedia, references.length > 0)
    }
  }
})

test('node identities determine ordering and duplicate-edge removal, never media URL equality', () => {
  const first = media('image', 'a', { assetUrl: 'https://example.test/same.png' })
  const last = media('image', 'b', { assetUrl: first.data.assetUrl })
  const references = [first, first, { ...first }, last]
  const collected = collectVideoInputMedia(references)
  assert.equal(collected.length, 2)
  assert.deepEqual(
    collected.map((item) => item.nodeId),
    [first.id, last.id],
  )
  assert.equal(deriveVideoInputMode(SEEDANCE25_MODEL, references).id, 'first-last')
  const result = videoTaskRequest(node(SEEDANCE25_MODEL), references, 'loop')
  assert.equal(result.first_frame_url, first.data.assetUrl)
  assert.equal(result.last_frame_url, first.data.assetUrl)
  const flat = { kind: 'image', url: 'https://example.test/a.png' }
  assert.equal(collectVideoInputMedia([flat, flat, { ...flat }]).length, 2)
})

test('a malformed or unfinished linked media node never silently turns into a text task', () => {
  for (const assetUrl of [
    '',
    undefined,
    'blob:tmp',
    'javascript:alert(1)',
    'https://user:pass@example.test/a.png',
  ]) {
    const reference = media('image', 1, { assetUrl })
    const input = deriveVideoInputMode(MINIMAX_H3_MODEL, [reference])
    assert.equal(input.id, 'first-frame')
    assert.equal(input.counts.image, 1)
    assert.ok(input.error)
    assert.throws(() => videoTaskRequest(node(MINIMAX_H3_MODEL), [reference], 'bad'))
  }
  assert.equal(deriveVideoInputMode('Kling 3.0', []).supported, false)
  assert.match(deriveVideoInputMode({ value: 'route', label: 'MiniMax H3' }, []).error, /尚未接入/)
})

test('model-specific documented media limits reject the entire request instead of trimming', () => {
  for (const [model, maximum] of [
    [SEEDANCE25_MODEL, { image: 30, video: 10, audio: 10 }],
    [MINIMAX_H3_MODEL, { image: 9, video: 3, audio: 3 }],
  ]) {
    for (const [kind, limit] of Object.entries(maximum)) {
      const refs = Array.from({ length: limit + 1 }, (_, index) => media(kind, index))
      assert.match(deriveVideoInputMode(model, refs).error, /最多支持/)
      assert.throws(() => videoTaskRequest(node(model), refs, 'limit'), /最多支持/)
      const valid = refs.slice(0, limit)
      assert.equal(deriveVideoInputMode(model, valid).error, '')
    }
  }
})

test('stale manual modes cannot change inferred wire fields for either integrated model', () => {
  for (const model of [SEEDANCE25_MODEL, MINIMAX_H3_MODEL]) {
    for (const oldMode of ['', '文生视频', '首尾帧', '图片参考', '全能参考', '参考生', 'bogus']) {
      const input = node(model, { mode: oldMode })
      const first = media('image', 1)
      const second = media('image', 2)
      const single = videoTaskRequest(input, [first], 'one')
      assert.equal(single.first_frame_url, first.data.assetUrl)
      assert.equal(Object.hasOwn(single, 'last_frame_url'), false)
      assert.equal(single.ratio, model === SEEDANCE25_MODEL ? 'adaptive' : '16:9')
      const pair = videoTaskRequest(input, [first, second], 'two')
      assert.equal(pair.last_frame_url, second.data.assetUrl)
      const mixed = videoTaskRequest(input, [first, second, media('audio')], 'mixed')
      assert.equal(Object.hasOwn(mixed, 'first_frame_url'), false)
      assert.equal(Object.hasOwn(mixed, 'last_frame_url'), false)
      assert.deepEqual(mixed.reference_image_urls, [first.data.assetUrl, second.data.assetUrl])
      assert.equal(mixed.reference_audios.length, 1)
      if (model === MINIMAX_H3_MODEL) assert.equal(mixed.mode, 'cankaosheng')
    }
  }
})

test('only Seedance single-image first-frame controls restrict ratios; paired frames and H3 retain all ratios', () => {
  const allRatios = ['Auto', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9']
  assert.deepEqual(videoModelControls(MINIMAX_H3_MODEL, '文生视频').fields.ratio[1], allRatios)
  assert.equal(videoModelParams(MINIMAX_H3_MODEL, { ratio: 'Auto' }, '文生视频').ratio, 'Auto')
  assert.equal(
    videoTaskRequest(
      node(MINIMAX_H3_MODEL, {
        params: { ratio: 'Auto', resolution: '768P', duration: 5, count: '1个' },
      }),
      [],
      'text',
    ).ratio,
    'adaptive',
  )
  for (const refs of [
    [],
    [media('image')],
    [media('image', 1), media('image', 2)],
    [media('audio')],
  ]) {
    const inferred = deriveVideoInputMode(MINIMAX_H3_MODEL, refs)
    assert.deepEqual(videoModelControls(MINIMAX_H3_MODEL, inferred.mode).fields.ratio[1], allRatios)
    assert.equal(videoModelControls(MINIMAX_H3_MODEL, inferred.mode).defaults.ratio, 'Auto')
    for (const ratio of allRatios) {
      const input = node(MINIMAX_H3_MODEL)
      input.data.params.ratio = ratio
      assert.equal(videoModelParams(MINIMAX_H3_MODEL, { ratio }, inferred.mode).ratio, ratio)
      assert.equal(
        videoTaskRequest(input, refs, 'h3-ratio').ratio,
        ratio === 'Auto' ? 'adaptive' : ratio,
      )
    }
  }
  const firstFrame = [media('image')]
  const firstMode = deriveVideoInputMode(SEEDANCE25_MODEL, firstFrame)
  assert.deepEqual(videoModelControls(SEEDANCE25_MODEL, firstMode.mode).fields.ratio[1], ['Auto'])
  assert.equal(videoModelParams(SEEDANCE25_MODEL, { ratio: '16:9' }, firstMode.mode).ratio, 'Auto')
  assert.equal(videoTaskRequest(node(SEEDANCE25_MODEL), firstFrame, 'frame').ratio, 'adaptive')

  const pairedFrames = [media('image', 1), media('image', 2)]
  const pairMode = deriveVideoInputMode(SEEDANCE25_MODEL, pairedFrames)
  assert.deepEqual(videoModelControls(SEEDANCE25_MODEL, pairMode.mode).fields.ratio[1], allRatios)
  for (const ratio of allRatios) {
    const input = node(SEEDANCE25_MODEL)
    input.data.params.ratio = ratio
    assert.equal(videoModelParams(SEEDANCE25_MODEL, { ratio }, pairMode.mode).ratio, ratio)
    const request = videoTaskRequest(input, pairedFrames, 'pair')
    assert.equal(request.ratio, ratio === 'Auto' ? 'adaptive' : ratio)
    assert.equal(request.first_frame_url, pairedFrames[0].data.assetUrl)
    assert.equal(request.last_frame_url, pairedFrames[1].data.assetUrl)
    assert.deepEqual(request.reference_image_urls, [])
  }
})

test('native prompt rules still apply after mode inference, including audio-only Seedance', () => {
  const seedance = node(SEEDANCE25_MODEL, { prompt: '' })
  assert.equal(videoTaskRequest(seedance, [media('audio')], 'audio-only').prompt, '')
  assert.throws(() => videoTaskRequest(seedance, [], 'empty'), /请输入视频提示词/)
  assert.throws(
    () => videoTaskRequest(node(MINIMAX_H3_MODEL, { prompt: '' }), [media('audio')], 'h3-empty'),
    /请输入视频提示词/,
  )
  const text = { data: { kind: 'script', title: '脚本', prompt: '运镜说明' } }
  assert.match(videoTaskRequest(seedance, [text], 'script').prompt, /运镜说明/)
})

test('video generation has no count parameter and ignores old saved quantity without sending it', () => {
  for (const model of [MINIMAX_H3_MODEL, SEEDANCE25_MODEL]) {
    for (const count of ['1个', '2个', '4个', 4, 'invalid']) {
      const original = node(model)
      original.data.params.count = count
      assert.equal(Object.hasOwn(videoModelParams(model, original.data.params), 'count'), false)
      const request = videoTaskRequest(original, [], 'single')
      for (const key of ['count', 'n', 'quantity', 'batch_size'])
        assert.equal(Object.hasOwn(request, key), false)
      assert.equal(
        original.data.params.count,
        count,
        'old stored node is not mass-migrated or mutated',
      )
    }
  }
})
