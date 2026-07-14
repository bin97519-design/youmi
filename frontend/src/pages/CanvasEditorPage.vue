<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch,
} from 'vue'
import { useRouter } from 'vue-router'
import ImageViewer from '../components/ImageViewer.vue'
import { layerName, useCanvasStore } from '../stores/canvas'
import { useUserStore } from '../stores/user'
import { apiPath } from '../utils/apiBase'
import { cachedImgHtml } from '../utils/imageCache'
import { uploadFileDirect, persistToOss } from '../utils/ossUpload'

const props = defineProps({ id: { type: String, required: true } })
const router = useRouter()
const canvas = useCanvasStore()
const userStore = useUserStore()
const doc = computed(() => canvas.ensureDocument(props.id))

const fileInput = ref(null)
const fileInputMode = ref('canvas')
const addOpen = ref(false)
const shortcutsOpen = ref(false)
const helpMenuOpen = ref(false)
const toolbarAddOpen = ref(false)
const minimapVisible = ref(true)
const myMaterialsOpen = ref(false)
const historyPanelOpen = ref(false)
const myMaterials = ref(JSON.parse(localStorage.getItem('youmi_my_materials') || '[]'))

// 视频播放状态
const playingVideoLayerId = ref(null)

// + 号弹层位置（fixed 定位 + Teleport to body，彻底脱离 transform 父级）
const addMenuWrapEl = ref(null)
const addMenuPosition = ref({})
function toggleToolbarAdd() {
  if (!toolbarAddOpen.value) {
    // 先算坐标，再打开菜单 → 避免菜单先在 (0,0) 闪现再跳到正确位置
    const btn = addMenuWrapEl.value?.querySelector('.uc-toolbar-add-btn')
    if (btn) {
      const r = btn.getBoundingClientRect()
      addMenuPosition.value = {
        position: 'fixed',
        top: r.top + r.height / 2 + 'px',
        left: r.right + 8 + 'px',
        transform: 'translateY(-50%)',
        zIndex: 9999,
      }
    }
    toolbarAddOpen.value = true
  } else {
    toolbarAddOpen.value = false
  }
}

// 归一化 box_2d 到 0-1，格式统一为 [x1, y1, x2, y2] = [left, top, right, bottom]
// 数据来源（canvas.js runDetection）已在存储时做 [top,left,bottom,right] → [left,top,right,bottom] 的 swap
// 此处只需做归一化和 clamp
function normalizeBoxVal(raw) {
  if (!Array.isArray(raw) || raw.length !== 4) return [0, 0, 1, 1]
  // 确保所有值都是数字
  const box = raw.map((v) => {
    const n = parseFloat(v)
    return isNaN(n) ? 0 : n
  })
  // 如果值大于 1，说明是 0-1000 范围，需要除以 1000
  const maxVal = Math.max(...box.map((v) => Math.abs(v)))
  if (maxVal > 1.5) {
    return box.map((v) => Math.max(0, Math.min(1, v / 1000)))
  }
  // 已经是 0-1 范围，直接返回
  return box.map((v) => Math.max(0, Math.min(1, v)))
}

// 从 doc.value.payload.layers[*].detection.boxes 同步到 layerDetectedElements
function syncDetectionFromLayers() {
  const allLayers = doc.value?.payload?.layers || []
  const next = { ...layerDetectedElements.value }
  let changed = false
  for (const layer of allLayers) {
    const boxes = layer?.detection?.boxes
    if (Array.isArray(boxes) && boxes.length) {
      const els = boxes.map((b, i) => {
        const b2d = normalizeBoxVal(b.box2d || b.box_2d || [])
        return {
          id: b.name || b.id || `el-${layer.id}-${i}`,
          name: b.name || b.id || `element-${i}`,
          box2d: b2d,
          box_2d: b2d,
        }
      })
      const cur = next[layer.id]
      if (!cur || cur.length !== els.length) {
        next[layer.id] = els
        changed = true
      }
    }
  }
  if (changed) layerDetectedElements.value = next
}
const layerDetectedElements = ref({})
const selectedDetectedElements = ref(new Set())
const elementClickPositions = ref({})
const detectingLayerIds = ref(new Set())
const chatSkipPillSync = ref(false)
const _undoRestoring = ref(false) // 撤销恢复期间跳过自动检测
const _mounted = ref(false) // 组件是否已挂载（用于防止 polling 越界）
const rightPanelVisible = ref(true)
const isReversePromptCanvas = computed(() => props.id === 'reverse-prompt')
const reversePromptCard = reactive({ x: null, y: null, width: 380, height: 240, dragging: null })
const reversePromptConnectors = ref([])
const selectedLayerId = ref('')
const selectedLayerIds = ref([])
// 图片复制 / 粘贴的内部 buffer（保底，确保应用内 Ctrl+C → Ctrl+V 100% 可用）
const clipboardImage = ref(null)
const rightTab = ref('chat')

// ========== 连接线系统 ==========
// 连接线归属画布文档：从按文档隔离的 payload 读取（旧文档无该字段则默认 []）
const connections = ref([...(doc.value?.payload?.connections || [])]) // { id, fromLayerId, fromPort, toLayerId, toPort }

// 把当前连接线落库到按文档隔离的 payload（localStorage 立即写 + 防抖同步服务端）
function persistConnections() {
  canvas.updateDocument(props.id, (draft) => {
    draft.payload.connections = connections.value
    return draft
  })
}
const connecting = reactive({
  active: false,
  fromLayerId: '',
  fromPort: '', // 'left' | 'right'
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
})
// 连接线选中状态（viewport-local 坐标，跟随画布缩放）
const selectedConnection = reactive({
  id: '',
  localX: 0,
  localY: 0,
})

// 选中连接线（点击时触发），按钮跟随鼠标点击位置
function selectConnection(event, connId) {
  event.stopPropagation()
  const viewportEl = document.querySelector('.canvas-viewport')
  if (!viewportEl) return
  const rect = viewportEl.getBoundingClientRect()
  const vs = viewScale.value || 1
  selectedConnection.id = connId
  selectedConnection.localX = (event.clientX - rect.left) / vs
  selectedConnection.localY = (event.clientY - rect.top) / vs
}

// 取消选中连接线
function deselectConnection() {
  selectedConnection.id = ''
}

// 获取节点端口在 stage 坐标系中的像素位置
// 直接从 DOM 读取端口的实际屏幕位置，确保连接线端点 100% 对齐 +号圆圈中心
function getPortPosition(layerId, port) {
  const layer = layers.value.find((l) => l.id === layerId)
  if (!layer) return { x: 0, y: 0 }
  // 降级：纯计算（画布局部坐标，viewport 容器处理 scale+offset）
  const vs = viewScale.value
  const nodeWidth = layer.width || 200
  const nodeHeight =
    layer.height ||
    (layer.naturalWidth && layer.naturalHeight
      ? Math.round((nodeWidth * layer.naturalHeight) / layer.naturalWidth)
      : 150)
  const portCenterVisualOffset = 8 / vs
  const portOffset = port === 'left' ? -portCenterVisualOffset : nodeWidth + portCenterVisualOffset
  return {
    x: layer.x + portOffset,
    y: layer.y + nodeHeight / 2,
  }
}

// 屏幕坐标 → 画布局部坐标（用于连接线等 canvas-viewport 内部元素）
function screenToStage(clientX, clientY) {
  const viewportEl = document.querySelector('.canvas-viewport')
  if (!viewportEl) return { x: 0, y: 0 }
  const rect = viewportEl.getBoundingClientRect()
  const vs = viewScale.value
  return {
    x: (clientX - rect.left) / vs,
    y: (clientY - rect.top) / vs,
  }
}

// 开始连接
function startConnection(event, layerId, port) {
  event.stopPropagation()
  event.preventDefault()
  const pos = getPortPosition(layerId, port)
  connecting.active = true
  connecting.fromLayerId = layerId
  connecting.fromPort = port
  connecting.startX = pos.x
  connecting.startY = pos.y
  connecting.currentX = pos.x
  connecting.currentY = pos.y
}

// 更新连接线拖拽位置
function updateConnectionDrag(event) {
  if (!connecting.active) return
  const pos = screenToStage(event.clientX, event.clientY)
  connecting.currentX = pos.x
  connecting.currentY = pos.y
}

// 完成连接（不限制连接数量，允许任意节点间连接）
// 连接完成后关闭连接模式，下次需要再从端口开始拖
let _justFinishedConnection = false
function finishConnection(event, layerId, port) {
  if (!connecting.active) return
  if (connecting.fromLayerId === layerId) {
    // 不能连接自己
    return
  }
  // 创建连接
  connections.value.push({
    id: `conn-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    fromLayerId: connecting.fromLayerId,
    fromPort: connecting.fromPort,
    toLayerId: layerId,
    toPort: port,
  })
  persistConnections()
  debounceSaveLayout()
  // 标记刚完成连接，防止 stage pointerup 立即 cancelConnection
  _justFinishedConnection = true
  // 完成后关闭连接模式
  connecting.active = false
}

// 取消连接（仅在未刚完成连接时才真正取消）
function cancelConnection() {
  if (_justFinishedConnection) {
    _justFinishedConnection = false
    return
  }
  connecting.active = false
}

// stage pointerup/pointercancel: 停止选框 + 取消连接
function onStagePointerUp(e) {
  stopMarquee(e)
  cancelConnection()
}

function onStageRightDown(event) {
  // 如果右键点在图层上，走右键菜单逻辑（不拖动）
  const layerEl = event.target.closest('.canvas-layer')
  if (layerEl) return
  // 如果手形工具已经在拖动中，不覆盖
  if (panState.value) return
  event.preventDefault()
  const offset = doc.value.payload.view.offset || { x: 0, y: 0 }
  panOffset.x = offset.x
  panOffset.y = offset.y
  panState.value = {
    startX: event.clientX,
    startY: event.clientY,
  }
}

// 删除连接并取消选中
function deleteSelectedConnection() {
  removeConnection(selectedConnection.id)
  deselectConnection()
}

// 选中图层
function selectSingleLayer(layer) {
  selectedLayerId.value = layer.id
  selectedLayerIds.value = [layer.id]
}

// 帮助菜单 → 快捷键
function openShortcutsFromHelp() {
  helpMenuOpen.value = false
  shortcutsOpen.value = true
}

// 添加文件/节点后关闭菜单
function addFileAndClose() {
  openImageUpload('canvas')
  toolbarAddOpen.value = false
}
function addImageNodeAndClose() {
  addImageNode()
  toolbarAddOpen.value = false
}
function addVideoNodeAndClose() {
  addVideoNode()
  toolbarAddOpen.value = false
}
function addTextNodeAndClose() {
  addTextNode()
  toolbarAddOpen.value = false
}

// 删除连接
function removeConnection(connId) {
  connections.value = connections.value.filter((c) => c.id !== connId)
  persistConnections()
  debounceSaveLayout()
}

// 生成贝塞尔曲线路径
function generateCurvePath(x1, y1, x2, y2) {
  const dx = Math.abs(x2 - x1)
  const cp = Math.max(dx * 0.5, 50)
  return `M ${x1} ${y1} C ${x1 + cp} ${y1}, ${x2 - cp} ${y2}, ${x2} ${y2}`
}

// 计算所有连接线路径
// 连接线渲染刷新标记（节点移动时触发重绘）
const connectionTick = ref(0)
function refreshConnections() {
  connectionTick.value++
}

// 节点位置/缩放/偏移变化时自动刷新连接线（拖动中跳过，避免 getBoundingClientRect 强制 layout）
watch(
  [
    () =>
      doc.value?.payload?.layers
        ?.map((l) => `${l.id}:${l.x}:${l.y}:${l.width}:${l.height}`)
        .join(','),
    () => doc.value?.payload?.view?.scale,
    () => JSON.stringify(doc.value?.payload?.view?.offset),
  ],
  () => {
    if (dragState.value || resizeState.value || panState.value) return // 拖动/缩放/平移中跳过，松手时手动刷新
    nextTick(() => refreshConnections())
  },
)

// 连接线路径（每次渲染都从 DOM 实时获取端口位置）
function getConnectionPaths() {
  const _tick = connectionTick.value // 依赖触发
  return connections.value
    .filter((conn) => {
      // 过滤孤儿连接线：关联图层已不存在的连接线不渲染
      const fromExists = layers.value.some((l) => l.id === conn.fromLayerId)
      const toExists = layers.value.some((l) => l.id === conn.toLayerId)
      return fromExists && toExists
    })
    .map((conn) => {
      const from = getPortPosition(conn.fromLayerId, conn.fromPort)
      const to = getPortPosition(conn.toLayerId, conn.toPort)
      return {
        ...conn,
        path: generateCurvePath(from.x, from.y, to.x, to.y),
        fromX: from.x,
        fromY: from.y,
        toX: to.x,
        toY: to.y,
      }
    })
}

// 当前拖拽中的连接线路径
const connectingPath = computed(() => {
  if (!connecting.active) return ''
  return generateCurvePath(
    connecting.startX,
    connecting.startY,
    connecting.currentX,
    connecting.currentY,
  )
})
const chatHistoryRef = ref(null)
const chatText = ref('')
const chatReferenceImages = ref([])
const activeChatReferenceId = ref('')
const chatUploading = ref(false)
const uploadProgress = ref(null) // { fileName, loaded, total, percent } | null
const chatGenerating = ref(false)
const chatSelectOpen = ref(null) // 'model' | 'ratio' | 'resolution' | null

function toggleChatSelect(name) {
  chatSelectOpen.value = chatSelectOpen.value === name ? null : name
}
// 生成历史归属画布文档：从 payload 读取（旧文档无该字段则默认 []）
const generationHistory = ref([...(doc.value?.payload?.generationHistory || [])])

// 历史记录「唯一写入入口」：图进画布 ⇒ 历史必写（聊天生图路径 A 与刷新恢复路径 B 共用）。
// record 字段：{ id, prompt, model, ratio, resolution, imageUrl, referenceImageUrls, createdAt }
// 写入后立即写回文档 payload 并强制 flush，确保易丢节点（刷新恢复完成）也不丢记录。
function recordGenerationToHistory(record) {
  if (!record || !record.imageUrl) return
  generationHistory.value.push(record)
  if (generationHistory.value.length > 200) generationHistory.value.shift()
  canvas.updateDocument(props.id, (draft) => {
    draft.payload.generationHistory = generationHistory.value.slice(-200)
    return draft
  })
  // localStorage 已在 updateDocument→persist 内同步即时写；这里强制 flush，让服务器也立即跟上
  canvas.flushNow?.()
}
// 对话窗口选中的模型参数也归属文档（payload.chatConfig），未持久化过则保持默认
const initialChatConfig = doc.value?.payload?.chatConfig || {}
const chatModel = ref(initialChatConfig.model || 'banana2')
const chatRatio = ref(initialChatConfig.ratio || '9:16')
const chatResolution = ref(initialChatConfig.resolution || '2K')
// 注意：model 字符串必须和后端 alias 表（ImageGenerationProperties.defaultModelAliases）保持一致
// 后端会对空格/横线/下划线做归一化容错，但 UI 上用标准写法更专业
const chatModelOptions = ['banana2', 'banana-pro', 'gpt-image-2', 'agnes-image-2.1-flash']
const chatRatioOptions = ['auto', '1:1', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
const chatResolutionOptions = ['1K', '2K', '4K']
const TASK_POLL_INTERVAL = 2500
// 对话窗口选中的模型参数变化时，落库到按文档隔离的 payload.chatConfig
watch([chatModel, chatRatio, chatResolution], () => {
  canvas.updateDocument(props.id, (draft) => {
    draft.payload.chatConfig = {
      model: chatModel.value,
      ratio: chatRatio.value,
      resolution: chatResolution.value,
    }
    return draft
  })
})
// 切换画布文档（SPA 复用组件实例、props.id 变化时）重新从新文档 payload 同步本地状态，
// 避免把上一个文档的连接线/历史错写到新文档（准则 D：互不串扰）
watch(
  () => props.id,
  () => {
    connecting.active = false
    selectedConnection.id = ''
    connections.value = [...(doc.value?.payload?.connections || [])]
    generationHistory.value = [...(doc.value?.payload?.generationHistory || [])]
    const cfg = doc.value?.payload?.chatConfig || {}
    chatModel.value = cfg.model || 'banana2'
    chatRatio.value = cfg.ratio || '9:16'
    chatResolution.value = cfg.resolution || '2K'
    initDocState()
  },
)
// 聊天消息中元素 pill 的悬停预览
const hoverPreview = reactive({
  visible: false,
  x: 0,
  y: 0,
  layerUrl: '',
  box: null,
  name: '',
  order: 0,
})
const hoverPreviewTimer = ref(null)
const hoverPreviewImageSize = reactive({ width: 0, height: 0 })
const hoverPreviewDims = reactive({ w: 220, h: 180 }) // 预览弹窗实际宽高，用于边界自适应
const TASK_MAX_POLLS = 160 // 后端 2 分钟超时自动切换备用中转站，留足余量（160×2.5s≈400s）
const PLACEHOLDER_WIDTH = 360
const PLACEHOLDER_HEIGHT = 480
const CANVAS_IMAGE_WIDTH = 360 // 画布中图片统一展示宽度（相同比例的图显示大小一致）
const PLACEHOLDER_STATUS_TEXTS = [
  '灵感信号已捕获，创意引擎启动中...',
  '正在构色与铺光，拆解视觉元素...',
  '渲染像素级细节，融合风格笔触...',
  '最终校色定稿，即将跃然屏上...',
]
function addReversePromptReference(imageUrl, layerId) {
  canvas.updateDocument(props.id, (draft) => {
    draft.payload.reversePrompt = draft.payload.reversePrompt || { referenceImages: [] }
    if (!draft.payload.reversePrompt.referenceImages.find((r) => r.layerId === layerId)) {
      draft.payload.reversePrompt.referenceImages.push({
        url: imageUrl,
        layerId,
        addedAt: Date.now(),
      })
    }
    return draft
  })
}

function removeReversePromptReference(layerId) {
  canvas.updateDocument(props.id, (draft) => {
    if (!draft.payload.reversePrompt) return draft
    draft.payload.reversePrompt.referenceImages =
      draft.payload.reversePrompt.referenceImages.filter((r) => r.layerId !== layerId)
    return draft
  })
}

const visibleReferenceImages = computed(() => {
  if (!doc.value?.payload?.reversePrompt?.referenceImages) return []
  return doc.value.payload.reversePrompt.referenceImages.filter((r) =>
    layers.value.some((l) => l.id === r.layerId),
  )
})
const activeTool = ref('select')
const canvasTools = [
  { key: 'select', label: '选择', shortcut: 'V', icon: 'ri-cursor-line' },
  { key: 'hand', label: '抓手（拖动画布）', shortcut: 'H', icon: 'ri-hand' },
  { key: 'focus', label: '聚焦选中 / 适应画面', shortcut: 'F', icon: 'ri-focus-3-line' },
  {
    key: 'annotate',
    label: '标记元素（点击图片元素选中加入输入框）',
    shortcut: 'M',
    icon: 'ri-mark-pen-line',
  },
]
const dragState = ref(null)
const panState = ref(null) // 手形工具 & 右键拖动共用
const resizeState = ref(null)
const marquee = reactive({ active: false, startX: 0, startY: 0, currentX: 0, currentY: 0 })
const annotationInput = reactive({
  visible: false,
  layerId: '',
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  text: '',
  geoPixel: null,
})
const manualBoxDraft = reactive({
  active: false,
  visible: false,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
  layerId: '',
})
// 手动框选命名输入
const manualNameInput = reactive({
  visible: false,
  layerId: '',
  x: 0,
  y: 0,
  box_2d: null,
  text: '',
})
// 图片加载失败追踪：OSS 故障/签名过期时显示占位而非白条
const brokenImages = reactive(new Set())
function markImageBroken(id) {
  brokenImages.add(id)
}
function retryImage(id) {
  // 从失败集合移除 → 触发模板重渲染 → img 重新发起加载（OSS 恢复后即可救回）
  brokenImages.delete(id)
}
// 宫格裁图模式
const cropMode = reactive({
  active: false,
  layerId: null,
  rows: 3,
  cols: 3,
  selectedCells: new Set(),
})
const cropPickerOpen = ref(false) // 宫格选择器弹窗
const cropPickerX = ref(0)
const cropPickerY = ref(0)
const cropQuickOpen = ref(false) // 快捷裁图子菜单

// 重叠元素候选列表：key = "layerId::elementId" → [{layerId, el, id, name, box_2d, area}]
const elementOverlapCandidates = ref({})
// 重叠元素下拉弹窗状态
const overlapDropdown = reactive({ visible: false, x: 0, y: 0, pillKey: '', candidates: [] })
const selectedAnnotation = ref({ layerId: '', annoId: '' })
const panel = reactive({
  x: null,
  y: 6,
  width: 340,
  chatHeight: 258,
  dragging: null,
  resizing: null,
  resizingChat: null,
})
const toolbar = reactive({ x: null, y: null, dragging: null })

const layers = computed(() => doc.value.payload.layers)
const selectedLayer = computed(() => layers.value.find((item) => item.id === selectedLayerId.value))
const selectedLayerIndex = computed(() =>
  layers.value.findIndex((item) => item.id === selectedLayerId.value),
)
const viewScale = computed(() => doc.value.payload.view.scale || 1)
// 手形工具拖动 — 轻量 reactive，避免每帧 Immer + persist
const panOffset = reactive({ x: 0, y: 0 })
let panCommitTimer = null
let _panRafId = null // rAF 批处理，确保每帧最多一次 reactive 更新
let _panDomEl = null // 缓存 canvas-viewport DOM 引用，直写 transform 零延迟
let _dragRafId = null // 拖拽图层 snap 计算 rAF 批处理
// 拖动时直接读 reactive panOffset（零延迟），静止时读 store
const viewOffset = computed(() => {
  if (panState.value) return { x: panOffset.x, y: panOffset.y }
  return doc.value.payload.view.offset || { x: 0, y: 0 }
})

// 判断元素框是否被更高 z-index 图层遮挡
function isElementBlocked(layerId, elBox) {
  const myLayer = layers.value.find((l) => l.id === layerId)
  if (!myLayer) return false
  const myZ = myLayer.zIndex || 0
  // 在画布局部坐标空间比较（不需要 viewOffset/viewScale，因为都在 viewport 容器内）
  const eLeft = myLayer.x + elBox[0] * myLayer.width
  const eTop = myLayer.y + elBox[1] * myLayer.height
  const eRight = eLeft + (elBox[2] - elBox[0]) * myLayer.width
  const eBottom = eTop + (elBox[3] - elBox[1]) * myLayer.height

  for (const l of layers.value) {
    const lz = l.zIndex || 0
    if (lz <= myZ || l.id === layerId) continue
    const lLeft = l.x
    const lTop = l.y
    const lRight = lLeft + (l.width || 0)
    const lBottom = lTop + (l.height || 0)
    if (eLeft < lRight && eRight > lLeft && eTop < lBottom && eBottom > lTop) {
      return true
    }
  }
  return false
}

// 宫格/网格关键词：这类图片不需要自动元素分层
const GRID_KEYWORDS = [
  '宫格',
  '网格',
  '拼图',
  '九宫格',
  '矩阵',
  '横排',
  '竖排',
  '排列',
  '对比图',
  '合集',
]
function hasGridKeywords(text) {
  if (!text) return false
  return GRID_KEYWORDS.some((kw) => text.includes(kw))
}

// Watch for newly added layers to auto-detect
watch(
  () => layers.value.map((l) => l.id),
  (newIds, oldIds) => {
    if (!newIds || !oldIds) return
    // 撤销恢复期间不触发自动检测（避免覆盖刚恢复的检测数据）
    if (_undoRestoring.value) return
    const added = newIds.filter((id) => !oldIds.includes(id))
    for (const id of added) {
      const layer = layers.value.find((l) => l.id === id)
      if (layer && layer.url && layer.type !== 'placeholder') {
        // 宫格裁图不自动检测
        if (layer.source === '宫格裁图') continue
        // 复制出来的图层不自动智能分层
        if (layer.source === '复制图层') continue
        // 提示词包含宫格/网格关键词 → 跳过自动分层
        if (hasGridKeywords(layer.detectPrompt || layer.source)) continue
        // 如果该图层已经有检测数据（来自撤销恢复），不重复检测
        if (layerDetectedElements.value[id] && layerDetectedElements.value[id].length > 0) {
          console.log('[watch] 跳过已有检测数据的图层:', id)
          continue
        }
        console.log('[watch] 触发自动检测:', id, layer.url)
        nextTick(() => maybeAutoDetect(layer))
      }
    }
  },
)

const toolbarStyle = computed(() =>
  toolbar.x === null ? {} : { left: `${toolbar.x}px`, top: `${toolbar.y}px`, bottom: 'auto' },
)

// 缩放滑块
const ZOOM_MIN = 0.1,
  ZOOM_MAX = 4.0
const zoomSliderValue = computed(() =>
  Math.round(((viewScale.value - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100),
)
function setZoomFromSlider(value) {
  const newScale = ZOOM_MIN + (ZOOM_MAX - ZOOM_MIN) * (Number(value) / 100)
  setDocScale(newScale)
}
function zoomSliderReset() {
  setDocScale(1)
}
function setDocScale(newScale) {
  if (newScale === viewScale.value) return
  const oldScale = viewScale.value
  canvas.updateDocument(props.id, (draft) => {
    draft.payload.view.scale = Math.round(newScale * 1000) / 1000
    if (newScale > 0.1 && oldScale > 0.1) {
      const ratio = newScale / oldScale
      draft.payload.view.offset.x = Math.round(draft.payload.view.offset.x * ratio)
      draft.payload.view.offset.y = Math.round(draft.payload.view.offset.y * ratio)
    }
    return draft
  })
}

// UI 布局缓存
const UI_LAYOUT_KEY = 'youmi_canvas_ui_layout_v3'
const LAYOUT_SAVE_DEBOUNCE = 300
let _layoutSaveTimer = null
function loadUILayout() {
  try {
    const raw = localStorage.getItem(UI_LAYOUT_KEY)
    if (!raw) return
    const s = JSON.parse(raw)
    if (s.panel != null) {
      if (s.panel.x != null) panel.x = s.panel.x
      if (s.panel.y != null) panel.y = s.panel.y
      if (s.panel.width != null) panel.width = Math.max(260, Math.min(600, s.panel.width))
      if (s.panel.chatHeight != null)
        panel.chatHeight = Math.max(140, Math.min(800, s.panel.chatHeight))
      if (s.panel.rightTab != null && ['chat', 'layers', 'history'].includes(s.panel.rightTab))
        rightTab.value = s.panel.rightTab
      if (s.panel.rightPanelVisible != null) rightPanelVisible.value = s.panel.rightPanelVisible
    }
    if (s.minimapVisible != null) minimapVisible.value = s.minimapVisible
    if (s.reversePromptCard != null) {
      if (s.reversePromptCard.x != null) reversePromptCard.x = s.reversePromptCard.x
      if (s.reversePromptCard.y != null) reversePromptCard.y = s.reversePromptCard.y
      if (s.reversePromptCard.width != null)
        reversePromptCard.width = Math.max(300, Math.min(900, s.reversePromptCard.width))
      if (s.reversePromptCard.height != null)
        reversePromptCard.height = Math.max(200, Math.min(700, s.reversePromptCard.height))
    }
  } catch (_) {
    /* ignore */
  }
}

// 初始化从 payload 恢复的文档级状态，并就地清洗孤儿连接线（关联图层已不存在的连接线移除并落库）
function initDocState() {
  if (!connections.value.length || !doc.value?.payload?.layers) return
  const layerIds = new Set(doc.value.payload.layers.map((l) => l.id))
  const cleaned = connections.value.filter(
    (c) => layerIds.has(c.fromLayerId) && layerIds.has(c.toLayerId),
  )
  if (cleaned.length !== connections.value.length) {
    connections.value = cleaned
    persistConnections()
  }
}
function saveUILayout() {
  try {
    localStorage.setItem(
      UI_LAYOUT_KEY,
      JSON.stringify({
        panel: {
          x: panel.x,
          y: panel.y,
          width: panel.width,
          chatHeight: panel.chatHeight,
          rightTab: rightTab.value,
          rightPanelVisible: rightPanelVisible.value,
        },
        minimapVisible: minimapVisible.value,
        reversePromptCard: {
          x: reversePromptCard.x,
          y: reversePromptCard.y,
          width: reversePromptCard.width,
          height: reversePromptCard.height,
        },
      }),
    )
  } catch (_) {
    /* ignore */
  }
}
function debounceSaveLayout() {
  clearTimeout(_layoutSaveTimer)
  _layoutSaveTimer = setTimeout(saveUILayout, LAYOUT_SAVE_DEBOUNCE)
}
watch(
  [
    () => panel.x,
    () => panel.y,
    () => panel.width,
    () => panel.chatHeight,
    rightTab,
    rightPanelVisible,
    minimapVisible,
    () => reversePromptCard.x,
    () => reversePromptCard.y,
    () => reversePromptCard.width,
    () => reversePromptCard.height,
  ],
  debounceSaveLayout,
  { deep: false },
)

// 帮助菜单定位
const helpMenuStyle = ref({})
function openHelpMenu(event) {
  const rect = event.currentTarget.getBoundingClientRect()
  helpMenuStyle.value = {
    position: 'fixed',
    right: `${window.innerWidth - rect.right}px`,
    top: `${rect.top - 8}px`,
    transform: 'translateY(-100%)',
  }
  helpMenuOpen.value = !helpMenuOpen.value
}

// 地图
const canvasMinimap = computed(() => {
  const width = 184
  const height = 132
  const padding = 10
  const viewportWorld = {
    x: -viewOffset.value.x / viewScale.value,
    y: -viewOffset.value.y / viewScale.value,
    width: viewportSize.width / viewScale.value,
    height: viewportSize.height / viewScale.value,
  }
  const boxes = layers.value.map((layer) => ({
    id: layer.id,
    type: layer.type,
    selected: selectedLayerIds.value.includes(layer.id),
    x: layer.x,
    y: layer.y,
    width: layer.width || 1,
    height:
      layer.height ||
      Math.round(((layer.width || 1) * (layer.naturalHeight || 1)) / (layer.naturalWidth || 1)) ||
      1,
  }))
  const boundsItems = [
    ...boxes,
    {
      x: viewportWorld.x,
      y: viewportWorld.y,
      width: viewportWorld.width,
      height: viewportWorld.height,
    },
  ]
  const minX = Math.min(...boundsItems.map((item) => item.x))
  const minY = Math.min(...boundsItems.map((item) => item.y))
  const maxX = Math.max(...boundsItems.map((item) => item.x + item.width))
  const maxY = Math.max(...boundsItems.map((item) => item.y + item.height))
  const worldW = maxX - minX || 1
  const worldH = maxY - minY || 1
  const scale = Math.min((width - padding * 2) / worldW, (height - padding * 2) / worldH)
  const layers_ = boxes.map((box) => ({
    ...box,
    style: {
      position: 'absolute',
      left: `${padding + (box.x - minX) * scale}px`,
      top: `${padding + (box.y - minY) * scale}px`,
      width: `${box.width * scale}px`,
      height: `${box.height * scale}px`,
    },
  }))
  const vpLeft = padding + (viewportWorld.x - minX) * scale
  const vpTop = padding + (viewportWorld.y - minY) * scale
  return {
    width,
    height,
    layers: layers_,
    viewportStyle: {
      left: `${vpLeft}px`,
      top: `${vpTop}px`,
      width: `${viewportWorld.width * scale}px`,
      height: `${viewportWorld.height * scale}px`,
    },
  }
})
const minimapPanState = ref(null)
function startMinimapPan(e) {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  const rect = e.currentTarget.getBoundingClientRect()
  const mapData = canvasMinimap.value
  const worldBounds = getWorldBounds()
  const worldW = Math.max(1, worldBounds.maxX - worldBounds.minX)
  const worldH = Math.max(1, worldBounds.maxY - worldBounds.minY)
  // 点击位置 → 世界坐标 → 视口偏移
  const mapInnerW = canvasMinimap.value.width - 20
  const mapInnerH = canvasMinimap.value.height - 20
  const clickMapX = e.clientX - rect.left - 10
  const clickMapY = e.clientY - rect.top - 10
  const worldX = worldBounds.minX + worldW * (clickMapX / mapInnerW)
  const worldY = worldBounds.minY + worldH * (clickMapY / mapInnerH)
  // 平移画布使点击位置居中
  canvas.updateDocument(props.id, (draft) => {
    draft.payload.view.offset = {
      x: Math.round(-(worldX * viewScale.value - viewportSize.width / 2)),
      y: Math.round(-(worldY * viewScale.value - viewportSize.height / 2)),
    }
    return draft
  })
  // 设置拖拽状态，后续拖拽继续移动
  minimapPanState.value = {
    pointerId: e.pointerId,
    lastX: e.clientX,
    lastY: e.clientY,
  }
  e.currentTarget.setPointerCapture(e.pointerId)
}
function moveMinimapPan(e) {
  if (!minimapPanState.value) return
  const dx = e.clientX - minimapPanState.value.lastX
  const dy = e.clientY - minimapPanState.value.lastY
  minimapPanState.value.lastX = e.clientX
  minimapPanState.value.lastY = e.clientY
  // 像素拖拽 → 视口偏移（反向）
  const vs = viewScale.value
  const worldBounds = getWorldBounds()
  const worldW = Math.max(1, worldBounds.maxX - worldBounds.minX)
  const mapInnerW = canvasMinimap.value.width - 20
  const pxToWorld = worldW / mapInnerW
  canvas.updateDocument(props.id, (draft) => {
    draft.payload.view.offset = {
      x: Math.round(draft.payload.view.offset.x - dx * pxToWorld * vs),
      y: Math.round(draft.payload.view.offset.y - dy * pxToWorld * vs),
    }
    return draft
  })
}
function stopMinimapPan(e) {
  if (!minimapPanState.value) return
  try {
    e.currentTarget.releasePointerCapture(minimapPanState.value.pointerId)
  } catch {
    /* ignore */
  }
  minimapPanState.value = null
}
function getWorldBounds() {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const l of layers.value) {
    if (l.x < minX) minX = l.x
    if (l.y < minY) minY = l.y
    if (l.x + (l.width || 1) > maxX) maxX = l.x + (l.width || 1)
    if (l.y + (l.height || 1) > maxY) maxY = l.y + (l.height || 1)
  }
  return { minX, minY, maxX, maxY }
}

// viewport size
const viewportSize = reactive({ width: 1200, height: 800 })
function updateViewportSize() {
  viewportSize.width = window.innerWidth
  viewportSize.height = window.innerHeight - 60
}
const demoChatMessages = [
  { id: 'demo-user-1', role: 'user', text: '3333' },
  {
    id: 'demo-assistant-1',
    role: 'assistant',
    text: '已提交对话修改任务，请等待生成结果（生成完成后会显示在画布中）。',
  },
  { id: 'demo-user-2', role: 'user', text: '（仅图片）' },
  { id: 'demo-assistant-2', role: 'assistant', text: '已添加 2 张参考图到画布。' },
]
const chatMessages = computed(() => {
  const messages = doc.value.payload.chat || []
  const isSeedDemo =
    props.id === '1904' &&
    messages.some((message) => String(message.id || '').startsWith('seed-chat-'))
  if (!isSeedDemo) return messages
  const userMessages = messages.filter(
    (message) => !String(message.id || '').startsWith('seed-chat-'),
  )
  return [...demoChatMessages, ...userMessages]
})
const marqueeStyle = computed(() => {
  if (!marquee.active) return {}
  const left = Math.min(marquee.startX, marquee.currentX)
  const top = Math.min(marquee.startY, marquee.currentY)
  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${Math.abs(marquee.currentX - marquee.startX)}px`,
    height: `${Math.abs(marquee.currentY - marquee.startY)}px`,
  }
})

