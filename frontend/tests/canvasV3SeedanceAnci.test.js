import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createPinia, setActivePinia } from 'pinia'
import {
  SEEDANCE20_ANCI_MODEL,
  SEEDANCE25_MODEL,
  isSeedance20AnciModel,
  isSeedance25Model,
  videoModelControls,
  videoModelParams,
} from '../src/features/canvas-v3/config/videoModelParameters.js'
import { deriveVideoInputMode } from '../src/features/canvas-v3/config/videoInputMode.js'
import { videoTaskRequest } from '../src/features/canvas-v3/sync/videoTaskClient.js'

const route = (value = 'feature-route:anci:1') => ({
  value,
  model: SEEDANCE20_ANCI_MODEL,
  label: '独立的按次线路',
})
const node = (params = {}, extra = {}) => ({
  data: {
    kind: 'video',
    model: SEEDANCE20_ANCI_MODEL,
    prompt: '参考角色在海边漫步，镜头跟随',
    mode: '首尾帧',
    params: { ratio: '16:9', resolution: '720P', duration: 5, version: '快速', ...params },
    switches: { 联网搜索: true, 生成音频: false },
    ...extra,
  },
})
const asset = (kind, index = 0, url = `https://media.example.test/${kind}-${index}.png`) => ({
  id: `${kind}-${index}`,
  data: { kind, assetUrl: url, mediaDuration: 5 },
})

test('per-call identity is exact and independent of native Seedance 2.5, Mini, or editable labels', () => {
  for (const model of [SEEDANCE20_ANCI_MODEL, 'SEEDANCE-2.0-ANCI', route()])
    assert.equal(isSeedance20AnciModel(model), true)
  for (const model of [
    SEEDANCE25_MODEL,
    'seedance-2.0-mini',
    'seedance-2.0-fast',
    'seedance-2.0',
    { value: 'other-model', label: 'Seedance 2.0 按次' },
  ])
    assert.equal(isSeedance20AnciModel(model), false)
  assert.equal(isSeedance25Model(SEEDANCE20_ANCI_MODEL), false)
})

test('per-call controls contain exactly the documented enums without quantity, adaptive or search switches', () => {
  const controls = videoModelControls(SEEDANCE20_ANCI_MODEL)
  assert.deepEqual(controls.defaults, {
    ratio: '16:9',
    resolution: '720P',
    duration: 5,
    version: '快速',
  })
  assert.deepEqual(controls.fields, {
    ratio: ['比例', ['16:9', '9:16', '1:1', '4:3', '3:4']],
    resolution: ['清晰度', ['720P']],
    duration: ['视频时长', [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]],
    version: ['速度版本', ['快速', '标准']],
  })
  assert.deepEqual(controls.switches, [])
  assert.deepEqual(controls.modes, ['文生视频', '图片参考'])
  for (const mode of ['文生视频', '图片参考', '图生视频', '首尾帧'])
    assert.deepEqual(videoModelControls(route(), mode).fields, controls.fields)
})

test('UI normalization keeps per-call version but removes stale parameters from other video models', () => {
  const stale = {
    ratio: 'Auto',
    resolution: '4K',
    duration: 30,
    version: 'flare',
    count: '4个',
    audio: false,
  }
  assert.deepEqual(videoModelParams(route(), stale), videoModelControls(route()).defaults)
  assert.deepEqual(
    videoModelParams(route(), { ratio: '9:16', resolution: '720p', duration: 15, version: '标准' }),
    { ratio: '9:16', resolution: '720P', duration: 15, version: '标准' },
  )
  assert.equal(stale.count, '4个')
  assert.equal(videoModelParams(SEEDANCE25_MODEL, { version: '标准' }).version, undefined)
})

