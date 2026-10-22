import test from 'node:test'
import assert from 'node:assert/strict'
import { CANVAS_ICONS } from '../src/features/canvas-v3/config/icons.js'
import {
  VIDEO_MODEL_CATALOG,
  modelPresentation,
  videoModelOptions,
} from '../src/features/canvas-v3/config/modelCatalog.js'

test('Kling icon is a local transparent monochrome SVG without lettering or a background tile', () => {
  const icon = CANVAS_ICONS.modelKling
  assert.ok(icon)
  assert.equal(icon.viewBox, '0 0 24 24')
  assert.match(icon.body, /(?:fill|stroke)="currentColor"/)
  assert.match(icon.body, /<path\b/)
  assert.doesNotMatch(
    icon.body,
    /<(?:image|rect|text|script|style|defs|linearGradient|radialGradient|pattern)\b/i,
  )
  assert.doesNotMatch(icon.body, /https?:|data:|\bhref\s*=|\bon\w+\s*=|url\s*\(/i)
  assert.doesNotMatch(
    icon.body,
    /#[0-9a-f]{3,8}\b|(?:rgb|hsl)a?\(|\b(?:white|black|cyan|teal|orange|yellow)\b/i,
  )
  assert.doesNotMatch(icon.body, /Kling|MiniMax|Seedance|HappyHorse|可灵|即梦/)
})

test('Kling keeps the exact existing model identity and does not create a duplicate or UI-only alias', () => {
  const entries = VIDEO_MODEL_CATALOG.filter((model) => model.value === 'Kling 3.0')
  assert.equal(entries.length, 1)
  assert.equal(entries[0].label, '可灵-Omni')
  assert.equal(entries[0].icon, 'modelKling')
  assert.notEqual(entries[0].uiOnly, true)
  const values = [
    '2.0',
    'seedance-2.0-mini',
    'Seedance 1.5 Pro',
    'Kling 3.0',
    'HappyHorse 1.0',
    'minimax',
  ]
  const before = [...values]
  const options = videoModelOptions(values)
  assert.deepEqual(
    options.map((model) => model.value),
    before,
  )
  assert.equal(options.filter((model) => model.value === 'Kling 3.0').length, 1)
  assert.deepEqual(values, before)
})

test('Kling trigger and menu share the requested display label and icon without altering identity or UI-only state', () => {
  const [option] = videoModelOptions(['Kling 3.0'])
  const menu = modelPresentation(option, 'video')
  const selected = modelPresentation({ value: 'Kling 3.0', label: 'Kling 3.0' }, 'video')
  for (const presentation of [menu, selected]) {
    assert.equal(presentation.value, 'Kling 3.0')
    assert.equal(presentation.label, '可灵-Omni')
    assert.equal(presentation.icon, 'modelKling')
    assert.notEqual(presentation.uiOnly, true)
  }
  assert.equal(menu.icon, selected.icon)
})

test('Kling presentation leaves other registered video and image brands distinct', () => {
  const cases = [
    ['seedance-2.0-mini', 'modelSeedanceMini'],
    ['HappyHorse 1.0', 'modelHappyHorse'],
    ['minimax', 'modelMinimax'],
  ]
  for (const [value, icon] of cases)
    assert.equal(modelPresentation(videoModelOptions([value])[0], 'video').icon, icon)
  assert.equal(
    modelPresentation({ value: 'tt-image-2.5', label: 'image-2.5' }).icon,
    'modelImage25',
  )
  assert.equal(modelPresentation({ value: 'banana-pro', label: 'banana-pro' }).icon, 'modelBanana')
  assert.equal(modelPresentation({ value: '2.0', label: '2.0' }, 'video').icon, 'video')
})
