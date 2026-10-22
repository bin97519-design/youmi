import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createPinia, setActivePinia } from 'pinia'
import {
  createVideoTaskClient,
  videoTaskRequest,
  videoTaskResult,
} from '../src/features/canvas-v3/sync/videoTaskClient.js'
import {
  MINIMAX_H3_MODEL,
  SEEDANCE25_MODEL,
} from '../src/features/canvas-v3/config/videoModelParameters.js'
import { WANXIANG_MODEL } from '../src/features/canvas-v3/config/wanxiangParameters.js'

const flush = () => new Promise((resolve) => setImmediate(resolve))
const response = (data) => ({ ok: true, status: 200, json: async () => ({ code: 0, data }) })
const route = (value = 'model-api-key:25', model = SEEDANCE25_MODEL) => ({
  value,
  model,
  label: model,
})
const videoNode = (model = SEEDANCE25_MODEL, extra = {}) => ({
  id: 'video-1',
  data: {
    kind: 'video',
    model,
    prompt: '清晨海边，金毛犬奔向浪花',
    params: {
      ratio: '16:9',
      resolution: model === MINIMAX_H3_MODEL ? '768P' : '720P',
      duration: 8,
      count: '1个',
    },
    ...extra,
  },
})
const asset = (kind, url, extra = {}) => ({
  id: `${kind}-${url}`,
  data: { kind, assetUrl: url, ...extra },
})

test('Seedance 2.5 wire uses the native profile, lowercase resolution and exact video fields', () => {
  const result = videoTaskRequest(
    videoNode('model-api-key:25', {
      switches: { 联网搜索: true, 生成音频: false },
      params: {
        ratio: '3:4',
        resolution: '1080P',
        duration: 30,
        count: '1个',
        quality: 'high',
        version: 'flare',
      },
    }),
    [],
    'stable-key',
    route(),
  )
  assert.deepEqual(result, {
    model: 'model-api-key:25',
    prompt: '清晨海边，金毛犬奔向浪花',
    parameter_profile: 'canvas-v3-seedance25',
    ratio: '3:4',
    resolution: '1080p',
    durationSeconds: 30,
    reference_image_urls: [],
    reference_videos: [],
    reference_audios: [],
    web_search: true,
    client_task_id: 'stable-key',
    feature_code: 'canvas-video',
  })
  for (const key of [
    'quality',
    'version',
    'n',
    'count',
    'generate_audio',
    'image_urls',
    'background',
  ])
    assert.equal(Object.hasOwn(result, key), false, key)
})

test('Seedance frame inputs preserve paired-frame ratios and restrict only single-image first frames', () => {
  const images = [
    asset('image', 'https://example.test/first.png'),
    asset('image', 'https://example.test/last.png'),
  ]
  const input = videoNode(SEEDANCE25_MODEL, {
    mode: '首尾帧',
    params: { ratio: 'Auto', resolution: '480P', duration: 4, count: '1个' },
  })
  const result = videoTaskRequest(input, images, 'frame-key')
  assert.equal(result.first_frame_url, images[0].data.assetUrl)
  assert.equal(result.last_frame_url, images[1].data.assetUrl)
  assert.equal(result.ratio, 'adaptive')
  assert.deepEqual(result.reference_image_urls, [])
  assert.equal(
    videoTaskRequest(
      { data: { ...input.data, params: { ...input.data.params, ratio: '16:9' } } },
      images,
      'auto',
    ).ratio,
    '16:9',
  )
  assert.equal(
    videoTaskRequest(input, images.slice(0, 1), 'one').first_frame_url,
    images[0].data.assetUrl,
  )
  const first = videoTaskRequest(
    { data: { ...input.data, mode: '图生视频' } },
    images.slice(0, 1),
    'first',
  )
  assert.equal(first.first_frame_url, images[0].data.assetUrl)
  assert.equal(Object.hasOwn(first, 'last_frame_url'), false)
})

