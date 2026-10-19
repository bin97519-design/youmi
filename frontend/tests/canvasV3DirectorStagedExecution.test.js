import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { createDirectorImageExecutionIntent } from '../src/features/canvas-v3/config/directorImageExecution.js'
import {
  resolveConfiguredImageTaskModel,
  resolveDirectorImageTaskModel,
} from '../src/features/canvas-v3/config/directorModelCatalog.js'
import {
  DIRECTOR_REFERENCE_IMAGE_LIMIT,
  directorImageSourceMode,
  isDirectorClarificationComplete,
  isDirectorClarificationReady,
  normalizeDirectorClarificationAnswers,
  normalizeDirectorQuestions,
} from '../src/features/canvas-v3/config/directorClarifications.js'
import { directorClarificationAssetsIntent } from '../src/features/canvas-v3/config/directorConversation.js'
import {
  directorApplyImageSourceIntent,
  directorReferenceImages,
} from '../src/features/canvas-v3/config/directorImageSources.js'
import { canCreateAgentDraft } from '../src/utils/agentDraft.js'

const shell = await readFile(
  new URL('../src/features/canvas-v3/components/CanvasV3Shell.vue', import.meta.url),
  'utf8',
)
const functionNames = [
  'directorRun',
  'updateDirectorRun',
  'directorImagePlan',
  'directorSubmissionStarted',
  'directorDraftFromIntent',
  'ensureDirectorDraftNode',
  'prepareDirectorGeneration',
  'submitDirectorDraft',
  'confirmDirectorGeneration',
  'resolveDirectorModels',
  'normalizeDirectorPrompts',
  'readDirectorApiResponse',
  'applyDirectorThinkingEvent',
  'readDirectorStream',
  'planDirectorMessage',
  'handleDirectorClarification',
]
const functionSource = functionNames
  .map((name) => {
    const body = shell.match(
      new RegExp(`^(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?^\\}`, 'm'),
    )?.[0]
    assert.ok(body, `missing actual Shell function: ${name}`)
    return body
  })
  .join('\n\n')

const plain = (value) => JSON.parse(JSON.stringify(value))
const imageModels = [
  { value: 'banana2', label: 'Banana 2' },
  { value: 'banana-pro-api', label: 'Banana Pro' },
]
const confirmedSettings = { model: 'banana2', ratio: '1:1', resolution: '2K', count: 1 }

