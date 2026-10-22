import test from 'node:test'
import assert from 'node:assert/strict'
import { CANVAS_ICONS } from '../src/features/canvas-v3/config/icons.js'
import {
  modelPresentation,
  videoModelOptions,
} from '../src/features/canvas-v3/config/modelCatalog.js'

test('Wanxiang uses a local monochrome mark with transparent cutouts and consistent optical bounds', () => {
  const icon = CANVAS_ICONS.modelWanxiang
  assert.ok(icon)
  assert.equal(icon.viewBox, '0 0 24 24')
  assert.match(icon.body, /fill="currentColor"/)
  assert.match(icon.body, /fill-rule="evenodd"/)
  assert.match(icon.body, /translate\(2 2\) scale\(1\.25\)/)
  assert.doesNotMatch(
    icon.body,
    /<(?:image|rect|text|script|style|defs|mask|filter|pattern|linearGradient|radialGradient)\b/i,
  )
  assert.doesNotMatch(icon.body, /https?:|data:|\bhref\s*=|\bon\w+\s*=|url\s*\(/i)
  assert.doesNotMatch(icon.body, /#[0-9a-f]{3,8}\b|(?:rgb|hsl)a?\(|\b(?:white|black|purple)\b/i)
})

test('Wanxiang menu and selected trigger share the same icon without changing existing brands', () => {
  const [option] = videoModelOptions(['万相 3.0'])
  assert.equal(option.icon, 'modelWanxiang')
  assert.equal(modelPresentation(option, 'video').icon, 'modelWanxiang')
  assert.equal(
    modelPresentation({ value: '万相 3.0', label: '万相 3.0' }, 'video').icon,
    'modelWanxiang',
  )
  assert.equal(modelPresentation(videoModelOptions(['Kling 3.0'])[0], 'video').icon, 'modelKling')
  assert.equal(modelPresentation(videoModelOptions(['minimax'])[0], 'video').icon, 'modelMinimax')
})
