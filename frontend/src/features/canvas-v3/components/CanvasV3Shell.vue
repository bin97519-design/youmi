<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
import {
  dedupeDirectorAgentRuns,
  directorClarificationAssetsIntent,
  directorRequestContextLayers,
  directorRunReplyContext,
} from '../config/directorConversation'
import {
  directorImageSourceMode,
  directorScriptSourceMode,
  DIRECTOR_REFERENCE_IMAGE_LIMIT,
  directorClarificationInstruction,
  isDirectorClarificationComplete,
  isDirectorClarificationReady,
  normalizeDirectorClarificationAnswers,
  normalizeDirectorQuestions,
} from '../config/directorClarifications'
import {
  directorApplyImageSourceIntent,
  directorReferenceImages,
} from '../config/directorImageSources'
import {
  directorApplyScriptSourceIntent,
  directorScriptBrief,
  directorScriptReferenceCandidates,
} from '../config/directorScriptReferences'
import { createDirectorImageExecutionIntent } from '../config/directorImageExecution'
import {
  latestDirectorConversation,
  mergeDirectorConversationMessages,
} from '../config/directorRecentConversation'
import {
  directorCurrentReferenceLayerIds,
  directorPendingClarificationRun,
  directorResponseRouting,
  directorSwitchReferenceIntent,
  directorTurnContext,
} from '../config/directorRouting'
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
import CharacterStudioDialog from './CharacterStudioDialog.vue'
import { useCanvasV3TaskStore } from '../stores/tasks'
import ImageActionToolbar from './ImageActionToolbar.vue'
import FlowingEdge from './FlowingEdge.vue'
import EdgeFlowSegments from './EdgeFlowSegments.vue'
import ConnectionPreview from './ConnectionPreview.vue'
import PortraitEmotionPanel from './PortraitEmotionPanel.vue'
import PanoramaViewer from './PanoramaViewer.vue'
import ImageContextMenu from './ImageContextMenu.vue'
import ImageSaveAssetDialog from './ImageSaveAssetDialog.vue'
import ImageCreateSubjectDialog from './ImageCreateSubjectDialog.vue'
import ImageComplianceDialog from './ImageComplianceDialog.vue'
import VideoContextMenu from './VideoContextMenu.vue'
import VideoActionToolbar from './VideoActionToolbar.vue'
import VideoPreviewDialog from './VideoPreviewDialog.vue'
import VideoSaveAssetDialog from './VideoSaveAssetDialog.vue'
import VideoActionStatusDialog from './VideoActionStatusDialog.vue'
import SelectionActionToolbar from './SelectionActionToolbar.vue'
import SelectionSaveAssetDialog from './SelectionSaveAssetDialog.vue'
import GroupActionToolbar from './GroupActionToolbar.vue'
import GroupFrame from './GroupFrame.vue'
import GroupWorkflowDialog from './GroupWorkflowDialog.vue'
import { canvasSelectionBounds } from '../config/selectionGeometry.js'
import { canvasGroupBounds } from '../config/groupGeometry.js'
import { groupAtPointer } from '../config/groupHover.js'
import { normalizedGroupColor } from '../config/groupAppearance.js'
import { createGroupFrameResize } from '../sync/groupFrameResize.js'
import { createGroupConnectionDrag } from '../sync/groupConnectionDrag.js'
import {
  groupExecutionPlan,
  groupExecutionApprovalSignature,
  createGroupExecutionRunner,
} from '../config/groupExecution.js'
import {
  loadGroupToolbox,
  saveGroupToolbox,
  removeGroupToolbox,
  groupToolboxSnapshot,
} from '../config/groupToolbox.js'
import { createSelectionFrameDrag, moveSelectedByKey } from '../sync/selectionFrameDrag.js'
import {
  createCanvasSelectionDownloadClient,
  saveCanvasSelectionArchive,
} from '../sync/canvasSelectionDownload.js'
import VideoEnhanceDialog from '../../../components/canvas/VideoEnhanceDialog.vue'
import { videoSavedAssetInfo } from '../sync/videoSavedAssetClient.js'
import { createVideoNodeActions } from '../sync/videoNodeActions.js'
import { copyCanvasImage } from '../sync/imageClipboard.js'
import {
  createNodeClipboard,
  serializeNodeClipboard,
  parseNodeClipboard,
  isNodeClipboardCopyBlocked,
} from '../config/nodeClipboard.js'
import MultiAngleEditor from './MultiAngleEditor.vue'
import { canvasGestures } from '../config/canvasGestures'
import { MAX_IMAGE_UPLOAD_BYTES, uploadFileDirect } from '../../../utils/ossUpload.js'
import {
  canvasImageFiles,
  canvasImageTargetIsEditable,
  canvasTransferHasFiles,
  createCanvasImageImporter,
} from '../sync/canvasImageImport.js'

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
const directorPanel = ref(null)
const selectionDragging = ref(false)
const selectionSaveNodes = ref(null)
const selectionDownloading = ref(false)
const selectionFrameDragging = ref(false)
let selectionDownloadRequest = null
const groupWorkflow = ref(null)
const groupWorkflowError = ref('')
const groupToolboxTemplates = ref([])
const groupExecuting = ref(false)
const groupExecutionProgress = ref('')
const groupResizing = ref(false)
const pendingGroupConnection = ref(null)
const groupHoverPoint = ref(null)
const groupConnectionPreview = ref(null)
const groupConnectionResetKey = ref(0)
let suppressGroupContextMenuUntil = 0
let groupExecutionRequest = null
const DIRECTOR_MODE_KEY = 'libtv:chatAgentDrawer:mode'
const DIRECTOR_WIDTH_KEY = 'libtv:chatAgentDrawer:width'
const directorAgentRuns = ref([])
const directorConversationId = ref(directorRequestId('conversation'))
const directorConversations = ref([])
const directorConversationLoading = ref(false)
const directorConversationDeletingIds = ref([])
const directorConversationDeletedIds = new Set()
const directorRestoredMessages = ref([])
const directorRestoring = ref(false)
const directorRestoreError = ref('')
const directorConversationLoadError = ref('')
let directorConversationInitialized = false
let directorConversationRevision = 0
let directorHistoryRequest = null
let directorRecentRequest = null
let directorDisposed = false
const directorPlanningRequests = new Map()
const directorGenerationSubmissions = new Set()
const directorNodePreparations = new Map()
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
const imageContext = ref(null)
const imageDialog = ref(null)
const videoContext = ref(null)
const videoDialog = ref(null)
const previewVideo = ref(null)
const videoMediaBusy = ref(false)
const videoTimes = new Map()
const videoContextNode = computed(() =>
  nodes.value.find((node) => node.id === videoContext.value?.nodeId),
)
const videoActions = createVideoNodeActions({
  graph,
  getScope: () => `${props.projectId}:${user.profile?.id || ''}`,
  onBusy: (busy) => (videoMediaBusy.value = busy),
})
const assetRevision = ref(0)
let imageClipboardRequest = null
const imageContextNode = computed(() =>
  nodes.value.find((node) => node.id === imageContext.value?.nodeId),
)
const imageContextLocked = computed(() => {
  const selected = nodes.value.filter((node) => node.selected)
  return selected.some((node) => isNodeClipboardCopyBlocked(JSON.parse(JSON.stringify(node))))
})
function imageActionNotice(message, error = false) {
  imageImportStatus.value = { busy: false, message, error }
}
function openImageContextMenu({ event, node }) {
  if (node.data.kind === 'video' && node.data.assetUrl) {
    if (imageDialog.value || videoDialog.value || previewVideo.value) return
    event.preventDefault()
    event.stopPropagation()
    if (!node.selected) {
      nodes.value.forEach((item) => (item.selected = item.id === node.id))
      edges.value.forEach((edge) => (edge.selected = false))
    }
    clearPendingReference()
    imageContext.value = null
    videoContext.value = { nodeId: node.id, x: event.clientX, y: event.clientY }
    return
  }
  if (
    node.data.kind !== 'image' ||
    !node.data.assetUrl ||
    imageDialog.value ||
    videoDialog.value ||
    previewVideo.value
  )
    return
  event.preventDefault()
  event.stopPropagation()
  if (!node.selected) {
    nodes.value.forEach((item) => (item.selected = item.id === node.id))
    edges.value.forEach((edge) => (edge.selected = false))
  }
  clearPendingReference()
  videoContext.value = null
  imageContext.value = { nodeId: node.id, x: event.clientX, y: event.clientY }
}