function makeHarness(options = {}) {
  const references = options.references || []
  const intent = Object.freeze({
    generationType: 'image',
    requestedModels: Object.freeze([]),
    nodeModel: '',
    ratio: '16:9',
    resolution: '2K',
    count: 1,
    quality: '标准画质',
    background: '自动',
    width: 1920,
    height: 1080,
    selectedLayerIds: Object.freeze([]),
    attachments: Object.freeze([]),
    referenceLayerIds: Object.freeze(
      references.map((reference) => reference.layerId || reference.id),
    ),
    referenceAssets: Object.freeze(references.map((reference) => Object.freeze({ ...reference }))),
    ...options.intent,
  })
  const run = {
    id: 'run-1',
    instruction: '生成一张灰色简约床垫卧室场景图',
    clientTaskId: 'director-image-stable-key',
    phase: 'complete',
    contentReady: true,
    dryRun: true,
    generationIntent: intent,
    proposal: {
      generationType: 'image',
      prompt: '灰色简约床垫，卧室家居场景，保持商品外观，不添加性能声明。',
      referenceAssets: references.map((reference) => ({ ...reference })),
      model: 'untrusted-agent-model',
      ratio: '9:21',
      resolution: '4K',
      count: 4,
    },
    draft: null,
    nodeId: '',
    submissionStarted: false,
    submissionState: '',
    error: '',
    ...options.run,
  }
  const nodes = { value: plain(options.nodes || []) }
  const directorAgentRuns = { value: [run] }
  const calls = []
  const edges = []
  let nextId = 0
  let saveResult = options.saveResult ?? true
  const graph = {
    edges,
    addNode(kind, position) {
      const node = {
        id: `created-${++nextId}`,
        position: position || { x: 0, y: 0 },
        data: { kind, title: '图片节点 1', params: {}, runState: 'idle' },
      }
      nodes.value.push(node)
      calls.push({ type: 'addNode', id: node.id })
      return node
    },
    createImageVariation(source, data) {
      const node = this.addNode('image', { x: 360, y: 0 })
      this.updateNodeData(node.id, data)
      calls.push({ type: 'variation', source, target: node.id })
      return node
    },
    updateNodeData(id, patch) {
      const node = nodes.value.find((candidate) => candidate.id === id)
      assert.ok(node, `attempted update of missing node ${id}`)
      node.data = { ...node.data, ...patch }
    },
    connect(edge) {
      if (
        !edges.some(
          (existing) => existing.source === edge.source && existing.target === edge.target,
        )
      )
        edges.push(edge)
    },
  }
  const tasks = {
    imageModels: options.models ?? imageModels,
    modelError: options.modelError || '',
    async loadModels() {
      calls.push({ type: 'loadModels' })
    },
    async runImage(id, focus, request) {
      calls.push({ type: 'runImage', id, clientTaskId: request.clientTaskId })
      request.onSubmitStart({ clientTaskId: request.clientTaskId })
      graph.updateNodeData(id, {
        runState: 'queued',
        generation: { clientTaskId: request.clientTaskId, taskIds: ['provider-task-1'] },
      })
      if (options.runImage) await options.runImage({ id, request, graph, nodes })
    },
    async resume(id) {
      calls.push({ type: 'resume', id })
      graph.updateNodeData(id, { runState: 'running' })
      if (options.resume) await options.resume({ id, graph, nodes })
    },
  }
  const context = {
    directorAgentRuns,
    nodes,
    graph,
    tasks,
    user: { requireLogin: () => options.loggedIn !== false, authHeaders: () => ({}) },
    props: { projectId: 'staged-execution-test' },
    directorConversationId: { value: 'conversation-test' },
    directorPlanningRequests: new Map(),
    directorGenerationSubmissions: new Set(),
    directorNodePreparations: new Map(),
    scheduleDirectorConversationSync() {},
    directorDraftPosition: () => ({ x: 180, y: 140 }),
    nextTick: async () => {},
    async saveNow() {
      calls.push({ type: 'save' })
      return saveResult
    },
    focusStoryboard: async (node) => calls.push({ type: 'focus', id: node.id }),
    focusGenerated() {},
    createDirectorImageExecutionIntent,
    resolveConfiguredImageTaskModel,
    resolveDirectorImageTaskModel,
    normalizeDirectorQuestions,
    normalizeDirectorClarificationAnswers,
    isDirectorClarificationComplete,
    isDirectorClarificationReady,
    directorImageSourceMode,
    DIRECTOR_REFERENCE_IMAGE_LIMIT,
    directorClarificationAssetsIntent,
    directorApplyImageSourceIntent,
    directorReferenceImages,
    canCreateAgentDraft,
    createDirectorGenerationIntent: () => ({ attachments: [] }),
    handleDirectorSubmit(message, inheritedIntent) {
      calls.push({ type: 'clarificationSubmit', message, inheritedIntent })
      return 'clarification-continuation'
    },
    directorHistory: () => [],
    directorRequestLayers: () => [],
    apiPath: (url) => url,
    AbortController,
    TextDecoder,
    Uint8Array,
    async fetch(url, request) {
      const payload = JSON.parse(request.body)
      calls.push({ type: 'chat', url, payload })
      if (options.beforeChatResponse) await options.beforeChatResponse(context)
      const response = options.chatResponse || {
        readyToGenerate: true,
        generationType: 'image',
        reply: '图片方案已完成。',
        draftPrompt: '灰色床垫，现代卧室场景，保持真实外观。',
        questions: [],
      }
      const encoded = new TextEncoder().encode(
        [
          { type: 'thinking_delta', delta: '正在整理图片创作方案' },
          { type: 'reply_delta', delta: '图片方案已完成。' },
          { type: 'result', data: response },
        ]
          .map((event) => JSON.stringify(event))
          .join('\n') + '\n',
      )
      const chunks = [encoded.slice(0, 7), encoded.slice(7, 29), encoded.slice(29)]
      return {
        ok: true,
        body: {
          getReader() {
            let index = 0
            return {
              async read() {
                return index < chunks.length
                  ? { done: false, value: chunks[index++] }
                  : { done: true }
              },
              releaseLock() {
                calls.push({ type: 'streamReleased' })
              },
            }
          },
        },
      }
    },
  }
  runInNewContext(functionSource, context)
  return {
    context,
    calls,
    nodes: nodes.value,
    edges,
    originalIntent: intent,
    run: () => directorAgentRuns.value[0],
    setSaveResult(value) {
      saveResult = value
    },
  }
}

