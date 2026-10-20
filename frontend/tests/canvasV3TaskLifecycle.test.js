import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { createServer } from 'vite'
import { createPinia, setActivePinia } from 'pinia'
import { createDirectorImageExecutionIntent } from '../src/features/canvas-v3/config/directorImageExecution.js'
import { resolveConfiguredImageTaskModel } from '../src/features/canvas-v3/config/directorModelCatalog.js'
import { directorResponseRouting } from '../src/features/canvas-v3/config/directorRouting.js'

const shellSource = await readFile(
  new URL('../src/features/canvas-v3/components/CanvasV3Shell.vue', import.meta.url),
  'utf8',
)
const directorSubmissionSource = [
  'directorRun',
  'updateDirectorRun',
  'directorImagePlan',
  'directorSubmissionStarted',
  'directorDraftFromIntent',
  'ensureDirectorDraftNode',
  'submitDirectorDraft',
  'confirmDirectorGeneration',
]
  .map((name) => {
    const source = shellSource.match(
      new RegExp(`^(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?^\\}`, 'm'),
    )?.[0]
    assert.ok(source, `missing actual Shell function: ${name}`)
    return source
  })
  .join('\n\n')

async function withDirectorTaskStore({ persist, create }, verify) {
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
    logLevel: 'silent',
  })
  const originalFetch = globalThis.fetch
  const projectId = 'v3-director-pre-submit-test'
  const calls = []
  let taskStore
  try {
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || 'GET', body: options.body })
      let data
      if (String(url).endsWith('/canvas-models'))
        data = { mappingConfigured: true, options: [{ value: 'banana2', label: 'Banana 2' }] }
      else if (options.method === 'POST') data = await create(JSON.parse(options.body))
      else if (String(url).includes('/by-client-task-id')) data = { exists: false }
      else throw new Error(`unexpected task request: ${url}`)
      return { ok: true, status: 200, json: async () => ({ code: 0, data }) }
    }
    const graphModule = await server.ssrLoadModule('/src/features/canvas-v3/stores/graph.js')
    const userModule = await server.ssrLoadModule('/src/stores/user.js')
    const taskModule = await server.ssrLoadModule('/src/features/canvas-v3/stores/tasks.js')
    setActivePinia(createPinia())
    const graph = graphModule.useCanvasV3GraphStore()
    const user = userModule.useUserStore()
    user.isAuthenticated = true
    user.token = 'test-token-not-a-real-credential'
    graph.hydrate({ projectId, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } })
    const node = graph.addNode('image')
    graph.updateNodeData(node.id, {
      directorRunId: 'run-1',
      prompt: '一张床垫卧室场景图',
      model: 'banana2',
    })
    taskStore = taskModule.useCanvasV3TaskStore()
    taskStore.attach(projectId, { beforeImageSubmit: persist })
    await taskStore.loadModels()
    const run = {
      id: 'run-1',
      nodeId: node.id,
      clientTaskId: 'director-stable-key',
      phase: 'ready',
      submissionStarted: false,
      generationIntent: {
        generationType: 'image',
        nodeModel: 'banana2',
        referenceAssets: [],
        referenceLayerIds: [],
        ratio: '16:9',
        resolution: '2K',
        count: 1,
      },
      proposal: { generationType: 'image', prompt: '一张床垫卧室场景图' },
      questions: [],
      contentReady: true,
    }
    const context = {
      nodes: { value: graph.nodes },
      graph,
      tasks: taskStore,
      user,
      directorAgentRuns: { value: [run] },
      directorGenerationSubmissions: new Set(),
      directorNodePreparations: new Map(),
      scheduleDirectorConversationSync() {},
      directorDraftPosition: () => ({ x: 180, y: 140 }),
      nextTick: async () => {},
      saveNow: async () => true,
      focusStoryboard: async () => {},
      focusGenerated() {},
      createDirectorImageExecutionIntent,
      resolveConfiguredImageTaskModel,
      directorResponseRouting,
    }
    runInNewContext(directorSubmissionSource, context)
    await verify({ context, graph, calls, taskStore, nodeId: node.id })
  } finally {
    taskStore?.detach(projectId)
    globalThis.fetch = originalFetch
    await server.close()
  }
}

test('Director can confirm again after pre-submit persistence fails without sending a paid POST', async () => {
  for (const failure of ['rejected', 'thrown']) {
    let persistCount = 0
    await withDirectorTaskStore(
      {
        persist: async () => {
          persistCount += 1
          if (persistCount > 1) return true
          if (failure === 'thrown') throw new Error('保存连接中断')
          return false
        },
        create: async () => ({ tasks: [{ taskId: 'new-task-after-safe-retry' }] }),
      },
      async ({ context, graph, calls, nodeId }) => {
        const settings = { model: 'banana2', ratio: '1:1', resolution: '2K', count: 1 }
        await context.confirmDirectorGeneration('run-1', settings)
        const failed = graph.nodes.find((node) => node.id === nodeId)
        assert.equal(calls.filter((call) => call.method === 'POST').length, 0)
        assert.equal(failed.data.runState, 'failed')
        assert.equal(failed.data.generation, undefined)
        assert.equal(context.directorRun('run-1').submissionStarted, false)
        assert.equal(context.directorSubmissionStarted(context.directorRun('run-1')), false)
        assert.equal(context.directorRun('run-1').phase, 'ready')
        assert.match(context.directorRun('run-1').error, /保存/)

        await context.confirmDirectorGeneration('run-1', settings)
        const submitted = graph.nodes.find((node) => node.id === nodeId)
        const posts = calls.filter((call) => call.method === 'POST')
        assert.equal(posts.length, 1)
        assert.equal(JSON.parse(posts[0].body).client_task_id, 'director-stable-key')
        assert.equal(submitted.data.runState, 'queued')
        assert.deepEqual([...submitted.data.generation.taskIds], ['new-task-after-safe-retry'])
        assert.equal(context.directorSubmissionStarted(context.directorRun('run-1')), true)
      },
    )
  }
})

test('Director retains a possibly dispatched key after a network failure and only queries on confirmation', async () => {
  await withDirectorTaskStore(
    {
      persist: async () => true,
      create: async () => {
        throw new TypeError('network timeout after POST')
      },
    },
    async ({ context, graph, calls, nodeId }) => {
      const settings = { model: 'banana2', ratio: '1:1', resolution: '2K', count: 1 }
      await context.confirmDirectorGeneration('run-1', settings)
      const uncertain = graph.nodes.find((node) => node.id === nodeId)
      assert.equal(calls.filter((call) => call.method === 'POST').length, 1)
      assert.equal(uncertain.data.runState, 'uncertain')
      assert.equal(uncertain.data.generation.clientTaskId, 'director-stable-key')
      assert.equal(context.directorSubmissionStarted(context.directorRun('run-1')), true)
      assert.equal(context.directorRun('run-1').submissionState, 'uncertain')

      await context.confirmDirectorGeneration('run-1', {
        ...settings,
        ratio: '9:16',
        resolution: '4K',
        count: 4,
      })
      assert.equal(calls.filter((call) => call.method === 'POST').length, 1)
      const queries = calls.filter((call) => call.url.includes('/by-client-task-id'))
      assert.equal(queries.length, 1)
      assert.match(queries[0].url, /client_task_id=director-stable-key/)
      assert.equal(context.directorRun('run-1').draft.ratio, '1:1')
      assert.equal(context.directorRun('run-1').draft.resolution, '2K')
      assert.equal(context.directorRun('run-1').draft.count, 1)
      assert.equal(uncertain.data.generation.clientTaskId, 'director-stable-key')
    },
  )
})

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
