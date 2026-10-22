import test from 'node:test'
import assert from 'node:assert/strict'
import {
  VIDEO_MODEL_CATALOG,
  modelPresentation,
  videoModelOptions,
} from '../src/features/canvas-v3/config/modelCatalog.js'
import {
  MINIMAX_H3_MODEL,
  SEEDANCE20_ANCI_MODEL,
  SEEDANCE25_MODEL,
} from '../src/features/canvas-v3/config/videoModelParameters.js'

test('Seedance 2.0 per-call is a separate documented menu model, not Mini or per-second 2.5', () => {
  const entries = VIDEO_MODEL_CATALOG.filter((model) => model.value === SEEDANCE20_ANCI_MODEL)
  assert.equal(entries.length, 1)
  const [model] = entries
  assert.equal(model.label, 'Seedance 2.0 按次')
  assert.equal(model.icon, 'modelSeedanceMini')
  assert.match(model.description, /按次计费.*快速 \/ 标准.*4～15秒.*720P.*0～9张参考图/)
  assert.notEqual(model.uiOnly, true)
  assert.notEqual(model.value, 'seedance-2.0-mini')
  assert.notEqual(model.value, SEEDANCE25_MODEL)
  assert.equal(modelPresentation(model, 'video').icon, 'modelSeedanceMini')
})

test('per-call model routes replace only their own catalogue family and retain all opaque route identities', () => {
  const values = [SEEDANCE20_ANCI_MODEL, SEEDANCE25_MODEL, MINIMAX_H3_MODEL, 'seedance-2.0-mini']
  const original = structuredClone(values)
  const configured = [
    {
      value: 'feature-route:81',
      model: SEEDANCE20_ANCI_MODEL,
      label: '我的按次线路 A',
      icon: 'video',
    },
    { value: 'feature-route:82', model: SEEDANCE20_ANCI_MODEL, label: '我的按次线路 B' },
    { value: 'feature-route:83', model: SEEDANCE25_MODEL, label: '我的按秒线路' },
    { value: 'feature-route:84', model: MINIMAX_H3_MODEL, label: '我的 H3' },
    { value: 'feature-route:85', model: 'other', label: 'Seedance 2.0 按次' },
  ]
  const before = structuredClone(configured)
  const options = videoModelOptions(values, configured)
  assert.deepEqual(
    options.map((model) => model.value),
    [
      'feature-route:81',
      'feature-route:82',
      'feature-route:83',
      'feature-route:84',
      'seedance-2.0-mini',
    ],
  )
  for (const option of options.slice(0, 2)) {
    const presentation = modelPresentation(option, 'video')
    assert.equal(presentation.icon, 'modelSeedanceMini')
    assert.equal(presentation.value, option.value)
    assert.equal(presentation.label, option.label)
    assert.equal(presentation.model, SEEDANCE20_ANCI_MODEL)
    assert.notEqual(presentation.uiOnly, true)
  }
  assert.equal(modelPresentation(options[2], 'video').icon, 'modelSeedanceMini')
  assert.equal(modelPresentation(options[3], 'video').icon, 'modelMinimax')
  assert.equal(modelPresentation(options[4], 'video').uiOnly, true)
  assert.equal(modelPresentation(configured[4], 'video').icon, 'video')
  assert.deepEqual(values, original)
  assert.deepEqual(configured, before)
})

test('only the exact legacy per-call display label is expanded without changing routes or generation settings', () => {
  const configured = [
    {
      value: 'feature-route:91',
      model: SEEDANCE20_ANCI_MODEL,
      label: 'SD 2.0 按次',
      provider: 'lk888',
      params: { version: '标准', duration: 15, resolution: '720p', aspect_ratio: '9:16' },
    },
    { value: 'feature-route:92', model: SEEDANCE20_ANCI_MODEL, label: '我的 SD 2.0 按次线路' },
    { value: 'feature-route:93', model: SEEDANCE25_MODEL, label: 'SD 2.0 按次' },
    { value: 'feature-route:94', model: MINIMAX_H3_MODEL, label: 'SD 2.0 按次' },
  ]
  const before = structuredClone(configured)
  const options = videoModelOptions(
    [SEEDANCE20_ANCI_MODEL, SEEDANCE25_MODEL, MINIMAX_H3_MODEL],
    configured,
    configured[0].value,
  )
  assert.deepEqual(
    options.map((option) => option.label),
    ['Seedance 2.0 按次', '我的 SD 2.0 按次线路', 'SD 2.0 按次', 'SD 2.0 按次'],
  )
  for (let index = 0; index < configured.length; index += 1) {
    const option = options[index]
    const presentation = modelPresentation(option, 'video')
    assert.equal(option.value, configured[index].value)
    assert.equal(option.model, configured[index].model)
    assert.equal(presentation.label, option.label)
    assert.equal(presentation.value, option.value)
    assert.equal(presentation.model, option.model)
  }
  assert.equal(options[0].provider, configured[0].provider)
  assert.deepEqual(options[0].params, configured[0].params)
  assert.equal(modelPresentation(configured[0], 'video').label, 'Seedance 2.0 按次')
  assert.equal(modelPresentation(configured[2], 'video').label, 'SD 2.0 按次')
  assert.deepEqual(configured, before, 'Display normalization must not modify backend records')
})

test('only Seedance 2.5 legacy labels become the full-capability label while request identity stays unchanged', () => {
  const configured = [
    {
      value: 'feature-route:101',
      model: SEEDANCE25_MODEL,
      label: 'seedance-2.5',
      provider: 'anmiao',
      params: { duration: 30, resolution: '1080p', ratio: '21:9', web_search: true },
    },
    { value: 'feature-route:102', model: 'seedance-2.5-guanfang-anmiao', label: 'Seedance 2.5' },
    { value: 'feature-route:103', model: SEEDANCE25_MODEL, label: '我的 seedance-2.5 专线' },
    { value: 'feature-route:104', model: SEEDANCE20_ANCI_MODEL, label: 'seedance-2.5' },
    { value: 'feature-route:105', model: MINIMAX_H3_MODEL, label: 'Seedance 2.5' },
  ]
  const before = structuredClone(configured)
  const options = videoModelOptions(
    [SEEDANCE25_MODEL, SEEDANCE20_ANCI_MODEL, MINIMAX_H3_MODEL],
    configured,
    configured[0].value,
  )
  const byValue = new Map(options.map((option) => [option.value, option]))
  assert.equal(byValue.get('feature-route:101').label, 'Seedance 2.5 全能')
  assert.equal(byValue.get('feature-route:102').label, 'Seedance 2.5 全能')
  assert.equal(byValue.get('feature-route:103').label, '我的 seedance-2.5 专线')
  assert.equal(byValue.get('feature-route:104').label, 'seedance-2.5')
  assert.equal(byValue.get('feature-route:105').label, 'Seedance 2.5')
  assert.equal(
    VIDEO_MODEL_CATALOG.find((model) => model.value === SEEDANCE25_MODEL).label,
    'Seedance 2.5 全能',
  )
  for (const source of configured) {
    const option = byValue.get(source.value)
    assert.equal(option.value, source.value)
    assert.equal(option.model, source.model)
    assert.equal(option.provider, source.provider)
    assert.deepEqual(option.params, source.params)
    const presented = modelPresentation(source, 'video')
    assert.equal(presented.label, option.label)
    assert.equal(presented.value, source.value)
    assert.equal(presented.model, source.model)
    assert.deepEqual(presented.params, source.params)
  }
  assert.equal(modelPresentation(configured[0], 'image').label, 'seedance-2.5')
  assert.deepEqual(configured, before)
})
