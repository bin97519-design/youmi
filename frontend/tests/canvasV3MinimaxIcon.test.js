import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { CANVAS_ICONS } from '../src/features/canvas-v3/config/icons.js'
import {
  VIDEO_MODEL_CATALOG,
  modelPresentation,
  videoModelOptions,
} from '../src/features/canvas-v3/config/modelCatalog.js'

async function nodeControls() {
  // Resolve the same extensionless config imports that Vite resolves in the app.
  const url = new URL('../src/features/canvas-v3/config/nodeControls.js', import.meta.url)
  const source = (await readFile(url, 'utf8')).replace(
    /from (["'])(\.[^"']+)\1/g,
    (_match, _quote, path) =>
      `from '${new URL(path.endsWith('.js') ? path : `${path}.js`, url).href}'`,
  )
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`))
    .NODE_CONTROLS
}

test('MiniMax waveform is a local transparent current-color SVG without lettering or a tile', () => {
  const icon = CANVAS_ICONS.modelMinimax
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
  assert.doesNotMatch(icon.body, /MiniMax|Seedance|HappyHorse|即梦/)
})

test('MiniMax cubic waveform and its full stroke fit horizontally inside the 24-unit viewBox', () => {
  const body = CANVAS_ICONS.modelMinimax.body
  const d = body.match(/\bd="([^"]+)"/)[1]
  const xCoordinates = []
  let x = 0
  let curveCount = 0
  for (const [, command, rawValues] of d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
    const values = rawValues.match(/-?(?:\d*\.\d+|\d+\.?\d*)/g)?.map(Number) || []
    if (command === 'M') {
      assert.equal(values.length, 2)
      x = values[0]
    } else if (command === 'c' || command === 'C') {
      assert.equal(values.length, 6)
      const offset = command === 'c' ? x : 0
      xCoordinates.push(offset + values[0], offset + values[2])
      x = offset + values[4]
      curveCount++
    } else {
      // This reference waveform alternates cubic turns and vertical bars.
      assert.match(command, /^[vV]$/)
      assert.equal(values.length, 1)
    }
    xCoordinates.push(x)
  }
  assert.ok(curveCount > 0)
  const transform = body.match(/\btransform="([^"]+)"/)?.[1] || ''
  const translateX = Number(transform.match(/translate\(\s*(-?[\d.]+)/)?.[1] || 0)
  const scaleX = Number(transform.match(/scale\(\s*(-?[\d.]+)/)?.[1] || 1)
  const stroke = Number(body.match(/\bstroke-width="([\d.]+)"/)[1])
  assert.ok(stroke > 0 && Number.isFinite(scaleX))
  const transformed = xCoordinates.map((coordinate) => translateX + coordinate * scaleX)
  const halfStroke = (stroke * Math.abs(scaleX)) / 2
  const leftEdge = Math.min(...transformed) - halfStroke
  const rightEdge = Math.max(...transformed) + halfStroke
  assert.ok(leftEdge >= 0, `The full left stroke must fit: ${leftEdge}`)
  assert.ok(rightEdge <= 24, `The full right stroke must fit: ${rightEdge}`)
})

test('the legacy MiniMax placeholder stays independent while the default menu upgrades to H3', async () => {
  const entries = VIDEO_MODEL_CATALOG.filter((model) => model.value === 'minimax')
  assert.equal(entries.length, 1)
  assert.equal(entries[0].label, 'MiniMax')
  assert.equal(entries[0].icon, 'modelMinimax')
  assert.equal(entries[0].uiOnly, true)
  const controls = await nodeControls()
  assert.equal(controls.video.models.filter((value) => value === 'minimax').length, 0)
  assert.equal(controls.video.models.filter((value) => value === 'minimax-h3').length, 1)
  assert.notEqual(entries[0].value, 'minimax-h3')
  assert.notEqual(entries[0].value, 'MiniMax-Hailuo-H3')
  assert.equal(
    videoModelOptions(controls.video.models).some((option) => option.value === 'minimax'),
    false,
  )
  assert.equal(
    videoModelOptions(controls.video.models, [], 'minimax').filter(
      (option) => option.value === 'minimax',
    ).length,
    1,
  )
})

test('MiniMax selected trigger and dropdown entry use the same icon and retain the canonical model identity', () => {
  const [option] = videoModelOptions(['minimax'])
  const menu = modelPresentation(option, 'video')
  const selected = modelPresentation({ value: 'minimax', label: 'MiniMax' }, 'video')
  for (const presentation of [menu, selected]) {
    assert.equal(presentation.value, 'minimax')
    assert.equal(presentation.label, 'MiniMax')
    assert.equal(presentation.icon, 'modelMinimax')
    assert.equal(presentation.uiOnly, true)
    assert.equal(presentation.latency, '')
  }
  assert.equal(menu.icon, selected.icon)
})

test('MiniMax UI-only metadata does not invent a price and uses the existing composer unknown-price guard', async () => {
  const miniMax = VIDEO_MODEL_CATALOG.find((model) => model.value === 'minimax')
  assert.ok(miniMax)
  assert.equal(miniMax.uiOnly, true)
  for (const field of ['price', 'cost', 'credits', 'mi', 'latency'])
    assert.equal(Object.hasOwn(miniMax, field), false, field)
  const composer = await readFile(
    new URL('../src/features/canvas-v3/components/NodeComposer.vue', import.meta.url),
    'utf8',
  )
  assert.match(
    composer,
    /selectedModel\.value\?\.uiOnly\s*\|\|\s*spec\.value\.cost\s*===\s*null\s*\?\s*'—'/,
  )
})

test('adding MiniMax does not alias, duplicate or rebrand existing video and image options', () => {
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
  assert.deepEqual(values, before)
  assert.equal(options.length, values.length)
  assert.equal(modelPresentation(options[1], 'video').icon, 'modelSeedanceMini')
  assert.equal(modelPresentation(options[4], 'video').icon, 'modelHappyHorse')
  assert.equal(modelPresentation(options[5], 'video').icon, 'modelMinimax')
  assert.equal(
    modelPresentation({ value: 'tt-image-2.5', label: 'image-2.5' }).icon,
    'modelImage25',
  )
  assert.equal(modelPresentation({ value: 'banana-pro', label: 'banana-pro' }).icon, 'modelBanana')
  assert.equal(modelPresentation({ value: 'banana-2.1', label: 'banana-2.1' }).icon, 'modelBanana')
})