const manualBoxDraftStyle = computed(() => {
  if (!manualBoxDraft.active || !manualBoxDraft.visible) return {}
  const left = Math.min(manualBoxDraft.startX, manualBoxDraft.currentX)
  const top = Math.min(manualBoxDraft.startY, manualBoxDraft.currentY)
  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${Math.abs(manualBoxDraft.currentX - manualBoxDraft.startX)}px`,
    height: `${Math.abs(manualBoxDraft.currentY - manualBoxDraft.startY)}px`,
  }
})

function imageSize(src) {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () =>
      resolve({ width: image.naturalWidth || 800, height: image.naturalHeight || 800 })
    image.onerror = () => resolve({ width: 800, height: 800 })
    image.src = src
  })
}

function videoSize(src) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const w = video.videoWidth || 1920
      const h = video.videoHeight || 1080
      URL.revokeObjectURL(video.src)
      resolve({ width: w, height: h })
    }
    video.onerror = () => reject(new Error('无法获取视频尺寸'))
    video.src = src
  })
}

async function maybeAutoDetect(layer, force = false) {
  if (!layer || !layer.url || layer.type === 'placeholder' || layer.type === 'video') return
  if (!autoDetectionEnabled.value) return
  if (_undoRestoring.value) return // 撤销恢复期间不触发自动检测
  if (detectingLayerIds.value.has(layer.id)) return
  // 手动点击「智能分层」时传 force=true，绕过 source 跳过（允许对复制图层/裁图手动分层）
  if (!force) {
    if (layer.source === '宫格裁图') return // 裁图不自动检测
    if (layer.source === '复制图层') return // 复制图层不自动检测
  }

  // 清除旧检测结果
  layerDetectedElements.value = { ...layerDetectedElements.value }
  delete layerDetectedElements.value[layer.id]
  selectedDetectedElements.value = new Set()

  detectingLayerIds.value = new Set([...detectingLayerIds.value, layer.id])
  try {
    const res = await fetch(apiPath('/api/image/detect-elements'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...userStore.authHeaders() },
      body: JSON.stringify({ imageUrl: layer.url, layerId: layer.id }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(`[detect] HTTP ${res.status}: ${text.slice(0, 200)}`)
      if (res.status === 502) {
        console.error('[detect] Java后端(8083)可能未启动或已崩溃')
      }
      throw new Error(`HTTP ${res.status}`)
    }
    const data = await res.json()
    if ((data.code === 0 || data.code === 200) && (data.data?.elements || data.data?.imageInfo)) {
      // Java 后端直接返回 0-1 归一化坐标，无需再除以 1000
      const normalizeBox = (raw) => {
        if (!Array.isArray(raw) || raw.length !== 4) return null
        // 值范围检查：如果所有值都 ≤ 1.05，已经是 0-1
        const allSmall = raw.every((v) => Math.abs(v) <= 1.05)
        if (allSmall) return raw
        // 否则除以 1000（兼容旧版 Python 代理的千分数格式）
        return raw.map((v) => v / 1000)
      }
      const els = (data.data.elements || data.data.imageInfo).map((e, i) => {
        const key = e.object_name || e.name || e.id || `element-${i}`
        const box = normalizeBox(e.box_2d || e.box2d)
        return {
          ...e,
          id: key,
          name: key,
          box_2d: box || [0, 0, 1, 1], // 兜底为整图
        }
      })
      layerDetectedElements.value = { ...layerDetectedElements.value, [layer.id]: els }
      // 持久化到文档 payload
      canvas.updateDocument(props.id, (draft) => {
        draft.payload.detectedElements = draft.payload.detectedElements || {}
        draft.payload.detectedElements[layer.id] = els
        return draft
      })
    } else {
      console.warn('[detect] API 返回异常:', data)
    }
  } catch (e) {
    console.error('[detect] 请求失败:', e)
  }
  const next = new Set(detectingLayerIds.value)
  next.delete(layer.id)
  detectingLayerIds.value = next
}

const autoDetectionEnabled = ref(true)

// 视觉框显隐状态（默认显示）
const detectionVisible = ref(true)

function getDetectionVisible() {
  if (doc.value?.payload?.ui?.detectionVisible === false) return false
  return detectionVisible.value !== false
}

function setDetectionVisible(val) {
  detectionVisible.value = val
  canvas.updateDocument(props.id, (draft) => {
    draft.payload.ui = draft.payload.ui || {}
    draft.payload.ui.detectionVisible = val
    return draft
  })
}

function extractUploadUrl(result) {
  return (
    result?.url ||
    result?.fileUrl ||
    result?.path ||
    result?.data?.url ||
    result?.data?.fileUrl ||
    result?.data?.path ||
    result?.data?.fullUrl ||
    result?.data?.src
  )
}

function uploadFile(file, onProgress) {
  // 优先 OSS 直传，失败则 fallback 到 Java 后端中转
  return uploadFileDirect(file, {
    dir: 'youmi-canvas/uploads',
    onProgress,
  }).catch((ossError) => {
    console.warn('[upload] OSS 直传失败，fallback 到 Java 后端中转:', ossError.message)
    return new Promise((resolve, reject) => {
      const form = new FormData()
      form.append('file', file)
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api/file/upload')
      const uploadToken = userStore.token
      if (uploadToken) xhr.setRequestHeader('Authorization', `Bearer ${uploadToken}`)
      xhr.timeout = 120000
      xhr.withCredentials = false
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress({
            loaded: e.loaded,
            total: e.total,
            percent: Math.round((e.loaded / e.total) * 100),
          })
        }
      }
      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(`图片上传失败：${xhr.status}`))
          return
        }
        try {
          const result = JSON.parse(xhr.responseText)
          const url = result?.data?.url || extractUploadUrl(result)
          if (!url) {
            reject(new Error('上传成功，但接口没有返回图片地址'))
            return
          }
          resolve(url.startsWith('http') ? url : window.location.origin + apiPath(url))
        } catch (e) {
          reject(new Error('解析上传响应失败'))
        }
      }
      xhr.ontimeout = () => reject(new Error('上传超时'))
      xhr.onerror = () => reject(new Error('网络错误，上传失败'))
      xhr.send(form)
    })
  })
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function isTaskDone(status) {
  return ['completed', 'succeeded', 'success', 'done'].includes(String(status || '').toLowerCase())
}

function isTaskFailed(status) {
  return ['failed', 'error', 'cancelled', 'canceled'].includes(String(status || '').toLowerCase())
}

// 统一生图任务状态的词表与大小写，使「恢复轮询」与具体状态词解耦。
// - 空值返回 ''，方便调用点用 `|| 'processing'` 兜底；
// - 其余未知词原样小写返回（不静默吞掉），便于恢复过滤器按非终态处理。
function normalizeStatus(raw) {
  if (raw == null) return ''
  const s = String(raw).toLowerCase()
  if (/in_progress|pending|generating|running|queued|processing/.test(s)) return 'processing'
  if (/completed|succeeded|success|done|finished/.test(s)) return 'completed'
  if (/failed|error|fail/.test(s)) return 'failed'
  return s
}

async function readApiResponse(response) {
  const result = await response.json().catch(() => null)
  if (!response.ok || !result || result.code !== 0) {
    const errMsg = result?.message || `接口请求失败：${response.status}`
    console.error('[readApiResponse] 请求失败', { status: response.status, code: result?.code, message: errMsg, url: response.url })
    throw new Error(errMsg)
  }
  return result.data
}

// 全局锁：同一时间只允许一个 submitImageTask 请求在飞，
// 防止 watch 恢复逻辑 / 重复点击 / 任何其他路径并发提交。
let _imageTaskSubmitting = false

async function submitImageTask({ prompt, imageUrls, model, size, resolution, clientTaskId }) {
  if (_imageTaskSubmitting) {
    console.warn('[submitImageTask] 并发提交被拦截：已有生图请求在飞，本次忽略')
    throw new Error('生图请求正在处理中，请勿重复提交')
  }
  _imageTaskSubmitting = true
  console.log('[submitImageTask] 开始提交', { model: model || chatModel.value, size: size || chatRatio.value, promptLen: prompt?.length || 0, hasImages: imageUrls?.length || 0, clientTaskId })
  try {
  // 恢复场景（刷新后重新提交）必须沿用占位图层持久化的生成参数 genMeta，
  // 不能用刷新后重置为默认的 chatModel/chatRatio/chatResolution（否则会换模型/比例重出）。
  const body = {
    prompt,
    model: model || chatModel.value,
    size: size || chatRatio.value,
    resolution: resolution || chatResolution.value,
    n: 1,
  }
  if (imageUrls?.length) {
    body.image_urls = imageUrls
  }
  // 客户端幂等键：落盘到后端，供刷新重提时按它命中已有任务、跳过重复扣费+外部调用。
  if (clientTaskId) body.client_task_id = clientTaskId

  const data = await readApiResponse(
    await fetch(apiPath('/api/image-tasks'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...userStore.authHeaders(),
      },
      body: JSON.stringify(body),
    }),
  )
  const taskId = data?.tasks?.[0]?.taskId || data?.tasks?.[0]?.task_id
  if (!taskId) throw new Error('生图任务提交成功，但没有返回 task_id')
  return taskId
  } finally {
    _imageTaskSubmitting = false
  }
}

// 刷新恢复专用：凭 client_task_id 只查回已有 task_id，不建任务、不扣费、不调中转站。
// 命中则直接续轮询（零重提）；查不到（真·从未提交成功）才走 submitImageTask 新建。
async function resolveImageTaskByClientId(clientTaskId) {
  try {
    const data = await readApiResponse(
      await fetch(apiPath('/api/image-tasks/by-client-task-id?client_task_id=' + encodeURIComponent(clientTaskId)), {
        headers: { ...userStore.authHeaders() },
      }),
    )
    return data?.exists ? (data.taskId || data.task_id || '') : ''
  } catch (e) {
    return ''
  }
}

async function fetchImageTask(taskId) {
  // 与 submitImageTask 保持一致，统一走 apiPath 代理前缀（避免裸路径在部分部署下漏代理）
  return readApiResponse(
    await fetch(apiPath('/api/image-tasks/' + encodeURIComponent(taskId)), {
      headers: { ...userStore.authHeaders() },
    }),
  )
}

// 轮询生图任务直到完成/失败/超时。被「发起生图」与「刷新后恢复轮询」两处共用，
// 避免两份轮询逻辑分叉导致行为不一致。
// assistantId 为空字符串时表示无聊天消息上下文（刷新恢复场景），进度/完成消息不会被写入聊天。
// 返回 true 表示成功完成并已完成占位图层替换；失败或超时抛错交由调用方处理。
async function pollImageTaskUntilDone(taskId, placeholderId, assistantId, prompt = '') {
  for (let index = 0; index < TASK_MAX_POLLS; index += 1) {
    await wait(TASK_POLL_INTERVAL)
    // 组件已卸载（页面刷新/导航）：由 onMounted 的恢复逻辑在重载后接管，这里直接退出
    if (!_mounted.value) return false
    const status = await fetchImageTask(taskId)
    const progress = normalizeProgress(status.progress, Math.min(96, 10 + (index + 1) * 7))
    const progressText = Number.isFinite(Number(status.progress)) ? ` ${progress}%` : ''
    updateGeneratingPlaceholder(placeholderId, {
      progress,
      // 归一化：每个持久化到图层的 status 都统一成规范词（processing/completed/failed），
      // 避免后端/中转站透传的原始词（IN_PROGRESS/PENDING/GENERATING/代理自有词）大小写不一致导致恢复过滤器匹配不上。
      status: normalizeStatus(status.status) || 'processing',
    })
    if (!isTaskDone(status.status) && assistantId) {
      updateChatMessage(assistantId, {
        text: `正在生成${progressText}，任务状态：${status.status || 'processing'}`,
        generating: true,
      })
    }

    if (isTaskFailed(status.status)) {
      throw new Error(friendlyImageError(status.error || 'APIMart 生图任务失败'))
    }

    if (isTaskDone(status.status)) {
      let url = extractTaskImageUrl(status)
      if (!url) throw new Error('任务完成，但没有返回图片地址')
      // 后端已在异步持久化完成后返回永久 OSS URL（persist_status=DONE），
      // 此处不再二次转存（去掉双重转存 + 30s 自杀式 abort，避免很慢/裂图）。
      updateGeneratingPlaceholder(placeholderId, {
        progress: 100,
        status: 'completed',
        statusText: '生成完成，正在渲染到画布...',
      })
      await replaceGeneratingPlaceholder(
        placeholderId,
        url,
        prompt && (prompt.includes('买家秀') || hasGridKeywords(prompt)),
      )
      // —— 历史记录唯一写入点（路径 A 聊天生图 / 路径 B 刷新后恢复 共用）——
      // 图已落地画布，这里确保同步进历史记录。占位图层上的 genMeta 提供生成参数；
      // 旧版（修复前）创建的在途图层可能没有 genMeta，则优雅降级（prompt 兜底，其余字段允许为空）。
      const placeholderLayer = layers.value.find((l) => l.id === placeholderId)
      const meta = placeholderLayer?.genMeta || {}
      let refUrls = meta.referenceImageUrls
      if (Array.isArray(refUrls) && refUrls.length) {
        // 转存为 OSS 永久 URL，防止签名过期后历史缩略图裂图（与原聊天流程行为一致）
        refUrls = await Promise.all(refUrls.map((u) => persistToOss(u)))
      } else {
        refUrls = Array.isArray(refUrls) ? refUrls : []
      }
      recordGenerationToHistory({
        id: `gen-${Date.now()}`,
        prompt: meta.prompt || placeholderLayer?.prompt || prompt || '',
        model: meta.model || '',
        ratio: meta.ratio || '',
        resolution: meta.resolution || '',
        imageUrl: url,
        referenceImageUrls: refUrls,
        createdAt: Date.now(),
      })
      if (assistantId) {
        updateChatMessage(assistantId, {
          text: '生成完成，已添加到画布。',
          imageUrl: url,
          generating: false,
        })
      }
      return true
    }
  }

  throw new Error('轮询超时，任务仍未完成')
}

// 刷新/导航后恢复被中断（processing/interrupted）的生图任务轮询。
// 无聊天消息上下文（assistantId 为空），仅更新占位图层状态，成功则替换图片。
// 防止同一个 taskId 被并发重复轮询（恢复扫描可能被 onMounted / 图层监听多次触发，
// 或刷新恢复与本地生图轮询同时发生）。所有生图轮询统一走这里，保证幂等。
const _pollingTasks = new Set()
async function startImagePoll(taskId, placeholderId, assistantId, prompt = '') {
  if (!taskId || !placeholderId) return false
  if (_pollingTasks.has(taskId)) return false // 已在轮询中，幂等复用，不重复起轮询
  _pollingTasks.add(taskId)
  try {
    return await pollImageTaskUntilDone(taskId, placeholderId, assistantId, prompt)
  } finally {
    _pollingTasks.delete(taskId)
  }
}

async function resumeImageTaskPolling(taskId, placeholderId) {
  if (!taskId || !placeholderId) return
  const placeholder = layers.value.find((l) => l.id === placeholderId)
  const prompt = placeholder?.prompt || ''
  try {
    // 先切回 processing，给用户明确的“恢复中”反馈（interrupted/persisting 都不是终态）
    updateGeneratingPlaceholder(placeholderId, {
      progress: Math.max(1, placeholder?.progress || 1),
      status: 'processing',
      statusText: '生成任务恢复中...',
      taskId,
    })
    await startImagePoll(taskId, placeholderId, placeholder?.chatMessageId || '', prompt)
  } catch (error) {
    const friendly = friendlyImageError(error.message || error)
    // 恢复轮询进行中页面被刷新/导航中断：不标 failed，保持 processing 让 onMounted 下一轮自然接管
    const isInterruption =
      error?.name === 'AbortError' ||
      (error?.name === 'TypeError' && !_mounted.value) ||
      (error?.message === 'Failed to fetch' && !_mounted.value)
    if (!isInterruption) {
      // 轻量 UX 安全网：恢复失败（任务已不存在/轮询报错）时给出明确可操作的文案，
      // 而不是留下一个无声转圈的死卡。
      updateGeneratingPlaceholder(placeholderId, {
        progress: 1,
        status: 'failed',
        statusText: '恢复失败，请重试',
      })
    }
  }
}

// 刷新/恢复后扫描所有「非终态的占位图层」并重启生图。
// 与具体状态词解耦：凡是 type==='placeholder' 且非 completed/failed 的，一律恢复，
// 覆盖「纯生成中刷新」(APIMart 的 IN_PROGRESS/PENDING/GENERATING、中转站代理自有词等) 这种原本匹配不上的 case。
// 两种情况：
//   - 带 taskId：直接恢复轮询（resumeImageTaskPolling）
//   - 无 taskId（提交阶段就被刷新中断）：重新提交任务（resumeInterruptedNoTaskId）
// 配合 startImagePoll 的 taskId 守卫 + _pollingTasks 的 layer.id 占位，可安全被多次调用（幂等）。
function resumeInterruptedPlaceholders() {
  // sendChat 执行期间完全跳过：否则 addChatMessages/addGeneratingPlaceholderLayer
  // 触发的 layers 变化会让 watch 把"还没拿到 taskId 的新占位图"当"需恢复"的，
  // 抢先调 submitImageTask 导致重复提交（Console 可见 [submitImageTask] 并发提交被拦截）
  if (_sendChatActive) return
  const layersToResume = (doc.value?.payload?.layers || []).filter((layer) => {
    const s = normalizeStatus(layer.status)
    return (
      layer.type === 'placeholder' &&
      !isTaskDone(s) &&
      !isTaskFailed(s) &&
      !_pollingTasks.has(layer.taskId || layer.id) && // 已在轮询/恢复中的不重复处理，避免重复改状态触发监听回环
      !_submittingPlaceholderIds.has(layer.id) // 正在主提交流程(sendChat)中的占位图，由 sendChat 自己处理，恢复逻辑不要抢
    )
  })
  for (const layer of layersToResume) {
    if (layer.taskId) {
      resumeImageTaskPolling(layer.taskId, layer.id)
    } else {
      // 提交阶段就被刷新中断（占位图已落库但还没拿到 taskId）：重新提交任务
      resumeInterruptedNoTaskId(layer)
    }
  }
}

// 刷新/恢复时，对「从未拿到 taskId 却已 failed」的占位图做一次重试（仅 onMounted 调用，避免 watch 重扫死循环）。
// 这类占位图只可能来自：提交阶段就被刷新中断 / 原始提交即被后端拒绝（见 submitFail 分支）。
// 已拿到 taskId 的 failed 视为后端真实失败（任务本身挂了），不重试。
// 重试上限：后端真实拒绝按 resumeAttempts<3（避免后端持续 5xx 时每次刷新都无脑重提）；
//   网络瞬时失败(networkFailed) 不受上限约束，每次挂载都重试（后端只是当时不可达，恢复后理应续上）。
function retryFailedNoTaskPlaceholders() {
  const failed = (doc.value?.payload?.layers || []).filter((layer) => {
    const s = normalizeStatus(layer.status)
    const retryable = !!layer.networkFailed || Number(layer.resumeAttempts || 0) < 3
    return (
      layer.type === 'placeholder' &&
      isTaskFailed(s) &&
      !layer.taskId &&
      retryable &&
      !_pollingTasks.has(layer.id) &&
      !_submittingPlaceholderIds.has(layer.id)
    )
  })
  for (const layer of failed) {
    resumeInterruptedNoTaskId(layer)
  }
}

// 提交阶段被刷新中断的占位图：无 taskId，需重新向后端提交生图任务，再接轮询。
// 用 layer.id 占 _pollingTasks 保证幂等（watch 重扫时不会重复提交），拿到 taskId 后提前占住 taskId，
// 并在 finally 释放。
async function resumeInterruptedNoTaskId(layer) {
  if (_pollingTasks.has(layer.id)) return
  _pollingTasks.add(layer.id)
  const prompt = layer.prompt || layer.genMeta?.prompt || ''
  const imageUrls = Array.isArray(layer.genMeta?.referenceImageUrls) ? layer.genMeta.referenceImageUrls : []
  // 客户端幂等键：优先顶层，回退 genMeta（刷新重提时原样带回后端命中已有任务）
  const clientTaskId = layer.clientTaskId || layer.genMeta?.clientTaskId || ''
  updateGeneratingPlaceholder(layer.id, { status: 'processing', statusText: '生成任务恢复中...' })
  // 核心修复：刷新时的「提交阶段中断」不应再 POST /create 重提生图。
  // 同一 clientTaskId 的任务极可能已被后端建好（仅前端刷新瞬间把响应弄丢了），
  // 先 GET 按 clientTaskId 查回已有 task_id，命中则直接续轮询、零重提；
  // 若首次查询时后端还在处理 POST 请求（任务尚未落库），等 3 秒后重试一次；
  // 仅两次都查不到（真·从未提交成功）才走下面的 POST /create 新建。
  if (clientTaskId) {
    let existingTaskId = await resolveImageTaskByClientId(clientTaskId)
    if (!existingTaskId) {
      // 首次查不到：后端可能还在处理原 POST（任务尚未落库），等 3 秒再查
      updateGeneratingPlaceholder(layer.id, { statusText: '正在查找已有任务...' })
      await new Promise((r) => setTimeout(r, 3000))
      existingTaskId = await resolveImageTaskByClientId(clientTaskId)
    }
    if (existingTaskId) {
      _pollingTasks.add(existingTaskId)
      updateGeneratingPlaceholder(layer.id, { taskId: existingTaskId, lastError: '', networkFailed: false })
      await startImagePoll(existingTaskId, layer.id, layer.chatMessageId || '', prompt)
      _pollingTasks.delete(layer.id)
      _pollingTasks.delete(existingTaskId)
      return
    }
  }
  // 真·从未提交成功（连已有任务都查不到）：才累计重试次数并 POST /create 新建
  // 累计重试次数并持久化，配合 retryFailedNoTaskPlaceholders 的 <3 上限，避免后端持续失败时每次刷新都无脑重提
  const attempts = Number(layer.resumeAttempts || 0) + 1
  updateGeneratingPlaceholder(layer.id, { resumeAttempts: attempts })
  let taskId = ''
  try {
    taskId = await submitImageTask({
      prompt,
      imageUrls,
      clientTaskId,
      model: layer.genMeta?.model,
      size: layer.genMeta?.ratio,
      resolution: layer.genMeta?.resolution,
    })
    _pollingTasks.add(taskId) // 提前占住，避免 watch 重扫重复拉起轮询
    // 成功拿到 taskId：清除上一次失败残留的报错/网络标记，避免陈旧 e 字段一直挂在图层上
    updateGeneratingPlaceholder(layer.id, { taskId, lastError: '', networkFailed: false })
    // 传 layer 上持久化的 chatMessageId（而非空字符串），让轮询完成时能更新聊天卡片文案。
    await startImagePoll(taskId, layer.id, layer.chatMessageId || '', prompt)
  } catch (error) {
    const lastError = `[resumeSubmitFail] ${error?.name || 'Error'}: ${error?.message || error}`
    // 区分「网络层瞬时错误」与「后端明确拒绝」：
    // fetch 本身没拿到响应 → TypeError: Failed to fetch / AbortError，属网络瞬断（代理未就绪/刷新瞬间瞬断），不应永久判死；
    // readApiResponse 抛的 Error（code!==0 / 无 task_id）→ 后端真拒绝，才计入重试上限。
    const isNetworkError =
      error?.name === 'AbortError' ||
      (error?.name === 'TypeError' && /Failed to fetch|NetworkError|network/i.test(error?.message || ''))
    if (isNetworkError) {
      // 标记 failed + networkFailed：由 retryFailedNoTaskPlaceholders 在下次挂载重试；
      // resumeAttempts 归零（不计入后端失败上限），且 failed 不会触发 watch 重扫，避免同挂载内死循环。
      updateGeneratingPlaceholder(layer.id, {
        progress: 1,
        status: 'failed',
        statusText: '网络中断，刷新后自动重试',
        lastError,
        networkFailed: true,
        resumeAttempts: 0,
      })
    } else {
      const friendly = friendlyImageError(error.message || error)
      updateGeneratingPlaceholder(layer.id, {
        progress: 1,
        status: 'failed',
        statusText: friendly,
        lastError,
      })
    }
  } finally {
    _pollingTasks.delete(layer.id)
    if (taskId) _pollingTasks.delete(taskId)
  }
}

// 清理「彻底死亡」的僵尸占位图：已无法恢复、不会重试、只会污染画布的残留 placeholder。
// 本函数在 resumeInterruptedPlaceholders / retryFailedNoTaskPlaceholders 之后调用，
// 能恢复的重试都已拉起（_pollingTasks 有记录），剩下的就是真尸体。
// 清理条件（同时满足）：
//   1) type === 'placeholder'
//   2) 不在 _pollingTasks 中（未被恢复/重试函数占住）
//   3) 无 taskId（有 taskId 的交给 pollImageTaskUntilDone 自身处理；completed 的会被替换为 image）
//   4) status 非 processing（正在生成中的绝不碰）
//
// 覆盖所有逃逸僵尸类型：
//   - interrupted + 无taskId（刷新中断后从未成功提交的）← 之前三不管！
//   - 空/undefined status + 无taskId（状态丢失的残留）← 之前三不管！
//   - failed + 有taskId（后端真实失败，不会重试）
//   - failed + 无taskId + 重试耗尽（本地重试也放弃的）
function cleanupDeadPlaceholders() {
  const deadIds = []
  const allLayers = doc.value?.payload?.layers || []
  for (const layer of allLayers) {
    if (layer.type !== 'placeholder') continue
    // 正在被恢复或重试的不动（避免竞态删除）
    if (_pollingTasks.has(layer.taskId || layer.id)) continue
    // 有 taskId 且正在处理中 → 让轮询自己收尾
    if (layer.taskId) {
      const s = normalizeStatus(layer.status)
      if (s === 'processing' || s === 'completed') continue
    }
    // 剩余全部视为死尸：无taskId的非processing / 有taskId的终态失败
    deadIds.push(layer.id)
  }
  if (deadIds.length === 0) return
  canvas.updateDocument(props.id, (draft) => {
    const alive = draft.payload.layers.filter((l) => !deadIds.includes(l.id))
    draft.payload.layers = alive.length > 0 ? alive : []
    return draft
  })
}

// 终极兜底：暴力清除所有「无图」占位图层。
// 条件只有一条：type === 'placeholder' && !layer.url（没有有效图片内容）。
// 不管它是什么状态、有没有 taskId、重试了几次、是否 interrupted ——
// 没有图 = 用户看不到 = 但占着 DOM 拦截鼠标 = 必须清除。
// 正在轮询恢复中的除外（_pollingTasks 有记录），避免杀掉正在生成的。
function purgeEmptyUrlPlaceholders() {
  const deadIds = []
  const allLayers = doc.value?.payload?.layers || []
  for (const layer of allLayers) {
    if (layer.type !== 'placeholder') continue
    if (layer.url) continue // 有图的（失败卡片/预览图/生成中缩略图）保留
    if (_pollingTasks.has(layer.taskId || layer.id)) continue // 正在恢复的不动
    deadIds.push(layer.id)
  }
  if (deadIds.length === 0) return
  canvas.updateDocument(props.id, (draft) => {
    draft.payload.layers = draft.payload.layers.filter((l) => !deadIds.includes(l.id))
    return draft
  })
}

// 服务端 doc 合并（syncFromServer）可能在 onMounted 恢复扫描之后异步覆盖本地图层，
// 导致已扫描出来的占位层被替换掉、而恢复逻辑不会重跑。这里对图层列表做幂等重扫，
// 配合 startImagePoll 的 taskId 守卫，确保恢复不漏、也不重复起轮询。
// 但必须跳过「正在主提交流程(sendChat)中、尚未拿到 taskId 的占位图」，
// 否则 watch 触发时会把刚创建的占位图当作"需要恢复"的，重复调 submitImageTask。
const _submittingPlaceholderIds = new Set()
watch(() => doc.value?.payload?.layers, resumeInterruptedPlaceholders)

function firstUrl(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = firstUrl(item)
      if (url) return url
    }
  }
  if (typeof value === 'object') {
    return (
      firstUrl(value.url) ||
      firstUrl(value.imageUrl) ||
      firstUrl(value.image_url) ||
      firstUrl(value.src)
    )
  }
  return ''
}

function extractTaskImageUrl(status) {
  const payload = status?.data || status
  const direct =
    firstUrl(payload?.imageUrls) || firstUrl(payload?.image_urls) || firstUrl(payload?.images)
  if (direct) return direct
  const rawImages = payload?.raw?.data?.result?.images
  if (Array.isArray(rawImages)) {
    for (const image of rawImages) {
      const url = firstUrl(image?.url) || firstUrl(image?.urls) || firstUrl(image?.image_url)
      if (url) return url
    }
  }
  return firstUrl(payload?.raw?.data?.url) || firstUrl(payload?.raw?.data?.imageUrl)
}

function normalizeProgress(value, fallback = 6) {
  const progress = Number(value)
  if (!Number.isFinite(progress)) return fallback
  return Math.max(1, Math.min(100, Math.round(progress)))
}

function placeholderStatusText(progress, status = '') {
  if (status === 'interrupted') return '生成任务恢复中...'
  if (status === 'persisting') return '生成完成，正在转存到云存储...'
  if (isTaskFailed(status)) return '生成失败，请重试或调整提示词。'
  if (progress >= 92) return PLACEHOLDER_STATUS_TEXTS[3]
  if (progress >= 62) return PLACEHOLDER_STATUS_TEXTS[2]
  if (progress >= 24) return PLACEHOLDER_STATUS_TEXTS[1]
  return PLACEHOLDER_STATUS_TEXTS[0]
}

// 把生图失败的后端/上游原始报错翻译成用户可懂的中文提示
function friendlyImageError(raw) {
  const msg = String(raw || '').trim()
  if (!msg) return '生图失败，请稍后重试'
  const lower = msg.toLowerCase()
  // prompt 过长（兼容后端已清洗的「提示词过长」与未清洗的 ModelArts 原始报文）
  if (lower.includes('提示词过长') || lower.includes('prompt length')) {
    const m = msg.match(/(\d[\d,]*)\D*?(\d[\d,]*)/)
    if (lower.includes('提示词过长') && m) {
      return `提示词过长（约 ${m[1]} 字，模型上限约 ${m[2]} 字），请精简描述或拆分为多次生成后重试。`
    }
    return '提示词过长，请精简描述或拆分为多次生成后重试。'
  }
  if (lower.includes('exceed') || lower.includes('too long') || lower.includes('maximum input length')) {
    return '提示词过长，请精简描述或拆分为多次生成后重试。'
  }
  if (lower.includes('not configured') || lower.includes('api key')) {
    return '生图服务未配置密钥，请联系管理员。'
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return '生图服务响应超时，请稍后重试。'
  }
  if (lower.includes('rate') || lower.includes('ratelimit') || lower.includes('429') || lower.includes('too many')) {
    return '生图请求过于频繁，请稍候再试。'
  }
  // 兜底：剥掉 "XXX request failed: 4xx " 这类内部前缀，尽量保留可读信息
  const cleaned = msg.replace(/^[^:：]+request failed:\s*\d+\s*/i, '').trim()
  if (cleaned && cleaned.length < 120 && !/^[A-Za-z0-9_.-]+$/.test(cleaned)) {
    return '生图失败：' + cleaned
  }
  return '生图失败，请稍后重试或调整提示词。'
}

function updateChatMessage(messageId, patch) {
  canvas.updateDocument(props.id, (draft) => {
    draft.payload.chat = draft.payload.chat || []
    draft.payload.chat = draft.payload.chat.map((message) =>
      message.id === messageId ? { ...message, ...patch } : message,
    )
    return draft
  })
}

function addChatMessages(messages) {
  canvas.updateDocument(props.id, (draft) => {
    draft.payload.chat = draft.payload.chat || []
    draft.payload.chat.push(...messages)
    return draft
  })
  scrollChatToBottom()
}

function scrollChatToBottom() {
  nextTick(() => {
    const el = chatHistoryRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

async function addImageLayerFromUrl(url, name = 'AI生成图片', detectPrompt = '') {
  try {
    // 后端已在异步持久化完成后返回永久 OSS URL，此处不再二次转存（去掉 30s 自杀式 abort）
    const size = await imageSize(url)
    let layerId = ''
    canvas.updateDocument(props.id, (draft) => {
      const index = draft.payload.layers.length
      const maxZ = draft.payload.layers.reduce((max, layer) => Math.max(max, layer.zIndex || 0), 0)
      const base = selectedLayer.value
      const width = size.width > size.height ? CANVAS_IMAGE_WIDTH : CANVAS_IMAGE_WIDTH
      const fallbackX = Math.round(((panel.x ?? 0) + 180 - viewOffset.value.x) / viewScale.value)
      const fallbackY = Math.round((170 - viewOffset.value.y) / viewScale.value)
      const layer = {
        id: `layer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: layerName(index),
        url,
        thumbnailUrl: url,
        naturalWidth: size.width,
        naturalHeight: size.height,
        width,
        height: Math.round((width * size.height) / size.width),
        x: base ? base.x + Math.min(420, base.width + 60) : fallbackX,
        y: base ? base.y + 30 : fallbackY,
        zIndex: maxZ + 1,
        visible: true,
        locked: false,
        source: name,
        detectPrompt: detectPrompt || undefined,
      }
      layerId = layer.id
      draft.payload.layers.push(layer)
      return draft
    })
    selectedLayerId.value = layerId
    selectedLayerIds.value = [layerId]
    return layerId
  } catch (error) {
    console.error('[addImageLayerFromUrl] 添加图片图层失败:', error)
    window.alert('添加图片图层失败: ' + (error.message || '未知错误'))
    return ''
  }
}

// ========== 图片复制 / 粘贴 ==========
// 判断是否为真实图片图层（有 url 且非占位 / 文本 / 视频类型）
function isRealImageLayer(layer) {
  if (!layer) return false
  if (!layer.url) return false
  const fakeTypes = ['placeholder', 'text', 'image-placeholder', 'video']
  if (fakeTypes.includes(layer.type)) return false
  return true
}

// 轻量 toast（复制 / 粘贴反馈），独立 id 不覆盖下载 toast
function showCopyPasteToast(msg) {
  const id = 'copypaste-toast'
  const existing = document.getElementById(id)
  if (existing) existing.remove()
  const el = document.createElement('div')
  el.id = id
  el.textContent = msg
  Object.assign(el.style, {
    position: 'fixed',
    top: '24px',
    right: '24px',
    zIndex: '99999',
    background: 'rgba(0,0,0,0.78)',
    color: '#fff',
    padding: '10px 20px',
    borderRadius: '8px',
    fontSize: '14px',
    transition: 'opacity 0.3s',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
  })
  document.body.appendChild(el)
  setTimeout(() => {
    el.style.opacity = '0'
    setTimeout(() => el.remove(), 400)
  }, 2000)
}

// 将图片 url 转为二进制 blob：优先 fetch(CORS)，失败用 canvas 兜底
async function fetchImageBlob(url) {
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (res.ok) return await res.blob()
  } catch (e) {
    // 降级到 canvas 方案
  }
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = url
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = () => reject(new Error('image load failed'))
    })
    const canvasEl = document.createElement('canvas')
    canvasEl.width = img.naturalWidth || 1
    canvasEl.height = img.naturalHeight || 1
    const ctx = canvasEl.getContext('2d')
    ctx.drawImage(img, 0, 0)
    return await new Promise((resolve) => canvasEl.toBlob(resolve, 'image/png'))
  } catch (e) {
    return null
  }
}