test('a complete image proposal creates a saved free canvas node without selecting a paid model', async () => {
  const harness = makeHarness()
  const target = await harness.context.ensureDirectorDraftNode('run-1')

  assert.equal(harness.nodes.length, 1)
  assert.equal(harness.run().nodeId, target.id)
  assert.equal(target.data.directorRunId, 'run-1')
  assert.match(target.data.prompt, /灰色简约床垫/)
  assert.equal(target.data.model, '', 'Agent proposal must not pick the execution model')
  assert.equal(target.data.params.ratio, '16:9', 'Agent proposal must not override frozen ratio')
  assert.equal(target.data.generation?.clientTaskId, undefined)
  assert.equal(harness.run().submissionStarted, false)
  assert.equal(harness.calls.filter((call) => call.type === 'save').length, 1)
  assert.equal(
    harness.calls.some((call) => ['runImage', 'resume', 'loadModels'].includes(call.type)),
    false,
  )
})

test('simultaneous preparations and history restoration reuse the same Director node', async () => {
  const harness = makeHarness()
  const [first, concurrent] = await Promise.all([
    harness.context.ensureDirectorDraftNode('run-1'),
    harness.context.ensureDirectorDraftNode('run-1'),
  ])
  assert.equal(first.id, concurrent.id)
  assert.equal(harness.nodes.length, 1)

  harness.context.updateDirectorRun('run-1', { nodeId: '' })
  const restored = await harness.context.ensureDirectorDraftNode('run-1')
  assert.equal(restored.id, first.id)
  assert.equal(harness.run().nodeId, first.id)
  assert.equal(harness.nodes.length, 1)
  assert.equal(harness.calls.filter((call) => call.type === 'addNode').length, 1)
})

test('uploaded and library image snapshots become connected reference nodes, without paid submission', async () => {
  const harness = makeHarness({
    references: [
      {
        id: 'upload-1',
        layerId: 'upload-1',
        kind: 'image',
        source: 'upload',
        name: '商品图',
        url: 'https://assets.test/product.png',
      },
      {
        id: 'library-1',
        layerId: 'library-1',
        kind: 'image',
        source: 'library',
        name: '风格图',
        url: 'https://assets.test/style.png',
      },
    ],
  })
  const target = await harness.context.ensureDirectorDraftNode('run-1')
  const references = harness.nodes.filter((node) => node.id !== target.id)
  assert.equal(references.length, 2)
  assert.deepEqual(
    references.map((node) => node.data.assetUrl),
    ['https://assets.test/product.png', 'https://assets.test/style.png'],
  )
  assert.equal(harness.edges.length, 2)
  assert.ok(harness.edges.every((edge) => edge.target === target.id))
  assert.equal(
    harness.calls.some((call) => call.type === 'runImage'),
    false,
  )

  await harness.context.ensureDirectorDraftNode('run-1')
  assert.equal(harness.nodes.length, 3)
  assert.equal(harness.edges.length, 2)
})

test('changed or removed canvas reference identities cannot silently use another product image', async () => {
  const reference = {
    id: 'original',
    layerId: 'original',
    kind: 'image',
    source: 'canvas',
    url: 'https://assets.test/old.png',
  }
  const changed = makeHarness({
    references: [reference],
    nodes: [
      {
        id: 'original',
        position: { x: 0, y: 0 },
        data: { kind: 'image', assetUrl: 'https://assets.test/new.png' },
      },
    ],
  })
  await assert.rejects(
    changed.context.ensureDirectorDraftNode('run-1'),
    /参考图片在发送后已发生变化/,
  )
  assert.equal(changed.nodes.length, 1)

  const removed = makeHarness({
    references: [reference],
    nodes: [
      { id: 'other', position: { x: 0, y: 0 }, data: { kind: 'image', assetUrl: reference.url } },
    ],
  })
  await assert.rejects(removed.context.ensureDirectorDraftNode('run-1'), /参考素材已移除/)
  assert.equal(removed.nodes.length, 1)
  assert.equal(
    removed.calls.some((call) => call.type === 'runImage'),
    false,
  )
})

