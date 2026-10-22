import test from 'node:test'
import assert from 'node:assert/strict'
import { CANVAS_ICONS } from '../src/features/canvas-v3/config/icons.js'
import { modelPresentation } from '../src/features/canvas-v3/config/modelCatalog.js'

test('both configured Banana families use the same small transparent outline', () => {
  for (const model of [
    'banana-2.1',
    'banana21',
    'banana_2.1',
    'banana-pro',
    'banana-pro-api',
    'bananapro',
    'gemini-3-pro-image-preview',
  ]) {
    const option = { value: 'model-api-key:87', model, label: '任意名称', provider: 'configured' }
    const presented = modelPresentation(option)
    assert.equal(presented.icon, 'modelBanana', model)
    assert.equal(presented.value, option.value)
    assert.equal(presented.model, model)
    assert.equal(presented.provider, option.provider)
    assert.equal(modelPresentation({ value: model, label: '模型' }).icon, 'modelBanana')
  }
})

test('banana branding follows model identity, never editable labels, video or fake routes', () => {
  assert.equal(modelPresentation({ value: 'unknown', label: 'Nano Banana Pro' }).icon, 'image')
  assert.equal(
    modelPresentation({ value: 'banana-pro', model: 'other-model', label: 'Banana' }).icon,
    'image',
  )
  assert.equal(modelPresentation({ value: 'banana-pro', label: '专业视频' }, 'video').icon, 'video')
  assert.equal(
    modelPresentation({ value: 'tt-image-2.5', label: 'banana-pro' }).icon,
    'modelImage25',
  )
})

test('banana SVG has no words, raster, color tile, or corner badge', () => {
  const icon = CANVAS_ICONS.modelBanana
  assert.equal(icon.viewBox, '0 0 24 24')
  assert.match(icon.body, /fill="none" stroke="currentColor" stroke-width="1.5"/)
  assert.match(icon.body, /stroke-linecap="round" stroke-linejoin="round"/)
  assert.equal((icon.body.match(/<path /g) || []).length, 2)
  assert.doesNotMatch(
    icon.body,
    /<(?:text|image|rect|circle|polygon|script)|onload|https?:|data:|#[0-9a-f]{3}|Nano|Banana/i,
  )
})
