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
  directorScriptSourceMode,
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
import {
  directorApplyScriptSourceIntent,
  directorScriptBrief,
  directorScriptReferenceCandidates,
} from '../src/features/canvas-v3/config/directorScriptReferences.js'
import { canCreateAgentDraft } from '../src/utils/agentDraft.js'
import {
  directorActiveTask,
  directorCurrentReferenceLayerIds,
  directorPendingClarificationRun,
  directorResponseRouting,
  directorSwitchReferenceIntent,
  directorTurnContext,
} from '../src/features/canvas-v3/config/directorRouting.js'

const shell = await readFile(
  new URL('../src/features/canvas-v3/components/CanvasV3Shell.vue', import.meta.url),
  'utf8',
)
const functionNames = [
  'directorRun',
  'updateDirectorRun',
  'serializedDirectorRun',
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
    directorDisplayRuns: {
      get value() {
        return directorAgentRuns.value
      },
    },
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
    directorScriptSourceMode,
    directorApplyScriptSourceIntent,
    directorScriptBrief,
    DIRECTOR_REFERENCE_IMAGE_LIMIT,
    directorClarificationAssetsIntent,
    directorApplyImageSourceIntent,
    directorReferenceImages,
    canCreateAgentDraft,
    directorPendingClarificationRun,
    directorResponseRouting,
    directorCurrentReferenceLayerIds,
    directorSwitchReferenceIntent,
    directorTurnContext,
    directorInstruction: (message) => message.content || '',
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

function routing(overrides = {}) {
  return {
    context: 'task',
    relation: 'continue',
    turn: 'request',
    task: 'image_generation',
    action: 'prepare_draft',
    stage: 'draft_ready',
    summary: '制作一张床垫商品主图',
    ...overrides,
  }
}

test('new routing blocks stale media prompts on greetings, replies, clarification and textual confirmation', async () => {
  const questions = [{ id: 'direction', question: '选择方向？', options: ['主图', '场景图'] }]
  for (const route of [
    routing({
      context: 'conversation',
      task: 'conversation',
      turn: 'greeting',
      action: 'reply',
      stage: 'idle',
    }),
    routing({ turn: 'question', action: 'reply', stage: 'discussing' }),
    routing({ action: 'clarify', stage: 'awaiting_input' }),
    routing({ turn: 'confirmation', action: 'await_confirmation' }),
    routing({ turn: 'cancel', stage: 'cancelled' }),
    routing({ action: 'unexpected_action' }),
    null,
  ]) {
    const h = makeHarness({
      run: { instruction: '你好', dryRun: false },
      intent: { nodeModel: 'banana2' },
      chatResponse: {
        routing: route,
        reply: '你好！',
        readyToGenerate: true,
        generationType: 'image',
        draftPrompt: '错误附带的旧床垫生图草稿',
        questions: route?.action === 'clarify' ? questions : [],
      },
    })
    await h.context.planDirectorMessage('run-1')
    assert.equal(h.run().draft, null)
    assert.equal(h.run().proposal, null)
    assert.equal(h.run().contentReady, false)
    assert.equal(h.nodes.length, 0)
    assert.equal(
      h.calls.some((call) => ['runImage', 'resume'].includes(call.type)),
      false,
    )
    if (route?.action === 'clarify') assert.equal(h.run().questions.length, 1)
    else assert.equal(h.run().questions.length, 0)
    assert.deepEqual(plain(h.run().routing), route?.action === 'unexpected_action' ? null : route)
  }
})

test('read-only reference drafts never prepare or submit an image node', async () => {
  const h = makeHarness({
    run: { dryRun: false },
    intent: { nodeModel: 'banana2' },
    chatResponse: {
      routing: routing({ task: 'reference_analysis' }),
      reply: '参考图分析已整理。',
      readyToGenerate: true,
      generationType: 'image',
      draftPrompt: '参考画面构图分析，只读说明',
      questions: [],
    },
  })
  await h.context.planDirectorMessage('run-1')
  assert.equal(h.run().draft, null)
  assert.equal(h.run().proposal.prompt, '参考画面构图分析，只读说明')
  assert.equal(h.run().contentReady, false)
  assert.equal(h.nodes.length, 0)
  assert.equal(
    h.calls.some((call) => call.type === 'runImage'),
    false,
  )
})

test('valid preparation still obeys frozen models and authorization, while mismatched task types fail closed', async () => {
  for (const task of ['image_generation', 'video_script', 'video_generation']) {
    const h = makeHarness({
      run: { dryRun: false },
      intent: { nodeModel: 'banana2', ratio: '1:1', resolution: '2K', count: 1 },
      chatResponse: {
        routing: routing({ task }),
        reply: '已整理方案',
        readyToGenerate: true,
        generationType: 'image',
        draftPrompt: '一张床垫商品主图',
        imageModel: 'untrusted-other-model',
        ratio: '9:16',
        resolution: '4K',
        count: 4,
        questions: [],
      },
    })
    await h.context.planDirectorMessage('run-1')
    if (task === 'image_generation') {
      assert.equal(h.calls.filter((call) => call.type === 'runImage').length, 1)
      assert.equal(h.run().draft.model, 'banana2')
      assert.equal(h.run().draft.ratio, '1:1')
      assert.equal(h.run().draft.resolution, '2K')
      assert.equal(h.run().draft.count, 1)
    } else {
      assert.equal(h.run().draft, null)
      assert.equal(h.nodes.length, 0)
      assert.equal(
        h.calls.some((call) => call.type === 'runImage'),
        false,
      )
    }
  }
})

test('clarification request carries its raw latest answer separately from prior task and question context', async () => {
  const parent = {
    id: 'parent-task',
    phase: 'awaiting_input',
    reply: '请确认方向',
    message: { content: '帮我制作绵绵岛床垫商品主图' },
    routing: routing({ action: 'clarify', stage: 'awaiting_input' }),
    questions: [{ id: 'direction', question: '主方向？', options: ['白底图', '卧室场景'] }],
  }
  const h = makeHarness({
    run: {
      instruction: '旧拼接链：原始需求、此前补充和本轮答案',
      message: {
        content: '卧室场景，奶油色背景',
        context: { clarification: { sourceRunId: 'parent-task' } },
      },
    },
    chatResponse: { routing: routing({ action: 'reply', stage: 'discussing' }), reply: '已记录。' },
  })
  h.context.directorAgentRuns.value.unshift(parent)
  await h.context.planDirectorMessage('run-1')
  const request = h.calls.find((call) => call.type === 'chat').payload
  assert.equal(request.instruction, '卧室场景，奶油色背景')
  assert.equal(request.turnContext.message, '卧室场景，奶油色背景')
  assert.equal(request.turnContext.source, 'clarification')
  assert.equal(request.turnContext.taskType, 'image_generation')
  assert.equal(request.turnContext.taskStage, 'awaiting_input')
  assert.deepEqual(request.turnContext.pendingQuestions, parent.questions)
  assert.doesNotMatch(request.turnContext.message, /旧拼接链|原始需求/)
})

test('a greeting does not invalidate the earlier unanswered source or change its frozen paid policy', () => {
  const h = makeHarness({
    run: {
      phase: 'awaiting_input',
      contentReady: false,
      dryRun: true,
      routing: routing({ action: 'clarify', stage: 'awaiting_input' }),
      questions: [{ id: 'direction', question: '主方向？', options: ['白底图', '卧室场景'] }],
    },
  })
  h.context.directorAgentRuns.value.push({
    id: 'greeting-run',
    phase: 'complete',
    instruction: '你好',
    reply: '你好！',
    routing: routing({
      context: 'conversation',
      task: 'conversation',
      turn: 'greeting',
      action: 'reply',
      stage: 'idle',
    }),
  })
  let completion
  h.context.handleDirectorClarification(
    'run-1',
    {
      content: '卧室场景',
      dryRunIntent: false,
      context: {
        clarification: {
          sourceRunId: 'run-1',
          answers: [{ questionId: 'direction', answer: '卧室场景' }],
        },
      },
    },
    (value) => {
      completion = value
    },
  )
  assert.equal(completion.ok, true)
  const continuation = h.calls.find((call) => call.type === 'clarificationSubmit')
  assert.equal(continuation.message.content, '卧室场景')
  assert.equal(continuation.message.dryRunIntent, true)
  assert.equal(continuation.inheritedIntent, h.originalIntent)
  assert.equal(
    h.calls.some((call) => call.type === 'runImage'),
    false,
  )
})

test('route metadata including malformed new routing survives the conversation persistence whitelist', () => {
  for (const value of [routing(), null]) {
    const h = makeHarness({ run: { routing: value } })
    const restored = plain(h.context.serializedDirectorRun(h.run()))
    assert.deepEqual(restored.routing, value)
    assert.equal(directorResponseRouting(restored).allowsDraft, Boolean(value))
  }
})

test('restored wrong-action or wrong-media routes cannot prepare or directly submit a stale image draft', async () => {
  for (const value of [
    routing({ action: 'reply' }),
    routing({ action: 'clarify' }),
    routing({ action: 'await_confirmation' }),
    routing({ task: 'video_script' }),
    routing({ task: 'video_generation' }),
    null,
  ]) {
    const h = makeHarness({
      run: {
        routing: value,
        dryRun: false,
        phase: 'ready',
        draft: { generationType: 'image', prompt: '已恢复的旧图草稿', model: 'banana2' },
      },
    })
    assert.equal(h.context.directorImagePlan(h.run()), null)
    await h.context.submitDirectorDraft('run-1')
    assert.equal(h.nodes.length, 0)
    assert.equal(
      h.calls.some((call) => call.type === 'runImage'),
      false,
    )
  }
})

test('a new ordinary request never inherits old task references, but keeps its own explicit attachments', () => {
  const source = [
    'directorRun',
    'directorRequestId',
    'positiveDirectorDimension',
    'directorCount',
    'directorInstruction',
    'createDirectorGenerationIntent',
    'handleDirectorSubmit',
  ]
    .map(
      (name) =>
        shell.match(
          new RegExp(`^(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?^\\}`, 'm'),
        )[0],
    )
    .join('\n')
  const oldImage = {
    id: 'old-product',
    layerId: 'old-product',
    kind: 'image',
    source: 'upload',
    url: 'https://assets.test/old-product.png',
  }
  const currentImage = {
    type: 'attachment',
    id: 'new-product',
    kind: 'image',
    source: 'upload',
    url: 'https://assets.test/new-product.png',
  }
  for (const parts of [[], [currentImage]]) {
    const runs = {
      value: [
        {
          id: 'old-task',
          phase: 'complete',
          reply: '上一件商品的主图已完成。',
          routing: routing({ stage: 'completed' }),
          generationIntent: { referenceAssets: [oldImage], attachments: [oldImage] },
          draft: { generationType: 'image', prompt: '上一件商品的旧主图草稿' },
        },
      ],
    }
    const planned = []
    const context = {
      directorRestoring: { value: false },
      directorRestoreError: { value: '' },
      directorAgentRuns: runs,
      directorDisplayRuns: {
        get value() {
          return runs.value
        },
      },
      graph: { selectedNodes: [] },
      directorScriptReferenceCandidates,
      directorTurnContext,
      markDirectorConversationActive() {},
      scheduleDirectorConversationSync() {},
      planDirectorMessage(id) {
        planned.push(id)
      },
    }
    runInNewContext(source, context)
    const id = context.handleDirectorSubmit({
      id: 'new-request',
      content: '换个新商品，帮我分析窗帘卖点',
      parts,
      dryRunIntent: true,
    })
    const run = runs.value.at(-1)
    assert.equal(run.id, id)
    assert.deepEqual(planned, [id])
    assert.equal(run.instruction.includes('上一件商品的旧主图草稿'), false)
    assert.equal(run.draft, null)
    assert.deepEqual(
      plain(run.generationIntent.referenceLayerIds),
      parts.length ? ['new-product'] : [],
    )
    assert.deepEqual(
      plain(run.generationIntent.referenceAssets.map((asset) => asset.url)),
      parts.length ? [currentImage.url] : [],
    )
    assert.equal(
      run.generationIntent.referenceAssets.some((asset) => asset.url === oldImage.url),
      false,
    )
    assert.equal(
      run.referenceCandidates[0].url,
      oldImage.url,
      'history is offered only as an unbound catalog for explicit later selection',
    )
  }
})

test('the backend first-turn empty context can prepare and persist an image task without weakening approval', async () => {
  for (const automatic of [false, true]) {
    const h = makeHarness({
      run: {
        dryRun: !automatic,
        message: { content: '请生成一张绵绵岛床垫的白底商品图' },
      },
      intent: { nodeModel: 'banana2' },
      chatResponse: {
        routing: routing({ context: 'empty', relation: 'standalone' }),
        reply: '商品图方案已准备好。',
        readyToGenerate: true,
        generationType: 'image',
        draftPrompt: '绵绵岛床垫，干净的纯白背景，保留已确认外观。',
        questions: [],
      },
    })
    await h.context.planDirectorMessage('run-1')
    assert.equal(h.run().routing.context, 'empty')
    assert.equal(h.run().contentReady, true)
    assert.ok(h.run().draft)
    assert.equal(h.nodes.length, 1)
    assert.equal(h.calls.filter((call) => call.type === 'runImage').length, automatic ? 1 : 0)
    const request = h.calls.find((call) => call.type === 'chat').payload
    assert.equal(request.turnContext.message, '请生成一张绵绵岛床垫的白底商品图')
    assert.equal(request.turnContext.taskType, 'conversation')
    const restored = plain(h.context.serializedDirectorRun(h.run()))
    assert.equal(restored.routing.context, 'empty')
    assert.deepEqual(restored.turnContext, request.turnContext)
    assert.equal(directorActiveTask([restored]), restored)
    assert.equal(
      directorTurnContext({ content: '改成暖光' }, [restored]).taskGoal,
      '请生成一张绵绵岛床垫的白底商品图',
    )
  }
})

test('the backend unknown unclear fallback preserves safe questions without granting media execution', async () => {
  const h = makeHarness({
    run: { dryRun: false, message: { content: '帮我做点内容' } },
    intent: { nodeModel: 'banana2' },
    chatResponse: {
      routing: routing({
        context: 'empty',
        relation: 'unclear',
        turn: 'unclear',
        task: 'unknown',
        action: 'clarify',
        stage: 'awaiting_input',
        summary: '任务方向未明确',
      }),
      reply: '想先做哪种内容？',
      readyToGenerate: true,
      generationType: 'image',
      draftPrompt: '误附旧图方案',
      questions: [{ id: 'task', question: '先做哪种内容？', options: ['商品图片', '视频脚本'] }],
    },
  })
  await h.context.planDirectorMessage('run-1')
  assert.equal(h.run().phase, 'awaiting_input')
  assert.equal(h.run().questions.length, 1)
  assert.equal(directorPendingClarificationRun(h.context.directorAgentRuns.value), h.run())
  assert.equal(h.run().draft, null)
  assert.equal(h.run().proposal, null)
  assert.equal(h.nodes.length, 0)
  assert.equal(
    h.calls.some((call) => call.type === 'runImage'),
    false,
  )
})

test('hello carrying an old task label and later bare revisions retain the real goal across actual requests and JSON restore', async () => {
  const goal = '请给绵绵岛床垫做一张电商主图，严格保留商品外观'
  const response = {
    routing: routing({
      context: 'task',
      relation: 'continue',
      turn: 'greeting',
      action: 'reply',
      stage: 'awaiting_input',
      summary: '用户只是问候，热情介绍能力',
    }),
    reply: '你好！',
    questions: [],
    readyToGenerate: true,
    generationType: 'image',
    draftPrompt: '误附旧方案',
  }
  const h = makeHarness({
    run: { instruction: '你好', message: { content: '你好' }, dryRun: false },
    intent: { nodeModel: 'banana2' },
    chatResponse: response,
  })
  const parent = {
    id: 'goal-root',
    phase: 'awaiting_input',
    message: { content: goal },
    instruction: goal,
    routing: routing({
      context: 'empty',
      relation: 'standalone',
      action: 'clarify',
      stage: 'awaiting_input',
      summary: '询问主方向',
    }),
    reply: '希望呈现什么场景？',
    questions: [{ id: 'scene', question: '场景方向？', options: ['白底', '卧室'] }],
  }
  h.context.directorAgentRuns.value.unshift(parent)
  await h.context.planDirectorMessage('run-1')
  assert.equal(directorActiveTask(h.context.directorAgentRuns.value).id, 'goal-root')
  assert.equal(directorPendingClarificationRun(h.context.directorAgentRuns.value).id, 'goal-root')
  assert.equal(h.nodes.length, 0)
  Object.assign(response, {
    routing: routing({
      context: 'task',
      relation: 'continue',
      turn: 'revision',
      action: 'clarify',
      stage: 'awaiting_input',
      summary: '用户选择暖色卧室',
    }),
    reply: '好的，再选构图。',
    questions: [{ id: 'framing', question: '构图？', options: ['全景', '近景'] }],
  })
  h.context.directorAgentRuns.value.push({
    id: 'bare-revision',
    instruction: '暖色卧室',
    message: { content: '暖色卧室' },
    generationIntent: h.originalIntent,
    dryRun: true,
  })
  await h.context.planDirectorMessage('bare-revision')
  const revisionRequest = h.calls.filter((call) => call.type === 'chat').at(-1).payload
  assert.equal(revisionRequest.instruction, '暖色卧室')
  assert.equal(revisionRequest.turnContext.message, '暖色卧室')
  assert.equal(revisionRequest.turnContext.taskGoal, goal)
  h.context.directorAgentRuns.value = plain(
    h.context.directorAgentRuns.value.map((run) => h.context.serializedDirectorRun(run)),
  )
  Object.assign(response, {
    routing: routing({
      context: 'task',
      relation: 'continue',
      turn: 'revision',
      action: 'reply',
      stage: 'discussing',
      summary: '用户选择方形构图',
    }),
    reply: '已记录。',
    questions: [],
  })
  h.context.directorAgentRuns.value.push({
    id: 'next-revision',
    instruction: '1:1',
    message: { content: '1:1' },
    generationIntent: h.originalIntent,
    dryRun: true,
  })
  await h.context.planDirectorMessage('next-revision')
  const nextRequest = h.calls.filter((call) => call.type === 'chat').at(-1).payload
  assert.equal(nextRequest.turnContext.message, '1:1')
  assert.equal(nextRequest.turnContext.taskGoal, goal)
  assert.doesNotMatch(nextRequest.turnContext.taskGoal, /问候|用户选择/)
  assert.equal(h.nodes.length, 0)
  assert.equal(
    h.calls.some((call) => call.type === 'runImage'),
    false,
  )
})

test('contradictory question, confirmation, unclear relation or non-ready stage cannot prepare paid media', async () => {
  for (const patch of [
    { turn: 'question' },
    { turn: 'confirmation' },
    { relation: 'unclear' },
    { stage: 'discussing' },
    { stage: 'awaiting_input' },
    { stage: 'running' },
    { stage: 'completed' },
  ]) {
    const h = makeHarness({
      run: { dryRun: false },
      intent: { nodeModel: 'banana2' },
      chatResponse: {
        routing: routing({ context: 'empty', relation: 'standalone', ...patch }),
        reply: '收到。',
        readyToGenerate: true,
        generationType: 'image',
        draftPrompt: '不应执行的错误草稿',
        questions: [],
      },
    })
    await h.context.planDirectorMessage('run-1')
    assert.equal(h.run().draft, null)
    assert.equal(h.run().proposal, null)
    assert.equal(h.run().contentReady, false)
    assert.equal(h.nodes.length, 0)
    assert.equal(
      h.calls.some((call) => call.type === 'runImage'),
      false,
    )
  }
})

test('switch preparation binds only response-approved current uploads, never old selected or inherited images', async () => {
  const old = {
    id: 'old-selected',
    layerId: 'old-selected',
    name: '旧床垫',
    kind: 'image',
    source: 'canvas',
    url: 'https://assets.test/old.png',
  }
  const fresh = {
    id: 'fresh-upload',
    layerId: 'fresh-upload',
    name: '新窗帘',
    kind: 'image',
    source: 'upload',
    url: 'https://assets.test/new.png',
  }
  for (const automatic of [false, true]) {
    const h = makeHarness({
      references: [old, fresh],
      run: {
        dryRun: !automatic,
        message: { content: '换成这款窗帘，生成主图', parts: [{ type: 'attachment', ...fresh }] },
      },
      intent: { nodeModel: 'banana2', selectedLayerIds: ['old-selected'], attachments: [fresh] },
      chatResponse: {
        routing: routing({ relation: 'switch' }),
        reply: '已改为新窗帘。',
        readyToGenerate: true,
        generationType: 'image',
        draftPrompt: '新窗帘商品主图，保留参考外观。',
        referenceLayerIds: ['old-selected', 'fresh-upload', 'forged-reference'],
        questions: [],
      },
    })
    await h.context.planDirectorMessage('run-1')
    const request = h.calls.find((call) => call.type === 'chat').payload
    assert.deepEqual(request.turnContext.currentReferenceLayerIds, ['fresh-upload'])
    assert.deepEqual(plain(h.run().draft.referenceLayerIds), ['fresh-upload'])
    assert.deepEqual(plain(h.run().draft.referenceAssets.map((asset) => asset.url)), [fresh.url])
    assert.deepEqual(plain(h.run().generationIntent.referenceLayerIds), ['fresh-upload'])
    assert.deepEqual(plain(h.run().generationIntent.selectedLayerIds), [])
    assert.deepEqual(plain(h.run().referenceCandidates), [])
    assert.equal(
      h.nodes.some((node) => node.data.assetUrl === old.url),
      false,
    )
    assert.equal(
      h.nodes.some((node) => node.data.assetUrl === fresh.url),
      true,
    )
    assert.equal(h.calls.filter((call) => call.type === 'runImage').length, automatic ? 1 : 0)
    assert.equal(h.run().generationIntent.nodeModel, 'banana2')
    assert.equal(h.run().generationIntent.ratio, h.originalIntent.ratio)
    assert.equal(h.run().generationIntent.resolution, h.originalIntent.resolution)
    assert.equal(h.run().dryRun, !automatic)
  }
})

test('a switch clarification clears old references and history candidates before subsequent answers', async () => {
  const old = {
    id: 'old-product',
    layerId: 'old-product',
    kind: 'image',
    source: 'library',
    url: 'https://assets.test/old-product.png',
  }
  const h = makeHarness({
    references: [old],
    run: {
      dryRun: true,
      referenceCandidates: [old],
      message: { content: '换个商品写脚本', parts: [] },
    },
    intent: {
      attachments: [old],
      selectedLayerIds: ['old-product'],
      scriptSourceMode: 'history',
      imageSourceMode: 'reference',
    },
    chatResponse: {
      routing: routing({
        relation: 'switch',
        task: 'video_script',
        action: 'clarify',
        stage: 'awaiting_input',
      }),
      reply: '请提供新商品资料。',
      referenceLayerIds: ['old-product'],
      questions: [{ id: 'basis', kind: 'script_source', question: '使用哪份新商品资料？' }],
    },
  })
  await h.context.planDirectorMessage('run-1')
  assert.deepEqual(plain(h.run().generationIntent.referenceAssets), [])
  assert.deepEqual(plain(h.run().generationIntent.referenceLayerIds), [])
  assert.deepEqual(plain(h.run().generationIntent.attachments), [])
  assert.deepEqual(plain(h.run().referenceCandidates), [])
  assert.equal(h.run().generationIntent.scriptSourceMode, '')
  let rejected
  h.context.handleDirectorClarification(
    'run-1',
    {
      content: '沿用历史商品图',
      parts: [],
      context: {
        clarification: {
          sourceRunId: 'run-1',
          answers: [{ questionId: 'basis', answer: '沿用历史商品图' }],
          referenceImageIds: ['old-product'],
        },
      },
    },
    (result) => {
      rejected = result
    },
  )
  assert.equal(rejected.ok, false, 'cleared candidates cannot silently rebind the old product')
  let completed
  h.context.handleDirectorClarification(
    'run-1',
    {
      content: '仅根据文字策划',
      parts: [],
      dryRunIntent: false,
      context: {
        clarification: {
          sourceRunId: 'run-1',
          answers: [{ questionId: 'basis', answer: '仅根据文字策划' }],
          referenceImageIds: [],
        },
      },
    },
    (result) => {
      completed = result
    },
  )
  assert.equal(completed.ok, true)
  const next = h.calls.find((call) => call.type === 'clarificationSubmit')
  assert.deepEqual(plain(next.inheritedIntent.referenceAssets), [])
  assert.deepEqual(plain(next.inheritedIntent.referenceLayerIds), [])
  assert.equal(next.inheritedIntent.ratio, h.originalIntent.ratio)
  assert.equal(next.inheritedIntent.resolution, h.originalIntent.resolution)
  assert.equal(next.message.dryRunIntent, true)
  assert.equal(
    h.calls.some((call) => call.type === 'runImage'),
    false,
  )
})

test('selecting historical script images is not a new upload when the response switches products', async () => {
  const old = {
    id: 'historical',
    layerId: 'historical',
    kind: 'image',
    source: 'library',
    url: 'https://assets.test/historical.png',
  }
  const h = makeHarness({
    references: [old],
    run: {
      message: {
        content: '现在换个商品',
        parts: [{ type: 'attachment', ...old }],
        context: { clarification: { scriptSourceMode: 'history' } },
      },
    },
    intent: {
      attachments: [old],
      selectedLayerIds: ['historical'],
      scriptSourceMode: 'history',
      imageSourceMode: 'reference',
    },
    chatResponse: {
      routing: routing({ relation: 'switch', action: 'clarify', stage: 'awaiting_input' }),
      reply: '请上传新商品图。',
      referenceLayerIds: ['historical'],
      questions: [{ id: 'upload', kind: 'image_upload', question: '上传新商品原图' }],
    },
  })
  await h.context.planDirectorMessage('run-1')
  const request = h.calls.find((call) => call.type === 'chat').payload
  assert.deepEqual(request.turnContext.currentReferenceLayerIds, [])
  assert.deepEqual(plain(h.run().generationIntent.referenceAssets), [])
  assert.deepEqual(plain(h.run().generationIntent.referenceLayerIds), [])
  assert.deepEqual(plain(h.run().generationIntent.selectedLayerIds), [])
  assert.equal(h.nodes.length, 0)
})

test('a switch questionnaire can carry the approved fresh upload into its next answer without restoring old media', async () => {
  const old = {
    id: 'old',
    layerId: 'old',
    kind: 'image',
    source: 'canvas',
    url: 'https://assets.test/old.png',
  }
  const fresh = {
    id: 'new',
    layerId: 'new',
    kind: 'image',
    source: 'upload',
    url: 'https://assets.test/new.png',
  }
  const h = makeHarness({
    references: [old, fresh],
    run: {
      dryRun: true,
      message: { content: '换成上传的新商品', parts: [{ type: 'attachment', ...fresh }] },
    },
    intent: { attachments: [fresh], imageSourceMode: 'reference' },
    chatResponse: {
      routing: routing({ relation: 'switch', action: 'clarify', stage: 'awaiting_input' }),
      reply: '请确认使用这张新商品图。',
      referenceLayerIds: ['new'],
      questions: [{ id: 'upload', kind: 'image_upload', question: '确认新商品原图' }],
    },
  })
  await h.context.planDirectorMessage('run-1')
  let completed
  h.context.handleDirectorClarification(
    'run-1',
    {
      content: '已提供参考图片',
      parts: [],
      dryRunIntent: false,
      context: {
        clarification: {
          sourceRunId: 'run-1',
          answers: [{ questionId: 'upload', answer: '已提供参考图片' }],
          referenceImageIds: ['new'],
        },
      },
    },
    (result) => {
      completed = result
    },
  )
  assert.equal(completed.ok, true)
  const next = h.calls.find((call) => call.type === 'clarificationSubmit')
  assert.deepEqual(plain(next.inheritedIntent.referenceLayerIds), ['new'])
  assert.deepEqual(plain(next.inheritedIntent.referenceAssets.map((asset) => asset.url)), [
    fresh.url,
  ])
  assert.equal(
    next.inheritedIntent.referenceAssets.some((asset) => asset.url === old.url),
    false,
  )
  assert.equal(next.inheritedIntent.ratio, h.originalIntent.ratio)
  assert.equal(next.inheritedIntent.resolution, h.originalIntent.resolution)
  assert.equal(next.message.dryRunIntent, true)
  assert.equal(
    h.calls.some((call) => call.type === 'runImage'),
    false,
  )
})