test('save failure is visible and cannot trigger a paid request; preparation can be retried', async () => {
  const harness = makeHarness({ saveResult: false })
  await harness.context.prepareDirectorGeneration('run-1')
  assert.match(harness.run().error, /尚未保存成功/)
  assert.equal(
    harness.calls.some((call) => call.type === 'runImage'),
    false,
  )
  harness.setSaveResult(true)
  await harness.context.prepareDirectorGeneration('run-1')
  assert.equal(harness.run().error, '')
  assert.equal(harness.nodes.length, 1)
})

test('user confirmation promotes a proposal with strict real model settings and submits the prepared node once', async () => {
  const harness = makeHarness()
  const staged = await harness.context.ensureDirectorDraftNode('run-1')
  await Promise.all([
    harness.context.confirmDirectorGeneration('run-1', confirmedSettings),
    harness.context.confirmDirectorGeneration('run-1', confirmedSettings),
  ])

  const submissions = harness.calls.filter((call) => call.type === 'runImage')
  assert.equal(submissions.length, 1)
  assert.equal(submissions[0].id, staged.id)
  assert.equal(submissions[0].clientTaskId, 'director-image-stable-key')
  assert.equal(harness.nodes.length, 1)
  assert.equal(harness.run().proposal, null)
  assert.equal(harness.run().draft.model, 'banana2')
  assert.equal(harness.run().draft.ratio, '1:1')
  assert.equal(harness.run().draft.resolution, '2K')
  assert.equal(harness.run().draft.count, 1)
  assert.equal(harness.run().generationIntent.executionConfirmed, true)
  assert.ok(Object.isFrozen(harness.run().generationIntent))
  assert.equal(harness.run().generationIntent.width, null)
  assert.equal(harness.originalIntent.nodeModel, '')
  assert.equal(harness.originalIntent.ratio, '16:9')
  assert.equal(harness.run().phase, 'submitted')
  assert.equal(harness.run().submissionStarted, true)
  assert.equal(staged.data.generation.clientTaskId, 'director-image-stable-key')
})

test('missing or unconfigured settings keep the actionable proposal and never create paid tasks', async () => {
  for (const settings of [
    undefined,
    { ...confirmedSettings, model: 'Banana 2' },
    { ...confirmedSettings, model: 'untrusted-agent-model' },
  ]) {
    const harness = makeHarness()
    await harness.context.ensureDirectorDraftNode('run-1')
    await harness.context.confirmDirectorGeneration('run-1', settings)
    assert.equal(
      harness.calls.some((call) => call.type === 'runImage'),
      false,
    )
    assert.equal(harness.run().draft, null)
    assert.ok(harness.run().proposal)
    assert.equal(harness.run().generationIntent.executionConfirmed, undefined)
    if (settings) assert.match(harness.run().error, /请选择.*已配置.*模型/)
  }
})

test('unfinished questions and explicitly non-ready plans do not stage image nodes', async () => {
  for (const patch of [{ questions: [{ question: '商品是什么？' }] }, { contentReady: false }]) {
    const harness = makeHarness({ run: patch })
    await assert.rejects(harness.context.ensureDirectorDraftNode('run-1'), /尚未准备完整/)
    assert.equal(harness.nodes.length, 0)
    assert.equal(harness.calls.length, 0)
  }
})

test('uncertain submissions recover the original key before model validation and never POST again', async () => {
  const node = {
    id: 'submitted-node',
    position: { x: 0, y: 0 },
    data: {
      kind: 'image',
      model: 'retired-model',
      runState: 'uncertain',
      generation: { clientTaskId: 'director-image-stable-key', taskIds: [] },
    },
  }
  const harness = makeHarness({
    nodes: [node],
    models: [],
    modelError: '模型服务暂时不可用',
    run: {
      phase: 'ready',
      submissionStarted: true,
      submissionState: 'uncertain',
      nodeId: node.id,
      draft: {
        generationType: 'image',
        prompt: '已确认的床垫图片',
        model: 'retired-model',
        ratio: '16:9',
        resolution: '2K',
        count: 1,
      },
    },
  })
  await harness.context.confirmDirectorGeneration('run-1', {
    ...confirmedSettings,
    model: 'replacement-model',
  })
  assert.deepEqual(
    harness.calls.filter((call) => ['resume', 'loadModels', 'runImage'].includes(call.type)),
    [{ type: 'resume', id: node.id }],
  )
  assert.equal(harness.run().draft.model, 'retired-model')
  assert.equal(harness.run().phase, 'submitted')
  assert.equal(harness.nodes.length, 1)
  assert.equal(harness.nodes[0].data.generation.clientTaskId, 'director-image-stable-key')
})

