import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createPinia, setActivePinia } from 'pinia'

test('image task lifecycle guards duplicate submission, queries real progress and preserves resumable cancellation', async () => {
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
    logLevel: 'silent',
  })
  const originalFetch = globalThis.fetch
  let taskStore
  try {
    const graphModule = await server.ssrLoadModule('/src/features/canvas-v3/stores/graph.js')
    const userModule = await server.ssrLoadModule('/src/stores/user.js')
    const taskModule = await server.ssrLoadModule('/src/features/canvas-v3/stores/tasks.js')
    const calls = []
    let finishCreate
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || 'GET' })
      if (String(url).endsWith('/canvas-models'))
        return {
          ok: true,
          status: 200,
          json: async () => ({
            code: 0,
            data: { mappingConfigured: true, options: [{ value: 'banana2', label: 'Banana 2' }] },
          }),
        }
      if (options.method === 'POST')
        return new Promise((resolve) => {
          finishCreate = () =>
            resolve({
              ok: true,
              status: 200,
              json: async () => ({ code: 0, data: { tasks: [{ taskId: 'test-existing-task' }] } }),
            })
        })
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: 0, data: { status: 'running', progress: 2, imageUrls: [] } }),
      }
    }
    setActivePinia(createPinia())
    const graph = graphModule.useCanvasV3GraphStore()
    const user = userModule.useUserStore()
    user.isAuthenticated = true
    user.token = 'test-token-not-a-real-credential'
    graph.hydrate({
      projectId: 'v3-lifecycle-test',
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    })
    const node = graph.addNode('image')
    graph.updateNodeData(node.id, { prompt: 'a test prompt', model: 'banana2' })
    taskStore = taskModule.useCanvasV3TaskStore()
    taskStore.attach(graph.projectId)
    await taskStore.loadModels()
    const first = taskStore.runImage(node.id)
    await new Promise((resolve) => setImmediate(resolve))
    await taskStore.runImage(node.id)
    assert.equal(calls.filter((call) => call.method === 'POST').length, 1)
    finishCreate()
    await first
    assert.equal(graph.nodes[0].data.runState, 'queued')
    await new Promise((resolve) => setTimeout(resolve, 2600))
    assert.equal(graph.nodes[0].data.progress, 2)
    taskStore.stopWaiting(node.id)
    assert.equal(graph.nodes[0].data.runState, 'paused')
    assert.deepEqual(graph.nodes[0].data.generation.taskIds, ['test-existing-task'])
    await taskStore.runImage(node.id)
    assert.equal(graph.nodes[0].data.runState, 'running')
    assert.equal(calls.filter((call) => call.method === 'POST').length, 1)
    assert.equal(
      calls.some((call) => /cancel|stop/.test(call.url)),
      false,
    )
  } finally {
    taskStore?.detach('v3-lifecycle-test')
    globalThis.fetch = originalFetch
    await server.close()
  }
})
