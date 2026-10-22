import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createPinia, setActivePinia } from 'pinia'
import { imageGridPreset } from '../src/features/canvas-v3/config/imageGridTemplates.js'
import { imageTaskFeedback } from '../src/features/canvas-v3/config/imageTaskState.js'

const flush = () => new Promise((resolve) => setImmediate(resolve))
const response = (data) => ({ ok: true, status: 200, json: async () => ({ code: 0, data }) })

async function harness(t) {
  const originalFetch = globalThis.fetch
  const originalXHR = globalThis.XMLHttpRequest
  const calls = []
  const uploads = []
  let resolveModels
  let resolveCreate
  globalThis.fetch = async (url, options = {}) => {
    const call = { url: String(url), method: options.method || 'GET', body: options.body }
    calls.push(call)
    if (call.url.endsWith('/canvas-models'))
      return new Promise((resolve) => {
        resolveModels = resolve
      })
    if (call.url.endsWith('/oss-sign'))
      return response({
        uploadUrl: 'https://example.test/upload',
        url: 'https://example.test/reference.png',
      })
    if (call.method === 'POST' && call.url.endsWith('/image-tasks'))
      return new Promise((resolve) => {
        resolveCreate = resolve
      })
    throw new Error('Unexpected mock request: ' + call.url)
  }
  globalThis.XMLHttpRequest = class {
    upload = {}
    status = 200
    open() {}
    setRequestHeader() {}
    send() {
      uploads.push(this)
    }
    abort() {
      this.onabort?.()
    }
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
    globalThis.XMLHttpRequest = originalXHR
    await server.close()
  })
  const graphModule = await server.ssrLoadModule('/src/features/canvas-v3/stores/graph.js')
  const userModule = await server.ssrLoadModule('/src/stores/user.js')
  const taskModule = await server.ssrLoadModule('/src/features/canvas-v3/stores/tasks.js')
  setActivePinia(createPinia())
  const graph = graphModule.useCanvasV3GraphStore()
  const user = userModule.useUserStore()
  user.isAuthenticated = true
  user.token = 'test-only-not-a-real-credential'
  graph.hydrate({ projectId: 'submission-feedback-test', nodes: [], edges: [] })
  const node = graph.addNode('image')
  graph.updateNodeData(node.id, { ...imageGridPreset('story-twenty-five'), model: 'banana2' })
  const tasks = taskModule.useCanvasV3TaskStore()
  Object.assign(context, { graph, tasks })
  tasks.attach(graph.projectId)
  return {
    graph,
    tasks,
    node,
    calls,
    uploads,
    finishModels: (options = [{ value: 'banana2', label: 'Banana 2' }]) =>
      resolveModels(response({ mappingConfigured: true, options })),
    finishCreate: () => resolveCreate(response({ tasks: [{ taskId: 'existing-test-task' }] })),
    posts: () =>
      calls.filter((call) => call.method === 'POST' && call.url.endsWith('/image-tasks')),
  }
}

test('25-panel preset enters busy state synchronously, before delayed model configuration returns', async (t) => {
  const h = await harness(t)
  const run = h.tasks.runImage(h.node.id)
  assert.equal(h.node.data.runState, 'preparing')
  assert.match(h.node.data.statusText, /检查模型配置/)
  assert.equal(h.node.data.progress, null)
  assert.equal(h.node.data.generation, undefined)
  await h.tasks.runImage(h.node.id)
  assert.equal(h.posts().length, 0)
  h.finishModels()
  await flush()
  assert.equal(h.node.data.runState, 'submitting')
  assert.match(h.node.data.statusText, /正在提交/)
  assert.equal(h.posts().length, 1)
  assert.equal(JSON.parse(h.posts()[0].body).n, 1)
  assert.match(JSON.parse(h.posts()[0].body).prompt, /25/)
  await h.tasks.runImage(h.node.id)
  assert.equal(h.posts().length, 1)
  h.finishCreate()
  await run
  assert.equal(h.node.data.runState, 'queued')
  assert.match(h.node.data.statusText, /已提交，排队中/)
})

