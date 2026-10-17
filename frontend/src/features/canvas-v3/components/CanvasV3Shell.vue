<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { ConnectionMode, VueFlow, useVueFlow } from '@vue-flow/core'
import { Background, BackgroundVariant } from '@vue-flow/background'
import { MiniMap } from '@vue-flow/minimap'
import { useRoute, useRouter } from 'vue-router'
import { useCanvasV3GraphStore } from '../stores/graph'
import { useCanvasV3UiStore } from '../stores/ui'
import { useUserStore } from '../../../stores/user'
import { apiPath } from '../../../utils/apiBase'
import { canCreateAgentDraft } from '../../../utils/agentDraft'
import { useCanvasV3Persistence } from '../sync/useCanvasV3Persistence'
import { isStandaloneUploadedImage, nodeSize } from '../config/nodeControls'
import {
  resolveConfiguredImageTaskModel,
  resolveDirectorImageTaskModel,
} from '../config/directorModelCatalog'
import CanvasV3Topbar from './CanvasV3Topbar.vue'
import NodeLibraryPanel from './NodeLibraryPanel.vue'
import GeneratorNode from './GeneratorNode.vue'
import CanvasBottomBar from './CanvasBottomBar.vue'
import EmptyCanvasLauncher from './EmptyCanvasLauncher.vue'
import NodeComposer from './NodeComposer.vue'
import CanvasIcon from './CanvasIcon.vue'
import AgentOrb from './AgentOrb.vue'
import DirectorPanel from './DirectorPanel.vue'
import CanvasUtilityPanel from './CanvasUtilityPanel.vue'
import { useCanvasV3TaskStore } from '../stores/tasks'
import ImageActionToolbar from './ImageActionToolbar.vue'
import FlowingEdge from './FlowingEdge.vue'
import EdgeFlowSegments from './EdgeFlowSegments.vue'
import ConnectionPreview from './ConnectionPreview.vue'
import PortraitEmotionPanel from './PortraitEmotionPanel.vue'
import PanoramaViewer from './PanoramaViewer.vue'
import MultiAngleEditor from './MultiAngleEditor.vue'
import { canvasGestures } from '../config/canvasGestures'

const props = defineProps({ projectId: { type: String, required: true } })
const router = useRouter()
const route = useRoute()
const graph = useCanvasV3GraphStore()
const ui = useCanvasV3UiStore()
const tasks = useCanvasV3TaskStore()
const user = useUserStore()
const { nodes, edges, title, viewport } = storeToRefs(graph)
const { activePanel, minimapVisible, snapToGrid, tool, mode } = storeToRefs(ui)
const { saveStatus, saveNow } = useCanvasV3Persistence(props.projectId, graph)
const canvasWrap = ref(null)
const agentOrb = ref(null)
const DIRECTOR_MODE_KEY = 'libtv:chatAgentDrawer:mode'
const DIRECTOR_WIDTH_KEY = 'libtv:chatAgentDrawer:width'
const directorAgentRuns = ref([])
const directorConversationId = ref(directorRequestId('conversation'))
const directorConversations = ref([])
const directorConversationLoading = ref(false)
const directorPlanningRequests = new Map()
const directorGenerationSubmissions = new Set()
let directorConversationSyncTimer = 0

function defaultDirectorDockWidth() {
  return window.innerWidth > 1520 ? 400 : 340
}

function clampDirectorDockWidth(value) {
  const maxWidth = Math.max(0, Math.min(600, window.innerWidth - 48))
  const minWidth = Math.min(320, maxWidth)
  return Math.round(
    Math.min(Math.max(Number(value) || defaultDirectorDockWidth(), minWidth), maxWidth),
  )
}

function readDirectorMode() {
  try {
    return localStorage.getItem(DIRECTOR_MODE_KEY) === 'docked'
  } catch {
    return false
  }
}

function readDirectorDockWidth() {
  try {
    return clampDirectorDockWidth(localStorage.getItem(DIRECTOR_WIDTH_KEY))
  } catch {
    return clampDirectorDockWidth(defaultDirectorDockWidth())
  }
}

