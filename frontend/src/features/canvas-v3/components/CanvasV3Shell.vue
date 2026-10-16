<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { ConnectionMode, VueFlow, useVueFlow } from '@vue-flow/core'
import { Background, BackgroundVariant } from '@vue-flow/background'
import { MiniMap } from '@vue-flow/minimap'
import { useRoute, useRouter } from 'vue-router'
import { useCanvasV3GraphStore } from '../stores/graph'
import { useCanvasV3UiStore } from '../stores/ui'
import { useCanvasV3Persistence } from '../sync/useCanvasV3Persistence'
import { nodeSize } from '../config/nodeControls'
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
const { nodes, edges, title, viewport } = storeToRefs(graph)
const { activePanel, minimapVisible, snapToGrid, tool, mode } = storeToRefs(ui)
const { saveStatus } = useCanvasV3Persistence(props.projectId, graph)
const canvasWrap = ref(null)
const agentOrb = ref(null)
const DIRECTOR_MODE_KEY = 'libtv:chatAgentDrawer:mode'
const DIRECTOR_WIDTH_KEY = 'libtv:chatAgentDrawer:width'

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
  const sourceCenterY = source.position.y + 175
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
  const size = nodeSize(node.data.kind)
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
  return node
    ? {
        centerX: (node.position.x + 312) * view.zoom + view.x,
        bottom: (node.position.y + 350) * view.zoom + view.y,
      }
    : { centerX: screenSize.value.width / 2, bottom: 100 }
})
const showComposer = computed(
  () =>
    mode.value === 'workflow' &&
    !emotionSource.value &&
    !angleSource.value &&
    graph.activeNode &&
    !['text', 'reference'].includes(graph.activeNode.data.kind),
)
const storyboardNodes = computed(() =>
  nodes.value.filter((node) => ['image', 'video', 'script'].includes(node.data.kind)),
)
const imageToolbarTop = computed(() =>
  graph.activeNode
    ? Math.max(
        56,
        graph.activeNode.position.y * liveViewport.value.zoom + liveViewport.value.y - 84,
      )
    : 56,
)
const pendingReferencePath = computed(() => {
  const pending = pendingReference.value
  if (!pending) return ''
  const node = nodes.value.find((item) => item.id === pending.start.nodeId)
  if (!node) return ''
  const size = nodeSize(node.data.kind)
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
  setCenter(node.position.x + nodeSize(node.data.kind).width / 2, node.position.y + 245, {
    zoom: 0.8,
    duration: 200,
  })
}
async function focusGenerated(node) {
  const source = nodes.value.find((item) => item.id === node.data.sourceImageNodeId)
  if (!source) return focusStoryboard(node)
  await nextTick()
  const sourceSize = nodeSize(source.data.kind)
  const targetSize = nodeSize(node.data.kind)
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
  tasks.attach(props.projectId)
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
        :top="imageToolbarTop"
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
        @update:docked="setDirectorDocked"
        @update:dock-width="setDirectorDockWidth"
        @dock-width-commit="commitDirectorDockWidth"
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