function videoTimeChanged({ nodeId, time }) {
  if (Number.isFinite(time) && time >= 0) videoTimes.set(nodeId, time)
}
function closeVideoPreview() {
  videoActions.cancel()
  previewVideo.value = null
}
function openVideoPreview(nodeId) {
  const node = nodes.value.find((item) => item.id === nodeId)
  if (!node || node.data.kind !== 'video' || !node.data.assetUrl) return
  previewVideo.value = {
    nodeId,
    source: node.data.assetUrl,
    title: node.data.title || '视频预览',
    poster: node.data.posterUrl || node.data.thumbnail || '',
    time: videoTimes.get(nodeId) || 0,
  }
}
async function handleVideoSnapshot({ nodeId, time, position = 'current' }) {
  try {
    await videoActions.frame(nodeId, {
      time: time ?? videoTimes.get(nodeId) ?? 0,
      position,
      addToCanvas: true,
    })
    imageActionNotice('已截取真实视频帧并加入画布')
  } catch (error) {
    if (error.name !== 'AbortError') imageActionNotice(error.message || '视频截帧失败', true)
  }
}
async function downloadCanvasVideo(nodeId) {
  try {
    const result = await videoActions.download(nodeId)
    const url = URL.createObjectURL(result.blob)
    const link = document.createElement('a')
    try {
      link.href = url
      link.download = result.filename
      link.style.display = 'none'
      document.body.appendChild(link)
      link.click()
    } finally {
      link.remove()
      // Allow the browser's download consumer to acquire the Blob first.
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
    imageActionNotice('已发起原视频下载')
  } catch (error) {
    if (error.name !== 'AbortError') imageActionNotice(error.message || '视频下载失败', true)
  }
}
async function handleVideoContextAction(action) {
  const node = videoContextNode.value
  const point = videoContext.value && { x: videoContext.value.x, y: videoContext.value.y }
  videoContext.value = null
  if (!node) return
  try {
    if (action === 'copy-node') await copySelectedNodes()
    else if (action === 'paste') await pasteFromSystemClipboard(point)
    else if (action === 'duplicate') graph.duplicateSelected()
    else if (action === 'delete') graph.removeSelected()
    else if (action === 'save-asset')
      videoDialog.value = { kind: action, node: JSON.parse(JSON.stringify(node)) }
    else if (action === 'compliance')
      videoDialog.value = { kind: action, node: JSON.parse(JSON.stringify(node)) }
    else if (action === 'create-subject') {
      const result = await videoActions.frame(node.id, { time: videoTimes.get(node.id) || 0 })
      imageDialog.value = { kind: 'create-subject', node: result.sourceNode }
    } else if (action === 'copy-to-clipboard') {
      if (!navigator.clipboard?.write || typeof ClipboardItem !== 'function')
        throw new Error('当前浏览器不支持复制视频帧，请使用截取当前帧')
      const frame = videoActions.frame(node.id, { time: videoTimes.get(node.id) || 0 })
      const png = frame.then((result) => result.blob)
      // Clipboard construction can throw before it starts consuming the promise.
      // Keep that synchronous rejection path from leaving an unhandled capture.
      void png.catch(() => {})
      // Register the clipboard write within the original user activation.
      await Promise.all([
        navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]),
        frame,
      ])
      imageActionNotice('当前视频帧已复制到系统剪贴板')
    }
  } catch (error) {
    videoActions.cancel()
    if (error.name !== 'AbortError') imageActionNotice(error.message || '视频操作失败', true)
  }
}
function handleVideoToolbarAction(action, payload) {
  const node = graph.activeNode
  if (!node || node.data.kind !== 'video' || !node.data.assetUrl) return
  if (action === 'snapshot')
    return handleVideoSnapshot({ nodeId: node.id, position: payload?.position || 'current' })
  if (action === 'download') return downloadCanvasVideo(node.id)
  if (action === 'expand') return openVideoPreview(node.id)
  videoDialog.value = { kind: action, node: JSON.parse(JSON.stringify(node)) }
}
function handleVideoAssetSaved() {
  assetRevision.value += 1
  videoDialog.value = null
  imageActionNotice('视频已保存到个人资产库')
}
function importSavedVideo(record) {
  if (!canImportCanvasImages()) return
  const asset = videoSavedAssetInfo(record)
  if (!asset) return imageActionNotice('视频资产地址无效', true)
  const rect = canvasWrap.value.getBoundingClientRect()
  const anchor = screenToFlowCoordinate({
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  })
  const node = graph.addNode('video', anchor)
  graph.updateNodeData(node.id, {
    title: record.name || '我的视频资产',
    assetUrl: asset.url,
    posterUrl: asset.posterUrl,
    mediaWidth: asset.width,
    mediaHeight: asset.height,
    mediaDuration: asset.duration,
    mediaOrigin: 'upload',
    artifactStatus: 'ready',
    runState: 'idle',
  })
}
function previewSavedVideo(record) {
  const asset = videoSavedAssetInfo(record)
  if (!asset) return imageActionNotice('视频资产地址无效', true)
  const rect = canvasWrap.value.getBoundingClientRect()
  const transient = {
    id: `saved-video-${record.id}`,
    position: screenToFlowCoordinate({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    }),
    data: {
      kind: 'video',
      title: record.name || '我的视频资产',
      assetUrl: asset.url,
      mediaWidth: asset.width,
      mediaHeight: asset.height,
      mediaDuration: asset.duration,
    },
  }
  previewVideo.value = {
    nodeId: transient,
    source: asset.url,
    poster: asset.posterUrl,
    title: transient.data.title,
    time: 0,
  }
}
function previewVideoMetadata({ width, height, duration }) {
  const preview = previewVideo.value
  if (!preview) return
  const transient = typeof preview.nodeId === 'object'
  const node = transient ? preview.nodeId : nodes.value.find((item) => item.id === preview.nodeId)
  if (!node || node.data.assetUrl !== preview.source) return
  const patch = {}
  if (width > 0 && height > 0) {
    patch.mediaWidth = width
    patch.mediaHeight = height
  }
  if (Number.isFinite(duration) && duration > 0) patch.mediaDuration = duration
  if (transient) Object.assign(node.data, patch)
  else if (Object.entries(patch).some(([key, value]) => node.data[key] !== value))
    graph.updateNodeData(node.id, patch)
}
function saveEnhancedVideo(result) {
  if (!result?.resultUrl) throw new Error('增强服务没有返回成品视频')
  const source = videoDialog.value?.node
  if (!source || videoDialog.value?.kind !== 'enhance') throw new Error('原视频操作已关闭')
  const size = nodeSize('video', source.data)
  const node = graph.addNode('video', {
    x: source.position.x + size.width + 72,
    y: source.position.y,
  })
  graph.updateNodeData(node.id, {
    title: `${source.data.title || '视频'}-高清`,
    assetUrl: result.resultUrl,
    artifactStatus: 'ready',
    runState: 'idle',
    enhancementResultId: result.id,
  })
  imageActionNotice('增强视频已加入画布，原视频保持不变')
}
function resetVideoActions() {
  videoActions.cancel()
  videoContext.value = null
  videoDialog.value = null
  previewVideo.value = null
  videoTimes.clear()
}
function selectedNodeClipboard() {
  return createNodeClipboard(
    JSON.parse(JSON.stringify(nodes.value.filter((node) => node.selected))),
    JSON.parse(JSON.stringify(edges.value)),
  )
}
async function copySelectedNodes() {
  const text = serializeNodeClipboard(selectedNodeClipboard())
  if (!navigator.clipboard?.writeText) throw new Error('浏览器不支持直接复制，请使用 Ctrl+C')
  await navigator.clipboard.writeText(text)
  imageActionNotice('节点已复制，可在画布中粘贴')
}
function handleCanvasNodeCopy(event) {
  if (
    event.defaultPrevented ||
    !canImportCanvasImages() ||
    canvasImageTargetIsEditable(event.target) ||
    !nodes.value.some((node) => node.selected)
  )
    return
  try {
    const text = serializeNodeClipboard(selectedNodeClipboard())
    event.clipboardData.setData('text/plain', text)
    event.preventDefault()
    imageActionNotice('节点已复制，可在画布中粘贴')
  } catch (error) {
    event.preventDefault()
    imageActionNotice(error.message, true)
  }
}
function pasteNodes(snapshot, point) {
  const rect = canvasWrap.value.getBoundingClientRect()
  const anchor = screenToFlowCoordinate(
    point || { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
  )
  graph.pasteNodeClipboard(snapshot, anchor)
  imageActionNotice(`已粘贴 ${snapshot.nodes.length} 个节点`)
}
async function pasteFromSystemClipboard(point) {
  const scope = `${graph.projectId}:${user.profile?.id || ''}`
  let snapshot = null
  // Reading image clipboard formats needs the user's explicit menu click.
  if (navigator.clipboard?.read) {
    const items = await navigator.clipboard.read()
    const files = []
    for (const item of items) {
      const type = item.types.find((value) => /^image\/(png|jpeg|webp|gif|avif|bmp)$/i.test(value))
      if (type) files.push(new File([await item.getType(type)], 'clipboard.png', { type }))
      else if (item.types.includes('text/plain'))
        snapshot = parseNodeClipboard(await (await item.getType('text/plain')).text()) || snapshot
    }
    if (scope !== `${graph.projectId}:${user.profile?.id || ''}` || !canImportCanvasImages()) return
    if (files.length) return importCanvasImages(files, point)
  } else if (navigator.clipboard?.readText) {
    snapshot = parseNodeClipboard(await navigator.clipboard.readText())
  } else throw new Error('浏览器不支持菜单粘贴，请使用 Ctrl+V')
  if (scope !== `${graph.projectId}:${user.profile?.id || ''}` || !canImportCanvasImages()) return
  if (!snapshot) throw new Error('剪贴板中没有可粘贴的图片或画布节点，请使用 Ctrl+V 粘贴图片')
  pasteNodes(snapshot, point)
}
async function handleImageContextAction(action) {
  const node = imageContextNode.value
  const point = imageContext.value && { x: imageContext.value.x, y: imageContext.value.y }
  imageContext.value = null
  if (!node) return
  try {
    if (action === 'copy-image' || action === 'copy-to-clipboard') {
      // Invoke synchronously in this click before any awaits, retaining clipboard activation.
      imageClipboardRequest?.abort()
      const controller = new AbortController()
      imageClipboardRequest = controller
      const scope = `${props.projectId}:${user.profile?.id || ''}`
      try {
        await copyCanvasImage(node.data.assetUrl, {
          path: apiPath,
          headers: user.authHeaders(),
          signal: controller.signal,
        })
        if (!controller.signal.aborted && scope === `${props.projectId}:${user.profile?.id || ''}`)
          imageActionNotice('图片已复制到系统剪贴板')
      } finally {
        if (imageClipboardRequest === controller) imageClipboardRequest = null
      }
    } else if (action === 'copy-node') await copySelectedNodes()
    else if (action === 'paste') await pasteFromSystemClipboard(point)
    else if (action === 'duplicate') graph.duplicateSelected()
    else if (action === 'delete') graph.removeSelected()
    else if (action === 'layout') await layoutCanvas()
    else if (action === 'panorama') {
      previewPanorama.value = true
      previewImage.value = node.data.assetUrl
    } else if (['save-asset', 'create-subject', 'compliance'].includes(action))
      imageDialog.value = { kind: action, node: JSON.parse(JSON.stringify(node)) }
  } catch (error) {
    if (error.name === 'AbortError') return
    imageActionNotice(error.message || '操作失败，请重试', true)
  }
}
function handleImageAssetSaved() {
  assetRevision.value += 1
  imageDialog.value = null
  imageActionNotice('已保存到个人资产库')
}
function importSavedImage(record) {
  if (!canImportCanvasImages()) return
  const rect = canvasWrap.value.getBoundingClientRect()
  const meta = record.config?.canvasAsset || {}
  graph.addImageAssets(
    [
      {
        title: record.name || '我的资产',
        assetUrl: record.imageUrl,
        mediaWidth: meta.width || 1024,
        mediaHeight: meta.height || 1024,
      },
    ],
    screenToFlowCoordinate({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }),
  )
}
function previewSavedImage(record) {
  previewPanorama.value = false
  previewImage.value = record.imageUrl
}
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
  nodesSelectionActive,
} = useVueFlow('youmi-canvas-v3')
const multiSelection = computed(() => graph.selectedNodes.length >= 2)
const selectionFrameDrag = createSelectionFrameDrag({
  graph,
  getScope: () => ({ projectId: props.projectId, token: user.token, userId: user.profile?.id }),
  getZoom: () => liveViewport.value.zoom,
})
function beginSelectionFrameDrag(event) {
  if (gestures.value.hand || !selectionFrameDrag.start(event)) return
  event.preventDefault()
  event.stopPropagation()
  event.currentTarget.setPointerCapture?.(event.pointerId)
  event.currentTarget
    .closest?.('.cv3-group-frame, .cv3-selection-frame')
    ?.focus?.({ preventScroll: true })
  selectionFrameDragging.value = true
}
function endSelectionFrameDrag(event) {
  selectionFrameDrag.end(event)
  selectionFrameDragging.value = false
}
function cancelSelectionFrameDrag() {
  selectionFrameDrag.cancel()
  selectionFrameDragging.value = false
}
const groupFrameResize = createGroupFrameResize({
  graph,
  getScope: () => ({ projectId: props.projectId, token: user.token, userId: user.profile?.id }),
  getZoom: () => liveViewport.value.zoom,
})
function beginGroupResize({ event, corner }) {
  if (gestures.value.hand || !groupFrameResize.start(event, corner)) return
  groupResizing.value = true
}
function endGroupResize(event) {
  groupFrameResize.end(event)
  groupResizing.value = false
}
function cancelGroupResize() {
  groupFrameResize.cancel()
  groupResizing.value = false
}
const selectionBounds = computed(() =>
  multiSelection.value ? canvasSelectionBounds(graph.selectedNodes, liveViewport.value) : null,
)
const selectionGroups = computed(() => {
  const groups = new Map()
  for (const node of nodes.value) {
    if (!node.data.groupId) continue
    if (!groups.has(node.data.groupId)) groups.set(node.data.groupId, [])
    groups.get(node.data.groupId).push(node)
  }
  return [...groups.entries()]
    .filter(([, members]) => members.length >= 2)
    .map(([id, members]) => {
      const bounds = canvasGroupBounds(members, liveViewport.value)
      const view = liveViewport.value
      return {
        id,
        nodeId: members[0].id,
        name: members[0].data.groupName || '分组',
        type: members[0].data.groupType || 'normal',
        color: normalizedGroupColor(members[0].data.groupColor),
        mutable:
          !members.some((node) => isNodeClipboardCopyBlocked(JSON.parse(JSON.stringify(node)))) &&
          !groupExecuting.value,
        bounds,
        selected: graph.selectedGroup?.id === id,
        members: members.map((node) => {
          const size = nodeSize(node.data.kind, node.data)
          return {
            id: node.id,
            rect: bounds && {
              left: node.position.x * view.zoom + view.x - bounds.left - 12,
              top: node.position.y * view.zoom + view.y - bounds.top - 26,
              right: (node.position.x + size.width) * view.zoom + view.x - bounds.left + 12,
              bottom: (node.position.y + size.height) * view.zoom + view.y - bounds.top + 10,
            },
          }
        }),
      }
    })
    .filter((group) => group.bounds)
})
const activePersistentGroup = computed(() =>
  selectionGroups.value.find((group) => group.id === graph.selectedGroup?.id),
)
const groupConnectionDrag = createGroupConnectionDrag({
  graph,
  getScope: groupScope,
  getCanvasRect: () => canvasWrap.value?.getBoundingClientRect(),
  onPreview: (preview) => {
    groupConnectionPreview.value = preview
  },
  onRelease: finishGroupConnection,
  onCancel: () => {
    groupConnectionPreview.value = null
    groupConnectionResetKey.value += 1
    suppressGroupContextMenuUntil = Date.now() + 400
  },
})
const groupConnectionPath = computed(() => {
  const pending = groupConnectionPreview.value || pendingGroupConnection.value
  if (!pending?.screen) return ''
  const group = selectionGroups.value.find((item) => item.id === pending.groupId)
  if (!group) return ''
  const sx = group.bounds.right + 20
  const sy = group.bounds.centerY
  const { x: tx, y: ty } = pending.screen
  const bend = Math.max(72, Math.abs(tx - sx) * 0.45)
  return `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`
})
const hoveredGroupId = computed(() => groupAtPointer(selectionGroups.value, groupHoverPoint.value))
function handleGroupPointerMove(event) {
  const rect = canvasWrap.value?.getBoundingClientRect()
  if (!rect || event.pointerType === 'touch') return
  // Observe in capture phase instead of placing a hit surface above media.
  // Images, video controls, native selection and dragging keep their own events.
  groupHoverPoint.value = { x: event.clientX - rect.left, y: event.clientY - rect.top }
}
const selectionVisible = computed(
  () =>
    mode.value === 'workflow' &&
    multiSelection.value &&
    !selectionDragging.value &&
    !emotionSource.value &&
    !angleSource.value &&
    !previewImage.value &&
    !previewVideo.value &&
    !imageDialog.value &&
    !videoDialog.value &&
    !selectionSaveNodes.value &&
    !groupWorkflow.value,
)
const canSaveSelection = computed(
  () =>
    graph.selectedNodes.length > 0 &&
    graph.selectedNodes.every(
      (node) => ['image', 'video'].includes(node.data.kind) && Boolean(node.data.assetUrl),
    ),
)
const canChatSelection = computed(
  () =>
    graph.selectedNodes.length > 0 &&
    graph.selectedNodes.length <= 10 &&
    graph.selectedNodes.every((node) =>
      ['image', 'video'].includes(node.data.kind)
        ? Boolean(node.data.assetUrl)
        : ['text', 'reference', 'script'].includes(node.data.kind) &&
          Boolean(node.data.prompt?.trim()),
    ),
)
function selectionRectStyle(bounds) {
  return {
    left: `${bounds.left}px`,
    top: `${bounds.top}px`,
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
  }
}
function selectionSnapshot() {
  return graph.selectedNodes.map((node) => ({
    id: node.id,
    position: { ...node.position },
    data: Object.fromEntries(
      [
        'kind',
        'title',
        'prompt',
        'assetUrl',
        'thumbnail',
        'posterUrl',
        'mediaWidth',
        'mediaHeight',
        'mediaDuration',
        'durationSeconds',
        'mimeType',
        'fileSize',
        'fileName',
      ]
        .filter((key) => node.data[key] != null)
        .map((key) => [key, node.data[key]]),
    ),
  }))
}
function selectionMutation(action, type) {
  if (!graph.selectionMutable)
    return imageActionNotice('所选内容含进行中或待确认的任务，暂不能修改或创建副本', true)
  try {
    if (action === 'arrange') graph.arrangeSelected(type)
    else if (action === 'duplicate') graph.duplicateSelected()
    else if (action === 'ungroup') graph.ungroupSelected()
    else graph.groupSelected(undefined, type || 'normal')
  } catch (error) {
    imageActionNotice(error.message || '选区操作失败', true)
  }
}
function openSelectionSave() {
  if (!canSaveSelection.value) return imageActionNotice('请选择已有产物的图片或视频节点', true)
  selectionSaveNodes.value = selectionSnapshot()
}
function selectionAssetsSaved(records) {
  assetRevision.value += 1
  imageActionNotice(`已保存 ${records.length} 项素材到个人资产库`)
}
async function downloadSelection() {
  if (selectionDownloading.value) return
  const snapshot = selectionSnapshot()
  if (!snapshot.length) return
  const request = {
    controller: new AbortController(),
    projectId: props.projectId,
    token: user.token,
    userId: user.profile?.id,
  }
  selectionDownloadRequest = request
  selectionDownloading.value = true
  const current = () =>
    selectionDownloadRequest === request &&
    props.projectId === request.projectId &&
    user.token === request.token &&
    user.profile?.id === request.userId
  try {
    const downloader = createCanvasSelectionDownloadClient({
      path: apiPath,
      headers: () => user.authHeaders(),
      save: (blob, filename) => {
        if (!current() || request.controller.signal.aborted)
          throw new DOMException('下载已取消', 'AbortError')
        saveCanvasSelectionArchive(blob, filename)
      },
    })
    const result = await downloader.download(snapshot, {
      signal: request.controller.signal,
      filename: `${title.value || '画布'}-选中素材.zip`,
      onProgress: (progress) => {
        if (current())
          imageActionNotice(`正在打包选中素材 ${progress.completed}/${progress.total}…`)
      },
    })
    if (!current()) return
    imageActionNotice(
      result.complete
        ? `已下载 ${result.successCount} 项素材`
        : result.successCount
          ? `已下载 ${result.successCount} 项，${result.failedCount} 项失败；详见压缩包内失败清单`
          : '选中素材均未能下载，请检查素材地址或访问权限',
      !result.complete,
    )
  } catch (error) {
    if (current())
      imageActionNotice(
        error.name === 'AbortError'
          ? '已取消本次打包，未下载压缩包'
          : error.message || '批量下载失败',
        error.name !== 'AbortError',
      )
  } finally {
    if (selectionDownloadRequest === request) {
      selectionDownloadRequest = null
      selectionDownloading.value = false
    }
  }
}
async function selectionToDirector(createSkill = false) {
  if (!canChatSelection.value) return imageActionNotice('请选择不超过10个可用素材或文字节点', true)
  const snapshot = selectionSnapshot()
  const scope = {
    projectId: props.projectId,
    token: user.token,
    userId: user.profile?.id,
  }
  activePanel.value = 'assistant'
  menuPosition.value = null
  await restoreLatestDirectorConversation()
  if (
    scope.projectId !== props.projectId ||
    scope.token !== user.token ||
    scope.userId !== user.profile?.id
  )
    return
  if (directorRestoring.value || directorRestoreError.value)
    return imageActionNotice(directorRestoreError.value || '正在恢复对话，请稍后重新添加素材', true)
  scope.conversationId = directorConversationId.value
  await nextTick()
  if (
    scope.projectId !== props.projectId ||
    scope.conversationId !== directorConversationId.value ||
    scope.token !== user.token ||
    scope.userId !== user.profile?.id
  )
    return
  const result = directorPanel.value?.addCanvasSelection(snapshot, { ...scope, createSkill })
  if (!result || result.stale) return imageActionNotice('当前对话已切换，请重新添加选中素材', true)
  if (result.blocked) return imageActionNotice('当前对话尚未恢复，请稍后重新添加素材', true)
  if (createSkill && !result.skillCreationOpened)
    return imageActionNotice(
      result.rejections?.[0]?.reason || '选中素材未能加入，尚未打开 Skill 创建引导',
      true,
    )
  if (!createSkill && !result.acceptedCount)
    return imageActionNotice(
      result.duplicateCount
        ? '选中素材已在当前 Chat 草稿中，未重复添加或发送'
        : result.rejections?.[0]?.reason || '选中内容未能加入 Chat',
      !result.duplicateCount,
    )
  const message = createSkill
    ? '已带入所选素材，打开 Skill 创建引导；尚未发送或创建 Skill'
    : `已将 ${result.acceptedCount} 项内容加入 Chat 草稿，尚未发送`
  imageActionNotice(
    result.rejectedCount ? `${message}；${result.rejectedCount} 项未能加入` : message,
    result.rejectedCount > 0,
  )
}
function selectPersistentGroup(group) {
  graph.selectGroup(group.nodeId)
}
function handleSelectionNodeClick({ event, node }) {
  if (!event.ctrlKey && !event.metaKey && !event.shiftKey && node.data.groupId)
    graph.selectGroup(node.id)
}
function groupScope() {
  return { projectId: props.projectId, token: user.token, userId: user.profile?.id }
}
function groupScopeCurrent(scope) {
  return Boolean(
    scope &&
    scope.projectId === props.projectId &&
    scope.token === user.token &&
    scope.userId === user.profile?.id,
  )
}
function changeGroupAppearance(action, value) {
  if (!graph.selectedGroup || !graph.selectionMutable) return
  try {
    if (action === 'color') graph.setSelectedGroupColor(value)
    else if (action === 'rename') graph.renameSelectedGroup(value)
    else graph.convertSelectedGroup(value)
  } catch (error) {
    imageActionNotice(error.message || '分组修改失败', true)
  }
}
function renamePersistentGroup(group, name) {
  // Blurring A's editor while selecting B must never rename B.
  try {
    graph.renameGroup(group.id, name)
  } catch (error) {
    imageActionNotice(error.message || '分组名称修改失败', true)
  }
}
function openGroupWorkflow(type) {
  if (!graph.selectedGroup || !graph.selectionMutable || groupExecuting.value) return
  groupWorkflowError.value = ''
  try {
    const group = { ...graph.selectedGroup }
    const scope = groupScope()
    if (type === 'execute-confirm') {
      const plan = groupExecutionPlan(nodes.value, edges.value, group.id)
      if (!plan.generationCount)
        return imageActionNotice('组内没有待生成节点；已有图片和视频素材不会重复生成或扣费')
      groupWorkflow.value = {
        type,
        group,
        scope,
        plan,
        approval: groupExecutionApprovalSignature(nodes.value, edges.value, group.id),
      }
    } else {
      if (!user.profile?.id) return imageActionNotice('请先登录后使用本机工具箱', true)
      groupToolboxTemplates.value = loadGroupToolbox(localStorage, user.profile.id)
      groupWorkflow.value = {
        type: 'toolbox',
        group,
        scope,
        snapshot: createNodeClipboard(graph.selectedNodes, edges.value),
      }
    }
  } catch (error) {
    imageActionNotice(error.message || '无法打开分组操作', true)
  }
}
const groupRunner = createGroupExecutionRunner({
  getNodes: () => nodes.value,
  getEdges: () => edges.value,
  getScope: groupScope,
  runImage: (nodeId) => {
    groupExecutionRequest?.nodes?.push(nodes.value.find((node) => node.id === nodeId))
    return tasks.runImage(nodeId)
  },
  runVideo: (nodeId) => {
    groupExecutionRequest?.nodes?.push(nodes.value.find((node) => node.id === nodeId))
    return tasks.runVideo(nodeId)
  },
  onProgress: ({ completed, total, phase }) => {
    if (!groupScopeCurrent(groupExecutionRequest?.scope)) return
    groupExecutionProgress.value = `已完成 ${completed} / ${total} 个生成节点${phase === 'submitting' ? '，正在执行下一节点' : ''}`
  },
})
async function confirmGroupWorkflow(name) {
  const dialog = groupWorkflow.value
  if (!dialog || !groupScopeCurrent(dialog.scope) || groupExecuting.value) return
  groupWorkflowError.value = ''
  if (dialog.type === 'toolbox') {
    try {
      const record = saveGroupToolbox(localStorage, dialog.scope.userId, {
        nodes: dialog.snapshot.nodes,
        edges: dialog.snapshot.edges,
        groupId: dialog.group.id,
        name,
      })
      groupToolboxTemplates.value = loadGroupToolbox(localStorage, dialog.scope.userId)
      groupWorkflow.value = null
      imageActionNotice(`已将「${record.name}」保存到本机工具箱，可从分组工具栏再次打开复用`)
    } catch (error) {
      groupWorkflowError.value = error.message || '本机工具箱保存失败'
    }
    return
  }
  const request = { controller: new AbortController(), scope: dialog.scope, nodes: [] }
  try {
    if (
      graph.selectedGroup?.id !== dialog.group.id ||
      dialog.approval !== groupExecutionApprovalSignature(nodes.value, edges.value, dialog.group.id)
    )
      throw new Error('分组内容或参数已改变，请关闭弹框后重新确认整组执行；尚未提交任务')
    groupExecutionRequest = request
    groupExecuting.value = true
    groupExecutionProgress.value = `准备执行 ${dialog.plan.generationCount} 个生成节点`
    const result = await groupRunner.run(dialog.group.id, { signal: request.controller.signal })
    if (!groupScopeCurrent(request.scope)) return
    groupWorkflow.value = null
    imageActionNotice(`整组执行完成，已生成 ${result.completedCount} 个节点`)
  } catch (error) {
    if (!groupScopeCurrent(request.scope)) return
    const message = error.message || '整组执行未完成'
    if (groupWorkflow.value === dialog) groupWorkflowError.value = message
    imageActionNotice(message, error.name !== 'AbortError')
  } finally {
    if (groupExecutionRequest === request) {
      groupExecutionRequest = null
      groupExecuting.value = false
      groupExecutionProgress.value = ''
    }
  }
}
function cancelGroupWorkflow() {
  stopGroupPreparation()
  groupExecutionRequest?.controller.abort()
  groupWorkflow.value = null
  groupWorkflowError.value = ''
}
function stopGroupPreparation() {
  // Only abort still-unsubmitted preparations owned by this batch, never cancel
  // a paid/submitting task or touch an identically named node in another graph.
  for (const node of groupExecutionRequest?.nodes || [])
    if (node && nodes.value.includes(node) && node.data.runState === 'preparing')
      tasks.stopWaiting(node.id)
}
function loadGroupTemplate(recordId) {
  const dialog = groupWorkflow.value
  if (dialog?.type !== 'toolbox' || !groupScopeCurrent(dialog.scope)) return
  try {
    const record = loadGroupToolbox(localStorage, dialog.scope.userId).find(
      (item) => item.id === recordId,
    )
    const snapshot = groupToolboxSnapshot(record)
    const rect = canvasWrap.value.getBoundingClientRect()
    const center = screenToFlowCoordinate({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    })
    graph.pasteNodeClipboard(snapshot, center)
    groupWorkflow.value = null
    imageActionNotice(`已从本机工具箱添加「${record.name}」，未提交生成任务`)
  } catch (error) {
    groupWorkflowError.value = error.message || '模板载入失败'
  }
}
function removeGroupTemplate(recordId) {
  const dialog = groupWorkflow.value
  if (dialog?.type !== 'toolbox' || !groupScopeCurrent(dialog.scope)) return
  try {
    removeGroupToolbox(localStorage, dialog.scope.userId, recordId)
    groupToolboxTemplates.value = loadGroupToolbox(localStorage, dialog.scope.userId)
  } catch (error) {
    groupWorkflowError.value = error.message || '模板移除失败'
  }
}
function openGroupConnection(group, event) {
  if (gestures.value.hand || !graph.selectGroup(group.nodeId) || !graph.selectionMutable) return
  const rect = canvasWrap.value.getBoundingClientRect()
  const x = group.bounds.right + 28
  const y = group.bounds.centerY
  clearPendingReference()
  pendingGroupConnection.value = groupConnectionSnapshot(group.id)
  menuPosition.value = {
    x: Math.max(8, Math.min(rect.width - 228, x + 8)),
    y: Math.max(48, Math.min(rect.height - 390, y)),
  }
  menuFlowPosition.value = screenToFlowCoordinate({ x: rect.left + x, y: rect.top + y })
  activePanel.value = 'nodes'
  event?.stopPropagation?.()
}
function groupConnectionSnapshot(groupId, screen = null) {
  return {
    groupId,
    scope: groupScope(),
    members: nodes.value.filter((node) => node.data.groupId === groupId),
    screen,
  }
}
function groupConnectionCurrent(pending) {
  if (
    !groupScopeCurrent(pending?.scope) ||
    !Array.isArray(pending.members) ||
    pending.members.length < 2
  )
    return false
  const members = nodes.value.filter((node) => node.data.groupId === pending.groupId)
  return (
    members.length === pending.members.length &&
    pending.members.every((node) => members.includes(node))
  )
}
function beginGroupConnection(group, event) {
  if (gestures.value.hand || mode.value !== 'workflow' || !graph.selectGroup(group.nodeId)) {
    groupConnectionResetKey.value += 1
    return
  }
  clearPendingReference()
  activePanel.value = ''
  imageContext.value = null
  videoContext.value = null
  if (!groupConnectionDrag.start(group.id, event)) {
    groupConnectionResetKey.value += 1
    return
  }
  suppressGroupContextMenuUntil = Infinity
}
function endGroupConnection(event) {
  groupConnectionDrag.end(event)
  suppressGroupContextMenuUntil = Date.now() + 400
}
function finishGroupConnection({ groupId, screen }) {
  const wrapper = canvasWrap.value
  const rect = wrapper?.getBoundingClientRect()
  if (
    !rect ||
    screen.x < 0 ||
    screen.y < 0 ||
    screen.x > rect.width ||
    screen.y > rect.height ||
    mode.value !== 'workflow'
  )
    return
  if (typeof document.elementFromPoint === 'function') {
    const target = document.elementFromPoint(rect.left + screen.x, rect.top + screen.y)
    if (!target || !wrapper.contains(target)) return
  }
  pendingGroupConnection.value = groupConnectionSnapshot(groupId, { ...screen })
  menuPosition.value = {
    x: Math.max(8, Math.min(rect.width - 228, screen.x + 12)),
    y: Math.max(48, Math.min(rect.height - 390, screen.y + 12)),
  }
  menuFlowPosition.value = screenToFlowCoordinate({
    x: rect.left + screen.x,
    y: rect.top + screen.y,
  })
  activePanel.value = 'nodes'
  suppressPaneClick = true
  setTimeout(() => {
    suppressPaneClick = false
  })
}
watch(
  [() => props.projectId, () => user.token, () => user.profile?.id],
  () => {
    selectionDownloadRequest?.controller.abort()
    cancelSelectionFrameDrag()
    selectionDragging.value = false
    selectionSaveNodes.value = null
    cancelGroupResize()
    stopGroupPreparation()
    groupExecutionRequest?.controller.abort()
    groupWorkflow.value = null
    groupWorkflowError.value = ''
    groupToolboxTemplates.value = []
    pendingGroupConnection.value = null
    groupHoverPoint.value = null
    groupConnectionDrag.cancel()
  },
  { flush: 'sync' },
)
watch(
  () => graph.selectedNodes.map((node) => node.id).join(','),
  async () => {
    if (!multiSelection.value || selectionDragging.value) return
    await nextTick()
    if (multiSelection.value && !selectionDragging.value) nodesSelectionActive.value = true
  },
)
const zoomPercent = computed(() => Math.round(liveViewport.value.zoom * 100))
const imageDragActive = ref(false)
const imageImportStatus = ref(null)
const imageImporter = createCanvasImageImporter({
  graph,
  upload: uploadFileDirect,
  maxBytes: MAX_IMAGE_UPLOAD_BYTES,
  canUpload: () => user.isAuthenticated,
  getScope: () => `${graph.projectId}:${user.profile?.id || ''}`,
  onStatus: (status) => (imageImportStatus.value = status),
})

