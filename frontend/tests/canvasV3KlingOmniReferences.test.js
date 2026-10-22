import test from 'node:test'
import assert from 'node:assert/strict'
import { klingOmniReferenceState } from '../src/features/canvas-v3/config/klingOmniReferences.js'

const image = (id, extra = {}) => ({
  id,
  data: { kind: 'image', assetUrl: `https://cdn.example.test/${id}.png`, ...extra },
})
const video = (id = 'video', extra = {}) => ({
  id,
  data: {
    kind: 'video',
    assetUrl: `https://cdn.example.test/${id}.mp4`,
    mediaDuration: 5,
    mediaWidth: 1280,
    fileSize: 1024,
    mimeType: 'video/mp4',
    ...extra,
  },
})

test('reference generation allows text-only or at most seven images without requiring video', () => {
  assert.deepEqual(klingOmniReferenceState('参考生'), {
    counts: { image: 0, video: 0, audio: 0 },
    errors: [],
    warnings: [],
  })
  const seven = Array.from({ length: 7 }, (_, index) => image(index))
  assert.deepEqual(klingOmniReferenceState('参考生', seven).errors, [])
  assert.match(
    klingOmniReferenceState('参考生', [...seven, image(7)]).errors.join(' '),
    /最多支持 7/,
  )
  assert.match(klingOmniReferenceState('参考生', [video()]).errors.join(' '), /不支持参考视频/)
})

test('first/last frame requires one or two image nodes and never silently drops extra media', () => {
  assert.match(klingOmniReferenceState('首尾帧').errors.join(' '), /1～2.*第1张.*首帧.*第2张.*尾帧/)
  assert.deepEqual(klingOmniReferenceState('首尾帧', [image('first')]).errors, [])
  assert.deepEqual(klingOmniReferenceState('首尾帧', [image('first'), image('last')]).errors, [])
  assert.match(
    klingOmniReferenceState('首尾帧', [image(1), image(2), image(3)]).errors.join(' '),
    /最多支持 2/,
  )
  assert.match(
    klingOmniReferenceState('首尾帧', [image(1), video()]).errors.join(' '),
    /不支持参考视频/,
  )
})

test('video reference requires exactly one video and allows zero through four supplementary images', () => {
  assert.match(klingOmniReferenceState('视频参考').errors.join(' '), /需连接 1 个参考视频/)
  assert.deepEqual(klingOmniReferenceState('视频参考', [video()]).errors, [])
  const four = Array.from({ length: 4 }, (_, index) => image(index))
  assert.deepEqual(klingOmniReferenceState('视频参考', [video(), ...four]).errors, [])
  assert.match(
    klingOmniReferenceState('视频参考', [video(), ...four, image(5)]).errors.join(' '),
    /最多支持 4/,
  )
  assert.match(
    klingOmniReferenceState('视频参考', [video(1), video(2)]).errors.join(' '),
    /最多支持 1 个参考视频/,
  )
})

test('all modes report separate audio instead of silently excluding it from counts or validation', () => {
  const audio = { id: 'audio', data: { kind: 'audio', assetUrl: 'https://cdn.example.test/a.wav' } }
  for (const mode of ['视频参考', '参考生', '首尾帧']) {
    const state = klingOmniReferenceState(mode, [image(1), video(), audio])
    assert.equal(state.counts.audio, 1)
    assert.match(state.errors.join(' '), /不支持单独音频输入/)
  }
})

test('known actual video metadata enforces inclusive duration, width and size boundaries', () => {
  for (const duration of [3, 10, '3', '10'])
    assert.deepEqual(
      klingOmniReferenceState('视频参考', [
        video('v', { mediaDuration: duration, mediaWidth: 700, fileSize: 100 * 1024 * 1024 }),
      ]).errors,
      [],
    )
  for (const duration of [2.99, 10.01])
    assert.match(
      klingOmniReferenceState('视频参考', [video('v', { mediaDuration: duration })]).errors.join(
        ' ',
      ),
      /时长须为 3～10/,
    )
  assert.match(
    klingOmniReferenceState('视频参考', [video('v', { mediaWidth: 699 })]).errors.join(' '),
    /宽度不能小于 700/,
  )
  assert.match(
    klingOmniReferenceState('视频参考', [
      video('v', { fileSize: 100 * 1024 * 1024 + 1 }),
    ]).errors.join(' '),
    /不能超过 100MB/,
  )
  assert.deepEqual(
    klingOmniReferenceState('视频参考', [
      video('v', {
        mediaDuration: undefined,
        durationSeconds: 5,
        mediaWidth: undefined,
        width: 1280,
        fileSize: undefined,
        sizeBytes: 1024,
      }),
    ]).errors,
    [],
  )
})