test('zero through nine images select text or references only, even one/two images and stale first/last modes', () => {
  for (let count = 0; count <= 9; count++) {
    const references = Array.from({ length: count }, (_, index) => asset('image', index))
    const input = deriveVideoInputMode(route(), references)
    assert.equal(input.error, '')
    assert.equal(input.supported, true)
    assert.equal(input.frames, false)
    assert.equal(input.id, count ? 'reference-image' : 'text')
    assert.equal(input.mode, count ? '图片参考' : '文生视频')
    assert.deepEqual(input.limits, { image: 9, video: 0, audio: 0 })
    const request = videoTaskRequest(node(), references, 'stable-anci-key')
    assert.equal(request.mode, 'cankaosheng')
    assert.deepEqual(
      request.reference_image_urls,
      references.map((ref) => ref.data.assetUrl),
    )
    assert.equal(Object.hasOwn(request, 'first_frame_url'), false)
    assert.equal(Object.hasOwn(request, 'last_frame_url'), false)
    assert.equal(request.ratio, '16:9')
  }
})

test('routed per-call wire preserves its selected route and only sends documented request fields', () => {
  const request = videoTaskRequest(
    node(
      { ratio: '3:4', resolution: '720p', duration: 15, version: '标准', count: '9个' },
      {
        model: route().value,
      },
    ),
    [asset('image', 0), asset('image', 1)],
    'durable-client-key',
    route(),
  )
  assert.deepEqual(request, {
    model: route().value,
    prompt: '参考角色在海边漫步，镜头跟随',
    parameter_profile: 'canvas-v3-seedance20-anci',
    ratio: '3:4',
    durationSeconds: 15,
    resolution: '720p',
    reference_image_urls: [asset('image', 0).data.assetUrl, asset('image', 1).data.assetUrl],
    reference_videos: [],
    reference_audios: [],
    mode: 'cankaosheng',
    version: '标准',
    client_task_id: 'durable-client-key',
    feature_code: 'canvas-video',
  })
  for (const key of [
    'n',
    'count',
    'generate_audio',
    'web_search',
    'first_frame_url',
    'last_frame_url',
  ])
    assert.equal(Object.hasOwn(request, key), false)
})

test('both speeds, all twelve integer durations and all five ratios preserve the requested values', () => {
  for (const version of ['快速', '标准'])
    for (let duration = 4; duration <= 15; duration++)
      for (const ratio of ['16:9', '9:16', '1:1', '4:3', '3:4']) {
        const request = videoTaskRequest(node({ version, duration, ratio }), [], 'enum-key')
        assert.equal(request.version, version)
        assert.equal(request.durationSeconds, duration)
        assert.equal(request.ratio, ratio)
        assert.equal(request.resolution, '720p')
      }
})

test('invalid enum values, missing prompt and unsupported media are rejected before any task submission', () => {
  for (const params of [
    { duration: 3 },
    { duration: 16 },
    { duration: 5.5 },
    { duration: '5' },
    { resolution: '1080P' },
    { resolution: '768P' },
    { ratio: 'Auto' },
    { ratio: 'adaptive' },
    { ratio: '21:9' },
    { version: 'fast' },
    { version: 'standard' },
  ])
    assert.throws(() => videoTaskRequest(node(params), [], 'bad'))
  assert.throws(
    () => videoTaskRequest(node({}, { prompt: ' ' }), [asset('image')], 'no-prompt'),
    /提示词/,
  )
  assert.match(
    videoTaskRequest(
      node({}, { prompt: '' }),
      [{ data: { kind: 'text', prompt: '从文本节点取提示词' } }],
      'text',
    ).prompt,
    /从文本节点取提示词/,
  )
  for (const refs of [
    Array.from({ length: 10 }, (_, index) => asset('image', index)),
    [asset('audio')],
    [asset('video')],
    [asset('image'), asset('audio')],
    [asset('image', 0, '')],
    [asset('image', 0, 'blob:unfinished')],
    [asset('image', 0, 'https://user:pass@media.example.test/a.png')],
  ]) {
    assert.ok(deriveVideoInputMode(route(), refs).error)
    assert.throws(() => videoTaskRequest(node(), refs, 'bad-media'))
  }
})