const directorDocked = ref(readDirectorMode())
const directorDockWidth = ref(readDirectorDockWidth())
const directorDockActive = computed(() => activePanel.value === 'assistant' && directorDocked.value)
const directorWorkspaceStyle = computed(() =>
  directorDockActive.value
    ? { '--cv3-director-dock-width': `${directorDockWidth.value}px` }
    : undefined,
)
const menuPosition = ref(null)
const menuFlowPosition = ref(null)
const edgeVisible = ref(true)
const connecting = ref(false)
const connectionStart = ref(null)
const pendingReference = ref(null)
let connectionMade = false
let suppressPaneClick = false
const previewImage = ref('')
const previewPanorama = ref(false)
function openImagePreview() {
  previewImage.value = graph.activeNode.data.assetUrl
  previewPanorama.value = graph.activeNode.data.editTemplate?.id === 'panorama-720'
}
const emotionSource = ref(null)
const emotionTarget = ref(null)
const angleSource = ref(null)
const angleTarget = ref(null)
async function openAngles(node) {
  const isEdit = node.data.editTemplate?.id === 'multi-angle'
  const source = isEdit
    ? graph.nodes.find((n) => n.id === node.data.editTemplate.sourceNodeId)
    : node
  if (!source?.data.assetUrl) return
  emotionSource.value = null
  angleSource.value = source
  angleTarget.value = isEdit ? node : null
  // Reserve the full editor, the 12px image gap and the bottom canvas tools.
  const available = Math.max(80, screenSize.value.height - 550)
  const zoom = Math.max(0.2, Math.min(getViewport().zoom, 0.85, available / 350))
  const sourceSize = nodeSize(source.data.kind, source.data)
  const sourceCenterY = source.position.y + sourceSize.height / 2
  const desiredCenterY = 76 + 175 * zoom
  await setCenter(
    source.position.x + 312,
    sourceCenterY + (screenSize.value.height / 2 - desiredCenterY) / zoom,
    { zoom, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220 },
  )
}
function openEmotion(node) {
  angleSource.value = null
  const isEdit = node.data.editTemplate?.id === 'portrait-emotion'
  const source = isEdit
    ? graph.nodes.find((n) => n.id === node.data.editTemplate.sourceNodeId)
    : node
  if (!source?.data.assetUrl) return
  emotionSource.value = source
  emotionTarget.value = isEdit ? node : null
}
const zoomMenu = ref(false)
const spaceHeld = ref(false)
const gestures = computed(() => canvasGestures(tool.value, spaceHeld.value))
const screenSize = ref({ width: window.innerWidth, height: window.innerHeight })
const liveViewport = ref({ ...viewport.value })
const {
  fitView,
  getViewport,
  screenToFlowCoordinate,
  setCenter,
  setViewport,
  zoomTo,
  onNodesInitialized,
} = useVueFlow('youmi-canvas-v3')
const zoomPercent = computed(() => Math.round(liveViewport.value.zoom * 100))
const composerPosition = computed(() => {
  const node = graph.activeNode
  if (!node) return { x: 0, y: 0 }
  const size = nodeSize(node.data.kind, node.data)
  const view = liveViewport.value
  const width = Math.min(660, screenSize.value.width - 32)
  return {
    x: Math.max(
      16,
      Math.min(
        screenSize.value.width - width - 16,
        (node.position.x + size.width / 2) * view.zoom + view.x - width / 2,
      ),
    ),
    y: Math.max(
      62,
      Math.min(
        screenSize.value.height - 285,
        (node.position.y + size.height) * view.zoom + view.y + 12,
      ),
    ),
  }
})
const angleAnchor = computed(() => {
  const node = angleSource.value
  const view = liveViewport.value
  const size = node ? nodeSize(node.data.kind, node.data) : null
  return node
    ? {
        centerX: (node.position.x + size.width / 2) * view.zoom + view.x,
        bottom: (node.position.y + size.height) * view.zoom + view.y,
      }
    : { centerX: screenSize.value.width / 2, bottom: 100 }
})
const showComposer = computed(
  () =>
    mode.value === 'workflow' &&
    !emotionSource.value &&
    !angleSource.value &&
    graph.activeNode &&
    !['text', 'reference'].includes(graph.activeNode.data.kind) &&
    !isStandaloneUploadedImage(graph.activeNode.data),
)
const storyboardNodes = computed(() =>
  nodes.value.filter((node) => ['image', 'video', 'script'].includes(node.data.kind)),
)
const imageToolbarPosition = computed(() => {
  const node = graph.activeNode
  if (!node) return { left: screenSize.value.width / 2, top: 56 }
  const size = nodeSize(node.data.kind, node.data)
  const view = liveViewport.value
  return {
    left: (node.position.x + size.width / 2) * view.zoom + view.x,
    top: node.position.y * view.zoom + view.y - 84,
  }
})
const pendingReferencePath = computed(() => {
  const pending = pendingReference.value
  if (!pending) return ''
  const node = nodes.value.find((item) => item.id === pending.start.nodeId)
  if (!node) return ''
  const size = nodeSize(node.data.kind, node.data)
  const reversed = pending.start.handleType === 'target'
  const sx =
    (node.position.x + (reversed ? 0 : size.width)) * liveViewport.value.zoom + liveViewport.value.x
  const sy = (node.position.y + size.height / 2) * liveViewport.value.zoom + liveViewport.value.y
  const tx = pending.screen.x
  const ty = pending.screen.y
  const bend = Math.max(72, Math.abs(tx - sx) * 0.45)
  const direction = reversed ? -1 : 1
  return `M ${sx} ${sy} C ${sx + bend * direction} ${sy}, ${tx - bend * direction} ${ty}, ${tx} ${ty}`
})
let resizeObserver

function clearPendingReference() {
  pendingReference.value = null
  connectionStart.value = null
  menuFlowPosition.value = null
}

function toggleNodeLibrary() {
  clearPendingReference()
  menuPosition.value = null
  menuFlowPosition.value = null
  ui.togglePanel('nodes')
}
function openPanel(panel) {
  menuPosition.value = null
  zoomMenu.value = false
  ui.togglePanel(panel)
}
async function closeDirector() {
  activePanel.value = ''
  await nextTick()
  agentOrb.value?.focus()
}
function setDirectorDocked(value) {
  directorDocked.value = Boolean(value)
  try {
    localStorage.setItem(DIRECTOR_MODE_KEY, directorDocked.value ? 'docked' : 'floating')
  } catch {
    // Persistence is optional when browser storage is unavailable.
  }
}
function setDirectorDockWidth(value) {
  directorDockWidth.value = clampDirectorDockWidth(value)
}
function commitDirectorDockWidth() {
  try {
    localStorage.setItem(DIRECTOR_WIDTH_KEY, String(directorDockWidth.value))
  } catch {
    // Persistence is optional when browser storage is unavailable.
  }
}
function handleDirectorViewportResize() {
  const nextWidth = clampDirectorDockWidth(directorDockWidth.value)
  if (nextWidth === directorDockWidth.value) return
  directorDockWidth.value = nextWidth
  commitDirectorDockWidth()
}
async function addNode(kind) {
  activePanel.value = ''
  const size = nodeSize(kind)
  const rect = canvasWrap.value?.getBoundingClientRect()
  const center =
    menuFlowPosition.value ||
    screenToFlowCoordinate({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 - 70 })
  const pending = pendingReference.value
  const node = pending
    ? graph.createConnectedNode(
        kind,
        { x: center.x + 100, y: center.y - size.height / 2 },
        pending.start,
      )
    : graph.addNode(kind, { x: center.x - size.width / 2, y: center.y - size.height / 2 })
  if (!node) return
  if (kind === 'image' && tasks.imageModels.length)
    graph.updateNodeData(node.id, { model: tasks.imageModels[0].value })
  menuFlowPosition.value = null
  clearPendingReference()
  await nextTick()
  await setCenter(node.position.x + size.width / 2, node.position.y + size.height / 2 + 70, {
    zoom: Math.max(0.55, Math.min(getViewport().zoom, 1)),
    duration: 220,
  })
}
function handleMoveEnd() {
  graph.setViewport(getViewport())
}
function handleViewportChange(view) {
  liveViewport.value = { ...view }
}
function handlePaneClick() {
  if (suppressPaneClick) return
  clearPendingReference()
  angleSource.value = null
  if (activePanel.value !== 'assistant') activePanel.value = ''
  zoomMenu.value = false
  nodes.value.forEach((node) => {
    node.selected = false
  })
  edges.value.forEach((edge) => {
    edge.selected = false
  })
}
function handleConnectStart(payload) {
  connecting.value = true
  connectionMade = false
  clearPendingReference()
  connectionStart.value = {
    nodeId: payload.nodeId,
    handleId: payload.handleId,
    handleType: payload.handleType,
  }
}
function handleConnect(connection) {
  connectionMade = true
  graph.connect(connection)
}
function handleConnectEnd(event) {
  connecting.value = false
  if (connectionMade || !connectionStart.value) {
    connectionStart.value = null
    return
  }
  const target = event.target
  if (!target?.closest?.('.vue-flow__pane')) {
    connectionStart.value = null
    return
  }
  const point = event.changedTouches?.[0] || event
  const rect = canvasWrap.value.getBoundingClientRect()
  const screen = { x: point.clientX - rect.left, y: point.clientY - rect.top }
  menuPosition.value = {
    x: Math.max(8, Math.min(rect.width - 228, screen.x + 12)),
    y: Math.max(48, Math.min(rect.height - 390, screen.y + 12)),
  }
  menuFlowPosition.value = screenToFlowCoordinate({ x: point.clientX, y: point.clientY })
  pendingReference.value = { start: { ...connectionStart.value }, screen }
  activePanel.value = 'nodes'
  suppressPaneClick = true
  setTimeout(() => {
    suppressPaneClick = false
  })
}
function openCanvasMenu(event) {
  if (!event.target?.closest?.('.vue-flow__pane')) return
  event.preventDefault()
  clearPendingReference()
  const rect = canvasWrap.value.getBoundingClientRect()
  menuPosition.value = {
    x: Math.max(8, Math.min(rect.width - 228, event.clientX - rect.left)),
    y: Math.max(48, Math.min(rect.height - 475, event.clientY - rect.top)),
  }
  menuFlowPosition.value = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
  activePanel.value = 'nodes'
}
function fitCanvas() {
  if (nodes.value.length) fitView({ padding: 0.25, duration: 260, minZoom: 0.2, maxZoom: 1 })
  zoomMenu.value = false
}
async function layoutCanvas() {
  graph.autoLayout()
  await nextTick()
  fitCanvas()
}
async function zoomAt(value) {
  await zoomTo(value, { duration: 180 })
  zoomMenu.value = false
}
function createNew() {
  router.push('/canvas-v3/v3-' + crypto.randomUUID())
}
function focusStoryboard(node) {
  nodes.value.forEach((item) => {
    item.selected = item.id === node.id
  })
  mode.value = 'workflow'
  const size = nodeSize(node.data.kind, node.data)
  setCenter(node.position.x + size.width / 2, node.position.y + size.height / 2, {
    zoom: 0.8,
    duration: 200,
  })
}
async function focusGenerated(node) {
  const source = nodes.value.find((item) => item.id === node.data.sourceImageNodeId)
  if (!source) return focusStoryboard(node)
  await nextTick()
  const sourceSize = nodeSize(source.data.kind, source.data)
  const targetSize = nodeSize(node.data.kind, node.data)
  const minX = Math.min(source.position.x, node.position.x)
  const minY = Math.min(source.position.y, node.position.y)
  const maxX = Math.max(source.position.x + sourceSize.width, node.position.x + targetSize.width)
  const maxY = Math.max(source.position.y + sourceSize.height, node.position.y + targetSize.height)
  const width = maxX - minX
  const height = maxY - minY
  const availableWidth = Math.max(240, screenSize.value.width - 96)
  const availableHeight = Math.max(160, screenSize.value.height - 390)
  const zoom = Math.max(
    0.2,
    Math.min(getViewport().zoom, 0.85, availableWidth / width, availableHeight / height),
  )
  const x = (screenSize.value.width - width * zoom) / 2 - minX * zoom
  const y = 76 + (availableHeight - height * zoom) / 2 - minY * zoom
  await setViewport(
    { x, y, zoom },
    { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180 },
  )
}