test('persists a caller-provided client task key before the first generation POST', async (t) => {
  const h = await harness(t)
  const events = []
  h.tasks.attach(h.graph.projectId, {
    beforeImageSubmit: async ({ nodeId, clientTaskId }) => {
      events.push('persist')
      assert.equal(h.posts().length, 0)
      assert.equal(nodeId, h.node.id)
      assert.equal(clientTaskId, 'director-stable-client-key')
      assert.equal(h.node.data.generation.clientTaskId, clientTaskId)
      return true
    },
  })
  const run = h.tasks.runImage(h.node.id, null, {
    clientTaskId: 'director-stable-client-key',
    onSubmitStart: () => events.push('submit'),
  })
  h.finishModels()
  await flush()

  assert.deepEqual(events, ['persist', 'submit'])
  assert.equal(h.posts().length, 1)
  assert.equal(JSON.parse(h.posts()[0].body).client_task_id, 'director-stable-client-key')
  h.finishCreate()
  await run
})

test('resolves a routed TT version after model loading and persists the submitted snapshot', async (t) => {
  const h = await harness(t)
  h.graph.updateNodeData(h.node.id, {
    model: 'model-api-key:41',
    prompt: '原始请求',
    params: { ratio: '16:9', resolution: '2K', count: '1张' },
  })
  const run = h.tasks.runImage(h.node.id)
  h.graph.updateNodeData(h.node.id, {
    prompt: '准备期间的新编辑',
    params: { ...h.node.data.params, version: 'flare' },
  })
  h.finishModels([
    {
      value: 'model-api-key:41',
      label: '自定义图片服务',
      model: 'tt-image-2.5',
      defaultVersion: 'sunburst',
    },
  ])
  await flush()

  const request = JSON.parse(h.posts()[0].body)
  assert.equal(request.model, 'model-api-key:41')
  assert.equal(request.version, 'sunburst')
  assert.match(request.prompt, /原始请求/)
  assert.doesNotMatch(request.prompt, /准备期间的新编辑/)
  assert.equal(h.node.data.generation.params.version, 'sunburst')
  h.finishCreate()
  await run
})

test('an explicit TT version overrides the configured default before the POST', async (t) => {
  const h = await harness(t)
  h.graph.updateNodeData(h.node.id, {
    model: 'model-api-key:42',
    params: { ...h.node.data.params, version: 'flare' },
  })
  const run = h.tasks.runImage(h.node.id)
  h.finishModels([
    {
      value: 'model-api-key:42',
      label: '图片高质',
      model: 'tt-image-2.5',
      defaultVersion: 'sunburst',
    },
  ])
  await flush()

  assert.equal(JSON.parse(h.posts()[0].body).version, 'flare')
  assert.equal(h.node.data.generation.params.version, 'flare')
  h.finishCreate()
  await run
})

test('the output-panel screenshot selections reach the final image task POST unchanged', async (t) => {
  const h = await harness(t)
  h.graph.updateNodeData(h.node.id, {
    model: 'model-api-key:42',
    params: {
      ratio: '3:4',
      resolution: '4K',
      quality: '极致画质',
      background: '自动',
      version: 'flare',
      count: '1张',
    },
  })
  const run = h.tasks.runImage(h.node.id)
  h.finishModels([
    {
      value: 'model-api-key:42',
      label: 'image-2.5',
      model: 'tt-image-2.5',
      defaultVersion: 'sunburst',
    },
  ])
  await flush()
  const body = JSON.parse(h.posts()[0].body)
  assert.equal(body.parameter_profile, 'canvas-v3-image')
  assert.deepEqual(
    {
      model: body.model,
      version: body.version,
      quality: body.quality,
      background: body.background,
      resolution: body.resolution,
      size: body.size,
      n: body.n,
    },
    {
      model: 'model-api-key:42',
      version: 'flare',
      quality: 'max',
      background: 'auto',
      resolution: '4K',
      size: '3:4',
      n: 1,
    },
  )
  h.finishCreate()
  await run
})