// 复制：先写内部 buffer（保底），再尝试写入系统剪贴板（可静默失败）
async function copySelectedImage() {
  const layer = selectedLayer.value
  if (!isRealImageLayer(layer)) {
    showCopyPasteToast('请选择图片图层再复制')
    return
  }
  // 深拷贝智能分层元素框，粘贴时一并携带
  const sourceElements = layerDetectedElements.value[layer.id] || []
  clipboardImage.value = {
    url: layer.url,
    type: layer.type,
    name: layer.name,
    width: layer.width,
    height: layer.height,
    naturalWidth: layer.naturalWidth,
    naturalHeight: layer.naturalHeight,
    thumbnailUrl: layer.thumbnailUrl,
    zIndex: layer.zIndex,
    x: layer.x,
    y: layer.y,
    elements: JSON.parse(JSON.stringify(sourceElements)),
  }
  showCopyPasteToast('已复制图片')
  // 系统剪贴板增强（可选，失败静默降级，不影响内部 buffer）
  try {
    const blob = await fetchImageBlob(layer.url)
    if (blob) {
      const type = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/png'
      if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ [type]: blob })])
      }
    }
  } catch (e) {
    // 静默失败
  }
}

// 粘贴：内部 buffer 优先（复制图层，携带元素框 + 同层级 + 不自动分层）
//       系统剪贴板图片降级（外部图片，如截图）
async function pasteImage() {
  // 1. 内部 buffer 优先：复制的是画布图层 → 携带智能分层元素框，保持同层级，不自动智能分层
  if (clipboardImage.value) {
    try {
      await pasteLayerFromBuffer(clipboardImage.value)
    } catch (e) {
      console.error('[pasteImage] 粘贴图层失败:', e)
    }
    return
  }
  // 2. 系统剪贴板图片（外部图片，如截图）→ 普通粘贴并允许自动分层
  try {
    if (navigator.clipboard && navigator.clipboard.read && window.ClipboardItem) {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        const imageType = (item.types || []).find((t) => String(t).startsWith('image/'))
        if (imageType) {
          const blob = await item.getType(imageType)
          const file = new File([blob], 'pasted.png', { type: imageType })
          const url = await uploadFileDirect(file)
          await addImageLayerFromUrl(url, '粘贴图片')
          return
        }
      }
    }
  } catch (e) {
    // 静默降级
  }
  // 3. 无内容可粘贴
}

// 从内部 buffer 粘贴图层：携带智能分层元素框，与原始图层同层级，且不再自动智能分层
async function pasteLayerFromBuffer(buffer) {
  if (!buffer || !buffer.url) return
  const newId = `layer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const els = Array.isArray(buffer.elements) ? JSON.parse(JSON.stringify(buffer.elements)) : []
  // 关键：先写入元素框（在 watch 触发自动检测前已存在 → watch 会跳过自动分层）
  if (els.length) {
    layerDetectedElements.value = { ...layerDetectedElements.value, [newId]: els }
  }
  canvas.updateDocument(props.id, (draft) => {
    const index = draft.payload.layers.length
    const layer = {
      id: newId,
      name: layerName(index),
      url: buffer.url,
      thumbnailUrl: buffer.thumbnailUrl || buffer.url,
      naturalWidth: buffer.naturalWidth,
      naturalHeight: buffer.naturalHeight,
      width: buffer.width,
      height: buffer.height,
      x: (buffer.x ?? 0) + 30,
      y: (buffer.y ?? 0) + 30,
      zIndex: buffer.zIndex ?? 1,
      visible: true,
      locked: false,
      source: '复制图层',
    }
    draft.payload.layers.push(layer)
    if (els.length) {
      draft.payload.detectedElements = draft.payload.detectedElements || {}
      draft.payload.detectedElements[newId] = els
    }
    return draft
  })
  selectedLayerId.value = newId
  selectedLayerIds.value = [newId]
  showCopyPasteToast(els.length ? `已粘贴图层（含 ${els.length} 个分层元素）` : '已粘贴图层')
}

async function addGeneratingPlaceholderLayer(prompt, genMeta = {}, chatMessageId = '') {
  pushUndo()
  const referenceImages = chatReferenceImages.value.filter(
    (image) => !image.uploading && !image.error,
  )
  const selected = selectedLayer.value
  const base =
    selected?.type === 'placeholder'
      ? [...layers.value].reverse().find((l) => l.type !== 'placeholder')
      : selected
  const previewUrl = referenceImages.at(-1)?.url || base?.url || ''
  let layerId = ''

  // 占位框大小：与参考图/选中图的长宽比一致
  // 优先用参考图的尺寸，其次用选中图的尺寸，最后默认 3:4
  const refImg = referenceImages.at(-1)
  const aspectSrc = refImg
    ? { w: refImg.naturalWidth || refImg.width || 3, h: refImg.naturalHeight || refImg.height || 4 }
    : base
      ? { w: base.naturalWidth || base.width || 3, h: base.naturalHeight || base.height || 4 }
      : { w: 3, h: 4 }
  const aspectRatio = aspectSrc.w / aspectSrc.h
  const placeholderHeight = Math.round(PLACEHOLDER_WIDTH / aspectRatio)

  canvas.updateDocument(props.id, (draft) => {
    const index = draft.payload.layers.length
    const maxZ = draft.payload.layers.reduce((max, layer) => Math.max(max, layer.zIndex || 0), 0)
    // 视口中心的世界坐标 = (viewportSize/2 - viewOffset) / viewScale
    const cx = (viewportSize.width / 2 - viewOffset.value.x) / viewScale.value
    const cy = (viewportSize.height / 2 - viewOffset.value.y) / viewScale.value
    // 客户端幂等键：同一张生图稳定携带，刷新重提时后端按它命中已有任务、跳过重复扣费+外部调用。
    function genClientTaskId() {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
      return 'c-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10)
    }
    const clientTaskId = genClientTaskId()
    const layer = {
      id: `placeholder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'placeholder',
      name: layerName(index),
      prompt,
      // 客户端幂等键（顶层 + genMeta 各存一份：resume 时从 genMeta 取用，保险）
      clientTaskId,
      // 生成参数随占位图层持久化，供「刷新后恢复完成」路径（路径 B）也能造出完整历史记录。
      // 修复前创建的旧在途图层可能没有 genMeta，恢复时优雅降级（prompt 兜底，其余字段允许为空）。
      genMeta: {
        prompt,
        clientTaskId,
        model: genMeta.model || '',
        ratio: genMeta.ratio || '',
        resolution: genMeta.resolution || '',
        referenceImageUrls: Array.isArray(genMeta.referenceImageUrls) ? genMeta.referenceImageUrls : [],
      },
      // 关联的聊天消息 id：刷新后恢复轮询完成时用来更新聊天卡片文案（否则 assistantId 为空，
      // pollImageTaskUntilDone 会跳过所有 chatMessage 更新，卡片永远停在"正在恢复..."）。
      chatMessageId,
      progress: 6,
      status: 'submitted',
      statusText: placeholderStatusText(6),
      url: '',
      thumbnailUrl: previewUrl,
      previewUrl,
      naturalWidth: PLACEHOLDER_WIDTH,
      naturalHeight: placeholderHeight,
      width: PLACEHOLDER_WIDTH,
      height: placeholderHeight,
      x: base ? base.x + base.width + 40 : cx - PLACEHOLDER_WIDTH / 2,
      y: base ? base.y : cy - placeholderHeight / 2,
      zIndex: maxZ + 1,
      visible: true,
      locked: false,
    }
    layerId = layer.id
    draft.payload.layers.push(layer)
    return draft
  })

  selectedLayerId.value = layerId
  selectedLayerIds.value = [layerId]
  // 占位图创建后立即同步服务器（await 确保到达），确保刷新后服务器返回的数据里已有占位图层
  await canvas.flushNow?.()
  return layerId
}

function updateGeneratingPlaceholder(layerId, patch) {
  const nextPatch = { ...patch }
  if (patch.progress !== undefined) {
    nextPatch.progress = normalizeProgress(patch.progress)
  }
  nextPatch.statusText =
    patch.statusText || placeholderStatusText(normalizeProgress(patch.progress, 6), patch.status)
  updateLayer(layerId, nextPatch)
}

async function replaceGeneratingPlaceholder(layerId, url, skipAutoDetect = false) {
  pushUndo()
  try {
    const size = await imageSize(url)
    let replaced = false
    canvas.updateDocument(props.id, (draft) => {
      const index = draft.payload.layers.findIndex((layer) => layer.id === layerId)
      if (index === -1) return draft
      const placeholder = draft.payload.layers[index]
      const width =
        placeholder.width || (size.width > size.height ? CANVAS_IMAGE_WIDTH : CANVAS_IMAGE_WIDTH)
      const height = Math.round((width * size.height) / size.width)
      // 保留占位图被拖动后的当前位置（用户可能已调整位置）
      draft.payload.layers[index] = {
        ...placeholder,
        type: 'image',
        url,
        thumbnailUrl: url,
        naturalWidth: size.width,
        naturalHeight: size.height,
        width,
        height,
        x: placeholder.x,
        y: placeholder.y,
        progress: undefined,
        status: undefined,
        statusText: undefined,
        previewUrl: undefined,
        source: 'AI生成图片',
      }
      replaced = true
      return draft
    })

    if (!replaced) return addImageLayerFromUrl(url)
    selectedLayerId.value = layerId
    selectedLayerIds.value = [layerId]
    // 生图完成后自动检测元素（买家秀跳过）
    const newLayer = layers.value.find((l) => l.id === layerId)
    if (newLayer && !skipAutoDetect) nextTick(() => maybeAutoDetect(newLayer))
    return layerId
  } catch (error) {
    console.error('[replaceGeneratingPlaceholder] 替换占位图层失败:', error)
    updateLayer(layerId, {
      progress: 1,
      status: 'failed',
      statusText: `渲染失败：${friendlyImageError(error.message || '未知错误')}`,
    })
    return ''
  }
}

function openImageUpload(mode = 'canvas') {
  if (!userStore.requireLogin()) return
  fileInputMode.value = mode
  addOpen.value = false
  fileInput.value?.click()
}

// 添加文字节点（直接在画布上创建可编辑文字图层）
// 添加文字节点（v4 风格：440×320，透明背景，#f5f5f5 文本区 + 提示词标签）
function addTextNode() {
  if (!userStore.requireLogin()) return
  pushUndo()
  let layerId = ''
  canvas.updateDocument(props.id, (draft) => {
    const index = draft.payload.layers.length
    const maxZ = draft.payload.layers.reduce((max, layer) => Math.max(max, layer.zIndex || 0), 0)
    const base = selectedLayer.value
    const fallbackX = Math.round(((panel.x ?? 0) + 180 - viewOffset.value.x) / viewScale.value)
    const fallbackY = Math.round((170 - viewOffset.value.y) / viewScale.value)
    const layer = {
      id: `layer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: layerName(index),
      type: 'text',
      text: '',
      color: '#999999',
      fontSize: 14,
      fontWeight: 400,
      align: 'left',
      width: 440,
      height: 320,
      x: base ? base.x + 30 : fallbackX,
      y: base ? base.y + 30 : fallbackY,
      zIndex: maxZ + 1,
      visible: true,
      locked: false,
    }
    layerId = layer.id
    draft.payload.layers.push(layer)
    return draft
  })
  selectedLayerId.value = layerId
  selectedLayerIds.value = [layerId]
  activeTool.value = 'select'
}

// 添加视频节点（v4 风格：占位态，双击上传视频）
function addVideoNode() {
  if (!userStore.requireLogin()) return
  pushUndo()
  let layerId = ''
  canvas.updateDocument(props.id, (draft) => {
    const index = draft.payload.layers.length
    const maxZ = draft.payload.layers.reduce((max, layer) => Math.max(max, layer.zIndex || 0), 0)
    const base = selectedLayer.value
    const fallbackX = Math.round(((panel.x ?? 0) + 180 - viewOffset.value.x) / viewScale.value)
    const fallbackY = Math.round((170 - viewOffset.value.y) / viewScale.value)
    const layer = {
      id: `layer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: layerName(index),
      type: 'video',
      url: '',
      thumbnailUrl: '',
      width: CANVAS_IMAGE_WIDTH,
      height: Math.round((CANVAS_IMAGE_WIDTH * 9) / 16),
      x: base ? base.x + 30 : fallbackX,
      y: base ? base.y + 30 : fallbackY,
      zIndex: maxZ + 1,
      visible: true,
      locked: false,
    }
    layerId = layer.id
    draft.payload.layers.push(layer)
    return draft
  })
  selectedLayerId.value = layerId
  selectedLayerIds.value = [layerId]
  activeTool.value = 'select'
}

// 添加图片节点（v4 风格：占位态，双击上传图片）
function addImageNode() {
  if (!userStore.requireLogin()) return
  pushUndo()
  let layerId = ''
  canvas.updateDocument(props.id, (draft) => {
    const index = draft.payload.layers.length
    const maxZ = draft.payload.layers.reduce((max, layer) => Math.max(max, layer.zIndex || 0), 0)
    const base = selectedLayer.value
    const fallbackX = Math.round(((panel.x ?? 0) + 180 - viewOffset.value.x) / viewScale.value)
    const fallbackY = Math.round((170 - viewOffset.value.y) / viewScale.value)
    const layer = {
      id: `layer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: layerName(index),
      type: 'image-placeholder',
      url: '',
      width: 200,
      height: 200,
      x: base ? base.x + 30 : fallbackX,
      y: base ? base.y + 30 : fallbackY,
      zIndex: maxZ + 1,
      visible: true,
      locked: false,
    }
    layerId = layer.id
    draft.payload.layers.push(layer)
    return draft
  })
  selectedLayerId.value = layerId
  selectedLayerIds.value = [layerId]
  activeTool.value = 'select'
}

// 双击上传图片/视频 → 替换占位节点为真实内容
function uploadNodeMedia(layer) {
  const input = document.createElement('input')
  input.type = 'file'
  if (layer.type === 'video') {
    input.accept = 'video/*'
  } else {
    input.accept = 'image/*'
  }
  input.onchange = async (ev) => {
    const file = ev.target.files?.[0]
    if (!file) return
    pushUndo()
    // 读取为 data URL 临时显示
    const reader = new FileReader()
    reader.onload = async (event) => {
      const dataUrl = event.target.result
      if (layer.type === 'video') {
        // 视频：获取尺寸后自适应
        try {
          const size = await videoSize(dataUrl)
          const width = CANVAS_IMAGE_WIDTH
          updateLayer(layer.id, {
            url: dataUrl,
            type: 'video',
            naturalWidth: size.width,
            naturalHeight: size.height,
            width,
            height: Math.round((width * size.height) / size.width),
          })
        } catch {
          updateLayer(layer.id, {
            url: dataUrl,
            type: 'video',
            width: CANVAS_IMAGE_WIDTH,
            height: Math.round((CANVAS_IMAGE_WIDTH * 9) / 16),
          })
        }
      } else {
        // 图片：获取尺寸后自适应
        try {
          const size = await imageSize(dataUrl)
          const width = size.width > size.height ? CANVAS_IMAGE_WIDTH : CANVAS_IMAGE_WIDTH
          updateLayer(layer.id, {
            url: dataUrl,
            type: 'image',
            naturalWidth: size.width,
            naturalHeight: size.height,
            width,
            height: Math.round((width * size.height) / size.width),
          })
        } catch {
          updateLayer(layer.id, {
            url: dataUrl,
            type: 'image',
            width: CANVAS_IMAGE_WIDTH,
            height: CANVAS_IMAGE_WIDTH,
          })
        }
      }
      // 上传完成后自动智能分层
      await nextTick()
      const updatedLayer = layers.value.find((l) => l.id === layer.id)
      if (updatedLayer) maybeAutoDetect(updatedLayer)
    }
    reader.readAsDataURL(file)
  }
  input.click()
}

// 双击编辑文本节点
const editingTextLayerId = ref(null)
const editingTextValue = ref('')

// 图片查看器状态
const imageViewer = reactive({
  show: false,
  url: '',
  name: '',
  rotation: 0, // 旋转角度（实际度数，不取模）
  flipX: false, // 左右镜像
  flipY: false, // 上下镜像
  scale: 1, // 缩放
  translateX: 0, // 水平拖动偏移
  translateY: 0, // 垂直拖动偏移
  isDragging: false,
  dragStartX: 0,
  dragStartY: 0,
  dragStartTranslateX: 0,
  dragStartTranslateY: 0,
  // 多图切换
  images: [], // [{url, name}]
  currentIndex: 0,
})
const imageViewerImgRef = ref(null)

// ========== 视频查看器 ==========
const videoViewer = reactive({
  show: false,
  url: '',
  name: '',
  playing: false,
  muted: true,
  volume: 0.8, // 0~1
  currentTime: 0, // 秒
  duration: 0, // 秒
  playbackRate: 1, // 播放速度
  isSeeking: false,
  showControls: true,
  _controlsTimer: null,
})
const videoViewerRef = ref(null) // video DOM

function openVideoViewer(url, name) {
  videoViewer.show = true
  videoViewer.url = url
  videoViewer.name = name || '视频'
  videoViewer.playing = false
  videoViewer.muted = true
  videoViewer.volume = 0.8
  videoViewer.currentTime = 0
  videoViewer.duration = 0
  videoViewer.playbackRate = 1
  videoViewer.isSeeking = false
  videoViewer.showControls = true
  nextTick(() => {
    const v = videoViewerRef.value
    if (v) {
      v.volume = videoViewer.volume
      v.muted = videoViewer.muted
      v.playbackRate = videoViewer.playbackRate
    }
  })
}

function closeVideoViewer() {
  const v = videoViewerRef.value
  if (v && !v.paused) v.pause()
  videoViewer.show = false
  videoViewer.url = ''
  clearTimeout(videoViewer._controlsTimer)
}

function toggleVideoViewerPlay() {
  const v = videoViewerRef.value
  if (!v) return
  if (v.paused) {
    v.play().catch(() => {})
  } else {
    v.pause()
  }
}

function onVideoViewerPlay() {
  videoViewer.playing = true
}
function onVideoViewerPause() {
  videoViewer.playing = false
}
function onVideoViewerTimeUpdate() {
  const v = videoViewerRef.value
  if (!v || videoViewer.isSeeking) return
  videoViewer.currentTime = v.currentTime
}
function onVideoViewerDurationChange() {
  const v = videoViewerRef.value
  if (v) videoViewer.duration = v.duration || 0
}
function onVideoViewerEnded() {
  videoViewer.playing = false
  videoViewer.currentTime = 0
}

// 进度条 seek
function onVideoSeekStart() {
  videoViewer.isSeeking = true
}
function onVideoSeekEnd() {
  videoViewer.isSeeking = false
}
function onVideoSeekInput(e) {
  const v = videoViewerRef.value
  if (!v) return
  const val = parseFloat(e.target.value)
  v.currentTime = val
  videoViewer.currentTime = val
}

// 音量
function onVideoVolumeInput(e) {
  const v = videoViewerRef.value
  const vol = parseFloat(e.target.value)
  videoViewer.volume = vol
  if (v) v.volume = vol
  if (vol > 0 && videoViewer.muted) {
    videoViewer.muted = false
    if (v) v.muted = false
  }
}
function toggleVideoMute() {
  const v = videoViewerRef.value
  videoViewer.muted = !videoViewer.muted
  if (v) v.muted = videoViewer.muted
}

// 播放速度
const playbackRates = [0.5, 0.75, 1, 1.25, 1.5, 2]
function setPlaybackRate(rate) {
  const v = videoViewerRef.value
  videoViewer.playbackRate = rate
  if (v) v.playbackRate = rate
}

// 全屏
function toggleVideoFullscreen() {
  const container = document.querySelector('.uc-video-viewer-container')
  if (!container) return
  if (document.fullscreenElement) {
    document.exitFullscreen()
  } else {
    container.requestFullscreen().catch(() => {})
  }
}

// 格式化时间 mm:ss
function formatVideoTime(sec) {
  if (!sec || isNaN(sec)) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// 控制栏自动隐藏（播放3秒后淡出）
function showVideoControlsTemporarily() {
  videoViewer.showControls = true
  clearTimeout(videoViewer._controlsTimer)
  if (videoViewer.playing) {
    videoViewer._controlsTimer = setTimeout(() => {
      videoViewer.showControls = false
    }, 3000)
  }
}

// 打开图片查看器
function openImageViewer(url, name) {
  // 收集所有选中图层中的图片，支持多图切换
  const imageLayers = selectedLayerIds.value
    .map((id) => layers.value.find((l) => l.id === id))
    .filter((l) => l && l.url && (l.type === 'image' || (!l.type && l.url)))

  let images = []
  let currentIndex = 0

  if (imageLayers.length > 1) {
    // 多图模式：按画布上的位置排序（从左到右、从上到下）
    images = imageLayers
      .slice()
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((l) => ({ url: l.url, name: l.name || '图片' }))
    // 找到当前点击的图片在列表中的位置
    currentIndex = images.findIndex((img) => img.url === url)
    if (currentIndex < 0) currentIndex = 0
  } else {
    // 单图模式
    images = [{ url, name: name || '图片' }]
    currentIndex = 0
  }

  imageViewer.images = images
  imageViewer.currentIndex = currentIndex
  imageViewer.show = true
  imageViewer.url = images[currentIndex].url
  imageViewer.name = images[currentIndex].name
  imageViewer.rotation = 0
  imageViewer.flipX = false
  imageViewer.flipY = false
  imageViewer.scale = 1
  imageViewer.translateX = 0
  imageViewer.translateY = 0

  // 立即聚焦 overlay，确保键盘事件能被接收
  nextTick(() => {
    const overlay = document.querySelector('.uc-image-viewer-overlay')
    if (overlay) overlay.focus()
    applyViewerTransform()
  })
}

// 关闭图片查看器
function closeImageViewer() {
  cancelViewerTransformFrame()
  imageViewer.show = false
  imageViewer.url = ''
  imageViewer.images = []
  imageViewer.currentIndex = 0
}

// 多图切换：上一张 / 下一张
function switchImageViewer(dir) {
  const len = imageViewer.images.length
  if (len <= 1) return
  let next = imageViewer.currentIndex + dir
  if (next < 0) next = len - 1
  if (next >= len) next = 0
  imageViewer.currentIndex = next
  imageViewer.url = imageViewer.images[next].url
  imageViewer.name = imageViewer.images[next].name
  // 重置视图状态（旋转/缩放/偏移）
  imageViewer.rotation = 0
  imageViewer.flipX = false
  imageViewer.flipY = false
  imageViewer.scale = 1
  imageViewer.translateX = 0
  imageViewer.translateY = 0
  nextTick(() => applyViewerTransform())
}

// 旋转图片 — 直接累加，不取模，避免跨越0/360边界时动画反向
function rotateImage(deg) {
  imageViewer.rotation += deg
  applyViewerTransform()
}

// 镜像翻转
function flipImage(axis) {
  if (axis === 'x') imageViewer.flipX = !imageViewer.flipX
  else imageViewer.flipY = !imageViewer.flipY
  applyViewerTransform()
}

// 图片查看器 transform 字符串（拖拽直写 DOM 与缩放/旋转/翻转共用，保证一致）
function viewerImgTransform(
  translateX = imageViewer.translateX,
  translateY = imageViewer.translateY,
  scale = imageViewer.scale,
) {
  return `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale}) rotate(${imageViewer.rotation}deg) scaleX(${imageViewer.flipX ? -1 : 1}) scaleY(${imageViewer.flipY ? -1 : 1})`
}

// 直接把 transform 写到 img DOM（不经过 Vue 响应式 patch），缩放/旋转/翻转/拖拽统一走这里
function applyViewerTransform(
  translateX = imageViewer.translateX,
  translateY = imageViewer.translateY,
  scale = imageViewer.scale,
) {
  const img = imageViewerImgRef.value
  if (img) img.style.transform = viewerImgTransform(translateX, translateY, scale)
}

let _viewerTransformFrame = null
let _viewerPendingTransform = null
function queueViewerTransform(translateX, translateY, scale = imageViewer.scale) {
  _viewerPendingTransform = { translateX, translateY, scale }
  if (_viewerTransformFrame !== null) return
  _viewerTransformFrame = requestAnimationFrame(() => {
    _viewerTransformFrame = null
    const pending = _viewerPendingTransform
    _viewerPendingTransform = null
    if (pending) applyViewerTransform(pending.translateX, pending.translateY, pending.scale)
  })
}
function cancelViewerTransformFrame() {
  if (_viewerTransformFrame !== null) cancelAnimationFrame(_viewerTransformFrame)
  _viewerTransformFrame = null
  _viewerPendingTransform = null
}

// 缩放（按钮）
function zoomImage(delta) {
  imageViewer.scale = Math.max(0.25, Math.min(4, imageViewer.scale + delta))
  applyViewerTransform()
}

// 滚轮缩放
function handleViewerWheel(e) {
  const factor = e.deltaY > 0 ? 0.9 : 1.1
  imageViewer.scale = Math.max(0.25, Math.min(4, imageViewer.scale * factor))
  queueViewerTransform(imageViewer.translateX, imageViewer.translateY, imageViewer.scale)
}

// 拖拽基准：start 时记录起始偏移，move 中只算 delta，全程不写响应式状态 → 不触发 Vue 重渲染 → 零延迟跟手
let _dragBaseX = 0
let _dragBaseY = 0
let _dragImgEl = null
let _dragCaptureEl = null

// 开始拖动
function startViewerDrag(e) {
  if (e.button !== 0) return
  e.preventDefault() // 杀掉浏览器原生图片拖拽 ghost + 文本选区 + 手势，避免"能拖但不跟手"的残影
  imageViewer.isDragging = true
  imageViewer.dragStartX = e.clientX
  imageViewer.dragStartY = e.clientY
  _dragBaseX = imageViewer.translateX
  _dragBaseY = imageViewer.translateY
  // 指针捕获：放大后图片超出容器，鼠标移出边界仍能持续收到 pointermove，避免掉帧卡顿
  try {
    e.currentTarget.setPointerCapture(e.pointerId)
    _dragCaptureEl = e.currentTarget
  } catch (_) {}
  // 关掉 transition（!important 强制，任何 CSS 都压不过）→ 拖拽零延迟跟手
  try {
    const img = imageViewerImgRef.value
    if (img) {
      img.classList.add('is-dragging')
      img.style.setProperty('transition', 'none', 'important')
      _dragImgEl = img
    }
  } catch (_) {}
  // 用 window 级监听保证 move/up 全程不丢事件（不受 pointerleave/capture 边界影响）
  window.addEventListener('pointermove', moveViewerDrag)
  window.addEventListener('pointerup', stopViewerDrag)
  window.addEventListener('pointercancel', stopViewerDrag)
}

// 拖动中：只算 delta 直写 DOM，零响应式、零 Vue 重渲染、零延迟跟手
function moveViewerDrag(e) {
  if (!imageViewer.isDragging) return
  const dx = e.clientX - imageViewer.dragStartX
  const dy = e.clientY - imageViewer.dragStartY
  queueViewerTransform(_dragBaseX + dx, _dragBaseY + dy)
}

// 停止拖动：仅在松手这一刻把最终偏移同步回响应式状态（全程唯一一次写状态）
function stopViewerDrag(e) {
  if (!imageViewer.isDragging) return
  const dx = e.clientX - imageViewer.dragStartX
  const dy = e.clientY - imageViewer.dragStartY
  imageViewer.translateX = _dragBaseX + dx
  imageViewer.translateY = _dragBaseY + dy
  cancelViewerTransformFrame()
  applyViewerTransform()
  imageViewer.isDragging = false
  const img = imageViewerImgRef.value
  if (img) {
    img.classList.remove('is-dragging')
    img.style.removeProperty('transition') // 恢复 CSS 过渡（缩放/旋转动画需要）
  }
  try { if (_dragCaptureEl?.hasPointerCapture?.(e.pointerId)) _dragCaptureEl.releasePointerCapture(e.pointerId) } catch (_) {}
  _dragCaptureEl = null
  _dragImgEl = null
  window.removeEventListener('pointermove', moveViewerDrag)
  window.removeEventListener('pointerup', stopViewerDrag)
  window.removeEventListener('pointercancel', stopViewerDrag)
}

// 下载图片（优先 fetch+blob，大文件/跨域 fallback 新标签页打开）
let downloadToastId = 0
async function downloadImage() {
  const url = imageViewer.url
  const name = imageViewer.name || 'image'
  console.log('[downloadImage] url:', url, 'name:', name)
  try {
    await downloadFileByUrl(url, name)
    console.log('[downloadImage] done')
  } catch (err) {
    console.error('[downloadImage] error:', err)
  }
}

async function downloadViewerImage(image) {
  if (!image?.url) return
  await downloadFileByUrl(image.url, image.name || 'image')
}

/**
 * 通用文件下载：通过后端代理下载跨域图片，解决 a.download 对跨域 URL 无效的问题。
 * 后端代理使用流式传输，边从 CDN 接收边向前端发送，大图片也能快速开始下载。
 * 超大文件（>30MB）直接新标签页打开。
 */
async function downloadFileByUrl(url, filename) {
  const toastId = ++downloadToastId
  const isCrossOrigin = url.startsWith('http') && !url.startsWith(location.origin)

  // 策略1：跨域图片直接用 <a download> 触发浏览器原生下载（现代浏览器都支持）
  // 比走代理快得多（代理需要 CDN→后端→前端，大图耗时 70s+）
  if (isCrossOrigin) {
    const a = document.createElement('a')
    a.href = url
    a.download = filename || 'image.png'
    a.target = '_blank'
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    showDownloadToast('正在下载…', toastId)
    return
  }

  // 同域图片：直接 fetch + blob 下载
  showDownloadToast('正在下载…', toastId, true)
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`下载失败: HTTP ${res.status}`)
    const blob = await res.blob()
    if (blob.size > 30 * 1024 * 1024) {
      window.open(url, '_blank')
      showDownloadToast('文件较大（>30MB），已在新标签页打开', toastId)
      return
    }
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    const ext =
      blob.type === 'image/png'
        ? '.png'
        : blob.type === 'image/jpeg'
          ? '.jpg'
          : blob.type === 'image/webp'
            ? '.webp'
            : ''
    if (ext && !filename.toLowerCase().endsWith(ext)) filename += ext
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000)
    showDownloadToast('下载完成', toastId)
  } catch (err) {
    console.error('[download] error:', err)
    window.open(url, '_blank')
    showDownloadToast('已在新标签页打开图片', toastId)
  }
}

/** 显示下载状态提示（轻量 toast，persistent 模式下不自动消失） */
function showDownloadToast(msg, toastId, persistent = false) {
  // 复用已有的 toast 元素，避免堆积
  const existing = document.getElementById('download-toast')
  if (existing) existing.remove()
  const el = document.createElement('div')
  el.id = 'download-toast'
  el.textContent = msg
  Object.assign(el.style, {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    zIndex: '99999',
    background: 'rgba(0,0,0,0.75)',
    color: '#fff',
    padding: '10px 20px',
    borderRadius: '8px',
    fontSize: '14px',
    transition: 'opacity 0.3s',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
  })
  document.body.appendChild(el)
  if (!persistent) {
    setTimeout(() => {
      el.style.opacity = '0'
      setTimeout(() => el.remove(), 400)
    }, 3000)
  }
}

function downloadVideo() {
  downloadFileByUrl(videoViewer.url, videoViewer.name || 'video')
}

// figure 上的 dblclick 统一入口（因为 setPointerCapture 会劫持内层事件）
function onLayerDblClick(event, layer) {
  if (layer.type === 'text') {
    startEditText(layer)
  } else if (layer.type === 'image-placeholder' || (layer.type === 'video' && !layer.url)) {
    uploadNodeMedia(layer)
  } else if (layer.type === 'video' && layer.url) {
    // 双击视频：打开视频查看器
    openVideoViewer(layer.url, layer.name)
  } else if (layer.url && (layer.type === 'image' || (layer.url && !layer.type))) {
    // 双击图片：打开查看器
    openImageViewer(layer.url, layer.name)
  }
}

function startEditText(layer) {
  pushUndo()
  editingTextLayerId.value = layer.id
  editingTextValue.value = layer.text || ''
  nextTick(() => {
    const input = document.querySelector('.uc-text-edit-input')
    if (input) input.focus()
  })
}

function finishEditText() {
  if (!editingTextLayerId.value) return
  updateLayer(editingTextLayerId.value, { text: editingTextValue.value || '双击编辑文字' })
  editingTextLayerId.value = null
  editingTextValue.value = ''
}

// 格式化图层创建时间（从 layer.id 中提取时间戳）
function formatLayerTime(layer) {
  const match = layer.id?.match(/layer-(\d+)-/)
  if (!match) return ''
  const ts = parseInt(match[1], 10)
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// 播放/暂停视频节点（画布内播放）
function playVideoNode(layer) {
  if (!layer.url) return
  // 在画布内播放/暂停视频
  const videoEl = document.querySelector(`[data-layer-id="${layer.id}"] video.uc-video-node-video`)
  if (!videoEl) return
  if (videoEl.paused) {
    // 先暂停其他正在播放的视频
    if (playingVideoLayerId.value && playingVideoLayerId.value !== layer.id) {
      const otherEl = document.querySelector(
        `[data-layer-id="${playingVideoLayerId.value}"] video.uc-video-node-video`,
      )
      if (otherEl && !otherEl.paused) otherEl.pause()
    }
    videoEl.play().catch(() => {})
  } else {
    videoEl.pause()
  }
}

// 鼠标悬停自动播放视频
const _hoverPlayingIds = new Set() // 记录因悬停而播放的视频，手动暂停时不自动恢复
function hoverPlayVideo(layer) {
  if (!layer.url) return
  const videoEl = document.querySelector(`[data-layer-id="${layer.id}"] video.uc-video-node-video`)
  if (!videoEl || !videoEl.paused) return
  // 先暂停其他悬停播放的视频
  for (const id of _hoverPlayingIds) {
    if (id !== layer.id) {
      const otherEl = document.querySelector(`[data-layer-id="${id}"] video.uc-video-node-video`)
      if (otherEl && !otherEl.paused) otherEl.pause()
    }
  }
  videoEl.play().catch(() => {})
  _hoverPlayingIds.add(layer.id)
}

function hoverPauseVideo(layer) {
  if (!layer.url) return
  const videoEl = document.querySelector(`[data-layer-id="${layer.id}"] video.uc-video-node-video`)
  if (!videoEl || videoEl.paused) return
  videoEl.pause()
  _hoverPlayingIds.delete(layer.id)
}

function toggleAddMenu() {
  if (!userStore.requireLogin()) return
  addOpen.value = !addOpen.value
}

function removeChatReferenceImage(imageId) {
  const image = chatReferenceImages.value.find((item) => item.id === imageId)
  if (image?.localUrl?.startsWith('blob:')) URL.revokeObjectURL(image.localUrl)
  chatReferenceImages.value = chatReferenceImages.value.filter((item) => item.id !== imageId)
  activeChatReferenceId.value = chatReferenceImages.value.at(-1)?.id || ''
}

async function addFiles(fileList, options = {}) {
  const files = [...fileList].filter(
    (file) => file.type.startsWith('image/') || file.type.startsWith('video/'),
  )
  let uploadedCount = 0
  for (const file of files) {
    const isVideo = file.type.startsWith('video/')
    let referenceImage = null
    if (options.addToChatDeck) {
      const localUrl = URL.createObjectURL(file)
      referenceImage = {
        id: `ref-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: file.name,
        localUrl,
        url: localUrl,
        uploading: true,
      }
      chatReferenceImages.value.push(referenceImage)
      activeChatReferenceId.value = referenceImage.id
    }

    try {
      uploadProgress.value = { fileName: file.name, loaded: 0, total: file.size, percent: 0 }
      const url = await uploadFile(file, (p) => {
        uploadProgress.value = {
          fileName: file.name,
          loaded: p.loaded,
          total: p.total,
          percent: p.percent,
        }
      })
      uploadProgress.value = null
      if (referenceImage) {
        referenceImage.url = url
        referenceImage.uploading = false
        if (referenceImage.localUrl?.startsWith('blob:'))
          URL.revokeObjectURL(referenceImage.localUrl)
        referenceImage.localUrl = ''
      }

      if (isVideo) {
        // 视频文件：创建视频图层，按真实比例适配
        const size = await videoSize(url).catch(() => ({ width: 16, height: 9 }))
        const layerW = CANVAS_IMAGE_WIDTH
        const layerH = Math.round((layerW * size.height) / size.width)
        let layerId = ''
        canvas.updateDocument(props.id, (draft) => {
          const index = draft.payload.layers.length
          const stageEl2 = document.querySelector('.stage')
          const sr2 = stageEl2 ? stageEl2.getBoundingClientRect() : null
          const cx =
            ((sr2 ? sr2.width : viewportSize.width) / 2 - viewOffset.value.x) / viewScale.value
          const cy =
            ((sr2 ? sr2.height : viewportSize.height) / 2 - viewOffset.value.y) / viewScale.value
          const base = selectedLayer.value
          const layer = {
            id: `layer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            type: 'video',
            name: layerName(index),
            url,
            thumbnailUrl: '',
            naturalWidth: size.width,
            naturalHeight: size.height,
            width: layerW,
            height: layerH,
            x: base ? base.x + Math.min(40, base.width / 2) : cx - layerW / 2 + index * 30,
            y: base ? base.y + 30 : cy - layerH / 2 + index * 25,
            zIndex: index + 1,
            visible: true,
            locked: false,
          }
          layerId = layer.id
          draft.payload.layers.push(layer)
          selectedLayerId.value = layer.id
          selectedLayerIds.value = [layer.id]
          return draft
        })
        if (referenceImage) referenceImage.layerId = layerId
        uploadedCount += 1
      } else {
        // 图片文件：原逻辑
        const size = await imageSize(url)
        let layerId = ''
        canvas.updateDocument(props.id, (draft) => {
          const index = draft.payload.layers.length
          const width = size.width > size.height ? CANVAS_IMAGE_WIDTH : CANVAS_IMAGE_WIDTH
          const layerH = Math.round((width * size.height) / size.width)
          const stageEl3 = document.querySelector('.stage')
          const sr3 = stageEl3 ? stageEl3.getBoundingClientRect() : null
          const cx =
            ((sr3 ? sr3.width : viewportSize.width) / 2 - viewOffset.value.x) / viewScale.value
          const cy =
            ((sr3 ? sr3.height : viewportSize.height) / 2 - viewOffset.value.y) / viewScale.value
          const base = selectedLayer.value
          const layer = {
            id: `layer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: layerName(index),
            url,
            thumbnailUrl: url,
            naturalWidth: size.width,
            naturalHeight: size.height,
            width,
            height: layerH,
            x: base ? base.x + Math.min(40, base.width / 2) : cx - width / 2 + index * 30,
            y: base ? base.y + 30 : cy - layerH / 2 + index * 25,
            zIndex: index + 1,
            visible: true,
            locked: false,
          }
          layerId = layer.id
          draft.payload.layers.push(layer)
          selectedLayerId.value = layer.id
          selectedLayerIds.value = [layer.id]
          return draft
        })
        if (referenceImage) referenceImage.layerId = layerId
        uploadedCount += 1
      }
    } catch (error) {
      uploadProgress.value = null
      if (referenceImage) {
        referenceImage.uploading = false
        referenceImage.error = true
      }
      throw error
    }
  }
  if (uploadedCount && options.addChatNotice) {
    canvas.updateDocument(props.id, (draft) => {
      draft.payload.chat = draft.payload.chat || []
      draft.payload.chat.push({
        id: `msg-${Date.now()}-upload`,
        role: 'assistant',
        text: `已添加 ${uploadedCount} 个文件到画布。`,
        createdAt: Date.now(),
      })
      return draft
    })
  }
  return uploadedCount
}

