import test from 'node:test'
import assert from 'node:assert/strict'
import {
  modelMenuPlacement,
  nodePopupPlacement,
} from '../src/features/canvas-v3/config/popupPlacement.js'
import {
  IMAGE_MODEL_CATALOG,
  VIDEO_MODEL_CATALOG,
  modelPresentation,
  videoModelOptions,
} from '../src/features/canvas-v3/config/modelCatalog.js'

test('opens directly below the model trigger when there is enough space', () => {
  const result = modelMenuPlacement(
    { left: 126, top: 395, bottom: 427 },
    { width: 1228, height: 892 },
    20,
  )
  assert.deepEqual(result, { direction: 'below', left: 126, top: 431, width: 370, height: 410 })
})

test('opens directly above the model trigger near the screen bottom', () => {
  const result = modelMenuPlacement(
    { left: 105, top: 471, bottom: 503 },
    { width: 806, height: 527 },
    20,
  )
  assert.equal(result.direction, 'above')
  assert.equal(result.top + result.height + 4, 471)
  assert.equal(result.height, 410)
})

test('clamps horizontally and fits the longer side in a small viewport', () => {
  const result = modelMenuPlacement(
    { left: 320, top: 250, bottom: 282 },
    { width: 360, height: 400 },
    20,
  )
  assert.equal(result.left, 8)
  assert.equal(result.width, 344)
  assert.ok(result.top >= 8)
  assert.ok(result.top + result.height <= 392)
})

test('short configured model lists do not leave an empty oversized menu', () => {
  const result = modelMenuPlacement(
    { left: 180, top: 566, bottom: 598 },
    { width: 1228, height: 892 },
    4,
  )
  assert.equal(result.direction, 'below')
  assert.equal(result.height, 230)
  assert.equal(result.top, 602)
})

test('reference metadata stays distinct from configured API models', () => {
  assert.equal(IMAGE_MODEL_CATALOG[0].latency, '30s')
  assert.equal(modelPresentation({ value: 'custom-api', label: '自有模型' }).latency, '')
  assert.equal(modelPresentation({ value: 'custom-api', label: '自有模型' }).value, 'custom-api')
})

test('video Mini catalogue reproduces its own label, description and UI-only identity', () => {
  const entries = VIDEO_MODEL_CATALOG.filter((model) => model.value === 'seedance-2.0-mini')
  assert.equal(entries.length, 1)
  const mini = entries[0]
  assert.equal(mini.label, '即梦 Seedance 2.0 mini')
  assert.equal(mini.description, '极致性价比，相近的体验，比Fast更快的推理速度')
  assert.equal(mini.icon, 'modelSeedanceMini')
  assert.equal(mini.uiOnly, true)
  assert.notEqual(mini.value, '2.0')
  assert.doesNotMatch(mini.value, /fast/i)
})

test('video metadata preserves identities and unrelated labels while applying the requested Omni name', () => {
  const values = ['2.0', 'seedance-2.0-mini', 'Seedance 1.5 Pro', 'Kling 3.0', 'HappyHorse 1.0']
  const original = [...values]
  const options = videoModelOptions(values)
  assert.deepEqual(
    options.map((option) => option.value),
    original,
  )
  for (const index of [0, 2, 4]) assert.equal(options[index].label, original[index])
  assert.equal(options[3].label, '可灵-Omni')
  assert.equal(options[1].label, '即梦 Seedance 2.0 mini')
  assert.equal(options[1].uiOnly, true)
  const mini = modelPresentation(options[1], 'video')
  assert.equal(mini.icon, 'modelSeedanceMini')
  assert.equal(mini.description, '极致性价比，相近的体验，比Fast更快的推理速度')
  assert.equal(mini.value, 'seedance-2.0-mini')
  assert.deepEqual(values, original)
})

test('video menu can use its reference row geometry without changing default image menu sizing', () => {
  const result = modelMenuPlacement(
    { left: 126, top: 395, bottom: 427 },
    { width: 1228, height: 892 },
    5,
    { width: 440, itemHeight: 68 },
  )
  assert.deepEqual(result, { direction: 'below', left: 126, top: 431, width: 440, height: 346 })
  const narrow = modelMenuPlacement(
    { left: 320, top: 250, bottom: 282 },
    { width: 360, height: 400 },
    5,
    { width: 440, itemHeight: 68 },
  )
  assert.equal(narrow.width, 344)
  assert.equal(narrow.left, 8)
  assert.ok(narrow.top >= 8)
  assert.ok(narrow.top + narrow.height <= 392)
  assert.ok(narrow.height > 0)
})

test('parameter popup opens above its trigger and stays within the screen', () => {
  const result = nodePopupPlacement(
    { left: 396, top: 634, bottom: 666 },
    { width: 1085, height: 693 },
    { width: 342, height: 500 },
  )
  assert.equal(result.direction, 'above')
  assert.equal(result.top + result.height + 4, 634)
  assert.equal(result.top, 130)
})

test('tall parameter popup scrolls instead of being clipped by a short viewport', () => {
  const result = nodePopupPlacement(
    { left: 180, top: 350, bottom: 382 },
    { width: 360, height: 400 },
    { width: 342, height: 571 },
  )
  assert.equal(result.top, 8)
  assert.equal(result.height, 338)
  assert.ok(result.left + result.width <= 352)
})

test('reference picker near the top opens down and avoids the right screen edge', () => {
  const result = nodePopupPlacement(
    { left: 1060, top: 64, bottom: 89 },
    { width: 1228, height: 892 },
    { width: 320, height: 280 },
  )
  assert.equal(result.direction, 'below')
  assert.equal(result.top, 93)
  assert.equal(result.left, 900)
})