test('per-call input deduplicates edges, not different image nodes, and keeps inline images for upload', () => {
  const first = asset('image', 0)
  const second = asset('image', 1, first.data.assetUrl)
  const inline = asset('image', 2, 'data:image/png;base64,iVBORw0KGgo=')
  const request = videoTaskRequest(node(), [first, first, second, inline], 'upload-next')
  assert.deepEqual(request.reference_image_urls, [
    first.data.assetUrl,
    first.data.assetUrl,
    inline.data.assetUrl,
  ])
})

test('the actual task store loads per-call routes and persists the speed with immutable inputs before POST', async (t) => {
  const originalFetch = globalThis.fetch
  const posts = []
  const order = []
  let releaseModels
  const modelResponse = new Promise((resolve) => (releaseModels = resolve))
  const ok = (data) => new Response(JSON.stringify({ code: 0, data }), { status: 200 })
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/api/video-tasks/canvas-models')) return modelResponse
    if (String(url).endsWith('/api/image-tasks/canvas-models'))
      return ok({ mappingConfigured: true, options: [] })
    if (String(url).endsWith('/api/video-tasks') && options.method === 'POST') {
      order.push('post')
      posts.push(JSON.parse(options.body))
      return ok({ taskId: 'seedance-2.0-anci:key:1:123456', status: 'queued' })
    }
    throw new Error(`Unexpected isolated request: ${url}`)
  }
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
    logLevel: 'silent',
  })
  const scope = {}
  t.after(async () => {
    scope.tasks?.detach(scope.graph.projectId)
    globalThis.fetch = originalFetch
    await server.close()
  })
  const { useCanvasV3GraphStore } = await server.ssrLoadModule(
    '/src/features/canvas-v3/stores/graph.js',
  )
  const { useCanvasV3TaskStore } = await server.ssrLoadModule(
    '/src/features/canvas-v3/stores/tasks.js',
  )
  const { useUserStore } = await server.ssrLoadModule('/src/stores/user.js')
  setActivePinia(createPinia())
  const graph = useCanvasV3GraphStore()
  scope.graph = graph
  graph.hydrate({ projectId: 'anci-isolated-project', nodes: [], edges: [] })
  const user = useUserStore()
  user.isAuthenticated = true
  user.token = 'test-only-token'
  const target = graph.addNode('video')
  graph.updateNodeData(target.id, node({ version: '标准', duration: 15, ratio: '9:16' }).data)
  const refs = [graph.addNode('image'), graph.addNode('image')]
  refs.forEach((ref, index) => {
    graph.updateNodeData(ref.id, { assetUrl: asset('image', index).data.assetUrl })
    graph.connect({ source: ref.id, target: target.id })
  })
  const tasks = useCanvasV3TaskStore()
  scope.tasks = tasks
  tasks.attach(graph.projectId, {
    beforeImageSubmit({ kind, clientTaskId }) {
      assert.equal(kind, 'video')
      assert.equal(target.data.generation.clientTaskId, clientTaskId)
      assert.equal(target.data.generation.params.version, '标准')
      assert.equal(target.data.generation.inputMode, 'reference-image')
      assert.equal(target.data.generation.taskIds.length, 0)
      order.push('persist')
      return true
    },
  })
  const run = tasks.runVideo(target.id)
  target.data.params.version = '快速'
  target.data.params.duration = 4
  graph.updateNodeData(refs[0].id, { assetUrl: 'https://media.example.test/later-edit.png' })
  releaseModels(ok([route()]))
  await run
  assert.equal(posts.length, 1, target.data.error)
  assert.deepEqual(order, ['persist', 'post'])
  assert.equal(posts[0].model, route().value)
  assert.equal(posts[0].version, '标准')
  assert.equal(posts[0].durationSeconds, 15)
  assert.equal(posts[0].first_frame_url, undefined)
  assert.deepEqual(posts[0].reference_image_urls, [
    asset('image', 0).data.assetUrl,
    asset('image', 1).data.assetUrl,
  ])
  assert.equal(target.data.generation.params.version, '标准')
  assert.equal(target.data.generation.mode, '图片参考')
  assert.equal(target.data.runState, 'queued')
  const persisted = JSON.parse(JSON.stringify(target.data.generation))
  assert.equal(persisted.params.version, '标准')
})