async function onFileChange(event) {
  if (!userStore.requireLogin()) {
    event.target.value = ''
    return
  }
  addOpen.value = false
  const isChatUpload = fileInputMode.value === 'chat'
  if (isChatUpload) chatUploading.value = true
  try {
    await addFiles(event.target.files || [], {
      addChatNotice: isChatUpload,
      addToChatDeck: isChatUpload,
    })
  } catch (error) {
    window.alert(error.message || '图片上传失败')
  } finally {
    chatUploading.value = false
    fileInputMode.value = 'canvas'
    event.target.value = ''
  }
}

function updateLayer(id, patch) {
  canvas.updateDocument(props.id, (draft) => {
    draft.payload.layers = draft.payload.layers.map((layer) =>
      layer.id === id ? { ...layer, ...patch } : layer,
    )
    return draft
  })
}

function removeLayer(id) {
  if (!userStore.requireLogin()) return
  // 如果正在播放该视频，清理播放状态
  if (playingVideoLayerId.value === id) playingVideoLayerId.value = null
  pushUndo()
  // 删除关联的连接线
  connections.value = connections.value.filter((c) => c.fromLayerId !== id && c.toLayerId !== id)
  canvas.updateDocument(props.id, (draft) => {
    draft.payload.layers = draft.payload.layers.filter((layer) => layer.id !== id)
    draft.payload.connections = connections.value
    return draft
  })
  selectedLayerId.value = layers.value[0]?.id || ''
  selectedLayerIds.value = selectedLayerId.value ? [selectedLayerId.value] : []
}

/**
 * 【Bug修复】占位图优先选中：检查当前点击位置是否有占位图与被点击图层重叠。
 * 如果有，返回应该优先选中的占位图层；否则返回 null。
 *
 * 判定逻辑：
 * 1. 遍历所有占位图层（type === 'placeholder'）
 * 2. 检查占位图的 bounding box 是否与被点击图层在点击坐标处重叠
 * 3. 如果有多个占位图重叠，选择 zIndex 最高的那个
 */
function findOverlappingPlaceholder(event, clickedLayer) {
  // 仅处理占位图与普通图层重叠的场景
  const placeholders = layers.value.filter(
    (l) => l.type === 'placeholder' && l.id !== clickedLayer.id
  )
  if (!placeholders.length) return null

  // 计算点击位置在画布坐标系中的坐标
  const stage = event.currentTarget.closest('.canvas-viewport')?.parentElement
  if (!stage) return null

  // 将 event.clientX/Y 转换为画布坐标
  const viewScaleVal = viewScale || 1
  const offsetX = doc.value?.payload?.view?.offset?.x || 0
  const offsetY = doc.value?.payload?.view?.offset?.y || 0
  const canvasX = (event.clientX - stage.getBoundingClientRect().left) / viewScaleVal - offsetX
  const canvasY = (event.clientY - stage.getBoundingClientRect().top) / viewScaleVal - offsetY

  // 检查每个占位图是否覆盖了这个画布坐标，且与被点击图层有重叠
  let bestPlaceholder = null
  let bestZ = -Infinity

  for (const ph of placeholders) {
    // 占位图矩形
    const phLeft = ph.x
    const phTop = ph.y
    const phRight = ph.x + ph.width
    const phBottom = ph.y + ph.height

    // 点击坐标在占位图范围内
    const pointInside = canvasX >= phLeft && canvasX <= phRight && canvasY >= phTop && canvasY <= phBottom
    if (!pointInside) continue

    // 占位图与被点击图层有空间重叠（至少部分相交）
    const clLeft = clickedLayer.x
    const clTop = clickedLayer.y
    const clRight = clickedLayer.x + clickedLayer.width
    const clBottom = clickedLayer.y + clickedLayer.height

    const overlap =
      phLeft < clRight && phRight > clLeft && phTop < clBottom && phBottom > clTop
    if (!overlap) continue

    // 多个占位图重叠时，选 zIndex 最高的
    const z = ph.zIndex || 0
    if (z > bestZ) {
      bestZ = z
      bestPlaceholder = ph
    }
  }

  return bestPlaceholder
}

function startLayerDrag(event, layer) {
  // 【Bug修复】占位图优先选中：当点击的图层不是占位图时，检查该位置是否有占位图重叠，
  // 如果有，将选中目标切换为占位图（确保占位图在重叠时始终被优先选中）。
  if (layer.type !== 'placeholder') {
    const overlappingPlaceholder = findOverlappingPlaceholder(event, layer)
    if (overlappingPlaceholder) {
      // 用占位图替换当前 layer 进行后续选中+拖拽逻辑
      layer = overlappingPlaceholder
    }
  }

  if (!userStore.requireLogin()) return
  if (activeTool.value === 'hand') return
  if (activeTool.value === 'annotate') return
  if (event.ctrlKey || event.metaKey) return // Ctrl+拖拽由 stage 的 startMarquee 处理
  if (
    event.button !== 0 ||
    event.target.closest('.layer-toolbar') ||
    event.target.closest('.resize-dot')
  )
    return
  pushUndo()
  event.stopPropagation()
  event.currentTarget.setPointerCapture(event.pointerId)

  // 选中图片时置顶为前景：将当前图层 zIndex 设为最高
  // 但占位图不修改zIndex（保持占位图的优先级，确保占位图始终在最上层）
  if (layer.type !== 'placeholder') {
    const maxZ = layers.value.reduce((max, l) => Math.max(max, l.zIndex || 0), 0)
    const currentZ = layer.zIndex || 0
    if (currentZ < maxZ) {
      canvas.updateDocument(props.id, (draft) => {
        const target = draft.payload.layers.find((l) => l.id === layer.id)
        if (target) target.zIndex = maxZ + 1
        return draft
      })
    }
  }

  const draggingGroup =
    selectedLayerIds.value.length > 1 && selectedLayerIds.value.includes(layer.id)
  if (!draggingGroup) {
    selectedLayerId.value = layer.id
    selectedLayerIds.value = [layer.id]
  }
  const ids = draggingGroup ? [...selectedLayerIds.value] : [layer.id]
  dragState.value = {
    pointerId: event.pointerId,
    ids,
    startX: event.clientX,
    startY: event.clientY,
    origins: layers.value
      .filter((item) => ids.includes(item.id))
      .map((item) => ({ id: item.id, x: item.x, y: item.y })),
  }
}

function moveLayer(event) {
  if (!dragState.value) return
  const scale = doc.value.payload.view.scale || 1
  const dx = (event.clientX - dragState.value.startX) / scale
  const dy = (event.clientY - dragState.value.startY) / scale

  const ds = dragState.value
  ds._rawDx = dx
  ds._rawDy = dy

  // rAF 里做 snap 对齐 + 更新 layer.x/y（轻量 reactive patch，Vue 自动更新 DOM transform）
  if (!_dragRafId) {
    _dragRafId = requestAnimationFrame(() => {
      _dragRafId = null
      const ds = dragState.value
      if (!ds) return
      const snapResult = calcSnapAlign(ds.ids, ds._rawDx, ds._rawDy)
      const finalDx = snapResult.dx
      const finalDy = snapResult.dy
      // 直接更新 layer.x/y（轻量 patch，Vue 自动更新 :style transform，不触发 updateDocument）
      for (const origin of ds.origins) {
        const layer = layers.value.find((l) => l.id === origin.id)
        if (layer) {
          layer.x = Math.round(origin.x + finalDx)
          layer.y = Math.round(origin.y + finalDy)
        }
      }
      ds._lastDx = finalDx
      ds._lastDy = finalDy
    })
  }
}

function stopLayerDrag(event) {
  if (!dragState.value) return
  // 如果有 pending rAF，立即执行确保 layer.x/y 是最终 snap 位置
  if (_dragRafId) {
    cancelAnimationFrame(_dragRafId)
    _dragRafId = null
    const ds = dragState.value
    if (ds && (ds._rawDx !== undefined || ds._rawDy !== undefined)) {
      const snapResult = calcSnapAlign(ds.ids, ds._rawDx || 0, ds._rawDy || 0)
      // 立即更新 layer.x/y 到 snap 位置
      for (const origin of ds.origins) {
        const layer = layers.value.find((l) => l.id === origin.id)
        if (layer) {
          layer.x = Math.round(origin.x + snapResult.dx)
          layer.y = Math.round(origin.y + snapResult.dy)
        }
      }
    }
  }
  // 持久化到 store（深拷贝 + localStorage + 服务器同步）
  canvas.updateDocument(props.id, (draft) => draft)
  const ds = dragState.value
  if (event.currentTarget.hasPointerCapture(ds.pointerId))
    event.currentTarget.releasePointerCapture(ds.pointerId)
  dragState.value = null
  snapGuides.value = []
  nextTick(() => refreshConnections())
}

// ========== 智能对齐（吸附线+辅助线） ==========
const SNAP_THRESHOLD = 16 // 吸附阈值（画布像素）
const snapGuides = ref([]) // 当前显示的对齐辅助线 [{ type:'h'|'v', pos: number }]

function calcSnapAlign(dragIds, dx, dy) {
  const draggedLayers = layers.value.filter((l) => dragIds.includes(l.id))
  const otherLayers = layers.value.filter((l) => !dragIds.includes(l.id) && l.url)
  if (!otherLayers.length) {
    snapGuides.value = []
    return { dx, dy }
  }

  const guides = []
  let bestDx = dx
  let bestDy = dy
  let minDistX = SNAP_THRESHOLD + 1
  let minDistY = SNAP_THRESHOLD + 1

  for (const dragged of draggedLayers) {
    const origin = dragState.value.origins.find((o) => o.id === dragged.id)
    if (!origin) continue

    const newX = origin.x + dx
    const newY = origin.y + dy
    const dragRight = newX + dragged.width
    const dragBottom = newY + dragged.height
    const dragCenterX = newX + dragged.width / 2
    const dragCenterY = newY + dragged.height / 2

    for (const other of otherLayers) {
      const oLeft = other.x
      const oRight = other.x + other.width
      const oTop = other.y
      const oBottom = other.y + other.height
      const oCenterX = other.x + other.width / 2
      const oCenterY = other.y + other.height / 2

      // 垂直线对齐（x 轴）
      const vChecks = [
        { a: newX, b: oLeft, guide: oLeft }, // 左边对齐
        { a: newX, b: oRight, guide: oRight }, // 左边对齐右边
        { a: dragRight, b: oLeft, guide: oLeft - dragged.width }, // 右边对齐左边
        { a: dragRight, b: oRight, guide: oRight - dragged.width }, // 右边对齐
        { a: dragCenterX, b: oCenterX, guide: oCenterX - dragged.width / 2 }, // 水平居中
      ]
      for (const chk of vChecks) {
        const dist = Math.abs(chk.a - chk.b)
        if (dist < SNAP_THRESHOLD && dist < minDistX) {
          minDistX = dist
          bestDx = chk.guide - origin.x
        }
      }

      // 水平线对齐（y 轴）
      const hChecks = [
        { a: newY, b: oTop, guide: oTop },
        { a: newY, b: oBottom, guide: oBottom },
        { a: dragBottom, b: oTop, guide: oTop - dragged.height },
        { a: dragBottom, b: oBottom, guide: oBottom - dragged.height },
        { a: dragCenterY, b: oCenterY, guide: oCenterY - dragged.height / 2 },
      ]
      for (const chk of hChecks) {
        const dist = Math.abs(chk.a - chk.b)
        if (dist < SNAP_THRESHOLD && dist < minDistY) {
          minDistY = dist
          bestDy = chk.guide - origin.y
        }
      }
    }
  }

  // 计算辅助线位置（用吸附后的坐标）
  if (minDistX <= SNAP_THRESHOLD) {
    // 找出对齐的 x 位置
    for (const dragged of draggedLayers) {
      const origin = dragState.value.origins.find((o) => o.id === dragged.id)
      if (!origin) continue
      const newX = origin.x + bestDx
      const dragRight = newX + dragged.width
      const dragCenterX = newX + dragged.width / 2
      for (const other of otherLayers) {
        const oLeft = other.x
        const oRight = other.x + other.width
        const oCenterX = other.x + other.width / 2
        if (Math.abs(newX - oLeft) < 1) {
          guides.push({ type: 'v', pos: oLeft })
          break
        }
        if (Math.abs(newX - oRight) < 1) {
          guides.push({ type: 'v', pos: oRight })
          break
        }
        if (Math.abs(dragRight - oLeft) < 1) {
          guides.push({ type: 'v', pos: oLeft })
          break
        }
        if (Math.abs(dragRight - oRight) < 1) {
          guides.push({ type: 'v', pos: oRight })
          break
        }
        if (Math.abs(dragCenterX - oCenterX) < 1) {
          guides.push({ type: 'v', pos: oCenterX })
          break
        }
      }
    }
  }
  if (minDistY <= SNAP_THRESHOLD) {
    for (const dragged of draggedLayers) {
      const origin = dragState.value.origins.find((o) => o.id === dragged.id)
      if (!origin) continue
      const newY = origin.y + bestDy
      const dragBottom = newY + dragged.height
      const dragCenterY = newY + dragged.height / 2
      for (const other of otherLayers) {
        const oTop = other.y
        const oBottom = other.y + other.height
        const oCenterY = other.y + other.height / 2
        if (Math.abs(newY - oTop) < 1) {
          guides.push({ type: 'h', pos: oTop })
          break
        }
        if (Math.abs(newY - oBottom) < 1) {
          guides.push({ type: 'h', pos: oBottom })
          break
        }
        if (Math.abs(dragBottom - oTop) < 1) {
          guides.push({ type: 'h', pos: oTop })
          break
        }
        if (Math.abs(dragBottom - oBottom) < 1) {
          guides.push({ type: 'h', pos: oBottom })
          break
        }
        if (Math.abs(dragCenterY - oCenterY) < 1) {
          guides.push({ type: 'h', pos: oCenterY })
          break
        }
      }
    }
  }

  snapGuides.value = guides
  return { dx: bestDx, dy: bestDy }
}

function smartToggleElement(layerId, elementId, event) {
  if (activeTool.value !== 'annotate' && !(event && (event.ctrlKey || event.metaKey))) return
  if (event) {
    event.preventDefault()
    event.stopPropagation()
  }
  const key = `${layerId}::${elementId}`
  const set = new Set(selectedDetectedElements.value)
  // 多选模式：点击切换选中/取消，不清除其他已选元素
  if (set.has(key)) {
    set.delete(key)
  } else {
    set.add(key)
  }
  selectedDetectedElements.value = set
  if (event) {
    const overlay = event.currentTarget.closest('.detected-elements-overlay')
    const overlayRect = overlay
      ? overlay.getBoundingClientRect()
      : event.currentTarget.getBoundingClientRect()
    const clickX = event.clientX - overlayRect.left
    const clickY = event.clientY - overlayRect.top

    // 计算点击位置相对于元素框的归一化坐标（0-1）
    const [layerId, elId] = key.split('::')
    const elements = layerDetectedElements.value[layerId] || []
    const el = elements.find((e) => (e.object_name || e.name || e.id) === elId)
    const layer = layers.value.find((l) => l.id === layerId)

    if (el && layer) {
      const box = normalizeBoxVal(el.box_2d || el.box2d || [0, 0, 1, 1])
      const vs = viewScale.value

      // 元素框的像素坐标 — box_2d = [x1, y1, x2, y2] = [left, top, right, bottom]
      // overlay 在 viewport 内，overlayRect 已含有 vo.x/vo.y，只乘 vs
      const boxLeft = (layer.x + box[0] * layer.width) * vs
      const boxTop = (layer.y + box[1] * layer.height) * vs
      const boxWidth = (box[2] - box[0]) * layer.width * vs
      const boxHeight = (box[3] - box[1]) * layer.height * vs

      // 计算相对位置（0-1）
      const relX = boxWidth > 0 ? Math.max(0, Math.min(1, (clickX - boxLeft) / boxWidth)) : 0.5
      const relY = boxHeight > 0 ? Math.max(0, Math.min(1, (clickY - boxTop) / boxHeight)) : 0.5

      elementClickPositions.value = {
        ...elementClickPositions.value,
        [key]: { relX, relY },
      }
    } else {
      // fallback: 存储绝对坐标
      elementClickPositions.value = {
        ...elementClickPositions.value,
        [key]: { x: clickX, y: clickY },
      }
    }
  }
  chatSkipPillSync.value = false
}

// 查找点击坐标处重叠元素（只返回最高 z-index 图层内的元素）
function findElementsAtPoint(clientX, clientY) {
  const overlayEl = document.querySelector('.detected-elements-overlay')
  if (!overlayEl) return []
  const overlayRect = overlayEl.getBoundingClientRect()
  // overlay 在 viewport 内，viewport 的 translate(vo) scale(vs) 已被 overlayRect 吸收
  const cx = clientX - overlayRect.left
  const cy = clientY - overlayRect.top
  const vs = viewScale.value

  // 先找点击处最高 z-index 的图层
  let topLayerId = null
  let topZ = -Infinity
  for (const layer of layers.value) {
    // overlayRect 已包含 vo.x/vo.y，只需 * vs 无需 + vo
    const lLeft = layer.x * vs
    const lTop = layer.y * vs
    const lRight = lLeft + (layer.width || 0) * vs
    const lBottom = lTop + (layer.height || 0) * vs
    if (cx >= lLeft && cx <= lRight && cy >= lTop && cy <= lBottom) {
      const lz = layer.zIndex || 0
      if (lz > topZ) {
        topZ = lz
        topLayerId = layer.id
      }
    }
  }

  const results = []
  for (const [layerId, elements] of Object.entries(layerDetectedElements.value)) {
    // 如果有点击处最高图层，只返回该图层的元素
    if (topLayerId && layerId !== topLayerId) continue
    const layer = layers.value.find((l) => l.id === layerId)
    if (!layer) continue
    for (const el of elements) {
      const box = el.box_2d || el.box2d || [0, 0, 1, 1]
      // overlayRect 已包含 vo，只需 * vs
      const left = (layer.x + box[0] * layer.width) * vs
      const top = (layer.y + box[1] * layer.height) * vs
      const right = left + (box[2] - box[0]) * layer.width * vs
      const bottom = top + (box[3] - box[1]) * layer.height * vs
      if (cx >= left && cx <= right && cy >= top && cy <= bottom) {
        results.push({
          layerId,
          el,
          box_2d: box,
          area: (box[2] - box[0]) * (box[3] - box[1]),
          id: el.object_name || el.name || el.id,
          name: el.object_name || el.name || '',
        })
      }
    }
  }
  return results
}

// 查找与给定元素框有交叠的所有元素（用于下拉候选列表）
// 只要两框有任意面积交集就算重叠
// 只在同一图层内比较——不同图层的坐标空间不一致，无意义
function findOverlappingElements(targetLayerId, targetBox) {
  const results = []
  const elements = layerDetectedElements.value[targetLayerId]
  if (!elements) return results
  for (const el of elements) {
    const box = el.box_2d || el.box2d || [0, 0, 1, 1]
    // 检查两框是否相交 — box = [x1, y1, x2, y2]
    const il = Math.max(targetBox[0], box[0])
    const it = Math.max(targetBox[1], box[1])
    const ir = Math.min(targetBox[2], box[2])
    const ib = Math.min(targetBox[3], box[3])
    if (il < ir && it < ib) {
      results.push({
        layerId: targetLayerId,
        el,
        box_2d: box,
        area: (box[2] - box[0]) * (box[3] - box[1]),
        id: el.object_name || el.name || el.id,
        name: el.object_name || el.name || '',
      })
    }
  }
  return results
}

// 基于视觉几何分析判断前景元素
// 核心原理：在2D图像中，如果A大部分在B的边界框内，说明A是B上面的物体（前景）
// 例如：茶杯在桌子上 → 茶杯大部分在桌子框内 → 茶杯是前景
//       人物坐在沙发上 → 人物大部分在沙发框内 → 人物是前景
function pickBestElement(candidates) {
  if (candidates.length === 1) return candidates[0]

  // boxA 被 boxB 覆盖的比例（A 有多少面积落在 B 内部）
  const coverage = (boxA, boxB) => {
    const il = Math.max(boxA[1], boxB[1])
    const it = Math.max(boxA[0], boxB[0])
    const ir = Math.min(boxA[3], boxB[3])
    const ib = Math.min(boxA[2], boxB[2])
    if (il >= ir || it >= ib) return 0
    const iArea = (ir - il) * (ib - it)
    const aArea = (boxA[3] - boxA[1]) * (boxA[2] - boxA[0])
    return aArea > 0 ? iArea / aArea : 0
  }

  // 完全包含
  const fullyContains = (boxOuter, boxInner) =>
    boxOuter[1] <= boxInner[1] &&
    boxOuter[0] <= boxInner[0] &&
    boxOuter[3] >= boxInner[3] &&
    boxOuter[2] >= boxInner[2]

  const scored = candidates.map((c) => {
    const b = c.box_2d
    const area = c.area
    let score = 0

    // 1) 面积：越小越像前景细节（权重 30%）
    //    茶杯面积通常 0.5%，沙发可能 30%，人物可能 15%
    score += (1 - Math.min(area * 3, 1)) * 0.3

    // 2) 底边深度：底边越靠下 ≈ 越靠近镜头（权重 5%）
    //    透视原理：近大远小，近的物体底部更靠下
    score += b[2] * 0.05

    // 3) 与其他元素的空间关系（权重 65%）
    let relation = 0
    for (const other of candidates) {
      if (other === c) continue
      const ob = other.box_2d
      const cInO = fullyContains(ob, b) // c 完全在 other 内
      const oInC = fullyContains(b, ob) // other 完全在 c 内

      // 3a) 完全包含 → 内部小框是前景
      if (cInO) {
        relation += 0.5 // c 在 other 内 → c 是前景（茶杯在桌面上）
        continue
      }
      if (oInC) {
        relation -= 0.25 // other 在 c 内 → c 是背景容器
        continue
      }

      // 3b) 部分重叠：A 大部分在 B 内 → A 是 B 上面的前景物体
      //     这才是正确的方向！
      //     人物大部分在沙发框内 → 人物坐在沙发上 → 人物在前
      //     茶杯大部分在桌子框内 → 茶杯放在桌上 → 茶杯在前
      const cInOPct = coverage(b, ob) // c 有多少落在 other 内
      const oInCPct = coverage(ob, b) // other 有多少落在 c 内

      if (cInOPct > 0.5) {
        // c 大部分在 other 内 → c 是前景物体（坐在沙发上/放在桌上）
        relation += 0.35 * cInOPct // 覆盖率越高，越确信是前景
      }
      if (oInCPct > 0.5) {
        // other 大部分在 c 内 → other 是前景，c 是背景
        relation -= 0.2 * oInCPct
      }
    }
    score += Math.max(-0.45, Math.min(0.65, relation))

    return { ...c, score, area, name: c.name }
  })

  scored.sort((a, b) => b.score - a.score)

  if (candidates.length >= 2) {
    console.log(
      '[smart-click] 重叠',
      candidates.length,
      '个 → 选中',
      `"${scored[0].name}" (score=${scored[0].score.toFixed(3)}, area=${scored[0].area.toFixed(4)})`,
      '| 次选',
      `"${scored[1].name}" (score=${scored[1].score.toFixed(3)}, area=${scored[1].area.toFixed(4)})`,
    )
  }

  return scored[0]
}

// 将消息文本中的 [元素名] 替换为结构化元素标签
function renderMessageContent(message) {
  let html = escHtml(message.text || '').replace(/\n/g, '<br>')
  // 参考图缩略图（使用缓存，防签名 URL 过期裂图）
  if (message.referenceImages?.length) {
    const thumbs = message.referenceImages
      .map(
        (img, i) =>
          `<span class="chat-ref-thumb" style="--i:${i}">${cachedImgHtml(escHtml(img.url))}</span>`,
      )
      .join('')
    html = `<div class="chat-ref-thumbs">${thumbs}</div>` + html
  }
  if (message.elements?.length) {
    for (const el of message.elements) {
      const name = escHtml(el.name)
      const thumb = escHtml(el.thumb || '')
      const order = el.order
      const box = el.box || []
      const imgStyle =
        thumb && box.length === 4
          ? ` style="object-position:${(box[0] + (box[2] - box[0]) / 2) * 100}% ${(box[1] + (box[3] - box[1]) / 2) * 100}%;object-fit:cover"`
          : ''
      const pillHtml = `<span class="chat-pill chat-pill-msg" contenteditable="false" data-el-layer="${escHtml(el.layerId)}" data-el-name="${escHtml(el.name)}" data-el-order="${order}"><span class="chat-pill-num">${order}</span>${thumb ? cachedImgHtml(thumb, `alt=""${imgStyle}`) : ''}${name}</span>`
      html = html.replace(`[${name}]`, pillHtml)
    }
  }
  // ---- 生图预览卡片 ----
  if (message.imageUrl) {
    const imgEsc = escHtml(message.imageUrl)
    const mid = escHtml(message.id || '')
    html += `<div class="chat-gen-preview" data-msg-id="${mid}">`
      + `<img class="chat-gen-preview-img" src="${imgEsc}" alt="生成结果" loading="lazy" />`
      + `<div class="chat-gen-preview-actions">`
      + `<button class="chat-gen-action-btn chat-gen-action--regen-prompt" data-msg-id="${mid}" title="编辑提示词重新生成">✏️</button>`
      + `<button class="chat-gen-action-btn chat-gen-action--regen" data-msg-id="${mid}" title="使用相同参数重新生成">🔄</button>`
      + `<button class="chat-gen-action-btn chat-gen-action--like" data-msg-id="${mid}" title="点赞">👍</button>`
      + `<button class="chat-gen-action-btn chat-gen-action--dislike" data-msg-id="${mid}" title="点踩">👎</button>`
      + `</div>`
      + `</div>`
  } else if (message.generating && !/^(生成|生图)失败/.test(String(message.text || '').trim())) {
    html += `<div class="chat-gen-preview chat-gen-preview--loading"><div class="chat-gen-skeleton"></div></div>`
  }
  return html
}

// 生图预览卡片：单击定位画布图层 + 操作按钮；双击打开查看器
function handleGenPreviewClick(e) {
  const previewImg = e.target.closest('.chat-gen-preview-img')
  if (previewImg && !e.target.closest('.chat-gen-action-btn')) {
    const url = previewImg.getAttribute('src')
    if (url) {
      const layer = (layers.value || []).find((l) => l.type === 'image' && l.url === url)
      if (layer) selectSingleLayer(layer)
    }
    return
  }
  const btn = e.target.closest('.chat-gen-action-btn')
  if (!btn) return
  e.stopPropagation()
  const msgId = btn.dataset.msgId
  if (!msgId) return
  const chat = doc.value?.payload?.chat || []
  // 把文字写进 contenteditable 输入框并同步 chatText（sendChat 从 DOM 读，不能只写 ref）
  const writeEditorText = (t) => {
    const editorEl = document.querySelector('.chat-editor')
    if (editorEl) {
      editorEl.textContent = t || ''
      updateChatTextFromEditor()
      editorEl.focus()
    } else {
      chatText.value = t || ''
    }
  }
  if (btn.classList.contains('chat-gen-action--regen-prompt')) {
    const idx = chat.findIndex((m) => m.id === msgId)
    // 真正的"原始请求"是这条 assistant 消息前一条 user 消息（prompt + 参考图都在那里）
    const userMsg = idx > 0 ? chat[idx - 1] : null
    const src = userMsg && userMsg.role === 'user' ? userMsg : chat.find((m) => m.id === msgId)
    if (src) {
      writeEditorText(src.text)
      // 恢复参考图到输入框（补 id 字段，UI 用 id 做 key/active）
      if (src.referenceImages?.length) {
        chatReferenceImages.value = src.referenceImages.map((r, i) => ({
          id: r.id || r.url || `ref-${Date.now()}-${i}`,
          url: r.url,
          name: r.name || '',
        }))
        activeChatReferenceId.value = chatReferenceImages.value.at(-1)?.id || ''
      }
    }
  } else if (btn.classList.contains('chat-gen-action--regen')) {
    const msg = chat.find((m) => m.id === msgId)
    if (msg?.imageUrl) {
      const history = doc.value?.payload?.generationHistory || []
      const rec = history.find((r) => r.imageUrl === msg.imageUrl)
      if (rec?.prompt) {
        writeEditorText(rec.prompt)
        sendChat()
      }
    }
  } else if (btn.classList.contains('chat-gen-action--like')) {
    btn.classList.toggle('chat-gen-action--active')
    const sib = btn.parentElement?.querySelector('.chat-gen-action--dislike')
    if (sib) sib.classList.remove('chat-gen-action--active')
  } else if (btn.classList.contains('chat-gen-action--dislike')) {
    btn.classList.toggle('chat-gen-action--active')
    const sib = btn.parentElement?.querySelector('.chat-gen-action--like')
    if (sib) sib.classList.remove('chat-gen-action--active')
  }
}

function handleGenPreviewDblClick(e) {
  const img = e.target.closest('.chat-gen-preview-img')
  if (!img) return
  const url = img.getAttribute('src')
  if (url) openImageViewer(url, img.getAttribute('alt') || '生成结果')
}

// 格式化消息元数据时间：MM-DD HH:mm
function formatMetaTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 聊天消息中元素 pill 悬停预览
const hoverPreviewPillRef = ref(null) // 当前悬停的 pill DOM 元素，避免重复触发

function handleChatPillEnter(event) {
  const pill = event.target.closest('.chat-pill-msg')
  if (!pill) {
    // 鼠标移到非 pill 区域，隐藏预览
    if (hoverPreviewPillRef.value) {
      clearTimeout(hoverPreviewTimer.value)
      hoverPreview.visible = false
      hoverPreviewPillRef.value = null
    }
    return
  }
  // 同一个 pill，不重复处理
  if (hoverPreviewPillRef.value === pill) return
  hoverPreviewPillRef.value = pill
  showPillPreview(pill, event)
}

function handleChatPillMove(event) {
  if (!hoverPreview.visible) return
  clampPreviewPosition(event.clientX + 16, event.clientY + 12)
}

function handleChatPillLeave(event) {
  const pill = event.target.closest('.chat-pill-msg')
  if (pill) {
    // 鼠标移出 pill 到其子元素上，检查 relatedTarget 是否还在同一个 pill 内
    const related = event.relatedTarget
    if (related && pill.contains(related)) return
  }
  // 鼠标离开了 pill
  if (!hoverPreviewPillRef.value) return
  clearTimeout(hoverPreviewTimer.value)
  hoverPreviewTimer.value = setTimeout(() => {
    hoverPreview.visible = false
    hoverPreviewPillRef.value = null
  }, 120)
}

function clampPreviewPosition(x, y) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const pw = hoverPreviewDims.w
  const ph = hoverPreviewDims.h
  // 右边界溢出 → 翻转到左边
  if (x + pw + 8 > vw) x = x - pw - 32
  // 下边界溢出 → 翻转到上边
  if (y + ph + 8 > vh) y = y - ph - 24
  // 不超出左上边界
  hoverPreview.x = Math.max(4, x)
  hoverPreview.y = Math.max(4, y)
}

function showPillPreview(pill, event) {
  clearTimeout(hoverPreviewTimer.value)
  const layerId = pill.getAttribute('data-el-layer')
  const elName = pill.getAttribute('data-el-name')
  const elOrder = parseInt(pill.getAttribute('data-el-order') || '0', 10)
  if (!layerId || !elName) return

  const layer = layers.value.find((l) => l.id === layerId)
  if (!layer?.url) return

  // 从检测数据中查找元素的 box
  const boxes = layer?.detection?.boxes || []
  let foundBox = null
  for (const b of boxes) {
    if ((b.name || b.object_name) === elName) {
      foundBox = normalizeBoxVal(b.box2d || b.box_2d || [])
      break
    }
  }
  // 如果没找到精确匹配，尝试从 layerDetectedElements 中查找
  if (!foundBox) {
    const els = layerDetectedElements.value[layerId]
    if (els) {
      for (const el of els) {
        if (el.name === elName) {
          foundBox = el.box2d || el.box_2d || []
          break
        }
      }
    }
  }

  // 预载图片以获取自然尺寸
  const img = new Image()
  img.onload = () => {
    hoverPreviewImageSize.width = img.naturalWidth || 800
    hoverPreviewImageSize.height = img.naturalHeight || 800
    // 计算预览弹窗实际渲染尺寸（图片最大 240x340，容器 + padding 10*2 + border 2*2）
    const ratio = img.naturalWidth / img.naturalHeight
    let imgW, imgH
    if (ratio >= 1) {
      imgW = Math.min(240, 340 * ratio)
      imgH = imgW / ratio
    } else {
      imgH = Math.min(340, 240 / ratio)
      imgW = imgH * ratio
    }
    hoverPreviewDims.w = imgW + 24
    hoverPreviewDims.h = imgH + 24
    hoverPreview.layerUrl = layer.url
    hoverPreview.box = foundBox
    hoverPreview.name = elName
    hoverPreview.order = elOrder
    clampPreviewPosition(event.clientX + 16, event.clientY + 12)
    hoverPreview.visible = true
  }
  img.onerror = () => {
    hoverPreviewImageSize.width = 800
    hoverPreviewImageSize.height = 800
    hoverPreviewDims.w = 264
    hoverPreviewDims.h = 224
    hoverPreview.layerUrl = layer.url
    hoverPreview.box = foundBox
    hoverPreview.name = elName
    hoverPreview.order = elOrder
    clampPreviewPosition(event.clientX + 16, event.clientY + 12)
    hoverPreview.visible = true
  }
  img.src = layer.url
}