test('Seedance full-reference input preserves video durations, audio URLs and deduplicated images', () => {
  const input = videoNode(SEEDANCE25_MODEL, { mode: '全能参考', switches: { 联网搜索: false } })
  const image = asset('image', 'https://example.test/product.png')
  const refs = [
    image,
    image,
    asset('video', 'https://example.test/motion.mp4', { mediaDuration: 6 }),
    asset('audio', 'https://example.test/beat.mp3'),
    { data: { kind: 'script', title: '镜头说明', prompt: '平稳推进' } },
  ]
  const result = videoTaskRequest(input, refs, 'omni')
  assert.deepEqual(result.reference_image_urls, [image.data.assetUrl])
  assert.deepEqual(result.reference_videos, [
    { url: 'https://example.test/motion.mp4', durationSeconds: 6 },
  ])
  assert.deepEqual(result.reference_audios, ['https://example.test/beat.mp3'])
  assert.match(result.prompt, /镜头说明：\n平稳推进/)
  assert.equal(result.web_search, false)
})

test('MiniMax H3 uses its own mode enum and uppercase resolution without Seedance search controls', () => {
  const input = videoNode('model-api-key:83', {
    mode: '参考生',
    params: { ratio: 'Auto', resolution: '4K', duration: 15, count: '1个' },
    switches: { 联网搜索: true },
  })
  const result = videoTaskRequest(
    input,
    [
      asset('image', 'https://example.test/ref.png'),
      asset('video', 'https://example.test/v.mp4', { mediaDuration: 5 }),
      asset('audio', 'https://example.test/a.mp3'),
    ],
    'h3-key',
    route('model-api-key:83', 'MiniMax-H3'),
  )
  assert.equal(result.model, 'model-api-key:83')
  assert.equal(result.parameter_profile, 'canvas-v3-minimax-h3')
  assert.equal(result.mode, 'cankaosheng')
  assert.equal(result.resolution, '4K')
  assert.equal(result.durationSeconds, 15)
  assert.equal(result.ratio, 'adaptive')
  assert.equal(Object.hasOwn(result, 'web_search'), false)
  const frames = videoTaskRequest(
    videoNode(MINIMAX_H3_MODEL, { mode: '首尾帧' }),
    [
      asset('image', 'https://example.test/first.png'),
      asset('image', 'https://example.test/last.png'),
    ],
    'h3-frame',
  )
  assert.equal(frames.mode, 'shouweizhen')
  assert.equal(frames.first_frame_url, 'https://example.test/first.png')
  assert.equal(frames.last_frame_url, 'https://example.test/last.png')
  assert.equal(
    frames.ratio,
    '16:9',
    'the H3 media protocol retains the selected frame aspect ratio',
  )
  assert.equal(
    videoTaskRequest(videoNode(MINIMAX_H3_MODEL, { mode: '首尾帧' }), [], 'h3-text').mode,
    'shouweizhen',
  )
})

test('raw unsupported parameters are rejected before any wire request can be created', () => {
  for (const [model, params, message] of [
    [SEEDANCE25_MODEL, { resolution: '4K' }, /不支持所选清晰度/],
    [SEEDANCE25_MODEL, { duration: 31 }, /4～30/],
    [SEEDANCE25_MODEL, { duration: 5.5 }, /整数秒/],
    [MINIMAX_H3_MODEL, { duration: 16 }, /4～15/],
    [MINIMAX_H3_MODEL, { resolution: '720P' }, /不支持所选清晰度/],
    [SEEDANCE25_MODEL, { ratio: '1:8' }, /有效的视频比例/],
  ]) {
    const input = videoNode(model)
    input.data.params = { ...input.data.params, ...params }
    assert.throws(() => videoTaskRequest(input, [], 'bad'), message)
  }
  assert.throws(() => videoTaskRequest(videoNode('minimax'), [], 'bad'), /尚未接入/)
})

test('only Seedance can omit prompt with usable media and saved manual mode never overrides actual inputs', () => {
  const ref = asset('image', 'https://example.test/ref.png')
  assert.equal(
    videoTaskRequest(
      videoNode(SEEDANCE25_MODEL, { prompt: '', mode: '图片参考' }),
      [ref],
      'media-only',
    ).prompt,
    '',
  )
  assert.throws(
    () => videoTaskRequest(videoNode(SEEDANCE25_MODEL, { prompt: '' }), [], 'bad'),
    /请输入视频提示词/,
  )
  assert.throws(
    () =>
      videoTaskRequest(videoNode(MINIMAX_H3_MODEL, { prompt: '', mode: '参考生' }), [ref], 'bad'),
    /请输入视频提示词/,
  )
  assert.equal(
    videoTaskRequest(videoNode(SEEDANCE25_MODEL), [ref], 'auto-frame').first_frame_url,
    ref.data.assetUrl,
  )
  assert.deepEqual(
    videoTaskRequest(
      videoNode(SEEDANCE25_MODEL, { mode: '图片参考' }),
      [asset('audio', 'https://example.test/a.mp3')],
      'auto-audio',
    ).reference_audios,
    ['https://example.test/a.mp3'],
  )
  assert.throws(
    () =>
      videoTaskRequest(
        videoNode(SEEDANCE25_MODEL, { mode: '全能参考' }),
        [asset('video', '')],
        'bad',
      ),
    /尚未就绪/,
  )
  assert.throws(
    () =>
      videoTaskRequest(
        videoNode(MINIMAX_H3_MODEL, { mode: '参考生' }),
        [asset('audio', 'blob:local')],
        'bad',
      ),
    /HTTP\(S\)/,
  )
})

