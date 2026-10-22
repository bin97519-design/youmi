import test from 'node:test'
import assert from 'node:assert/strict'
import {
  collectWanxiangReferences,
  wanxiangReferenceState,
} from '../src/features/canvas-v3/config/wanxiangReferences.js'

const media = (kind, id, duration, extra = {}) => ({
  id,
  data: {
    kind,
    assetUrl: `https://cdn.example.com/${id}.${kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'mp3'}`,
    ...(duration == null ? {} : { mediaDuration: duration }),
    ...extra,
  },
})

test('Wanxiang always uses reference media, never auto first/last roles for one or two images', () => {
  for (const references of [
    [],
    [media('image', 'one')],
    [media('image', 'one'), media('image', 'two')],
  ]) {
    const state = wanxiangReferenceState(references)
    assert.equal(state.id, 'omni')
    assert.equal(state.mode, '全能参考')
    assert.equal(state.frames, false)
    assert.equal(state.hasMedia, references.length > 0)
    assert.deepEqual(state.errors, [])
  }
})

test('linked order and separate nodes are preserved while duplicate edges collapse', () => {
  const first = media('video', 'v', 5)
  const noId = { kind: 'image', url: 'https://example.com/same.png' }
  const second = media('image', 'i', undefined, { assetUrl: noId.url })
  const refs = [
    first,
    media('audio', 'a', 4),
    first,
    noId,
    noId,
    second,
    { kind: 'text', prompt: 'hi' },
  ]
  const before = structuredClone(refs)
  assert.deepEqual(collectWanxiangReferences(refs), [
    { kind: 'video', url: first.data.assetUrl, durationSeconds: 5, nodeId: 'v' },
    { kind: 'audio', url: 'https://cdn.example.com/a.mp3', durationSeconds: 4, nodeId: 'a' },
    { kind: 'image', url: noId.url },
    { kind: 'image', url: noId.url, nodeId: 'i' },
  ])
  assert.deepEqual(refs, before)
})

test('maximum counts accept 10 images, 5 videos and 5 audios and reject the next of each', () => {
  const refs = [
    ...Array.from({ length: 10 }, (_, i) => media('image', `i${i}`)),
    ...Array.from({ length: 5 }, (_, i) => media('video', `v${i}`, 3)),
    ...Array.from({ length: 5 }, (_, i) => media('audio', `a${i}`, 3)),
  ]
  const allowed = wanxiangReferenceState(refs, { duration: '15' })
  assert.deepEqual(allowed.errors, [])
  assert.deepEqual(allowed.counts, { image: 10, video: 5, audio: 5 })
  for (const kind of ['image', 'video', 'audio']) {
    const state = wanxiangReferenceState([
      ...refs,
      media(kind, 'overflow', kind === 'image' ? undefined : 0.1),
    ])
    assert.match(state.error, new RegExp(kind === 'image' ? '10张' : '5段'))
  }
})

test('video and audio duration budgets are separate and output adds only video duration', () => {
  const refs = [media('video', 'v', 15), media('audio', 'a', 15)]
  const allowed = wanxiangReferenceState(refs, { duration: 15 })
  assert.equal(allowed.videoDurationSeconds, 15)
  assert.equal(allowed.audioDurationSeconds, 15)
  assert.equal(allowed.maxOutputDurationSeconds, 15)
  assert.deepEqual(allowed.errors, [])
  assert.match(wanxiangReferenceState(refs, { duration: '16' }).error, /合计不能超过30秒/)
  assert.match(
    wanxiangReferenceState([media('video', 'v', 15.001)]).error,
    /视频总时长不能超过15秒/,
  )
  assert.match(
    wanxiangReferenceState([media('audio', 'a', 15.001)]).error,
    /音频总时长不能超过15秒/,
  )
  assert.deepEqual(wanxiangReferenceState([media('audio', 'a', 15)], { duration: '30' }).errors, [])
})

test('actual durations may be fractional but unknown metadata never silently uses requested duration', () => {
  for (const duration of [
    undefined,
    null,
    0,
    -1,
    Infinity,
    NaN,
    true,
    'Infinity',
    'auto',
    '0x10',
  ]) {
    const reference = media('video', 'v', duration, { generation: { params: { duration: 5 } } })
    const state = wanxiangReferenceState([reference], { duration: '5' })
    assert.match(state.error, /实际时长/)
    assert.equal(state.videoDurationSeconds, null)
    assert.equal(state.maxOutputDurationSeconds, null)
  }
  assert.equal(wanxiangReferenceState([media('audio', 'a', '7.5')]).audioDurationSeconds, 7.5)
  assert.equal(wanxiangReferenceState([media('video', 'v', 2.1)]).maxOutputDurationSeconds, 27)
  const durationFallback = media('audio', 'a', undefined, { durationSeconds: 4 })
  assert.equal(wanxiangReferenceState([durationFallback]).audioDurationSeconds, 4)
})

test('auto output remains auto with an explicit budget and prepaid-duration notice', () => {
  const refs = [media('video', 'v', 15)]
  const state = wanxiangReferenceState(refs, { duration: 'auto' })
  assert.deepEqual(state.errors, [])
  assert.equal(state.maxOutputDurationSeconds, 15)
  assert.match(state.warnings.join(' '), /当前成片最多15秒/)
  assert.match(wanxiangReferenceState([], { duration: 'auto' }).warnings[0], /先按30秒预扣/)
})

test('empty or invalid URLs block; local images wait for upload without pretending public access', () => {
  for (const url of [
    '',
    'file:///local.mp4',
    'ftp://example.com/a.mp4',
    'https://secret@example.com/a.mp4',
    'blob:video',
  ]) {
    assert.ok(wanxiangReferenceState([media('video', 'v', 2, { assetUrl: url })]).errors.length)
  }
  for (const url of ['blob:local-image', 'data:image/png;base64,TQ==']) {
    const state = wanxiangReferenceState([media('image', 'i', undefined, { assetUrl: url })])
    assert.deepEqual(state.errors, [])
    assert.match(state.warnings[0], /尚待上传/)
  }
  assert.equal(wanxiangReferenceState(null).hasMedia, false)
})