// 标注模式或 Ctrl+点击时，智能选择重叠区域最前景元素
function handleDetectedOverlayClick(event) {
  // 如果点击的是手动元素删除按钮，放行
  if (event.target.closest?.('.manual-element-delete')) return

  // 如果点击的是 annotate-banner（退出标记按钮等），放行
  if (event.target.closest?.('.annotate-banner')) return

  const inAnnotate = activeTool.value === 'annotate'
  const withCtrl = event.ctrlKey || event.metaKey
  if (!inAnnotate && !withCtrl) return

  // 如果命名框正在显示，先确认当前元素，放行事件让 startMarquee 处理新框选
  if (manualNameInput.visible) {
    confirmManualElementName()
    return // 放行，让事件冒泡到 stage
  }

  const candidates = findElementsAtPoint(event.clientX, event.clientY)
  if (!candidates.length) {
    if (inAnnotate) return // 放行手动框选
    return
  }
  event.preventDefault()
  event.stopPropagation()

  const best = pickBestElement(candidates)
  const key = `${best.layerId}::${best.id}`
  const set = new Set(selectedDetectedElements.value)
  if (set.has(key)) {
    set.delete(key)
    // 取消选中时清除候选列表
    const nextCandidates = { ...elementOverlapCandidates.value }
    delete nextCandidates[key]
    elementOverlapCandidates.value = nextCandidates
  } else {
    set.add(key)
    // 选中时存储所有重叠候选（用于 pill 下拉切换）
    // 用框重叠分析替代点检测——这样即使点击的精确像素
    // 没落在相邻框内，只要两框有交集就能出现在下拉列表里
    const targetBox = best.box_2d || [0, 0, 1, 1]
    console.log(
      '[overlap-candidates] targetBox=',
      targetBox.map((v) => v.toFixed(4)),
      'area=',
      ((targetBox[3] - targetBox[1]) * (targetBox[2] - targetBox[0])).toFixed(4),
    )
    const overlappingCandidates = findOverlappingElements(best.layerId, targetBox)
    const storedCandidates = overlappingCandidates.map((c) => ({
      layerId: c.layerId,
      id: c.id,
      name: c.name,
      box_2d: c.box_2d,
      area: c.area,
    }))
    elementOverlapCandidates.value = {
      ...elementOverlapCandidates.value,
      [key]: storedCandidates,
    }
    console.log(
      '[overlap-candidates] 存储了',
      storedCandidates.length,
      '个候选 for key=',
      key,
      storedCandidates.map((c) => c.name),
    )
  }
  selectedDetectedElements.value = set
  const overlayEl = document.querySelector('.detected-elements-overlay')
  const overlayRect = overlayEl?.getBoundingClientRect() || { left: 0, top: 0 }
  elementClickPositions.value = {
    ...elementClickPositions.value,
    [key]: { x: event.clientX - overlayRect.left, y: event.clientY - overlayRect.top },
  }
  chatSkipPillSync.value = false
}

// 从编辑器 DOM 提取纯文本（用于空判断和发送）
function updateChatTextFromEditor() {
  const editor = document.querySelector('.chat-editor')
  if (!editor) return
  const textParts = []
  for (const node of editor.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent
      if (t && t !== '\u00a0') textParts.push(t)
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.classList.contains('chat-pill')) continue
      if (node.tagName === 'BR') {
        textParts.push('\n')
      } else {
        textParts.push(node.textContent || '')
      }
    }
  }
  chatText.value = textParts.join('').replace(/\u200B/g, '')
}

// 构建含元素名称的结构化提示词: [元素1] 修改文字1 [元素2] 修改文字2
function getEditorPrompt() {
  const editor = document.querySelector('.chat-editor')
  if (!editor) return chatText.value.trim()
  const parts = []
  for (const node of editor.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent || '').replace(/\u00a0/g, ' ').trim()
      if (t) parts.push(t)
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.classList.contains('chat-pill')) {
        const name = node.dataset.elName || node.dataset.elId || ''
        if (name) parts.push(`[${name}]`)
      } else if (node.tagName === 'BR') {
        parts.push('\n')
      } else {
        const t = (node.textContent || '')
          .replace(/\u00a0/g, ' ')
          .replace(/\u200B/g, '')
          .trim()
        if (t) parts.push(t)
      }
    }
  }
  return parts
    .join('')
    .replace(/[^\S\n]+/g, ' ')
    .trim()
}

// 同步：editor 里被 Backspace 删除的 pill → 取消画布选中
// 用 MutationObserver 代替 @input，因为 contenteditable 的 @input
// 可能在 pill 完全移出 DOM 之前触发，导致检测不到删除
let _pillObserver = null

function setupPillObserver() {
  const editor = document.querySelector('.chat-editor')
  if (!editor || _pillObserver) return
  _pillObserver = new MutationObserver(() => {
    if (_pillSyncLock > 0) return
    syncPillDeletions()
  })
  _pillObserver.observe(editor, { childList: true, subtree: true })
}

function handleEditorBackspace(event) {
  const editor = document.querySelector('.chat-editor')
  if (!editor) return

  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return

  const range = sel.getRangeAt(0)

  // 如果有选区，让浏览器默认处理
  if (!range.collapsed) return

  const node = range.startContainer
  const offset = range.startOffset

  // 情况1：光标在文本节点中
  if (node.nodeType === Node.TEXT_NODE) {
    // 如果光标在文本开头，检查前面的节点
    if (offset === 0) {
      const prevNode = node.previousSibling
      if (prevNode && prevNode.classList && prevNode.classList.contains('chat-pill')) {
        event.preventDefault()
        // 删除 pill
        prevNode.remove()
        // 如果后面的文本是 &nbsp;，也删除
        if (node.textContent === '\u00a0') {
          node.remove()
        }
        setTimeout(() => syncPillDeletions(), 10)
        return
      }
    }
    // 如果光标在 &nbsp; 的位置（offset=1 且文本是 &nbsp;）
    else if (offset === 1 && node.textContent === '\u00a0') {
      const prevNode = node.previousSibling
      if (prevNode && prevNode.classList && prevNode.classList.contains('chat-pill')) {
        event.preventDefault()
        prevNode.remove()
        node.remove()
        setTimeout(() => syncPillDeletions(), 10)
        return
      }
    }
  }
  // 情况2：光标在元素节点中（比如编辑器本身）
  else if (node.nodeType === Node.ELEMENT_NODE) {
    // 获取光标位置的子节点
    const childNodes = node.childNodes
    if (offset > 0 && offset <= childNodes.length) {
      const prevNode = childNodes[offset - 1]
      if (prevNode && prevNode.classList && prevNode.classList.contains('chat-pill')) {
        event.preventDefault()
        // 检查 pill 后面是否有 &nbsp;
        const nextNode = prevNode.nextSibling
        if (nextNode && nextNode.nodeType === Node.TEXT_NODE && nextNode.textContent === '\u00a0') {
          nextNode.remove()
        }
        prevNode.remove()
        setTimeout(() => syncPillDeletions(), 10)
        return
      }
    }
  }

  // 延迟同步，等待浏览器默认删除行为完成
  setTimeout(() => syncPillDeletions(), 50)
}

function handleEditorInput() {
  if (_pillSyncLock > 0) return
  syncPillDeletions()
  updateChatTextFromEditor()
}

// Ctrl+Enter 在 contenteditable 中插入换行
// document.execCommand('insertLineBreak') 已废弃，改用 Selection API 插入 <br>
function handleEditorLineBreak() {
  const editor = document.querySelector('.chat-editor')
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return
  const range = sel.getRangeAt(0)
  if (!range.collapsed) {
    range.deleteContents()
  }
  const br = document.createElement('br')
  range.insertNode(br)
  // 如果 <br> 是最后一个节点，再补一个 <br> 保证视觉换行可见
  if (br.parentNode === editor && !br.nextSibling) {
    const br2 = document.createElement('br')
    editor.appendChild(br2)
  }
  // 光标移到 <br> 之后
  range.setStartAfter(br)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
  updateChatTextFromEditor()
}

// 粘贴纯文本：阻止浏览器默认插入 HTML（会导致输入框变形）
function handleEditorPaste(event) {
  event.preventDefault()
  const plainText = (event.clipboardData || window.clipboardData).getData('text/plain')
  if (!plainText) return
  // 使用 execCommand 插入纯文本，保留光标位置和撤销栈
  document.execCommand('insertText', false, plainText)
}

// 核心：检测 DOM 中被删掉的 pill → 同步到 selectedDetectedElements
function syncPillDeletions() {
  const editor = document.querySelector('.chat-editor')
  if (!editor) return
  const pills = editor.querySelectorAll('.chat-pill')
  const existingKeys = new Set()
  pills.forEach((pill) => {
    const elId = pill.dataset.elId
    const layerId = pill.dataset.elLayer
    if (elId && layerId) existingKeys.add(`${layerId}::${elId}`)
  })

  const current = new Set(selectedDetectedElements.value)
  let changed = false
  for (const key of current) {
    if (!existingKeys.has(key)) {
      current.delete(key)
      const newPositions = { ...elementClickPositions.value }
      delete newPositions[key]
      elementClickPositions.value = newPositions
      changed = true
    }
  }
  if (changed) {
    chatSkipPillSync.value = true
    selectedDetectedElements.value = current
  }

  // 编辑器完全为空时，重置光标到最前端
  if (
    !pills.length &&
    (!editor.textContent || editor.textContent === '\n' || !editor.textContent.trim())
  ) {
    requestAnimationFrame(() => {
      if (!editor.isConnected) return
      const sel = window.getSelection()
      if (!sel) return
      sel.removeAllRanges()
      const range = document.createRange()
      range.setStart(editor, 0)
      range.collapse(true)
      sel.addRange(range)
    })
  }
}

function handleEditorPillClick(event) {
  const pill = event.target.closest('.chat-pill')
  if (!pill) return
  // 点击 ▼ 切换重叠元素
  if (event.target.closest('[data-action="pick-overlap"]')) {
    event.preventDefault()
    event.stopPropagation()
    const elId = pill.dataset.elId
    const elLayer = pill.dataset.elLayer
    const key = `${elLayer}::${elId}`
    const candidates = elementOverlapCandidates.value[key] || []
    console.log(
      '[overlap-dropdown] pill clicked, key=',
      key,
      'candidates=',
      candidates.length,
      'allKeys=',
      Object.keys(elementOverlapCandidates.value),
    )
    if (candidates.length <= 1) {
      console.log('[overlap-dropdown] 该元素没有重叠候选，候选人数据为空或只有1个')
      return
    }
    // 定位弹窗：上拉框，底部贴近 pill 顶部
    const rect = pill.getBoundingClientRect()
    overlapDropdown.visible = true
    overlapDropdown.x = rect.left
    overlapDropdown.y = rect.top - 4 // popup 的 top + translateY(-100%) = 底部对齐 pill 顶部
    overlapDropdown.pillKey = key
    overlapDropdown.candidates = candidates
    console.log('[overlap-dropdown] 弹窗已显示, x=', overlapDropdown.x, 'y=', overlapDropdown.y)
    return
  }
}

// 关闭重叠元素下拉弹窗
function closeOverlapDropdown() {
  overlapDropdown.visible = false
}

// 从下拉弹窗中选择一个元素替换当前 pill
function replacePillElement(newCandidate) {
  const oldKey = overlapDropdown.pillKey
  if (!oldKey) return
  const newKey = `${newCandidate.layerId}::${newCandidate.id}`

  // 如果选的就是自己，关闭弹窗
  if (newKey === oldKey) {
    overlapDropdown.visible = false
    return
  }

  // 更新 selectedDetectedElements：删旧加新（保持顺序）
  const current = [...selectedDetectedElements.value]
  const idx = current.indexOf(oldKey)
  if (idx === -1) {
    overlapDropdown.visible = false
    return
  }
  // 如果新 key 已存在，不重复添加
  if (current.includes(newKey)) {
    current.splice(idx, 1)
  } else {
    current[idx] = newKey
  }
  chatSkipPillSync.value = true
  selectedDetectedElements.value = new Set(current)

  // 更新候选列表：旧 key 的候选转移到新 key
  const nextCandidates = { ...elementOverlapCandidates.value }
  const stored = nextCandidates[oldKey] || []
  delete nextCandidates[oldKey]
  nextCandidates[newKey] = stored
  elementOverlapCandidates.value = nextCandidates

  // 更新 elementClickPositions：清除旧 key，新 key 不加（靠 getElementClickStyle 从框计算）
  const nextPositions = { ...elementClickPositions.value }
  delete nextPositions[oldKey]
  elementClickPositions.value = nextPositions

  // 更新 DOM pill：替换 data 属性和显示文字
  const editor = document.querySelector('.chat-editor')
  if (editor) {
    const pills = editor.querySelectorAll('.chat-pill')
    for (const p of pills) {
      const pKey = `${p.dataset.elLayer}::${p.dataset.elId}`
      if (pKey === oldKey) {
        p.dataset.elId = newCandidate.id
        p.dataset.elName = newCandidate.name
        p.dataset.elLayer = newCandidate.layerId
        p.dataset.elBox = (newCandidate.box_2d || []).join(',')
        // 更新显示文字（保留编号和 ▼ 按钮）
        const numEl = p.querySelector('.chat-pill-num')
        const imgEl = p.querySelector('img')
        const emEl = p.querySelector('[data-action="pick-overlap"]')
        // 清空 pill 内容重建
        p.innerHTML = ''
        if (numEl) p.appendChild(numEl)
        if (imgEl) p.appendChild(imgEl)
        p.appendChild(document.createTextNode(newCandidate.name))
        if (emEl) p.appendChild(emEl)
        break
      }
    }
  }

  overlapDropdown.visible = false
  // 重置标志，允许后续操作正常同步
  nextTick(() => {
    chatSkipPillSync.value = false
  })
}

// 手动框选：拖拽后弹出输入框让用户命名
function createManualElement() {
  const layerId = manualBoxDraft.layerId
  if (!layerId) {
    console.warn('[manual] createManualElement: layerId 为空，跳过')
    return
  }
  const layer = layers.value.find((l) => l.id === layerId)
  if (!layer) {
    console.warn('[manual] createManualElement: 找不到图层', layerId)
    return
  }

  const minX = Math.min(manualBoxDraft.startX, manualBoxDraft.currentX)
  const maxX = Math.max(manualBoxDraft.startX, manualBoxDraft.currentX)
  const minY = Math.min(manualBoxDraft.startY, manualBoxDraft.currentY)
  const maxY = Math.max(manualBoxDraft.startY, manualBoxDraft.currentY)

  // 框太小视为误触，不创建
  if (maxX - minX < 8 || maxY - minY < 8) {
    console.log('[manual] createManualElement: 框太小，跳过', { w: maxX - minX, h: maxY - minY })
    return
  }

  // 屏幕坐标 → 世界坐标：world = (screen - offset) / scale
  const vs = viewScale.value
  const vo = viewOffset.value
  const wLeft = (minX - vo.x) / vs
  const wRight = (maxX - vo.x) / vs
  const wTop = (minY - vo.y) / vs
  const wBottom = (maxY - vo.y) / vs

  // 图层相对归一化 0-1 — box_2d = [x1, y1, x2, y2] = [left, top, right, bottom]
  const x1 = (wLeft - layer.x) / layer.width
  const y1 = (wTop - layer.y) / layer.height
  const x2 = (wRight - layer.x) / layer.width
  const y2 = (wBottom - layer.y) / layer.height
  const box_2d = [x1, y1, x2, y2].map((v) => Math.max(0, Math.min(1, v)))

  // 弹出命名输入框（屏幕坐标，置于框上方）
  manualNameInput.visible = true
  manualNameInput.layerId = layerId
  manualNameInput.box_2d = box_2d
  manualNameInput.text = ''
  manualNameInput.x = minX
  manualNameInput.y = Math.max(4, minY - 36) // 框上方 36px，不超出画布顶部
  // 自动聚焦
  nextTick(() => {
    const input = document.querySelector('.manual-name-input input')
    if (input) input.focus()
  })
}

// 确认手动元素命名并添加到检测列表
function confirmManualElementName() {
  // 防重复触发（Enter + blur + 按钮 click 组合）
  if (!manualNameInput.visible) return
  clearTimeout(_manualBlurTimer)
  const userInput = manualNameInput.text.trim()
  const displayName = userInput ? `手标-${userInput}` : `手标-${Date.now()}`
  const layerId = manualNameInput.layerId
  const box_2d = manualNameInput.box_2d
  if (!layerId || !box_2d) {
    console.warn('[manual] confirmManualElementName: layerId 或 box_2d 为空，跳过', {
      layerId,
      box_2d,
    })
    manualNameInput.visible = false
    manualNameInput.text = ''
    manualBoxDraft.active = false
    return
  }

  const el = {
    id: `manual-${Date.now()}`,
    name: displayName,
    object_name: displayName,
    box_2d,
    box2d: box_2d,
    manual: true,
  }
  layerDetectedElements.value = {
    ...layerDetectedElements.value,
    [layerId]: [...(layerDetectedElements.value[layerId] || []), el],
  }
  // 同步选中并更新输入框 pill
  const elKey = `${layerId}::${el.object_name || el.name || el.id}`
  selectedDetectedElements.value = new Set([...selectedDetectedElements.value, elKey])
  console.log('[manual] 手动添加元素:', displayName, box_2d)
  // 持久化到文档（支持撤销恢复）
  canvas.updateDocument(props.id, (draft) => {
    draft.payload.detectedElements = JSON.parse(JSON.stringify(layerDetectedElements.value))
    return draft
  })
  manualNameInput.visible = false
  manualNameInput.text = ''
  manualBoxDraft.active = false
}

// 取消手动元素命名
function cancelManualElementName() {
  manualNameInput.visible = false
  manualNameInput.text = ''
  manualBoxDraft.active = false
}

// 删除手动框选元素（AI 检测元素不可删）
function removeManualElement(layerId, el) {
  console.log('[manual] removeManualElement called:', layerId, el.object_name || el.name || el.id)
  const elKey = `${layerId}::${el.object_name || el.name || el.id}`
  const elements = layerDetectedElements.value[layerId]
  if (!elements) return
  const next = elements.filter((e) => {
    const key = `${layerId}::${e.object_name || e.name || e.id}`
    return key !== elKey
  })
  layerDetectedElements.value = {
    ...layerDetectedElements.value,
    [layerId]: next,
  }
  // 从选中列表移除
  if (selectedDetectedElements.value.has(elKey)) {
    const set = new Set(selectedDetectedElements.value)
    set.delete(elKey)
    selectedDetectedElements.value = set
  }
  // 同步清除 pill 候选
  if (elementOverlapCandidates.value[elKey]) {
    const nextCandidates = { ...elementOverlapCandidates.value }
    delete nextCandidates[elKey]
    elementOverlapCandidates.value = nextCandidates
  }
  // 持久化
  canvas.updateDocument(props.id, (draft) => {
    draft.payload.detectedElements = JSON.parse(JSON.stringify(layerDetectedElements.value))
    return draft
  })
  chatSkipPillSync.value = false
}

// 输入框失焦时自动确认（延迟判断，避免与按钮点击冲突）
let _manualBlurTimer = 0
function onManualNameInputBlur() {
  clearTimeout(_manualBlurTimer)
  _manualBlurTimer = setTimeout(() => {
    if (manualNameInput.visible) {
      confirmManualElementName()
    }
  }, 150)
}

function clearAllAnnotations() {
  selectedDetectedElements.value = new Set()
  elementClickPositions.value = {}
}

function startResize(event, layer, point) {
  if (!userStore.requireLogin()) return
  pushUndo()
  event.stopPropagation()
  event.preventDefault()
  event.currentTarget.setPointerCapture(event.pointerId)
  selectedLayerId.value = layer.id
  selectedLayerIds.value = [layer.id]
  resizeState.value = {
    pointerId: event.pointerId,
    id: layer.id,
    point,
    startX: event.clientX,
    startY: event.clientY,
    x: layer.x,
    y: layer.y,
    width: layer.width,
    height: layer.height,
  }
}

function resizeLayer(event) {
  if (!resizeState.value) return
  const scale = doc.value.payload.view.scale || 1
  const dx = (event.clientX - resizeState.value.startX) / scale
  const st = resizeState.value
  const ratio = st.height / st.width
  const width = Math.max(60, st.width + (st.point.includes('left') ? -dx : dx))
  const height = Math.round(width * ratio)
  const x = st.point.includes('left') ? st.x + st.width - width : st.x
  const y = st.point.includes('top') ? st.y + st.height - height : st.y

  const pending = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height }

  // 直写 DOM：跳过 Vue reactive，帧内零 render 开销
  const el = document.querySelector(`[data-layer-id="${st.id}"]`)
  if (el) {
    el.style.transform = `translate(${pending.x}px, ${pending.y}px)`
    el.style.width = `${pending.width}px`
    el.style.height = `${pending.height}px`
  }
  // 缓存最终值供松手时一次性写入 reactive
  st._pending = pending
}

function stopResize(event) {
  if (!resizeState.value) return
  const st = resizeState.value
  // 最终位置一次性写入 reactive 对象（拖动期间零 reactive 写入，松手后一次性同步）
  if (st._pending) {
    const layer = layers.value.find((l) => l.id === st.id)
    if (layer) Object.assign(layer, st._pending)
  }
  // 松手一次性持久化
  canvas.updateDocument(props.id, (draft) => draft)
  if (event.currentTarget.hasPointerCapture(st.pointerId))
    event.currentTarget.releasePointerCapture(st.pointerId)
  resizeState.value = null
  nextTick(() => refreshConnections()) // 缩放结束后刷新连接线
}

function getSelectedDetectedElements() {
  return [...selectedDetectedElements.value]
    .map((key) => {
      const [layerId, elId] = key.split('::')
      const elements = layerDetectedElements.value[layerId] || []
      const el = elements.find((e) => (e.object_name || e.name || e.id) === elId)
      return el
        ? {
            ...el,
            layerId,
            id: el.object_name || el.name || el.id,
            name: el.object_name || el.name || '',
          }
        : null
    })
    .filter(Boolean)
}

// 构建元素定位提示：每个元素一行，含检测框坐标
function buildElementLocationHint() {
  const selected = getSelectedDetectedElements()
  if (!selected.length) return ''
  const lines = []
  for (let i = 0; i < selected.length; i++) {
    const el = selected[i]
    const layer = layers.value.find((l) => l.id === el.layerId)
    if (!layer) continue
    const box = normalizeBoxVal(el.box_2d || el.box2d || [0, 0, 1, 1])
    // 转换为像素坐标 — box = [x1, y1, x2, y2]
    const pxLeft = Math.round(box[0] * layer.width)
    const pxTop = Math.round(box[1] * layer.height)
    const pxRight = Math.round(box[2] * layer.width)
    const pxBottom = Math.round(box[3] * layer.height)
    const width = pxRight - pxLeft
    const height = pxBottom - pxTop

    // 计算相对位置（百分比，保留1位小数）— box = [x1, y1, x2, y2]
    const relLeft = (box[0] * 100).toFixed(1)
    const relTop = (box[1] * 100).toFixed(1)
    const relRight = (box[2] * 100).toFixed(1)
    const relBottom = (box[3] * 100).toFixed(1)

    lines.push({
      name: el.name || '元素',
      box: `[${pxLeft},${pxTop},${pxRight},${pxBottom}]`,
      relBox: `[${relLeft}%,${relTop}%,${relRight}%,${relBottom}%]`,
      size: `${width}×${height}`,
    })
  }
  return lines
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildElementPill(el, order) {
  const layer = layers.value.find((l) => l.id === el.layerId)
  const thumb = layer?.thumbnailUrl || layer?.url || ''
  const eId = el.object_name || el.name || el.id
  const box = el.box_2d || []
  const imgTag = thumb
    ? `<img src="${escHtml(thumb)}" alt="" style="object-position:${box.length === 4 ? `${(box[0] + (box[2] - box[0]) / 2) * 100}% ${(box[1] + (box[3] - box[1]) / 2) * 100}%` : 'center'};object-fit:cover" />`
    : ''
  return `<span class="chat-pill" contenteditable="false" data-el-id="${escHtml(eId)}" data-el-name="${escHtml(el.object_name || el.name || '')}" data-el-layer="${escHtml(el.layerId)}" data-el-box="${box.join(',')}"><span class="chat-pill-num">${order}</span>${imgTag}${escHtml(el.object_name || el.name || '')}<em title="切换重叠元素" data-action="pick-overlap">&#x25BC;</em></span>&nbsp;`
}

let _pillSyncLock = 0
function syncPillsToEditor() {
  const editor = document.querySelector('.chat-editor')
  if (!editor) return

  // 移除 "innerHTML='' 清空" 后浏览器自动插入、位于首位的裸 <br>，
  // 否则 line-height:2 会把它撑成一行空白，使 pill 上方出现空行
  const leadBr = editor.firstChild
  if (leadBr && leadBr.nodeType === Node.ELEMENT_NODE && leadBr.tagName === 'BR') {
    // 仅当编辑器直接子级文本节点中不存在真实文字时才移除，避免破坏用户已输入的文本
    const hasDirectText = Array.from(editor.childNodes).some(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0
    )
    if (!hasDirectText) leadBr.remove()
  }

  _pillSyncLock++
  const lockId = _pillSyncLock

  // 读取编辑器中已有的 pill
  const existingPills = Array.from(editor.querySelectorAll('.chat-pill'))
  const existingKeys = new Set()
  const pillNodeByKey = {}
  existingPills.forEach((pill) => {
    const key = `${pill.dataset.elLayer}::${pill.dataset.elId}`
    existingKeys.add(key)
    pillNodeByKey[key] = pill
  })

  const selectedSet = new Set([...selectedDetectedElements.value])

  // 1) 删除已取消选中的 pill（连同后面的 nbsp 空格）
  for (const key of existingKeys) {
    if (!selectedSet.has(key)) {
      const pill = pillNodeByKey[key]
      const next = pill.nextSibling
      if (next && next.nodeType === Node.TEXT_NODE && next.textContent === '\u00a0') {
        next.remove()
      }
      pill.remove()
    }
  }

  // 2) 追加新增的 pill 到编辑器末尾（不触碰已有文字）
  const detected = getSelectedDetectedElements()
  let anyAdded = false
  for (const el of detected) {
    const key = `${el.layerId}::${el.object_name || el.name || el.id}`
    if (!existingKeys.has(key)) {
      const html = buildElementPill(el, 0) + '\u00a0'
      editor.insertAdjacentHTML('beforeend', html)
      anyAdded = true
    }
  }

  // 3) 按顺序重编号所有 pill
  const finalPills = editor.querySelectorAll('.chat-pill')
  finalPills.forEach((pill, i) => {
    const num = pill.querySelector('.chat-pill-num')
    if (num) num.textContent = String(i + 1)
  })

  // 4) 同步 chatText（用于空判断）
  updateChatTextFromEditor()

  // 5) 有新增 pill 时，光标定到编辑器末尾（pill 后面，方便继续输入文字）
  if (anyAdded) {
    requestAnimationFrame(() => {
      if (_pillSyncLock !== lockId || !editor.isConnected) return
      const sel = window.getSelection()
      if (!sel) return
      sel.removeAllRanges()
      const range = document.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
      sel.addRange(range)
    })
  }

  // 6) 释放锁
  setTimeout(() => {
    if (_pillSyncLock === lockId) _pillSyncLock = 0
  }, 30)
}

watch(
  selectedDetectedElements,
  () => {
    if (chatSkipPillSync.value) return
    const detected = getSelectedDetectedElements()
    const addedLayers = new Set()
    for (const d of detected) {
      const layer = layers.value.find((l) => l.id === d.layerId)
      if (layer?.url && !addedLayers.has(layer.id)) {
        addedLayers.add(layer.id)
        addReversePromptReference(layer.url, layer.id)
      }
    }
    nextTick(() => syncPillsToEditor())
  },
  { deep: true },
)

// 元素序号位置：跟随点击位置，缩放时正确更新
function getElementClickStyle(key) {
  const pos = elementClickPositions.value[key]
  const [layerId, elId] = key.split('::')
  const elements = layerDetectedElements.value[layerId] || []
  const el = elements.find((e) => (e.object_name || e.name || e.id) === elId)
  if (!el) return {}
  const layer = layers.value.find((l) => l.id === layerId)
  if (!layer) return {}
  const box = normalizeBoxVal(el.box_2d || el.box2d || [0, 0, 1, 1])

  // 画布局部坐标（viewport 容器处理 scale+offset）
  const pad = 0
  const innerW = layer.width - pad * 2
  const innerH = layer.height - pad * 2

  // 如果有归一化的点击位置，使用它
  if (pos && pos.relX !== undefined && pos.relY !== undefined) {
    const boxLeft = layer.x + pad + box[0] * innerW
    const boxTop = layer.y + pad + box[1] * innerH
    const boxWidth = (box[2] - box[0]) * innerW
    const boxHeight = (box[3] - box[1]) * innerH

    return {
      left: `${boxLeft + pos.relX * boxWidth}px`,
      top: `${boxTop + pos.relY * boxHeight}px`,
    }
  }

  // 否则使用元素框中心点 — box = [x1, y1, x2, y2]
  const centerX = box[0] + (box[2] - box[0]) / 2
  const centerY = box[1] + (box[3] - box[1]) / 2
  return {
    left: `${layer.x + pad + centerX * innerW}px`,
    top: `${layer.y + pad + centerY * innerH}px`,
  }
}

// sendChat 执行锁：sendChat 运行期间，watch 触发的 resumeInterruptedPlaceholders 必须完全跳过，
// 否则 addChatMessages/addGeneratingPlaceholderLayer 触发的 layers 变化会让 watch
// 把"还没拿到 taskId 的新占位图"当成"需要恢复"的，抢先调 submitImageTask 导致重复提交。
let _sendChatActive = false

async function sendChat() {
  if (_sendChatActive) return // 仅挡 sendChat 重入；不再因"别的图在生成"而拒收，放开并发生图
  _sendChatActive = true
  const text = getEditorPrompt()
  const elementHint = buildElementLocationHint()
  // 优化后的提示词格式 - 坐标清晰明确
  let fullPrompt
  if (elementHint && elementHint.length > 0) {
    // GPT image 模型能直接"看到"参考图中的元素，不需要像素坐标
    // 只需用元素名称做定位指引，坐标信息对 GPT image 是噪声
    const elementNames = elementHint.map((el) => el.name).join('、')
    const userInstruction = text || '请根据元素类型进行适当修改'
    fullPrompt = `Edit the image: modify ${elementNames} — ${userInstruction}. Keep everything else unchanged.`
  } else {
    fullPrompt = text
  }
  const hasContent = text || getSelectedDetectedElements().length
  if (!hasContent) return
  if (!userStore.requireLogin()) return

  const createdAt = Date.now()
  const assistantId = `msg-${createdAt}-assistant`
  const chatImageUrls = chatReferenceImages.value
    .filter((image) => !image.uploading && !image.error)
    .map((image) => image.url)
    .filter((url) => url && !String(url).startsWith('blob:'))
  // 从当前选中元素计算参考图（只看当前选中，不看历史累积）
  const selectedRefLayers = new Set()
  for (const d of getSelectedDetectedElements()) {
    const layer = layers.value.find((l) => l.id === d.layerId)
    if (layer?.url && !String(layer.url).startsWith('blob:')) {
      selectedRefLayers.add(layer.url)
    }
  }
  const refImageUrls = [...selectedRefLayers]
  const imageUrls = [...new Set([...chatImageUrls, ...refImageUrls])]

  // 收集当前选中元素的详细信息（用于对话气泡渲染）
  const messageElements = getSelectedDetectedElements().map((el, idx) => {
    const layer = layers.value.find((l) => l.id === el.layerId)
    return {
      id: el.object_name || el.name || el.id,
      name: el.object_name || el.name || '',
      layerId: el.layerId,
      thumb: layer?.thumbnailUrl || '',
      box: el.box_2d || [],
      order: idx + 1,
    }
  })

  addChatMessages([
    {
      id: `msg-${createdAt}`,
      role: 'user',
      text,
      targetLayerId: selectedLayerId.value,
      createdAt,
      elements: messageElements,
      referenceImages: chatReferenceImages.value
        .filter((img) => !img.uploading && !img.error && img.url)
        .map((img) => ({ url: img.url })),
    },
    {
      id: assistantId,
      role: 'assistant',
      text: '已提交对话生图任务，请等待生成结果（生成完成后会显示在画布中）。',
      model: chatModel.value,
      ratio: chatRatio.value,
      resolution: chatResolution.value,
      createdAt: createdAt + 1,
      generating: true,
    },
  ])
  // 清空编辑器（pill + 文字）
  const editorEl = document.querySelector('.chat-editor')
  if (editorEl) editorEl.innerHTML = ''
  // 清空后把焦点移回输入框，并把光标归位到开头（避免浏览器自动插入的 <br> 把光标推到第二行）
  if (editorEl) {
    editorEl.focus()
    const sel = window.getSelection()
    if (sel) {
      const range = document.createRange()
      range.selectNodeContents(editorEl)
      range.collapse(true)   // true = 折叠到开头
      sel.removeAllRanges()
      sel.addRange(range)
    }
  }
  chatText.value = ''
  selectedDetectedElements.value = new Set()
  elementClickPositions.value = {}
  chatGenerating.value = true
  const placeholderId = await addGeneratingPlaceholderLayer(fullPrompt, {
    model: chatModel.value,
    ratio: chatRatio.value,
    resolution: chatResolution.value,
    referenceImageUrls: imageUrls,
  }, assistantId)
  // 标记此占位图正在主提交流程中，防止 watch 触发的 resumeInterruptedPlaceholders
  // 把它当作"需要恢复"的占位图而重复调 submitImageTask（导致一次提交2个生图请求）
  _submittingPlaceholderIds.add(placeholderId)
  let submitted = false

  try {
    const ph = layers.value.find((l) => l.id === placeholderId)
    const taskId = await submitImageTask({ prompt: fullPrompt, imageUrls, clientTaskId: ph?.clientTaskId || '' })
    submitted = true
    _sendChatActive = false // 首批 POST 已返回即开门，二批可在首批后台轮询期间进入
    updateChatMessage(assistantId, {
      taskId,
      text: `任务已提交，模型 ${chatModel.value}｜${chatRatio.value}｜${chatResolution.value}，正在生成...`,
    })
    updateGeneratingPlaceholder(placeholderId, { taskId, progress: 8, status: 'processing' })

    // 核心轮询逻辑（与刷新后恢复流程共用，统一走幂等守卫 startImagePoll）
    const done = await startImagePoll(taskId, placeholderId, assistantId, fullPrompt)
    if (!done) return
    // 历史记录已在 pollImageTaskUntilDone 的「图片落地」完成点统一写入
    // （聊天生图 A / 刷新恢复 B 共用 recordGenerationToHistory），此处不重复 push，避免双写。
  } catch (error) {
    const friendly = friendlyImageError(error.message || error)
    // 判断是否「页面刷新/导航导致的中断」而非真正失败：浏览器卸载会中断进行中的 fetch。
    // 注意：不再要求 !_mounted —— 卸载时 fetch 的 abort 可能在 onUnmounted 把 _mounted 置 false 之前就 reject，
    // 若加 !_mounted 守卫会误判为「提交阶段失败」进而误删占位图（即「立即刷新占位图消失」的根因）。
    // 发送路径里的 AbortError / TypeError / Failed to fetch 只可能来自导航中断（该 fetch 无其他 abort 来源），
    // 因此放宽判定是安全的，且「保留(标 interrupted)优于误删」。
    const isInterruption =
      error?.name === 'AbortError' ||
      error?.name === 'TypeError' ||
      error?.message === 'Failed to fetch'
    if (isInterruption) {
      // 刷新/导航中断：无论提交阶段还是轮询阶段，一律保留占位图，标记 interrupted 供 onMounted 恢复逻辑接管
      // （提交阶段中断时还没有 taskId，恢复逻辑会重新提交任务，见 resumeInterruptedNoTaskId）
      const current = layers.value.find((l) => l.id === placeholderId)
      updateGeneratingPlaceholder(placeholderId, {
        progress: current?.progress || 1,
        status: 'interrupted',
        statusText: '生成任务恢复中...',
        taskId: current?.taskId,
      })
      updateChatMessage(assistantId, { text: '生成任务已暂停（页面刷新），正在恢复...' })
    } else if (!submitted) {
      // 提交阶段失败（服务端报错 / 后端掉线 / 超时等）：保留占位图、标 failed，
      // 用户可手动重试。不再 removeLayer 静默消失（后端不稳定时会导致占位图突然消失）。
      const lastError = `[submitFail] ${error?.name || 'Error'}: ${error?.message || error}`
      updateGeneratingPlaceholder(placeholderId, {
        progress: 1,
        status: 'failed',
        statusText: friendly,
        lastError,
      })
      updateChatMessage(assistantId, {
        text: `生成失败：${friendly}`,
        generating: false,
      })
      showCopyPasteToast(friendly)
    } else {
      // 原始提交即失败（服务端明确报错，非刷新中断）：把真实错误存到图层，供后续排查
      const lastError = `[submitFail] ${error?.name || 'Error'}: ${error?.message || error}`
      updateGeneratingPlaceholder(placeholderId, {
        progress: 1,
        status: 'failed',
        statusText: friendly,
        lastError,
      })
      updateChatMessage(assistantId, {
        text: `生成失败：${friendly}`,
        generating: false,
      })
    }
  } finally {
    _sendChatActive = false
    _submittingPlaceholderIds.delete(placeholderId)
    chatGenerating.value = false
  }
}

function handleChatBoxClick(event) {
  if (!event.target.closest?.('.uc-upload-tile') || event.target.closest('footer')) return
  openImageUpload('chat')
}

function selectCanvasTool(tool) {
  if (!userStore.requireLogin()) return
  activeTool.value = tool.key
}

function startToolbarDrag(event) {
  if (event.button !== 0) return
  const toolbarNode = event.currentTarget.closest('.bottom-tools')
  const parentNode = event.currentTarget.closest('.editor-body')
  const rect = toolbarNode.getBoundingClientRect()
  const parentRect = parentNode.getBoundingClientRect()
  toolbar.dragging = {
    pointerId: event.pointerId,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    parentLeft: parentRect.left,
    parentTop: parentRect.top,
    parentWidth: parentRect.width,
    parentHeight: parentRect.height,
    width: rect.width,
    height: rect.height,
  }
  toolbar.x = Math.round(rect.left - parentRect.left)
  toolbar.y = Math.round(rect.top - parentRect.top)
  event.currentTarget.setPointerCapture(event.pointerId)
}

function moveToolbar(event) {
  if (!toolbar.dragging) return
  toolbar.x = Math.round(
    Math.max(
      0,
      Math.min(
        toolbar.dragging.parentWidth - toolbar.dragging.width,
        event.clientX - toolbar.dragging.parentLeft - toolbar.dragging.offsetX,
      ),
    ),
  )
  toolbar.y = Math.round(
    Math.max(
      0,
      Math.min(
        toolbar.dragging.parentHeight - toolbar.dragging.height,
        event.clientY - toolbar.dragging.parentTop - toolbar.dragging.offsetY,
      ),
    ),
  )
}

function stopToolbarDrag(event) {
  if (!toolbar.dragging) return
  if (event.currentTarget.hasPointerCapture(toolbar.dragging.pointerId))
    event.currentTarget.releasePointerCapture(toolbar.dragging.pointerId)
  toolbar.dragging = null
}

function startPanelDrag(event) {
  if (event.button !== 0) return
  const panelNode = event.currentTarget.closest('.right-panel')
  const parentNode = event.currentTarget.closest('.editor-body')
  const rect = panelNode.getBoundingClientRect()
  const parentRect = parentNode.getBoundingClientRect()
  panel.dragging = {
    pointerId: event.pointerId,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    parentLeft: parentRect.left,
    parentTop: parentRect.top,
    parentWidth: parentRect.width,
    parentHeight: parentRect.height,
    panelWidth: rect.width,
    panelHeight: rect.height,
  }
  panel.x = Math.round(rect.left - parentRect.left)
  panel.y = Math.round(rect.top - parentRect.top)
  event.currentTarget.setPointerCapture(event.pointerId)
}

function movePanel(event) {
  if (!panel.dragging) return
  const nextX = event.clientX - panel.dragging.parentLeft - panel.dragging.offsetX
  const nextY = event.clientY - panel.dragging.parentTop - panel.dragging.offsetY
  panel.x = Math.round(
    Math.max(0, Math.min(panel.dragging.parentWidth - panel.dragging.panelWidth, nextX)),
  )
  panel.y = Math.round(
    Math.max(0, Math.min(panel.dragging.parentHeight - panel.dragging.panelHeight, nextY)),
  )
}

function stopPanel(event) {
  if (!panel.dragging) return
  if (event.currentTarget.hasPointerCapture(panel.dragging.pointerId))
    event.currentTarget.releasePointerCapture(panel.dragging.pointerId)
  panel.dragging = null
}

function startPanelResize(event) {
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  const rect = event.currentTarget.closest('.right-panel').getBoundingClientRect()
  panel.resizing = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startLeft: rect.left,
    startWidth: rect.width,
  }
  event.currentTarget.setPointerCapture(event.pointerId)
}