test('reference count limits do not silently truncate either model family', () => {
  for (const [model, kind, maximum] of [
    [SEEDANCE25_MODEL, 'image', 30],
    [SEEDANCE25_MODEL, 'video', 10],
    [SEEDANCE25_MODEL, 'audio', 10],
    [MINIMAX_H3_MODEL, 'image', 9],
    [MINIMAX_H3_MODEL, 'video', 3],
    [MINIMAX_H3_MODEL, 'audio', 3],
  ]) {
    const refs = Array.from({ length: maximum + 1 }, (_, i) =>
      asset(kind, `https://example.test/${kind}-${i}`, { mediaDuration: 4 }),
    )
    assert.throws(
      () =>
        videoTaskRequest(
          videoNode(model, { mode: model === MINIMAX_H3_MODEL ? '参考生' : '全能参考' }),
          refs,
          'too-many',
        ),
      /最多支持/,
    )
  }
})

test('video result normalization requires an actual video URL and preserves persistence and failure states', () => {
  assert.equal(videoTaskResult({ status: 'completed', videoUrls: [] }).state, 'running')
  assert.deepEqual(
    videoTaskResult({ status: 'completed', videoUrls: ['https://example.test/v.mp4'] }).urls,
    ['https://example.test/v.mp4'],
  )
  assert.equal(
    videoTaskResult({ status: 'persisting', videoUrls: [], stage: '正在保存' }).persistPending,
    true,
  )
  assert.equal(videoTaskResult({ status: 'failed', error: '被拒绝' }).error, '被拒绝')
  assert.equal(videoTaskResult({ status: 'failed' }).state, 'failed')
})

test('video transport keeps create outcomes uncertain and resolves only the original client task key', async () => {
  const calls = []
  const client = createVideoTaskClient({
    fetcher: async (url, options) => {
      calls.push({ url, method: options.method || 'GET', headers: options.headers })
      if (options.method === 'POST') throw new TypeError('connection reset')
      return response({ exists: true, taskId: 'anmiao-video:25:99936297' })
    },
    headers: () => ({ Authorization: 'Bearer test-only' }),
  })
  await assert.rejects(
    client.create({ client_task_id: 'key:one' }),
    (error) => error.deliveryUnknown === true,
  )
  assert.equal((await client.resolve('key:one')).taskId, 'anmiao-video:25:99936297')
  await client.get('anmiao-video:25:99936297')
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1)
  assert.equal(calls[1].url, '/api/video-tasks/by-client-task-id?client_task_id=key%3Aone')
  assert.equal(calls[2].url, '/api/video-tasks/anmiao-video%3A25%3A99936297')
  assert.ok(calls.every((call) => call.headers.Authorization === 'Bearer test-only'))
})

test('video create distinguishes explicit rejection from ambiguous HTTP or malformed receipts', async () => {
  for (const mock of [
    { ok: false, status: 503, json: async () => ({ message: 'unavailable' }) },
    { ok: false, status: 409, json: async () => ({ message: 'already submitting' }) },
    { ok: true, status: 200, json: async () => null },
  ]) {
    const client = createVideoTaskClient({ fetcher: async () => mock })
    await assert.rejects(client.create({}), (error) => error.deliveryUnknown === true)
  }
  const rejected = createVideoTaskClient({
    fetcher: async () => ({
      ok: false,
      status: 400,
      json: async () => ({ code: 400, message: 'bad duration' }),
    }),
  })
  await assert.rejects(
    rejected.create({}),
    (error) => error.deliveryUnknown === false && error.message === 'bad duration',
  )
  const safe = createVideoTaskClient({
    fetcher: async () => ({
      ok: false,
      status: 503,
      json: async () => ({ retry_safe: true, message: 'not dispatched' }),
    }),
  })
  await assert.rejects(safe.create({}), (error) => error.deliveryUnknown === false)
})

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