function directorRequestId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
}

function directorRun(runId) {
  return directorAgentRuns.value.find((run) => run.id === runId)
}

function updateDirectorRun(runId, patch) {
  const index = directorAgentRuns.value.findIndex((run) => run.id === runId)
  if (index < 0) return null
  const next = { ...directorAgentRuns.value[index], ...patch }
  directorAgentRuns.value.splice(index, 1, next)
  scheduleDirectorConversationSync()
  return next
}

function serializedDirectorRun(run) {
  return {
    id: run.id,
    clientTaskId: run.clientTaskId,
    clientMessageId: run.clientMessageId,
    instruction: run.instruction,
    display: run.display,
    message: run.message,
    generationIntent: run.generationIntent,
    dryRun: run.dryRun,
    phase: run.phase,
    reply: run.reply,
    thinking: run.thinking,
    thinkingText: run.thinkingText,
    draft: run.draft,
    nodeId: run.nodeId,
    submissionStarted: run.submissionStarted,
    submissionState: run.submissionState,
    error: run.error,
  }
}

function directorConversationMessages() {
  return directorAgentRuns.value.flatMap((run) => [
    {
      role: 'user',
      id: run.message?.id || run.clientMessageId,
      content: run.message?.content || run.instruction,
      display: run.message?.display || run.display || run.instruction,
      raw: run.message?.raw || run.instruction,
      parts: run.message?.parts || [],
      dryRunIntent: run.message?.dryRunIntent !== false,
      context: run.message?.context || {},
    },
    { role: 'assistant', run: serializedDirectorRun(run) },
  ])
}

function directorConversationTitle() {
  const first = directorAgentRuns.value[0]
  return (
    String(first?.display || first?.instruction || '新对话')
      .trim()
      .slice(0, 80) || '新对话'
  )
}

async function saveDirectorConversation() {
  if (!user.token || !directorAgentRuns.value.length) return
  const response = await fetch(
    apiPath(
      `/api/ai/canvas-agent/conversations/${encodeURIComponent(directorConversationId.value)}`,
    ),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...user.authHeaders() },
      body: JSON.stringify({
        canvasId: props.projectId,
        title: directorConversationTitle(),
        messages: directorConversationMessages(),
      }),
    },
  )
  await readDirectorApiResponse(response)
}

function scheduleDirectorConversationSync() {
  window.clearTimeout(directorConversationSyncTimer)
  directorConversationSyncTimer = window.setTimeout(() => {
    void saveDirectorConversation().catch(() => {})
  }, 350)
}

async function loadDirectorConversations() {
  if (!user.token) {
    directorConversations.value = []
    return
  }
  directorConversationLoading.value = true
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 5000)
  try {
    const response = await readDirectorApiResponse(
      await fetch(
        apiPath(
          `/api/ai/canvas-agent/conversations?canvasId=${encodeURIComponent(props.projectId)}`,
        ),
        { headers: user.authHeaders(), signal: controller.signal },
      ),
    )
    directorConversations.value = Array.isArray(response) ? response : []
  } catch {
    directorConversations.value = []
  } finally {
    window.clearTimeout(timeout)
    directorConversationLoading.value = false
  }
}

function stopDirectorConversationWork() {
  for (const controller of directorPlanningRequests.values()) controller.abort()
  directorPlanningRequests.clear()
  directorGenerationSubmissions.clear()
}

function startDirectorConversation() {
  window.clearTimeout(directorConversationSyncTimer)
  void saveDirectorConversation().catch(() => {})
  stopDirectorConversationWork()
  directorConversationId.value = directorRequestId('conversation')
  directorAgentRuns.value = []
}

function selectDirectorConversation(conversation) {
  stopDirectorConversationWork()
  directorConversationId.value = String(conversation?.id || directorRequestId('conversation'))
  directorAgentRuns.value = (Array.isArray(conversation?.messages) ? conversation.messages : [])
    .filter((message) => message?.role === 'assistant' && message?.run?.id)
    .map((message) => ({ ...message.run }))
}

