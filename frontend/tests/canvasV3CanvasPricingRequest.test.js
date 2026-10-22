import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCanvasPricingRequest } from '../src/features/canvas-v3/config/canvasPricingRequest.js'
import { createCanvasPricingClient } from '../src/features/canvas-v3/sync/canvasPricingClient.js'
import { imageTaskRequest } from '../src/features/canvas-v3/sync/imageTaskClient.js'

const route = (model, value = 'model-api-key:1') => ({ value, model, label: '可任意修改的名称' })
const ref = (id, kind, duration) => ({
  id,
  data: {
    kind,
    assetUrl: `https://assets.example/${id}`,
    ...(duration != null ? { mediaDuration: duration } : {}),
  },
})
const build = (model, extra = {}) => {
  const modelOption = route(model)
  return buildCanvasPricingRequest({
    kind: 'video',
    model: modelOption.value,
    modelOption,
    modelOptions: [modelOption],
    ...extra,
  })
}

test('pricing intent sends only documented scalars and aggregate actual metadata, never prompts or media URLs', () => {
  const result = build('wan3.0-video-quannengcankao', {
    params: {
      version: 'prime',
      duration: 'auto',
      audio: false,
      prompt_extend: true,
      apiKey: 'secret',
      price: 0,
      prompt: 'private text',
    },
    references: [
      ref('i1', 'image'),
      ref('v1', 'video', 5.5),
      ref('a1', 'audio', 3),
      ref('v1', 'video', 5.5),
    ],
  })
  assert.equal(result.message, '')
  assert.deepEqual(result.request, {
    kind: 'video',
    model: 'model-api-key:1',
    apiModel: 'wan3.0-video-quannengcankao',
    params: {
      version: 'prime',
      resolution: '720P',
      duration: 'auto',
      ratio: 'adaptive',
      audio: false,
      prompt_extend: true,
    },
    reference: {
      imageCount: 1,
      videoCount: 1,
      audioCount: 1,
      videoDurationSeconds: 5.5,
      audioDurationSeconds: 3,
    },
  })
  assert.doesNotMatch(JSON.stringify(result), /assets\.example|secret|private text|apiKey|"price"/)
})

test('legacy family intent resolves one configured route but never replaces a deleted opaque route', () => {
  const configured = route('wan3.0-video-quannengcankao', 'model-api-key:2')
  const legacy = buildCanvasPricingRequest({
    kind: 'video',
    model: '万相 3.0',
    modelOptions: [configured],
  })
  assert.equal(legacy.request.model, configured.value)
  const stale = buildCanvasPricingRequest({
    kind: 'video',
    model: 'model-api-key:deleted',
    modelOption: configured,
    modelOptions: [configured],
  })
  assert.equal(stale.request, null)
  assert.match(stale.message, /已失效/)
  const ambiguous = buildCanvasPricingRequest({
    kind: 'video',
    model: '万相 3.0',
    modelOptions: [configured, route(configured.model, 'model-api-key:3')],
  })
  assert.equal(ambiguous.request, null)
  assert.match(ambiguous.message, /多条线路/)
})

test('Kling mode picks the exact canonical mode contract and cannot borrow an unrelated labeled route', () => {
  const first = route('kling-v3-omni-shouweizhen', 'model-api-key:frames')
  const reference = route('kling-v3-omni-cankao', 'model-api-key:reference')
  const result = buildCanvasPricingRequest({
    kind: 'video',
    model: 'Kling 3.0',
    mode: '参考生',
    modelOptions: [first, reference],
    params: { mode: 'pro', duration: '15', seed: 10 },
  })
  assert.equal(result.request.model, reference.value)
  assert.equal(result.request.apiModel, reference.model)
  assert.deepEqual(result.request.params, { mode: 'pro', duration: '15', aspect_ratio: '16:9' })
  const missing = buildCanvasPricingRequest({
    kind: 'video',
    model: 'Kling 3.0',
    mode: '视频参考',
    modelOptions: [first, reference],
  })
  assert.equal(missing.request, null)
  assert.match(missing.message, /尚未配置/)
  const spoofed = buildCanvasPricingRequest({
    kind: 'video',
    model: 'model-api-key:fake',
    modelOption: { value: 'model-api-key:fake', model: 'unrelated', label: 'Kling 3.0' },
    modelOptions: [],
  })
  assert.equal(spoofed.request, null)
})