test('lost uncertain nodes rebuild a saved read-only recovery holder for the same stable key', async () => {
  const harness = makeHarness({
    models: [],
    modelError: '模型服务暂时不可用',
    run: {
      phase: 'ready',
      submissionStarted: true,
      submissionState: 'uncertain',
      nodeId: 'lost-node',
      draft: {
        generationType: 'image',
        prompt: '原已确认图片',
        model: 'retired-model',
        ratio: '16:9',
        resolution: '2K',
        count: 1,
      },
    },
  })
  await harness.context.submitDirectorDraft('run-1')
  assert.equal(harness.nodes.length, 1)
  const recovery = harness.nodes[0]
  assert.equal(recovery.data.generation.clientTaskId, 'director-image-stable-key')
  assert.equal(harness.run().nodeId, recovery.id)
  assert.ok(
    harness.calls.findIndex((call) => call.type === 'save') <
      harness.calls.findIndex((call) => call.type === 'resume'),
  )
  assert.equal(harness.calls.filter((call) => call.type === 'resume').length, 1)
  assert.equal(
    harness.calls.some((call) => ['loadModels', 'runImage'].includes(call.type)),
    false,
  )
})

test('restoring a submitted run with a lost node never stages an empty replacement node', async () => {
  const harness = makeHarness({
    run: {
      phase: 'submitted',
      submissionStarted: true,
      submissionState: 'running',
      nodeId: 'lost-submitted-node',
    },
  })
  await assert.rejects(
    harness.context.ensureDirectorDraftNode('run-1'),
    /原任务节点暂不可用.*不会创建新的生成任务/,
  )
  assert.equal(harness.nodes.length, 0)
  assert.equal(harness.calls.length, 0)

  await harness.context.prepareDirectorGeneration('run-1')
  assert.match(harness.run().error, /原任务节点暂不可用/)
  assert.equal(harness.nodes.length, 0)
  assert.equal(harness.run().nodeId, 'lost-submitted-node')
  assert.equal(harness.run().submissionStarted, true)
})

test('a matching node task key is authoritative even when the conversation submission flag was lost', async () => {
  for (const nodeState of ['uncertain', 'failed', 'paused']) {
    const node = {
      id: 'existing-task-node',
      position: { x: 0, y: 0 },
      data: {
        kind: 'image',
        directorRunId: 'run-1',
        model: 'retired-model',
        prompt: '已提交的商品图',
        params: { ratio: '16:9', resolution: '2K', count: '1张' },
        runState: nodeState,
        generation: { clientTaskId: 'director-image-stable-key', taskIds: ['original-task'] },
      },
    }
    const harness = makeHarness({
      nodes: [node],
      models: [],
      modelError: '模型目录暂时不可用',
      run: {
        phase: 'submitted',
        submissionStarted: false,
        submissionState: '',
        nodeId: node.id,
        draft: {
          generationType: 'image',
          prompt: node.data.prompt,
          model: 'retired-model',
          ratio: '16:9',
          resolution: '2K',
          count: 1,
        },
      },
    })
    assert.equal(harness.context.directorSubmissionStarted(harness.run()), true)
    await harness.context.confirmDirectorGeneration('run-1', confirmedSettings)
    assert.deepEqual(
      harness.calls.filter((call) => ['resume', 'loadModels', 'runImage'].includes(call.type)),
      [{ type: 'resume', id: node.id }],
      `${nodeState} must recover the original task without another submission`,
    )
    assert.equal(harness.run().submissionStarted, true)
    assert.equal(harness.run().draft.model, 'retired-model')
    assert.equal(harness.nodes.length, 1)
    assert.equal(harness.nodes[0].data.generation.clientTaskId, 'director-image-stable-key')
    assert.equal(harness.run().phase, 'submitted')
  }
})