function directorLayerContext(node) {
  const width = Number(node.data.pixelSize?.width)
  const height = Number(node.data.pixelSize?.height)
  return {
    id: node.id,
    name: node.data.title || node.data.kind || '未命名节点',
    type: node.data.kind || 'reference',
    url: node.data.assetUrl || '',
    width: Number.isFinite(width) && width > 0 ? width : null,
    height: Number.isFinite(height) && height > 0 ? height : null,
    x: Number(node.position?.x) || 0,
    y: Number(node.position?.y) || 0,
  }
}

function directorHistory(excludedRunId) {
  return directorAgentRuns.value
    .filter((run) => run.id !== excludedRunId && run.instruction && run.reply)
    .flatMap((run) => [
      { role: 'user', content: run.instruction },
      { role: 'assistant', content: run.reply },
    ])
    .slice(-20)
}

function normalizeDirectorPrompts(response) {
  const candidates =
    Array.isArray(response?.draftPrompts) && response.draftPrompts.length
      ? response.draftPrompts
      : [response?.draftPrompt]
  return [...new Set(candidates.map((value) => String(value || '').trim()).filter(Boolean))].slice(
    0,
    10,
  )
}

function directorInstruction(message) {
  const skillContext = (message.parts || [])
    .filter((part) => part?.type === 'skill')
    .map((part) =>
      part.prompt
        ? `使用 Skill「${part.name || part.id}」：\n${part.prompt}`
        : `使用 Skill「${part.name || part.id}」`,
    )
  return [String(message.content || message.display || '').trim(), ...skillContext]
    .filter(Boolean)
    .join('\n\n')
}

function directorCount(value) {
  return Math.max(1, Math.min(4, Number.parseInt(value, 10) || 1))
}

function positiveDirectorDimension(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null
}

function createDirectorGenerationIntent(message) {
  const selectedNodes = [...graph.selectedNodes]
  const referenceNodes = selectedNodes.filter(
    (node) => node.data.kind === 'image' && node.data.assetUrl,
  )
  const requestedModels = (message.parts || [])
    .filter((part) => part?.type === 'model')
    .map((part) =>
      Object.freeze({
        id: String(part.id || '').trim(),
        name: String(part.name || '').trim(),
        modality: part.modality === 'video' ? 'video' : 'image',
      }),
    )
  const generationType = requestedModels[0]?.modality || 'image'
  const primaryGenerationNode =
    selectedNodes.find((node) => node.data.kind === generationType) || null
  const params = primaryGenerationNode?.data.params || {}
  return Object.freeze({
    generationType,
    requestedModels: Object.freeze(requestedModels),
    selectedLayerIds: Object.freeze(selectedNodes.map((node) => node.id)),
    referenceLayerIds: Object.freeze(referenceNodes.map((node) => node.id)),
    referenceAssets: Object.freeze(
      referenceNodes.map((node) => Object.freeze({ id: node.id, url: node.data.assetUrl })),
    ),
    nodeModel: String(primaryGenerationNode?.data.model || '').trim(),
    ratio: String(params.ratio || '16:9'),
    resolution: String(params.resolution || (generationType === 'video' ? '720P' : '2K')),
    // Director image generations are deliberately single-output. This keeps the approval
    // summary and the paid request one-to-one even when the selected node was configured
    // for a larger batch.
    count: generationType === 'image' ? 1 : directorCount(params.count),
    quality: String(params.quality || '标准画质'),
    background: String(params.background || '自动'),
    width: positiveDirectorDimension(params.width),
    height: positiveDirectorDimension(params.height),
  })
}

function resolveDirectorModels(intent) {
  const requestedKeys = new Set(
    intent.requestedModels.map((model) => `${model.modality}:${model.id || model.name}`),
  )
  if (requestedKeys.size > 1)
    throw new Error('一次生成只能选择一个模型，请移除混合或多余的模型后重新发送')
  if (intent.generationType !== 'image') return []
  const requested = intent.requestedModels.filter((model) => model.modality === 'image')
  if (!requested.length && !intent.nodeModel) return []
  const nodeModelIsConfigured = tasks.imageModels.some(
    (option) =>
      String(option.value || '')
        .trim()
        .toLocaleLowerCase() === intent.nodeModel.toLocaleLowerCase(),
  )
  const matched = requested.length
    ? requested.map((model) => resolveDirectorImageTaskModel(model.id, tasks.imageModels))
    : [
        nodeModelIsConfigured
          ? resolveConfiguredImageTaskModel(intent.nodeModel, tasks.imageModels)
          : resolveDirectorImageTaskModel(intent.nodeModel, tasks.imageModels),
      ]
  return [
    ...new Map(matched.map((option) => [option.value, Object.freeze({ ...option })])).values(),
  ]
}

async function readDirectorApiResponse(response) {
  const result = await response.json().catch(() => null)
  if (!response.ok || !result || result.code !== 0) {
    const error = new Error(result?.message || `接口请求失败：${response.status}`)
    error.status = response.status
    throw error
  }
  return result.data
}

function applyDirectorThinkingEvent(runId, event) {
  const run = directorRun(runId)
  if (!run) return
  const id = String(event?.id || `step-${run.thinking?.length || 0}`)
  const steps = Array.isArray(run.thinking) ? run.thinking.map((step) => ({ ...step })) : []
  const index = steps.findIndex((step) => step.id === id)
  const next = {
    id,
    label: String(event?.label || ''),
    state: String(event?.state || 'complete'),
  }
  if (index < 0) steps.push(next)
  else steps.splice(index, 1, next)
  updateDirectorRun(runId, { thinking: steps })
}

async function readDirectorStream(response, runId) {
  if (!response.ok) return readDirectorApiResponse(response)
  if (!response.body?.getReader) throw new Error('当前浏览器不支持流式回复，请升级浏览器后重试')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result = null

  const consumeLine = (rawLine) => {
    const line = rawLine.trim()
    if (!line) return
    let event
    try {
      event = JSON.parse(line)
    } catch {
      throw new Error('TV Director 返回了无法识别的流式数据')
    }
    if (event.type === 'thinking') {
      applyDirectorThinkingEvent(runId, event)
      return
    }
    if (event.type === 'thinking_delta') {
      const delta = String(event.delta || '')
      if (!delta) return
      const run = directorRun(runId)
      if (run)
        updateDirectorRun(runId, {
          thinkingText: `${run.thinkingText || ''}${delta}`,
        })
      return
    }
    if (event.type === 'reply_delta') {
      const delta = String(event.delta || '')
      if (!delta) return
      const run = directorRun(runId)
      if (run) updateDirectorRun(runId, { phase: 'streaming', reply: `${run.reply || ''}${delta}` })
      return
    }
    if (event.type === 'result') {
      result = event.data
      return
    }
    if (event.type === 'error') throw new Error(event.message || 'TV Director 暂时无法回复')
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) consumeLine(line)
      if (done) break
    }
    if (buffer.trim()) consumeLine(buffer)
  } finally {
    reader.releaseLock()
  }
  if (!result) throw new Error('TV Director 流式回复未完整结束，请重试')
  return result
}

