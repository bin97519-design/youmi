import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CANVAS_ICONS } from '../src/features/canvas-v3/config/icons.js'
import { modelPresentation } from '../src/features/canvas-v3/config/modelCatalog.js'

test('image-2.5 aliases share the transparent knot icon', () => {
  for (const value of [
    'tt-image-2.5',
    'tt-image-2.5-flare',
    'tt-image-2.5-sunburst',
    'GPT-image2.5',
    'gpt-image-2.5',
    'gpt-image2.5-sunburst-api',
  ]) {
    assert.equal(modelPresentation({ value, label: '自定义名称' }).icon, 'modelImage25')
  }
})

test('configured image-2.5 route metadata controls branding and stays intact', () => {
  const model = {
    value: 'model-api-key:44',
    label: 'image-2.5',
    model: 'tt-image-2.5',
    defaultVersion: 'sunburst',
    provider: 'youmi888',
    icon: 'image',
    customMetadata: { enabled: true },
  }
  assert.deepEqual(modelPresentation(model), {
    latency: '',
    description: '使用项目已配置的生成服务',
    ...model,
    icon: 'modelImage25',
  })
})

test('editable names do not apply image-2.5 branding to other models or video', () => {
  assert.equal(modelPresentation({ value: 'other-image', label: 'tt-image-2.5' }).icon, 'image')
  assert.equal(
    modelPresentation({ value: 'tt-image-2.5', label: '自定义视频' }, 'video').icon,
    'video',
  )
  assert.equal(
    modelPresentation({ value: 'seedream-5', label: 'Seedream 5.0 Pro' }).icon,
    'modelSeedream',
  )
  assert.equal(
    modelPresentation({ value: 'custom-image', label: '自有模型', icon: 'modelLib' }).icon,
    'modelLib',
  )
})

test('knot uses the installed local Remix outline without a tile or hard-coded color', () => {
  const icon = CANVAS_ICONS.modelImage25
  const source = readFileSync(
    new URL('../node_modules/remixicon/icons/Logos/openai-line.svg', import.meta.url),
    'utf8',
  )
  assert.equal(icon.viewBox, '0 0 24 24')
  assert.equal(icon.body.match(/d="([^"]+)"/)[1], source.match(/d="([^"]+)"/)[1])
  assert.match(icon.body, /fill="currentColor"/)
  assert.doesNotMatch(icon.body, /<(?:rect|image)|(?:#|rgb\(|white|black|data:)/i)
})
