import test from 'node:test'
import assert from 'node:assert/strict'
import { CANVAS_ICONS } from '../src/features/canvas-v3/config/icons.js'
import {
  VIDEO_MODEL_CATALOG,
  modelPresentation,
  videoModelOptions,
} from '../src/features/canvas-v3/config/modelCatalog.js'

test('Seedance Mini uses two separate current-color sail and folded-ribbon silhouettes', () => {
  const icon = CANVAS_ICONS.modelSeedanceMini
  assert.equal(icon.viewBox, '0 0 24 24')
  const paths = icon.body.match(/<path\b[^>]*\/>/g) || []
  assert.equal(paths.length, 2)
  for (const path of paths) {
    assert.match(path, /\bd="[^"]+"/)
    assert.match(path, /\bfill="currentColor"/)
  }
  assert.notEqual(paths[0], paths[1])
})

test('Mini SVG is local and monochrome, with no gradient, background tile or text', () => {
  const body = CANVAS_ICONS.modelSeedanceMini.body
  assert.doesNotMatch(
    body,
    /<(?:image|rect|text|script|style|defs|linearGradient|radialGradient|pattern)\b/i,
  )
  assert.doesNotMatch(body, /https?:|data:|\bhref\s*=|\bon\w+\s*=|url\s*\(/i)
  assert.doesNotMatch(body, /#[0-9a-f]{3,8}\b|(?:rgb|hsl)a?\(|\b(?:white|black|cyan|teal)\b/i)
  assert.doesNotMatch(body, /Nano|Banana|Seedance|Mini|即梦/)
})

test('the selected Mini trigger and video menu receive the same icon without changing route metadata', () => {
  const mini = VIDEO_MODEL_CATALOG.find((model) => model.value === 'seedance-2.0-mini')
  assert.ok(mini)
  const [menuOption] = videoModelOptions([mini.value])
  const menu = modelPresentation(menuOption, 'video')
  const selected = modelPresentation({ ...mini }, 'video')
  for (const presented of [menu, selected]) {
    assert.equal(presented.icon, 'modelSeedanceMini')
    assert.equal(presented.value, 'seedance-2.0-mini')
    assert.equal(presented.label, '即梦 Seedance 2.0 mini')
    assert.equal(presented.description, '极致性价比，相近的体验，比Fast更快的推理速度')
    assert.equal(presented.uiOnly, true)
  }
  assert.equal(menu.icon, selected.icon)
})

test('Mini presentation does not replace or mutate other model icons', () => {
  const otherIcons = Object.fromEntries(
    Object.entries(CANVAS_ICONS).filter(([name]) => name !== 'modelSeedanceMini'),
  )
  const before = JSON.stringify(otherIcons)
  assert.equal(
    modelPresentation({ value: 'tt-image-2.5', label: 'image-2.5' }).icon,
    'modelImage25',
  )
  assert.equal(modelPresentation({ value: 'banana-2.1', label: 'banana-2.1' }).icon, 'modelBanana')
  assert.equal(modelPresentation({ value: 'banana-pro', label: 'banana-pro' }).icon, 'modelBanana')
  assert.equal(modelPresentation({ value: '2.0', label: '2.0' }, 'video').icon, 'video')
  modelPresentation(videoModelOptions(['seedance-2.0-mini'])[0], 'video')
  assert.equal(JSON.stringify(otherIcons), before)
  assert.notEqual(CANVAS_ICONS.modelSeedanceMini.body, CANVAS_ICONS.modelImage25.body)
  assert.notEqual(CANVAS_ICONS.modelSeedanceMini.body, CANVAS_ICONS.modelBanana.body)
})