async function harness(
  t,
  {
    model = SEEDANCE25_MODEL,
    mode = '文生视频',
    params = {},
    catalog = [route()],
    delayModels = false,
    delayCreate = false,
    createError = false,
    beforeSubmit,
  } = {},
) {
  const originalFetch = globalThis.fetch
  const calls = []
  const models = deferred()
  const creation = deferred()
  let queryResult = {
    status: 'completed',
    videoUrls: ['https://example.test/output.mp4'],
    stage: '已完成',
  }
  let lookupResult = { exists: true, status: 'accepted', taskId: 'anmiao-video:25:99936297' }
  globalThis.fetch = async (url, options = {}) => {
    const call = { url: String(url), method: options.method || 'GET', body: options.body }
    calls.push(call)
    if (call.url.endsWith('/api/image-tasks/canvas-models'))
      return response({ mappingConfigured: true, options: [] })
    if (call.url.endsWith('/api/image-tasks/status')) return response({ configured: false })
    if (call.url.endsWith('/api/video-tasks/canvas-models'))
      return delayModels ? models.promise : response(catalog)
    if (call.url.includes('/api/video-tasks/by-client-task-id?')) return response(lookupResult)
    if (call.url.endsWith('/api/video-tasks') && call.method === 'POST') {
      if (createError) throw new TypeError('test lost receipt')
      return delayCreate
        ? creation.promise
        : response({ taskId: 'anmiao-video:25:99936297', status: 'queued', consumedMi: 0 })
    }
    if (call.url.includes('/api/video-tasks/')) return response(queryResult)
    throw new Error('Unexpected video test request: ' + call.url)
  }
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
    logLevel: 'silent',
  })
  const context = {}
  t.after(async () => {
    context.tasks?.detach(context.graph.projectId)
    globalThis.fetch = originalFetch
    await server.close()
  })
  const graphModule = await server.ssrLoadModule('/src/features/canvas-v3/stores/graph.js')
  const userModule = await server.ssrLoadModule('/src/stores/user.js')
  const taskModule = await server.ssrLoadModule('/src/features/canvas-v3/stores/tasks.js')
  setActivePinia(createPinia())
  const graph = graphModule.useCanvasV3GraphStore()
  const user = userModule.useUserStore()
  user.isAuthenticated = true
  user.token = 'video-test-only-not-real'
  graph.hydrate({ projectId: 'video-task-tests', nodes: [], edges: [] })
  const node = graph.addNode('video')
  graph.updateNodeData(node.id, {
    model,
    mode,
    prompt: '原始视频提示词',
    params: {
      ratio: '16:9',
      resolution: model === MINIMAX_H3_MODEL ? '768P' : '720P',
      duration: 8,
      count: '1个',
      ...params,
    },
  })
  const tasks = taskModule.useCanvasV3TaskStore()
  Object.assign(context, { graph, tasks })
  tasks.attach(graph.projectId, beforeSubmit ? { beforeImageSubmit: beforeSubmit } : {})
  return {
    graph,
    tasks,
    node,
    calls,
    posts: () =>
      calls.filter((call) => call.method === 'POST' && call.url.endsWith('/api/video-tasks')),
    finishModels: (value = catalog) => models.resolve(response(value)),
    finishCreate: (value = { taskId: 'anmiao-video:25:99936297', status: 'queued' }) =>
      creation.resolve(response(value)),
    query: (value) => {
      queryResult = value
    },
    lookup: (value) => {
      lookupResult = value
    },
  }
}

test('video store marks preparation before model loading and prevents duplicate POSTs', async (t) => {
  const h = await harness(t, { delayModels: true, delayCreate: true })
  const run = h.tasks.runVideo(h.node.id)
  assert.equal(h.node.data.runState, 'preparing')
  assert.match(h.node.data.statusText, /检查模型配置/)
  assert.equal(h.node.data.generation, undefined)
  await h.tasks.runVideo(h.node.id)
  assert.equal(h.posts().length, 0)
  h.finishModels()
  await flush()
  assert.equal(h.node.data.runState, 'submitting')
  assert.equal(h.posts().length, 1)
  await h.tasks.runVideo(h.node.id)
  assert.equal(h.posts().length, 1)
  h.finishCreate()
  await run
  assert.equal(h.node.data.runState, 'queued')
  assert.equal(h.node.data.generation.kind, 'video')
  assert.equal(h.node.data.generation.taskIds[0], 'anmiao-video:25:99936297')
})

