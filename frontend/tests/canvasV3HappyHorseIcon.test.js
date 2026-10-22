import test from 'node:test'
import assert from 'node:assert/strict'
import { CANVAS_ICONS } from '../src/features/canvas-v3/config/icons.js'
import {
  VIDEO_MODEL_CATALOG,
  modelPresentation,
  videoModelOptions,
} from '../src/features/canvas-v3/config/modelCatalog.js'

test('HappyHorse icon is a local transparent monochrome SVG in the shared 24-unit icon system', () => {
  const icon = CANVAS_ICONS.modelHappyHorse
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
  assert.doesNotMatch(icon.body, /HappyHorse|Happy|Horse|Seedance|Mini|即梦/)
})

test('HappyHorse decorates its existing model option without an alias or duplicate entry', () => {
  const entries = VIDEO_MODEL_CATALOG.filter((model) => model.value === 'HappyHorse 1.0')
  assert.equal(entries.length, 1)
  assert.equal(entries[0].label, 'HappyHorse 1.0')
  assert.equal(entries[0].icon, 'modelHappyHorse')
  const values = ['2.0', 'seedance-2.0-mini', 'Seedance 1.5 Pro', 'Kling 3.0', 'HappyHorse 1.0']
  const before = [...values]
  const options = videoModelOptions(values)
  assert.deepEqual(
    options.map((model) => model.value),
    before,
  )
  assert.equal(options.filter((model) => model.value === 'HappyHorse 1.0').length, 1)
  assert.deepEqual(values, before)
  assert.equal(options.length, values.length)
})

test('HappyHorse trigger and menu metadata use the same icon and retain the exact existing value and label', () => {
  const [option] = videoModelOptions(['HappyHorse 1.0'])
  const menu = modelPresentation(option, 'video')
  const selected = modelPresentation({ value: 'HappyHorse 1.0', label: 'HappyHorse 1.0' }, 'video')
  for (const presentation of [menu, selected]) {
    assert.equal(presentation.value, 'HappyHorse 1.0')
    assert.equal(presentation.label, 'HappyHorse 1.0')
    assert.equal(presentation.icon, 'modelHappyHorse')
  }
  assert.equal(menu.icon, selected.icon)
})

test('adding HappyHorse presentation does not replace Mini, TT, Banana or generic video branding', () => {
  const mini = modelPresentation(videoModelOptions(['seedance-2.0-mini'])[0], 'video')
  assert.equal(mini.icon, 'modelSeedanceMini')
  assert.equal(mini.value, 'seedance-2.0-mini')
  assert.equal(mini.label, '即梦 Seedance 2.0 mini')
  assert.equal(mini.uiOnly, true)
  assert.equal(
    modelPresentation({ value: 'tt-image-2.5', label: 'image-2.5' }).icon,
    'modelImage25',
  )
  assert.equal(modelPresentation({ value: 'banana-pro', label: 'banana-pro' }).icon, 'modelBanana')
  assert.equal(modelPresentation({ value: 'banana-2.1', label: 'banana-2.1' }).icon, 'modelBanana')
  assert.equal(modelPresentation({ value: '2.0', label: '2.0' }, 'video').icon, 'video')
  assert.notEqual(CANVAS_ICONS.modelHappyHorse.body, CANVAS_ICONS.modelSeedanceMini.body)
  assert.notEqual(CANVAS_ICONS.modelHappyHorse.body, CANVAS_ICONS.modelImage25.body)
  assert.notEqual(CANVAS_ICONS.modelHappyHorse.body, CANVAS_ICONS.modelBanana.body)
})
