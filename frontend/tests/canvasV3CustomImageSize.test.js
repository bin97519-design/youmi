import test from 'node:test'
import assert from 'node:assert/strict'
import {
  imageCustomSize,
  imageModelControls,
  imageModelParams,
} from '../src/features/canvas-v3/config/imageModelParameters.js'
import { imageTaskRequest } from '../src/features/canvas-v3/sync/imageTaskClient.js'

const ttRoute = {
  value: 'model-api-key:81',
  model: 'tt-image-2.5',
  label: '任意显示名称',
  defaultVersion: 'sunburst',
}

function imageNode({ model = ttRoute.value, params = {}, enabled, switches = {} } = {}) {
  return {
    data: {
      kind: 'image',
      model,
      prompt: '专业商品展示图',
      params,
      switches: { ...switches, ...(enabled == null ? {} : { 自定义尺寸: enabled }) },
    },
  }
}

test('custom-size capability is TT-only and follows underlying model metadata', () => {
  for (const model of [
    'tt-image-2.5',
    'GPT-image2.5',
    'gpt-image2.5-sunburst-api',
    ttRoute,
    { value: 'banana-pro', model: 'tt-image-2.5', label: '香蕉专业版' },
  ]) {
    assert.equal(imageModelControls(model).customSize, true)
  }
  for (const model of [
    'banana-pro',
    'banana-2.1',
    'unknown-model',
    { value: 'model-api-key:82', label: 'tt-image-2.5' },
    { value: 'tt-image-2.5', model: 'banana-pro', label: 'image-2.5' },
  ]) {
    assert.notEqual(imageModelControls(model).customSize, true)
  }
})

test('TT normalization preserves raw custom size for explicit validation without changing saved data', () => {
  for (const customSize of ['auto', '1536x864', 'incorrect', '']) {
    const original = Object.freeze({ customSize, ratio: '3:4', resolution: '4K' })
    assert.equal(imageModelParams(ttRoute, original).customSize, customSize)
    assert.equal(original.customSize, customSize)
    for (const model of ['banana-pro', 'banana-2.1', 'unknown-model']) {
      assert.equal(Object.hasOwn(imageModelParams(model, original), 'customSize'), false)
    }
  }
  assert.equal(Object.hasOwn(imageModelParams(ttRoute, {}), 'customSize'), false)
})

test('custom size accepts auto, documented pixels, inclusive area and ratio boundaries', () => {
  for (const size of [
    'auto',
    '1536x864',
    '1024x640', // Exactly 655360 pixels.
    '3840x2160', // Exactly 8294400 pixels.
    '1536x512', // Exactly 3:1.
    '512x1536', // Exactly 1:3.
  ]) {
    assert.equal(imageCustomSize(size), size, size)
  }
  for (const [input, canonical] of [
    [' AUTO ', 'auto'],
    [' 1536X864 ', '1536x864'],
    ['001536x000864', '1536x864'],
  ]) {
    assert.equal(imageCustomSize(input), canonical)
  }
})

test('custom size rejects invalid strings, nonmultiples, unsupported ratios and pixel areas', () => {
  for (const size of [
    '',
    '1K',
    '2K',
    '4K',
    '16:9',
    '0x864',
    '1536x0',
    '-1536x864',
    '1536.5x864',
    '1537x864',
    '1536x863',
    '1008x640', // Less than 655360 pixels.
    '4096x2048', // More than 8294400 pixels.
    '1536x496', // Wider than 3:1.
    '496x1536', // Taller than 1:3.
    '1536x864x2',
    '1536×864',
    '1536 x 864',
    '1536x864<script>',
    '999999999999999999999999x864',
    undefined,
    null,
    1536,
  ]) {
    assert.throws(() => imageCustomSize(size), /尺寸|像素|宽高|16|比例/, String(size))
  }
})

test('enabled custom TT requests retain the selected real route and independent TT options', () => {
  for (const customSize of ['auto', '1536x864', '3840x2160']) {
    const current = imageNode({
      enabled: true,
      params: {
        customSize,
        ratio: '3:4',
        resolution: '4K',
        version: 'flare',
        quality: '极致画质',
        background: '透明背景',
      },
    })
    const request = imageTaskRequest(current, [], 'one-idempotency-key', ttRoute)
    assert.equal(request.custom_size, customSize)
    assert.equal(request.parameter_profile, 'canvas-v3-image')
    assert.equal(request.model, ttRoute.value)
    assert.equal(request.version, 'flare')
    assert.equal(request.quality, 'max')
    assert.equal(request.background, 'transparent')
    assert.equal(request.output_format, 'png')
    assert.equal(request.client_task_id, 'one-idempotency-key')
    assert.equal(request.n, 1)
    assert.equal(current.data.params.ratio, '3:4')
    assert.equal(current.data.params.resolution, '4K')
  }
})

test('custom-size fields are absent by default and inactive invalid saved input cannot block generation', () => {
  for (const enabled of [undefined, false, 'true', 1]) {
    const request = imageTaskRequest(
      imageNode({ enabled, params: { customSize: 'not-valid', ratio: '3:4', resolution: '4K' } }),
      [],
      'inactive',
      ttRoute,
    )
    assert.equal(Object.hasOwn(request, 'custom_size'), false)
    assert.equal(request.size, '3:4')
    assert.equal(request.resolution, '4K')
  }
  assert.equal(
    Object.hasOwn(imageTaskRequest(imageNode(), [], 'default', ttRoute), 'custom_size'),
    false,
  )
})

test('invalid enabled TT custom size fails locally instead of silently falling back', () => {
  for (const customSize of ['', '4K', '1537x864', '4096x2048']) {
    assert.throws(
      () =>
        imageTaskRequest(
          imageNode({ enabled: true, params: { customSize } }),
          [],
          'invalid',
          ttRoute,
        ),
      /尺寸|像素|宽高|16|比例/,
    )
  }
})

test('switching away from TT ignores even an active stale custom-size flag', () => {
  for (const model of ['banana-pro', 'banana-2.1', 'unknown-model']) {
    const option = { value: 'model-api-key:82', model, label: 'image-2.5' }
    const request = imageTaskRequest(
      imageNode({
        model: option.value,
        enabled: true,
        params: { customSize: 'not-valid', ratio: '3:4', resolution: '4K' },
      }),
      [],
      'non-tt',
      option,
    )
    assert.equal(Object.hasOwn(request, 'custom_size'), false, model)
    assert.equal(request.size, '3:4')
    assert.equal(request.resolution, '4K')
    assert.equal(Object.hasOwn(request, 'version'), false)
  }
})

test('custom-size mode preserves connected prompt and unique reference-image behavior', () => {
  const current = imageNode({ enabled: true, params: { customSize: '1536x864' } })
  const references = [
    { data: { kind: 'text', title: '要求', prompt: '保留商品外形' } },
    { data: { kind: 'image', assetUrl: 'https://example.com/ref.png' } },
    { data: { kind: 'image', assetUrl: 'https://example.com/ref.png' } },
    { data: { kind: 'video', assetUrl: 'https://example.com/not-an-image.mp4' } },
  ]
  const request = imageTaskRequest(current, references, 'stable-id', ttRoute)
  assert.equal(request.custom_size, '1536x864')
  assert.equal(request.prompt, '专业商品展示图\n\n要求：\n保留商品外形')
  assert.deepEqual(request.image_urls, ['https://example.com/ref.png'])
  assert.equal(current.data.switches.自定义尺寸, true)
})