async function planDirectorMessage(runId) {
  const run = directorRun(runId)
  if (!run || directorPlanningRequests.has(runId)) return
  if (!user.requireLogin()) {
    updateDirectorRun(runId, { phase: 'failed', error: '请先登录有米账号后使用 TV Director' })
    return
  }

  const controller = new AbortController()
  directorPlanningRequests.set(runId, controller)
  updateDirectorRun(runId, {
    phase: 'planning',
    error: '',
    reply: '',
    thinkingText: '',
    draft: null,
    thinking: [
      { id: 'context', label: '正在读取画布上下文与选中素材', state: 'active' },
      { id: 'model', label: '等待数据库推理模型开始响应', state: 'pending' },
      { id: 'answer', label: '等待流式整理回答与下一步建议', state: 'pending' },
    ],
  })
  try {
    await tasks.loadModels()
    if (controller.signal.aborted) return
    const intent = run.generationIntent
    const resolvedModels = resolveDirectorModels(intent)
    const models =
      intent.generationType === 'image'
        ? resolvedModels.map((option) => option.value)
        : intent.requestedModels.map((model) => model.id).filter(Boolean)
    const primaryModel = resolvedModels[0] || intent.requestedModels[0] || null
    const response = await readDirectorStream(
      await fetch(apiPath('/api/ai/canvas-agent/chat/stream'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...user.authHeaders(),
        },
        signal: controller.signal,
        body: JSON.stringify({
          canvasId: props.projectId,
          instruction: run.instruction,
          history: directorHistory(runId),
          layers: nodes.value.map(directorLayerContext),
          selectedLayerIds: [...intent.selectedLayerIds],
          referenceLayerIds: [...intent.referenceLayerIds],
          model: models[0] || '',
          models,
          ratio: intent.ratio,
          resolution: intent.resolution,
          count: intent.count,
          conversationId: directorConversationId.value,
          agentModel: 'default',
        }),
      }),
      runId,
    )
    if (controller.signal.aborted) return
    const prompts = normalizeDirectorPrompts(response)
    const draftRequested = canCreateAgentDraft(response, prompts)
    const responseGenerationType = ['image', 'video'].includes(response?.generationType)
      ? response.generationType
      : ''
    const paidConfigurationError = !draftRequested
      ? ''
      : !responseGenerationType
        ? 'Agent 未明确生成类型，本次不会自动提交付费任务'
        : responseGenerationType !== intent.generationType
          ? `Agent 建议生成${responseGenerationType === 'video' ? '视频' : '图片'}，与发送时选择的${intent.generationType === 'video' ? '视频' : '图片'}模式不一致；请确认模型后重新发送`
          : intent.generationType === 'image' && !models.length
            ? '请选择已配置的图片模型后重新发送，Agent 不会替你选择付费模型'
            : ''
    const draft =
      draftRequested && !paidConfigurationError
        ? {
            prompt: prompts[0],
            prompts,
            generationType: intent.generationType,
            referenceLayerIds: [...intent.referenceLayerIds],
            referenceAssets: intent.referenceAssets.map((reference) => ({ ...reference })),
            models,
            model: models[0] || '',
            modelLabel: primaryModel?.label || primaryModel?.name || models[0] || '',
            ratio: intent.ratio,
            resolution: intent.resolution,
            count: intent.count,
            quality: intent.quality,
            background: intent.background,
            width: intent.width,
            height: intent.height,
          }
        : null
    const nextRun = updateDirectorRun(runId, {
      phase: draft ? 'ready' : 'complete',
      reply: String(response?.reply || 'TV Director 已完成分析。'),
      draft,
      error: paidConfigurationError,
    })
    // The per-message dry-run intent is frozen when the user sends. Later mode changes never
    // affect this branch, and video drafts deliberately remain available without auto submission.
    if (draft?.generationType === 'image' && nextRun?.dryRun === false)
      await submitDirectorDraft(runId)
  } catch (error) {
    if (error?.name !== 'AbortError')
      updateDirectorRun(runId, {
        phase: 'failed',
        error: error?.message || 'TV Director 暂时无法回复，请稍后重试',
      })
  } finally {
    if (directorPlanningRequests.get(runId) === controller) directorPlanningRequests.delete(runId)
  }
}

function handleDirectorSubmit(message) {
  const instruction = directorInstruction(message)
  if (!instruction) return
  const generationIntent = createDirectorGenerationIntent(message)
  const run = {
    id: directorRequestId('director'),
    clientTaskId: directorRequestId('director-image'),
    clientMessageId: message.id || '',
    instruction,
    display: message.display || instruction,
    message,
    generationIntent,
    // Freeze approval policy at send time. Picker changes are inert until another message is sent.
    dryRun: message.dryRunIntent !== false,
    phase: 'planning',
    thinking: [
      { id: 'context', label: '正在读取画布上下文与选中素材', state: 'active' },
      { id: 'model', label: '等待数据库推理模型开始响应', state: 'pending' },
      { id: 'answer', label: '等待流式整理回答与下一步建议', state: 'pending' },
    ],
    reply: '',
    thinkingText: '',
    draft: null,
    nodeId: '',
    submissionStarted: false,
    error: '',
  }
  directorAgentRuns.value.push(run)
  scheduleDirectorConversationSync()
  void planDirectorMessage(run.id)
}

function directorDraftPosition(referenceNode) {
  if (referenceNode)
    return {
      x:
        referenceNode.position.x +
        nodeSize(referenceNode.data.kind, referenceNode.data).width +
        176,
      y: referenceNode.position.y,
    }
  const rect = canvasWrap.value?.getBoundingClientRect()
  if (!rect) return { x: 180, y: 140 }
  const center = screenToFlowCoordinate({
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  })
  const size = nodeSize('image')
  return { x: center.x - size.width / 2, y: center.y - size.height / 2 }
}