test('opaque TT custom-size submission captures its switch and canonical value before model loading', async (t) => {
  const h = await harness(t)
  h.graph.updateNodeData(h.node.id, {
    model: 'model-api-key:71',
    prompt: '原始自定义尺寸请求',
    params: {
      customSize: ' 1536X864 ',
      ratio: '3:4',
      resolution: '4K',
      quality: '极致画质',
      background: '透明背景',
      version: 'sunburst',
      count: '1张',
    },
    switches: { 自定义尺寸: true },
  })
  const run = h.tasks.runImage(h.node.id)
  assert.equal(h.node.data.runState, 'preparing')
  h.graph.updateNodeData(h.node.id, {
    prompt: '提交期间的新请求',
    params: {
      customSize: '2048x2048',
      ratio: '1:1',
      resolution: '1K',
      quality: '低画质',
      background: '自动',
      version: 'flare',
    },
    switches: { 自定义尺寸: false },
  })
  h.finishModels([
    {
      value: 'model-api-key:71',
      model: 'tt-image-2.5',
      label: '配置中的图片服务',
      defaultVersion: 'flare',
    },
  ])
  await flush()
  assert.equal(h.posts().length, 1)
  const request = JSON.parse(h.posts()[0].body)
  assert.equal(request.custom_size, '1536x864')
  assert.equal(request.model, 'model-api-key:71')
  assert.equal(request.parameter_profile, 'canvas-v3-image')
  assert.equal(request.version, 'sunburst')
  assert.equal(request.quality, 'max')
  assert.equal(request.background, 'transparent')
  assert.equal(request.output_format, 'png')
  assert.equal(request.size, '3:4')
  assert.equal(request.resolution, '4K')
  assert.match(request.prompt, /原始自定义尺寸请求/)
  assert.doesNotMatch(request.prompt, /提交期间的新请求/)
  assert.equal(h.node.data.generation.params.customSize, '1536x864')
  assert.equal(h.node.data.generation.params.quality, '极致画质')
  assert.equal(h.node.data.params.customSize, '2048x2048')
  assert.equal(h.node.data.switches.自定义尺寸, false)
  h.finishCreate()
  await run
})

test('invalid opaque TT custom size ends preparation before any reference upload or generation POST', async (t) => {
  const h = await harness(t)
  h.graph.updateNodeData(h.node.id, {
    model: 'model-api-key:72',
    params: { customSize: '1537x864', ratio: '16:9', resolution: '2K' },
    switches: { 自定义尺寸: true },
  })
  const source = h.graph.addNode('image')
  h.graph.updateNodeData(source.id, { assetUrl: 'data:image/png;base64,aGk=' })
  h.graph.connect({ source: source.id, target: h.node.id })
  const run = h.tasks.runImage(h.node.id)
  assert.equal(h.node.data.runState, 'preparing')
  h.finishModels([{ value: 'model-api-key:72', model: 'tt-image-2.5', label: 'image-2.5' }])
  await run
  assert.equal(h.posts().length, 0)
  assert.equal(h.uploads.length, 0)
  assert.equal(
    h.calls.some((call) => call.url.endsWith('/oss-sign')),
    false,
  )
  assert.equal(h.node.data.runState, 'failed')
  assert.equal(h.node.data.statusText, '')
  assert.match(h.node.data.error, /尺寸|16/)
})

test('Banana 2.1 submits its captured model-specific params and web-search switch after model loading', async (t) => {
  const h = await harness(t)
  h.graph.updateNodeData(h.node.id, {
    model: 'model-api-key:61',
    params: {
      ratio: '1:8',
      resolution: '4K',
      count: '4张',
      thinkingLevel: '深度',
      version: 'sunburst',
      quality: '极致画质',
      background: '透明背景',
    },
    switches: { 联网搜索: false },
  })
  const run = h.tasks.runImage(h.node.id)
  h.graph.updateNodeData(h.node.id, {
    params: { ratio: '1:1', resolution: '1K', thinkingLevel: '快速' },
    switches: { 联网搜索: true },
  })
  h.finishModels([{ value: 'model-api-key:61', model: 'banana-2.1', label: '图片服务' }])
  await flush()
  assert.equal(h.posts().length, 1)
  const body = JSON.parse(h.posts()[0].body)
  assert.equal(body.model, 'model-api-key:61')
  assert.equal(body.parameter_profile, 'canvas-v3-image')
  assert.equal(body.size, '1:8')
  assert.equal(body.resolution, '4K')
  assert.equal(body.n, 1)
  assert.equal(body.thinking_level, 'high')
  assert.equal(body.web_search, false)
  for (const key of ['version', 'quality', 'background', 'output_format'])
    assert.equal(Object.hasOwn(body, key), false)
  assert.deepEqual(h.node.data.generation.params, {
    ratio: '1:8',
    resolution: '4K',
    count: '1张',
    thinkingLevel: '深度',
  })
  h.finishCreate()
  await run
})