test('a node owned by a different task cannot be overwritten by preparation or a new confirmation', async () => {
  const node = {
    id: 'foreign-task-node',
    position: { x: 300, y: 200 },
    data: {
      kind: 'image',
      title: '另一个生成任务',
      model: 'banana-pro-api',
      prompt: '已确认的另一个商品图片',
      params: { ratio: '3:4', resolution: '4K', count: '2张', width: 1536, height: 2048 },
      runState: 'running',
      generation: { clientTaskId: 'unrelated-stable-key', taskIds: ['unrelated-provider-task'] },
    },
  }
  const harness = makeHarness({ nodes: [node], run: { nodeId: node.id } })
  assert.equal(harness.context.directorSubmissionStarted(harness.run()), false)
  await assert.rejects(
    harness.context.ensureDirectorDraftNode('run-1'),
    /此节点已从画布发起过生成.*不会覆盖或重复提交/,
  )
  assert.deepEqual(plain(harness.nodes[0].data), node.data)

  await harness.context.confirmDirectorGeneration('run-1', confirmedSettings)
  assert.match(harness.run().error, /不会覆盖或重复提交/)
  assert.deepEqual(plain(harness.nodes[0].data), node.data)
  assert.equal(harness.nodes.length, 1)
  assert.equal(
    harness.calls.some((call) => ['runImage', 'resume'].includes(call.type)),
    false,
  )
})

test('user-added incoming image or text edges block paid submission without removing the user connection', async () => {
  for (const kind of ['image', 'text']) {
    const product = {
      id: 'product-reference',
      position: { x: 0, y: 0 },
      data: { kind: 'image', assetUrl: 'https://assets.test/product.png' },
    }
    const extra = {
      id: 'user-added-reference',
      position: { x: 0, y: 100 },
      data: {
        kind,
        assetUrl: kind === 'image' ? 'https://assets.test/another-product.png' : '',
        prompt: kind === 'text' ? '用户另外连接的文案' : '',
      },
    }
    const harness = makeHarness({
      nodes: [product, extra],
      references: [
        {
          id: product.id,
          layerId: product.id,
          kind: 'image',
          source: 'canvas',
          url: product.data.assetUrl,
        },
      ],
    })
    const target = await harness.context.ensureDirectorDraftNode('run-1')
    const preparedData = plain(target.data)
    assert.equal(harness.edges.length, 1)
    harness.context.graph.connect({
      source: extra.id,
      target: target.id,
      sourceHandle: 'output',
      targetHandle: 'input',
    })

    await harness.context.confirmDirectorGeneration('run-1', confirmedSettings)
    assert.match(harness.run().error, /参考连接已被修改.*未提交生图任务/)
    assert.equal(
      harness.calls.some((call) => ['runImage', 'resume'].includes(call.type)),
      false,
    )
    assert.equal(harness.edges.length, 2)
    assert.ok(harness.edges.some((edge) => edge.source === product.id && edge.target === target.id))
    assert.ok(harness.edges.some((edge) => edge.source === extra.id && edge.target === target.id))
    assert.deepEqual(plain(target.data), preparedData)
    assert.equal(target.data.generation?.clientTaskId, undefined)
    assert.equal(harness.run().submissionStarted, false)
  }
})

test('automatic planning saves a free node before submitting the exact send-time model once', async () => {
  const harness = makeHarness({
    run: { dryRun: false },
    intent: {
      requestedModels: [{ id: 'banana2', name: 'Banana 2', modality: 'image' }],
      nodeModel: 'banana2',
      executionConfirmed: true,
    },
    chatResponse: {
      readyToGenerate: true,
      generationType: 'image',
      reply: '场景图方案已准备好。',
      draftPrompt: '保持灰色床垫的真实外观，呈现自然光卧室场景。',
      questions: [],
      model: 'agent-cannot-change-this',
      imageModels: ['agent-cannot-change-this'],
      ratio: '9:21',
      resolution: '4K',
      count: 4,
    },
    beforeChatResponse(context) {
      // A later switch to manual mode cannot change authorization frozen on this message.
      context.directorDryRun = { value: true }
    },
  })
  await harness.context.planDirectorMessage('run-1')

  const submissions = harness.calls.filter((call) => call.type === 'runImage')
  assert.equal(submissions.length, 1)
  assert.equal(harness.nodes.length, 1)
  assert.equal(submissions[0].id, harness.run().nodeId)
  assert.equal(submissions[0].clientTaskId, 'director-image-stable-key')
  assert.ok(
    harness.calls.findIndex((call) => call.type === 'save') <
      harness.calls.findIndex((call) => call.type === 'runImage'),
  )
  assert.equal(harness.run().dryRun, false)
  assert.equal(harness.run().phase, 'submitted')
  assert.equal(harness.run().draft.model, 'banana2')
  assert.equal(harness.run().draft.ratio, '16:9')
  assert.equal(harness.run().draft.resolution, '2K')
  assert.equal(harness.run().draft.count, 1)
  const chat = harness.calls.find((call) => call.type === 'chat')
  assert.equal(chat.url, '/api/ai/canvas-agent/chat/stream')
  assert.deepEqual(chat.payload.models, ['banana2'])
  assert.equal(harness.calls.filter((call) => call.type === 'streamReleased').length, 1)
  assert.equal(harness.context.directorPlanningRequests.size, 0)
})