test('native video quotes match first-frame and reference input semantics without requiring a prompt', () => {
  const seedance = build('doubao-seedance-2-5-260628', {
    params: { ratio: '16:9', duration: 8, resolution: '1080P' },
    references: [ref('one', 'image')],
  })
  assert.equal(seedance.request.params.ratio, 'adaptive')
  assert.equal(seedance.request.params.duration, '8')
  assert.equal(seedance.request.params.resolution, '1080p')
  const anci = build('seedance-2.0-anci', { params: { duration: 15, version: '标准' } })
  assert.deepEqual(anci.request.params, {
    duration: '15',
    resolution: '720p',
    aspect_ratio: '16:9',
    mode: 'cankaosheng',
    version: '标准',
  })
  const h3 = build('minimax-h3', { references: [ref('one', 'image'), ref('two', 'image')] })
  assert.equal(h3.request.params.mode, 'shouweizhen')
  const multi = build('minimax-h3', { references: [ref('one', 'image'), ref('video', 'video', 6)] })
  assert.equal(multi.request.params.mode, 'cankaosheng')
  assert.equal(multi.request.reference.videoDurationSeconds, 6)
})

test('Kling preflight rejects generation-invalid material combinations without requiring a prompt', () => {
  const routes = [
    route('kling-v3-omni-videoref', 'model-api-key:video'),
    route('kling-v3-omni-cankao', 'model-api-key:reference'),
    route('kling-v3-omni-shouweizhen', 'model-api-key:frames'),
  ]
  const input = (mode, references = []) =>
    buildCanvasPricingRequest({
      kind: 'video',
      model: 'Kling 3.0',
      mode,
      references,
      modelOptions: routes,
    })
  assert.match(input('视频参考').message, /需连接 1 个参考视频/)
  assert.match(input('首尾帧').message, /需连接 1～2 张图片/)
  assert.match(input('参考生', [ref('video', 'video', 5)]).message, /不支持参考视频/)
  assert.match(input('参考生', [ref('audio', 'audio', 5)]).message, /不支持单独音频/)
  assert.match(
    input('首尾帧', [ref('one', 'image'), ref('two', 'image'), ref('three', 'image')]).message,
    /最多支持 2 张图片/,
  )
  assert.ok(input('参考生').request)
  assert.ok(input('首尾帧', [ref('one', 'image')]).request)
  assert.ok(input('视频参考', [ref('video', 'video', 5)]).request)
})

test('image quotes preserve actual wire quality/version/background/custom size and one task quantity', () => {
  const modelOption = route('tt-image-2.5')
  const result = buildCanvasPricingRequest({
    kind: 'image',
    model: modelOption.value,
    modelOption,
    modelOptions: [modelOption],
    params: {
      version: 'sunburst',
      quality: '高画质',
      background: '透明背景',
      count: '4张',
      customSize: '1536x864',
    },
    switches: { 自定义尺寸: true },
  })
  assert.deepEqual(result.request.params, {
    resolution: '2K',
    size: '16:9',
    count: 1,
    version: 'sunburst',
    quality: 'high',
    background: 'transparent',
    custom_size: '1536x864',
  })
  const banana = route('banana-2.1')
  const deep = buildCanvasPricingRequest({
    kind: 'image',
    model: banana.value,
    modelOption: banana,
    modelOptions: [banana],
    params: { thinkingLevel: '深度' },
    switches: { 联网搜索: false },
  })
  assert.deepEqual(deep.request.params, {
    resolution: '2K',
    size: '16:9',
    count: 1,
    thinking_level: 'high',
    web_search: false,
  })
})

test('explicit invalid scalar choices and unknown actual media durations do not request a quote', () => {
  for (const params of [
    { duration: 2.5 },
    { resolution: '4K' },
    { audio: 'yes' },
    { version: 'fast' },
  ]) {
    const result = build('wan3.0-video-quannengcankao', { params })
    assert.equal(result.request, null)
    assert.match(result.message, /参数无效/)
  }
  for (const kind of ['video', 'audio']) {
    const reference = ref('unknown', kind)
    reference.data.generation = { params: { duration: 5 } }
    const result = build('wan3.0-video-quannengcankao', { references: [reference] })
    assert.equal(result.request, null)
    assert.match(result.message, /实际时长/)
  }
  assert.equal(build('minimax-h3', { params: { duration: '5' } }).request, null)
})