test('Banana Pro rejects a fifteenth reference before uploading or submitting', async (t) => {
  const h = await harness(t)
  h.graph.updateNodeData(h.node.id, { model: 'model-api-key:62' })
  for (let index = 0; index < 15; index++) {
    const reference = h.graph.addNode('image')
    h.graph.updateNodeData(reference.id, { assetUrl: `data:image/png;base64,reference${index}` })
    h.graph.edges.push({ id: `reference-${index}`, source: reference.id, target: h.node.id })
  }
  const run = h.tasks.runImage(h.node.id)
  h.finishModels([{ value: 'model-api-key:62', model: 'banana-pro', label: '纳米香蕉 Pro' }])
  await run
  assert.equal(h.posts().length, 0)
  assert.equal(h.uploads.length, 0)
  assert.equal(
    h.calls.some((call) => call.url.endsWith('/oss-sign')),
    false,
  )
  assert.match(h.node.data.error, /最多支持 14 张参考图/)
})

test('does not POST when the client task key cannot be durably saved', async (t) => {
  const h = await harness(t)
  h.tasks.attach(h.graph.projectId, { beforeImageSubmit: async () => false })
  const run = h.tasks.runImage(h.node.id, null, { clientTaskId: 'not-persisted' })
  h.finishModels()
  await run

  assert.equal(h.posts().length, 0)
  assert.equal(h.node.data.runState, 'failed')
  assert.match(h.node.data.error, /尚未提交生成任务/)
})

test('reference upload has real progress feedback; cancelling preparation cannot submit or unlock a newer click', async (t) => {
  const h = await harness(t)
  const source = h.graph.addNode('image')
  h.graph.updateNodeData(source.id, { assetUrl: 'data:image/png;base64,aGk=' })
  h.graph.connect({ source: source.id, target: h.node.id })
  h.finishModels()
  await h.tasks.loadModels()
  const first = h.tasks.runImage(h.node.id)
  await flush()
  assert.equal(h.node.data.runState, 'preparing')
  assert.match(h.node.data.statusText, /上传参考图（1\/1）/)
  assert.equal(h.uploads.length, 1)
  h.uploads[0].upload.onprogress({ lengthComputable: true, loaded: 38, total: 100 })
  assert.match(h.node.data.statusText, /38%/)
  assert.equal(h.node.data.progress, null, 'upload percentage is not generation percentage')
  assert.equal(h.posts().length, 0)
  h.tasks.stopWaiting(h.node.id)
  assert.equal(h.node.data.runState, 'idle')
  assert.match(h.node.data.statusText, /未提交/)
  const second = h.tasks.runImage(h.node.id)
  await first
  await flush()
  assert.equal(h.uploads.length, 2)
  await h.tasks.runImage(h.node.id)
  assert.equal(h.uploads.length, 2, 'old finally cannot release a newer operation lock')
  h.uploads[1].onload()
  await flush()
  assert.equal(h.posts().length, 1)
  assert.deepEqual(JSON.parse(h.posts()[0].body).image_urls, ['https://example.test/reference.png'])
  h.finishCreate()
  await second
})

test('editing an existing image keeps the source visible and sends it as the reference', async (t) => {
  const h = await harness(t)
  const sourceUrl = 'https://example.test/original-product.png'
  h.graph.updateNodeData(h.node.id, {
    assetUrl: sourceUrl,
    editTemplate: { id: 'product-sheet', sourceNodeId: null },
  })
  let target
  const run = h.tasks.runImage(h.node.id, (created) => {
    target = created
  })
  assert.ok(target)
  assert.notEqual(target.id, h.node.id)
  assert.equal(h.node.data.assetUrl, sourceUrl)
  assert.equal(h.node.data.runState, 'idle')
  assert.equal(target.data.runState, 'preparing')
  assert.equal(target.data.sourceImageNodeId, h.node.id)
  assert.ok(h.graph.edges.some((edge) => edge.source === h.node.id && edge.target === target.id))
  h.finishModels()
  await flush()
  assert.equal(h.posts().length, 1)
  assert.deepEqual(JSON.parse(h.posts()[0].body).image_urls, [sourceUrl])
  h.finishCreate()
  await run
  assert.equal(target.data.runState, 'queued')
  assert.equal(h.node.data.assetUrl, sourceUrl)
})