test('manual planning creates the node without a paid submission even if the later picker is automatic', async () => {
  const harness = makeHarness({
    run: { dryRun: true },
    intent: {
      requestedModels: [{ id: 'banana2', name: 'Banana 2', modality: 'image' }],
      nodeModel: 'banana2',
      executionConfirmed: true,
    },
    beforeChatResponse(context) {
      context.directorDryRun = { value: false }
    },
  })
  await harness.context.planDirectorMessage('run-1')

  assert.equal(harness.nodes.length, 1)
  assert.equal(harness.run().nodeId, harness.nodes[0].id)
  assert.equal(harness.nodes[0].data.model, 'banana2')
  assert.equal(harness.nodes[0].data.generation?.clientTaskId, undefined)
  assert.equal(harness.run().submissionStarted, false)
  assert.equal(harness.run().dryRun, true)
  assert.equal(harness.run().phase, 'ready')
  assert.equal(harness.run().contentReady, true)
  assert.equal(harness.calls.filter((call) => call.type === 'save').length, 1)
  assert.equal(
    harness.calls.some((call) => ['runImage', 'resume'].includes(call.type)),
    false,
  )
})

test('automatic authorization without a send-time model prepares an actionable node but never invents a paid model', async () => {
  const harness = makeHarness({ run: { dryRun: false } })
  await harness.context.planDirectorMessage('run-1')

  assert.equal(harness.nodes.length, 1)
  assert.equal(harness.run().nodeId, harness.nodes[0].id)
  assert.equal(harness.run().draft, null)
  assert.ok(harness.run().proposal?.prompt)
  assert.match(harness.run().error, /确认生图模型和参数/)
  assert.equal(harness.nodes[0].data.model, '')
  assert.equal(harness.nodes[0].data.generation?.clientTaskId, undefined)
  assert.equal(
    harness.calls.some((call) => ['runImage', 'resume'].includes(call.type)),
    false,
  )
})

test('ordinary clarification answers preserve the source task policy and cannot grant automatic paid approval', () => {
  for (const sourceDryRun of [true, false, undefined]) {
    const harness = makeHarness({
      run: {
        phase: 'awaiting_input',
        contentReady: false,
        dryRun: sourceDryRun,
        questions: [
          {
            id: 'direction',
            question: '这张商品图使用什么方向？',
            options: ['卧室场景图', '材质细节图'],
          },
        ],
      },
    })
    let completion
    harness.context.handleDirectorClarification(
      'run-1',
      {
        id: 'answer-message',
        content: '直接开始生成，沿用 banana2、16:9、2K、1张。',
        dryRunIntent: sourceDryRun === false,
        context: {
          clarification: {
            sourceRunId: 'run-1',
            answers: [
              {
                questionId: 'direction',
                answer: '卧室场景图，直接开始生成，沿用 banana2、16:9、2K、1张。',
              },
            ],
          },
        },
      },
      (result) => {
        completion = result
      },
    )

    const continuation = harness.calls.find((call) => call.type === 'clarificationSubmit')
    assert.ok(continuation)
    assert.equal(continuation.message.dryRunIntent, sourceDryRun !== false)
    assert.equal(continuation.inheritedIntent, harness.originalIntent)
    assert.equal(continuation.inheritedIntent.nodeModel, '')
    assert.deepEqual(continuation.inheritedIntent.requestedModels, [])
    assert.equal(continuation.inheritedIntent.executionConfirmed, undefined)
    assert.equal(completion.ok, true)
    assert.equal(harness.run().clarificationReplyRunId, 'clarification-continuation')
    assert.equal(
      harness.calls.some((call) => ['runImage', 'resume', 'loadModels'].includes(call.type)),
      false,
    )
  }
})