async function submitDirectorDraft(runId) {
  const run = directorRun(runId)
  const draft = run?.draft
  if (!run || !draft || draft.generationType !== 'image') return
  if (directorGenerationSubmissions.has(runId) || ['submitting', 'submitted'].includes(run.phase))
    return
  if (!user.requireLogin()) {
    updateDirectorRun(runId, { phase: 'ready', error: '请先登录有米账号后确认生成' })
    return
  }

  directorGenerationSubmissions.add(runId)
  updateDirectorRun(runId, { phase: 'submitting', error: '' })
  try {
    // Once fetch is about to start, every retry is a read-only recovery of the same stable
    // client_task_id. If rendering/history temporarily lost the node, rebuild only a local
    // recovery holder and resolve the original key; never fall through to another POST.
    if (run.submissionStarted || run.submissionState === 'uncertain') {
      if (!run.clientTaskId) throw new Error('原任务标识缺失，已阻止重复提交')
      let resumed = run.nodeId ? nodes.value.find((node) => node.id === run.nodeId) : null
      if (resumed?.data.generation?.clientTaskId !== run.clientTaskId) resumed = null
      if (!resumed) {
        resumed = graph.addNode('image', directorDraftPosition(null))
        if (!resumed) throw new Error('无法重建原任务查询节点')
        const params = {
          ratio: draft.ratio,
          resolution: draft.resolution,
          count: `${draft.count}张`,
          quality: draft.quality,
          background: draft.background,
        }
        graph.updateNodeData(resumed.id, {
          title: 'TV Director 任务恢复',
          prompt: draft.prompt,
          model: draft.model,
          params,
          runState: 'uncertain',
          error: '',
          statusText: '正在查询原生成任务，不会重新提交或重复扣费。',
          generation: {
            clientTaskId: run.clientTaskId,
            taskIds: [],
            prompt: draft.prompt,
            model: draft.model,
            params,
            startedAt: run.submissionStartedAt || Date.now(),
          },
        })
        updateDirectorRun(runId, { nodeId: resumed.id, submissionState: 'uncertain' })
        await nextTick()
        if (!(await saveNow())) throw new Error('无法安全保存原任务标识，请检查网络后继续查询')
      }
      await tasks.resume(resumed.id)
      resumed = nodes.value.find((node) => node.id === resumed.id)
      if (!resumed) throw new Error('原任务查询节点暂不可用，请稍后继续查询')
      if (resumed.data.runState === 'uncertain') {
        updateDirectorRun(runId, {
          phase: 'ready',
          error: resumed.data.statusText || '原任务结果尚未确认，请稍后继续查询',
          submissionState: 'uncertain',
        })
        return
      }
      if (resumed.data.runState === 'failed')
        throw new Error(resumed.data.error || '原任务查询失败，请稍后重试')
      if (!['queued', 'running', 'paused', 'succeeded'].includes(resumed.data.runState))
        throw new Error(resumed.data.statusText || '原任务尚未恢复，请稍后继续查询')
      updateDirectorRun(runId, {
        phase: 'submitted',
        error: '',
        submissionState: resumed.data.runState,
      })
      return
    }

    await tasks.loadModels()
    const configuredModels = new Set(tasks.imageModels.map((option) => option.value))
    const model = [draft.model, ...(draft.models || [])].find((value) =>
      configuredModels.has(value),
    )
    if (!model) throw new Error(tasks.modelError || '当前项目尚未配置可用的图片生成模型')

    const expectedReferences = draft.referenceAssets || []
    const referenceNodes = expectedReferences.map((reference) => {
      const node = nodes.value.find((candidate) => candidate.id === reference.id)
      if (!node?.data.assetUrl) throw new Error('部分参考节点已移除，请恢复参考节点后重试')
      if (node.data.assetUrl !== reference.url)
        throw new Error('参考图片在发送后已发生变化，请确认新图片并重新发送')
      return node
    })

    let target = run.nodeId ? nodes.value.find((node) => node.id === run.nodeId) : null
    if (!target) {
      const source = referenceNodes.find((node) => node.data.kind === 'image')
      target = source
        ? graph.createImageVariation(source.id, {
            title: 'TV Director 生成',
            prompt: draft.prompt,
            params: {
              ratio: draft.ratio,
              resolution: draft.resolution,
              count: `${draft.count}张`,
              quality: draft.quality,
              background: draft.background,
            },
          })
        : graph.addNode('image', directorDraftPosition(referenceNodes[0]))
      if (!target) throw new Error('无法创建图片生成节点')
      updateDirectorRun(runId, { nodeId: target.id })
    }

    graph.updateNodeData(target.id, {
      title: /^图片节点(?:\s|$)/.test(target.data.title || '')
        ? 'TV Director 生成'
        : target.data.title,
      prompt: draft.prompt,
      model,
      params: {
        ...target.data.params,
        ratio: draft.ratio,
        resolution: draft.resolution,
        count: `${draft.count}张`,
        quality: draft.quality,
        background: draft.background,
      },
      error: '',
      statusText: '',
    })
    for (const reference of referenceNodes)
      graph.connect({
        source: reference.id,
        target: target.id,
        sourceHandle: 'output',
        targetHandle: 'input',
      })

    await nextTick()
    await focusStoryboard(target)
    await tasks.runImage(target.id, focusGenerated, {
      clientTaskId: run.clientTaskId,
      onSubmitStart: ({ clientTaskId }) => {
        if (clientTaskId !== run.clientTaskId) return
        updateDirectorRun(runId, {
          nodeId: target.id,
          submissionStarted: true,
          submissionStartedAt: Date.now(),
        })
      },
    })
    const submitted = nodes.value.find((node) => node.id === target.id)
    if (!submitted || submitted.data.runState === 'failed')
      throw new Error(submitted?.data.error || '图片任务提交失败，请重试')
    if (submitted.data.runState === 'uncertain') {
      updateDirectorRun(runId, {
        phase: 'ready',
        nodeId: submitted.id,
        error: submitted.data.statusText || '提交结果待确认，请继续查询原任务',
        submissionState: 'uncertain',
      })
      return
    }
    if (!['queued', 'running', 'paused', 'succeeded'].includes(submitted.data.runState))
      throw new Error(
        submitted.data.error || submitted.data.statusText || '图片任务尚未成功提交，请重试',
      )
    updateDirectorRun(runId, {
      phase: 'submitted',
      nodeId: submitted.id,
      error: '',
      submissionState: submitted.data.runState,
    })
  } catch (error) {
    updateDirectorRun(runId, {
      phase: 'ready',
      error: error?.message || '图片任务提交失败，请重试',
    })
  } finally {
    directorGenerationSubmissions.delete(runId)
  }
}

function confirmDirectorGeneration(runId) {
  const run = directorRun(runId)
  if (
    !run ||
    run.phase !== 'ready' ||
    run.draft?.generationType !== 'image' ||
    (!run.dryRun && !run.error)
  )
    return
  void submitDirectorDraft(runId)
}

function retryDirectorAgent(runId) {
  const run = directorRun(runId)
  if (!run || directorPlanningRequests.has(runId)) return
  void planDirectorMessage(runId)
}

function cancelDirectorAgent(runId) {
  const run = directorRun(runId)
  if (!run || !['planning', 'streaming'].includes(run.phase)) return
  directorPlanningRequests.get(runId)?.abort()
  directorPlanningRequests.delete(runId)
  updateDirectorRun(runId, {
    phase: 'cancelled',
    error: '',
    thinking: [
      ...(Array.isArray(run.thinking)
        ? run.thinking.filter((step) => step?.state === 'complete')
        : []),
      { id: 'cancelled', label: '已停止本次回复', state: 'complete' },
    ],
  })
}

