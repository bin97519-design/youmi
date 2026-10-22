import test from 'node:test'
import assert from 'node:assert/strict'
import {
  imageModelControls,
  imageModelParams,
} from '../src/features/canvas-v3/config/imageModelParameters.js'
import { imageTaskRequest } from '../src/features/canvas-v3/sync/imageTaskClient.js'

const bananaRatios = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
const ttRatios = [
  '1:1',
  '1:2',
  '2:1',
  '9:16',
  '16:9',
  '3:4',
  '4:3',
  '3:2',
  '2:3',
  '5:4',
  '4:5',
  '21:9',
  '9:21',
]

function imageNode(model, params = {}, switches = {}) {
  return {
    data: { kind: 'image', model, prompt: '一张专业商品展示图', params, switches },
  }
}

function configured(model, value = 'model-api-key:81', label = '任意显示名称') {
  return { model, value, label }
}

test('TT image output fields and enums match the documented TT-specific choices', () => {
  const profile = imageModelControls('tt-image-2.5')
  assert.equal(profile.id, 'tt-image-2.5')
  assert.deepEqual(Object.keys(profile.fields), [
    'quality',
    'resolution',
    'background',
    'ratio',
    'count',
  ])
  assert.deepEqual(profile.fields.quality, [
    '画质',
    ['低画质', '标准画质', '高画质', '超高画质', '极致画质'],
  ])
  assert.deepEqual(profile.fields.resolution, ['清晰度', ['1K', '2K', '4K']])
  assert.deepEqual(profile.fields.background, ['背景', ['自动', '保留背景', '透明背景']])
  assert.deepEqual(profile.fields.ratio, ['比例', ttRatios])
  assert.deepEqual(profile.fields.count, ['生成数量', ['1张']])
  assert.equal(profile.defaults.version, 'flare')
  assert.equal(profile.webSearch, false)
})

test('Banana Pro exposes only resolution, ten supported ratios, and one image', () => {
  for (const model of ['banana-pro', 'banana-pro-api', 'bananapro', 'gemini-3-pro-image-preview']) {
    const profile = imageModelControls(model)
    assert.equal(profile.id, 'banana-pro', model)
    assert.deepEqual(Object.keys(profile.fields), ['resolution', 'ratio', 'count'])
    assert.deepEqual(profile.fields.resolution, ['清晰度', ['1K', '2K', '4K']])
    assert.deepEqual(profile.fields.ratio, ['比例', bananaRatios])
    assert.deepEqual(profile.fields.count, ['生成数量', ['1张']])
    assert.deepEqual(profile.defaults, { resolution: '2K', ratio: '16:9', count: '1张' })
    assert.equal(profile.webSearch, false)
  }
})

test('Banana 2.1 has two thinking levels, fourteen ratios, and its own search capability', () => {
  for (const model of ['banana-2.1', 'banana21', 'banana_2.1']) {
    const profile = imageModelControls(model)
    assert.equal(profile.id, 'banana-2.1', model)
    assert.deepEqual(Object.keys(profile.fields), ['resolution', 'thinkingLevel', 'ratio', 'count'])
    assert.deepEqual(profile.fields.thinkingLevel, ['思考等级', ['快速', '深度']])
    assert.deepEqual(profile.fields.resolution, ['清晰度', ['1K', '2K', '4K']])
    assert.deepEqual(profile.fields.ratio, ['比例', [...bananaRatios, '1:4', '4:1', '1:8', '8:1']])
    assert.deepEqual(profile.fields.count, ['生成数量', ['1张']])
    assert.equal(profile.defaults.thinkingLevel, '快速')
    assert.equal(profile.webSearch, true)
  }
})

test('authoritative underlying model metadata determines controls, never editable labels or route IDs', () => {
  assert.equal(
    imageModelControls(configured('banana-pro', 'tt-image-2.5', 'TT 增强版')).id,
    'banana-pro',
  )
  assert.equal(
    imageModelControls(configured('tt-image-2.5', 'banana-pro', '香蕉专业版')).id,
    'tt-image-2.5',
  )
  assert.equal(
    imageModelControls(configured('banana-2.1', 'model-api-key:44', 'image-2.5')).id,
    'banana-2.1',
  )
  const unknown = imageModelControls({ value: 'model-api-key:99', label: 'tt-image-2.5 sunburst' })
  assert.equal(unknown.id, 'generic')
  assert.deepEqual(Object.keys(unknown.fields), ['resolution', 'ratio', 'count'])
  assert.equal(unknown.webSearch, false)
})