function resizePanel(event) {
  if (!panel.resizing) return
  const nextWidth = Math.max(
    280,
    Math.min(560, panel.resizing.startWidth + panel.resizing.startX - event.clientX),
  )
  panel.width = Math.round(nextWidth)
  if (panel.x !== null) {
    panel.x = Math.round(panel.resizing.startLeft + panel.resizing.startWidth - panel.width)
  }
}

function stopPanelResize(event) {
  if (!panel.resizing) return
  if (event.currentTarget.hasPointerCapture(panel.resizing.pointerId))
    event.currentTarget.releasePointerCapture(panel.resizing.pointerId)
  panel.resizing = null
}

function startChatResize(event) {
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  const rect = event.currentTarget.closest('.right-panel').getBoundingClientRect()
  const minHeight = 230
  const maxHeight = Math.max(minHeight, Math.round(rect.height * (2 / 3)) - 24)
  panel.resizingChat = {
    pointerId: event.pointerId,
    startY: event.clientY,
    startHeight: panel.chatHeight,
    minHeight,
    maxHeight,
  }
  event.currentTarget.setPointerCapture(event.pointerId)
}

function resizeChatBox(event) {
  if (!panel.resizingChat) return
  const nextHeight = panel.resizingChat.startHeight + panel.resizingChat.startY - event.clientY
  panel.chatHeight = Math.max(
    panel.resizingChat.minHeight,
    Math.min(panel.resizingChat.maxHeight, Math.round(nextHeight)),
  )
}

function stopChatResize(event) {
  if (!panel.resizingChat) return
  if (event.currentTarget.hasPointerCapture(panel.resizingChat.pointerId))
    event.currentTarget.releasePointerCapture(panel.resizingChat.pointerId)
  panel.resizingChat = null
}

function startRPCardDrag(e) {
  if (e.button !== 0) return
  const node = e.currentTarget.closest('.reverse-prompt-mini-card')
  const parentNode = e.currentTarget.closest('.editor-body')
  const rect = node.getBoundingClientRect()
  const parentRect = parentNode.getBoundingClientRect()
  reversePromptCard.dragging = {
    pointerId: e.pointerId,
    offsetX: e.clientX - rect.left,
    offsetY: e.clientY - rect.top,
    parentLeft: parentRect.left,
    parentTop: parentRect.top,
    parentWidth: parentRect.width,
    parentHeight: parentRect.height,
    cardWidth: rect.width,
    cardHeight: rect.height,
  }
  reversePromptCard.x = Math.round(rect.left - parentRect.left)
  reversePromptCard.y = Math.round(rect.top - parentRect.top)
  e.currentTarget.setPointerCapture(e.pointerId)
}
function moveRPCard(e) {
  if (!reversePromptCard.dragging) return
  const nx = e.clientX - reversePromptCard.dragging.parentLeft - reversePromptCard.dragging.offsetX
  const ny = e.clientY - reversePromptCard.dragging.parentTop - reversePromptCard.dragging.offsetY
  reversePromptCard.x = Math.round(
    Math.max(
      0,
      Math.min(reversePromptCard.dragging.parentWidth - reversePromptCard.dragging.cardWidth, nx),
    ),
  )
  reversePromptCard.y = Math.round(
    Math.max(
      0,
      Math.min(reversePromptCard.dragging.parentHeight - reversePromptCard.dragging.cardHeight, ny),
    ),
  )
}
function stopRPCard(e) {
  if (!reversePromptCard.dragging) return
  e.currentTarget.releasePointerCapture(reversePromptCard.dragging.pointerId)
  reversePromptCard.dragging = null
}

function zoom(delta, center = null) {
  if (center && center.fit) {
    fitCanvasView()
    return
  }
  canvas.updateDocument(props.id, (draft) => {
    const oldScale = draft.payload.view.scale || 1
    const nextScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number((oldScale + delta).toFixed(2))))
    const offset = draft.payload.view.offset || { x: 0, y: 0 }
    draft.payload.view.scale = nextScale
    if (center) {
      const worldX = (center.x - offset.x) / oldScale
      const worldY = (center.y - offset.y) / oldScale
      draft.payload.view.offset = {
        x: Math.round(center.x - worldX * nextScale),
        y: Math.round(center.y - worldY * nextScale),
      }
    }
    return draft
  })
}
function fitCanvasView() {
  canvas.updateDocument(props.id, (draft) => {
    const layersList = draft.payload.layers || []
    if (!layersList.length) {
      draft.payload.view.scale = 1
      draft.payload.view.offset = { x: 0, y: 0 }
      return draft
    }
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (const l of layersList) {
      if (l.x < minX) minX = l.x
      if (l.y < minY) minY = l.y
      if (l.x + (l.width || 1) > maxX) maxX = l.x + (l.width || 1)
      if (l.y + (l.height || 1) > maxY) maxY = l.y + (l.height || 1)
    }
    const w = maxX - minX + 120,
      h = maxY - minY + 120
    const fitScale = Math.min(viewportSize.width / w, viewportSize.height / h, 2)
    draft.payload.view.scale = Math.round(fitScale * 1000) / 1000
    draft.payload.view.offset = {
      x: Math.round(
        (viewportSize.width - w * draft.payload.view.scale) / 2 - minX * draft.payload.view.scale,
      ),
      y: Math.round(
        (viewportSize.height - h * draft.payload.view.scale) / 2 - minY * draft.payload.view.scale,
      ),
    }
    return draft
  })
}

function wheelZoom(event) {
  event.preventDefault()
  // Ctrl/Cmd + 滚轮 → 缩放画布
  if (event.ctrlKey || event.metaKey) {
    const rect = event.currentTarget.getBoundingClientRect()
    const delta = event.deltaY > 0 ? -0.05 : 0.05
    zoom(delta, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    })
    nextTick(() => refreshConnections())
    return
  }
  // 普通滚轮 → 平移画布
  const dx = event.deltaX || 0
  const dy = event.deltaY || 0
  canvas.updateDocument(props.id, (draft) => {
    const offset = draft.payload.view.offset || { x: 0, y: 0 }
    draft.payload.view.offset = {
      x: Math.round(offset.x - dx),
      y: Math.round(offset.y - dy),
    }
    return draft
  })
  nextTick(() => refreshConnections())
}

function startMarquee(event) {
  if (event.button !== 0) return

  // 点击空白区域取消连接线选中
  if (
    !event.target.closest('.connection-group') &&
    !event.target.closest('.connection-delete-btn')
  ) {
    deselectConnection()
  }

  const isAnnotate = activeTool.value === 'annotate'
  const withCtrl = event.ctrlKey || event.metaKey

  // Ctrl模式下：单击（不拖拽）AI元素框 → 选中/取消选中元素
  // 由于 CSS 让 ctrl-mode 下元素框 pointer-events:none，点击穿透到 stage，
  // 所以用 findElementsAtPoint 在 JS 层面检测是否命中了元素
  if (withCtrl && !isAnnotate && activeTool.value !== 'hand') {
    if (
      !event.target.closest?.(
        '.manual-name-input, .layer-toolbar, .bottom-tools, .top-tools, .right-panel, .annotate-banner, .manual-element-delete',
      )
    ) {
      const candidates = findElementsAtPoint(event.clientX, event.clientY)
      if (candidates.length) {
        // 命中元素 → 选中/取消，不画框
        handleDetectedOverlayClick(event)
        return
      }
      // 没命中元素 → 继续走画框逻辑（下面 isCtrlDraw 分支）
    }
  }

  // 标注模式 或 Ctrl+拖拽：手动画框添加元素
  const isCtrlDraw = withCtrl && !isAnnotate && activeTool.value !== 'hand'
  if (isAnnotate || isCtrlDraw) {
    // 排除 UI 控件
    if (
      event.target.closest?.(
        '.manual-name-input, .layer-toolbar, .bottom-tools, .top-tools, .right-panel, .annotate-banner, .manual-element-delete',
      )
    )
      return
    // 如果命名框正在显示，先确认当前元素再开始新框选
    if (manualNameInput.visible) {
      confirmManualElementName()
    }
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const rect = event.currentTarget.getBoundingClientRect()
    manualBoxDraft.active = true
    manualBoxDraft.startX = event.clientX - rect.left
    manualBoxDraft.startY = event.clientY - rect.top
    manualBoxDraft.currentX = manualBoxDraft.startX
    manualBoxDraft.currentY = manualBoxDraft.startY
    // 找到框下面的图层
    const picked = [...event.currentTarget.querySelectorAll('.canvas-layer')]
      .filter((node) => {
        const r = node.getBoundingClientRect()
        return (
          r.left < event.clientX &&
          r.right > event.clientX &&
          r.top < event.clientY &&
          r.bottom > event.clientY
        )
      })
      .map((node) => node.dataset.layerId)
    manualBoxDraft.layerId = picked[0] || selectedLayerId.value || layers.value[0]?.id || ''
    return
  }

  // 手形工具：拖动画布 — 用轻量 reactive 更新，节流提交 store
  if (activeTool.value === 'hand') {
    if (
      event.target.closest?.('.layer-toolbar, .resize-dot, .bottom-tools, .top-tools, .right-panel')
    )
      return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const offset = doc.value.payload.view.offset || { x: 0, y: 0 }
    panOffset.x = offset.x
    panOffset.y = offset.y
    panState.value = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    }
    return
  }

  if (event.target !== event.currentTarget) return
  const rect = event.currentTarget.getBoundingClientRect()
  event.currentTarget.setPointerCapture(event.pointerId)
  marquee.active = true
  marquee.startX = event.clientX - rect.left
  marquee.startY = event.clientY - rect.top
  marquee.currentX = marquee.startX
  marquee.currentY = marquee.startY
  selectedLayerId.value = ''
  selectedLayerIds.value = []
}

/** stage pointermove 统一处理：手动框选拖拽 + 连接线拖拽 + 选框拖拽 + 画布平移 */
function onStagePointerMove(event) {
  moveMarquee(event)
  updateConnectionDrag(event)
}

function commitPanOffset() {
  if (!panState.value) return
  canvas.updateDocument(props.id, (draft) => {
    draft.payload.view.offset = { x: panOffset.x, y: panOffset.y }
    return draft
  })
}

function moveMarquee(event) {
  if (panState.value) {
    const dx = event.clientX - panState.value.startX
    const dy = event.clientY - panState.value.startY
    panState.value._pendingDx = (panState.value._pendingDx || 0) + dx
    panState.value._pendingDy = (panState.value._pendingDy || 0) + dy
    panState.value.startX = event.clientX
    panState.value.startY = event.clientY

    // 直写 DOM transform：零延迟跟手，不等 rAF / Vue patch
    const x = Math.round(panOffset.x + (panState.value._pendingDx || 0))
    const y = Math.round(panOffset.y + (panState.value._pendingDy || 0))
    if (!_panDomEl) _panDomEl = document.querySelector('.canvas-viewport')
    if (_panDomEl) {
      _panDomEl.style.transform = `translate(${x}px, ${y}px) scale(${viewScale.value})`
    }

    // rAF 同步 Vue reactive（供 computed/watch 使用）
    if (!_panRafId) {
      _panRafId = requestAnimationFrame(() => {
        _panRafId = null
        const pd = panState.value
        if (!pd) return
        panOffset.x = Math.round(panOffset.x + (pd._pendingDx || 0))
        panOffset.y = Math.round(panOffset.y + (pd._pendingDy || 0))
        pd._pendingDx = 0
        pd._pendingDy = 0
        // 拖动期间零 commitPanOffset，松手时一次性 commit（消灭 Immer 深拷贝卡顿）
      })
    }
    return
  }

  if (manualBoxDraft.active) {
    const rect = event.currentTarget.getBoundingClientRect()
    manualBoxDraft.currentX = event.clientX - rect.left
    manualBoxDraft.currentY = event.clientY - rect.top
    // 拖拽超过 4px 才显示框，避免点击时闪现红点
    const dx = Math.abs(manualBoxDraft.currentX - manualBoxDraft.startX)
    const dy = Math.abs(manualBoxDraft.currentY - manualBoxDraft.startY)
    if (dx > 4 || dy > 4) {
      manualBoxDraft.visible = true
    }
    return
  }

  if (!marquee.active) return
  const rect = event.currentTarget.getBoundingClientRect()
  marquee.currentX = event.clientX - rect.left
  marquee.currentY = event.clientY - rect.top
}

function stopMarquee(event) {
  if (panState.value) {
    if (event.currentTarget.hasPointerCapture(panState.value.pointerId))
      event.currentTarget.releasePointerCapture(panState.value.pointerId)
    // 刷新 pending rAF delta，确保最终位置准确
    if (_panRafId) {
      cancelAnimationFrame(_panRafId)
      _panRafId = null
      const pd = panState.value
      if (pd) {
        panOffset.x = Math.round(panOffset.x + (pd._pendingDx || 0))
        panOffset.y = Math.round(panOffset.y + (pd._pendingDy || 0))
      }
    }
    // 松开时立即提交最终位置
    if (panCommitTimer) {
      clearTimeout(panCommitTimer)
      panCommitTimer = null
    }
    commitPanOffset()
    panState.value = null
    nextTick(() => refreshConnections()) // 平移结束后刷新连接线
    return
  }

  if (manualBoxDraft.active) {
    if (event.currentTarget.hasPointerCapture)
      event.currentTarget.releasePointerCapture(event.pointerId)
    createManualElement()
    manualBoxDraft.active = false
    manualBoxDraft.visible = false
    return
  }

  if (!marquee.active) return
  const stageRect = event.currentTarget.getBoundingClientRect()
  const box = {
    left: stageRect.left + Math.min(marquee.startX, marquee.currentX),
    top: stageRect.top + Math.min(marquee.startY, marquee.currentY),
    right: stageRect.left + Math.max(marquee.startX, marquee.currentX),
    bottom: stageRect.top + Math.max(marquee.startY, marquee.currentY),
  }
  const picked = [...event.currentTarget.querySelectorAll('.canvas-layer')]
    .filter((node) => {
      const rect = node.getBoundingClientRect()
      return (
        rect.left < box.right &&
        rect.right > box.left &&
        rect.top < box.bottom &&
        rect.bottom > box.top
      )
    })
    .map((node) => node.dataset.layerId)
  selectedLayerIds.value = picked
  selectedLayerId.value = picked[picked.length - 1] || ''
  marquee.active = false
}

// 注释掉：初始化时 nextTick 会自动选中第一层，覆盖 onMounted 的清空逻辑
// nextTick(() => {
//   if (!selectedLayerId.value) selectedLayerId.value = layers.value[0]?.id || ''
//   if (selectedLayerId.value && !selectedLayerIds.value.length)
//     selectedLayerIds.value = [selectedLayerId.value]
// })

// 全局快捷键
function onGlobalKeydown(event) {
  const tag = String(event.target?.tagName || '').toLowerCase()
  const inInput =
    tag === 'input' || tag === 'textarea' || tag === 'select' || event.target?.isContentEditable
  // Esc 退出连接模式
  if (event.key === 'Escape' && connecting.active) {
    connecting.active = false
    return
  }
  if (event.key === 'Escape') {
    if (helpMenuOpen.value) {
      helpMenuOpen.value = false
      return
    }
    if (shortcutsOpen.value) {
      shortcutsOpen.value = false
      return
    }
  }
  if (event.key === 'Delete') {
    if (inInput) return
    // 优先删除选中的元素框（含手动元素）
    if (selectedDetectedElements.value.size > 0) {
      event.preventDefault()
      pushUndo() // 删除元素框也入栈，支持撤销
      const nextLayers = { ...layerDetectedElements.value }
      for (const key of selectedDetectedElements.value) {
        const [layerId, elId] = key.split('::')
        if (nextLayers[layerId]) {
          nextLayers[layerId] = nextLayers[layerId].filter(
            (e) => (e.object_name || e.name || e.id) !== elId,
          )
          if (!nextLayers[layerId].length) delete nextLayers[layerId]
        }
      }
      layerDetectedElements.value = nextLayers
      selectedDetectedElements.value = new Set()
      elementClickPositions.value = {}
      // 持久化到文档
      canvas.updateDocument(props.id, (draft) => {
        draft.payload.detectedElements = JSON.parse(JSON.stringify(layerDetectedElements.value))
        return draft
      })
      return
    }
    // 否则删除选中图层（支持多选批量删除）
    const idsToDelete =
      selectedLayerIds.value.length > 1
        ? selectedLayerIds.value
        : selectedLayerId.value
          ? [selectedLayerId.value]
          : []
    if (idsToDelete.length > 0 && idsToDelete.length < layers.value.length) {
      event.preventDefault()
      if (!userStore.requireLogin()) return
      pushUndo()
      for (const id of idsToDelete) {
        if (playingVideoLayerId.value === id) playingVideoLayerId.value = null
        connections.value = connections.value.filter(
          (c) => c.fromLayerId !== id && c.toLayerId !== id,
        )
      }
      canvas.updateDocument(props.id, (draft) => {
        const deleteSet = new Set(idsToDelete)
        draft.payload.layers = draft.payload.layers.filter((layer) => !deleteSet.has(layer.id))
        draft.payload.connections = connections.value
        return draft
      })
      selectedLayerId.value = layers.value[0]?.id || ''
      selectedLayerIds.value = selectedLayerId.value ? [selectedLayerId.value] : []
    }
  }
  // 图片复制 / 粘贴（Ctrl+C / Ctrl+V），不干扰 Delete / Ctrl+Z / 工具快捷键
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey) {
    const ck = event.key.toLowerCase()
    if (ck === 'c') {
      if (inInput) return
      // 若用户正在选区文字（如对话气泡），交给浏览器原生复制，不拦截、不写图片到剪贴板
      const sel = window.getSelection && window.getSelection()
      if (sel && sel.toString().trim()) return
      event.preventDefault()
      copySelectedImage()
      return
    }
    if (ck === 'v') {
      if (inInput) return
      event.preventDefault()
      pasteImage().catch(() => {})
      return
    }
  }
  if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
    if (inInput) return
    event.preventDefault()
    const snapshot = undoStack.value.pop()
    if (snapshot && doc.value) {
      // 标记撤销恢复中，阻止 watch 触发自动检测
      _undoRestoring.value = true
      // 兼容旧格式（纯数组）和新格式（含检测数据的对象）
      const layersData = Array.isArray(snapshot) ? snapshot : snapshot.layers
      // 关键修复：先恢复 layerDetectedElements（如果快照里有），这样 layers watch 触发时新图层的检测数据已就位
      if (!Array.isArray(snapshot) && snapshot.detectedElements) {
        layerDetectedElements.value = snapshot.detectedElements
        // 同步持久化到文档
        canvas.updateDocument(props.id, (draft) => {
          draft.payload.detectedElements = snapshot.detectedElements
          return draft
        })
      }
      if (!Array.isArray(snapshot) && snapshot.selectedDetectedElements) {
        selectedDetectedElements.value = new Set(snapshot.selectedDetectedElements)
      }
      // 然后才恢复 layers
      canvas.updateDocument(props.id, (draft) => {
        draft.payload.layers = layersData
        return draft
      })
      selectedLayerId.value = layersData[0]?.id || ''
      selectedLayerIds.value = selectedLayerId.value ? [selectedLayerId.value] : []
      // 恢复连接线数据
      if (!Array.isArray(snapshot) && snapshot.connections) {
        connections.value = snapshot.connections
        // 撤销后把连接线落库到 payload
        canvas.updateDocument(props.id, (draft) => {
          draft.payload.connections = connections.value
          return draft
        })
      }
      // 只删除已不存在的图层的检测数据
      const currentLayerIds = new Set(layersData.map((l) => l.id))
      const nextDetected = { ...layerDetectedElements.value }
      let pruned = false
      for (const lid of Object.keys(nextDetected)) {
        if (!currentLayerIds.has(lid)) {
          delete nextDetected[lid]
          pruned = true
        }
      }
      if (pruned) layerDetectedElements.value = nextDetected
      // 清除已不存在的图层的选中元素
      const nextSelected = new Set()
      for (const key of selectedDetectedElements.value) {
        const [lid] = key.split('::')
        if (currentLayerIds.has(lid)) nextSelected.add(key)
      }
      selectedDetectedElements.value = nextSelected
      // 关键：先解除撤销标记，再等 watch 全部执行完毕
      // 用 setTimeout 而非 nextTick，确保 deep watch 全部触发完毕
      setTimeout(() => {
        _undoRestoring.value = false
      }, 100)
    }
  }
  // 工具快捷键
  if (!inInput) {
    const keyMap = { v: 'select', h: 'hand', f: 'focus', m: 'annotate' }
    const tool = keyMap[event.key.toLowerCase()]
    if (tool) {
      event.preventDefault()
      activeTool.value = tool
    }
    // I 快捷键：添加图片占位节点
    if (event.key.toLowerCase() === 'i') {
      event.preventDefault()
      addImageNode()
    }
  }
}

// Undo stack（同时保存图层和元素检测数据，撤销时一起恢复）
const undoStack = ref([])
function pushUndo() {
  if (doc.value?.payload?.layers) {
    undoStack.value.push({
      layers: JSON.parse(JSON.stringify(doc.value.payload.layers)),
      connections: JSON.parse(JSON.stringify(connections.value)),
      detectedElements: JSON.parse(JSON.stringify(layerDetectedElements.value)),
      selectedDetectedElements: [...selectedDetectedElements.value],
    })
    if (undoStack.value.length > 50) undoStack.value.shift()
  }
}

// Ctrl state
const ctrlHeld = ref(false)

function addGenerationRecordToCanvas(record) {
  if (!record.imageUrl) return
  addImageLayerFromUrl(record.imageUrl, '生图记录复用', record.prompt || '')
}

function useGenerationRecordAsReference(record) {
  if (!record.imageUrl) return
  chatReferenceImages.value.push({
    id: `ref-${Date.now()}`,
    url: record.imageUrl,
    name: `记录 ${new Date(record.createdAt).toLocaleString()}`,
    uploading: false,
  })
  activeChatReferenceId.value = chatReferenceImages.value.at(-1)?.id || ''
}

function reuseGenerationRecordPrompt(record) {
  chatText.value = record.prompt || ''
  // 同时复制到剪贴板
  if (record.prompt) {
    navigator.clipboard.writeText(record.prompt).catch(() => {})
  }
}

function removeGenerationRecord(id) {
  generationHistory.value = generationHistory.value.filter((r) => r.id !== id)
  canvas.updateDocument(props.id, (draft) => {
    draft.payload.generationHistory = generationHistory.value.slice(-200)
    return draft
  })
  debounceSaveLayout()
}

onMounted(() => {
  // 确保页面重新加载/画布初始化时所有图层默认未选中
  selectedLayerId.value = ''
  selectedLayerIds.value = []
  _mounted.value = true
  updateViewportSize()
  window.addEventListener('resize', updateViewportSize)
  window.addEventListener('keydown', onGlobalKeydown)
  loadUILayout()
  // 连接线/历史/模型参数已从 payload 初始化，这里仅做孤儿连接线清洗
  initDocState()
  // 建立 pill 删除监听 — MutationObserver 比 @input 更可靠
  nextTick(() => setupPillObserver())
  // 恢复已缓存的检测元素（清除旧版错误归一化的缓存）
  const cachedElements = doc.value?.payload?.detectedElements
  if (cachedElements) {
    let hasBadData = false
    for (const els of Object.values(cachedElements)) {
      if (Array.isArray(els)) {
        for (const el of els) {
          const box = el.box_2d || el.box2d || []
          // 检查是否有坏数据：值超出 0-1 范围，或者坐标不合理
          if (box.some((v) => Math.abs(v) > 1.05) || box.length !== 4) {
            hasBadData = true
            break
          }
          // 检查坐标是否有效（top < bottom, left < right）
          if (box[0] >= box[2] || box[1] >= box[3]) {
            hasBadData = true
            break
          }
        }
      }
      if (hasBadData) break
    }
    if (hasBadData) {
      // 旧版归一化 bug 导致的数据，清除缓存让用户重新检测
      canvas.updateDocument(props.id, (draft) => {
        draft.payload.detectedElements = {}
        return draft
      })
      layerDetectedElements.value = {}
    } else {
      // 对缓存数据进行归一化处理，确保坐标在 0-1 范围
      const normalized = {}
      for (const [layerId, els] of Object.entries(cachedElements)) {
        if (Array.isArray(els)) {
          normalized[layerId] = els.map((el) => {
            const box = normalizeBoxVal(el.box_2d || el.box2d || [0, 0, 1, 1])
            return { ...el, box_2d: box, box2d: box }
          })
        }
      }
      layerDetectedElements.value = normalized
    }
  }
  // 聊天记录滚动到底部（最后一条消息）
  scrollChatToBottom()
  // 恢复被页面刷新/导航中断的生图任务：扫描所有「非终态 + 带 taskId」的占位图层并继续轮询。
  // 与具体状态词解耦（经 normalizeStatus 归一），覆盖「纯生成中刷新」(APIMart 的 IN_PROGRESS/PENDING/GENERATING、
  // 中转站代理自有词等) 这种原本白名单匹配不上的 case；时机 B(persisting)/C(completed) 仍按原逻辑正常完成。
  // 另见组件级 watch：服务端 doc 合并（syncFromServer）异步覆盖本地图层后也会幂等重扫。
  // 延迟 ~400ms 触发：onMounted 刚挂载时 Vite 代理 / 鉴权请求可能尚未就绪，过早重提易触发
  // 「Failed to fetch」被误判为失败；延迟后首轮重提命中率更高。
  setTimeout(() => { resumeInterruptedPlaceholders(); retryFailedNoTaskPlaceholders(); cleanupDeadPlaceholders(); purgeEmptyUrlPlaceholders() }, 400)
  const onCtrlDown = (e) => {
    if (e.key === 'Control') ctrlHeld.value = true
  }
  const onCtrlUp = (e) => {
    if (e.key === 'Control') ctrlHeld.value = false
  }
  window.addEventListener('keydown', onCtrlDown)
  window.addEventListener('keyup', onCtrlUp)
  // Ctrl+滚轮缩放已移除，不再需要 capture 监听
  // 连接模式下全局 mousemove 跟踪，确保拖拽线始终跟随鼠标
  const onGlobalMouseMove = (e) => {
    if (connecting.active) {
      const pos = screenToStage(e.clientX, e.clientY)
      connecting.currentX = pos.x
      connecting.currentY = pos.y
    }
  }
  window.addEventListener('mousemove', onGlobalMouseMove)
  const onDocClick = (e) => {
    // 如果点击在 shortcuts 面板内，不要关闭 helpMenu
    if (e.target.closest?.('.shortcuts-backdrop, .shortcuts-panel')) return
    toolbarAddOpen.value = false
    helpMenuOpen.value = false
    chatSelectOpen.value = null
    // 关闭右键菜单
    if (contextMenu.visible) contextMenu.visible = false
    // 点击历史面板外部关闭（面板内 click.stop 已阻止冒泡，这里捕获不到）
  }
  window.addEventListener('click', onDocClick)
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onCtrlDown)
    window.removeEventListener('keyup', onCtrlUp)
    window.removeEventListener('mousemove', onGlobalMouseMove)
    window.removeEventListener('click', onDocClick)
    window.removeEventListener('resize', updateViewportSize)
    if (_pillObserver) {
      _pillObserver.disconnect()
      _pillObserver = null
    }
    window.removeEventListener('keydown', onGlobalKeydown)
    // 清理所有定时器
    clearTimeout(_manualBlurTimer)
    // 卸载前确保全局 UI 布局已落库（避免 300ms 防抖未触发导致丢失）
    if (_layoutSaveTimer) {
      clearTimeout(_layoutSaveTimer)
      _layoutSaveTimer = null
      saveUILayout()
    }
  })
})

onBeforeUnmount(() => {
  _mounted.value = false
  // 暂停所有正在播放的视频
  document.querySelectorAll('video.uc-video-node-video').forEach((v) => {
    if (!v.paused) v.pause()
  })
  playingVideoLayerId.value = null
  chatReferenceImages.value.forEach((image) => {
    if (image.localUrl?.startsWith('blob:')) URL.revokeObjectURL(image.localUrl)
  })
})

// 监听 layers 变化时同步元素检测数据到 layerDetectedElements
watch(
  () => doc.value?.payload?.layers,
  () => syncDetectionFromLayers(),
  { deep: true, immediate: true },
)
watch(
  () => doc.value?.payload?.layers?.length,
  () => syncDetectionFromLayers(),
)

// ============ 主题切换 ============
import { useTheme } from '../composables/useTheme'
const { cycle: cycleTheme, isDark } = useTheme()
function themeIcon() {
  return isDark() ? '☀' : '☾'
}
function themeLabel() {
  return isDark() ? '开灯（切换到浅色）' : '关灯（切换到深色）'
}