function addFromStoryboard() {
  mode.value = 'workflow'
  toggleNodeLibrary()
}
function resetViewport() {
  setViewport({ x: 0, y: 0, zoom: 1 })
  zoomMenu.value = false
}
function openDemo() {
  router.push('/canvas-v3/v3-demo-' + crypto.randomUUID() + '?demo=workflow')
}
function exportGraph() {
  const blob = new Blob(
    [
      JSON.stringify(
        { title: title.value, nodes: nodes.value, edges: edges.value, viewport: graph.viewport },
        null,
        2,
      ),
    ],
    { type: 'application/json' },
  )
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = title.value + '.json'
  link.click()
  URL.revokeObjectURL(url)
}
function onKeydown(event) {
  const insideFloatingPanel = event.target?.closest?.('[data-canvas-shortcuts-ignore]')
  if (insideFloatingPanel) {
    if (event.key === 'Escape') {
      const directorPopupOpen = event.target?.closest?.('[data-director-popup-open="true"]')
      if (directorPopupOpen) return
      event.preventDefault()
      closeDirector()
    }
    return
  }
  if (
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName) ||
    event.target?.isContentEditable
  )
    return
  const mod = event.ctrlKey || event.metaKey
  if (event.code === 'Space') {
    spaceHeld.value = true
    event.preventDefault()
    return
  }
  if (angleSource.value || emotionSource.value) return
  if (mod && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    event.shiftKey ? graph.redo() : graph.undo()
  } else if (mod && event.key.toLowerCase() === 'd') {
    event.preventDefault()
    graph.duplicateSelected()
  } else if (mod && event.key === '0') {
    event.preventDefault()
    fitCanvas()
  } else if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    layoutCanvas()
  } else if (event.key === 'Escape') {
    previewImage.value = ''
    clearPendingReference()
    if (activePanel.value === 'assistant') closeDirector()
    else activePanel.value = ''
    zoomMenu.value = false
  } else if (event.key === 'Tab') {
    event.preventDefault()
    toggleNodeLibrary()
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    graph.removeSelected()
  } else if (event.key.toLowerCase() === 'h') {
    tool.value = tool.value === 'hand' ? 'select' : 'hand'
  } else if (event.key === '?') openPanel('shortcuts')
}
function onKeyup(event) {
  if (event.code === 'Space') spaceHeld.value = false
}
function resetSpace() {
  spaceHeld.value = false
}
onNodesInitialized(() => {
  if (route.query.demo && nodes.value.length) fitView({ padding: 0.2, minZoom: 0.2, maxZoom: 0.6 })
})
onMounted(async () => {
  activePanel.value = ''
  mode.value = 'workflow'
  tasks.attach(props.projectId, { beforeImageSubmit: saveNow })
  window.addEventListener('keydown', onKeydown, true)
  window.addEventListener('keyup', onKeyup, true)
  window.addEventListener('blur', resetSpace)
  window.addEventListener('resize', handleDirectorViewportResize)
  resizeObserver = new ResizeObserver((entries) => {
    const rect = entries[0].contentRect
    screenSize.value = { width: rect.width, height: rect.height }
  })
  resizeObserver.observe(canvasWrap.value)
  if (route.query.demo && !nodes.value.length) {
    graph.createDemoWorkflow()
    await nextTick()
    fitCanvas()
  }
})
onBeforeUnmount(() => {
  window.clearTimeout(directorConversationSyncTimer)
  for (const controller of directorPlanningRequests.values()) controller.abort()
  directorPlanningRequests.clear()
  directorGenerationSubmissions.clear()
  tasks.detach(props.projectId)
  window.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('keyup', onKeyup, true)
  window.removeEventListener('blur', resetSpace)
  window.removeEventListener('resize', handleDirectorViewportResize)
  resizeObserver?.disconnect()
})
</script>