test('switch normalization retains compatible choices, drops unrelated controls, and resets unsupported choices', () => {
  const original = Object.freeze({
    version: 'sunburst',
    quality: '极致画质',
    background: '透明背景',
    ratio: '3:4',
    resolution: '4K',
    count: '4张',
    thinkingLevel: '深度',
    duration: 10,
  })
  assert.deepEqual(imageModelParams('banana-pro', original), {
    resolution: '4K',
    ratio: '3:4',
    count: '1张',
  })
  assert.deepEqual(
    imageModelParams('banana-pro', {
      ...original,
      ratio: '8:1',
      resolution: '720P',
    }),
    { resolution: '2K', ratio: '16:9', count: '1张' },
  )
  assert.deepEqual(imageModelParams('banana-2.1', original), {
    resolution: '4K',
    ratio: '3:4',
    count: '1张',
    thinkingLevel: '深度',
  })
  assert.equal(original.version, 'sunburst')
  assert.equal(original.count, '4张')
})

test('normalizer understands API enum aliases while presenting the actual localized choices', () => {
  assert.deepEqual(
    imageModelParams('tt-image-2.5', {
      version: 'sunburst',
      quality: 'max',
      background: 'transparent',
      resolution: '4K',
      ratio: '3:4',
      count: '1张',
    }),
    {
      resolution: '4K',
      ratio: '3:4',
      count: '1张',
      version: 'sunburst',
      quality: '极致画质',
      background: '透明背景',
    },
  )
  for (const [wire, label] of [
    ['minimal', '快速'],
    ['high', '深度'],
  ]) {
    assert.equal(imageModelParams('banana-2.1', { thinkingLevel: wire }).thinkingLevel, label)
  }
})

test('Banana 2.1 requests serialize each thinking and search choice with the V3-only marker', () => {
  const option = configured('banana-2.1')
  for (const [choice, wireValue] of [
    ['快速', 'minimal'],
    ['深度', 'high'],
    ['minimal', 'minimal'],
    ['high', 'high'],
  ]) {
    for (const webSearch of [true, false]) {
      const request = imageTaskRequest(
        imageNode(
          option.value,
          {
            thinkingLevel: choice,
            ratio: '8:1',
            resolution: '4K',
            count: '4张',
            version: 'sunburst',
            quality: '极致画质',
            background: '透明背景',
          },
          { 联网搜索: webSearch },
        ),
        [],
        'one-idempotency-key',
        option,
      )
      assert.equal(request.model, option.value)
      assert.equal(request.thinking_level, wireValue)
      assert.equal(request.web_search, webSearch)
      assert.equal(request.size, '8:1')
      assert.equal(request.resolution, '4K')
      assert.equal(request.n, 1)
      assert.equal(request.parameter_profile, 'canvas-v3-image')
      assert.equal(request.client_task_id, 'one-idempotency-key')
      assert.equal(request.feature_code, 'canvas-image')
      for (const key of ['version', 'quality', 'background', 'output_format']) {
        assert.equal(Object.hasOwn(request, key), false, `Banana 2.1 must not send ${key}`)
      }
    }
  }
  const defaultRequest = imageTaskRequest(imageNode(option.value), [], 'default', option)
  assert.equal(defaultRequest.thinking_level, 'minimal')
  assert.equal(defaultRequest.web_search, true)
  assert.throws(
    () =>
      imageTaskRequest(
        imageNode(option.value, {
          thinkingLevel: 'unsupported',
        }),
        [],
        'invalid',
        option,
      ),
    /思考/,
  )
})

test('Banana Pro payloads never inherit TT or Banana 2.1-only parameters and preserve the configured route', () => {
  const option = configured('banana-pro', 'model-api-key:82', 'image-2.5 高质')
  const request = imageTaskRequest(
    imageNode(
      option.value,
      {
        version: 'sunburst',
        quality: '极致画质',
        background: '透明背景',
        thinkingLevel: '深度',
        resolution: '4K',
        ratio: '9:16',
        count: '4张',
      },
      { 联网搜索: true },
    ),
    [],
    'pro-id',
    option,
  )
  assert.equal(request.model, option.value)
  assert.equal(request.parameter_profile, 'canvas-v3-image')
  assert.equal(request.size, '9:16')
  assert.equal(request.resolution, '4K')
  assert.equal(request.n, 1)
  for (const key of [
    'version',
    'quality',
    'background',
    'output_format',
    'thinking_level',
    'web_search',
  ]) {
    assert.equal(Object.hasOwn(request, key), false, `Banana Pro must not send ${key}`)
  }
})

test('fourteen reference images survive unchanged and repeated URLs are deduplicated', () => {
  const option = configured('banana-pro')
  const references = Array.from({ length: 14 }, (_, index) => ({
    data: { kind: 'image', assetUrl: `https://example.com/ref-${index}.png` },
  }))
  const request = imageTaskRequest(
    imageNode(option.value),
    [...references, references[0], references[13]],
    'fourteen-refs',
    option,
  )
  assert.deepEqual(
    request.image_urls,
    references.map((reference) => reference.data.assetUrl),
  )
})