// ========== 我的素材库 ==========
function toggleMyMaterials() {
  myMaterialsOpen.value = !myMaterialsOpen.value
  if (myMaterialsOpen.value) {
    toolbarAddOpen.value = false
    historyPanelOpen.value = false
  }
}
function toggleHistoryPanel() {
  historyPanelOpen.value = !historyPanelOpen.value
  if (historyPanelOpen.value) {
    toolbarAddOpen.value = false
    myMaterialsOpen.value = false
  }
}
function addLayerToMaterials(layer) {
  if (!layer || !layer.url) return
  const exists = myMaterials.value.some((m) => m.url === layer.url)
  if (exists) return // 不重复添加
  myMaterials.value.unshift({
    id: `mat-${Date.now()}`,
    url: layer.url,
    name: layer.name || '素材',
    width: layer.width,
    height: layer.height,
    source: layer.source,
    detectPrompt: layer.detectPrompt,
    addedAt: Date.now(),
  })
  localStorage.setItem('youmi_my_materials', JSON.stringify(myMaterials.value))
}
function removeMaterial(matId) {
  myMaterials.value = myMaterials.value.filter((m) => m.id !== matId)
  localStorage.setItem('youmi_my_materials', JSON.stringify(myMaterials.value))
}
function addMaterialToCanvas(mat) {
  const maxZ = layers.value.reduce((max, l) => Math.max(max, l.zIndex || 0), 0)
  canvas.updateDocument(props.id, (draft) => {
    draft.payload.layers.push({
      id: String(Date.now()).slice(-6),
      type: 'image',
      name: mat.name,
      url: mat.url,
      x: Math.round(100 + Math.random() * 200),
      y: Math.round(100 + Math.random() * 200),
      width: mat.width || 400,
      height: mat.height || 400,
      naturalWidth: mat.width || 400,
      naturalHeight: mat.height || 400,
      zIndex: maxZ + 1,
      source: mat.source,
      detectPrompt: mat.detectPrompt,
    })
    return draft
  })
}
// 右键菜单
const contextMenu = reactive({ visible: false, x: 0, y: 0, layerId: null, layer: null })
function onCanvasContextMenu(event) {
  // 右键拖动画布后不弹菜单
  if (panState.value) {
    panState.value = null
    return
  }
  // 找到右键点击的图层
  const layerEl = event.target.closest('.canvas-layer')
  if (!layerEl) return
  const layerId = layerEl.dataset.layerId
  const layer = layers.value.find((l) => l.id === layerId)
  if (!layer || !layer.url) return
  event.preventDefault()
  contextMenu.visible = true
  contextMenu.x = event.clientX
  contextMenu.y = event.clientY
  contextMenu.layerId = layerId
  contextMenu.layer = layer
}
function closeContextMenu() {
  contextMenu.visible = false
}
function contextMenuAddToMaterials() {
  if (contextMenu.layer) addLayerToMaterials(contextMenu.layer)
  closeContextMenu()
}
function contextMenuDeleteLayer() {
  if (contextMenu.layerId) removeLayer(contextMenu.layerId)
  closeContextMenu()
}
function contextMenuDownloadLayer() {
  const layer = contextMenu.layer
  if (!layer || !layer.url) return
  console.log('[contextMenuDownloadLayer] url:', layer.url, 'name:', layer.name)
  downloadFileByUrl(layer.url, layer.name || 'image')
  closeContextMenu()
}
function contextMenuAddToReference() {
  // 支持多选：如果右键的图层在已选中列表中，把所有选中的图片图层都加为参考图
  const targetId = contextMenu.layerId
  const ids =
    selectedLayerIds.value.length > 1 && selectedLayerIds.value.includes(targetId)
      ? [...selectedLayerIds.value]
      : [targetId]
  let added = 0
  for (const id of ids) {
    const layer = layers.value.find((l) => l.id === id)
    if (!layer || !layer.url) continue
    // 避免重复添加
    const exists = chatReferenceImages.value.some((img) => img.url === layer.url)
    if (exists) continue
    chatReferenceImages.value.push({
      id: `ref-${Date.now()}-${id}`,
      url: layer.url,
      name: layer.name || '参考图',
      uploading: false,
    })
    added++
  }
  if (added > 0) {
    activeChatReferenceId.value = chatReferenceImages.value.at(-1)?.id || ''
  }
  closeContextMenu()
}

// ====== 宫格裁图 ======

function openCropPicker(x, y, layer) {
  const layerRef = layer || contextMenu.layer
  if (!layerRef) return
  cropPickerOpen.value = true
  cropPickerX.value = x
  cropPickerY.value = y
  cropMode.layerId = layerRef.id
  cropMode.rows = 3
  cropMode.cols = 3
  cropMode.selectedCells = new Set()
  closeContextMenu()
}

function confirmCropPicker() {
  cropPickerOpen.value = false
  cropMode.active = true
}

function cancelCropPicker() {
  cropPickerOpen.value = false
  exitCropMode()
}

function enterQuickCrop(cols, rows) {
  const layer = contextMenu.layer
  if (!layer) return
  cropMode.layerId = layer.id
  cropMode.rows = rows
  cropMode.cols = cols
  cropMode.selectedCells = new Set()
  cropMode.active = true
  closeContextMenu()
}

function exitCropMode() {
  cropMode.active = false
  cropMode.layerId = null
  cropMode.selectedCells = new Set()
}

function toggleCellSelect(cellIdx) {
  const idx = cellIdx + 1 // 1-based
  const set = new Set(cropMode.selectedCells)
  if (set.has(idx)) {
    set.delete(idx)
  } else {
    set.add(idx)
  }
  cropMode.selectedCells = set
}

function toggleCellShift(cellIdx, event) {
  if (event.shiftKey) {
    const idx = cellIdx + 1
    const set = new Set(cropMode.selectedCells)
    set.add(idx)
    cropMode.selectedCells = set
  } else {
    toggleCellSelect(cellIdx)
  }
}

function selectAllCells() {
  const total = cropMode.rows * cropMode.cols
  const all = new Set()
  for (let i = 1; i <= total; i++) all.add(i)
  cropMode.selectedCells = all
}

function invertCells() {
  const total = cropMode.rows * cropMode.cols
  const next = new Set()
  for (let i = 1; i <= total; i++) {
    if (!cropMode.selectedCells.has(i)) next.add(i)
  }
  cropMode.selectedCells = next
}

function isCropCellSelected(cellIdx) {
  return cropMode.selectedCells.has(cellIdx + 1)
}

async function executeCrop() {
  const layer = layers.value.find((l) => l.id === cropMode.layerId)
  if (!layer || !layer.url) {
    showCopyPasteToast('裁图失败：图层无效或缺少图片')
    exitCropMode()
    return
  }
  if (cropMode.selectedCells.size === 0) {
    showCopyPasteToast('请先选择要裁剪的格子')
    return
  }

  pushUndo()

  const img = await loadImageForCrop(layer)
  if (!img) {
    console.error('[crop] 图片加载失败')
    showCopyPasteToast('图片加载失败，无法裁图')
    exitCropMode()
    return
  }

  const natW = img.naturalWidth || layer.naturalWidth || layer.width
  const natH = img.naturalHeight || layer.naturalHeight || layer.height
  const cellW = natW / cropMode.cols
  const cellH = natH / cropMode.rows
  const displayCellW = layer.width / cropMode.cols
  const displayCellH = layer.height / cropMode.rows
  const childW = layer.width // 子图层跟母图一样大
  const childH = layer.height

  const newLayers = []
  const baseZ = Math.max(...layers.value.map((l) => l.zIndex || 0), 0) + 1

  for (const cellIdx of [...cropMode.selectedCells].sort((a, b) => a - b)) {
    const row = Math.floor((cellIdx - 1) / cropMode.cols)
    const col = (cellIdx - 1) % cropMode.cols
    // 错位排开：每多一个子图往右下偏移 24px，避免完全重叠看不清
    const offsetIdx = [...cropMode.selectedCells].sort((a, b) => a - b).indexOf(cellIdx)
    const offsetX = layer.x + offsetIdx * 24
    const offsetY = layer.y + offsetIdx * 24

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(cellW)
    canvas.height = Math.round(cellH)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(
      img,
      Math.round(col * cellW),
      Math.round(row * cellH),
      Math.round(cellW),
      Math.round(cellH),
      0,
      0,
      canvas.width,
      canvas.height,
    )

    // 上传 OSS
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'))
    let ossUrl
    try {
      const formData = new FormData()
      formData.append('file', blob, `${layer.name || 'image'}_${cellIdx}.png`)
      const uploadRes = await fetch(apiPath('/api/v1/file/upload'), {
        method: 'POST',
        headers: { ...userStore.authHeaders() },
        body: formData,
      })
      const uploadData = await readApiResponse(uploadRes)
      ossUrl = uploadData?.url || uploadData?.fileUrl || uploadData?.fullUrl
    } catch (e) {
      console.warn('[crop] OSS 上传失败，使用 blob URL:', e)
      ossUrl = URL.createObjectURL(blob)
    }

    newLayers.push({
      id: `crop-${Date.now()}-${cellIdx}`,
      type: 'image',
      name: `${layer.name || 'image'}_${cellIdx}`,
      url: ossUrl,
      naturalWidth: canvas.width,
      naturalHeight: canvas.height,
      width: Math.max(1, Math.round(childW)),
      height: Math.max(1, Math.round(childH)),
      x: offsetX,
      y: offsetY,
      zIndex: baseZ + cellIdx,
      source: '宫格裁图',
    })
  }

  canvas.updateDocument(props.id, (draft) => {
    draft.payload.layers.push(...newLayers)
    return draft
  })

  showCopyPasteToast(`已生成 ${newLayers.length} 个裁图`)

  exitCropMode()
}

async function loadImageForCrop(layer) {
  // OSS 图片已被 <img> 非 CORS 加载过 → 浏览器缓存无 CORS 头
  // 直接 crossOrigin='anonymous' 会命中缓存 → tainted canvas 安全错误
  // 必须 fetch 强制走 CORS 网络请求，拿到 blob 后给 Image
  try {
    const sep = layer.url.includes('?') ? '&' : '?'
    const res = await fetch(layer.url + sep + '_crop=' + Date.now(), { mode: 'cors' })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const blob = await res.blob()
    const blobUrl = URL.createObjectURL(blob)
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = blobUrl
      setTimeout(() => resolve(img.complete ? img : null), 8000)
    })
  } catch (e) {
    console.error('[crop] fetch 失败，尝试 crossOrigin:', e)
    return new Promise((resolve) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = layer.url + '?_cv=' + Date.now()
      setTimeout(() => resolve(img.complete ? img : null), 8000)
    })
  }
}
</script>

