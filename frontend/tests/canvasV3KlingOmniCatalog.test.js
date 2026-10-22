import test from 'node:test'
import assert from 'node:assert/strict'
import {
  VIDEO_MODEL_CATALOG,
  modelPresentation,
  videoModelOptions,
} from '../src/features/canvas-v3/config/modelCatalog.js'

test('the requested Omni name replaces only the existing Kling dropdown display name', () => {
  const originalValues = ['seedance-2.0-anci', 'Kling 3.0', 'minimax-h3']
  const before = structuredClone(originalValues)
  const options = videoModelOptions(originalValues)
  const kling = options.find((option) => option.value === 'Kling 3.0')
  assert.equal(kling.label, '可灵-Omni')
  assert.equal(kling.icon, 'modelKling')
  assert.equal(options.filter((option) => option.value === 'Kling 3.0').length, 1)
  assert.equal(VIDEO_MODEL_CATALOG.filter((entry) => entry.label === '可灵-Omni').length, 1)
  assert.equal(
    options.some((option) => option.value === '可灵-Omni'),
    false,
  )
  assert.deepEqual(originalValues, before)
})

test('legacy Kling presentation is relabeled without rewriting saved API identity or parameters', () => {
  const saved = {
    value: 'model-api-key:80',
    model: 'Kling 3.0',
    label: 'Kling 3.0',
    params: { ratio: '9:16', duration: 8, mode: '首尾帧' },
    provider: 'existing-provider',
  }
  const before = structuredClone(saved)
  const presentation = modelPresentation(saved, 'video')
  assert.equal(presentation.label, '可灵-Omni')
  assert.equal(presentation.value, saved.value)
  assert.equal(presentation.model, saved.model)
  assert.deepEqual(presentation.params, saved.params)
  assert.equal(presentation.provider, saved.provider)
  assert.equal(presentation.icon, 'modelKling')
  assert.deepEqual(saved, before)
})

test('custom and unrelated display names never upgrade an unrelated model to Kling', () => {
  for (const label of ['可灵-Omni', 'Kling 3.0']) {
    const unrelated = { value: 'custom-route', model: 'other-video', label }
    const result = modelPresentation(unrelated, 'video')
    assert.equal(result.label, label)
    assert.equal(result.value, unrelated.value)
    assert.equal(result.model, unrelated.model)
    assert.equal(result.icon, 'video')
  }
  const custom = { value: 'Kling 3.0', label: '我的可灵专用线路' }
  assert.equal(modelPresentation(custom, 'video').label, custom.label)
  assert.equal(modelPresentation(custom, 'video').icon, 'modelKling')
  const otherModel = { value: 'Kling 3.0', model: 'minimax-h3', label: 'Kling 3.0' }
  const result = modelPresentation(otherModel, 'video')
  assert.equal(result.label, 'Kling 3.0')
  assert.equal(result.icon, 'modelMinimax')
})

test('the display change does not append configured Omni routes or change model routing choices', () => {
  const configured = [
    { value: 'provider-route:kling', model: 'kling-v3-omni', label: '可灵-Omni' },
    { value: 'provider-route:other', model: 'other', label: 'Kling 3.0' },
  ]
  const before = structuredClone(configured)
  const options = videoModelOptions(['Kling 3.0'], configured, 'Kling 3.0')
  assert.deepEqual(
    options.map(({ value, label }) => ({ value, label })),
    [{ value: 'Kling 3.0', label: '可灵-Omni' }],
  )
  assert.deepEqual(configured, before)
})