test('video submission snapshots prompt, parameters and linked media before awaiting model configuration', async (t) => {
  const h = await harness(t, { delayModels: true, mode: '全能参考' })
  const ref = h.graph.addNode('video')
  h.graph.updateNodeData(ref.id, {
    assetUrl: 'https://example.test/original.mp4',
    generation: { params: { duration: 6 } },
  })
  h.graph.connect({ source: ref.id, target: h.node.id })
  const run = h.tasks.runVideo(h.node.id)
  h.graph.updateNodeData(h.node.id, {
    prompt: '新编辑',
    params: { ratio: '1:1', resolution: '1080P', duration: 12, count: '1个' },
  })
  ref.data.generation.params.duration = 12
  h.graph.updateNodeData(ref.id, { assetUrl: 'https://example.test/new.mp4' })
  h.finishModels()
  await run
  const body = JSON.parse(h.posts()[0].body)
  assert.equal(body.model, 'model-api-key:25')
  assert.equal(body.prompt, '原始视频提示词')
  assert.equal(body.resolution, '720p')
  assert.equal(body.durationSeconds, 8)
  assert.deepEqual(body.reference_videos, [
    { url: 'https://example.test/original.mp4', durationSeconds: 6 },
  ])
})

test('video pre-submit persistence barrier stores the idempotency key before any paid POST', async (t) => {
  const events = []
  const h = await harness(t, {
    beforeSubmit: async ({ nodeId, clientTaskId, kind }) => {
      assert.equal(h.posts().length, 0)
      assert.equal(nodeId, h.node.id)
      assert.equal(kind, 'video')
      assert.equal(h.node.data.generation.clientTaskId, clientTaskId)
      events.push(clientTaskId)
      return false
    },
  })
  await h.tasks.runVideo(h.node.id)
  assert.equal(events.length, 1)
  assert.equal(h.posts().length, 0)
  assert.equal(h.node.data.runState, 'failed')
  assert.equal(h.node.data.generation, undefined)
  assert.match(h.node.data.error, /尚未提交生成任务/)
})

test('video creation waits until the durable pre-submit save has actually completed', async (t) => {
  const saved = deferred()
  const h = await harness(t, { beforeSubmit: () => saved.promise })
  const run = h.tasks.runVideo(h.node.id)
  await flush()
  assert.equal(h.node.data.runState, 'submitting')
  assert.equal(h.node.data.generation.taskIds.length, 0)
  assert.equal(h.posts().length, 0)
  saved.resolve(true)
  await run
  assert.equal(h.posts().length, 1)
  assert.equal(JSON.parse(h.posts()[0].body).client_task_id, h.node.data.generation.clientTaskId)
})

test('queued video results poll video endpoints and preserve the existing clip without image variations', async (t) => {
  const h = await harness(t)
  h.graph.updateNodeData(h.node.id, { assetUrl: 'https://example.test/original.mp4' })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  await h.tasks.runVideo(h.node.id)
  assert.equal(h.graph.nodes.length, 1)
  assert.equal(h.node.data.assetUrl, 'https://example.test/original.mp4')
  await h.tasks.resume(h.node.id)
  t.mock.timers.tick(5000)
  await flush()
  assert.equal(h.node.data.runState, 'succeeded')
  assert.equal(h.node.data.assetUrl, 'https://example.test/output.mp4')
  assert.equal(h.node.data.artifactStatus, 'ready')
  assert.deepEqual(
    h.node.data.candidates.map((item) => item.url),
    ['https://example.test/original.mp4', 'https://example.test/output.mp4'],
  )
  assert.equal(h.graph.nodes.length, 1)
  assert.ok(
    h.calls.some((call) => call.url.endsWith('/api/video-tasks/anmiao-video%3A25%3A99936297')),
  )
  assert.equal(
    h.calls.some(
      (call) => /\/api\/image-tasks\//.test(call.url) && !/canvas-models|status$/.test(call.url),
    ),
    false,
  )
})