<template>
  <main class="editor">
    <header class="editor-head glass-header">
      <div class="head-left">
        <button class="logo logo-link" type="button" @click="router.push('/')">YOUMI</button>
        <span>·</span>
        <b>万能画布</b>
        <span>/</span>
        <button>✎ {{ doc.title }}</button>
        <em>已保存 · 刚刚</em>
      </div>
      <div class="head-actions">
        <button
          class="theme-toggle"
          type="button"
          :title="themeLabel()"
          :aria-label="themeLabel()"
          @click="cycleTheme"
        >
          <span class="theme-toggle__icon">{{ themeIcon() }}</span>
        </button>
        <button
          class="panel-visibility-btn"
          :class="{ active: getDetectionVisible() }"
          :title="getDetectionVisible() ? '隐藏视觉框' : '显示视觉框'"
          @click="setDetectionVisible(!getDetectionVisible())"
        >
          {{ getDetectionVisible() ? '👁' : '🚫' }}
        </button>
        <button
          class="panel-visibility-btn"
          :class="{ active: rightPanelVisible }"
          :title="rightPanelVisible ? '隐藏对话框' : '显示对话框'"
          @click="rightPanelVisible = !rightPanelVisible"
        >
          ▮
        </button>
        <button @click="router.push('/canvas')">×</button>
      </div>
    </header>

    <section class="editor-body">
      <div class="top-tools">
        <button @click="router.push('/canvas')">▣ 我的画布列表</button>
        <div class="add-image">
          <input
            ref="fileInput"
            type="file"
            accept="image/*,video/*"
            multiple
            hidden
            @change="onFileChange"
          />
          <!-- 添加文件按钮已移除，通过工具栏或快捷键 I 添加 -->
        </div>
      </div>

      <!-- 标记工具提示横幅：放在 stage 外面，避免被 stage 的 pointerdown / setPointerCapture 拦截 -->
      <aside v-if="activeTool === 'annotate'" class="annotate-banner">
        <div class="annotate-banner-text">
          <strong>标记工具</strong>
          <span>拖拽画框 → 手动添加元素到输入框</span>
          <span>点击画布元素 → 选中加入输入框</span>
          <span>
            其他工具下
            <kbd>Ctrl+点击</kbd>
            也可选中元素
          </span>
        </div>
        <button type="button" class="annotate-banner-close" @click="activeTool = 'select'">
          退出标记
        </button>
      </aside>

      <!-- 左侧 + 号分类菜单栏（已合并到 bottom-tools 的 uc-toolbar-add-btn 弹层） -->
      <div
        :class="[
          'stage',
          {
            'hand-tool': activeTool === 'hand',
            'annotate-tool': activeTool === 'annotate',
            'is-panning': panState,
            'is-connecting': connecting.active,
          },
        ]"
        @wheel.prevent="wheelZoom"
        @pointerdown="startMarquee($event)"
        @pointermove="onStagePointerMove($event)"
        @pointerup="onStagePointerUp($event)"
        @pointercancel="onStagePointerUp($event)"
        @contextmenu.prevent="onCanvasContextMenu($event)"
        @pointerdown.right="onStageRightDown($event)"
      >
        <!-- 智能对齐辅助线 -->
        <div
          v-for="(guide, idx) in snapGuides"
          :key="'snap-' + idx"
          class="uc-snap-guide"
          :class="'uc-snap-guide--' + guide.type"
          :style="guide.type === 'v' ? { left: guide.pos + 'px' } : { top: guide.pos + 'px' }"
        />
        <!-- 上传进度条 -->
        <div v-if="uploadProgress" class="upload-progress-overlay">
          <div class="upload-progress-card">
            <span class="upload-progress-label">上传中 {{ uploadProgress.fileName }}</span>
            <div class="upload-progress-track">
              <div class="upload-progress-fill" :style="{ width: `${uploadProgress.percent}%` }" />
            </div>
            <span class="upload-progress-pct">{{ uploadProgress.percent }}%</span>
          </div>
        </div>
        <div v-if="layers.length === 0" class="start-card">
          <i>▧</i>
          <h2>开始你的画布</h2>
          <p>把图片直接拖到这里，或按下面的快捷键</p>
          <dl>
            <dt>拖入图片</dt>
            <dd>或 .yq 画布文件 即可添加到画布</dd>
            <dt>空格</dt>
            <dd>长按 + 左键拖动 即可平移画布</dd>
            <dt>A</dt>
            <dd>打开“添加图片”面板，从本地或生成历史导入</dd>
          </dl>
        </div>

        <!-- 画布平移+缩放容器：拖动时只更新这一个元素，不触发 N 个图层重排 -->
        <div
          class="canvas-viewport"
          :style="{
            transform: `translate(${viewOffset.x}px, ${viewOffset.y}px) scale(${viewScale})`,
            transformOrigin: '0 0',
          }"
        >
          <figure
            v-for="layer in layers"
            :key="layer.id"
            :data-layer-id="layer.id"
            :class="[
              'canvas-layer',
              {
                selected: selectedLayerIds.includes(layer.id),
                'multi-selected':
                  selectedLayerIds.length > 1 && selectedLayerIds.includes(layer.id),
                'is-placeholder': layer.type === 'placeholder',
                'is-text': layer.type === 'text',
                'is-video': layer.type === 'video',
                'is-video-placeholder': layer.type === 'video' && !layer.url,
                'is-image': layer.type === 'image' || (layer.url && !layer.type),
                'is-image-placeholder': layer.type === 'image-placeholder',
                'is-failed': layer.status === 'failed',
                'is-interrupted': layer.status === 'interrupted',
                'is-dragging': dragState && dragState.ids.includes(layer.id),
              },
            ]"
            :style="{
              transform: `translate(${layer.x}px, ${layer.y}px)`,
              width: `${layer.width}px`,
              height:
                layer.type === 'placeholder' ||
                layer.type === 'text' ||
                layer.type === 'video' ||
                layer.type === 'image-placeholder'
                  ? `${layer.height}px`
                  : undefined,
              zIndex: layer.zIndex,
              '--canvas-inverse-scale': 1 / viewScale,
            }"
            @pointerdown="startLayerDrag($event, layer)"
            @pointermove="moveLayer"
            @pointerup="stopLayerDrag"
            @pointercancel="stopLayerDrag"
            @dblclick="onLayerDblClick($event, layer)"
          >
            <div
              v-if="layer.type !== 'placeholder' && detectingLayerIds.has(layer.id)"
              class="layer-detecting-overlay"
            >
              <span class="layer-detecting-spinner" />
              <span class="layer-detecting-text">AI 检测元素中...</span>
            </div>
            <template
              v-if="
                layer.type !== 'placeholder' &&
                layer.type !== 'text' &&
                layer.type !== 'image-placeholder' &&
                !(layer.type === 'video' && !layer.url) &&
                layer.id === selectedLayerId &&
                selectedLayerIds.length <= 1
              "
            >
              <div class="layer-toolbar">
                <button>✂ 智能抠图</button>
                <button @click.stop="maybeAutoDetect(selectedLayer, true)">
                  <template v-if="selectedLayer && detectingLayerIds.has(selectedLayer.id)">
                    ⏳ 检测中...
                  </template>
                  <template v-else>◈ 智能分层</template>
                </button>
                <button>T 编辑文字</button>
                <button>↔ 扩图</button>
                <button>☏ 对话修改</button>
                <button>▧ 尺寸修改</button>
                <button @click.stop="openCropPicker(0, 0, layer)">⌗ 裁剪</button>
                <button>✂ 分割</button>
                <button>⇩ 下载</button>
                <button @click.stop="removeLayer(layer.id)">⌫ 删除</button>
              </div>
            </template>
            <template v-if="layer.type === 'placeholder'">
              <div
                class="uc-layer-placeholder-card"
                :style="{
                  '--placeholder-preview': layer.previewUrl ? `url(${layer.previewUrl})` : 'none',
                }"
              >
                <div class="loading-card-container size-md">
                  <div class="virtual-progress-bar">
                    <div
                      class="virtual-progress-fill"
                      :style="{ width: `${Math.max(3, Math.min(100, layer.progress || 0))}%` }"
                    />
                  </div>
                  <div class="logo-wrapper">
                    <svg
                      class="uc-placeholder-icon-svg"
                      viewBox="0 0 80 80"
                      fill="none"
                      aria-label="生成中"
                    >
                      <circle
                        cx="40"
                        cy="40"
                        r="36"
                        stroke="currentColor"
                        stroke-width="1.5"
                        opacity="0.15"
                      />
                      <circle
                        cx="40"
                        cy="40"
                        r="36"
                        stroke="currentColor"
                        stroke-width="2.5"
                        stroke-dasharray="70 156"
                        stroke-linecap="round"
                        class="uc-icon-spin-ring"
                      />
                      <path
                        d="M28 34a12 12 0 0 1 24 0"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        fill="none"
                        class="uc-icon-pulse-arc"
                      />
                      <circle
                        cx="32"
                        cy="40"
                        r="2"
                        fill="currentColor"
                        opacity="0.6"
                        class="uc-icon-dot1"
                      />
                      <circle
                        cx="40"
                        cy="38"
                        r="2.5"
                        fill="currentColor"
                        opacity="0.8"
                        class="uc-icon-dot2"
                      />
                      <circle
                        cx="48"
                        cy="40"
                        r="2"
                        fill="currentColor"
                        opacity="0.6"
                        class="uc-icon-dot3"
                      />
                      <path
                        d="M34 48c2 3 10 3 12 0"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                        fill="none"
                        opacity="0.5"
                      />
                    </svg>
                  </div>
                  <span class="progress-percent">
                    {{ Math.min(99, Math.round(layer.progress || 0)) }}%
                  </span>
                  <p class="dynamic-text">
                    {{ layer.statusText || '灵感信号已捕获，创意引擎启动中...' }}
                  </p>
                </div>
                <button
                  class="uc-placeholder-close"
                  type="button"
                  title="移除这张执行卡（不影响后台任务）"
                  @pointerdown.stop
                  @click.stop="removeLayer(layer.id)"
                >
                  ×
                </button>
              </div>
            </template>
            <template v-else-if="layer.type === 'text'">
              <!-- 文本节点：暖金品牌色选中态 + 提示词标签 -->
              <div class="uc-text-node">
                <!-- 图层标签：类型+时间 -->
                <div class="uc-layer-label">
                  <i class="ri-text"></i>
                  {{ layer.name }}
                  <small>{{ formatLayerTime(layer) }}</small>
                </div>
                <div class="uc-text-node-area">
                  <span
                    v-if="editingTextLayerId !== layer.id"
                    class="uc-text-node-span"
                    :style="{
                      fontSize: (layer.fontSize || 14) + 'px',
                      color: layer.color || '#999',
                      textAlign: layer.align || 'left',
                    }"
                  >
                    {{ layer.text || '双击开始编辑...' }}
                  </span>
                  <textarea
                    v-else
                    ref="textEditRef"
                    v-model="editingTextValue"
                    class="uc-text-edit-input"
                    @blur="finishEditText"
                    @keydown.escape.prevent="finishEditText"
                    @pointerdown.stop
                  ></textarea>
                </div>
                <div class="uc-text-node-hint" @pointerdown.stop @click.stop.exact>
                  <i class="ri-edit-line"></i>
                  提示词
                </div>
                <button
                  class="uc-node-close"
                  type="button"
                  title="删除文本节点"
                  @pointerdown.stop
                  @click.stop="removeLayer(layer.id)"
                >
                  ×
                </button>
                <!-- 左右连接点 -->
                <div
                  class="uc-connection-port uc-port-left"
                  @pointerdown.stop="startConnection($event, layer.id, 'left')"
                  @pointerup.stop="finishConnection($event, layer.id, 'left')"
                >
                  +
                </div>
                <div
                  class="uc-connection-port uc-port-right"
                  @pointerdown.stop="startConnection($event, layer.id, 'right')"
                  @pointerup.stop="finishConnection($event, layer.id, 'right')"
                >
                  +
                </div>
              </div>
            </template>
            <template v-else-if="layer.type === 'image-placeholder'">
              <!-- 图片占位节点：暖金品牌色 + 虚线框 + 图标 + 提示词 -->
              <div class="uc-image-placeholder">
                <!-- 图层标签 -->
                <div class="uc-layer-label">
                  <i class="ri-image-line"></i>
                  {{ layer.name }}
                  <small>{{ formatLayerTime(layer) }}</small>
                </div>
                <div class="uc-image-placeholder-inner">
                  <div class="uc-placeholder-icon">
                    <i class="ri-image-line"></i>
                  </div>
                </div>
                <div class="uc-text-node-hint" @pointerdown.stop @click.stop.exact>
                  <i class="ri-edit-line"></i>
                  提示词
                </div>
                <button
                  class="uc-node-close"
                  type="button"
                  title="删除图片节点"
                  @pointerdown.stop
                  @click.stop="removeLayer(layer.id)"
                >
                  ×
                </button>
                <!-- 左右连接点 -->
                <div
                  class="uc-connection-port uc-port-left"
                  @pointerdown.stop="startConnection($event, layer.id, 'left')"
                  @pointerup.stop="finishConnection($event, layer.id, 'left')"
                >
                  +
                </div>
                <div
                  class="uc-connection-port uc-port-right"
                  @pointerdown.stop="startConnection($event, layer.id, 'right')"
                  @pointerup.stop="finishConnection($event, layer.id, 'right')"
                >
                  +
                </div>
              </div>
            </template>
            <template v-else-if="layer.type === 'video'">
              <div class="uc-video-node">
                <!-- 图层标签 -->
                <div class="uc-layer-label">
                  <i class="ri-video-line"></i>
                  {{ layer.name }}
                  <small>{{ formatLayerTime(layer) }}</small>
                </div>
                <template v-if="layer.url">
                  <!-- 有视频内容 -->
                  <div
                    class="uc-video-node-inner"
                    :class="{ 'is-playing': playingVideoLayerId === layer.id }"
                    @mouseenter="hoverPlayVideo(layer)"
                    @mouseleave="hoverPauseVideo(layer)"
                  >
                    <video
                      :src="layer.url"
                      muted
                      loop
                      preload="metadata"
                      playsinline
                      class="uc-video-node-video"
                      @pointerdown.stop
                      @play="playingVideoLayerId = layer.id"
                      @pause="
                        playingVideoLayerId =
                          playingVideoLayerId === layer.id ? null : playingVideoLayerId
                      "
                      @ended="
                        playingVideoLayerId =
                          playingVideoLayerId === layer.id ? null : playingVideoLayerId
                      "
                    ></video>
                    <button
                      class="uc-video-play-btn"
                      @pointerdown.stop
                      @click.stop="playVideoNode(layer)"
                    >
                      <i
                        :class="playingVideoLayerId === layer.id ? 'ri-pause-fill' : 'ri-play-fill'"
                      ></i>
                    </button>
                  </div>
                </template>
                <template v-else>
                  <!-- 视频占位态：暖金品牌色 + 虚线框 + 图标 + 提示词 -->
                  <div class="uc-image-placeholder-inner">
                    <div class="uc-placeholder-icon">
                      <i class="ri-video-line"></i>
                    </div>
                  </div>
                  <div class="uc-text-node-hint" @pointerdown.stop @click.stop.exact>
                    <i class="ri-edit-line"></i>
                    提示词
                  </div>
                </template>
                <button
                  class="uc-node-close"
                  type="button"
                  title="删除视频节点"
                  @pointerdown.stop
                  @click.stop="removeLayer(layer.id)"
                >
                  ×
                </button>
                <!-- 左右连接点 -->
                <div
                  class="uc-connection-port uc-port-left"
                  @pointerdown.stop="startConnection($event, layer.id, 'left')"
                  @pointerup.stop="finishConnection($event, layer.id, 'left')"
                >
                  +
                </div>
                <div
                  class="uc-connection-port uc-port-right"
                  @pointerdown.stop="startConnection($event, layer.id, 'right')"
                  @pointerup.stop="finishConnection($event, layer.id, 'right')"
                >
                  +
                </div>
              </div>
            </template>
            <template v-else>
              <!-- 图片节点（含已上传内容）：与占位态保持一致的 UI 结构 -->
              <div class="uc-image-node">
                <div class="uc-layer-label">
                  <i class="ri-image-line"></i>
                  {{ layer.name }}
                  <small>{{ formatLayerTime(layer) }}</small>
                </div>
                <div class="uc-image-node-inner">
                  <img
                    v-if="!brokenImages.has(layer.id)"
                    :src="layer.url"
                    :alt="layer.name"
                    draggable="false"
                    @error="markImageBroken(layer.id)"
                  />
                  <div v-else class="uc-image-broken">
                    <i class="ri-image-line"></i>
                    <span>图片加载失败</span>
                    <button type="button" class="uc-broken-retry" @click="retryImage(layer.id)">
                      重试
                    </button>
                  </div>
                </div>
                <div class="uc-text-node-hint" @pointerdown.stop @click.stop.exact>
                  <i class="ri-edit-line"></i>
                  提示词
                </div>
                <button
                  class="uc-node-close"
                  type="button"
                  title="删除图片节点"
                  @pointerdown.stop
                  @click.stop="removeLayer(layer.id)"
                >
                  ×
                </button>
                <!-- 左右连接点 -->
                <div
                  class="uc-connection-port uc-port-left"
                  @pointerdown.stop="startConnection($event, layer.id, 'left')"
                  @pointerup.stop="finishConnection($event, layer.id, 'left')"
                >
                  +
                </div>
                <div
                  class="uc-connection-port uc-port-right"
                  @pointerdown.stop="startConnection($event, layer.id, 'right')"
                  @pointerup.stop="finishConnection($event, layer.id, 'right')"
                >
                  +
                </div>
              </div>
            </template>
            <template
              v-if="
                layer.type !== 'placeholder' &&
                layer.type !== 'text' &&
                layer.type !== 'image' &&
                layer.type !== 'image-placeholder' &&
                layer.type !== 'video' &&
                !(layer.url && !layer.type) &&
                layer.id === selectedLayerId &&
                selectedLayerIds.length <= 1
              "
            >
              <i
                v-for="point in [
                  'top-left',
                  'top',
                  'top-right',
                  'right',
                  'bottom-right',
                  'bottom',
                  'bottom-left',
                  'left',
                ]"
                :key="point"
                :class="['resize-dot', point]"
                @pointerdown="startResize($event, layer, point)"
                @pointermove="resizeLayer"
                @pointerup="stopResize"
                @pointercancel="stopResize"
              />
            </template>
          </figure>

          <!-- 连接线 SVG 层（z-index:5 低于节点的10，连接线显示在节点下方） -->
          <svg class="connections-layer">
            <!-- 已建立的连接线 -->
            <g v-for="conn in getConnectionPaths()" :key="conn.id" class="connection-group">
              <!-- 透明宽点击区域（方便选中） -->
              <path
                :d="conn.path"
                class="connection-line-hitarea"
                @click.stop="selectConnection($event, conn.id)"
              />
              <!-- 可视连接线 -->
              <path
                :d="conn.path"
                class="connection-line"
                :class="{ selected: selectedConnection.id === conn.id }"
              />
              <!-- 连接点圆圈：可点击选中连接线 -->
              <circle
                :cx="conn.fromX"
                :cy="conn.fromY"
                r="4"
                class="connection-dot connection-dot-clickable"
                @click.stop="selectConnection($event, conn.id)"
              />
              <circle
                :cx="conn.toX"
                :cy="conn.toY"
                r="4"
                class="connection-dot connection-dot-clickable"
                @click.stop="selectConnection($event, conn.id)"
              />
            </g>
            <!-- 正在拖拽的连接线 -->
            <path v-if="connecting.active" :d="connectingPath" class="connection-line connecting" />
          </svg>
          <!-- 连接线删除按钮：viewport-local 坐标，跟随画布缩放 -->
          <div
            v-if="selectedConnection.id"
            class="connection-delete-btn"
            :style="{
              left: selectedConnection.localX + 'px',
              top: selectedConnection.localY + 'px',
            }"
            @pointerdown.stop
            @click.stop="deleteSelectedConnection"
          >
            <i class="ri-scissors-line"></i>
            <span>删除</span>
          </div>

          <!-- 元素检测框 overlay：标注/Ctrl模式下不拦截鼠标，让事件穿透到 stage -->
          <div
            :class="[
              'detected-elements-overlay',
              {
                'annotate-mode': activeTool === 'annotate',
                'ctrl-mode': ctrlHeld && activeTool !== 'annotate',
                'detection-visible': getDetectionVisible(),
              },
            ]"
          >
            <template v-for="(elements, layerId) in layerDetectedElements" :key="layerId">
              <template
                v-for="(el, eIdx) in elements"
                :key="`${layerId}::${el.object_name || el.name || el.id || `e${eIdx}`}`"
              >
                <div
                  v-if="
                    layers.find((l) => l.id === layerId) &&
                    !isElementBlocked(layerId, el.box_2d || el.box2d || [0, 0, 1, 1])
                  "
                  class="detected-element-box"
                  :class="{
                    selected: selectedDetectedElements.has(
                      `${layerId}::${el.object_name || el.name || el.id || `e${eIdx}`}`,
                    ),
                  }"
                  :style="
                    (function () {
                      const layer = layers.find((l) => l.id === layerId)
                      const box = el.box_2d || el.box2d || [0, 0, 1, 1]
                      // box_2d = [x1, y1, x2, y2] = [left, top, right, bottom]
                      const pad = 0
                      const innerW = layer.width - pad * 2
                      const innerH = layer.height - pad * 2
                      return {
                        left: `${layer.x + pad + box[0] * innerW}px`,
                        top: `${layer.y + pad + box[1] * innerH}px`,
                        width: `${Math.max(2, (box[2] - box[0]) * innerW)}px`,
                        height: `${Math.max(2, (box[3] - box[1]) * innerH)}px`,
                      }
                    })()
                  "
                >
                  <span class="detected-element-label">
                    {{ el.object_name || el.name || '元素' }}
                  </span>
                  <!-- 手动框选元素：右上角显示 × 删除按钮 -->
                  <button
                    v-if="el.manual"
                    class="manual-element-delete"
                    title="删除手动元素"
                    @mousedown.stop
                    @pointerdown.stop
                    @click.stop="removeManualElement(layerId, el)"
                  >
                    ×
                  </button>
                </div>
                <span
                  v-if="
                    selectedDetectedElements.has(
                      `${layerId}::${el.object_name || el.name || el.id || `e${eIdx}`}`,
                    ) && !isElementBlocked(layerId, el.box_2d || el.box2d || [0, 0, 1, 1])
                  "
                  class="detected-element-index"
                  :style="
                    getElementClickStyle(
                      `${layerId}::${el.object_name || el.name || el.id || `e${eIdx}`}`,
                    )
                  "
                >
                  {{
                    [...selectedDetectedElements].indexOf(
                      `${layerId}::${el.object_name || el.name || el.id || `e${eIdx}`}`,
                    ) + 1
                  }}
                </span>
              </template>
            </template>
          </div>

          <!-- 宫格裁图 SVG 网格叠加层 -->
          <svg
            v-if="cropMode.active && cropMode.layerId"
            class="crop-grid-overlay"
            :style="{
              position: 'absolute',
              left: `${layers.find((l) => l.id === cropMode.layerId)?.x || 0}px`,
              top: `${layers.find((l) => l.id === cropMode.layerId)?.y || 0}px`,
              width: `${layers.find((l) => l.id === cropMode.layerId)?.width || 0}px`,
              height: `${layers.find((l) => l.id === cropMode.layerId)?.height || 0}px`,
              zIndex: 9998,
              pointerEvents: 'auto',
            }"
          >
            <!-- 网格线 -->
            <line
              v-for="r in cropMode.rows - 1"
              :key="'hr' + r"
              :x1="0"
              :y1="
                ((layers.find((l) => l.id === cropMode.layerId)?.height || 0) * r) / cropMode.rows
              "
              :x2="layers.find((l) => l.id === cropMode.layerId)?.width || 0"
              :y2="
                ((layers.find((l) => l.id === cropMode.layerId)?.height || 0) * r) / cropMode.rows
              "
              stroke="white"
              stroke-opacity="0.5"
              stroke-width="1"
              stroke-dasharray="4,4"
            />
            <line
              v-for="c in cropMode.cols - 1"
              :key="'vr' + c"
              :x1="
                ((layers.find((l) => l.id === cropMode.layerId)?.width || 0) * c) / cropMode.cols
              "
              :y1="0"
              :x2="
                ((layers.find((l) => l.id === cropMode.layerId)?.width || 0) * c) / cropMode.cols
              "
              :y2="layers.find((l) => l.id === cropMode.layerId)?.height || 0"
              stroke="white"
              stroke-opacity="0.5"
              stroke-width="1"
              stroke-dasharray="4,4"
            />
            <!-- 格子遮罩 + 编号 -->
            <g v-for="(cell, cellIdx) in cropMode.rows * cropMode.cols" :key="'cell' + cellIdx">
              <rect
                :x="
                  ((layers.find((l) => l.id === cropMode.layerId)?.width || 0) *
                    (cellIdx % cropMode.cols)) /
                  cropMode.cols
                "
                :y="
                  ((layers.find((l) => l.id === cropMode.layerId)?.height || 0) *
                    Math.floor(cellIdx / cropMode.cols)) /
                  cropMode.rows
                "
                :width="(layers.find((l) => l.id === cropMode.layerId)?.width || 0) / cropMode.cols"
                :height="
                  (layers.find((l) => l.id === cropMode.layerId)?.height || 0) / cropMode.rows
                "
                :fill="isCropCellSelected(cellIdx) ? 'rgba(0,120,255,0.3)' : 'transparent'"
                stroke="transparent"
                style="cursor: pointer"
                @click="toggleCellShift(cellIdx, $event)"
              />
              <text
                :x="
                  ((layers.find((l) => l.id === cropMode.layerId)?.width || 0) *
                    (cellIdx % cropMode.cols)) /
                    cropMode.cols +
                  (layers.find((l) => l.id === cropMode.layerId)?.width || 0) / cropMode.cols / 2
                "
                :y="
                  ((layers.find((l) => l.id === cropMode.layerId)?.height || 0) *
                    Math.floor(cellIdx / cropMode.cols)) /
                    cropMode.rows +
                  (layers.find((l) => l.id === cropMode.layerId)?.height || 0) / cropMode.rows / 2
                "
                text-anchor="middle"
                dominant-baseline="central"
                fill="white"
                font-size="14"
                font-weight="bold"
                style="pointer-events: none; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7)"
              >
                {{ cellIdx + 1 }}
              </text>
            </g>
          </svg>
        </div>
        <!-- end canvas-viewport -->

        <!-- stage 层级 overlay：使用 stage 像素坐标，不进入 viewport（避免被 scale 变换影响） -->
        <div v-if="marquee.active" class="selection-marquee" :style="marqueeStyle" />
        <div v-if="manualBoxDraft.visible" class="manual-box-draft" :style="manualBoxDraftStyle" />
        <div
          v-if="manualNameInput.visible"
          class="manual-name-input"
          :style="{ left: `${manualNameInput.x}px`, top: `${manualNameInput.y}px` }"
          @pointerdown.stop
        >
          <input
            ref="manualNameInputRef"
            v-model="manualNameInput.text"
            placeholder="输入元素名称..."
            @keydown.enter.prevent="confirmManualElementName"
            @keydown.escape.prevent="cancelManualElementName"
            @blur="onManualNameInputBlur"
          />
          <button @mousedown.prevent="confirmManualElementName">✓</button>
          <button @mousedown.prevent="cancelManualElementName">✕</button>
        </div>
      </div>

      <aside
        v-if="layers.length && minimapVisible"
        class="canvas-minimap"
        :style="{ width: `${canvasMinimap.width}px`, height: `${canvasMinimap.height}px` }"
        aria-label="画布地图"
        @pointerdown.stop="startMinimapPan"
        @pointermove.stop="moveMinimapPan"
        @pointerup.stop="stopMinimapPan"
        @pointercancel.stop="stopMinimapPan"
      >
        <header>
          <strong>地图</strong>
          <span>{{ layers.length }} 张</span>
        </header>
        <div class="canvas-minimap-plane">
          <i
            v-for="layer in canvasMinimap.layers"
            :key="layer.id"
            :class="[
              'canvas-minimap-layer',
              'minimap-type-' + (layer.type || 'image'),
              { selected: layer.selected, placeholder: layer.type === 'placeholder' },
            ]"
            :style="layer.style"
          ></i>
          <b class="canvas-minimap-viewport" :style="canvasMinimap.viewportStyle"></b>
        </div>
      </aside>

      <div class="canvas-zoom-bar" aria-label="画布缩放">
        <button class="zoom-bar-icon-btn" title="适应画布" @click="zoom(0, { fit: true })">
          <i class="ri-aspect-ratio-line"></i>
        </button>
        <button
          class="zoom-bar-icon-btn minimap-toggle-btn"
          :class="{ active: minimapVisible }"
          title="地图"
          @click="minimapVisible = !minimapVisible"
        >
          <i class="ri-map-pin-line"></i>
        </button>
        <div class="zoom-bar-slider-wrap">
          <input
            type="range"
            class="zoom-bar-slider"
            min="0"
            max="100"
            :value="zoomSliderValue"
            @input="setZoomFromSlider($event.target.value)"
          />
        </div>
        <button @click="zoom(-0.08)"><i class="ri-subtract-line"></i></button>
        <strong title="点击重置 100%" @click="zoomSliderReset">
          {{ Math.round(viewScale * 100) }}%
        </strong>
        <button @click="zoom(0.08)"><i class="ri-add-line"></i></button>
        <div class="zoom-bar-sep"></div>
        <button
          class="zoom-bar-help-btn"
          :class="{ active: helpMenuOpen }"
          title="帮助"
          @click.stop="openHelpMenu"
        >
          ?
        </button>
      </div>

      <!-- 反推提示词卡片：隐藏大图，参考图 URL 仍传给生图 API -->
      <aside
        v-if="false"
        class="reverse-prompt-mini-card uc-floating"
        aria-label="反推提示词卡片"
        @pointerdown.stop=""
      ></aside>

      <nav
        class="bottom-tools uc-sidebar-tools uc-floating uc-floating-toolbar is-docked"
        aria-label="画布工具栏"
        @pointerdown.stop
      >
        <div ref="addMenuWrapEl" class="uc-toolbar-add-wrap">
          <button
            type="button"
            class="uc-sidebar-tool-btn uc-toolbar-add-btn"
            :class="{ active: toolbarAddOpen }"
            title="添加节点"
            @click.stop="toggleToolbarAdd()"
          >
            <i class="ri-add-line" aria-hidden="true"></i>
          </button>
        </div>
        <button
          v-for="tool in canvasTools"
          :key="tool.key"
          type="button"
          class="uc-sidebar-tool-btn"
          :class="{ active: activeTool === tool.key }"
          :title="tool.label"
          @click="selectCanvasTool(tool)"
        >
          <i :class="tool.icon" aria-hidden="true"></i>
          <span v-if="tool.shortcut" class="uc-sidebar-tool-key">{{ tool.shortcut }}</span>
        </button>
        <div class="uc-sidebar-tool-sep"></div>
        <button
          type="button"
          class="uc-sidebar-tool-btn"
          :class="{ active: myMaterialsOpen }"
          title="我的素材"
          @click.stop="toggleMyMaterials()"
        >
          <i class="ri-folder-image-line" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          class="uc-sidebar-tool-btn"
          :class="{ active: historyPanelOpen }"
          title="历史记录"
          @click.stop="toggleHistoryPanel()"
        >
          <i class="ri-history-line" aria-hidden="true"></i>
        </button>
      </nav>

      <aside
        v-if="rightPanelVisible"
        class="right-panel uc-left uc-rightpanel uc-floating uc-floating-panel"
        :style="{
          width: `${panel.width}px`,
          ...(panel.x === null ? {} : { left: `${panel.x}px`, top: `${panel.y}px`, right: 'auto' }),
        }"
      >
        <div
          class="panel-resize-handle"
          title="调节对话窗口宽度"
          @pointerdown="startPanelResize"
          @pointermove="resizePanel"
          @pointerup="stopPanelResize"
          @pointercancel="stopPanelResize"
        />
        <header class="uc-left-tabs uc-floating-drag-handle">
          <button
            class="uc-left-tab"
            :class="{ active: rightTab === 'chat' }"
            @click="rightTab = 'chat'"
          >
            <i class="ri-chat-3-line" aria-hidden="true"></i>
            <span>对话窗口</span>
          </button>
          <button
            class="uc-left-tab"
            :class="{ active: rightTab === 'layers' }"
            @click="rightTab = 'layers'"
          >
            <i class="ri-stack-line" aria-hidden="true"></i>
            <span>图层窗口</span>
          </button>
          <button
            class="panel-drag uc-rightpanel-toggle-btn uc-floating uc-floating-toggle is-docked"
            title="拖动右侧面板"
            @pointerdown="startPanelDrag"
            @pointermove="movePanel"
            @pointerup="stopPanel"
            @pointercancel="stopPanel"
          >
            <i class="ri-contract-right-line" aria-hidden="true"></i>
          </button>
        </header>

        <section v-if="rightTab === 'chat'" class="chat-panel uc-chat">
          <div
            ref="chatHistoryRef"
            class="chat-history uc-chat-history"
            @mouseover="handleChatPillEnter"
            @mousemove="handleChatPillMove"
            @mouseout="handleChatPillLeave"
            @click="handleGenPreviewClick"
            @dblclick="handleGenPreviewDblClick"
          >
            <div
              v-for="message in chatMessages"
              :key="message.id"
              :class="[
                'uc-chat-msg',
                message.role === 'user' ? 'uc-chat-msg--user' : 'uc-chat-msg--assistant',
              ]"
            >
              <div class="uc-chat-msg-wrap">
                <div class="uc-chat-msg-bubble" v-html="renderMessageContent(message)"></div>
                <div v-if="message.role === 'assistant' && message.model" class="uc-chat-msg-meta">
                  {{ message.model }} · {{ message.ratio }} · {{ message.resolution }} ·
                  {{ formatMetaTime(message.createdAt) }}
                </div>
              </div>
            </div>
            <div v-if="!chatMessages.length" class="chat-empty">
              <i>☏</i>
              <strong>对话生图：通过自然语言修改画布上的图片</strong>
              <span>点选画布上的图片，再描述你想要的修改</span>
            </div>
          </div>
          <!-- 悬停预览弹窗 -->
          <Teleport to="body">
            <div
              v-if="hoverPreview.visible && hoverPreview.layerUrl"
              class="chat-pill-preview"
              :style="{
                left: `${hoverPreview.x}px`,
                top: `${hoverPreview.y}px`,
                '--preview-img-w': `${hoverPreviewImageSize.width}px`,
                '--preview-img-h': `${hoverPreviewImageSize.height}px`,
              }"
            >
              <div class="chat-pill-preview-img-wrap">
                <div class="chat-pill-preview-img-inner">
                  <img :src="hoverPreview.layerUrl" alt="" />
                  <div
                    v-if="hoverPreview.box && hoverPreview.box.length === 4 && hoverPreview.order"
                    class="chat-pill-preview-marker"
                    :style="{
                      left: `${((hoverPreview.box[0] || 0) + (hoverPreview.box[2] || 1)) * 50}%`,
                      top: `${((hoverPreview.box[1] || 0) + (hoverPreview.box[3] || 1)) * 50}%`,
                    }"
                  >
                    <span>{{ hoverPreview.order }}</span>
                  </div>
                </div>
              </div>
            </div>
          </Teleport>
          <div
            class="chat-input uc-chat-inputbar"
            :style="{
              flexBasis: `${panel.chatHeight + 24}px`,
              minHeight: `${panel.chatHeight + 24}px`,
            }"
          >
            <div v-if="selectedLayer" class="target-layer">
              <img :src="selectedLayer.thumbnailUrl" alt="" />
              <span>{{ layerName(selectedLayerIndex) }}</span>
            </div>
            <div
              class="chat-box uc-ref-panel"
              :style="{ height: `${panel.chatHeight}px` }"
              @click="handleChatBoxClick"
            >
              <div
                class="chat-box-resize"
                title="向上拖动扩大输入框"
                @pointerdown="startChatResize"
                @pointermove="resizeChatBox"
                @pointerup="stopChatResize"
                @pointercancel="stopChatResize"
              />
              <div class="uc-home-dialog-main">
                <div
                  class="uc-chat-upload-deck yh-upload-deck"
                  :class="{ 'has-images': chatReferenceImages.length }"
                  :style="{ '--deck-count': chatReferenceImages.length }"
                >
                  <button
                    v-for="(image, index) in chatReferenceImages"
                    :key="image.id"
                    class="yh-upload-card"
                    :class="{
                      active: activeChatReferenceId === image.id,
                      uploading: image.uploading,
                      error: image.error,
                    }"
                    :style="{ '--deck-index': index, '--deck-total': chatReferenceImages.length }"
                    type="button"
                    @mouseenter="activeChatReferenceId = image.id"
                    @focus="activeChatReferenceId = image.id"
                  >
                    <img :src="image.url" :alt="image.name || '参考图'" />
                    <span v-if="image.uploading" class="yh-upload-card-status">上传中</span>
                    <span v-else-if="image.error" class="yh-upload-card-status">失败</span>
                    <span class="yh-image-count">{{ index + 1 }}</span>
                    <span
                      class="yh-remove-image"
                      role="button"
                      tabindex="0"
                      @click.stop="removeChatReferenceImage(image.id)"
                    >
                      ×
                    </span>
                  </button>
                  <button
                    class="uc-upload-tile yh-upload-tile"
                    type="button"
                    :class="{ compact: chatReferenceImages.length }"
                    @click.stop="openImageUpload('chat')"
                  >
                    <span v-if="chatUploading && !chatReferenceImages.length" class="yh-uploading">
                      上传中
                    </span>
                    <span v-else>{{ chatReferenceImages.length ? '+' : '＋' }}</span>
                  </button>
                </div>
                <div
                  ref="chatEditorRef"
                  class="chat-editor"
                  :class="{
                    'chat-editor-empty': !chatText.trim() && !getSelectedDetectedElements().length,
                  }"
                  contenteditable="true"
                  @input="handleEditorInput"
                  @click="handleEditorPillClick"
                  @paste="handleEditorPaste"
                  @keydown.enter.exact.prevent="sendChat"
                  @keydown.ctrl.enter.prevent="handleEditorLineBreak"
                  @keydown.shift.enter.prevent="handleEditorLineBreak"
                  @keydown.backspace="handleEditorBackspace"
                />
              </div>
              <div class="uc-chat-generate-options" @click.stop>
                <label>
                  <span>模型</span>
                  <div class="uc-custom-select" :class="{ open: chatSelectOpen === 'model' }">
                    <button
                      type="button"
                      class="uc-custom-select-trigger"
                      @click.stop="toggleChatSelect('model')"
                    >
                      {{ chatModel }}
                      <i class="ri-arrow-down-s-line"></i>
                    </button>
                    <div v-if="chatSelectOpen === 'model'" class="uc-custom-select-menu">
                      <button
                        v-for="model in chatModelOptions"
                        :key="model"
                        type="button"
                        class="uc-custom-select-item"
                        :class="{ active: chatModel === model }"
                        @click.stop="
                          () => {
                            chatModel = model
                            chatSelectOpen = null
                          }
                        "
                      >
                        {{ model }}
                      </button>
                    </div>
                  </div>
                </label>
                <label>
                  <span>比例</span>
                  <div class="uc-custom-select" :class="{ open: chatSelectOpen === 'ratio' }">
                    <button
                      type="button"
                      class="uc-custom-select-trigger"
                      @click.stop="toggleChatSelect('ratio')"
                    >
                      {{ chatRatio }}
                      <i class="ri-arrow-down-s-line"></i>
                    </button>
                    <div v-if="chatSelectOpen === 'ratio'" class="uc-custom-select-menu">
                      <button
                        v-for="ratio in chatRatioOptions"
                        :key="ratio"
                        type="button"
                        class="uc-custom-select-item"
                        :class="{ active: chatRatio === ratio }"
                        @click.stop="
                          () => {
                            chatRatio = ratio
                            chatSelectOpen = null
                          }
                        "
                      >
                        {{ ratio }}
                      </button>
                    </div>
                  </div>
                </label>
                <label>
                  <span>分辨率</span>
                  <div class="uc-custom-select" :class="{ open: chatSelectOpen === 'resolution' }">
                    <button
                      type="button"
                      class="uc-custom-select-trigger"
                      @click.stop="toggleChatSelect('resolution')"
                    >
                      {{ chatResolution }}
                      <i class="ri-arrow-down-s-line"></i>
                    </button>
                    <div v-if="chatSelectOpen === 'resolution'" class="uc-custom-select-menu">
                      <button
                        v-for="resolution in chatResolutionOptions"
                        :key="resolution"
                        type="button"
                        class="uc-custom-select-item"
                        :class="{ active: chatResolution === resolution }"
                        @click.stop="
                          () => {
                            chatResolution = resolution
                            chatSelectOpen = null
                          }
                        "
                      >
                        {{ resolution }}
                      </button>
                    </div>
                  </div>
                </label>
              </div>
              <footer class="uc-bottom-toolbar">
                <span>Enter 发送 · Ctrl+Enter 换行</span>
                <button
                  :disabled="!chatText.trim() && !getSelectedDetectedElements().length"
                  @click="sendChat"
                >
                  <i class="ri-send-plane-fill" aria-hidden="true"></i>
                  {{ chatGenerating ? '发送（生成中）' : '发送' }}
                </button>
              </footer>
            </div>
          </div>
        </section>

        <section v-else class="layers-panel">
          <h3>
            图层
            <b>{{ layers.length }}</b>
          </h3>
          <button
            v-for="layer in [...layers].reverse()"
            :key="layer.id"
            :class="{ active: selectedLayerIds.includes(layer.id) }"
            @click="selectSingleLayer(layer)"
          >
            <span>◉</span>
            <img
              v-if="layer.thumbnailUrl && !brokenImages.has('thumb-' + layer.id)"
              :src="layer.thumbnailUrl"
              alt=""
              @error="markImageBroken('thumb-' + layer.id)"
            />
            <i v-else class="ri-image-line broken-icon" aria-hidden="true"></i>
            <strong>{{ layerName(layers.findIndex((item) => item.id === layer.id)) }}</strong>
            <small>{{ Math.round(layer.width) }} x {{ Math.round(layer.height) }}</small>
            <em>▣</em>
          </button>
        </section>

        <section v-if="rightTab === 'history'" class="generation-history-panel">
          <h3>
            生图记录
            <b>{{ generationHistory.length }}</b>
          </h3>
          <article
            v-for="record in [...generationHistory].reverse()"
            :key="record.id"
            class="gh-record"
          >
            <img
              v-if="record.imageUrl && !brokenImages.has('rec-' + record.id)"
              :src="record.imageUrl"
              alt=""
              @error="markImageBroken('rec-' + record.id)"
            />
            <strong>{{ record.model }} · {{ record.ratio }}</strong>
            <p>{{ record.prompt }}</p>
            <small v-if="record.referenceImageUrls?.length">
              参考图 {{ record.referenceImageUrls.length }} 张
            </small>
            <footer>
              <button type="button" @click="addGenerationRecordToCanvas(record)">加到画布</button>
              <button type="button" @click="useGenerationRecordAsReference(record)">
                作参考图
              </button>
              <button type="button" @click="reuseGenerationRecordPrompt(record)">复用提示词</button>
              <button type="button" class="danger" @click="removeGenerationRecord(record.id)">
                删除
              </button>
            </footer>
          </article>
        </section>
      </aside>
    </section>

    <!-- 帮助菜单 -->
    <Teleport to="body">
      <div v-if="helpMenuOpen" class="zoom-bar-help-menu" :style="helpMenuStyle" @click.stop>
        <button class="help-menu-item" @click="helpMenuOpen = false">
          <i class="ri-guide-line"></i>
          <span>帮助</span>
        </button>
        <button class="help-menu-item" @click.stop="openShortcutsFromHelp">
          <i class="ri-keyboard-line"></i>
          <span>快捷键</span>
        </button>
      </div>
    </Teleport>

    <!-- 快捷键面板 -->
    <div
      v-if="shortcutsOpen"
      class="shortcuts-backdrop"
      @click.self="shortcutsOpen = false"
      @click.stop
    >
      <div class="shortcuts-panel">
        <div class="shortcuts-head">
          <h2>⌨ 快捷键速查</h2>
          <button @click="shortcutsOpen = false">✕</button>
        </div>
        <div class="shortcuts-body">
          <div class="shortcuts-group">
            <h3>🛠 工具切换</h3>
            <dl>
              <div>
                <dt>V</dt>
                <dd>选择工具</dd>
              </div>
              <div>
                <dt>H</dt>
                <dd>抓手工具（拖动画布）</dd>
              </div>
              <div>
                <dt>F</dt>
                <dd>聚焦选中图层 / 适应画面</dd>
              </div>
              <div>
                <dt>M</dt>
                <dd>标记元素（点击选中）</dd>
              </div>
            </dl>
          </div>
          <div class="shortcuts-group">
            <h3>🖱 画布操作</h3>
            <dl>
              <div>
                <dt>滚轮</dt>
                <dd>平移画布</dd>
              </div>
              <div>
                <dt>Ctrl + 滚轮</dt>
                <dd>缩放画布</dd>
              </div>
              <div>
                <dt>空格 + 拖拽</dt>
                <dd>平移画布</dd>
              </div>
              <div>
                <dt>拖入图片/文件</dt>
                <dd>添加图片到画布</dd>
              </div>
              <div>
                <dt>Ctrl + 点击</dt>
                <dd>任意工具下临时选中元素</dd>
              </div>
            </dl>
          </div>
          <div class="shortcuts-group">
            <h3>✏ 编辑</h3>
            <dl>
              <div>
                <dt>Ctrl + Z</dt>
                <dd>撤销上一步（最多50步）</dd>
              </div>
              <div>
                <dt>Delete</dt>
                <dd>删除选中图层（支持多选批量删除）</dd>
              </div>
              <div>
                <dt>拖拽空白区域</dt>
                <dd>框选多个图层，配合 Delete 批量删除</dd>
              </div>
              <div>
                <dt>Backspace</dt>
                <dd>输入框内删除字符</dd>
              </div>
              <div>
                <dt>Esc</dt>
                <dd>关闭面板</dd>
              </div>
            </dl>
          </div>
          <div class="shortcuts-group">
            <h3>💬 对话</h3>
            <dl>
              <div>
                <dt>Enter</dt>
                <dd>发送对话消息</dd>
              </div>
              <div>
                <dt>Ctrl + Enter</dt>
                <dd>输入框换行</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  </main>

  <!-- + 号菜单：Teleport 到 body，脱离 transform 父级 -->
  <Teleport to="body">
    <div v-if="toolbarAddOpen" class="uc-toolbar-add-menu" :style="addMenuPosition" @click.stop>
      <div class="uc-toolbar-add-group">
        <span class="uc-toolbar-add-group-label">添加文件</span>
        <button @click="addFileAndClose">
          <i class="ri-upload-2-line" aria-hidden="true"></i>
          <span class="uc-toolbar-add-text">本地上传</span>
          <span class="uc-toolbar-add-shortcut">拖拽</span>
        </button>
        <button @click="toolbarAddOpen = false">
          <i class="ri-history-line" aria-hidden="true"></i>
          <span class="uc-toolbar-add-text">历史生成导入</span>
          <span class="uc-toolbar-add-shortcut">H</span>
        </button>
      </div>
      <div class="uc-toolbar-add-divider"></div>
      <div class="uc-toolbar-add-group">
        <span class="uc-toolbar-add-group-label">添加节点</span>
        <button @click="addImageNodeAndClose">
          <i class="ri-image-line" aria-hidden="true"></i>
          <span class="uc-toolbar-add-text">图片</span>
          <span class="uc-toolbar-add-shortcut">I</span>
        </button>
        <button @click="addVideoNodeAndClose">
          <i class="ri-video-line" aria-hidden="true"></i>
          <span class="uc-toolbar-add-text">视频</span>
          <span class="uc-toolbar-add-shortcut">V</span>
        </button>
        <button @click="addTextNodeAndClose">
          <i class="ri-text" aria-hidden="true"></i>
          <span class="uc-toolbar-add-text">文本</span>
          <span class="uc-toolbar-add-shortcut">T</span>
        </button>
      </div>
    </div>
  </Teleport>

  <!-- 重叠元素切换弹窗 -->
  <Teleport to="body">
    <div v-if="overlapDropdown.visible" class="detect-select-overlay" @click="closeOverlapDropdown">
      <div
        class="detect-select-popup"
        :style="{
          left: `${overlapDropdown.x}px`,
          top: `${overlapDropdown.y}px`,
          transform: 'translateY(-100%)',
        }"
        @pointerdown.stop=""
      >
        <div class="detect-select-popup-header">
          切换重叠元素 ({{ overlapDropdown.candidates.length }})
        </div>
        <div class="detect-select-popup-list">
          <button
            v-for="c in overlapDropdown.candidates"
            :key="`${c.layerId}::${c.id}`"
            :class="[
              'detect-select-popup-item',
              { selected: `${c.layerId}::${c.id}` === overlapDropdown.pillKey },
            ]"
            @click.stop="replacePillElement(c)"
          >
            <span
              :class="[
                'detect-select-popup-dot',
                { active: `${c.layerId}::${c.id}` === overlapDropdown.pillKey },
              ]"
            ></span>
            <span class="detect-select-popup-name">{{ c.name }}</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <ImageViewer
    :open="imageViewer.show"
    :images="imageViewer.images"
    :start-index="imageViewer.currentIndex"
    @close="closeImageViewer"
    @download="downloadViewerImage"
  />

  <!-- 视频查看器 -->
  <Teleport to="body">
    <div
      v-if="videoViewer.show"
      class="uc-video-viewer-overlay"
      @keydown.escape="closeVideoViewer"
      @mousemove="showVideoControlsTemporarily"
    >
      <div class="uc-video-viewer-container">
        <!-- 关闭按钮 -->
        <button class="uc-video-viewer-close" @click="closeVideoViewer">
          <i class="ri-close-line"></i>
        </button>

        <!-- 视频显示区域 -->
        <div class="uc-video-viewer-content" @click="toggleVideoViewerPlay">
          <video
            ref="videoViewerRef"
            :src="videoViewer.url"
            :muted="videoViewer.muted"
            loop
            playsinline
            preload="metadata"
            class="uc-video-viewer-video"
            @play="onVideoViewerPlay"
            @pause="onVideoViewerPause"
            @timeupdate="onVideoViewerTimeUpdate"
            @durationchange="onVideoViewerDurationChange"
            @ended="onVideoViewerEnded"
            @click.stop="toggleVideoViewerPlay"
          ></video>
          <!-- 未播放时的大播放按钮 -->
          <div
            v-if="!videoViewer.playing"
            class="uc-video-viewer-big-play"
            @click.stop="toggleVideoViewerPlay"
          >
            <i class="ri-play-fill"></i>
          </div>
        </div>

        <!-- 控制栏 -->
        <div
          class="uc-video-viewer-controls"
          :class="{ 'uc-video-controls-hidden': !videoViewer.showControls }"
        >
          <!-- 进度条 -->
          <div class="uc-video-controls-progress">
            <input
              type="range"
              class="uc-video-seek-bar"
              min="0"
              :max="videoViewer.duration || 0"
              step="0.1"
              :value="videoViewer.currentTime"
              @input="onVideoSeekInput"
              @mousedown="onVideoSeekStart"
              @mouseup="onVideoSeekEnd"
            />
          </div>

          <!-- 底部按钮行 -->
          <div class="uc-video-controls-row">
            <!-- 左侧：播放/暂停 + 时间 -->
            <div class="uc-video-controls-left">
              <button
                class="uc-video-ctrl-btn"
                :title="videoViewer.playing ? '暂停' : '播放'"
                @click="toggleVideoViewerPlay"
              >
                <i :class="videoViewer.playing ? 'ri-pause-fill' : 'ri-play-fill'"></i>
              </button>
              <span class="uc-video-time">
                {{ formatVideoTime(videoViewer.currentTime) }} /
                {{ formatVideoTime(videoViewer.duration) }}
              </span>
            </div>

            <!-- 右侧：音量 + 速度 + 全屏 -->
            <div class="uc-video-controls-right">
              <button
                class="uc-video-ctrl-btn"
                :title="videoViewer.muted ? '取消静音' : '静音'"
                @click="toggleVideoMute"
              >
                <i
                  :class="
                    videoViewer.muted || videoViewer.volume === 0
                      ? 'ri-volume-mute-fill'
                      : videoViewer.volume < 0.5
                        ? 'ri-volume-down-fill'
                        : 'ri-volume-up-fill'
                  "
                ></i>
              </button>
              <input
                type="range"
                class="uc-video-volume-bar"
                min="0"
                max="1"
                step="0.05"
                :value="videoViewer.muted ? 0 : videoViewer.volume"
                @input="onVideoVolumeInput"
              />
              <div class="uc-video-speed-group">
                <button class="uc-video-ctrl-btn uc-video-speed-btn" title="播放速度">
                  {{ videoViewer.playbackRate }}x
                </button>
                <div class="uc-video-speed-menu">
                  <button
                    v-for="rate in playbackRates"
                    :key="rate"
                    class="uc-video-speed-item"
                    :class="{ active: videoViewer.playbackRate === rate }"
                    @click="setPlaybackRate(rate)"
                  >
                    {{ rate }}x
                  </button>
                </div>
              </div>
              <button class="uc-video-ctrl-btn" title="全屏" @click="toggleVideoFullscreen">
                <i class="ri-fullscreen-line"></i>
              </button>
              <button class="uc-video-ctrl-btn" title="下载" @click="downloadVideo">
                <i class="ri-download-line"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 历史记录面板 -->
  <Teleport to="body">
    <div
      v-if="historyPanelOpen"
      class="uc-materials-backdrop"
      @click.self="historyPanelOpen = false"
    >
      <div class="uc-materials-panel uc-history-panel">
        <header class="uc-materials-head">
          <h2>
            <i class="ri-history-line"></i>
            历史记录
            <b v-if="generationHistory.length">{{ generationHistory.length }}</b>
          </h2>
          <button @click="historyPanelOpen = false"><i class="ri-close-line"></i></button>
        </header>
        <div class="uc-materials-body">
          <div v-if="!generationHistory.length" class="uc-materials-empty">
            <i class="ri-image-add-line"></i>
            <p>暂无生成记录</p>
            <small>在对话窗口生图后自动记录</small>
          </div>
          <div v-else class="uc-history-grid">
            <div
              v-for="record in [...generationHistory].reverse()"
              :key="record.id"
              class="uc-history-card"
              @click="addGenerationRecordToCanvas(record)"
            >
              <img
                v-if="record.imageUrl && !brokenImages.has('rec-' + record.id)"
                :src="record.imageUrl"
                :alt="record.prompt"
                loading="lazy"
                decoding="async"
                @error="markImageBroken('rec-' + record.id)"
              />
              <div class="uc-history-card-footer">
                <span class="uc-history-model">{{ record.model }}</span>
                <span class="uc-history-ratio">{{ record.ratio }}</span>
                <div class="uc-history-actions">
                  <button
                    class="uc-history-act"
                    title="加到画布"
                    @click.stop="addGenerationRecordToCanvas(record)"
                  >
                    <i class="ri-add-line"></i>
                  </button>
                  <button
                    class="uc-history-act"
                    title="作参考图"
                    @click.stop="useGenerationRecordAsReference(record)"
                  >
                    <i class="ri-image-add-line"></i>
                  </button>
                  <button
                    class="uc-history-act"
                    title="复用提示词"
                    @click.stop="reuseGenerationRecordPrompt(record)"
                  >
                    <i class="ri-file-copy-line"></i>
                  </button>
                  <button
                    class="uc-history-act uc-history-act--danger"
                    title="删除"
                    @click.stop="removeGenerationRecord(record.id)"
                  >
                    <i class="ri-delete-bin-line"></i>
                  </button>
                </div>
              </div>
              <p class="uc-history-prompt" :title="record.prompt" @mousedown.stop>
                {{ record.prompt }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 右键菜单 -->
  <Teleport to="body">
    <div
      v-if="contextMenu.visible"
      class="uc-context-menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      @click.stop
    >
      <button class="uc-context-menu-item" @click="contextMenuAddToReference">
        <i class="ri-image-add-line"></i>
        添加到参考图
      </button>
      <button class="uc-context-menu-item" @click="contextMenuAddToMaterials">
        <i class="ri-folder-image-line"></i>
        添加到我的素材
      </button>
      <button class="uc-context-menu-item" @click="contextMenuDownloadLayer">
        <i class="ri-download-2-line"></i>
        下载图片
      </button>
      <div class="uc-context-menu-divider"></div>
      <button class="uc-context-menu-item" @click="openCropPicker(contextMenu.x, contextMenu.y)">
        <i class="ri-grid-line"></i>
        宫格裁图...
      </button>
      <div
        class="uc-context-menu-item uc-context-menu-sub"
        @mouseenter="cropQuickOpen = true"
        @mouseleave="cropQuickOpen = false"
      >
        <i class="ri-layout-grid-line"></i>
        快捷裁图 ▸
        <div
          v-show="cropQuickOpen"
          class="uc-context-submenu"
          @mouseenter="cropQuickOpen = true"
          @mouseleave="cropQuickOpen = false"
        >
          <button class="uc-context-menu-item" @click="enterQuickCrop(3, 3)">3×3</button>
          <button class="uc-context-menu-item" @click="enterQuickCrop(3, 2)">3×2</button>
          <button class="uc-context-menu-item" @click="enterQuickCrop(4, 2)">4×2</button>
          <button class="uc-context-menu-item" @click="enterQuickCrop(5, 2)">5×2</button>
        </div>
      </div>
      <div class="uc-context-menu-divider"></div>
      <button
        class="uc-context-menu-item uc-context-menu-item--danger"
        @click="contextMenuDeleteLayer"
      >
        <i class="ri-delete-bin-line"></i>
        删除图片
      </button>
    </div>
  </Teleport>

  <!-- 我的素材面板 -->
  <Teleport to="body">
    <div v-if="myMaterialsOpen" class="uc-materials-backdrop" @click.self="myMaterialsOpen = false">
      <div class="uc-materials-panel">
        <header class="uc-materials-head">
          <h2>
            <i class="ri-folder-image-line"></i>
            我的素材
          </h2>
          <button @click="myMaterialsOpen = false"><i class="ri-close-line"></i></button>
        </header>
        <div class="uc-materials-body">
          <div v-if="!myMaterials.length" class="uc-materials-empty">
            <i class="ri-image-add-line"></i>
            <p>暂无素材</p>
            <small>右键画布中的图片 → 添加到我的素材</small>
          </div>
          <div v-else class="uc-materials-grid">
            <div
              v-for="mat in myMaterials"
              :key="mat.id"
              class="uc-materials-card"
              @click="addMaterialToCanvas(mat)"
            >
              <img :src="mat.url" :alt="mat.name" loading="lazy" decoding="async" />
              <div class="uc-materials-card-footer">
                <div class="uc-materials-card-info">
                  <span class="uc-materials-card-name">{{ mat.name }}</span>
                  <span class="uc-materials-card-date">
                    {{ mat.addedAt ? new Date(mat.addedAt).toLocaleString() : '' }}
                  </span>
                </div>
                <button class="uc-materials-del" title="删除" @click.stop="removeMaterial(mat.id)">
                  <i class="ri-delete-bin-line"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 宫格裁图选择器 -->
  <Teleport to="body">
    <div v-if="cropPickerOpen" class="uc-crop-picker-backdrop" @click.self="cancelCropPicker">
      <div class="uc-crop-picker" :style="{ left: cropPickerX + 'px', top: cropPickerY + 'px' }">
        <h3>宫格裁图</h3>
        <div class="uc-crop-picker-controls">
          <label>
            行
            <button class="uc-crop-btn-sm" @click="cropMode.rows = Math.max(2, cropMode.rows - 1)">
              −
            </button>
            <span class="uc-crop-num">{{ cropMode.rows }}</span>
            <button class="uc-crop-btn-sm" @click="cropMode.rows = Math.min(10, cropMode.rows + 1)">
              +
            </button>
          </label>
          <label>
            列
            <button class="uc-crop-btn-sm" @click="cropMode.cols = Math.max(2, cropMode.cols - 1)">
              −
            </button>
            <span class="uc-crop-num">{{ cropMode.cols }}</span>
            <button class="uc-crop-btn-sm" @click="cropMode.cols = Math.min(10, cropMode.cols + 1)">
              +
            </button>
          </label>
        </div>
        <div class="uc-crop-picker-preview">
          <div v-for="r in cropMode.rows" :key="'pr' + r" class="uc-crop-preview-row">
            <div v-for="c in cropMode.cols" :key="'pc' + c" class="uc-crop-preview-cell">
              {{ (r - 1) * cropMode.cols + c }}
            </div>
          </div>
        </div>
        <div class="uc-crop-picker-actions">
          <button class="uc-btn uc-btn-primary" @click="confirmCropPicker">确认</button>
          <button class="uc-btn" @click="cancelCropPicker">取消</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 裁图模式底部工具栏 -->
  <Teleport to="body">
    <div v-if="cropMode.active" class="uc-crop-toolbar">
      <span class="uc-crop-toolbar-info">
        {{ cropMode.selectedCells.size }} / {{ cropMode.rows * cropMode.cols }} 个格子
      </span>
      <button class="uc-crop-btn" @click="selectAllCells">全选</button>
      <button class="uc-crop-btn" @click="invertCells">反选</button>
      <button class="uc-crop-btn uc-crop-btn-primary" @click="executeCrop">确认裁剪</button>
      <button class="uc-crop-btn uc-crop-btn-danger" @click="exitCropMode">取消</button>
    </div>
  </Teleport>
</template>

<style>
.uc-image-broken {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 120px;
  width: 100%;
  color: #94a3b8;
  background: rgba(15, 23, 42, 0.4);
  border: 1px dashed rgba(148, 163, 184, 0.3);
  border-radius: 8px;
  font-size: 13px;
}
.uc-image-broken i {
  font-size: 28px;
  opacity: 0.6;
}
.uc-broken-retry {
  padding: 3px 12px;
  border: 1px solid rgba(148, 163, 184, 0.4);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  color: #e2e8f0;
  cursor: pointer;
  font-size: 12px;
}
.uc-broken-retry:hover {
  background: rgba(255, 255, 255, 0.12);
}
.broken-icon {
  color: #64748b;
  font-size: 18px;
}
</style>
