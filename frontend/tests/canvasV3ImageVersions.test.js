import test from 'node:test'
import assert from 'node:assert/strict'
import {
  IMAGE_MODEL_QUALITIES,
  IMAGE_MODEL_VERSIONS,
  imageModelVersion,
  isTtImage25Model,
} from '../src/features/canvas-v3/config/imageModelVersions.js'
import {
  imageModelOptions,
  imageTaskRequest,
} from '../src/features/canvas-v3/sync/imageTaskClient.js'

function imageNode(model, params = {}) {
  return { data: { kind: 'image', model, prompt: '一朵白色花朵', params } }
}

test('TT image requests send the actual quality and background selected in the output panel', () => {
  assert.deepEqual(
    IMAGE_MODEL_QUALITIES.map((item) => item.value),
    ['low', 'medium', 'high', 'xhigh', 'max'],
  )
  const option = { value: 'model-api-key:44', model: 'tt-image-2.5', defaultVersion: 'sunburst' }
  const request = imageTaskRequest(
    imageNode(option.value, {
      version: 'flare',
      quality: '极致画质',
      resolution: '4K',
      background: '自动',
      ratio: '3:4',
      count: '1张',
    }),
    [],
    'screenshot-request',
    option,
  )
  assert.equal(request.parameter_profile, 'canvas-v3-image')
  assert.deepEqual(
    {
      version: request.version,
      quality: request.quality,
      resolution: request.resolution,
      background: request.background,
      ratio: request.size,
      n: request.n,
    },
    { version: 'flare', quality: 'max', resolution: '4K', background: 'auto', ratio: '3:4', n: 1 },
  )
  for (const choice of IMAGE_MODEL_QUALITIES) {
    assert.equal(
      imageTaskRequest(imageNode(option.value, { quality: choice.label }), [], 'id', option)
        .quality,
      choice.value,
    )
  }
  assert.equal(imageTaskRequest(imageNode(option.value), [], 'id', option).quality, 'medium')
  for (const [label, expected] of [
    ['自动', 'auto'],
    ['保留背景', 'opaque'],
    ['透明背景', 'transparent'],
  ]) {
    const selected = imageTaskRequest(
      imageNode(option.value, { background: label }),
      [],
      'id',
      option,
    )
    assert.equal(selected.background, expected)
    assert.equal(selected.output_format, expected === 'transparent' ? 'png' : undefined)
  }
  for (const params of [{ quality: 'unsupported' }, { background: 'unsupported' }]) {
    assert.throws(() => imageTaskRequest(imageNode(option.value, params), [], 'id', option), /有效/)
  }
  assert.equal(
    Object.hasOwn(imageTaskRequest(imageNode('banana2', { quality: '极致画质' }), []), 'quality'),
    false,
  )
  assert.equal(
    Object.hasOwn(imageTaskRequest(imageNode('unknown-model'), []), 'parameter_profile'),
    false,
  )
})

test('TT versions use stable API values and the requested Chinese labels', () => {
  assert.deepEqual(IMAGE_MODEL_VERSIONS, [
    { value: 'flare', label: '标准版' },
    { value: 'sunburst', label: '增强版' },
  ])
  for (const model of [
    'tt-image-2.5',
    'tt-image-2.5-flare',
    'tt-image-2.5-sunburst',
    'GPT-image2.5',
    'gpt-image-2.5',
    'gpt-image2.5-sunburst-api',
  ]) {
    assert.equal(isTtImage25Model(model), true, model)
  }
})

test('configured model identity, not an editable label or opaque route ID, enables versions', () => {
  const configured = {
    value: 'model-api-key:44',
    label: '我的图片模型',
    model: 'tt-image-2.5',
    defaultVersion: 'sunburst',
  }
  assert.equal(isTtImage25Model(configured), true)
  assert.equal(imageModelVersion(configured), 'sunburst')
  for (const option of [
    { value: 'model-api-key:45', label: 'tt-image-2.5 增强版' },
    { value: 'model-api-key:46', model: 'banana-pro', label: 'TT Image 2.5' },
    { value: 'tt-image-2.5', model: 'banana-pro', label: '增强版' },
  ]) {
    assert.equal(isTtImage25Model(option), false)
    assert.equal(imageModelVersion(option, 'sunburst'), undefined)
  }
})

test('explicit version beats configured defaults and legacy aliases retain their defaults', () => {
  const standard = { value: 'model-api-key:44', model: 'tt-image-2.5', defaultVersion: 'flare' }
  const enhanced = { ...standard, defaultVersion: 'sunburst' }
  assert.equal(imageModelVersion(standard, 'sunburst'), 'sunburst')
  assert.equal(imageModelVersion(enhanced, 'flare'), 'flare')
  assert.equal(imageModelVersion('gpt-image2.5-sunburst-api'), 'sunburst')
  assert.equal(imageModelVersion('tt-image-2.5'), 'flare')
  assert.equal(imageModelVersion({ ...standard, defaultVersion: 'unsupported' }), 'flare')
  assert.equal(imageModelVersion('tt-image-2.5', 'unsupported'), 'flare')
})

test('normalizing configured model options preserves safe identity and version metadata', () => {
  const configured = {
    value: 'model-api-key:44',
    label: '任意名称',
    provider: 'youmi888',
    model: 'tt-image-2.5',
    defaultVersion: 'sunburst',
  }
  const [normalized] = imageModelOptions([configured])
  assert.equal(normalized.value, configured.value)
  assert.equal(normalized.model, configured.model)
  assert.equal(normalized.defaultVersion, 'sunburst')
  assert.equal(imageModelVersion(normalized), 'sunburst')
})

test('TT image requests serialize explicit versions without changing the configured route', () => {
  const option = { value: 'model-api-key:44', model: 'tt-image-2.5', defaultVersion: 'sunburst' }
  for (const version of ['flare', 'sunburst']) {
    const request = imageTaskRequest(imageNode(option.value, { version }), [], 'stable-id', option)
    assert.equal(request.model, option.value)
    assert.equal(request.version, version)
    assert.equal(request.client_task_id, 'stable-id')
    assert.equal(request.feature_code, 'canvas-image')
  }
  assert.equal(
    imageTaskRequest(imageNode(option.value), [], 'stable-id', option).version,
    'sunburst',
  )
  assert.equal(imageTaskRequest(imageNode('tt-image-2.5'), []).version, 'flare')
  assert.equal(imageTaskRequest(imageNode('gpt-image2.5-sunburst-api'), []).version, 'sunburst')
})

test('unsupported versions fail before creating a TT request and stale versions never leak to other models', () => {
  const option = { value: 'model-api-key:44', model: 'tt-image-2.5' }
  assert.throws(
    () => imageTaskRequest(imageNode(option.value, { version: 'unsupported' }), [], 'id', option),
    /版本/,
  )
  for (const [model, modelOption] of [
    ['banana-pro-api', undefined],
    ['model-api-key:45', { value: 'model-api-key:45', model: 'banana-pro', label: 'TT Image 2.5' }],
  ]) {
    const request = imageTaskRequest(
      imageNode(model, { version: 'sunburst' }),
      [],
      'id',
      modelOption,
    )
    assert.equal(Object.hasOwn(request, 'version'), false)
    assert.equal(request.model, model)
  }
})