function canImportCanvasImages() {
  return (
    mode.value === 'workflow' &&
    activePanel.value !== 'characters' &&
    !previewImage.value &&
    !previewVideo.value &&
    !videoDialog.value &&
    !emotionSource.value &&
    !angleSource.value &&
    !imageDialog.value &&
    !selectionSaveNodes.value &&
    graph.hydrated &&
    !groupWorkflow.value
  )
}
function importCanvasImages(files, point) {
  if (!files.length || !canImportCanvasImages()) return
  const rect = canvasWrap.value.getBoundingClientRect()
  const anchor = screenToFlowCoordinate(
    point || { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
  )
  clearPendingReference()
  void imageImporter.importFiles(files, anchor).catch((error) => {
    imageImportStatus.value = { busy: false, error: true, message: error.message || '图片导入失败' }
  })
}
function handleCanvasImagePaste(event) {
  if (
    event.defaultPrevented ||
    selectionSaveNodes.value ||
    event.target?.closest?.('[data-cv3-selection-ui]') ||
    !canImportCanvasImages() ||
    canvasImageTargetIsEditable(event.target)
  )
    return
  const files = canvasImageFiles(event.clipboardData)
  if (files.length) {
    event.preventDefault()
    imageContext.value = null
    importCanvasImages(files)
    return
  }
  const snapshot = parseNodeClipboard(event.clipboardData?.getData?.('text/plain') || '')
  if (!snapshot) return
  event.preventDefault()
  imageContext.value = null
  try {
    pasteNodes(snapshot)
  } catch (error) {
    imageActionNotice(error.message || '节点粘贴失败', true)
  }
}
function handleCanvasImageDragOver(event) {
  if (!canImportCanvasImages() || !canvasTransferHasFiles(event.dataTransfer)) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'copy'
  imageDragActive.value = true
}
function handleCanvasImageDragLeave(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) imageDragActive.value = false
}
function handleCanvasImageDrop(event) {
  imageDragActive.value = false
  if (!canImportCanvasImages() || !canvasTransferHasFiles(event.dataTransfer)) return
  event.preventDefault()
  event.stopPropagation()
  const files = canvasImageFiles(event.dataTransfer)
  if (!files.length) {
    imageImportStatus.value = {
      busy: false,
      error: true,
      message: '请拖入 PNG、JPG、WebP 等图片文件',
    }
    return
  }
  importCanvasImages(files, { x: event.clientX, y: event.clientY })
}
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
    !(graph.activeNode.data.kind === 'video' && graph.activeNode.data.assetUrl) &&
    !isStandaloneUploadedImage(graph.activeNode.data),
)
const storyboardNodes = computed(() =>
  nodes.value.filter((node) => ['image', 'video', 'script'].includes(node.data.kind)),
)
const directorAvailableAssets = computed(() =>
  nodes.value
    .filter((node) => node.data.assetUrl && ['image', 'video', 'audio'].includes(node.data.kind))
    .map((node) => ({
      id: node.id,
      layerId: node.id,
      nodeId: node.id,
      name: node.data.title || `${node.data.kind} 素材`,
      title: node.data.title || `${node.data.kind} 素材`,
      kind: node.data.kind,
      mimeType: node.data.mimeType || '',
      size: Number(node.data.fileSize) || 0,
      url: node.data.assetUrl,
      previewUrl: node.data.thumbnail || node.data.assetUrl,
    })),
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
const videoToolbarPosition = computed(() => ({
  left: imageToolbarPosition.value.left,
  top: imageToolbarPosition.value.top + 10,
}))
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
  groupConnectionDrag.cancel()
  groupConnectionPreview.value = null
  pendingGroupConnection.value = null
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
  if (panel === 'assistant' && activePanel.value === 'assistant')
    void restoreLatestDirectorConversation()
}
async function closeDirector() {
  window.clearTimeout(directorConversationSyncTimer)
  void saveDirectorConversation().catch(() => {})
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
  const pendingGroup = pendingGroupConnection.value
  if (pendingGroup && !groupConnectionCurrent(pendingGroup)) {
    clearPendingReference()
    imageActionNotice('原分组或画布已改变，请重新从分组加号连接；尚未创建节点', true)
    return
  }
  const node = pendingGroup
    ? graph.createGroupConnectedNode(
        kind,
        { x: center.x + 100, y: center.y - size.height / 2 },
        pendingGroup.groupId,
      )
    : pending
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
  imageContext.value = null
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
  if (groupConnectionDrag.active || Date.now() <= suppressGroupContextMenuUntil) {
    event.preventDefault()
    event.stopPropagation()
    return
  }
  if (!event.target?.closest?.('.vue-flow__pane')) return
  event.preventDefault()
  imageContext.value = null
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
    turnContext: run.turnContext,
    generationIntent: run.generationIntent,
    referenceCandidates: run.referenceCandidates,
    dryRun: run.dryRun,
    phase: run.phase,
    reply: run.reply,
    routing: run.routing,
    thinking: run.thinking,
    thinkingText: run.thinkingText,
    questions: run.questions,
    clarificationAnswers: run.clarificationAnswers,
    clarificationReplyRunId: run.clarificationReplyRunId,
    draft: run.draft,
    proposal: run.proposal,
    contentReady: run.contentReady,
    nodeId: run.nodeId,
    submissionStarted: run.submissionStarted,
    submissionStartedAt: run.submissionStartedAt,
    submissionState: run.submissionState,
    error: run.error,
  }
}