test('unknown video creation resumes by the persisted client key without a second POST', async (t) => {
  const h = await harness(t, { createError: true })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  await h.tasks.runVideo(h.node.id)
  assert.equal(h.node.data.runState, 'uncertain')
  const clientId = h.node.data.generation.clientTaskId
  await h.tasks.runVideo(h.node.id)
  assert.equal(h.posts().length, 1)
  assert.deepEqual(h.node.data.generation.taskIds, ['anmiao-video:25:99936297'])
  assert.ok(
    h.calls.some((call) =>
      call.url.endsWith(
        '/api/video-tasks/by-client-task-id?client_task_id=' + encodeURIComponent(clientId),
      ),
    ),
  )
  t.mock.timers.tick(5000)
  await flush()
  assert.equal(h.node.data.runState, 'succeeded')
  assert.equal(h.posts().length, 1)
})

test('H3 store posts its configured route and paused video tasks resist delete, duplicate and undo', async (t) => {
  const h = await harness(t, {
    model: MINIMAX_H3_MODEL,
    mode: '参考生',
    catalog: [route('model-api-key:83', 'MiniMax-H3')],
    params: { resolution: '2K', duration: 15 },
  })
  await h.tasks.runVideo(h.node.id)
  const body = JSON.parse(h.posts()[0].body)
  assert.equal(body.model, 'model-api-key:83')
  assert.equal(
    body.mode,
    'shouweizhen',
    'a stale reference mode cannot override an input with no media',
  )
  assert.equal(body.resolution, '2K')
  h.tasks.stopWaiting(h.node.id)
  assert.equal(h.node.data.runState, 'paused')
  assert.equal(h.graph.removeSelected(), false)
  assert.equal(h.graph.duplicateSelected(), false)
  assert.equal(h.graph.undo(), false)
  assert.equal(h.graph.nodes.length, 1)
  assert.equal(h.graph.nodes[0].data.kind, 'video')
  assert.match(h.node.data.statusText, /视频任务.*暂不能撤销/)
  assert.equal(h.posts().length, 1)
})

test('ambiguous native routes fail before POST rather than selecting an arbitrary credential', async (t) => {
  const h = await harness(t, { catalog: [route('model-api-key:25'), route('model-api-key:26')] })
  await h.tasks.runVideo(h.node.id)
  assert.equal(h.node.data.runState, 'failed')
  assert.match(h.node.data.error, /多条线路/)
  assert.equal(h.posts().length, 0)
})

const omniRoutes = [
  route('model-api-key:omni-ref', 'kling-v3-omni-cankao'),
  route('model-api-key:omni-video', 'kling-v3-omni-videoref'),
  route('model-api-key:omni-frames', 'kling-v3-omni-shouweizhen'),
]

test('Omni reference mode uses its exact configured route and snapshots API params without native resolution', async (t) => {
  const h = await harness(t, {
    model: 'Kling 3.0',
    mode: '参考生',
    catalog: omniRoutes,
    params: { mode: 'pro', duration: '10', aspect_ratio: '9:16' },
  })
  await h.tasks.runVideo(h.node.id)
  assert.equal(h.posts().length, 1)
  const body = JSON.parse(h.posts()[0].body)
  assert.equal(body.model, 'model-api-key:omni-ref')
  assert.equal(body.parameter_profile, 'canvas-v3-kling-omni')
  assert.deepEqual(body.omni_params, { mode: 'pro', duration: '10', aspect_ratio: '9:16' })
  assert.equal(Object.hasOwn(body, 'resolution'), false)
  assert.equal(Object.hasOwn(body, 'durationSeconds'), false)
  assert.equal(h.node.data.generation.mode, '参考生')
  assert.deepEqual(h.node.data.generation.params, body.omni_params)
  assert.equal(h.node.data.runState, 'queued')
  assert.equal(
    h.node.data.model,
    'Kling 3.0',
    'Dispatch must not rewrite the saved aggregate UI choice',
  )
})

test('Omni frame submission preserves two distinct linked nodes even when their URLs are identical', async (t) => {
  const h = await harness(t, {
    model: 'Kling 3.0',
    mode: '首尾帧',
    catalog: omniRoutes,
    params: { mode: 'std', duration: '15' },
  })
  for (let i = 0; i < 2; i++) {
    const ref = h.graph.addNode('image')
    h.graph.updateNodeData(ref.id, { assetUrl: 'https://example.test/same.png' })
    h.graph.connect({ source: ref.id, target: h.node.id })
  }
  await h.tasks.runVideo(h.node.id)
  const body = JSON.parse(h.posts()[0].body)
  assert.equal(body.model, 'model-api-key:omni-frames')
  assert.deepEqual(body.reference_image_urls, [
    'https://example.test/same.png',
    'https://example.test/same.png',
  ])
  assert.deepEqual(body.omni_params, { mode: 'std', duration: '15' })
  assert.deepEqual(h.node.data.generation.inputs.referenceImageUrls, body.reference_image_urls)
})