<template>
  <main class="cv3-app-shell">
    <section
      class="cv3-workspace"
      :class="{ 'is-director-docked': directorDockActive }"
      :style="directorWorkspaceStyle"
    >
      <div
        ref="canvasWrap"
        class="cv3-canvas-wrap"
        :class="{
          'cv3-hide-edges': !edgeVisible,
          'is-hand': gestures.hand,
          'is-connecting': connecting,
        }"
        @dblclick="openCanvasMenu"
        @contextmenu="openCanvasMenu"
      >
        <VueFlow
          id="youmi-canvas-v3"
          v-model:nodes="nodes"
          v-model:edges="edges"
          class="cv3-flow"
          :default-viewport="viewport"
          :min-zoom="0.2"
          :max-zoom="8"
          :connection-mode="ConnectionMode.Loose"
          :snap-to-grid="snapToGrid"
          :snap-grid="[16, 16]"
          :pan-on-drag="gestures.panOnDrag"
          :selection-on-drag="gestures.selectionOnDrag"
          :nodes-draggable="gestures.nodesDraggable"
          :pan-activation-key-code="null"
          :zoom-on-double-click="false"
          :delete-key-code="null"
          :only-render-visible-elements="true"
          @connect="handleConnect"
          @connect-start="handleConnectStart"
          @connect-end="handleConnectEnd"
          @move-end="handleMoveEnd"
          @viewport-change="handleViewportChange"
          @pane-click="handlePaneClick"
          @node-drag-start="graph.remember"
          @node-drag-stop="graph.markChanged"
        >
          <Background
            :variant="BackgroundVariant.Dots"
            :gap="16"
            :size="1"
            pattern-color="#4b4b4b"
          />
          <MiniMap
            v-if="minimapVisible"
            position="bottom-left"
            :pannable="true"
            :zoomable="true"
            node-color="#777"
            mask-color="rgba(18,18,18,.72)"
          />
          <template #node-generator="nodeProps">
            <GeneratorNode v-bind="nodeProps" :zoom="liveViewport.zoom" />
          </template>
          <template #edge-smoothstep="edgeProps"><FlowingEdge v-bind="edgeProps" /></template>
          <template #edge-default="edgeProps"><FlowingEdge v-bind="edgeProps" /></template>
          <template #connection-line="lineProps">
            <ConnectionPreview v-bind="lineProps" />
          </template>
        </VueFlow>
        <svg v-if="pendingReferencePath" class="cv3-pending-reference-line" aria-hidden="true">
          <path :d="pendingReferencePath" class="cv3-connection-base" />
          <EdgeFlowSegments :path="pendingReferencePath" />
        </svg>
      </div>
      <CanvasV3Topbar
        :title="title"
        :save-status="saveStatus"
        :mode="mode"
        @back="router.push('/canvas')"
        @update:title="title = $event"
        @new="createNew"
        @demo="openDemo"
        @export="exportGraph"
        @mode="mode = $event"
        @panel="openPanel"
        @emotion="openEmotion"
      />
      <EmptyCanvasLauncher
        v-if="nodes.length === 0 && activePanel !== 'nodes' && mode === 'workflow'"
        @add="addNode"
        @open-library="toggleNodeLibrary"
      />
      <NodeComposer
        v-if="showComposer"
        :key="graph.activeNode.id"
        :node="graph.activeNode"
        :position="composerPosition"
        @panel="openPanel"
        @angles="openAngles"
        @generated="focusGenerated"
      />
      <ImageActionToolbar
        v-if="
          mode === 'workflow' &&
          !emotionSource &&
          !angleSource &&
          graph.activeNode?.data.kind === 'image' &&
          graph.activeNode.data.assetUrl &&
          !['preparing', 'submitting', 'queued', 'running'].includes(graph.activeNode.data.runState)
        "
        :node="graph.activeNode"
        :left="imageToolbarPosition.left"
        :top="imageToolbarPosition.top"
        @preview="openImagePreview"
        @focus="focusStoryboard"
        @emotion="openEmotion"
        @angles="openAngles"
      />
      <MultiAngleEditor
        v-if="angleSource"
        :key="angleSource.id"
        :node="angleSource"
        :target="angleTarget"
        :anchor="angleAnchor"
        :viewport="screenSize"
        @close="angleSource = null"
        @created="focusStoryboard"
      />
      <PortraitEmotionPanel
        v-if="emotionSource"
        :key="emotionSource.id"
        :node="emotionSource"
        :target="emotionTarget"
        @close="emotionSource = null"
        @created="focusStoryboard"
      />
      <div v-if="previewImage" class="cv3-image-lightbox" @click.self="previewImage = ''">
        <button type="button" aria-label="关闭图片预览" @click="previewImage = ''">
          <CanvasIcon name="close" :size="24" />
        </button>
        <PanoramaViewer v-if="previewPanorama" :src="previewImage" />
        <img v-else :src="previewImage" alt="图片大图预览" />
      </div>
      <NodeLibraryPanel
        v-if="activePanel === 'nodes'"
        :position="menuPosition"
        :reference-mode="Boolean(pendingReference)"
        @add="addNode"
        @panel="openPanel"
      />
      <CanvasUtilityPanel
        v-if="activePanel && !['nodes', 'assistant'].includes(activePanel)"
        :panel="activePanel"
        @close="activePanel = ''"
        @demo="openDemo"
        @export="exportGraph"
      />
      <DirectorPanel
        v-if="activePanel === 'assistant'"
        :docked="directorDocked"
        :dock-width="directorDockWidth"
        :session-id="projectId"
        :agent-runs="directorAgentRuns"
        :conversations="directorConversations"
        :conversation-id="directorConversationId"
        :conversation-loading="directorConversationLoading"
        @update:docked="setDirectorDocked"
        @update:dock-width="setDirectorDockWidth"
        @dock-width-commit="commitDirectorDockWidth"
        @submit="handleDirectorSubmit"
        @cancel-agent="cancelDirectorAgent"
        @confirm-generation="confirmDirectorGeneration"
        @retry-agent="retryDirectorAgent"
        @new-conversation="startDirectorConversation"
        @load-conversations="loadDirectorConversations"
        @select-conversation="selectDirectorConversation"
        @close="closeDirector"
      />
      <section v-if="mode === 'storyboard'" class="cv3-storyboard">
        <header>
          <h1>故事板</h1>
          <span>{{ storyboardNodes.length }} 个创作节点</span>
          <button type="button" @click="mode = 'workflow'">返回工作流</button>
        </header>
        <div v-if="storyboardNodes.length" class="cv3-storyboard-grid">
          <button
            v-for="(node, index) in storyboardNodes"
            :key="node.id"
            type="button"
            @click="focusStoryboard(node)"
          >
            <div>
              <img
                v-if="node.data.assetUrl && node.data.kind === 'image'"
                :src="node.data.assetUrl"
                :alt="node.data.title"
              />
              <CanvasIcon v-else :name="node.data.kind" :size="36" />
            </div>
            <strong>{{ String(index + 1).padStart(2, '0') }} · {{ node.data.title }}</strong>
            <p>{{ node.data.prompt || '添加画面描述' }}</p>
          </button>
        </div>
        <div v-else class="cv3-utility-empty">
          <CanvasIcon name="storyboard" :size="40" />
          <p>添加图片、视频或脚本节点后，在这里整理故事板</p>
          <button type="button" @click="addFromStoryboard">添加节点</button>
        </div>
      </section>
      <div class="cv3-bottom-left">
        <button
          type="button"
          class="cv3-asset-button"
          title="资产管理"
          aria-label="资产管理"
          @click="openPanel('assets')"
        >
          <CanvasIcon name="assets" :size="14" />
          <span>资产管理</span>
        </button>
        <button
          type="button"
          class="cv3-micro-button"
          title="整理画布，Alt+Shift+F"
          aria-label="整理画布"
          @click="layoutCanvas"
        >
          <CanvasIcon name="layout" :size="14" />
        </button>
        <button
          type="button"
          class="cv3-micro-button"
          :class="{ active: minimapVisible }"
          title="切换小地图"
          aria-label="切换小地图"
          :aria-pressed="minimapVisible"
          @click="minimapVisible = !minimapVisible"
        >
          <CanvasIcon name="minimap" :size="13" />
        </button>
        <button
          type="button"
          class="cv3-micro-button"
          :class="{ active: !edgeVisible }"
          title="隐藏节点连线"
          aria-label="隐藏节点连线"
          :aria-pressed="!edgeVisible"
          @click="edgeVisible = !edgeVisible"
        >
          <CanvasIcon name="links" :size="14" />
        </button>
        <button
          type="button"
          class="cv3-micro-button"
          :class="{ active: snapToGrid }"
          title="网格吸附"
          aria-label="网格吸附"
          :aria-pressed="snapToGrid"
          @click="snapToGrid = !snapToGrid"
        >
          <CanvasIcon name="magnet" :size="14" />
        </button>
        <button
          type="button"
          class="cv3-zoom-button"
          title="缩放选项"
          aria-label="缩放选项"
          @click="zoomMenu = !zoomMenu"
        >
          {{ zoomPercent }}%
        </button>
        <div v-if="zoomMenu" class="cv3-zoom-menu">
          <button type="button" @click="fitCanvas">
            适应画布
            <kbd>Ctrl 0</kbd>
          </button>
          <button v-for="value in [0.5, 1, 2, 8]" :key="value" type="button" @click="zoomAt(value)">
            {{ value * 100 }}%
          </button>
          <button type="button" @click="resetViewport">重置视图</button>
        </div>
      </div>
      <div class="cv3-bottom-center">
        <CanvasBottomBar
          :panel-open="activePanel === 'nodes'"
          :active-panel="activePanel"
          :tool="tool"
          @open-library="toggleNodeLibrary"
          @tool="tool = $event"
          @panel="openPanel"
        />
        <div v-if="activePanel !== 'assistant'" class="cv3-agent-slot">
          <AgentOrb
            ref="agentOrb"
            aria-controls="cv3-director-panel"
            :active="false"
            @click="openPanel('assistant')"
          />
        </div>
      </div>
    </section>
  </main>
</template>
