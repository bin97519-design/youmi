import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import {
  imageEditPreset,
  imageEditInstructions,
  portraitSettings,
  PORTRAIT_FIELDS,
  PORTRAIT_MENU,
} from '../src/features/canvas-v3/config/imageEditPresets.js'
import {
  boxFromDrag,
  emotionAt,
  emotionRoleInstructions,
} from '../src/features/canvas-v3/config/portraitEmotion.js'
import { detectFaces } from '../src/features/canvas-v3/sync/faceDetectionClient.js'
import { imageTaskRequest } from '../src/features/canvas-v3/sync/imageTaskClient.js'
import { imageGridMenuPlacement } from '../src/features/canvas-v3/config/popupPlacement.js'

test('portrait dropdown and all fifteen options match reference defaults', () => {
  assert.deepEqual(
    PORTRAIT_MENU.map((v) => v.label),
    ['人像调节', '情绪调节'],
  )
  assert.equal(PORTRAIT_FIELDS.length, 5)
  assert.deepEqual(Object.values(portraitSettings()), [
    '自然融合',
    '自然匹配',
    '自然肤质',
    '自然纹理',
    '标准清晰',
  ])
  for (const field of PORTRAIT_FIELDS)
    for (const option of field.options) {
      const preset = imageEditPreset('portrait-texture')
      preset.editTemplate.settings[field.key] = option
      assert.ok(imageEditInstructions(preset).includes(`${field.label}：${option}`))
    }
  assert.equal(portraitSettings({ skin: 'bad value' }).skin, '自然肤质')
})

test('720 panorama builds a single 2:1 equirectangular request using original image', () => {
  const preset = imageEditPreset('panorama-720')
  assert.equal(preset.title, '720°全景图')
  const request = imageTaskRequest(
    { data: { ...preset, model: 'tt-image-2.5' } },
    [{ data: { kind: 'image', assetUrl: 'https://example.test/original.jpg' } }],
    'test',
  )
  assert.equal(request.n, 1)
  assert.equal(request.size, '2:1')
  assert.equal(request.resolution, '2K')
  assert.deepEqual(request.image_urls, ['https://example.test/original.jpg'])
  assert.match(request.prompt, /equirectangular/)
  assert.match(request.prompt, /左右边缘无缝/)
  // Banana's documented enums do not support this preset's 2:1 ratio.
  const bananaRequest = imageTaskRequest(
    { data: { ...preset, model: 'banana-2.1' } },
    [],
    'banana-test',
  )
  assert.equal(bananaRequest.size, '16:9')
})

test('emotion generation requires selected face boxes and preserves independent role moods', () => {
  assert.throws(() => imageEditInstructions(imageEditPreset('portrait-emotion')), /面部/)
  const roles = [
    { box: [0.1, 0.2, 0.3, 0.4], x: 10, y: 10 },
    { box: [0.5, 0.2, 0.7, 0.4], x: 50, y: 50 },
  ]
  const prompt = emotionRoleInstructions(roles)
  assert.match(prompt, /角色1.*欣然愉悦/)
  assert.match(prompt, /角色2.*淡然自若/)
  assert.match(prompt, /0到1归一化/)
  assert.throws(() => emotionRoleInstructions([{ box: [0, 0, 0, 1] }]), /面部/)
})

test('all 25 observed emotion points have distinct labels and their own preview assets', () => {
  const moods = Array.from({ length: 25 }, (_, i) =>
    emotionAt(10 + (i % 5) * 20, 10 + Math.floor(i / 5) * 20),
  )
  assert.equal(new Set(moods.map((m) => m.label)).size, 25)
  assert.equal(new Set(moods.map((m) => m.preview)).size, 25)
  assert.ok(moods.every((m) => m.preview))
  assert.ok(moods.every((m) => existsSync(new URL(m.preview))))
  assert.equal(emotionAt(90, 90).label, '疏离冷淡')
  assert.equal(emotionAt(30, 50).label, '欲言又止')
})

test('face selection normalizes reverse drags, clamps outside movement and rejects tiny boxes', () => {
  assert.deepEqual(boxFromDrag({ x: 0.8, y: 0.7 }, { x: 0.2, y: 0.1 }), [0.2, 0.1, 0.8, 0.7])
  assert.deepEqual(boxFromDrag({ x: -1, y: -1 }, { x: 2, y: 2 }), [0, 0, 1, 1])
  assert.equal(boxFromDrag({ x: 0.5, y: 0.5 }, { x: 0.501, y: 0.501 }), null)
  assert.equal(emotionAt(-200, 300).x, 10)
  assert.equal(emotionAt(-200, 300).y, 90)
  assert.equal(emotionAt(NaN, Infinity).label, '淡然自若')
})

test('face client never invents whole-image roles for zero faces, failures or malformed boxes', async () => {
  const fetcher = async () => ({
    ok: true,
    json: async () => ({
      code: 0,
      data: {
        faces: [null, { id: 'bad', box: [0, 0, 0, 1] }, { id: 'face', box: [0.2, 0.1, 0.4, 0.3] }],
      },
    }),
  })
  assert.deepEqual(await detectFaces('image', { fetcher }), [
    { id: 'face', box: [0.2, 0.1, 0.4, 0.3] },
  ])
  const empty = async () => ({ ok: true, json: async () => ({ code: 0, data: { faces: [] } }) })
  assert.deepEqual(await detectFaces('image', { fetcher: empty }), [])
  await assert.rejects(
    detectFaces('image', {
      fetcher: async () => ({ ok: false, status: 503, json: async () => ({ message: '未配置' }) }),
    }),
    /未配置/,
  )
})

test('face client combines cancellation and timeout without dropping authentication', async () => {
  const controller = new AbortController()
  let request
  await detectFaces('https://example.test/face.png', {
    signal: controller.signal,
    headers: { Authorization: 'Bearer fixture-only' },
    fetcher: async (url, options) => {
      request = { url, ...options }
      return { ok: true, json: async () => ({ code: 0, data: { faces: [] } }) }
    },
  })
  assert.equal(request.url, '/api/image/detect-faces')
  assert.equal(request.headers.Authorization, 'Bearer fixture-only')
  assert.notEqual(request.signal, controller.signal)
  controller.abort()
  assert.equal(request.signal.aborted, true)
})

test('short portrait menu remains below its own button and clamps to viewport', () => {
  const layout = imageGridMenuPlacement(
    { left: 20, right: 180, top: 100, bottom: 150 },
    { width: 360, height: 400 },
    { width: 180, height: 96 },
  )
  assert.equal(layout.top, 154)
  assert.equal(layout.width, 180)
  assert.equal(layout.maxHeight, 96)
})