test('switching a saved Omni route to video editing resolves the new mode and omits hidden feature controls', async (t) => {
  const h = await harness(t, {
    model: 'model-api-key:omni-ref',
    mode: '视频参考',
    catalog: omniRoutes,
    params: {
      refer_type: 'base',
      mode: 'pro',
      duration: '10',
      aspect_ratio: '9:16',
      keep_original_sound: 'no',
    },
  })
  const ref = h.graph.addNode('video')
  h.graph.updateNodeData(ref.id, {
    assetUrl: 'https://example.test/reference.mp4',
    mediaDuration: 6,
    generation: { params: { duration: 99 } },
  })
  h.graph.connect({ source: ref.id, target: h.node.id })
  await h.tasks.runVideo(h.node.id)
  assert.equal(h.posts().length, 1)
  const body = JSON.parse(h.posts()[0].body)
  assert.equal(body.model, 'model-api-key:omni-video')
  assert.deepEqual(body.omni_params, { refer_type: 'base', mode: 'pro' })
  assert.deepEqual(body.reference_videos, [{ url: ref.data.assetUrl, durationSeconds: 6 }])
})

test('Omni missing mode credentials, ambiguous routes and invalid linked media all fail before POST', async (t) => {
  for (const [catalog, mode, message] of [
    [omniRoutes.slice(0, 1), '视频参考', /视频参考.*尚未配置/],
    [[omniRoutes[0], { ...omniRoutes[0], value: 'model-api-key:other' }], '参考生', /多条线路/],
    [omniRoutes, '首尾帧', /至少.*1|1.*图片|首帧/],
  ]) {
    await t.test(mode + String(catalog.length), async (subtest) => {
      const h = await harness(subtest, {
        model: 'Kling 3.0',
        mode,
        catalog,
        params: { duration: '5' },
      })
      await h.tasks.runVideo(h.node.id)
      assert.equal(h.posts().length, 0)
      assert.equal(h.node.data.runState, 'failed')
      assert.match(h.node.data.error, message)
    })
  }
})

test('Omni video results reuse polling and idempotent recovery rather than creating another task', async (t) => {
  const h = await harness(t, {
    model: 'Kling 3.0',
    mode: '参考生',
    catalog: omniRoutes,
    params: { mode: 'std', duration: '5' },
    createError: true,
  })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  await h.tasks.runVideo(h.node.id)
  assert.equal(h.node.data.runState, 'uncertain')
  await h.tasks.runVideo(h.node.id)
  assert.equal(h.posts().length, 1)
  t.mock.timers.tick(5000)
  await flush()
  assert.equal(h.node.data.runState, 'succeeded')
  assert.equal(h.node.data.assetUrl, 'https://example.test/output.mp4')
  assert.equal(h.posts().length, 1)
})

