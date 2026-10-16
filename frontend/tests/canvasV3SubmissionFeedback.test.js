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