test('missing or unread metadata warns without assuming actual duration from requested generation params', () => {
  const reference = {
    id: 'v',
    data: {
      kind: 'video',
      assetUrl: 'https://cdn.example.test/opaque-download',
      generation: { params: { duration: 1 } },
    },
  }
  const state = klingOmniReferenceState('视频参考', [reference])
  assert.deepEqual(state.errors, [])
  assert.equal(state.warnings.length, 4)
  assert.match(state.warnings.join(' '), /时长.*3～10.*宽度.*700.*文件大小.*100MB.*格式/)
  for (const value of [0, -1, 'not-read', null]) {
    const unknown = klingOmniReferenceState('视频参考', [
      video('v', { mediaDuration: value, mediaWidth: value, fileSize: value }),
    ])
    assert.deepEqual(unknown.errors, [])
    assert.equal(unknown.warnings.length, 3)
  }
})

test('format preflight honors known container metadata and leaves opaque URLs unverified', () => {
  assert.deepEqual(
    klingOmniReferenceState('视频参考', [
      video('v', { mimeType: 'video/quicktime', assetUrl: 'https://cdn.example.test/v.mov' }),
    ]).errors,
    [],
  )
  assert.match(
    klingOmniReferenceState('视频参考', [video('v', { mimeType: 'video/webm' })]).errors.join(' '),
    /仅支持 mp4 \/ mov/,
  )
  assert.match(
    klingOmniReferenceState('视频参考', [
      video('v', { mimeType: '', assetUrl: 'https://cdn.example.test/v.webm' }),
    ]).errors.join(' '),
    /仅支持 mp4 \/ mov/,
  )
  assert.deepEqual(
    klingOmniReferenceState('视频参考', [
      video('v', { mimeType: '', assetUrl: 'https://cdn.example.test/v.MOV?token=example' }),
    ]).errors,
    [],
  )
  const opaque = klingOmniReferenceState('视频参考', [
    video('v', {
      mimeType: 'application/octet-stream',
      assetUrl: 'https://cdn.example.test/download.php',
    }),
  ])
  assert.deepEqual(opaque.errors, [])
  assert.match(opaque.warnings.join(' '), /尚未确认.*格式/)
})

test('unfinished or unsupported material URLs error while local images stay explicitly pending upload', () => {
  for (const assetUrl of [
    '',
    'javascript:alert(1)',
    'file:///tmp/v.png',
    'https://user:secret@cdn.example.test/v.png',
  ])
    assert.ok(klingOmniReferenceState('参考生', [image('img', { assetUrl })]).errors.length)
  for (const assetUrl of ['data:image/png;base64,YQ==', 'blob:local-image']) {
    const state = klingOmniReferenceState('参考生', [image('local', { assetUrl })])
    assert.deepEqual(state.errors, [])
    assert.match(state.warnings.join(' '), /尚待上传/)
  }
})

test('node identity removes duplicate edges but separate nodes with the same URL remain separate frames', () => {
  const first = image('first')
  const last = image('last', { assetUrl: first.data.assetUrl })
  const state = klingOmniReferenceState('首尾帧', [first, { ...first }, first, last])
  assert.deepEqual(state.counts, { image: 2, video: 0, audio: 0 })
  assert.deepEqual(state.errors, [])
  const flat = { kind: 'image', url: 'https://cdn.example.test/same.png' }
  assert.equal(klingOmniReferenceState('首尾帧', [flat, flat, { ...flat }]).counts.image, 2)
})

test('preflight is pure, tolerates malformed input containers and never performs network calls', () => {
  const references = [image('a'), video(), { id: 'text', data: { kind: 'text', prompt: 'hello' } }]
  const before = structuredClone(references)
  const previousFetch = globalThis.fetch
  globalThis.fetch = () => {
    throw new Error('Network must never be used by a local preflight')
  }
  try {
    assert.deepEqual(klingOmniReferenceState('视频参考', references), {
      counts: { image: 1, video: 1, audio: 0 },
      errors: [],
      warnings: [],
    })
    assert.deepEqual(references, before)
    assert.deepEqual(klingOmniReferenceState('参考生', null).counts, {
      image: 0,
      video: 0,
      audio: 0,
    })
    assert.deepEqual(klingOmniReferenceState('参考生', [null, 1, 'x', {}]).errors, [])
    assert.match(klingOmniReferenceState('unknown', []).errors.join(' '), /需连接 1 个参考视频/)
  } finally {
    globalThis.fetch = previousFetch
  }
})