test('model validation failure clears the busy state and never posts a generation', async (t) => {
  const h = await harness(t)
  const run = h.tasks.runImage(h.node.id)
  h.finishModels([])
  await run
  assert.equal(h.node.data.runState, 'failed')
  assert.match(h.node.data.error, /尚未配置/)
  assert.equal(h.node.data.statusText, '')
  assert.equal(h.posts().length, 0)
})

test('a renderer replacing the same logical node does not stall preparation', async (t) => {
  const h = await harness(t)
  const run = h.tasks.runImage(h.node.id)
  h.graph.nodes = h.graph.nodes.map((node) => ({ ...node, data: { ...node.data } }))
  h.finishModels()
  await flush()
  assert.equal(h.posts().length, 1)
  assert.equal(h.graph.nodes[0].data.runState, 'submitting')
  h.finishCreate()
  await run
  assert.equal(h.graph.nodes[0].data.runState, 'queued')
})

test('reference upload failure ends preparation and permits an explicit retry', async (t) => {
  const h = await harness(t)
  const source = h.graph.addNode('image')
  h.graph.updateNodeData(source.id, { assetUrl: 'data:image/png;base64,aGk=' })
  h.graph.connect({ source: source.id, target: h.node.id })
  h.finishModels()
  await h.tasks.loadModels()
  const first = h.tasks.runImage(h.node.id)
  await flush()
  h.uploads[0].status = 500
  h.uploads[0].onload()
  await first
  assert.equal(h.node.data.runState, 'failed')
  assert.equal(h.node.data.statusText, '')
  assert.match(h.node.data.error, /500/)
  assert.equal(h.posts().length, 0)
  const retry = h.tasks.runImage(h.node.id)
  await flush()
  assert.equal(h.node.data.runState, 'preparing')
  assert.equal(h.uploads.length, 2)
  h.uploads[1].onload()
  await flush()
  assert.equal(h.posts().length, 1)
  h.finishCreate()
  await retry
})

test('a preparation restored after reload is not falsely treated as an accepted provider task', async (t) => {
  const h = await harness(t)
  h.graph.updateNodeData(h.node.id, { runState: 'preparing' })
  h.tasks.attach(h.graph.projectId)
  assert.equal(h.node.data.runState, 'idle')
  assert.match(h.node.data.statusText, /尚未提交/)
  h.graph.updateNodeData(h.node.id, {
    runState: 'submitting',
    generation: { clientTaskId: 'previous-client-id', taskIds: [] },
  })
  h.tasks.attach(h.graph.projectId)
  assert.equal(h.node.data.runState, 'uncertain')
  assert.equal(h.posts().length, 0)
  h.finishModels()
  await h.tasks.loadModels()
})

test('leaving a canvas while models are loading prevents a late generation POST', async (t) => {
  const h = await harness(t)
  const run = h.tasks.runImage(h.node.id)
  h.tasks.detach(h.graph.projectId)
  h.finishModels()
  await run
  assert.equal(h.posts().length, 0)
})

test('feedback distinguishes preparation, submission, queueing and actual generation progress', () => {
  assert.equal(imageTaskFeedback({ runState: 'preparing' }), '正在准备生成任务…')
  assert.equal(
    imageTaskFeedback({ runState: 'preparing', statusText: '正在上传参考图 38%…' }),
    '正在上传参考图 38%…',
  )
  assert.equal(imageTaskFeedback({ runState: 'submitting' }), '正在提交生成任务…')
  assert.equal(imageTaskFeedback({ runState: 'queued' }), '任务已提交，排队中…')
  assert.equal(imageTaskFeedback({ runState: 'running', progress: null }), '生成中…')
  assert.equal(imageTaskFeedback({ runState: 'running', progress: 2 }), '生成中 2%...')
})
