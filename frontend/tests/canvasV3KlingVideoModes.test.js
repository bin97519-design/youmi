import test from 'node:test'
import assert from 'node:assert/strict'
import { CANVAS_ICONS } from '../src/features/canvas-v3/config/icons.js'
import {
  KLING_VIDEO_MODES,
  isKling30Model,
  klingVideoMode,
} from '../src/features/canvas-v3/config/klingVideoModes.js'
import { klingModeMenuPlacement } from '../src/features/canvas-v3/config/popupPlacement.js'

test('Kling mode menu matches only its existing real identity, not labels or invented aliases', () => {
  for (const value of [
    'Kling 3.0',
    '  kLiNg 3.0  ',
    { model: ' Kling 3.0 ', value: 'model-api-key:8', label: '自定义名称' },
    { value: 'KLING 3.0', label: '另一个显示名称' },
  ])
    assert.equal(isKling30Model(value), true)
  for (const value of [
    undefined,
    null,
    3,
    {},
    'kling-v3',
    'kling-v3-video',
    'kling-v3-omni',
    'kling-video-o3',
    'Kling 3.0 Pro',
    { label: 'Kling 3.0' },
    { value: 'model-api-key:8', label: 'Kling 3.0' },
    { model: 'minimax-h3', value: 'Kling 3.0', label: 'Kling 3.0' },
  ])
    assert.equal(isKling30Model(value), false)
})

test('the Omni menu contains exactly the three user-defined selectable modes', () => {
  assert.deepEqual(
    KLING_VIDEO_MODES.map(({ label, icon, disabled }) => [label, icon, disabled]),
    [
      ['视频参考', 'klingModeVideoReference', false],
      ['参考生', 'klingModeReference', false],
      ['首尾帧', 'klingModeFrames', false],
    ],
  )
  assert.equal(Object.isFrozen(KLING_VIDEO_MODES), true)
  for (const mode of KLING_VIDEO_MODES) {
    assert.equal(Object.isFrozen(mode), true)
    assert.equal(mode.reason, '')
  }
})

test('mode presentation retains recognized saved choices and falls back without mutating drafts', () => {
  for (const mode of KLING_VIDEO_MODES) assert.equal(klingVideoMode(mode.label), mode)
  const draft = { mode: '历史自定义模式', model: 'Kling 3.0', params: { ratio: '9:16' } }
  const before = structuredClone(draft)
  assert.equal(klingVideoMode(draft.mode), KLING_VIDEO_MODES[0])
  assert.equal(klingVideoMode(undefined), KLING_VIDEO_MODES[0])
  for (const removed of ['文生视频', '全能参考', '图生视频', '图片参考'])
    assert.equal(klingVideoMode(removed), KLING_VIDEO_MODES[0])
  assert.deepEqual(draft, before)
})

test('mode icons are independent small monochrome vectors without remote assets or shared glyph changes', () => {
  const bodies = new Set()
  for (const { icon: name } of KLING_VIDEO_MODES) {
    const glyph = CANVAS_ICONS[name]
    assert.equal(glyph.viewBox, '0 0 16 16')
    assert.match(glyph.body, /fill="none"/)
    assert.match(glyph.body, /stroke="currentColor"/)
    assert.match(glyph.body, /stroke-width="1.3"/)
    assert.doesNotMatch(glyph.body, /<(?:image|text|script|style)\b|https?:|data:|\bhref=/i)
    bodies.add(glyph.body)
    assert.notEqual(glyph, CANVAS_ICONS.text)
    assert.notEqual(glyph, CANVAS_ICONS.image)
  }
  assert.equal(bodies.size, 3)
  assert.match(CANVAS_ICONS.klingModeVideoReference.body, /3 2-3 2z/)
  assert.match(CANVAS_ICONS.klingModeFrames.body, /rotate\(-9/)
  assert.match(CANVAS_ICONS.klingModeReference.body, /<circle\b/)
})

test('Kling menu opens flush below its own trigger at the observed size', () => {
  const anchor = { left: 149, top: 212, bottom: 244 }
  assert.deepEqual(klingModeMenuPlacement(anchor, { width: 974, height: 508 }), {
    direction: 'below',
    left: 149,
    top: 244,
    width: 162,
    height: 156,
  })
})

test('Kling menu flips upward only when below does not fit and clamps the horizontal edge', () => {
  const anchor = { left: 1050, top: 780, bottom: 812 }
  assert.deepEqual(klingModeMenuPlacement(anchor, { width: 1135, height: 892 }), {
    direction: 'above',
    left: 965,
    top: 624,
    width: 162,
    height: 156,
  })
})

test('Kling menu remains inside narrow, short, and even degenerate viewports', () => {
  for (const viewport of [
    { width: 120, height: 200 },
    { width: 320, height: 100 },
    { width: 12, height: 10 },
    { width: 0, height: 0 },
  ]) {
    const position = klingModeMenuPlacement(
      { left: viewport.width + 30, top: viewport.height / 2, bottom: viewport.height / 2 + 32 },
      viewport,
    )
    assert.ok(position.width >= 0)
    assert.ok(position.height >= 0)
    assert.ok(position.left >= 0)
    assert.ok(position.top >= 0)
    assert.ok(position.left + position.width <= viewport.width)
    assert.ok(position.top + position.height <= viewport.height)
  }
})