test('image references mirror actual image_urls deduplication and ignore unused audio/video metadata', () => {
  const modelOption = route('banana-2.1')
  const first = ref('first', 'image')
  const duplicate = ref('other-node', 'image')
  duplicate.data.assetUrl = first.data.assetUrl
  const result = buildCanvasPricingRequest({
    kind: 'image',
    model: modelOption.value,
    modelOption,
    modelOptions: [modelOption],
    references: [
      first,
      duplicate,
      ref('video', 'video'),
      ref('audio', 'audio'),
      { data: { kind: 'image' } },
    ],
  })
  assert.equal(result.message, '')
  assert.deepEqual(result.request.reference, {
    imageCount: 1,
    videoCount: 0,
    audioCount: 0,
    videoDurationSeconds: 0,
    audioDurationSeconds: 0,
  })
  for (const model of ['banana-2.1', 'banana-pro', 'tt-image-2.5']) {
    const option = route(model)
    const input = {
      kind: 'image',
      model: option.value,
      modelOption: option,
      modelOptions: [option],
      references: Array.from({ length: 15 }, (_, index) => ref(index, 'image')),
    }
    const excess = buildCanvasPricingRequest(input)
    assert.equal(excess.request, null)
    assert.match(excess.message, /最多提交前 14 张/)
    const supported = buildCanvasPricingRequest({
      ...input,
      references: input.references.slice(0, 14),
    })
    assert.equal(supported.request.reference.imageCount, 14)
  }
})

test('image pricing wire roundtrip preserves request-level ratio versus custom size and native image settings', async () => {
  for (const scenario of [
    { model: 'tt-image-2.5', params: { ratio: '4:3', resolution: '2K' } },
    {
      model: 'tt-image-2.5',
      params: { ratio: '16:9', customSize: '1536x864' },
      switches: { 自定义尺寸: true },
    },
    {
      model: 'banana-2.1',
      params: { ratio: '9:16', resolution: '4K', thinkingLevel: '深度' },
      switches: { 联网搜索: false },
    },
  ]) {
    const modelOption = route(scenario.model)
    const node = {
      data: {
        kind: 'image',
        model: modelOption.value,
        prompt: 'Local adapter fixture only',
        params: scenario.params,
        switches: scenario.switches,
      },
    }
    const actual = imageTaskRequest(node, [], 'not-submitted', modelOption)
    const input = buildCanvasPricingRequest({
      ...node.data,
      modelOption,
      modelOptions: [modelOption],
    })
    assert.ok(input.request, input.message)
    const expected = { size: actual.size, resolution: actual.resolution, count: actual.n }
    for (const key of [
      'version',
      'quality',
      'background',
      'custom_size',
      'thinking_level',
      'web_search',
    ])
      if (Object.hasOwn(actual, key)) expected[key] = actual[key]
    let calls = 0
    const client = createCanvasPricingClient({
      fetcher: async (url, options) => {
        calls += 1
        assert.equal(url, '/api/canvas-pricing/estimate')
        const transmitted = JSON.parse(options.body)
        assert.deepEqual(transmitted.params, expected)
        assert.equal(transmitted.params.size, scenario.params.ratio)
        assert.equal(
          Object.hasOwn(transmitted.params, 'custom_size'),
          scenario.switches?.['自定义尺寸'] === true,
        )
        assert.doesNotMatch(options.body, /Local adapter fixture|not-submitted|image_urls|apiKey/)
        return {
          ok: true,
          status: 200,
          json: async () => ({ code: 0, data: { available: false, message: 'Fixture only' } }),
        }
      },
    })
    await client.estimate(input.request)
    assert.equal(calls, 1)
  }
})

test('price dependencies ignore unrelated prompt, label and URL changes without mutating drafts', () => {
  const params = { duration: 5, ratio: '16:9' }
  const references = [ref('i', 'image')]
  const before = structuredClone({ params, references })
  const first = build('minimax-h3', { params, references })
  const second = build('minimax-h3', {
    params: { ...params, prompt: 'other secret', unknown: true },
    references: [
      {
        ...references[0],
        data: { ...references[0].data, assetUrl: 'https://another.example/new', prompt: 'private' },
      },
    ],
  })
  assert.deepEqual(first, second)
  assert.deepEqual({ params, references }, before)
  assert.equal(buildCanvasPricingRequest({ kind: 'script' }).request, null)
})