function directorConversationMessages() {
  const pairs = dedupeDirectorAgentRuns(directorAgentRuns.value).map((run) => [
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
  return mergeDirectorConversationMessages(directorRestoredMessages.value, pairs)
}

function directorConversationTitle() {
  const first =
    directorRestoredMessages.value.find((message) =>
      String(message?.display || message?.content || '').trim(),
    ) || directorAgentRuns.value[0]
  return (
    String(first?.display || first?.content || first?.instruction || '新对话')
      .trim()
      .slice(0, 80) || '新对话'
  )
}

async function saveDirectorConversation() {
  if (
    !user.token ||
    !directorAgentRuns.value.length ||
    directorConversationDeletedIds.has(directorConversationId.value)
  )
    return
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
    return []
  }
  const canvasId = props.projectId
  const token = user.token
  if (directorHistoryRequest?.canvasId === canvasId && directorHistoryRequest.token === token)
    return directorHistoryRequest.promise
  directorHistoryRequest?.controller.abort()
  const request = { canvasId, token, controller: new AbortController(), promise: null }
  directorHistoryRequest = request
  directorConversationLoading.value = true
  directorConversationLoadError.value = ''
  request.promise = (async () => {
    const timeout = window.setTimeout(() => request.controller.abort(), 5000)
    try {
      const response = await readDirectorApiResponse(
        await fetch(
          apiPath(`/api/ai/canvas-agent/conversations?canvasId=${encodeURIComponent(canvasId)}`),
          { headers: user.authHeaders(), signal: request.controller.signal },
        ),
      )
      if (
        directorDisposed ||
        directorHistoryRequest !== request ||
        props.projectId !== canvasId ||
        user.token !== token
      )
        return null
      if (!Array.isArray(response)) throw new Error('最近对话数据格式异常，请重试')
      directorConversations.value = response
      return directorConversations.value
    } catch (error) {
      if (
        directorHistoryRequest === request &&
        props.projectId === canvasId &&
        user.token === token
      )
        directorConversationLoadError.value =
          error?.name === 'AbortError'
            ? '最近对话加载超时，请重试'
            : error?.message || '无法加载最近对话，请重试'
      return null
    } finally {
      window.clearTimeout(timeout)
      if (directorHistoryRequest === request) {
        directorHistoryRequest = null
        directorConversationLoading.value = false
      }
    }
  })()
  return request.promise
}

function markDirectorConversationActive() {
  directorConversationRevision += 1
  directorConversationInitialized = true
  directorRestoring.value = false
  directorRestoreError.value = ''
}

async function restoreLatestDirectorConversation() {
  if (
    directorDisposed ||
    directorConversationInitialized ||
    directorAgentRuns.value.length ||
    !user.token
  )
    return
  if (directorRecentRequest) return directorRecentRequest.promise
  const request = {
    revision: directorConversationRevision,
    canvasId: props.projectId,
    token: user.token,
    promise: null,
  }
  directorRecentRequest = request
  directorRestoring.value = true
  directorRestoreError.value = ''
  request.promise = (async () => {
    try {
      const conversations = await loadDirectorConversations()
      if (
        directorDisposed ||
        directorRecentRequest !== request ||
        request.revision !== directorConversationRevision ||
        props.projectId !== request.canvasId ||
        user.token !== request.token ||
        directorAgentRuns.value.length
      )
        return
      if (!conversations) {
        directorRestoreError.value =
          directorConversationLoadError.value || '无法恢复最近对话，请重试或新建对话'
        return
      }
      const latest = latestDirectorConversation(
        conversations.filter(
          (conversation) => !directorConversationDeletedIds.has(String(conversation?.id || '')),
        ),
        request.canvasId,
      )
      if (latest) selectDirectorConversation(latest)
      else markDirectorConversationActive()
    } finally {
      if (directorRecentRequest === request) {
        directorRecentRequest = null
        directorRestoring.value = false
      }
    }
  })()
  return request.promise
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
  markDirectorConversationActive()
  directorRestoredMessages.value = []
  directorConversationId.value = directorRequestId('conversation')
  directorAgentRuns.value = []
}

function selectDirectorConversation(conversation) {
  window.clearTimeout(directorConversationSyncTimer)
  void saveDirectorConversation().catch(() => {})
  stopDirectorConversationWork()
  markDirectorConversationActive()
  const records = Array.isArray(conversation?.messages) ? conversation.messages : []
  const restoredRuns = []
  const restoredMessages = []
  let previousUser = null
  for (const record of records) {
    if (record?.role === 'user') {
      previousUser = { ...record, id: record.id || `restored-message-${restoredMessages.length}` }
      restoredMessages.push(previousUser)
    } else if (record?.role === 'assistant' && record.run?.id) {
      const run = { ...record.run }
      if (!run.message?.id && previousUser)
        run.message = { ...previousUser, ...run.message, id: previousUser.id }
      if (['planning', 'streaming'].includes(run.phase)) {
        run.phase = 'failed'
        run.error = '上次回复已中断，保留已收到的内容，可点击重试继续'
      } else if (run.phase === 'submitting') {
        // A restored in-flight submission is uncertain, never permission to POST again.
        run.phase = 'ready'
        run.submissionStarted = true
        run.submissionState = 'uncertain'
        run.error = '上次提交结果待确认，请继续查询原任务，不会重复扣费'
      }
      restoredRuns.push(run)
    }
  }
  directorRestoredMessages.value = restoredMessages
  directorConversationId.value = String(conversation?.id || directorRequestId('conversation'))
  directorAgentRuns.value = dedupeDirectorAgentRuns(restoredRuns)
  // Migrate an older text-only image proposal without submitting a paid task.
  const latest = directorAgentRuns.value.at(-1)
  if (directorImagePlan(latest) && !directorSubmissionStarted(latest))
    void ensureDirectorDraftNode(latest.id).catch((error) =>
      updateDirectorRun(latest.id, { error: error.message }),
    )
}

async function deleteDirectorConversation(conversation, complete) {
  const conversationId = String(conversation?.id || '')
  if (!conversationId || directorConversationDeletingIds.value.includes(conversationId)) return

  const deletingCurrent = conversationId === directorConversationId.value
  directorConversationDeletingIds.value = [...directorConversationDeletingIds.value, conversationId]
  directorConversationDeletedIds.add(conversationId)
  if (deletingCurrent) {
    window.clearTimeout(directorConversationSyncTimer)
    stopDirectorConversationWork()
  }

  try {
    await readDirectorApiResponse(
      await fetch(
        apiPath(
          `/api/ai/canvas-agent/conversations/${encodeURIComponent(conversationId)}?canvasId=${encodeURIComponent(props.projectId)}`,
        ),
        { method: 'DELETE', headers: user.authHeaders() },
      ),
    )
    directorConversations.value = directorConversations.value.filter(
      (item) => String(item?.id || '') !== conversationId,
    )
    if (deletingCurrent) {
      markDirectorConversationActive()
      directorRestoredMessages.value = []
      directorConversationId.value = directorRequestId('conversation')
      directorAgentRuns.value = []
    }
    complete?.({ ok: true, deletedCurrent: deletingCurrent })
  } catch (error) {
    directorConversationDeletedIds.delete(conversationId)
    complete?.({ ok: false, message: error?.message || '删除失败，请稍后重试' })
  } finally {
    directorConversationDeletingIds.value = directorConversationDeletingIds.value.filter(
      (id) => id !== conversationId,
    )
  }
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
  return dedupeDirectorAgentRuns(directorAgentRuns.value)
    .filter((run) => run.id !== excludedRunId && run.instruction && run.reply)
    .flatMap((run) => [
      { role: 'user', content: run.instruction },
      { role: 'assistant', content: directorRunReplyContext(run) },
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
  const attachments = (message.parts || []).filter(
    (part) => part?.type === 'attachment' && part.url,
  )
  const attachmentContext = attachments.length
    ? `本轮附加了 ${attachments.length} 个素材：${attachments
        .map(
          (attachment) =>
            `「${attachment.name || '未命名素材'}」${attachment.referenceRole === 'product' ? '（商品原图）' : attachment.referenceRole === 'style' ? '（仅参考风格，不作为商品外观事实）' : ''}`,
        )
        .join('、')}。请读取这些素材并结合用户需求回答。`
    : ''
  const userInstruction = String(message.content || '').trim()
  const imageSourceMode = message?.context?.clarification?.imageSourceMode
  const scriptSourceMode = message?.context?.clarification?.scriptSourceMode
  const sourceContext =
    scriptSourceMode === 'text'
      ? '用户本轮明确选择仅根据文字策划视频脚本，不使用历史图片；商品外观、卖点和参数仅以用户确认的资料为准，缺失事实标记待核对。'
      : ['history', 'upload'].includes(scriptSourceMode)
        ? '用户已确认本次脚本使用所选商品图片。只读取本轮明确提交的素材；外观可据图核对，性能、材质及认证不能仅凭图片推断。'
        : imageSourceMode === 'text'
          ? '用户本轮明确选择纯文字生图，不使用画布或此前上传图片作为本次生成参考。'
          : imageSourceMode === 'reference'
            ? '用户本轮明确选择参考图生图，只使用本轮确认的真实参考素材；风格参考图不能当作商品原图。'
            : ''
  const roles = message?.context?.clarification?.referenceRoles || {}
  const roleContext = Object.entries(roles)
    .filter(([, role]) => ['product', 'style', 'other'].includes(role))
    .map(
      ([id, role]) =>
        `素材 ${id} 的用户指定用途：${role === 'product' ? '商品原图，校准商品外观' : role === 'style' ? '仅参考风格、构图和光线，不作为商品身份或性能依据' : '其他参考，不能推断商品性能'}`,
    )
  return [
    userInstruction || (attachments.length ? '请分析我附加的素材。' : message.display || ''),
    attachmentContext,
    sourceContext,
    ...roleContext,
    ...skillContext,
  ]
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
  const attachments = (message.parts || [])
    .filter((part) => part?.type === 'attachment' && part.url)
    .map((attachment) => {
      const id = String(attachment.id || directorRequestId('attachment'))
      return Object.freeze({
        id,
        layerId: String(attachment.layerId || id),
        name: String(attachment.name || '未命名素材'),
        kind: ['image', 'video', 'audio'].includes(attachment.kind) ? attachment.kind : 'file',
        mimeType: String(attachment.mimeType || ''),
        size: Math.max(0, Number(attachment.size) || 0),
        url: String(attachment.url),
        source: attachment.source === 'library' ? 'library' : 'upload',
        ...(['product', 'style', 'other'].includes(attachment.referenceRole)
          ? { referenceRole: attachment.referenceRole }
          : {}),
      })
    })
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
  const referenceAssets = [
    ...referenceNodes.map((node) => ({
      id: node.id,
      layerId: node.id,
      name: node.data.title || '参考图片',
      kind: 'image',
      url: node.data.assetUrl,
      source: 'canvas',
    })),
    ...attachments.filter((attachment) => attachment.kind === 'image'),
  ]
  const referenceLayerIds = [
    ...new Set([
      ...referenceNodes.map((node) => node.id),
      ...attachments.map((attachment) => attachment.layerId),
    ]),
  ]
  return Object.freeze({
    generationType,
    requestedModels: Object.freeze(requestedModels),
    selectedLayerIds: Object.freeze(selectedNodes.map((node) => node.id)),
    referenceLayerIds: Object.freeze(referenceLayerIds),
    referenceAssets: Object.freeze(referenceAssets.map((asset) => Object.freeze(asset))),
    attachments: Object.freeze(attachments),
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

function directorRequestLayers(intent) {
  return directorRequestContextLayers(nodes.value.map(directorLayerContext), intent)
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
    ? requested.map((model) =>
        intent.executionConfirmed
          ? resolveConfiguredImageTaskModel(model.id, tasks.imageModels)
          : resolveDirectorImageTaskModel(model.id, tasks.imageModels),
      )
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
    proposal: null,
    questions: [],
    thinking: [
      { id: 'context', label: '正在读取画布上下文与选中素材', state: 'active' },
      { id: 'model', label: '等待数据库推理模型开始响应', state: 'pending' },
      { id: 'answer', label: '等待流式整理回答与下一步建议', state: 'pending' },
    ],
  })
  try {
    await tasks.loadModels()
    if (controller.signal.aborted) return
    let intent = run.generationIntent
    const resolvedModels = resolveDirectorModels(intent)
    const models =
      intent.generationType === 'image'
        ? resolvedModels.map((option) => option.value)
        : intent.requestedModels.map((model) => model.id).filter(Boolean)
    const primaryModel = resolvedModels[0] || intent.requestedModels[0] || null
    const turnContext = run.turnContext
      ? {
          ...run.turnContext,
          currentReferenceLayerIds: directorCurrentReferenceLayerIds(run.message),
        }
      : directorTurnContext(
          run.message || { content: run.instruction },
          directorDisplayRuns.value.filter((item) => item.id !== runId),
        )
    updateDirectorRun(runId, { turnContext })
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
          // A clarification's synthesized chain is history, never the current user message.
          instruction: run.message ? directorInstruction(run.message) : run.instruction,
          turnContext,
          history: directorHistory(runId),
          layers: directorRequestLayers(intent),
          selectedLayerIds: [...intent.selectedLayerIds],
          referenceLayerIds: [...intent.referenceLayerIds],
          model: models[0] || '',
          models,
          ratio: intent.ratio,
          resolution: intent.resolution,
          count: intent.count,
          conversationId: directorConversationId.value,
          agentModel: 'default',
          scriptBrief: directorScriptBrief(intent, run.referenceCandidates || []),
        }),
      }),
      runId,
    )
    if (controller.signal.aborted) return
    const routingPolicy = directorResponseRouting(response)
    const switched = routingPolicy.routing?.relation === 'switch'
    if (switched) intent = directorSwitchReferenceIntent(intent, run.message, response)
    const questions = routingPolicy.allowsQuestions
      ? normalizeDirectorQuestions(response?.questions)
      : []
    const responseGenerationType = ['image', 'video'].includes(response?.generationType)
      ? response.generationType
      : ''
    const routingMediaType = routingPolicy.routing?.task === 'image_generation' ? 'image' : 'video'
    const allowsDraft =
      routingPolicy.allowsDraft &&
      (routingPolicy.legacy || responseGenerationType === routingMediaType)
    const prompts =
      allowsDraft || routingPolicy.allowsProposal ? normalizeDirectorPrompts(response) : []
    const draftRequested =
      allowsDraft && !questions.length && canCreateAgentDraft(response, prompts)
    const paidConfigurationError = !draftRequested
      ? ''
      : !responseGenerationType
        ? 'Agent 未明确生成类型，本次不会自动提交付费任务'
        : responseGenerationType !== intent.generationType
          ? !intent.requestedModels.length && !intent.nodeModel
            ? '创作方案已保留，请先选择对应的生成模型；本次未提交生成任务'
            : `Agent 建议生成${responseGenerationType === 'video' ? '视频' : '图片'}，与发送时选择的${intent.generationType === 'video' ? '视频' : '图片'}模式不一致；请确认模型后重新发送`
          : intent.generationType === 'image' && !models.length
            ? '请在下方确认生图模型和参数，无需重新发送或重新整理方案'
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
    const proposal =
      !questions.length && !draft && responseGenerationType && prompts.length
        ? { generationType: responseGenerationType, prompt: prompts[0], prompts }
        : null
    const nextRun = updateDirectorRun(runId, {
      phase: questions.length ? 'awaiting_input' : draft ? 'ready' : 'complete',
      reply: String(response?.reply || 'TV Director 已完成分析。'),
      // Keep an explicit invalid value so restoration cannot reinterpret it as a legacy response.
      routing: routingPolicy.legacy ? undefined : routingPolicy.routing,
      generationIntent: intent,
      ...(switched ? { referenceCandidates: [] } : {}),
      questions,
      draft,
      proposal,
      contentReady: draftRequested && allowsDraft,
      error: !routingPolicy.valid
        ? 'Agent 返回的语义路由无效，已阻止创建节点或付费执行，请重新发送'
        : paidConfigurationError,
    })
    if (directorImagePlan(nextRun)) await ensureDirectorDraftNode(runId)
    // The per-message dry-run intent is frozen when the user sends. Later mode changes never
    // affect this branch, and video drafts deliberately remain available without auto submission.
    if (allowsDraft && draft?.generationType === 'image' && nextRun?.dryRun === false)
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

function handleDirectorSubmit(message, inheritedIntent = null) {
  if (directorRestoring.value || directorRestoreError.value) return ''
  const currentInstruction = directorInstruction(message)
  const sourceRunId = message?.context?.clarification?.sourceRunId
  const instruction = sourceRunId
    ? directorClarificationInstruction(directorAgentRuns.value, sourceRunId, currentInstruction)
    : currentInstruction
  if (!instruction) return
  if (
    message.id &&
    directorAgentRuns.value.some((existing) => existing.clientMessageId === message.id)
  )
    return
  const generationIntent = inheritedIntent || createDirectorGenerationIntent(message)
  markDirectorConversationActive()
  const run = {
    id: directorRequestId('director'),
    clientTaskId: directorRequestId('director-image'),
    clientMessageId: message.id || '',
    instruction,
    display: message.display || instruction,
    message,
    turnContext: directorTurnContext(message, directorDisplayRuns.value),
    generationIntent,
    // Candidates are a same-conversation catalog, not bound model references. A later
    // source answer must select their exact saved snapshots before they can be read.
    referenceCandidates: sourceRunId
      ? directorRun(sourceRunId)?.referenceCandidates || []
      : directorScriptReferenceCandidates(directorAgentRuns.value),
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
    questions: [],
    clarificationAnswers: [],
    clarificationReplyRunId: '',
    draft: null,
    proposal: null,
    nodeId: '',
    submissionStarted: false,
    error: '',
  }
  directorAgentRuns.value.push(run)
  scheduleDirectorConversationSync()
  void planDirectorMessage(run.id)
  return run.id
}

function handleDirectorClarification(runId, message, complete) {
  const source = directorRun(runId)
  const pending = directorPendingClarificationRun(directorAgentRuns.value)
  const answers = normalizeDirectorClarificationAnswers(
    source?.questions,
    message?.context?.clarification?.answers,
  )
  if (
    !source ||
    source.id !== pending?.id ||
    source.clarificationReplyRunId ||
    !source.generationIntent ||
    !['awaiting_input', 'complete'].includes(source.phase) ||
    !isDirectorClarificationComplete(source.questions, answers) ||
    directorPlanningRequests.size
  ) {
    complete?.({ ok: false, message: '这组问题已处理或当前有任务进行中，请继续使用输入框沟通' })
    return
  }

  const addedIntent = directorClarificationAssetsIntent(
    source.generationIntent,
    createDirectorGenerationIntent(message).attachments,
  )
  const clarification = message.context.clarification
  const scriptSourceMode = directorScriptSourceMode(source.questions, answers)
  const sourceMode = scriptSourceMode
    ? ''
    : directorImageSourceMode(source.questions, answers) ||
      (source.questions.some((question) => question.kind === 'image_upload')
        ? 'reference'
        : source.generationIntent.imageSourceMode || '')
  const selectedIds = Array.isArray(clarification.referenceImageIds)
    ? new Set(clarification.referenceImageIds)
    : null
  const allowedImages =
    scriptSourceMode === 'history'
      ? source.referenceCandidates || []
      : scriptSourceMode === 'upload'
        ? createDirectorGenerationIntent(message).attachments.filter(
            (asset) => asset.kind === 'image',
          )
        : directorReferenceImages(addedIntent, [], [], clarification.referenceRoles || {})
  const referenceImages = allowedImages.filter((image) =>
    selectedIds ? selectedIds.has(image.layerId || image.id || image.url) : !scriptSourceMode,
  )
  if (
    !isDirectorClarificationReady(source.questions, answers, referenceImages) ||
    (sourceMode === 'reference' &&
      (!referenceImages.some((image) => image.url && (!image.status || image.status === 'ready')) ||
        referenceImages.filter((image) => image.url && (!image.status || image.status === 'ready'))
          .length > DIRECTOR_REFERENCE_IMAGE_LIMIT))
  ) {
    complete?.({ ok: false, message: '参考图尚未准备好，请先上传或选择图片后再继续' })
    return
  }
  const generationIntent = scriptSourceMode
    ? directorApplyScriptSourceIntent(addedIntent, scriptSourceMode, referenceImages)
    : directorApplyImageSourceIntent(addedIntent, sourceMode, referenceImages)

  // Answers cannot grant paid approval. Only preserve this same task's earlier explicit
  // automatic-mode authorization; later picker changes have no effect.
  const nextRunId = handleDirectorSubmit(
    {
      ...message,
      parts:
        scriptSourceMode === 'text'
          ? (message.parts || []).filter((part) => part.kind !== 'image')
          : message.parts,
      dryRunIntent: source.dryRun !== false,
      context: {
        ...message.context,
        clarification: {
          ...clarification,
          imageSourceMode: scriptSourceMode ? '' : sourceMode,
          scriptSourceMode: scriptSourceMode || source.generationIntent.scriptSourceMode || '',
        },
      },
    },
    generationIntent,
  )
  if (!nextRunId) {
    complete?.({ ok: false, message: '未能提交答案，请重试' })
    return
  }
  updateDirectorRun(runId, {
    clarificationAnswers: answers,
    clarificationReplyRunId: nextRunId,
  })
  complete?.({ ok: true })
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

function directorImagePlan(run) {
  if (!run || run.questions?.length || run.contentReady === false) return null
  const routingPolicy = directorResponseRouting(run)
  if (
    !routingPolicy.allowsDraft ||
    (!routingPolicy.legacy && routingPolicy.routing.task !== 'image_generation')
  )
    return null
  const plan = run.draft || run.proposal
  return plan?.generationType === 'image' && plan.prompt?.trim() ? plan : null
}

function directorSubmissionStarted(run) {
  const node = nodes.value.find(
    (candidate) => candidate.id === run?.nodeId || candidate.data.directorRunId === run?.id,
  )
  return Boolean(
    run?.submissionStarted ||
    (run?.clientTaskId && node?.data.generation?.clientTaskId === run.clientTaskId),
  )
}

function directorDraftFromIntent(plan, intent, model) {
  return {
    prompt: plan.prompt,
    prompts: plan.prompts || [plan.prompt],
    generationType: 'image',
    referenceLayerIds: [...(intent.referenceLayerIds || [])],
    referenceAssets: (intent.referenceAssets || []).map((reference) => ({ ...reference })),
    models: [model.value],
    model: model.value,
    modelLabel: model.label || model.value,
    ratio: intent.ratio,
    resolution: intent.resolution,
    count: intent.count,
    quality: intent.quality || '标准画质',
    background: intent.background || '自动',
    width: intent.width,
    height: intent.height,
  }
}

// Preparing a node is free: no task key exists until runImage starts submission.
function ensureDirectorDraftNode(runId) {
  if (directorNodePreparations.has(runId)) return directorNodePreparations.get(runId)
  const preparation = (async () => {
    const run = directorRun(runId)
    const plan = directorImagePlan(run)
    if (!plan) throw new Error('图片方案尚未准备完整，请先补充创作需求')
    if (directorSubmissionStarted(run)) {
      const existing = nodes.value.find((node) => node.id === run.nodeId)
      if (existing) return existing
      throw new Error('原任务节点暂不可用，请继续查询原任务，不会创建新的生成任务')
    }
    const intent = run.generationIntent || {}
    const expectedReferences = plan.referenceAssets || intent.referenceAssets || []
    const attachmentBasePosition = directorDraftPosition(null)
    const referenceNodes = expectedReferences.map((reference, index) => {
      // Canvas references are identity snapshots, not any node with the same URL.
      let node = nodes.value.find((candidate) =>
        reference.source === 'canvas'
          ? candidate.id === (reference.layerId || reference.id)
          : candidate.id === reference.id ||
            candidate.id === reference.layerId ||
            candidate.data.assetUrl === reference.url,
      )
      if (
        !node &&
        ['upload', 'library'].includes(reference.source) &&
        reference.kind === 'image' &&
        reference.url
      ) {
        node = graph.addNode('image', {
          x: attachmentBasePosition.x - 360,
          y: attachmentBasePosition.y + index * 36,
        })
        if (!node) throw new Error('无法添加参考图片到画布')
        graph.updateNodeData(node.id, {
          title: reference.name || '对话参考图',
          assetUrl: reference.url,
          artifactStatus: 'ready',
          mediaOrigin: 'upload',
        })
      }
      if (!node?.data.assetUrl) throw new Error('部分参考素材已移除，请重新添加后重试')
      if (node.data.assetUrl !== reference.url)
        throw new Error('参考图片在发送后已发生变化，请确认新图片并重新发送')
      return node
    })
    let target = nodes.value.find(
      (node) => node.id === run.nodeId || node.data.directorRunId === runId,
    )
    if (!target) {
      const source = referenceNodes.find((node) => node.data.kind === 'image')
      target = source
        ? graph.createImageVariation(source.id, { title: 'TV Director 生成', prompt: plan.prompt })
        : graph.addNode('image', directorDraftPosition(null))
      if (!target) throw new Error('无法创建图片生成节点')
    }
    if (target.data.generation?.clientTaskId)
      throw new Error('此节点已从画布发起过生成，请查看节点中的原任务；不会覆盖或重复提交')
    if (target.data.directorRunId === runId) {
      const expected = new Set(referenceNodes.map((reference) => reference.id))
      const connected = new Set(
        (graph.edges || []).filter((edge) => edge.target === target.id).map((edge) => edge.source),
      )
      if (expected.size !== connected.size || [...connected].some((id) => !expected.has(id)))
        throw new Error(
          '待生成节点的参考连接已被修改，请恢复原连接或重新确认创作方案，未提交生图任务',
        )
    }
    // Never overwrite a submitted task's frozen request on history restoration.
    if (!run.submissionStarted && !target.data.generation?.clientTaskId) {
      graph.updateNodeData(target.id, {
        title: /^图片节点(?:\s|$)/.test(target.data.title || '')
          ? 'TV Director 生成'
          : target.data.title,
        directorRunId: runId,
        prompt: plan.prompt,
        model: run.draft?.model || intent.nodeModel || '',
        params: {
          ...target.data.params,
          ratio: intent.ratio,
          resolution: intent.resolution,
          count: `${intent.count || 1}张`,
          quality: intent.quality || '标准画质',
          background: intent.background || '自动',
          width: intent.width ?? null,
          height: intent.height ?? null,
        },
        error: '',
        statusText: run.draft?.model
          ? '节点已就绪，等待确认生图'
          : '节点已就绪，请确认生图模型和参数',
      })
      for (const reference of referenceNodes)
        graph.connect({
          source: reference.id,
          target: target.id,
          sourceHandle: 'output',
          targetHandle: 'input',
        })
    }
    updateDirectorRun(runId, { nodeId: target.id })
    await nextTick()
    if (!(await saveNow())) throw new Error('节点尚未保存成功，请检查网络后重试，未提交生图任务')
    return nodes.value.find((node) => node.id === target.id)
  })()
  directorNodePreparations.set(runId, preparation)
  void preparation.finally(() => directorNodePreparations.delete(runId)).catch(() => {})
  return preparation
}

async function prepareDirectorGeneration(runId) {
  try {
    await ensureDirectorDraftNode(runId)
    updateDirectorRun(runId, { error: '' })
  } catch (error) {
    updateDirectorRun(runId, { error: error.message })
  }
}

function locateDirectorGeneration(runId) {
  const run = directorRun(runId)
  const node = nodes.value.find((candidate) => candidate.id === run?.nodeId)
  if (node) void focusStoryboard(node)
}

const directorDisplayRuns = computed(() =>
  directorAgentRuns.value.map((run) => {
    const node = nodes.value.find((candidate) => candidate.id === run.nodeId)
    const started = directorSubmissionStarted(run)
    const state = started ? node?.data.runState : ''
    return {
      ...run,
      submissionStarted: started,
      executionPhase:
        state === 'succeeded'
          ? 'succeeded'
          : state === 'failed'
            ? 'failed'
            : ['queued', 'running', 'paused'].includes(state)
              ? 'submitted'
              : state === 'uncertain'
                ? 'uncertain'
                : run.phase,
      executionStatus: node?.data.statusText || '',
      executionError: node?.data.error || '',
      outputUrls:
        state === 'succeeded'
          ? [
              ...new Set(
                [...(node.data.generation?.results || []), node.data.assetUrl].filter(Boolean),
              ),
            ]
          : [],
    }
  }),
)

async function submitDirectorDraft(runId) {
  const run = directorRun(runId)
  const draft = run?.draft
  if (!run || !draft || draft.generationType !== 'image') return
  const routingPolicy = directorResponseRouting(run)
  if (
    !routingPolicy.allowsDraft ||
    (!routingPolicy.legacy && routingPolicy.routing.task !== 'image_generation')
  )
    return
  const nodeState = nodes.value.find((node) => node.id === run.nodeId)?.data.runState
  if (
    directorGenerationSubmissions.has(runId) ||
    run.phase === 'submitting' ||
    (run.phase === 'submitted' && !['uncertain', 'failed', 'paused'].includes(nodeState))
  )
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
    if (directorSubmissionStarted(run) || run.submissionState === 'uncertain') {
      updateDirectorRun(runId, { submissionStarted: true })
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

    const target = await ensureDirectorDraftNode(runId)
    if (!target) throw new Error('图片生成节点暂不可用，请重试')

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
        width: draft.width ?? null,
        height: draft.height ?? null,
      },
      error: '',
      statusText: '',
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

async function confirmDirectorGeneration(runId, settings) {
  const run = directorRun(runId)
  const nodeState = nodes.value.find((node) => node.id === run?.nodeId)?.data.runState
  if (
    !run ||
    directorGenerationSubmissions.has(runId) ||
    run.phase === 'submitting' ||
    (run.phase === 'submitted' && !['uncertain', 'failed', 'paused'].includes(nodeState))
  )
    return
  // An uncertain request is always recovered with its original key, never reconfigured.
  if (directorSubmissionStarted(run) || run.submissionState === 'uncertain') {
    await submitDirectorDraft(runId)
    return
  }
  const plan = directorImagePlan(run)
  if (!plan || !settings) return
  try {
    if (tasks.modelError) throw new Error(tasks.modelError)
    const intent = createDirectorImageExecutionIntent(
      run.generationIntent,
      settings,
      tasks.imageModels,
    )
    const model = resolveConfiguredImageTaskModel(intent.nodeModel, tasks.imageModels)
    updateDirectorRun(runId, {
      generationIntent: intent,
      draft: directorDraftFromIntent(plan, intent, model),
      proposal: null,
      phase: 'ready',
      error: '',
    })
    await submitDirectorDraft(runId)
  } catch (error) {
    updateDirectorRun(runId, { error: error.message })
  }
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
  if (
    event.key === 'Escape' &&
    (groupConnectionDrag.active || (pendingGroupConnection.value && activePanel.value === 'nodes'))
  ) {
    event.preventDefault()
    clearPendingReference()
    activePanel.value = ''
    return
  }
  if (
    !groupWorkflow.value &&
    !selectionSaveNodes.value &&
    event.target?.matches?.('.cv3-group-frame') &&
    ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
  ) {
    event.preventDefault()
    event.stopImmediatePropagation?.()
    moveSelectedByKey(graph, event.key, { shiftKey: event.shiftKey })
    return
  }
  const selectionHistoryKey =
    event.target?.closest?.('[data-cv3-selection-ui]') &&
    !selectionSaveNodes.value &&
    !groupWorkflow.value &&
    !event.target?.closest?.('[role="menu"], input, textarea, select, [contenteditable="true"]') &&
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === 'z'
  if (selectionHistoryKey) {
    event.preventDefault()
    event.shiftKey ? graph.redo() : graph.undo()
    return
  }
  // Native media controls and video dialogs own Space, seek, Tab and Delete.
  // This listener runs in capture phase, before child stopPropagation handlers.
  if (
    event.defaultPrevented ||
    selectionSaveNodes.value ||
    groupWorkflow.value ||
    event.target?.closest?.('[data-cv3-selection-ui]') ||
    videoDialog.value ||
    previewVideo.value ||
    event.target?.closest?.(
      '.cv3-video-node-player, .cv3-video-toolbar, [data-video-context-menu], [data-cv3-video-dialog]',
    )
  )
    return
  // Image menus and teleported forms own their keyboard/focus, including Escape.
  if (
    imageDialog.value ||
    event.target?.closest?.(
      '[data-image-context-menu], [data-image-context-dialog], [data-cv3-image-dialog]',
    )
  )
    return
  // The studio is teleported above the canvas and owns Escape/Tab/Delete itself.
  // Never let its fields or buttons trigger canvas shortcuts or close the Director.
  if (activePanel.value === 'characters') return
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
  if (
    multiSelection.value &&
    ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
  ) {
    event.preventDefault()
    event.stopImmediatePropagation()
    moveSelectedByKey(graph, event.key, { shiftKey: event.shiftKey })
    return
  }
  if (mod && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    event.shiftKey ? graph.redo() : graph.undo()
  } else if (mod && event.key.toLowerCase() === 'd') {
    event.preventDefault()
    try {
      graph.duplicateSelected()
    } catch (error) {
      imageActionNotice(error.message || '创建副本失败', true)
    }
  } else if (mod && event.key === '0') {
    event.preventDefault()
    fitCanvas()
  } else if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    layoutCanvas()
  } else if (event.key === 'Escape') {
    videoContext.value = null
    imageContext.value = null
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
  groupConnectionDrag.cancel()
  groupHoverPoint.value = null
  cancelGroupResize()
  spaceHeld.value = false
  imageDragActive.value = false
  selectionDragging.value = false
  cancelSelectionFrameDrag()
}
onNodesInitialized(() => {
  if (route.query.demo && nodes.value.length) fitView({ padding: 0.2, minZoom: 0.2, maxZoom: 0.6 })
})
watch(
  () => props.projectId,
  () => {
    resetVideoActions()
    imageClipboardRequest?.abort()
    imageContext.value = null
    imageDialog.value = null
  },
)
watch(
  () => String(user.profile?.id || ''),
  () => {
    resetVideoActions()
    imageImporter.cancel()
    imageClipboardRequest?.abort()
    imageContext.value = null
    imageDialog.value = null
    directorConversationRevision += 1
    directorHistoryRequest?.controller.abort()
    directorHistoryRequest = null
    directorRecentRequest = null
    directorConversationInitialized = false
    directorRestoring.value = false
    directorRestoreError.value = ''
    directorConversationLoading.value = false
    directorConversationLoadError.value = ''
    window.clearTimeout(directorConversationSyncTimer)
    stopDirectorConversationWork()
    directorConversations.value = []
    directorRestoredMessages.value = []
    directorAgentRuns.value = []
    directorConversationDeletedIds.clear()
    directorConversationId.value = directorRequestId('conversation')
    if (activePanel.value === 'assistant') void restoreLatestDirectorConversation()
  },
)
onMounted(async () => {
  activePanel.value = ''
  mode.value = 'workflow'
  tasks.attach(props.projectId, { beforeImageSubmit: saveNow })
  window.addEventListener('keydown', onKeydown, true)
  window.addEventListener('paste', handleCanvasImagePaste)
  window.addEventListener('copy', handleCanvasNodeCopy)
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
  groupConnectionDrag.cancel()
  stopGroupPreparation()
  groupExecutionRequest?.controller.abort()
  cancelGroupResize()
  cancelSelectionFrameDrag()
  selectionDownloadRequest?.controller.abort()
  videoActions.dispose()
  imageClipboardRequest?.abort()
  directorDisposed = true
  directorConversationRevision += 1
  directorHistoryRequest?.controller.abort()
  window.clearTimeout(directorConversationSyncTimer)
  for (const controller of directorPlanningRequests.values()) controller.abort()
  directorPlanningRequests.clear()
  directorGenerationSubmissions.clear()
  tasks.detach(props.projectId)
  window.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('paste', handleCanvasImagePaste)
  window.removeEventListener('copy', handleCanvasNodeCopy)
  imageImporter.dispose()
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
          'has-multi-selection': multiSelection,
          'has-persistent-groups': selectionGroups.length > 0,
          'has-active-group': Boolean(activePersistentGroup),
        }"
        @dblclick="openCanvasMenu"
        @contextmenu="openCanvasMenu"
        @dragover="handleCanvasImageDragOver"
        @dragleave="handleCanvasImageDragLeave"
        @drop="handleCanvasImageDrop"
        @pointercancel="resetSpace"
        @pointermove.capture="handleGroupPointerMove"
        @pointerleave="groupHoverPoint = null"
      >
        <div
          v-for="group in selectionGroups"
          :key="`bg-${group.id}`"
          class="cv3-group-background"
          :style="{ ...selectionRectStyle(group.bounds), backgroundColor: `${group.color}26` }"
          aria-hidden="true"
        />
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
          :selection-key-code="gestures.selectionOnDrag"
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
          @selection-start="selectionDragging = true"
          @selection-end="selectionDragging = false"
          @selection-drag-start="selectionDragging = true"
          @selection-drag-stop="selectionDragging = false"
          @node-click="handleSelectionNodeClick"
          @node-drag-start="graph.remember"
          @node-drag-stop="graph.markChanged"
          @node-context-menu="openImageContextMenu"
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
            <GeneratorNode
              v-bind="nodeProps"
              :zoom="liveViewport.zoom"
              @video-snapshot="handleVideoSnapshot"
              @video-expand="openVideoPreview"
              @video-time="videoTimeChanged"
            />
          </template>
          <template #edge-smoothstep="edgeProps"><FlowingEdge v-bind="edgeProps" /></template>
          <template #edge-default="edgeProps"><FlowingEdge v-bind="edgeProps" /></template>
          <template #connection-line="lineProps">
            <ConnectionPreview v-bind="lineProps" />
          </template>
        </VueFlow>
        <GroupFrame
          v-for="group in selectionGroups"
          :key="group.id"
          :group="group"
          :mutable="group.mutable"
          :hand="gestures.hand"
          :pointer-inside="hoveredGroupId === group.id"
          :connection-reset-key="groupConnectionResetKey"
          @select="selectPersistentGroup(group)"
          @rename="renamePersistentGroup(group, $event)"
          @move-start="beginSelectionFrameDrag"
          @move="selectionFrameDrag.move"
          @move-end="endSelectionFrameDrag"
          @move-cancel="cancelSelectionFrameDrag"
          @resize-start="beginGroupResize"
          @resize="groupFrameResize.move"
          @resize-end="endGroupResize"
          @resize-cancel="cancelGroupResize"
          @add="openGroupConnection(group, $event)"
          @connect-start="beginGroupConnection(group, $event)"
          @connect-move="groupConnectionDrag.move"
          @connect-end="endGroupConnection"
          @connect-cancel="groupConnectionDrag.cancel()"
        />
        <div
          v-if="selectionVisible && selectionBounds && !activePersistentGroup"
          class="cv3-selection-frame"
          :style="selectionRectStyle(selectionBounds)"
          role="group"
          :aria-label="`已框选 ${graph.selectedNodes.length} 个节点`"
          tabindex="0"
        >
          <span
            v-for="edge in ['top', 'right', 'bottom', 'left']"
            :key="edge"
            :class="['cv3-selection-frame-edge', `is-${edge}`]"
            aria-hidden="true"
            @pointerdown="beginSelectionFrameDrag"
            @pointermove="selectionFrameDrag.move"
            @pointerup="endSelectionFrameDrag"
            @pointercancel="cancelSelectionFrameDrag"
          />
        </div>
        <div v-if="imageDragActive" class="cv3-image-drop-hint" aria-hidden="true">
          松开即可将图片加入画布
        </div>
        <svg v-if="pendingReferencePath" class="cv3-pending-reference-line" aria-hidden="true">
          <path :d="pendingReferencePath" class="cv3-connection-base" />
          <EdgeFlowSegments :path="pendingReferencePath" />
        </svg>
        <svg
          v-if="groupConnectionPath"
          class="cv3-pending-reference-line cv3-group-connection-preview"
          aria-hidden="true"
        >
          <path :d="groupConnectionPath" class="cv3-connection-base" />
          <EdgeFlowSegments :path="groupConnectionPath" />
        </svg>
      </div>
      <div
        v-if="imageImportStatus?.message"
        class="cv3-image-import-status"
        :class="{ 'is-error': imageImportStatus.error }"
        role="status"
        aria-live="polite"
      >
        <span>{{ imageImportStatus.message }}</span>
        <button
          v-if="selectionDownloading"
          type="button"
          data-cv3-selection-ui
          @click="selectionDownloadRequest?.controller.abort()"
        >
          取消打包
        </button>
        <button type="button" aria-label="关闭图片导入提示" @click="imageImportStatus = null">
          ×
        </button>
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
      <SelectionActionToolbar
        v-if="
          selectionVisible && selectionBounds && !activePersistentGroup && !selectionFrameDragging
        "
        :count="graph.selectedNodes.length"
        :bounds="selectionBounds"
        :viewport="screenSize"
        :mutable="graph.selectionMutable"
        :group="graph.selectedGroup"
        :can-save="canSaveSelection"
        :can-download="canSaveSelection"
        :can-chat="canChatSelection"
        :downloading="selectionDownloading"
        @arrange="selectionMutation('arrange', $event)"
        @save="openSelectionSave"
        @duplicate="selectionMutation('duplicate')"
        @group="selectionMutation('group', $event)"
        @ungroup="selectionMutation('ungroup')"
        @download="downloadSelection"
        @chat="selectionToDirector(false)"
        @skill="selectionToDirector(true)"
      />
      <GroupActionToolbar
        v-if="
          selectionVisible && activePersistentGroup && !selectionFrameDragging && !groupResizing
        "
        :group="activePersistentGroup"
        :bounds="activePersistentGroup.bounds"
        :viewport="screenSize"
        :mutable="graph.selectionMutable && !groupExecuting"
        :can-execute="graph.selectionMutable"
        :can-download="canSaveSelection"
        :executing="groupExecuting"
        :downloading="selectionDownloading"
        @color="changeGroupAppearance('color', $event)"
        @arrange="selectionMutation('arrange', $event)"
        @execute="openGroupWorkflow('execute-confirm')"
        @toolbox="openGroupWorkflow('toolbox')"
        @convert="changeGroupAppearance('convert', $event)"
        @ungroup="selectionMutation('ungroup')"
        @download="downloadSelection"
      />
      <GroupWorkflowDialog
        :open="Boolean(groupWorkflow)"
        :type="groupWorkflow?.type || 'execute-confirm'"
        :group-name="groupWorkflow?.group.name || ''"
        :generation-count="groupWorkflow?.plan?.generationCount || 0"
        :templates="groupToolboxTemplates"
        :busy="groupExecuting"
        :error="groupWorkflowError"
        :progress="groupExecutionProgress"
        @confirm="confirmGroupWorkflow"
        @cancel="cancelGroupWorkflow"
        @load="loadGroupTemplate"
        @remove="removeGroupTemplate"
      />
      <SelectionSaveAssetDialog
        :open="Boolean(selectionSaveNodes)"
        :nodes="selectionSaveNodes || []"
        :project-id="projectId"
        @close="selectionSaveNodes = null"
        @saved="selectionAssetsSaved"
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
      <VideoActionToolbar
        v-if="
          mode === 'workflow' &&
          !emotionSource &&
          !angleSource &&
          graph.activeNode?.data.kind === 'video' &&
          graph.activeNode.data.assetUrl &&
          !['preparing', 'submitting', 'queued', 'running', 'paused', 'uncertain'].includes(
            graph.activeNode.data.runState,
          )
        "
        :left="videoToolbarPosition.left"
        :top="videoToolbarPosition.top"
        :busy="videoMediaBusy"
        @action="handleVideoToolbarAction"
      />
      <VideoPreviewDialog
        v-if="previewVideo"
        :source="previewVideo.source"
        :title="previewVideo.title"
        :poster="previewVideo.poster"
        :current-time="previewVideo.time"
        :busy="videoMediaBusy"
        @close="closeVideoPreview"
        @snapshot="handleVideoSnapshot({ nodeId: previewVideo.nodeId, ...$event })"
        @download="downloadCanvasVideo(previewVideo.nodeId)"
        @timeupdate="previewVideo.time = $event"
        @metadata="previewVideoMetadata"
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
        :reference-mode="Boolean(pendingReference || pendingGroupConnection)"
        @add="addNode"
        @panel="openPanel"
      />
      <CanvasUtilityPanel
        v-if="activePanel && !['nodes', 'assistant', 'characters'].includes(activePanel)"
        :panel="activePanel"
        :asset-revision="assetRevision"
        @close="activePanel = ''"
        @demo="openDemo"
        @export="exportGraph"
        @import-images="importCanvasImages"
        @import-saved-asset="importSavedImage"
        @preview-image="previewSavedImage"
        @preview-video="previewSavedVideo"
        @import-saved-video="importSavedVideo"
      />
      <ImageContextMenu
        v-if="imageContext && imageContextNode"
        :position="imageContext"
        :rating="imageContextNode.data.rating || 0"
        :locked="imageContextLocked"
        @rate="graph.rateNode(imageContextNode.id, $event)"
        @action="handleImageContextAction"
        @close="imageContext = null"
      />
      <ImageSaveAssetDialog
        v-if="imageDialog?.kind === 'save-asset'"
        :open="true"
        :node="imageDialog.node"
        @close="imageDialog = null"
        @saved="handleImageAssetSaved"
      />
      <VideoContextMenu
        v-if="videoContext && videoContextNode"
        :position="videoContext"
        :rating="videoContextNode.data.rating || 0"
        :locked="imageContextLocked || videoMediaBusy"
        @rate="graph.rateNode(videoContextNode.id, $event)"
        @action="handleVideoContextAction"
        @close="videoContext = null"
      />
      <VideoSaveAssetDialog
        v-if="videoDialog?.kind === 'save-asset'"
        :open="true"
        :node="videoDialog.node"
        @close="videoDialog = null"
        @saved="handleVideoAssetSaved"
      />
      <VideoEnhanceDialog
        v-if="videoDialog?.kind === 'enhance'"
        :key="videoDialog.node.id"
        :source-url="videoDialog.node.data.assetUrl"
        :name="videoDialog.node.data.title"
        :save-result="saveEnhancedVideo"
        @close="videoDialog = null"
      />
      <VideoActionStatusDialog
        v-if="videoDialog && !['save-asset', 'enhance'].includes(videoDialog.kind)"
        :node="videoDialog.node"
        :action="videoDialog.kind"
        @close="videoDialog = null"
      />
      <ImageCreateSubjectDialog
        v-if="imageDialog?.kind === 'create-subject'"
        :source-node="imageDialog.node"
        @close="imageDialog = null"
        @saved="handleImageAssetSaved"
        @error="imageActionNotice($event, true)"
      />
      <ImageComplianceDialog
        v-if="imageDialog?.kind === 'compliance'"
        :source-node="imageDialog.node"
        @close="imageDialog = null"
      />
      <DirectorPanel
        v-if="activePanel === 'assistant'"
        ref="directorPanel"
        :key="directorConversationId"
        :docked="directorDocked"
        :dock-width="directorDockWidth"
        :session-id="projectId"
        :agent-runs="directorDisplayRuns"
        :image-models="tasks.imageModels"
        :image-model-error="tasks.modelError"
        :conversations="directorConversations"
        :conversation-id="directorConversationId"
        :conversation-messages="directorRestoredMessages"
        :restoring="directorRestoring"
        :restore-error="directorRestoreError"
        :conversation-loading="directorConversationLoading"
        :conversation-deleting-ids="directorConversationDeletingIds"
        :available-assets="directorAvailableAssets"
        @update:docked="setDirectorDocked"
        @update:dock-width="setDirectorDockWidth"
        @dock-width-commit="commitDirectorDockWidth"
        @submit="handleDirectorSubmit"
        @answer-clarification="handleDirectorClarification"
        @cancel-agent="cancelDirectorAgent"
        @confirm-generation="confirmDirectorGeneration"
        @prepare-generation="prepareDirectorGeneration"
        @locate-generation="locateDirectorGeneration"
        @refresh-image-models="tasks.loadModels(true)"
        @retry-agent="retryDirectorAgent"
        @new-conversation="startDirectorConversation"
        @load-conversations="loadDirectorConversations"
        @restore-recent="restoreLatestDirectorConversation"
        @select-conversation="selectDirectorConversation"
        @delete-conversation="deleteDirectorConversation"
        @close="closeDirector"
      />
      <CharacterStudioDialog
        v-if="activePanel === 'characters'"
        :project-id="projectId"
        @close="activePanel = ''"
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

<style scoped>
.cv3-selection-frame {
  position: absolute;
  z-index: 6;
  box-sizing: border-box;
  border: 1px dashed rgb(234 234 234 / 70%);
  border-radius: 8px;
  background: rgb(255 255 255 / 3%);
  pointer-events: none;
}
.cv3-group-background {
  position: absolute;
  z-index: 0;
  border-radius: 24px;
  pointer-events: none;
}
.has-persistent-groups {
  background: var(--cv3-bg);
}
.has-persistent-groups .cv3-flow {
  background: transparent;
}
.has-multi-selection :deep(.vue-flow__nodesselection-rect) {
  border: 0;
  background: transparent;
}
.has-active-group :deep(.vue-flow__nodesselection-rect) {
  pointer-events: none;
}
.cv3-image-import-status {
  pointer-events: none;
}
.cv3-image-import-status button {
  pointer-events: auto;
}
.cv3-selection-frame-edge {
  position: absolute;
  pointer-events: auto;
  cursor: move;
  touch-action: none;
}
.cv3-selection-frame-edge.is-top {
  top: -4px;
  left: -4px;
  right: -4px;
  height: 8px;
}
.cv3-selection-frame-edge.is-bottom {
  bottom: -4px;
  left: -4px;
  right: -4px;
  height: 8px;
}
.cv3-selection-frame-edge.is-left {
  left: -4px;
  top: 4px;
  bottom: 4px;
  width: 8px;
}
.cv3-selection-frame-edge.is-right {
  right: -4px;
  top: 4px;
  bottom: 4px;
  width: 8px;
}
</style>
