import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { videoModelOptions } from '../src/features/canvas-v3/config/modelCatalog.js'
import {
  MINIMAX_H3_MODEL,
  SEEDANCE20_ANCI_MODEL,
  SEEDANCE25_MODEL,
} from '../src/features/canvas-v3/config/videoModelParameters.js'

const removed = ['seedance-2.0-mini', 'Seedance 1.5 Pro', 'HappyHorse 1.0']
const retained = [
  SEEDANCE20_ANCI_MODEL,
  SEEDANCE25_MODEL,
  'Kling 3.0',
  MINIMAX_H3_MODEL,
  '万相 3.0',
]

async function loadConfig(name) {
  const url = new URL(`../src/features/canvas-v3/config/${name}.js`, import.meta.url)
  const source = (await readFile(url, 'utf8')).replace(
    /from (["'])(\.[^"']+)\1/g,
    (_match, _quote, path) =>
      `from '${new URL(path.endsWith('.js') ? path : `${path}.js`, url).href}'`,
  )
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
}

test('the actual video dropdown removes only the three retired choices and keeps the renamed active models', async () => {
  const { NODE_CONTROLS } = await loadConfig('nodeControls')
  assert.deepEqual(NODE_CONTROLS.video.models, retained)
  const options = videoModelOptions(NODE_CONTROLS.video.models)
  assert.deepEqual(
    options.map((option) => option.value),
    retained,
  )
  assert.deepEqual(
    options.map((option) => option.label),
    ['Seedance 2.0 按次', 'Seedance 2.5 全能', '可灵-Omni', 'MiniMax H3', '万相 3.0 全能'],
  )
  assert.equal(
    options.some((option) => removed.includes(option.value)),
    false,
  )
  const { NODE_SPECS } = await loadConfig('nodeSpecs')
  assert.equal(NODE_SPECS.video.model, MINIMAX_H3_MODEL)
})

test('opening a saved retired model never re-adds its menu choice or alters its saved generation settings', async () => {
  const { NODE_CONTROLS } = await loadConfig('nodeControls')
  const beforeControls = structuredClone(NODE_CONTROLS.video)
  for (const model of removed) {
    const saved = { model, params: { ratio: '3:4', resolution: '1080P', duration: 8 } }
    const beforeSaved = structuredClone(saved)
    const options = videoModelOptions(NODE_CONTROLS.video.models, [], saved.model)
    assert.deepEqual(
      options.map((option) => option.value),
      retained,
    )
    assert.equal(
      options.some((option) => removed.includes(option.value)),
      false,
    )
    assert.deepEqual(saved, beforeSaved)
  }
  assert.deepEqual(NODE_CONTROLS.video, beforeControls)
})

test('configured active routes remain unchanged and unrelated retired configuration does not append options', async () => {
  const { NODE_CONTROLS } = await loadConfig('nodeControls')
  const configured = [
    { value: 'feature-route:1', model: SEEDANCE20_ANCI_MODEL, label: 'Seedance 2.0 按次' },
    { value: 'feature-route:2', model: SEEDANCE25_MODEL, label: 'Seedance 2.5 全能' },
    { value: 'feature-route:3', model: MINIMAX_H3_MODEL, label: 'MiniMax H3' },
    ...removed.map((model, index) => ({
      value: `feature-route:old-${index}`,
      model,
      label: model,
    })),
  ]
  const before = structuredClone(configured)
  for (const selected of ['', ...removed]) {
    const options = videoModelOptions(NODE_CONTROLS.video.models, configured, selected)
    assert.deepEqual(
      options.map((option) => option.value),
      ['feature-route:1', 'feature-route:2', 'Kling 3.0', 'feature-route:3', '万相 3.0'],
    )
    for (const option of options.filter((option) => option.model)) {
      const original = configured.find((value) => value.value === option.value)
      assert.equal(option.model, original.model)
      assert.equal(option.label, original.label)
    }
  }
  assert.deepEqual(configured, before)
})