test('Wanxiang store resolves its exact route and snapshots auto duration plus video/audio metadata', async (t) => {
  const h = await harness(t, {
    model: '万相 3.0',
    mode: '首尾帧',
    delayModels: true,
    catalog: [route('model-api-key:wan', WANXIANG_MODEL)],
    params: {
      version: 'prime',
      ratio: 'adaptive',
      duration: 'auto',
      audio: false,
      prompt_extend: true,
    },
  })
  const refs = []
  for (const [kind, url, duration] of [
    ['image', 'https://example.test/first.png'],
    ['image', 'https://example.test/second.png'],
    ['video', 'https://example.test/dance.mp4', 12.25],
    ['audio', 'https://example.test/song.mp3', 5.5],
  ]) {
    const source = h.graph.addNode(kind)
    h.graph.updateNodeData(source.id, {
      assetUrl: url,
      ...(duration ? { mediaDuration: duration } : {}),
    })
    h.graph.connect({ source: source.id, target: h.node.id })
    refs.push(source)
  }
  const run = h.tasks.runVideo(h.node.id)
  assert.equal(h.node.data.runState, 'preparing')
  h.graph.updateNodeData(h.node.id, { prompt: '不应混入的新编辑', params: { duration: 30 } })
  refs[2].data.mediaDuration = 20
  h.graph.updateNodeData(refs[3].id, { assetUrl: 'https://example.test/other.mp3' })
  h.finishModels()
  await run
  assert.equal(h.posts().length, 1)
  const body = JSON.parse(h.posts()[0].body)
  assert.equal(body.model, 'model-api-key:wan')
  assert.equal(body.parameter_profile, 'canvas-v3-wanxiang30')
  assert.equal(body.prompt, '原始视频提示词')
  assert.deepEqual(body.wanxiang_params, {
    version: 'prime',
    resolution: '720P',
    duration: 'auto',
    ratio: 'adaptive',
    audio: false,
    prompt_extend: true,
    image_url: ['https://example.test/first.png', 'https://example.test/second.png'],
    video_url: ['https://example.test/dance.mp4'],
    audio_url: ['https://example.test/song.mp3'],
  })
  assert.deepEqual(body.reference_videos, [
    { url: 'https://example.test/dance.mp4', durationSeconds: 12.25 },
  ])
  assert.deepEqual(body.reference_audio_media, [
    { url: 'https://example.test/song.mp3', durationSeconds: 5.5 },
  ])
  assert.equal(h.node.data.generation.mode, '全能参考')
  assert.equal(h.node.data.generation.inputMode, 'omni')
  assert.deepEqual(h.node.data.generation.params, body.wanxiang_params)
  assert.equal(body.first_frame_url, undefined)
  assert.equal(body.last_frame_url, undefined)
  assert.equal(body.count, undefined)
})

test('Wanxiang missing credentials, ambiguous routes and unknown actual reference duration fail before POST', async (t) => {
  for (const [name, catalog, reference] of [
    ['missing', [], null],
    [
      'ambiguous',
      [route('model-api-key:a', WANXIANG_MODEL), route('model-api-key:b', WANXIANG_MODEL)],
      null,
    ],
    ['wrong-label', [route('model-api-key:other', 'some-other-video')], null],
    ['unknown-duration', [route('model-api-key:wan', WANXIANG_MODEL)], 'video'],
    ['unknown-audio-duration', [route('model-api-key:wan', WANXIANG_MODEL)], 'audio'],
  ])
    await t.test(name, async (subtest) => {
      const h = await harness(subtest, { model: '万相 3.0', catalog })
      if (reference) {
        const source = h.graph.addNode(reference)
        h.graph.updateNodeData(source.id, {
          assetUrl: 'https://example.test/reference',
          generation: { params: { duration: 5 } },
        })
        h.graph.connect({ source: source.id, target: h.node.id })
      }
      await h.tasks.runVideo(h.node.id)
      assert.equal(h.posts().length, 0)
      assert.equal(h.node.data.runState, 'failed')
      assert.match(h.node.data.error, reference ? /实际时长/ : /尚未配置|多条线路/)
      assert.equal(h.node.data.generation, undefined)
    })
})

test('Wanxiang uncertain creation resumes the original client key and polls without a duplicate POST', async (t) => {
  const h = await harness(t, {
    model: '万相 3.0',
    catalog: [route('model-api-key:wan', WANXIANG_MODEL)],
    createError: true,
  })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  h.lookup({ exists: true, status: 'accepted', taskId: 'wanxiang-video:key:77:123456' })
  await h.tasks.runVideo(h.node.id)
  assert.equal(h.node.data.runState, 'uncertain')
  const clientId = h.node.data.generation.clientTaskId
  await h.tasks.runVideo(h.node.id)
  assert.equal(h.posts().length, 1)
  assert.ok(
    h.calls.some((call) =>
      call.url.endsWith(
        '/api/video-tasks/by-client-task-id?client_task_id=' + encodeURIComponent(clientId),
      ),
    ),
  )
  assert.deepEqual(h.node.data.generation.taskIds, ['wanxiang-video:key:77:123456'])
  t.mock.timers.tick(5000)
  await flush()
  assert.equal(h.node.data.runState, 'succeeded')
  assert.equal(h.node.data.assetUrl, 'https://example.test/output.mp4')
  assert.equal(h.posts().length, 1)
  assert.ok(
    h.calls.some((call) =>
      call.url.endsWith('/api/video-tasks/wanxiang-video%3Akey%3A77%3A123456'),
    ),
  )
})
