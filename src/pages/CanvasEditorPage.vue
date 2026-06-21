<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { layerName, useCanvasStore } from '../stores/canvas';
import { useUserStore } from '../stores/user';

const props = defineProps({ id: { type: String, required: true } });
const router = useRouter();
const canvas = useCanvasStore();
const userStore = useUserStore();
const doc = computed(() => canvas.ensureDocument(props.id));

const fileInput = ref(null);
const fileInputMode = ref('canvas');
const addOpen = ref(false);
const shortcutsOpen = ref(false);
const helpMenuOpen = ref(false);
const toolbarAddOpen = ref(false);
const minimapVisible = ref(true);
// + 号弹层位置（fixed 定位 + Teleport to body，彻底脱离 transform 父级）
const addMenuWrapEl = ref(null);
const addMenuPosition = ref({});
function toggleToolbarAdd() {
  if (!toolbarAddOpen.value) {
    // 先算坐标，再打开菜单 → 避免菜单先在 (0,0) 闪现再跳到正确位置
    const btn = addMenuWrapEl.value?.querySelector('.uc-toolbar-add-btn');
    if (btn) {
      const r = btn.getBoundingClientRect();
      addMenuPosition.value = {
        position: 'fixed',
        top: (r.top + r.height / 2) + 'px',
        left: (r.right + 8) + 'px',
        transform: 'translateY(-50%)',
        zIndex: 9999
      };
    }
    toolbarAddOpen.value = true;
  } else {
    toolbarAddOpen.value = false;
  }
}

// 归一化 box_2d 到 0-1
// proxy_log.py 已经统一输出 0-1 范围的浮点数
function normalizeBoxVal(raw) {
  if (!Array.isArray(raw) || raw.length !== 4) return [0, 0, 1, 1];
  // 确保所有值都是数字
  const box = raw.map(v => {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  });
  // 如果值大于 1，说明是 0-1000 范围，需要除以 1000
  const maxVal = Math.max(...box.map(v => Math.abs(v)));
  if (maxVal > 1.5) {
    return box.map(v => Math.max(0, Math.min(1, v / 1000)));
  }
  // 已经是 0-1 范围，直接返回
  return box.map(v => Math.max(0, Math.min(1, v)));
}

// 从 doc.value.payload.layers[*].detection.boxes 同步到 layerDetectedElements
function syncDetectionFromLayers() {
  const allLayers = doc.value?.payload?.layers || [];
  const next = { ...layerDetectedElements.value };
  let changed = false;
  for (const layer of allLayers) {
    const boxes = layer?.detection?.boxes;
    if (Array.isArray(boxes) && boxes.length) {
      const els = boxes.map((b, i) => {
        const b2d = normalizeBoxVal(b.box2d || b.box_2d || []);
        return {
          id: b.name || b.id || `el-${layer.id}-${i}`,
          name: b.name || b.id || `element-${i}`,
          box2d: b2d,
          box_2d: b2d,
        };
      });
      const cur = next[layer.id];
      if (!cur || cur.length !== els.length) {
        next[layer.id] = els;
        changed = true;
      }
    }
  }
  if (changed) layerDetectedElements.value = next;
}
const layerDetectedElements = ref({});
const selectedDetectedElements = ref(new Set());
const elementClickPositions = ref({});
const detectingLayerIds = ref(new Set());
const chatSkipPillSync = ref(false);
const _undoRestoring = ref(false); // 撤销恢复期间跳过自动检测
const _mounted = ref(false); // 组件是否已挂载（用于防止 polling 越界）
const rightPanelVisible = ref(true);
const isReversePromptCanvas = computed(() => props.id === 'reverse-prompt');
const reversePromptCard = reactive({ x: null, y: null, width: 380, height: 240, dragging: null });
const reversePromptConnectors = ref([]);
const selectedLayerId = ref(doc.value.payload.layers[0]?.id || '');
const selectedLayerIds = ref(selectedLayerId.value ? [selectedLayerId.value] : []);
const rightTab = ref('chat');

// ========== 连接线系统 ==========
const connections = ref([]); // { id, fromLayerId, fromPort, toLayerId, toPort }
const connecting = reactive({
  active: false,
  fromLayerId: '',
  fromPort: '', // 'left' | 'right'
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
});
// 连接线选中状态
const selectedConnection = reactive({
  id: '',
  x: 0,
  y: 0,
});

// 选中连接线（点击时触发）
function selectConnection(event, connId) {
  event.stopPropagation();
  const stageEl = document.querySelector('.stage');
  if (!stageEl) return;
  const rect = stageEl.getBoundingClientRect();
  selectedConnection.id = connId;
  selectedConnection.x = event.clientX - rect.left;
  selectedConnection.y = event.clientY - rect.top;
}

// 取消选中连接线
function deselectConnection() {
  selectedConnection.id = '';
}

// 获取节点端口在 stage 坐标系中的像素位置（纯计算，不依赖 DOM 可见性）
function getPortPosition(layerId, port) {
  const layer = layers.value.find(l => l.id === layerId);
  if (!layer) return { x: 0, y: 0 };
  const vs = viewScale.value;
  const vo = viewOffset.value;
  const nodeWidth = layer.width || 200;
  // 图片节点高度 = width × (naturalHeight / naturalWidth)
  const nodeHeight = layer.height
    || (layer.naturalWidth && layer.naturalHeight ? Math.round(nodeWidth * layer.naturalHeight / layer.naturalWidth) : 150);
  // 节点 transform: translate(x*vs+vo.x, y*vs+vo.y) scale(vs)
  // 端口 CSS: left:-14px(左) / right:-14px(右), width:24px → 中心偏移 -2px / nodeWidth+2
  // stage 坐标 = (layer.x + portOffset) * vs + vo.x
  const portOffset = port === 'left' ? -2 : nodeWidth + 2;
  return {
    x: (layer.x + portOffset) * vs + vo.x,
    y: (layer.y + nodeHeight / 2) * vs + vo.y,
  };
}

// 屏幕坐标 → stage 相对坐标
function screenToStage(clientX, clientY) {
  const stageEl = document.querySelector('.stage');
  if (!stageEl) return { x: 0, y: 0 };
  const rect = stageEl.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

// 开始连接
function startConnection(event, layerId, port) {
  event.stopPropagation();
  event.preventDefault();
  const pos = getPortPosition(layerId, port);
  connecting.active = true;
  connecting.fromLayerId = layerId;
  connecting.fromPort = port;
  connecting.startX = pos.x;
  connecting.startY = pos.y;
  connecting.currentX = pos.x;
  connecting.currentY = pos.y;
}

// 更新连接线拖拽位置
function updateConnectionDrag(event) {
  if (!connecting.active) return;
  const pos = screenToStage(event.clientX, event.clientY);
  connecting.currentX = pos.x;
  connecting.currentY = pos.y;
}

// 完成连接（不限制连接数量，允许任意节点间连接）
function finishConnection(event, layerId, port) {
  if (!connecting.active) return;
  if (connecting.fromLayerId === layerId) {
    // 不能连接自己
    connecting.active = false;
    return;
  }
  // 允许创建连接（不限制数量）
  connections.value.push({
    id: `conn-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    fromLayerId: connecting.fromLayerId,
    fromPort: connecting.fromPort,
    toLayerId: layerId,
    toPort: port,
  });
  connecting.active = false;
}

// 取消连接
function cancelConnection() {
  connecting.active = false;
}

// 删除连接
function removeConnection(connId) {
  connections.value = connections.value.filter(c => c.id !== connId);
}

// 生成贝塞尔曲线路径
function generateCurvePath(x1, y1, x2, y2) {
  const dx = Math.abs(x2 - x1);
  const cp = Math.max(dx * 0.5, 50);
  return `M ${x1} ${y1} C ${x1 + cp} ${y1}, ${x2 - cp} ${y2}, ${x2} ${y2}`;
}

// 计算所有连接线路径
// 连接线渲染刷新标记（节点移动时触发重绘）
const connectionTick = ref(0);
function refreshConnections() { connectionTick.value++; }

// 连接线路径（每次渲染都从 DOM 实时获取端口位置）
function getConnectionPaths() {
  // eslint-disable-next-line no-unused-vars
  const _tick = connectionTick.value; // 依赖触发
  return connections.value.map(conn => {
    const from = getPortPosition(conn.fromLayerId, conn.fromPort);
    const to = getPortPosition(conn.toLayerId, conn.toPort);
    return {
      ...conn,
      path: generateCurvePath(from.x, from.y, to.x, to.y),
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
    };
  });
}

// 当前拖拽中的连接线路径
const connectingPath = computed(() => {
  if (!connecting.active) return '';
  return generateCurvePath(connecting.startX, connecting.startY, connecting.currentX, connecting.currentY);
});
const chatHistoryRef = ref(null);
const chatText = ref('');
const chatReferenceImages = ref([]);
const activeChatReferenceId = ref('');
const chatUploading = ref(false);
const uploadProgress = ref(null); // { fileName, loaded, total, percent } | null
const chatGenerating = ref(false);
const generationHistory = ref([]);
const chatModel = ref('banana2');
const chatRatio = ref('9:16');
const chatResolution = ref('2K');
const chatModelOptions = ['banana2', 'banana pro', 'GPT imag 2'];
const chatRatioOptions = ['1:1', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const chatResolutionOptions = ['1K', '2K', '4K'];
const TASK_POLL_INTERVAL = 2500;
// 聊天消息中元素 pill 的悬停预览
const hoverPreview = reactive({ visible: false, x: 0, y: 0, layerUrl: '', box: null, name: '', order: 0 });
const hoverPreviewTimer = ref(null);
const hoverPreviewImageSize = reactive({ width: 0, height: 0 });
const hoverPreviewDims = reactive({ w: 220, h: 180 }); // 预览弹窗实际宽高，用于边界自适应
const TASK_MAX_POLLS = 120;
const PLACEHOLDER_WIDTH = 720;
const PLACEHOLDER_HEIGHT = 964;
const PLACEHOLDER_STATUS_TEXTS = [
  '正在加载超导级创作资源池...',
  '正在校准粒子精度与材质细节...',
  '正在计算光影层次与空间氛围...',
  '正在封装生成结果，即将呈现...',
];
function addReversePromptReference(imageUrl, layerId) {
  canvas.updateDocument(props.id, (draft) => {
    draft.payload.reversePrompt = draft.payload.reversePrompt || { referenceImages: [] };
    if (!draft.payload.reversePrompt.referenceImages.find((r) => r.layerId === layerId)) {
      draft.payload.reversePrompt.referenceImages.push({ url: imageUrl, layerId, addedAt: Date.now() });
    }
    return draft;
  });
}

function removeReversePromptReference(layerId) {
  canvas.updateDocument(props.id, (draft) => {
    if (!draft.payload.reversePrompt) return draft;
    draft.payload.reversePrompt.referenceImages = draft.payload.reversePrompt.referenceImages.filter((r) => r.layerId !== layerId);
    return draft;
  });
}

const visibleReferenceImages = computed(() => {
  if (!doc.value?.payload?.reversePrompt?.referenceImages) return [];
  return doc.value.payload.reversePrompt.referenceImages.filter((r) => layers.value.some((l) => l.id === r.layerId));
});
const activeTool = ref('select');
const canvasTools = [
  { key: 'select', label: '选择', shortcut: 'V', icon: 'ri-cursor-line' },
  { key: 'hand', label: '抓手（拖动画布）', shortcut: 'H', icon: 'ri-hand' },
  { key: 'focus', label: '聚焦选中 / 适应画面', shortcut: 'F', icon: 'ri-focus-3-line' },
  { key: 'bringTop', label: '置顶图层', icon: 'ri-arrow-up-double-line' },
  { key: 'text', label: '插入文字', shortcut: 'T', icon: 'ri-text', action: addTextNode },
  { key: 'shape', label: '插入矢量图', icon: 'ri-shape-line' },
  { key: 'annotate', label: '标记元素（点击图片元素选中加入输入框）', shortcut: 'M', icon: 'ri-mark-pen-line' },
];
const dragState = ref(null);
const panState = ref(null);
const resizeState = ref(null);
const marquee = reactive({ active: false, startX: 0, startY: 0, currentX: 0, currentY: 0 });
const annotationInput = reactive({ visible: false, layerId: '', x: 0, y: 0, width: 0, height: 0, text: '', geoPixel: null });
const manualBoxDraft = reactive({ active: false, startX: 0, startY: 0, currentX: 0, currentY: 0, layerId: '' });
// 手动框选命名输入
const manualNameInput = reactive({ visible: false, layerId: '', x: 0, y: 0, box_2d: null, text: '' });
// 重叠元素候选列表：key = "layerId::elementId" → [{layerId, el, id, name, box_2d, area}]
const elementOverlapCandidates = ref({});
// 重叠元素下拉弹窗状态
const overlapDropdown = reactive({ visible: false, x: 0, y: 0, pillKey: '', candidates: [] });
const selectedAnnotation = ref({ layerId: '', annoId: '' });
const panel = reactive({ x: null, y: 6, width: 340, chatHeight: 258, dragging: null, resizing: null, resizingChat: null });
const toolbar = reactive({ x: null, y: null, dragging: null });

const layers = computed(() => doc.value.payload.layers);
const selectedLayer = computed(() => layers.value.find((item) => item.id === selectedLayerId.value));
const selectedLayerIndex = computed(() => layers.value.findIndex((item) => item.id === selectedLayerId.value));
const viewScale = computed(() => doc.value.payload.view.scale || 1);
const viewOffset = computed(() => doc.value.payload.view.offset || { x: 0, y: 0 });

// 判断元素框是否被更高 z-index 图层遮挡
function isElementBlocked(layerId, elBox) {
  const myLayer = layers.value.find((l) => l.id === layerId);
  if (!myLayer) return false;
  const myZ = myLayer.zIndex || 0;
  const vs = viewScale.value;
  const vo = viewOffset.value;
  // 元素屏幕矩形
  const eLeft = (myLayer.x + elBox[1] * myLayer.width) * vs + vo.x;
  const eTop = (myLayer.y + elBox[0] * myLayer.height) * vs + vo.y;
  const eRight = eLeft + (elBox[3] - elBox[1]) * myLayer.width * vs;
  const eBottom = eTop + (elBox[2] - elBox[0]) * myLayer.height * vs;

  for (const l of layers.value) {
    const lz = l.zIndex || 0;
    if (lz <= myZ || l.id === layerId) continue;
    // 高层图层屏幕矩形
    const lLeft = l.x * vs + vo.x;
    const lTop = l.y * vs + vo.y;
    const lRight = lLeft + (l.width || 0) * vs;
    const lBottom = lTop + (l.height || 0) * vs;
    // 矩形相交检测
    if (eLeft < lRight && eRight > lLeft && eTop < lBottom && eBottom > lTop) {
      return true;
    }
  }
  return false;
}

// Watch for newly added layers to auto-detect
watch(() => layers.value.map((l) => l.id), (newIds, oldIds) => {
  if (!newIds || !oldIds) return;
  // 撤销恢复期间不触发自动检测（避免覆盖刚恢复的检测数据）
  if (_undoRestoring.value) return;
  const added = newIds.filter((id) => !oldIds.includes(id));
  for (const id of added) {
    const layer = layers.value.find((l) => l.id === id);
    if (layer && layer.url && layer.type !== 'placeholder') {
      // 如果该图层已经有检测数据（来自撤销恢复），不重复检测
      if (layerDetectedElements.value[id] && layerDetectedElements.value[id].length > 0) {
        console.log('[watch] 跳过已有检测数据的图层:', id);
        continue;
      }
      console.log('[watch] 触发自动检测:', id, layer.url);
      nextTick(() => maybeAutoDetect(layer));
    }
  }
});

const toolbarStyle = computed(() => (toolbar.x === null ? {} : { left: `${toolbar.x}px`, top: `${toolbar.y}px`, bottom: 'auto' }));

// 缩放滑块
const ZOOM_MIN = 0.1, ZOOM_MAX = 4.0;
const zoomSliderValue = computed(() => Math.round((viewScale.value - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN) * 100));
function setZoomFromSlider(value) {
  const newScale = ZOOM_MIN + (ZOOM_MAX - ZOOM_MIN) * (Number(value) / 100);
  setDocScale(newScale);
}
function zoomSliderReset() { setDocScale(1); }
function setDocScale(newScale) {
  if (newScale === viewScale.value) return;
  const oldScale = viewScale.value;
  canvas.updateDocument(props.id, (draft) => {
    draft.payload.view.scale = Math.round(newScale * 1000) / 1000;
    if (newScale > 0.1 && oldScale > 0.1) {
      const ratio = newScale / oldScale;
      draft.payload.view.offset.x = Math.round(draft.payload.view.offset.x * ratio);
      draft.payload.view.offset.y = Math.round(draft.payload.view.offset.y * ratio);
    }
    return draft;
  });
}

// UI 布局缓存
const UI_LAYOUT_KEY = 'youmi_canvas_ui_layout_v3';
const LAYOUT_SAVE_DEBOUNCE = 300;
let _layoutSaveTimer = null;
function loadUILayout() {
  try {
    const raw = localStorage.getItem(UI_LAYOUT_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.panel != null) {
      if (s.panel.x != null) panel.x = s.panel.x;
      if (s.panel.y != null) panel.y = s.panel.y;
      if (s.panel.width != null) panel.width = Math.max(260, Math.min(600, s.panel.width));
      if (s.panel.chatHeight != null) panel.chatHeight = Math.max(140, Math.min(800, s.panel.chatHeight));
      if (s.panel.rightTab != null) rightTab.value = s.panel.rightTab;
      if (s.panel.rightPanelVisible != null) rightPanelVisible.value = s.panel.rightPanelVisible;
    }
    if (s.minimapVisible != null) minimapVisible.value = s.minimapVisible;
    if (s.reversePromptCard != null) {
      if (s.reversePromptCard.x != null) reversePromptCard.x = s.reversePromptCard.x;
      if (s.reversePromptCard.y != null) reversePromptCard.y = s.reversePromptCard.y;
      if (s.reversePromptCard.width != null) reversePromptCard.width = Math.max(300, Math.min(900, s.reversePromptCard.width));
      if (s.reversePromptCard.height != null) reversePromptCard.height = Math.max(200, Math.min(700, s.reversePromptCard.height));
    }
    if (s.generationHistory != null) generationHistory.value = s.generationHistory;
  } catch (_) { /* ignore */ }
}
function saveUILayout() {
  try {
    localStorage.setItem(UI_LAYOUT_KEY, JSON.stringify({
      panel: { x: panel.x, y: panel.y, width: panel.width, chatHeight: panel.chatHeight, rightTab: rightTab.value, rightPanelVisible: rightPanelVisible.value },
      minimapVisible: minimapVisible.value,
      reversePromptCard: { x: reversePromptCard.x, y: reversePromptCard.y, width: reversePromptCard.width, height: reversePromptCard.height },
      generationHistory: generationHistory.value,
    }));
  } catch (_) { /* ignore */ }
}
function debounceSaveLayout() {
  clearTimeout(_layoutSaveTimer);
  _layoutSaveTimer = setTimeout(saveUILayout, LAYOUT_SAVE_DEBOUNCE);
}
watch([() => panel.x, () => panel.y, () => panel.width, () => panel.chatHeight, rightTab, rightPanelVisible, minimapVisible, () => reversePromptCard.x, () => reversePromptCard.y, () => reversePromptCard.width, () => reversePromptCard.height], debounceSaveLayout, { deep: true });

// 帮助菜单定位
const helpMenuStyle = ref({});
function openHelpMenu(event) {
  const rect = event.currentTarget.getBoundingClientRect();
  helpMenuStyle.value = { position: 'fixed', right: `${window.innerWidth - rect.right}px`, top: `${rect.top - 8}px`, transform: 'translateY(-100%)' };
  helpMenuOpen.value = !helpMenuOpen.value;
}

// 地图
const canvasMinimap = computed(() => {
  const width = 184; const height = 132; const padding = 10;
  const viewportWorld = { x: -viewOffset.value.x / viewScale.value, y: -viewOffset.value.y / viewScale.value, width: viewportSize.width / viewScale.value, height: viewportSize.height / viewScale.value };
  const boxes = layers.value.map((layer) => ({ id: layer.id, type: layer.type, selected: selectedLayerIds.value.includes(layer.id), x: layer.x, y: layer.y, width: layer.width || 1, height: layer.height || Math.round(((layer.width || 1) * (layer.naturalHeight || 1)) / (layer.naturalWidth || 1)) || 1 }));
  const boundsItems = [...boxes, { x: viewportWorld.x, y: viewportWorld.y, width: viewportWorld.width, height: viewportWorld.height }];
  const minX = Math.min(...boundsItems.map((item) => item.x));
  const minY = Math.min(...boundsItems.map((item) => item.y));
  const maxX = Math.max(...boundsItems.map((item) => item.x + item.width));
  const maxY = Math.max(...boundsItems.map((item) => item.y + item.height));
  const worldW = maxX - minX || 1; const worldH = maxY - minY || 1;
  const scale = Math.min((width - padding * 2) / worldW, (height - padding * 2) / worldH);
  const layers_ = boxes.map((box) => ({ ...box, style: { position: 'absolute', left: `${padding + (box.x - minX) * scale}px`, top: `${padding + (box.y - minY) * scale}px`, width: `${box.width * scale}px`, height: `${box.height * scale}px` } }));
  const vpLeft = padding + (viewportWorld.x - minX) * scale;
  const vpTop = padding + (viewportWorld.y - minY) * scale;
  return { width, height, layers: layers_, viewportStyle: { left: `${vpLeft}px`, top: `${vpTop}px`, width: `${viewportWorld.width * scale}px`, height: `${viewportWorld.height * scale}px` } };
});
const minimapPanState = ref(null);
function startMinimapPan(e) { if (e.button !== 0) return; const rect = e.currentTarget.getBoundingClientRect(); const mapData = canvasMinimap.value; const worldBounds = getWorldBounds(); minimapPanState.value = { startX: e.clientX, startY: e.clientY, mapLeft: rect.left, mapTop: rect.top, worldW: worldBounds.maxX - worldBounds.minX, worldH: worldBounds.maxY - worldBounds.minY, minX: worldBounds.minX, minY: worldBounds.minY }; e.currentTarget.setPointerCapture(e.pointerId); }
function moveMinimapPan(e) { if (!minimapPanState.value) return; const s = minimapPanState.value; const dx = e.clientX - s.startX; const dy = e.clientY - s.startY; const worldToMap = (canvasMinimap.value.width - 20) / s.worldW; const newCenterX = s.minX + s.worldW * (((s.mapLeft - e.clientX) * -1 + 10) / (canvasMinimap.value.width - 20)); canvas.updateDocument(props.id, (draft) => { draft.payload.view.offset = { x: Math.round(-(newCenterX * viewScale.value - viewportSize.width / 2)), y: Math.round(-(s.minY * viewScale.value - 50)) }; return draft; }); }
function stopMinimapPan(e) { if (!minimapPanState.value) return; e.currentTarget.releasePointerCapture(minimapPanState.value.pointerId); minimapPanState.value = null; }
function getWorldBounds() { let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity; for (const l of layers.value) { if (l.x < minX) minX = l.x; if (l.y < minY) minY = l.y; if (l.x + (l.width || 1) > maxX) maxX = l.x + (l.width || 1); if (l.y + (l.height || 1) > maxY) maxY = l.y + (l.height || 1); } return { minX, minY, maxX, maxY }; }

// viewport size
const viewportSize = reactive({ width: 1200, height: 800 });
function updateViewportSize() { viewportSize.width = window.innerWidth; viewportSize.height = window.innerHeight - 60; }
const demoChatMessages = [
  { id: 'demo-user-1', role: 'user', text: '3333' },
  { id: 'demo-assistant-1', role: 'assistant', text: '已提交对话修改任务，请等待生成结果（生成完成后会显示在画布中）。' },
  { id: 'demo-user-2', role: 'user', text: '（仅图片）' },
  { id: 'demo-assistant-2', role: 'assistant', text: '已添加 2 张参考图到画布。' },
];
const chatMessages = computed(() => {
  const messages = doc.value.payload.chat || [];
  const isSeedDemo = props.id === '1904' && messages.some((message) => String(message.id || '').startsWith('seed-chat-'));
  if (!isSeedDemo) return messages;
  const userMessages = messages.filter((message) => !String(message.id || '').startsWith('seed-chat-'));
  return [...demoChatMessages, ...userMessages];
});
const marqueeStyle = computed(() => {
  if (!marquee.active) return {};
  const left = Math.min(marquee.startX, marquee.currentX);
  const top = Math.min(marquee.startY, marquee.currentY);
  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${Math.abs(marquee.currentX - marquee.startX)}px`,
    height: `${Math.abs(marquee.currentY - marquee.startY)}px`,
  };
});

const manualBoxDraftStyle = computed(() => {
  if (!manualBoxDraft.active) return {};
  const left = Math.min(manualBoxDraft.startX, manualBoxDraft.currentX);
  const top = Math.min(manualBoxDraft.startY, manualBoxDraft.currentY);
  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${Math.abs(manualBoxDraft.currentX - manualBoxDraft.startX)}px`,
    height: `${Math.abs(manualBoxDraft.currentY - manualBoxDraft.startY)}px`,
  };
});

function imageSize(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || 800, height: image.naturalHeight || 800 });
    image.onerror = () => resolve({ width: 800, height: 800 });
    image.src = src;
  });
}

function videoSize(src) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const w = video.videoWidth || 1920;
      const h = video.videoHeight || 1080;
      URL.revokeObjectURL(video.src);
      resolve({ width: w, height: h });
    };
    video.onerror = () => reject(new Error('无法获取视频尺寸'));
    video.src = src;
  });
}

async function maybeAutoDetect(layer) {
  if (!layer || !layer.url || layer.type === 'placeholder') return;
  if (!autoDetectionEnabled.value) return;
  if (_undoRestoring.value) return; // 撤销恢复期间不触发自动检测
  if (detectingLayerIds.value.has(layer.id)) return;
  
  // 清除旧检测结果
  layerDetectedElements.value = { ...layerDetectedElements.value };
  delete layerDetectedElements.value[layer.id];
  selectedDetectedElements.value = new Set();
  
  detectingLayerIds.value = new Set([...detectingLayerIds.value, layer.id]);
  try {
    const res = await fetch('/api/image/detect-elements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...userStore.authHeaders() },
      body: JSON.stringify({ imageUrl: layer.url, layerId: layer.id }),
    });
    const data = await res.json();
    console.log('[detect] API 返回:', { code: data.code, elementCount: (data.data?.elements || data.data?.imageInfo)?.length });
    if ((data.code === 0 || data.code === 200) && (data.data?.elements || data.data?.imageInfo)) {
      // 归一化 box_2d: 后端 proxy_log.py 统一返回 0-1000 千分数
      const normalizeBox = (raw) => {
        if (!Array.isArray(raw) || raw.length !== 4) return null;
        // 如果所有值都 ≤ 1.05，说明已经是 0-1 归一化格式
        const allSmall = raw.every(v => Math.abs(v) <= 1.05);
        if (allSmall) return raw;
        // 否则统一除以 1000（千分数 → 0-1）
        return raw.map(v => v / 1000);
      };
      const els = (data.data.elements || data.data.imageInfo).map((e, i) => {
        const key = e.object_name || e.name || e.id || `element-${i}`;
        const box = normalizeBox(e.box_2d || e.box2d);
        return {
          ...e,
          id: key,
          name: key,
          box_2d: box || [0, 0, 1, 1], // 兜底为整图
        };
      });
      layerDetectedElements.value = { ...layerDetectedElements.value, [layer.id]: els };
      console.log('[detect] 填充 layerDetectedElements:', Object.keys(layerDetectedElements.value), '→', els.length, '个元素');
      console.log('[detect] 第一个元素完整数据:', JSON.stringify(els[0]));
      console.log('[detect] 当前 layer 信息:', { id: layer.id, x: layer.x, y: layer.y, width: layer.width, height: layer.height, viewScale: viewScale.value, viewOffset: viewOffset.value });
      // 持久化到文档 payload
      canvas.updateDocument(props.id, (draft) => {
        draft.payload.detectedElements = draft.payload.detectedElements || {};
        draft.payload.detectedElements[layer.id] = els;
        return draft;
      });
    } else {
      console.warn('[detect] API 返回异常:', data);
    }
  } catch (e) {
    console.error('[detect] 请求失败:', e);
  }
  const next = new Set(detectingLayerIds.value);
  next.delete(layer.id);
  detectingLayerIds.value = next;
}

const autoDetectionEnabled = ref(true);

// 视觉框显隐状态（默认显示）
const detectionVisible = ref(true);

function getDetectionVisible() {
  if (doc.value?.payload?.ui?.detectionVisible === false) return false;
  return detectionVisible.value !== false;
}

function setDetectionVisible(val) {
  detectionVisible.value = val;
  canvas.updateDocument(props.id, (draft) => {
    draft.payload.ui = draft.payload.ui || {};
    draft.payload.ui.detectionVisible = val;
    return draft;
  });
}

function extractUploadUrl(result) {
  return result?.url || result?.fileUrl || result?.path || result?.data?.url || result?.data?.fileUrl || result?.data?.path || result?.data?.fullUrl || result?.data?.src;
}

function uploadFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'http://101.133.149.214/prod-api/api/v1/file/upload');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress({ loaded: e.loaded, total: e.total, percent: Math.round((e.loaded / e.total) * 100) });
      }
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`图片上传失败：${xhr.status}`));
        return;
      }
      try {
        const result = JSON.parse(xhr.responseText);
        const url = extractUploadUrl(result);
        if (!url) { reject(new Error('上传成功，但接口没有返回图片地址')); return; }
        resolve(url.startsWith('http') ? url : `http://101.133.149.214${url}`);
      } catch (e) {
        reject(new Error('解析上传响应失败'));
      }
    };
    xhr.onerror = () => reject(new Error('网络错误，上传失败'));
    xhr.send(form);
  });
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isTaskDone(status) {
  return ['completed', 'succeeded', 'success', 'done'].includes(String(status || '').toLowerCase());
}

function isTaskFailed(status) {
  return ['failed', 'error', 'cancelled', 'canceled'].includes(String(status || '').toLowerCase());
}

async function readApiResponse(response) {
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || result.code !== 0) {
    throw new Error(result?.message || `接口请求失败：${response.status}`);
  }
  return result.data;
}

async function submitImageTask({ prompt, imageUrls }) {
  const body = {
    prompt,
    model: chatModel.value,
    size: chatRatio.value,
    resolution: chatResolution.value,
    n: 1,
  };
  if (imageUrls?.length) {
    body.image_urls = imageUrls;
  }

  const data = await readApiResponse(
    await fetch('/api/image-tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...userStore.authHeaders(),
      },
      body: JSON.stringify(body),
    }),
  );
  const taskId = data?.tasks?.[0]?.taskId || data?.tasks?.[0]?.task_id;
  if (!taskId) throw new Error('生图任务提交成功，但没有返回 task_id');
  return taskId;
}

async function fetchImageTask(taskId) {
  return readApiResponse(await fetch(`/api/image-tasks/${encodeURIComponent(taskId)}`));
}

function firstUrl(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = firstUrl(item);
      if (url) return url;
    }
  }
  if (typeof value === 'object') {
    return firstUrl(value.url) || firstUrl(value.imageUrl) || firstUrl(value.image_url) || firstUrl(value.src);
  }
  return '';
}

function extractTaskImageUrl(status) {
  const payload = status?.data || status;
  const direct = firstUrl(payload?.imageUrls) || firstUrl(payload?.image_urls) || firstUrl(payload?.images);
  if (direct) return direct;
  const rawImages = payload?.raw?.data?.result?.images;
  if (Array.isArray(rawImages)) {
    for (const image of rawImages) {
      const url = firstUrl(image?.url) || firstUrl(image?.urls) || firstUrl(image?.image_url);
      if (url) return url;
    }
  }
  return firstUrl(payload?.raw?.data?.url) || firstUrl(payload?.raw?.data?.imageUrl);
}

function normalizeProgress(value, fallback = 6) {
  const progress = Number(value);
  if (!Number.isFinite(progress)) return fallback;
  return Math.max(1, Math.min(100, Math.round(progress)));
}

function placeholderStatusText(progress, status = '') {
  if (isTaskFailed(status)) return '生成失败，请重试或调整提示词。';
  if (progress >= 92) return PLACEHOLDER_STATUS_TEXTS[3];
  if (progress >= 62) return PLACEHOLDER_STATUS_TEXTS[2];
  if (progress >= 24) return PLACEHOLDER_STATUS_TEXTS[1];
  return PLACEHOLDER_STATUS_TEXTS[0];
}

function updateChatMessage(messageId, patch) {
  canvas.updateDocument(props.id, (draft) => {
    draft.payload.chat = draft.payload.chat || [];
    draft.payload.chat = draft.payload.chat.map((message) => (message.id === messageId ? { ...message, ...patch } : message));
    return draft;
  });
}

function addChatMessages(messages) {
  canvas.updateDocument(props.id, (draft) => {
    draft.payload.chat = draft.payload.chat || [];
    draft.payload.chat.push(...messages);
    return draft;
  });
  scrollChatToBottom();
}

function scrollChatToBottom() {
  nextTick(() => {
    const el = chatHistoryRef.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

async function addImageLayerFromUrl(url, name = 'AI生成图片') {
  try {
    const size = await imageSize(url);
    let layerId = '';
    canvas.updateDocument(props.id, (draft) => {
      const index = draft.payload.layers.length;
      const maxZ = draft.payload.layers.reduce((max, layer) => Math.max(max, layer.zIndex || 0), 0);
      const base = selectedLayer.value;
      const width = size.width > size.height ? 360 : 280;
      const fallbackX = Math.round(((panel.x ?? 0) + 180 - viewOffset.value.x) / viewScale.value);
      const fallbackY = Math.round((170 - viewOffset.value.y) / viewScale.value);
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
      };
      layerId = layer.id;
      draft.payload.layers.push(layer);
      return draft;
    });
    selectedLayerId.value = layerId;
    selectedLayerIds.value = [layerId];
    return layerId;
  } catch (error) {
    console.error('[addImageLayerFromUrl] 添加图片图层失败:', error);
    window.alert('添加图片图层失败: ' + (error.message || '未知错误'));
    return '';
  }
}

function addGeneratingPlaceholderLayer(prompt) {
  pushUndo();
  const referenceImages = chatReferenceImages.value.filter((image) => !image.uploading && !image.error);
  const selected = selectedLayer.value;
  const fallbackBase = [...layers.value].reverse().find((layer) => layer.type !== 'placeholder');
  const base = selected?.type === 'placeholder' ? fallbackBase : selected;
  const previewUrl = referenceImages.at(-1)?.url || base?.url || '';
  let layerId = '';

  canvas.updateDocument(props.id, (draft) => {
    const index = draft.payload.layers.length;
    const maxZ = draft.payload.layers.reduce((max, layer) => Math.max(max, layer.zIndex || 0), 0);
    // 跟在选中图层后面（右下偏移），没有选中则居中
    const base = selected?.type === 'placeholder' ? [...layers.value].reverse().find((l) => l.type !== 'placeholder') : selected;
    const cx = (viewportSize.width / 2 - viewOffset.value.x) / viewScale.value;
    const cy = (viewportSize.height / 2 - viewOffset.value.y) / viewScale.value;
    const fallbackX = cx - PLACEHOLDER_WIDTH / 2;
    const fallbackY = cy - PLACEHOLDER_HEIGHT / 2;
    const layer = {
      id: `placeholder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'placeholder',
      name: layerName(index),
      prompt,
      progress: 6,
      status: 'submitted',
      statusText: placeholderStatusText(6),
      url: '',
      thumbnailUrl: previewUrl,
      previewUrl,
      naturalWidth: PLACEHOLDER_WIDTH,
      naturalHeight: PLACEHOLDER_HEIGHT,
      width: PLACEHOLDER_WIDTH,
      height: PLACEHOLDER_HEIGHT,
      x: base ? base.x + base.width + 40 : fallbackX,
      y: base ? base.y : fallbackY,
      zIndex: maxZ + 1,
      visible: true,
      locked: false,
    };
    layerId = layer.id;
    draft.payload.layers.push(layer);
    return draft;
  });

  selectedLayerId.value = layerId;
  selectedLayerIds.value = [layerId];
  return layerId;
}

function updateGeneratingPlaceholder(layerId, patch) {
  const nextPatch = { ...patch };
  if (patch.progress !== undefined) {
    nextPatch.progress = normalizeProgress(patch.progress);
  }
  nextPatch.statusText = patch.statusText || placeholderStatusText(normalizeProgress(patch.progress, 6), patch.status);
  updateLayer(layerId, nextPatch);
}

async function replaceGeneratingPlaceholder(layerId, url) {
  pushUndo();
  try {
    const size = await imageSize(url);
    let replaced = false;
    canvas.updateDocument(props.id, (draft) => {
      const index = draft.payload.layers.findIndex((layer) => layer.id === layerId);
      if (index === -1) return draft;
      const placeholder = draft.payload.layers[index];
      const width = placeholder.width || (size.width > size.height ? 360 : 280);
      const height = Math.round((width * size.height) / size.width);
      // 跟在选中图层后面（右下偏移）
      const base = [...layers.value].reverse().find((l) => l.id !== layerId && l.type !== 'placeholder');
      const cx = (viewportSize.width / 2 - viewOffset.value.x) / viewScale.value;
      const cy = (viewportSize.height / 2 - viewOffset.value.y) / viewScale.value;
      draft.payload.layers[index] = {
        ...placeholder,
        type: 'image',
        url,
        thumbnailUrl: url,
        naturalWidth: size.width,
        naturalHeight: size.height,
        width,
        height,
        x: base ? base.x + base.width + 40 : cx - width / 2,
        y: base ? base.y : cy - height / 2,
        progress: undefined,
        status: undefined,
        statusText: undefined,
        previewUrl: undefined,
        source: 'AI生成图片',
      };
      replaced = true;
      return draft;
    });

    if (!replaced) return addImageLayerFromUrl(url);
    selectedLayerId.value = layerId;
    selectedLayerIds.value = [layerId];
    // 生图完成后自动检测元素
    const newLayer = layers.value.find((l) => l.id === layerId);
    if (newLayer) nextTick(() => maybeAutoDetect(newLayer));
    return layerId;
  } catch (error) {
    console.error('[replaceGeneratingPlaceholder] 替换占位图层失败:', error);
    updateLayer(layerId, { progress: 1, status: 'failed', statusText: `渲染失败：${error.message || '未知错误'}` });
    return '';
  }
}

function openImageUpload(mode = 'canvas') {
  if (!userStore.requireLogin()) return;
  fileInputMode.value = mode;
  addOpen.value = false;
  fileInput.value?.click();
}

// 添加文字节点（直接在画布上创建可编辑文字图层）
// 添加文字节点（v4 风格：440×320，透明背景，#f5f5f5 文本区 + 提示词标签）
function addTextNode() {
  if (!userStore.requireLogin()) return;
  pushUndo();
  let layerId = '';
  canvas.updateDocument(props.id, (draft) => {
    const index = draft.payload.layers.length;
    const maxZ = draft.payload.layers.reduce((max, layer) => Math.max(max, layer.zIndex || 0), 0);
    const base = selectedLayer.value;
    const fallbackX = Math.round(((panel.x ?? 0) + 180 - viewOffset.value.x) / viewScale.value);
    const fallbackY = Math.round((170 - viewOffset.value.y) / viewScale.value);
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
    };
    layerId = layer.id;
    draft.payload.layers.push(layer);
    return draft;
  });
  selectedLayerId.value = layerId;
  selectedLayerIds.value = [layerId];
  activeTool.value = 'select';
}

// 添加视频节点（v4 风格：占位态，双击上传视频）
function addVideoNode() {
  if (!userStore.requireLogin()) return;
  pushUndo();
  let layerId = '';
  canvas.updateDocument(props.id, (draft) => {
    const index = draft.payload.layers.length;
    const maxZ = draft.payload.layers.reduce((max, layer) => Math.max(max, layer.zIndex || 0), 0);
    const base = selectedLayer.value;
    const fallbackX = Math.round(((panel.x ?? 0) + 180 - viewOffset.value.x) / viewScale.value);
    const fallbackY = Math.round((170 - viewOffset.value.y) / viewScale.value);
    const layer = {
      id: `layer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: layerName(index),
      type: 'video',
      url: '',
      thumbnailUrl: '',
      width: 320,
      height: 240,
      x: base ? base.x + 30 : fallbackX,
      y: base ? base.y + 30 : fallbackY,
      zIndex: maxZ + 1,
      visible: true,
      locked: false,
    };
    layerId = layer.id;
    draft.payload.layers.push(layer);
    return draft;
  });
  selectedLayerId.value = layerId;
  selectedLayerIds.value = [layerId];
  activeTool.value = 'select';
}

// 添加图片节点（v4 风格：占位态，双击上传图片）
function addImageNode() {
  if (!userStore.requireLogin()) return;
  pushUndo();
  let layerId = '';
  canvas.updateDocument(props.id, (draft) => {
    const index = draft.payload.layers.length;
    const maxZ = draft.payload.layers.reduce((max, layer) => Math.max(max, layer.zIndex || 0), 0);
    const base = selectedLayer.value;
    const fallbackX = Math.round(((panel.x ?? 0) + 180 - viewOffset.value.x) / viewScale.value);
    const fallbackY = Math.round((170 - viewOffset.value.y) / viewScale.value);
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
    };
    layerId = layer.id;
    draft.payload.layers.push(layer);
    return draft;
  });
  selectedLayerId.value = layerId;
  selectedLayerIds.value = [layerId];
  activeTool.value = 'select';
}

// 双击上传图片/视频 → 替换占位节点为真实内容
function uploadNodeMedia(layer) {
  const input = document.createElement('input');
  input.type = 'file';
  if (layer.type === 'video') {
    input.accept = 'video/*';
  } else {
    input.accept = 'image/*';
  }
  input.onchange = async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    pushUndo();
    // 读取为 data URL 临时显示
    const reader = new FileReader();
    reader.onload = async (event) => {
      const dataUrl = event.target.result;
      if (layer.type === 'video') {
        // 视频：获取尺寸后自适应
        try {
          const size = await videoSize(dataUrl);
          const width = size.width > size.height ? 480 : 360;
          updateLayer(layer.id, {
            url: dataUrl,
            type: 'video',
            naturalWidth: size.width,
            naturalHeight: size.height,
            width,
            height: Math.round((width * size.height) / size.width),
          });
        } catch {
          updateLayer(layer.id, { url: dataUrl, type: 'video', width: 480, height: 270 });
        }
      } else {
        // 图片：获取尺寸后自适应
        try {
          const size = await imageSize(dataUrl);
          const width = size.width > size.height ? 360 : 280;
          updateLayer(layer.id, {
            url: dataUrl,
            type: 'image',
            naturalWidth: size.width,
            naturalHeight: size.height,
            width,
            height: Math.round((width * size.height) / size.width),
          });
        } catch {
          updateLayer(layer.id, { url: dataUrl, type: 'image', width: 280, height: 280 });
        }
      }
      // 上传完成后自动智能分层
      await nextTick();
      const updatedLayer = layers.value.find((l) => l.id === layer.id);
      if (updatedLayer) maybeAutoDetect(updatedLayer);
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

// 双击编辑文本节点
const editingTextLayerId = ref(null);
const editingTextValue = ref('');

// 图片查看器状态
const imageViewer = reactive({
  show: false,
  url: '',
  name: '',
  rotation: 0,    // 旋转角度
  flipX: false,    // 左右镜像
  flipY: false,    // 上下镜像
  scale: 1,        // 缩放
});

// 打开图片查看器
function openImageViewer(url, name) {
  imageViewer.show = true;
  imageViewer.url = url;
  imageViewer.name = name || '图片';
  imageViewer.rotation = 0;
  imageViewer.flipX = false;
  imageViewer.flipY = false;
  imageViewer.scale = 1;
}

// 关闭图片查看器
function closeImageViewer() {
  imageViewer.show = false;
  imageViewer.url = '';
}

// 旋转图片
function rotateImage(deg) {
  imageViewer.rotation = (imageViewer.rotation + deg + 360) % 360;
}

// 镜像翻转
function flipImage(axis) {
  if (axis === 'x') imageViewer.flipX = !imageViewer.flipX;
  else imageViewer.flipY = !imageViewer.flipY;
}

// 缩放
function zoomImage(delta) {
  imageViewer.scale = Math.max(0.25, Math.min(4, imageViewer.scale + delta));
}

// 下载图片
function downloadImage() {
  const a = document.createElement('a');
  a.href = imageViewer.url;
  a.download = imageViewer.name || 'image';
  a.click();
}

// figure 上的 dblclick 统一入口（因为 setPointerCapture 会劫持内层事件）
function onLayerDblClick(event, layer) {
  if (layer.type === 'text') {
    startEditText(layer);
  } else if (layer.type === 'image-placeholder' || (layer.type === 'video' && !layer.url)) {
    uploadNodeMedia(layer);
  } else if (layer.url && (layer.type === 'image' || (layer.url && !layer.type))) {
    // 双击图片：打开查看器
    openImageViewer(layer.url, layer.name);
  }
}

function startEditText(layer) {
  pushUndo();
  editingTextLayerId.value = layer.id;
  editingTextValue.value = layer.text || '';
  nextTick(() => {
    const input = document.querySelector('.uc-text-edit-input');
    if (input) input.focus();
  });
}

function finishEditText() {
  if (!editingTextLayerId.value) return;
  updateLayer(editingTextLayerId.value, { text: editingTextValue.value || '双击编辑文字' });
  editingTextLayerId.value = null;
  editingTextValue.value = '';
}

// 格式化图层创建时间（从 layer.id 中提取时间戳）
function formatLayerTime(layer) {
  const match = layer.id?.match(/layer-(\d+)-/);
  if (!match) return '';
  const ts = parseInt(match[1], 10);
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 播放视频节点（在新窗口打开视频）
function playVideoNode(layer) {
  if (layer.url) window.open(layer.url, '_blank');
}

function toggleAddMenu() {
  if (!userStore.requireLogin()) return;
  addOpen.value = !addOpen.value;
}

function removeChatReferenceImage(imageId) {
  const image = chatReferenceImages.value.find((item) => item.id === imageId);
  if (image?.localUrl?.startsWith('blob:')) URL.revokeObjectURL(image.localUrl);
  chatReferenceImages.value = chatReferenceImages.value.filter((item) => item.id !== imageId);
  activeChatReferenceId.value = chatReferenceImages.value.at(-1)?.id || '';
}

async function addFiles(fileList, options = {}) {
  const files = [...fileList].filter((file) => file.type.startsWith('image/'));
  let uploadedCount = 0;
  for (const file of files) {
    let referenceImage = null;
    if (options.addToChatDeck) {
      const localUrl = URL.createObjectURL(file);
      referenceImage = {
        id: `ref-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: file.name,
        localUrl,
        url: localUrl,
        uploading: true,
      };
      chatReferenceImages.value.push(referenceImage);
      activeChatReferenceId.value = referenceImage.id;
    }

    try {
      uploadProgress.value = { fileName: file.name, loaded: 0, total: file.size, percent: 0 };
      const url = await uploadFile(file, (p) => {
        uploadProgress.value = { fileName: file.name, loaded: p.loaded, total: p.total, percent: p.percent };
      });
      uploadProgress.value = null;
      if (referenceImage) {
        referenceImage.url = url;
        referenceImage.uploading = false;
        if (referenceImage.localUrl?.startsWith('blob:')) URL.revokeObjectURL(referenceImage.localUrl);
        referenceImage.localUrl = '';
      }

      const size = await imageSize(url);
      let layerId = '';
      canvas.updateDocument(props.id, (draft) => {
        const index = draft.payload.layers.length;
        const width = size.width > size.height ? 360 : 260;
        const layer = {
          id: `layer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: layerName(index),
          url,
          thumbnailUrl: url,
          naturalWidth: size.width,
          naturalHeight: size.height,
          width,
          height: Math.round((width * size.height) / size.width),
          x: 80 + index * 36,
          y: 110 + index * 32,
          zIndex: index + 1,
          visible: true,
          locked: false,
        };
        layerId = layer.id;
        draft.payload.layers.push(layer);
        selectedLayerId.value = layer.id;
        selectedLayerIds.value = [layer.id];
        return draft;
      });
      if (referenceImage) referenceImage.layerId = layerId;
      uploadedCount += 1;
    } catch (error) {
      uploadProgress.value = null;
      if (referenceImage) {
        referenceImage.uploading = false;
        referenceImage.error = true;
      }
      throw error;
    }
  }
  if (uploadedCount && options.addChatNotice) {
    canvas.updateDocument(props.id, (draft) => {
      draft.payload.chat = draft.payload.chat || [];
      draft.payload.chat.push({
        id: `msg-${Date.now()}-upload`,
        role: 'assistant',
        text: `已添加 ${uploadedCount} 张参考图到画布。`,
        createdAt: Date.now(),
      });
      return draft;
    });
  }
  return uploadedCount;
}

async function onFileChange(event) {
  if (!userStore.requireLogin()) {
    event.target.value = '';
    return;
  }
  addOpen.value = false;
  const isChatUpload = fileInputMode.value === 'chat';
  if (isChatUpload) chatUploading.value = true;
  try {
    await addFiles(event.target.files || [], { addChatNotice: isChatUpload, addToChatDeck: isChatUpload });
  } catch (error) {
    window.alert(error.message || '图片上传失败');
  } finally {
    chatUploading.value = false;
    fileInputMode.value = 'canvas';
    event.target.value = '';
  }
}

function updateLayer(id, patch) {
  canvas.updateDocument(props.id, (draft) => {
    draft.payload.layers = draft.payload.layers.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer));
    return draft;
  });
}

function removeLayer(id) {
  if (!userStore.requireLogin()) return;
  pushUndo();
  canvas.updateDocument(props.id, (draft) => {
    draft.payload.layers = draft.payload.layers.filter((layer) => layer.id !== id);
    return draft;
  });
  selectedLayerId.value = layers.value[0]?.id || '';
  selectedLayerIds.value = selectedLayerId.value ? [selectedLayerId.value] : [];
}

function startLayerDrag(event, layer) {
  if (!userStore.requireLogin()) return;
  if (activeTool.value === 'hand') return;
  if (activeTool.value === 'annotate') return;
  if (event.ctrlKey || event.metaKey) return; // Ctrl+拖拽由 stage 的 startMarquee 处理
  if (event.button !== 0 || event.target.closest('.layer-toolbar') || event.target.closest('.resize-dot')) return;
  pushUndo();
  event.stopPropagation();
  event.currentTarget.setPointerCapture(event.pointerId);
  const draggingGroup = selectedLayerIds.value.length > 1 && selectedLayerIds.value.includes(layer.id);
  if (!draggingGroup) {
    selectedLayerId.value = layer.id;
    selectedLayerIds.value = [layer.id];
  }
  const ids = draggingGroup ? [...selectedLayerIds.value] : [layer.id];
  dragState.value = {
    pointerId: event.pointerId,
    ids,
    startX: event.clientX,
    startY: event.clientY,
    origins: layers.value
      .filter((item) => ids.includes(item.id))
      .map((item) => ({ id: item.id, x: item.x, y: item.y })),
  };
}

function moveLayer(event) {
  if (!dragState.value) return;
  refreshConnections();
  const scale = doc.value.payload.view.scale || 1;
  const dx = (event.clientX - dragState.value.startX) / scale;
  const dy = (event.clientY - dragState.value.startY) / scale;
  canvas.updateDocument(props.id, (draft) => {
    draft.payload.layers = draft.payload.layers.map((layer) => {
      const origin = dragState.value.origins.find((item) => item.id === layer.id);
      if (!origin) return layer;
      return { ...layer, x: Math.round(origin.x + dx), y: Math.round(origin.y + dy) };
    });
    return draft;
  });
}

function stopLayerDrag(event) {
  if (!dragState.value) return;
  if (event.currentTarget.hasPointerCapture(dragState.value.pointerId)) event.currentTarget.releasePointerCapture(dragState.value.pointerId);
  dragState.value = null;
}

function smartToggleElement(layerId, elementId, event) {
  if (activeTool.value !== 'annotate' && !(event && (event.ctrlKey || event.metaKey))) return;
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const key = `${layerId}::${elementId}`;
  const set = new Set(selectedDetectedElements.value);
  // 多选模式：点击切换选中/取消，不清除其他已选元素
  if (set.has(key)) {
    set.delete(key);
  } else {
    set.add(key);
  }
  selectedDetectedElements.value = set;
  if (event) {
    const overlay = event.currentTarget.closest('.detected-elements-overlay');
    const overlayRect = overlay ? overlay.getBoundingClientRect() : event.currentTarget.getBoundingClientRect();
    const clickX = event.clientX - overlayRect.left;
    const clickY = event.clientY - overlayRect.top;
    
    // 计算点击位置相对于元素框的归一化坐标（0-1）
    const [layerId, elId] = key.split('::');
    const elements = layerDetectedElements.value[layerId] || [];
    const el = elements.find((e) => (e.object_name || e.name || e.id) === elId);
    const layer = layers.value.find((l) => l.id === layerId);
    
    if (el && layer) {
      const box = normalizeBoxVal(el.box_2d || el.box2d || [0, 0, 1, 1]);
      const vs = viewScale.value;
      const vo = viewOffset.value;
      
      // 元素框的像素坐标
      const boxLeft = (layer.x + box[1] * layer.width) * vs + vo.x;
      const boxTop = (layer.y + box[0] * layer.height) * vs + vo.y;
      const boxWidth = (box[3] - box[1]) * layer.width * vs;
      const boxHeight = (box[2] - box[0]) * layer.height * vs;
      
      // 计算相对位置（0-1）
      const relX = boxWidth > 0 ? Math.max(0, Math.min(1, (clickX - boxLeft) / boxWidth)) : 0.5;
      const relY = boxHeight > 0 ? Math.max(0, Math.min(1, (clickY - boxTop) / boxHeight)) : 0.5;
      
      elementClickPositions.value = {
        ...elementClickPositions.value,
        [key]: { relX, relY },
      };
    } else {
      // fallback: 存储绝对坐标
      elementClickPositions.value = {
        ...elementClickPositions.value,
        [key]: { x: clickX, y: clickY },
      };
    }
  }
  chatSkipPillSync.value = false;
}

// 查找点击坐标处重叠元素（只返回最高 z-index 图层内的元素）
function findElementsAtPoint(clientX, clientY) {
  const overlayEl = document.querySelector('.detected-elements-overlay');
  if (!overlayEl) return [];
  const overlayRect = overlayEl.getBoundingClientRect();
  const cx = clientX - overlayRect.left;
  const cy = clientY - overlayRect.top;
  const vs = viewScale.value;
  const vo = viewOffset.value;

  // 先找点击处最高 z-index 的图层
  let topLayerId = null;
  let topZ = -Infinity;
  for (const layer of layers.value) {
    const lLeft = layer.x * vs + vo.x;
    const lTop = layer.y * vs + vo.y;
    const lRight = lLeft + (layer.width || 0) * vs;
    const lBottom = lTop + (layer.height || 0) * vs;
    if (cx >= lLeft && cx <= lRight && cy >= lTop && cy <= lBottom) {
      const lz = layer.zIndex || 0;
      if (lz > topZ) { topZ = lz; topLayerId = layer.id; }
    }
  }

  const results = [];
  for (const [layerId, elements] of Object.entries(layerDetectedElements.value)) {
    // 如果有点击处最高图层，只返回该图层的元素
    if (topLayerId && layerId !== topLayerId) continue;
    const layer = layers.value.find((l) => l.id === layerId);
    if (!layer) continue;
    for (const el of elements) {
      const box = el.box_2d || el.box2d || [0, 0, 1, 1];
      const left = (layer.x + box[1] * layer.width) * vs + vo.x;
      const top = (layer.y + box[0] * layer.height) * vs + vo.y;
      const right = left + (box[3] - box[1]) * layer.width * vs;
      const bottom = top + (box[2] - box[0]) * layer.height * vs;
      if (cx >= left && cx <= right && cy >= top && cy <= bottom) {
        results.push({
          layerId,
          el,
          box_2d: box,
          area: (box[3] - box[1]) * (box[2] - box[0]),
          id: el.object_name || el.name || el.id,
          name: el.object_name || el.name || '',
        });
      }
    }
  }
  return results;
}

// 查找与给定元素框有交叠的所有元素（用于下拉候选列表）
// 只要两框有任意面积交集就算重叠
// 只在同一图层内比较——不同图层的坐标空间不一致，无意义
function findOverlappingElements(targetLayerId, targetBox) {
  const results = [];
  const elements = layerDetectedElements.value[targetLayerId];
  if (!elements) return results;
  for (const el of elements) {
    const box = el.box_2d || el.box2d || [0, 0, 1, 1];
    // 检查两框是否相交
    const il = Math.max(targetBox[1], box[1]);
    const it = Math.max(targetBox[0], box[0]);
    const ir = Math.min(targetBox[3], box[3]);
    const ib = Math.min(targetBox[2], box[2]);
    if (il < ir && it < ib) {
      results.push({
        layerId: targetLayerId,
        el,
        box_2d: box,
        area: (box[3] - box[1]) * (box[2] - box[0]),
        id: el.object_name || el.name || el.id,
        name: el.object_name || el.name || '',
      });
    }
  }
  return results;
}

// 基于视觉几何分析判断前景元素
// 核心原理：在2D图像中，如果A大部分在B的边界框内，说明A是B上面的物体（前景）
// 例如：茶杯在桌子上 → 茶杯大部分在桌子框内 → 茶杯是前景
//       人物坐在沙发上 → 人物大部分在沙发框内 → 人物是前景
function pickBestElement(candidates) {
  if (candidates.length === 1) return candidates[0];

  // boxA 被 boxB 覆盖的比例（A 有多少面积落在 B 内部）
  const coverage = (boxA, boxB) => {
    const il = Math.max(boxA[1], boxB[1]);
    const it = Math.max(boxA[0], boxB[0]);
    const ir = Math.min(boxA[3], boxB[3]);
    const ib = Math.min(boxA[2], boxB[2]);
    if (il >= ir || it >= ib) return 0;
    const iArea = (ir - il) * (ib - it);
    const aArea = (boxA[3] - boxA[1]) * (boxA[2] - boxA[0]);
    return aArea > 0 ? iArea / aArea : 0;
  };

  // 完全包含
  const fullyContains = (boxOuter, boxInner) =>
    boxOuter[1] <= boxInner[1] && boxOuter[0] <= boxInner[0] &&
    boxOuter[3] >= boxInner[3] && boxOuter[2] >= boxInner[2];

  const scored = candidates.map((c) => {
    const b = c.box_2d;
    const area = c.area;
    let score = 0;

    // 1) 面积：越小越像前景细节（权重 30%）
    //    茶杯面积通常 0.5%，沙发可能 30%，人物可能 15%
    score += (1 - Math.min(area * 3, 1)) * 0.30;

    // 2) 底边深度：底边越靠下 ≈ 越靠近镜头（权重 5%）
    //    透视原理：近大远小，近的物体底部更靠下
    score += b[2] * 0.05;

    // 3) 与其他元素的空间关系（权重 65%）
    let relation = 0;
    for (const other of candidates) {
      if (other === c) continue;
      const ob = other.box_2d;
      const cInO = fullyContains(ob, b);  // c 完全在 other 内
      const oInC = fullyContains(b, ob);  // other 完全在 c 内

      // 3a) 完全包含 → 内部小框是前景
      if (cInO) {
        relation += 0.50;  // c 在 other 内 → c 是前景（茶杯在桌面上）
        continue;
      }
      if (oInC) {
        relation -= 0.25;  // other 在 c 内 → c 是背景容器
        continue;
      }

      // 3b) 部分重叠：A 大部分在 B 内 → A 是 B 上面的前景物体
      //     这才是正确的方向！
      //     人物大部分在沙发框内 → 人物坐在沙发上 → 人物在前
      //     茶杯大部分在桌子框内 → 茶杯放在桌上 → 茶杯在前
      const cInOPct = coverage(b, ob);   // c 有多少落在 other 内
      const oInCPct = coverage(ob, b);   // other 有多少落在 c 内

      if (cInOPct > 0.5) {
        // c 大部分在 other 内 → c 是前景物体（坐在沙发上/放在桌上）
        relation += 0.35 * cInOPct;  // 覆盖率越高，越确信是前景
      }
      if (oInCPct > 0.5) {
        // other 大部分在 c 内 → other 是前景，c 是背景
        relation -= 0.20 * oInCPct;
      }
    }
    score += Math.max(-0.45, Math.min(0.65, relation));

    return { ...c, score, area, name: c.name };
  });

  scored.sort((a, b) => b.score - a.score);

  if (candidates.length >= 2) {
    console.log(
      '[smart-click] 重叠', candidates.length, '个 → 选中',
      `"${scored[0].name}" (score=${scored[0].score.toFixed(3)}, area=${scored[0].area.toFixed(4)})`,
      '| 次选', `"${scored[1].name}" (score=${scored[1].score.toFixed(3)}, area=${scored[1].area.toFixed(4)})`
    );
  }

  return scored[0];
}

// 将消息文本中的 [元素名] 替换为结构化元素标签
function renderMessageContent(message) {
  let html = escHtml(message.text || '');
  if (message.elements?.length) {
    for (const el of message.elements) {
      const name = escHtml(el.name);
      const thumb = escHtml(el.thumb || '');
      const order = el.order;
      const pillHtml = `<span class="chat-pill chat-pill-msg" contenteditable="false" data-el-layer="${escHtml(el.layerId)}" data-el-name="${escHtml(el.name)}" data-el-order="${order}"><span class="chat-pill-num">${order}</span>${thumb ? `<img src="${thumb}" alt="" />` : ''}${name}</span>`;
      // 替换 [name] 第一次出现
      html = html.replace(`[${name}]`, pillHtml);
    }
  }
  return html;
}

// 聊天消息中元素 pill 悬停预览
const hoverPreviewPillRef = ref(null); // 当前悬停的 pill DOM 元素，避免重复触发

function handleChatPillEnter(event) {
  const pill = event.target.closest('.chat-pill-msg');
  if (!pill) {
    // 鼠标移到非 pill 区域，隐藏预览
    if (hoverPreviewPillRef.value) {
      clearTimeout(hoverPreviewTimer.value);
      hoverPreview.visible = false;
      hoverPreviewPillRef.value = null;
    }
    return;
  }
  // 同一个 pill，不重复处理
  if (hoverPreviewPillRef.value === pill) return;
  hoverPreviewPillRef.value = pill;
  showPillPreview(pill, event);
}

function handleChatPillMove(event) {
  if (!hoverPreview.visible) return;
  clampPreviewPosition(event.clientX + 16, event.clientY + 12);
}

function handleChatPillLeave(event) {
  const pill = event.target.closest('.chat-pill-msg');
  if (pill) {
    // 鼠标移出 pill 到其子元素上，检查 relatedTarget 是否还在同一个 pill 内
    const related = event.relatedTarget;
    if (related && pill.contains(related)) return;
  }
  // 鼠标离开了 pill
  if (!hoverPreviewPillRef.value) return;
  clearTimeout(hoverPreviewTimer.value);
  hoverPreviewTimer.value = setTimeout(() => {
    hoverPreview.visible = false;
    hoverPreviewPillRef.value = null;
  }, 120);
}

function clampPreviewPosition(x, y) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pw = hoverPreviewDims.w;
  const ph = hoverPreviewDims.h;
  // 右边界溢出 → 翻转到左边
  if (x + pw + 8 > vw) x = x - pw - 32;
  // 下边界溢出 → 翻转到上边
  if (y + ph + 8 > vh) y = y - ph - 24;
  // 不超出左上边界
  hoverPreview.x = Math.max(4, x);
  hoverPreview.y = Math.max(4, y);
}

function showPillPreview(pill, event) {
  clearTimeout(hoverPreviewTimer.value);
  const layerId = pill.getAttribute('data-el-layer');
  const elName = pill.getAttribute('data-el-name');
  const elOrder = parseInt(pill.getAttribute('data-el-order') || '0', 10);
  if (!layerId || !elName) return;

  const layer = layers.value.find((l) => l.id === layerId);
  if (!layer?.url) return;

  // 从检测数据中查找元素的 box
  const boxes = layer?.detection?.boxes || [];
  let foundBox = null;
  for (const b of boxes) {
    if ((b.name || b.object_name) === elName) {
      foundBox = normalizeBoxVal(b.box2d || b.box_2d || []);
      break;
    }
  }
  // 如果没找到精确匹配，尝试从 layerDetectedElements 中查找
  if (!foundBox) {
    const els = layerDetectedElements.value[layerId];
    if (els) {
      for (const el of els) {
        if (el.name === elName) {
          foundBox = el.box2d || el.box_2d || [];
          break;
        }
      }
    }
  }

  // 预载图片以获取自然尺寸
  const img = new Image();
  img.onload = () => {
    hoverPreviewImageSize.width = img.naturalWidth || 800;
    hoverPreviewImageSize.height = img.naturalHeight || 800;
    // 计算预览弹窗实际渲染尺寸（图片最大 240x340，容器 + padding 10*2 + border 2*2）
    const ratio = img.naturalWidth / img.naturalHeight;
    let imgW, imgH;
    if (ratio >= 1) {
      imgW = Math.min(240, 340 * ratio);
      imgH = imgW / ratio;
    } else {
      imgH = Math.min(340, 240 / ratio);
      imgW = imgH * ratio;
    }
    hoverPreviewDims.w = imgW + 24;
    hoverPreviewDims.h = imgH + 24;
    hoverPreview.layerUrl = layer.url;
    hoverPreview.box = foundBox;
    hoverPreview.name = elName;
    hoverPreview.order = elOrder;
    clampPreviewPosition(event.clientX + 16, event.clientY + 12);
    hoverPreview.visible = true;
  };
  img.onerror = () => {
    hoverPreviewImageSize.width = 800;
    hoverPreviewImageSize.height = 800;
    hoverPreviewDims.w = 264;
    hoverPreviewDims.h = 224;
    hoverPreview.layerUrl = layer.url;
    hoverPreview.box = foundBox;
    hoverPreview.name = elName;
    hoverPreview.order = elOrder;
    clampPreviewPosition(event.clientX + 16, event.clientY + 12);
    hoverPreview.visible = true;
  };
  img.src = layer.url;
}

// 标注模式或 Ctrl+点击时，智能选择重叠区域最前景元素
function handleDetectedOverlayClick(event) {
  // 如果点击的是 annotate-banner（退出标记按钮等），放行
  if (event.target.closest?.('.annotate-banner')) return;

  const inAnnotate = activeTool.value === 'annotate';
  const withCtrl = event.ctrlKey || event.metaKey;
  if (!inAnnotate && !withCtrl) return;

  // 如果命名框正在显示，先确认当前元素，放行事件让 startMarquee 处理新框选
  if (manualNameInput.visible) {
    confirmManualElementName();
    return; // 放行，让事件冒泡到 stage
  }

  const candidates = findElementsAtPoint(event.clientX, event.clientY);
  if (!candidates.length) {
    if (inAnnotate) return; // 放行手动框选
    return;
  }
  event.preventDefault();
  event.stopPropagation();

  const best = pickBestElement(candidates);
  const key = `${best.layerId}::${best.id}`;
  const set = new Set(selectedDetectedElements.value);
  if (set.has(key)) {
    set.delete(key);
    // 取消选中时清除候选列表
    const nextCandidates = { ...elementOverlapCandidates.value };
    delete nextCandidates[key];
    elementOverlapCandidates.value = nextCandidates;
  } else {
    set.add(key);
    // 选中时存储所有重叠候选（用于 pill 下拉切换）
    // 用框重叠分析替代点检测——这样即使点击的精确像素
    // 没落在相邻框内，只要两框有交集就能出现在下拉列表里
    const targetBox = best.box_2d || [0, 0, 1, 1];
    console.log('[overlap-candidates] targetBox=', targetBox.map(v => v.toFixed(4)), 'area=', ((targetBox[3]-targetBox[1])*(targetBox[2]-targetBox[0])).toFixed(4));
    const overlappingCandidates = findOverlappingElements(best.layerId, targetBox);
    const storedCandidates = overlappingCandidates.map((c) => ({
      layerId: c.layerId,
      id: c.id,
      name: c.name,
      box_2d: c.box_2d,
      area: c.area,
    }));
    elementOverlapCandidates.value = {
      ...elementOverlapCandidates.value,
      [key]: storedCandidates,
    };
    console.log('[overlap-candidates] 存储了', storedCandidates.length, '个候选 for key=', key, storedCandidates.map(c => c.name));
  }
  selectedDetectedElements.value = set;
  const overlayEl = document.querySelector('.detected-elements-overlay');
  const overlayRect = overlayEl?.getBoundingClientRect() || { left: 0, top: 0 };
  elementClickPositions.value = {
    ...elementClickPositions.value,
    [key]: { x: event.clientX - overlayRect.left, y: event.clientY - overlayRect.top },
  };
  chatSkipPillSync.value = false;
}

// 从编辑器 DOM 提取纯文本（用于空判断和发送）
function updateChatTextFromEditor() {
  const editor = document.querySelector('.chat-editor');
  if (!editor) return;
  const textParts = [];
  for (const node of editor.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent;
      if (t && t !== '\u00a0') textParts.push(t);
    } else if (node.nodeType === Node.ELEMENT_NODE && !node.classList.contains('chat-pill')) {
      textParts.push(node.textContent || '');
    }
  }
  chatText.value = textParts.join('');
}

// 构建含元素名称的结构化提示词: [元素1] 修改文字1 [元素2] 修改文字2
function getEditorPrompt() {
  const editor = document.querySelector('.chat-editor');
  if (!editor) return chatText.value.trim();
  const parts = [];
  for (const node of editor.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent || '').replace(/\u00a0/g, ' ').trim();
      if (t) parts.push(t);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.classList.contains('chat-pill')) {
        const name = node.dataset.elName || node.dataset.elId || '';
        if (name) parts.push(`[${name}]`);
      } else {
        const t = (node.textContent || '').replace(/\u00a0/g, ' ').trim();
        if (t) parts.push(t);
      }
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

// 同步：editor 里被 Backspace 删除的 pill → 取消画布选中
// 用 MutationObserver 代替 @input，因为 contenteditable 的 @input
// 可能在 pill 完全移出 DOM 之前触发，导致检测不到删除
let _pillObserver = null;

function setupPillObserver() {
  const editor = document.querySelector('.chat-editor');
  if (!editor || _pillObserver) return;
  _pillObserver = new MutationObserver(() => {
    if (_pillSyncLock > 0) return;
    syncPillDeletions();
  });
  _pillObserver.observe(editor, { childList: true, subtree: true });
}

function handleEditorBackspace(event) {
  const editor = document.querySelector('.chat-editor');
  if (!editor) return;

  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;

  const range = sel.getRangeAt(0);

  // 如果有选区，让浏览器默认处理
  if (!range.collapsed) return;

  let node = range.startContainer;
  let offset = range.startOffset;

  // 情况1：光标在文本节点中
  if (node.nodeType === Node.TEXT_NODE) {
    // 如果光标在文本开头，检查前面的节点
    if (offset === 0) {
      const prevNode = node.previousSibling;
      if (prevNode && prevNode.classList && prevNode.classList.contains('chat-pill')) {
        event.preventDefault();
        // 删除 pill
        prevNode.remove();
        // 如果后面的文本是 &nbsp;，也删除
        if (node.textContent === '\u00a0') {
          node.remove();
        }
        setTimeout(() => syncPillDeletions(), 10);
        return;
      }
    }
    // 如果光标在 &nbsp; 的位置（offset=1 且文本是 &nbsp;）
    else if (offset === 1 && node.textContent === '\u00a0') {
      const prevNode = node.previousSibling;
      if (prevNode && prevNode.classList && prevNode.classList.contains('chat-pill')) {
        event.preventDefault();
        prevNode.remove();
        node.remove();
        setTimeout(() => syncPillDeletions(), 10);
        return;
      }
    }
  }
  // 情况2：光标在元素节点中（比如编辑器本身）
  else if (node.nodeType === Node.ELEMENT_NODE) {
    // 获取光标位置的子节点
    const childNodes = node.childNodes;
    if (offset > 0 && offset <= childNodes.length) {
      const prevNode = childNodes[offset - 1];
      if (prevNode && prevNode.classList && prevNode.classList.contains('chat-pill')) {
        event.preventDefault();
        // 检查 pill 后面是否有 &nbsp;
        const nextNode = prevNode.nextSibling;
        if (nextNode && nextNode.nodeType === Node.TEXT_NODE && nextNode.textContent === '\u00a0') {
          nextNode.remove();
        }
        prevNode.remove();
        setTimeout(() => syncPillDeletions(), 10);
        return;
      }
    }
  }

  // 延迟同步，等待浏览器默认删除行为完成
  setTimeout(() => syncPillDeletions(), 50);
}

function handleEditorInput() {
  if (_pillSyncLock > 0) return;
  syncPillDeletions();
  updateChatTextFromEditor();
}

// 核心：检测 DOM 中被删掉的 pill → 同步到 selectedDetectedElements
function syncPillDeletions() {
  const editor = document.querySelector('.chat-editor');
  if (!editor) return;
  const pills = editor.querySelectorAll('.chat-pill');
  const existingKeys = new Set();
  pills.forEach((pill) => {
    const elId = pill.dataset.elId;
    const layerId = pill.dataset.elLayer;
    if (elId && layerId) existingKeys.add(`${layerId}::${elId}`);
  });

  const current = new Set(selectedDetectedElements.value);
  let changed = false;
  for (const key of current) {
    if (!existingKeys.has(key)) {
      current.delete(key);
      const newPositions = { ...elementClickPositions.value };
      delete newPositions[key];
      elementClickPositions.value = newPositions;
      changed = true;
    }
  }
  if (changed) {
    chatSkipPillSync.value = true;
    selectedDetectedElements.value = current;
  }

  // 编辑器完全为空时，重置光标到最前端
  if (!pills.length && (!editor.textContent || editor.textContent === '\n' || !editor.textContent.trim())) {
    requestAnimationFrame(() => {
      if (!editor.isConnected) return;
      const sel = window.getSelection();
      if (!sel) return;
      sel.removeAllRanges();
      const range = document.createRange();
      range.setStart(editor, 0);
      range.collapse(true);
      sel.addRange(range);
    });
  }
}

function handleEditorPillClick(event) {
  const pill = event.target.closest('.chat-pill');
  if (!pill) return;
  // 点击 ▼ 切换重叠元素
  if (event.target.closest('[data-action="pick-overlap"]')) {
    event.preventDefault();
    event.stopPropagation();
    const elId = pill.dataset.elId;
    const elLayer = pill.dataset.elLayer;
    const key = `${elLayer}::${elId}`;
    const candidates = elementOverlapCandidates.value[key] || [];
    console.log('[overlap-dropdown] pill clicked, key=', key, 'candidates=', candidates.length, 'allKeys=', Object.keys(elementOverlapCandidates.value));
    if (candidates.length <= 1) {
      console.log('[overlap-dropdown] 该元素没有重叠候选，候选人数据为空或只有1个');
      return;
    }
    // 定位弹窗：上拉框，底部贴近 pill 顶部
    const rect = pill.getBoundingClientRect();
    overlapDropdown.visible = true;
    overlapDropdown.x = rect.left;
    overlapDropdown.y = rect.top - 4; // popup 的 top + translateY(-100%) = 底部对齐 pill 顶部
    overlapDropdown.pillKey = key;
    overlapDropdown.candidates = candidates;
    console.log('[overlap-dropdown] 弹窗已显示, x=', overlapDropdown.x, 'y=', overlapDropdown.y);
    return;
  }
}

// 关闭重叠元素下拉弹窗
function closeOverlapDropdown() {
  overlapDropdown.visible = false;
}

// 从下拉弹窗中选择一个元素替换当前 pill
function replacePillElement(newCandidate) {
  const oldKey = overlapDropdown.pillKey;
  if (!oldKey) return;
  const newKey = `${newCandidate.layerId}::${newCandidate.id}`;

  // 如果选的就是自己，关闭弹窗
  if (newKey === oldKey) {
    overlapDropdown.visible = false;
    return;
  }

  // 更新 selectedDetectedElements：删旧加新（保持顺序）
  const current = [...selectedDetectedElements.value];
  const idx = current.indexOf(oldKey);
  if (idx === -1) {
    overlapDropdown.visible = false;
    return;
  }
  // 如果新 key 已存在，不重复添加
  if (current.includes(newKey)) {
    current.splice(idx, 1);
  } else {
    current[idx] = newKey;
  }
  chatSkipPillSync.value = true;
  selectedDetectedElements.value = new Set(current);

  // 更新候选列表：旧 key 的候选转移到新 key
  const nextCandidates = { ...elementOverlapCandidates.value };
  const stored = nextCandidates[oldKey] || [];
  delete nextCandidates[oldKey];
  nextCandidates[newKey] = stored;
  elementOverlapCandidates.value = nextCandidates;

  // 更新 elementClickPositions：清除旧 key，新 key 不加（靠 getElementClickStyle 从框计算）
  const nextPositions = { ...elementClickPositions.value };
  delete nextPositions[oldKey];
  elementClickPositions.value = nextPositions;

  // 更新 DOM pill：替换 data 属性和显示文字
  const editor = document.querySelector('.chat-editor');
  if (editor) {
    const pills = editor.querySelectorAll('.chat-pill');
    for (const p of pills) {
      const pKey = `${p.dataset.elLayer}::${p.dataset.elId}`;
      if (pKey === oldKey) {
        p.dataset.elId = newCandidate.id;
        p.dataset.elName = newCandidate.name;
        p.dataset.elLayer = newCandidate.layerId;
        p.dataset.elBox = (newCandidate.box_2d || []).join(',');
        // 更新显示文字（保留编号和 ▼ 按钮）
        const numEl = p.querySelector('.chat-pill-num');
        const imgEl = p.querySelector('img');
        const emEl = p.querySelector('[data-action="pick-overlap"]');
        // 清空 pill 内容重建
        p.innerHTML = '';
        if (numEl) p.appendChild(numEl);
        if (imgEl) p.appendChild(imgEl);
        p.appendChild(document.createTextNode(newCandidate.name));
        if (emEl) p.appendChild(emEl);
        break;
      }
    }
  }

  overlapDropdown.visible = false;
  // 重置标志，允许后续操作正常同步
  nextTick(() => { chatSkipPillSync.value = false; });
}

// 手动框选：拖拽后弹出输入框让用户命名
function createManualElement() {
  const layerId = manualBoxDraft.layerId;
  if (!layerId) {
    console.warn('[manual] createManualElement: layerId 为空，跳过');
    return;
  }
  const layer = layers.value.find((l) => l.id === layerId);
  if (!layer) {
    console.warn('[manual] createManualElement: 找不到图层', layerId);
    return;
  }

  const minX = Math.min(manualBoxDraft.startX, manualBoxDraft.currentX);
  const maxX = Math.max(manualBoxDraft.startX, manualBoxDraft.currentX);
  const minY = Math.min(manualBoxDraft.startY, manualBoxDraft.currentY);
  const maxY = Math.max(manualBoxDraft.startY, manualBoxDraft.currentY);

  // 框太小视为误触，不创建
  if (maxX - minX < 8 || maxY - minY < 8) {
    console.log('[manual] createManualElement: 框太小，跳过', { w: maxX - minX, h: maxY - minY });
    return;
  }

  // 屏幕坐标 → 世界坐标：world = (screen - offset) / scale
  const vs = viewScale.value;
  const vo = viewOffset.value;
  const wLeft = (minX - vo.x) / vs;
  const wRight = (maxX - vo.x) / vs;
  const wTop = (minY - vo.y) / vs;
  const wBottom = (maxY - vo.y) / vs;

  // 图层相对归一化 0-1
  const top = (wTop - layer.y) / layer.height;
  const left = (wLeft - layer.x) / layer.width;
  const bottom = (wBottom - layer.y) / layer.height;
  const right = (wRight - layer.x) / layer.width;
  const box_2d = [top, left, bottom, right].map((v) => Math.max(0, Math.min(1, v)));

  // 弹出命名输入框（屏幕坐标，置于框上方）
  manualNameInput.visible = true;
  manualNameInput.layerId = layerId;
  manualNameInput.box_2d = box_2d;
  manualNameInput.text = '';
  manualNameInput.x = minX;
  manualNameInput.y = Math.max(4, minY - 36); // 框上方 36px，不超出画布顶部
  // 自动聚焦
  nextTick(() => {
    const input = document.querySelector('.manual-name-input input');
    if (input) input.focus();
  });
}

// 确认手动元素命名并添加到检测列表
function confirmManualElementName() {
  // 防重复触发（Enter + blur + 按钮 click 组合）
  if (!manualNameInput.visible) return;
  clearTimeout(_manualBlurTimer);
  const userInput = manualNameInput.text.trim();
  const displayName = userInput ? `手标-${userInput}` : `手标-${Date.now()}`;
  const layerId = manualNameInput.layerId;
  const box_2d = manualNameInput.box_2d;
  if (!layerId || !box_2d) {
    console.warn('[manual] confirmManualElementName: layerId 或 box_2d 为空，跳过', { layerId, box_2d });
    manualNameInput.visible = false;
    manualNameInput.text = '';
    manualBoxDraft.active = false;
    return;
  }

  const el = {
    id: `manual-${Date.now()}`,
    name: displayName,
    object_name: displayName,
    box_2d,
    box2d: box_2d,
    manual: true,
  };
  layerDetectedElements.value = {
    ...layerDetectedElements.value,
    [layerId]: [...(layerDetectedElements.value[layerId] || []), el],
  };
  // 同步选中并更新输入框 pill
  const elKey = `${layerId}::${el.object_name || el.name || el.id}`;
  selectedDetectedElements.value = new Set([...selectedDetectedElements.value, elKey]);
  console.log('[manual] 手动添加元素:', displayName, box_2d);
  // 持久化到文档（支持撤销恢复）
  canvas.updateDocument(props.id, (draft) => {
    draft.payload.detectedElements = JSON.parse(JSON.stringify(layerDetectedElements.value));
    return draft;
  });
  manualNameInput.visible = false;
  manualNameInput.text = '';
  manualBoxDraft.active = false;
}

// 取消手动元素命名
function cancelManualElementName() {
  manualNameInput.visible = false;
  manualNameInput.text = '';
  manualBoxDraft.active = false;
}

// 输入框失焦时自动确认（延迟判断，避免与按钮点击冲突）
let _manualBlurTimer = 0;
function onManualNameInputBlur() {
  clearTimeout(_manualBlurTimer);
  _manualBlurTimer = setTimeout(() => {
    if (manualNameInput.visible) {
      confirmManualElementName();
    }
  }, 150);
}

function clearAllAnnotations() {
  selectedDetectedElements.value = new Set();
  elementClickPositions.value = {};
}

function startResize(event, layer, point) {
  if (!userStore.requireLogin()) return;
  pushUndo();
  event.stopPropagation();
  event.preventDefault();
  event.currentTarget.setPointerCapture(event.pointerId);
  selectedLayerId.value = layer.id;
  selectedLayerIds.value = [layer.id];
  resizeState.value = { pointerId: event.pointerId, id: layer.id, point, startX: event.clientX, startY: event.clientY, x: layer.x, y: layer.y, width: layer.width, height: layer.height };
}

function resizeLayer(event) {
  if (!resizeState.value) return;
  const scale = doc.value.payload.view.scale || 1;
  const dx = (event.clientX - resizeState.value.startX) / scale;
  const ratio = resizeState.value.height / resizeState.value.width;
  let width = Math.max(60, resizeState.value.width + (resizeState.value.point.includes('left') ? -dx : dx));
  let height = Math.round(width * ratio);
  let x = resizeState.value.point.includes('left') ? resizeState.value.x + resizeState.value.width - width : resizeState.value.x;
  let y = resizeState.value.point.includes('top') ? resizeState.value.y + resizeState.value.height - height : resizeState.value.y;
  updateLayer(resizeState.value.id, { x: Math.round(x), y: Math.round(y), width: Math.round(width), height });
}

function stopResize(event) {
  if (!resizeState.value) return;
  if (event.currentTarget.hasPointerCapture(resizeState.value.pointerId)) event.currentTarget.releasePointerCapture(resizeState.value.pointerId);
  resizeState.value = null;
}

function getSelectedDetectedElements() {
  return [...selectedDetectedElements.value].map((key) => {
    const [layerId, elId] = key.split('::');
    const elements = layerDetectedElements.value[layerId] || [];
    const el = elements.find((e) => (e.object_name || e.name || e.id) === elId);
    return el ? { ...el, layerId, id: el.object_name || el.name || el.id, name: el.object_name || el.name || '' } : null;
  }).filter(Boolean);
}

// 构建元素定位提示：每个元素一行，含检测框坐标
function buildElementLocationHint() {
  const selected = getSelectedDetectedElements();
  if (!selected.length) return '';
  const lines = [];
  for (let i = 0; i < selected.length; i++) {
    const el = selected[i];
    const layer = layers.value.find((l) => l.id === el.layerId);
    if (!layer) continue;
    const box = normalizeBoxVal(el.box_2d || el.box2d || [0, 0, 1, 1]);
    // 转换为像素坐标
    const pxLeft = Math.round(box[1] * layer.width);
    const pxTop = Math.round(box[0] * layer.height);
    const pxRight = Math.round(box[3] * layer.width);
    const pxBottom = Math.round(box[2] * layer.height);
    const width = pxRight - pxLeft;
    const height = pxBottom - pxTop;

    // 计算相对位置（百分比，保留1位小数）
    const relLeft = (box[1] * 100).toFixed(1);
    const relTop = (box[0] * 100).toFixed(1);
    const relRight = (box[3] * 100).toFixed(1);
    const relBottom = (box[2] * 100).toFixed(1);

    lines.push({
      name: el.name || '元素',
      box: `[${pxLeft},${pxTop},${pxRight},${pxBottom}]`,
      relBox: `[${relLeft}%,${relTop}%,${relRight}%,${relBottom}%]`,
      size: `${width}×${height}`,
    });
  }
  return lines;
}

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function buildElementPill(el, order) {
  const thumb = layers.value.find((l) => l.id === el.layerId)?.thumbnailUrl || '';
  const eId = el.object_name || el.name || el.id;
  return `<span class="chat-pill" contenteditable="false" data-el-id="${escHtml(eId)}" data-el-name="${escHtml(el.object_name || el.name || '')}" data-el-layer="${escHtml(el.layerId)}" data-el-box="${(el.box_2d || []).join(',')}"><span class="chat-pill-num">${order}</span><img src="${thumb}" alt="" />${escHtml(el.object_name || el.name || '')}<em title="切换重叠元素" data-action="pick-overlap">&#x25BC;</em></span>&nbsp;`;
}

let _pillSyncLock = 0;
function syncPillsToEditor() {
  const editor = document.querySelector('.chat-editor');
  if (!editor) return;
  _pillSyncLock++;
  const lockId = _pillSyncLock;

  // 读取编辑器中已有的 pill
  const existingPills = Array.from(editor.querySelectorAll('.chat-pill'));
  const existingKeys = new Set();
  const pillNodeByKey = {};
  existingPills.forEach((pill) => {
    const key = `${pill.dataset.elLayer}::${pill.dataset.elId}`;
    existingKeys.add(key);
    pillNodeByKey[key] = pill;
  });

  const selectedSet = new Set([...selectedDetectedElements.value]);

  // 1) 删除已取消选中的 pill（连同后面的 nbsp 空格）
  for (const key of existingKeys) {
    if (!selectedSet.has(key)) {
      const pill = pillNodeByKey[key];
      const next = pill.nextSibling;
      if (next && next.nodeType === Node.TEXT_NODE && next.textContent === '\u00a0') {
        next.remove();
      }
      pill.remove();
    }
  }

  // 2) 追加新增的 pill 到编辑器末尾（不触碰已有文字）
  const detected = getSelectedDetectedElements();
  let anyAdded = false;
  for (const el of detected) {
    const key = `${el.layerId}::${el.object_name || el.name || el.id}`;
    if (!existingKeys.has(key)) {
      const html = buildElementPill(el, 0) + '\u00a0';
      editor.insertAdjacentHTML('beforeend', html);
      anyAdded = true;
    }
  }

  // 3) 按顺序重编号所有 pill
  const finalPills = editor.querySelectorAll('.chat-pill');
  finalPills.forEach((pill, i) => {
    const num = pill.querySelector('.chat-pill-num');
    if (num) num.textContent = String(i + 1);
  });

  // 4) 同步 chatText（用于空判断）
  updateChatTextFromEditor();

  // 5) 有新增 pill 时，光标定到编辑器末尾（pill 后面，方便继续输入文字）
  if (anyAdded) {
    requestAnimationFrame(() => {
      if (_pillSyncLock !== lockId || !editor.isConnected) return;
      const sel = window.getSelection();
      if (!sel) return;
      sel.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      sel.addRange(range);
    });
  }

  // 6) 释放锁
  setTimeout(() => { if (_pillSyncLock === lockId) _pillSyncLock = 0; }, 30);
}

watch(selectedDetectedElements, () => {
  if (chatSkipPillSync.value) return;
  const detected = getSelectedDetectedElements();
  const addedLayers = new Set();
  for (const d of detected) {
    const layer = layers.value.find((l) => l.id === d.layerId);
    if (layer?.url && !addedLayers.has(layer.id)) {
      addedLayers.add(layer.id);
      addReversePromptReference(layer.url, layer.id);
    }
  }
  nextTick(() => syncPillsToEditor());
}, { deep: true });

// 元素序号位置：跟随点击位置，缩放时正确更新
function getElementClickStyle(key) {
  const pos = elementClickPositions.value[key];
  const [layerId, elId] = key.split('::');
  const elements = layerDetectedElements.value[layerId] || [];
  const el = elements.find((e) => (e.object_name || e.name || e.id) === elId);
  if (!el) return {};
  const layer = layers.value.find((l) => l.id === layerId);
  if (!layer) return {};
  const box = normalizeBoxVal(el.box_2d || el.box2d || [0, 0, 1, 1]);
  const vs = viewScale.value;
  const vo = viewOffset.value;
  
  // 如果有归一化的点击位置，使用它
  if (pos && pos.relX !== undefined && pos.relY !== undefined) {
    const boxLeft = (layer.x + box[1] * layer.width) * vs + vo.x;
    const boxTop = (layer.y + box[0] * layer.height) * vs + vo.y;
    const boxWidth = (box[3] - box[1]) * layer.width * vs;
    const boxHeight = (box[2] - box[0]) * layer.height * vs;
    
    return {
      left: `${boxLeft + pos.relX * boxWidth}px`,
      top: `${boxTop + pos.relY * boxHeight}px`,
    };
  }
  
  // 否则使用元素框中心点
  const centerX = box[1] + (box[3] - box[1]) / 2;
  const centerY = box[0] + (box[2] - box[0]) / 2;
  return {
    left: `${(layer.x + centerX * layer.width) * vs + vo.x}px`,
    top: `${(layer.y + centerY * layer.height) * vs + vo.y}px`,
  };
}

async function sendChat() {
  const text = getEditorPrompt();
  const elementHint = buildElementLocationHint();
  // 优化后的提示词格式 - 坐标清晰明确
  let fullPrompt;
  if (elementHint && elementHint.length > 0) {
    const selected = getSelectedDetectedElements();

    // 构建元素描述列表
    const elementList = elementHint.map((el, i) => {
      return `${i + 1}. 【${el.name}】坐标：${el.box}（相对位置：${el.relBox}）`;
    }).join('\n');

    // 构建坐标区域描述
    const regionDesc = elementHint.map((el, i) => {
      return `区域${i + 1}（${el.name}）：像素坐标 ${el.box}`;
    }).join('；');

    fullPrompt = `【图像编辑指令】

原图尺寸：${elementHint[0] ? '已提供' : '未知'}

【待修改元素坐标】
${elementList}

【修改要求】
${text || '请根据元素类型进行适当修改'}

【执行说明】
请根据以上坐标信息，精确修改原图中对应区域的元素。
坐标格式为 [左上角X, 左上角Y, 右下角X, 右下角Y]，单位为像素。
修改时请保持其他区域完全不变，只修改指定坐标范围内的内容。`;
  } else {
    fullPrompt = text;
  }
  const hasContent = text || getSelectedDetectedElements().length;
  if (!hasContent || chatGenerating.value) return;
  if (!userStore.requireLogin()) return;

  const createdAt = Date.now();
  const assistantId = `msg-${createdAt}-assistant`;
  const chatImageUrls = chatReferenceImages.value
    .filter((image) => !image.uploading && !image.error)
    .map((image) => image.url)
    .filter((url) => url && !String(url).startsWith('blob:'));
  // 从当前选中元素计算参考图（只看当前选中，不看历史累积）
  const selectedRefLayers = new Set();
  for (const d of getSelectedDetectedElements()) {
    const layer = layers.value.find((l) => l.id === d.layerId);
    if (layer?.url && !String(layer.url).startsWith('blob:')) {
      selectedRefLayers.add(layer.url);
    }
  }
  const refImageUrls = [...selectedRefLayers];
  const imageUrls = [...new Set([...chatImageUrls, ...refImageUrls])];

  // 收集当前选中元素的详细信息（用于对话气泡渲染）
  const messageElements = getSelectedDetectedElements().map((el, idx) => {
    const layer = layers.value.find((l) => l.id === el.layerId);
    return {
      id: el.object_name || el.name || el.id,
      name: el.object_name || el.name || '',
      layerId: el.layerId,
      thumb: layer?.thumbnailUrl || '',
      order: idx + 1,
    };
  });

  addChatMessages([
    { id: `msg-${createdAt}`, role: 'user', text, targetLayerId: selectedLayerId.value, createdAt, elements: messageElements },
    {
      id: assistantId,
      role: 'assistant',
      text: '已提交对话生图任务，请等待生成结果（生成完成后会显示在画布中）。',
      createdAt: createdAt + 1,
    },
  ]);
  // 清空编辑器（pill + 文字）
  const editorEl = document.querySelector('.chat-editor');
  if (editorEl) editorEl.innerHTML = '';
  chatText.value = '';
  selectedDetectedElements.value = new Set();
  elementClickPositions.value = {};
  chatGenerating.value = true;
  const placeholderId = addGeneratingPlaceholderLayer(fullPrompt);

  try {
    const taskId = await submitImageTask({ prompt: fullPrompt, imageUrls });
    updateChatMessage(assistantId, { taskId, text: `任务已提交，模型 ${chatModel.value}｜${chatRatio.value}｜${chatResolution.value}，正在生成...` });
    updateGeneratingPlaceholder(placeholderId, { taskId, progress: 8, status: 'processing' });

    for (let index = 0; index < TASK_MAX_POLLS; index += 1) {
      await wait(TASK_POLL_INTERVAL);
      // 组件已卸载，停止轮询（避免内存泄漏和野指针错误）
      if (!_mounted.value) return;
      const status = await fetchImageTask(taskId);
      const progress = normalizeProgress(status.progress, Math.min(96, 10 + (index + 1) * 7));
      const progressText = Number.isFinite(Number(status.progress)) ? ` ${progress}%` : '';
      updateGeneratingPlaceholder(placeholderId, { progress, status: status.status || 'processing' });
      if (!isTaskDone(status.status)) {
        updateChatMessage(assistantId, { text: `正在生成${progressText}，任务状态：${status.status || 'processing'}` });
      }

      if (isTaskFailed(status.status)) {
        throw new Error(status.error || 'APIMart 生图任务失败');
      }

      if (isTaskDone(status.status)) {
        const url = extractTaskImageUrl(status);
        if (!url) throw new Error('任务完成，但没有返回图片地址');
        updateGeneratingPlaceholder(placeholderId, { progress: 100, status: 'completed', statusText: '生成完成，正在渲染到画布...' });
        await replaceGeneratingPlaceholder(placeholderId, url);
        updateChatMessage(assistantId, { text: '生成完成，已添加到画布。', imageUrl: url });
        generationHistory.value.push({
          id: `gen-${Date.now()}`,
          prompt: fullPrompt,
          model: chatModel.value,
          ratio: chatRatio.value,
          resolution: chatResolution.value,
          imageUrl: url,
          referenceImageUrls: imageUrls,
          createdAt: Date.now(),
        });
        if (generationHistory.value.length > 50) generationHistory.value.shift();
        return;
      }
    }

    throw new Error('轮询超时，任务仍未完成');
  } catch (error) {
    updateGeneratingPlaceholder(placeholderId, { progress: 1, status: 'failed', statusText: `生成失败：${error.message || error}` });
    updateChatMessage(assistantId, { text: `生成失败：${error.message || error}` });
  } finally {
    chatGenerating.value = false;
  }
}

function handleChatBoxClick(event) {
  if (!event.target.closest?.('.uc-upload-tile') || event.target.closest('footer')) return;
  openImageUpload('chat');
}

function selectCanvasTool(tool) {
  if (!userStore.requireLogin()) return;
  // text/shape 工具点击后直接执行添加节点，而非切换工具
  if (tool.key === 'text') { addTextNode(); return; }
  if (tool.key === 'shape') { return; }
  activeTool.value = tool.key;
}

function startToolbarDrag(event) {
  if (event.button !== 0) return;
  const toolbarNode = event.currentTarget.closest('.bottom-tools');
  const parentNode = event.currentTarget.closest('.editor-body');
  const rect = toolbarNode.getBoundingClientRect();
  const parentRect = parentNode.getBoundingClientRect();
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
  };
  toolbar.x = Math.round(rect.left - parentRect.left);
  toolbar.y = Math.round(rect.top - parentRect.top);
  event.currentTarget.setPointerCapture(event.pointerId);
}

function moveToolbar(event) {
  if (!toolbar.dragging) return;
  toolbar.x = Math.round(Math.max(0, Math.min(toolbar.dragging.parentWidth - toolbar.dragging.width, event.clientX - toolbar.dragging.parentLeft - toolbar.dragging.offsetX)));
  toolbar.y = Math.round(Math.max(0, Math.min(toolbar.dragging.parentHeight - toolbar.dragging.height, event.clientY - toolbar.dragging.parentTop - toolbar.dragging.offsetY)));
}

function stopToolbarDrag(event) {
  if (!toolbar.dragging) return;
  if (event.currentTarget.hasPointerCapture(toolbar.dragging.pointerId)) event.currentTarget.releasePointerCapture(toolbar.dragging.pointerId);
  toolbar.dragging = null;
}

function startPanelDrag(event) {
  if (event.button !== 0) return;
  const panelNode = event.currentTarget.closest('.right-panel');
  const parentNode = event.currentTarget.closest('.editor-body');
  const rect = panelNode.getBoundingClientRect();
  const parentRect = parentNode.getBoundingClientRect();
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
  };
  panel.x = Math.round(rect.left - parentRect.left);
  panel.y = Math.round(rect.top - parentRect.top);
  event.currentTarget.setPointerCapture(event.pointerId);
}

function movePanel(event) {
  if (!panel.dragging) return;
  const nextX = event.clientX - panel.dragging.parentLeft - panel.dragging.offsetX;
  const nextY = event.clientY - panel.dragging.parentTop - panel.dragging.offsetY;
  panel.x = Math.round(Math.max(0, Math.min(panel.dragging.parentWidth - panel.dragging.panelWidth, nextX)));
  panel.y = Math.round(Math.max(0, Math.min(panel.dragging.parentHeight - panel.dragging.panelHeight, nextY)));
}

function stopPanel(event) {
  if (!panel.dragging) return;
  if (event.currentTarget.hasPointerCapture(panel.dragging.pointerId)) event.currentTarget.releasePointerCapture(panel.dragging.pointerId);
  panel.dragging = null;
}

function startPanelResize(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const rect = event.currentTarget.closest('.right-panel').getBoundingClientRect();
  panel.resizing = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startLeft: rect.left,
    startWidth: rect.width,
  };
  event.currentTarget.setPointerCapture(event.pointerId);
}

function resizePanel(event) {
  if (!panel.resizing) return;
  const nextWidth = Math.max(280, Math.min(560, panel.resizing.startWidth + panel.resizing.startX - event.clientX));
  panel.width = Math.round(nextWidth);
  if (panel.x !== null) {
    panel.x = Math.round(panel.resizing.startLeft + panel.resizing.startWidth - panel.width);
  }
}

function stopPanelResize(event) {
  if (!panel.resizing) return;
  if (event.currentTarget.hasPointerCapture(panel.resizing.pointerId)) event.currentTarget.releasePointerCapture(panel.resizing.pointerId);
  panel.resizing = null;
}

function startChatResize(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const rect = event.currentTarget.closest('.right-panel').getBoundingClientRect();
  const minHeight = 230;
  const maxHeight = Math.max(minHeight, Math.round(rect.height * (2 / 3)) - 24);
  panel.resizingChat = {
    pointerId: event.pointerId,
    startY: event.clientY,
    startHeight: panel.chatHeight,
    minHeight,
    maxHeight,
  };
  event.currentTarget.setPointerCapture(event.pointerId);
}

function resizeChatBox(event) {
  if (!panel.resizingChat) return;
  const nextHeight = panel.resizingChat.startHeight + panel.resizingChat.startY - event.clientY;
  panel.chatHeight = Math.max(panel.resizingChat.minHeight, Math.min(panel.resizingChat.maxHeight, Math.round(nextHeight)));
}

function stopChatResize(event) {
  if (!panel.resizingChat) return;
  if (event.currentTarget.hasPointerCapture(panel.resizingChat.pointerId)) event.currentTarget.releasePointerCapture(panel.resizingChat.pointerId);
  panel.resizingChat = null;
}

function startRPCardDrag(e) { if (e.button !== 0) return; const node = e.currentTarget.closest('.reverse-prompt-mini-card'); const parentNode = e.currentTarget.closest('.editor-body'); const rect = node.getBoundingClientRect(); const parentRect = parentNode.getBoundingClientRect(); reversePromptCard.dragging = { pointerId: e.pointerId, offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top, parentLeft: parentRect.left, parentTop: parentRect.top, parentWidth: parentRect.width, parentHeight: parentRect.height, cardWidth: rect.width, cardHeight: rect.height }; reversePromptCard.x = Math.round(rect.left - parentRect.left); reversePromptCard.y = Math.round(rect.top - parentRect.top); e.currentTarget.setPointerCapture(e.pointerId); }
function moveRPCard(e) { if (!reversePromptCard.dragging) return; const nx = e.clientX - reversePromptCard.dragging.parentLeft - reversePromptCard.dragging.offsetX; const ny = e.clientY - reversePromptCard.dragging.parentTop - reversePromptCard.dragging.offsetY; reversePromptCard.x = Math.round(Math.max(0, Math.min(reversePromptCard.dragging.parentWidth - reversePromptCard.dragging.cardWidth, nx))); reversePromptCard.y = Math.round(Math.max(0, Math.min(reversePromptCard.dragging.parentHeight - reversePromptCard.dragging.cardHeight, ny))); }
function stopRPCard(e) { if (!reversePromptCard.dragging) return; e.currentTarget.releasePointerCapture(reversePromptCard.dragging.pointerId); reversePromptCard.dragging = null; }

function zoom(delta, center = null) {
  if (center && center.fit) { fitCanvasView(); return; }
  canvas.updateDocument(props.id, (draft) => {
    const oldScale = draft.payload.view.scale || 1;
    const nextScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number((oldScale + delta).toFixed(2))));
    const offset = draft.payload.view.offset || { x: 0, y: 0 };
    draft.payload.view.scale = nextScale;
    if (center) {
      const worldX = (center.x - offset.x) / oldScale;
      const worldY = (center.y - offset.y) / oldScale;
      draft.payload.view.offset = { x: Math.round(center.x - worldX * nextScale), y: Math.round(center.y - worldY * nextScale) };
    }
    return draft;
  });
}
function fitCanvasView() {
  canvas.updateDocument(props.id, (draft) => {
    const layersList = draft.payload.layers || [];
    if (!layersList.length) { draft.payload.view.scale = 1; draft.payload.view.offset = { x: 0, y: 0 }; return draft; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const l of layersList) { if (l.x < minX) minX = l.x; if (l.y < minY) minY = l.y; if (l.x + (l.width || 1) > maxX) maxX = l.x + (l.width || 1); if (l.y + (l.height || 1) > maxY) maxY = l.y + (l.height || 1); }
    const w = maxX - minX + 120, h = maxY - minY + 120;
    const fitScale = Math.min(viewportSize.width / w, viewportSize.height / h, 2);
    draft.payload.view.scale = Math.round(fitScale * 1000) / 1000;
    draft.payload.view.offset = { x: Math.round((viewportSize.width - w * draft.payload.view.scale) / 2 - minX * draft.payload.view.scale), y: Math.round((viewportSize.height - h * draft.payload.view.scale) / 2 - minY * draft.payload.view.scale) };
    return draft;
  });
}

function wheelZoom(event) {
  event.preventDefault();
  const rect = event.currentTarget.getBoundingClientRect();
  const delta = event.deltaY > 0 ? -0.05 : 0.05;
  zoom(delta, {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  });
  nextTick(() => refreshConnections());
}

function startMarquee(event) {
  if (event.button !== 0) return;

  // 点击空白区域取消连接线选中
  if (!event.target.closest('.connection-group') && !event.target.closest('.connection-delete-btn')) {
    deselectConnection();
  }

  // Ctrl+点击元素框 → 选中/取消选中元素
  if ((event.ctrlKey || event.metaKey) && activeTool.value !== 'annotate') {
    if (event.target.closest('.detected-element-box')) {
      handleDetectedOverlayClick(event);
      return;
    }
  }

  // 标注模式 或 Ctrl+拖拽：手动画框添加元素
  const isAnnotate = activeTool.value === 'annotate';
  const isCtrlDraw = (event.ctrlKey || event.metaKey) && activeTool.value !== 'annotate' && activeTool.value !== 'hand';
  if (isAnnotate || isCtrlDraw) {
    if (event.target.closest?.('.detected-element-box, .detected-element-label, .manual-name-input, .layer-toolbar, .bottom-tools, .top-tools, .right-panel, .annotate-banner')) return;
    // 如果命名框正在显示，先确认当前元素再开始新框选
    if (manualNameInput.visible) {
      confirmManualElementName();
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    manualBoxDraft.active = true;
    manualBoxDraft.startX = event.clientX - rect.left;
    manualBoxDraft.startY = event.clientY - rect.top;
    manualBoxDraft.currentX = manualBoxDraft.startX;
    manualBoxDraft.currentY = manualBoxDraft.startY;
    // 找到框下面的图层
    const picked = [...event.currentTarget.querySelectorAll('.canvas-layer')].filter((node) => {
      const r = node.getBoundingClientRect();
      return r.left < event.clientX && r.right > event.clientX && r.top < event.clientY && r.bottom > event.clientY;
    }).map((node) => node.dataset.layerId);
    manualBoxDraft.layerId = picked[0] || selectedLayerId.value || layers.value[0]?.id || '';
    return;
  }

  // 手形工具：拖动画布
  if (activeTool.value === 'hand') {
    if (event.target.closest?.('.layer-toolbar, .resize-dot, .bottom-tools, .top-tools, .right-panel')) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const offset = doc.value.payload.view.offset || { x: 0, y: 0 };
    panState.value = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: offset.x,
      y: offset.y,
    };
    return;
  }

  if (event.target !== event.currentTarget) return;
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.setPointerCapture(event.pointerId);
  marquee.active = true;
  marquee.startX = event.clientX - rect.left;
  marquee.startY = event.clientY - rect.top;
  marquee.currentX = marquee.startX;
  marquee.currentY = marquee.startY;
  selectedLayerId.value = '';
  selectedLayerIds.value = [];
}

function moveMarquee(event) {
  if (panState.value) {
    const dx = event.clientX - panState.value.startX;
    const dy = event.clientY - panState.value.startY;
    canvas.updateDocument(props.id, (draft) => {
      draft.payload.view.offset = {
        x: Math.round(panState.value.x + dx),
        y: Math.round(panState.value.y + dy),
      };
      return draft;
    });
    return;
  }

  if (manualBoxDraft.active) {
    const rect = event.currentTarget.getBoundingClientRect();
    manualBoxDraft.currentX = event.clientX - rect.left;
    manualBoxDraft.currentY = event.clientY - rect.top;
    return;
  }

  if (!marquee.active) return;
  const rect = event.currentTarget.getBoundingClientRect();
  marquee.currentX = event.clientX - rect.left;
  marquee.currentY = event.clientY - rect.top;
}

function stopMarquee(event) {
  if (panState.value) {
    if (event.currentTarget.hasPointerCapture(panState.value.pointerId)) event.currentTarget.releasePointerCapture(panState.value.pointerId);
    panState.value = null;
    return;
  }

  if (manualBoxDraft.active) {
    if (event.currentTarget.hasPointerCapture) event.currentTarget.releasePointerCapture(event.pointerId);
    createManualElement();
    manualBoxDraft.active = false;
    return;
  }

  if (!marquee.active) return;
  const stageRect = event.currentTarget.getBoundingClientRect();
  const box = {
    left: stageRect.left + Math.min(marquee.startX, marquee.currentX),
    top: stageRect.top + Math.min(marquee.startY, marquee.currentY),
    right: stageRect.left + Math.max(marquee.startX, marquee.currentX),
    bottom: stageRect.top + Math.max(marquee.startY, marquee.currentY),
  };
  const picked = [...event.currentTarget.querySelectorAll('.canvas-layer')].filter((node) => {
    const rect = node.getBoundingClientRect();
    return rect.left < box.right && rect.right > box.left && rect.top < box.bottom && rect.bottom > box.top;
  }).map((node) => node.dataset.layerId);
  selectedLayerIds.value = picked;
  selectedLayerId.value = picked[picked.length - 1] || '';
  marquee.active = false;
}

nextTick(() => {
  if (!selectedLayerId.value) selectedLayerId.value = layers.value[0]?.id || '';
  if (selectedLayerId.value && !selectedLayerIds.value.length) selectedLayerIds.value = [selectedLayerId.value];
});

// 全局快捷键
function onGlobalKeydown(event) {
  const tag = String(event.target?.tagName || '').toLowerCase();
  const inInput = tag === 'input' || tag === 'textarea' || tag === 'select' || event.target?.isContentEditable;
  if (event.key === 'Escape') {
    if (helpMenuOpen.value) { helpMenuOpen.value = false; return; }
    if (shortcutsOpen.value) { shortcutsOpen.value = false; return; }
  }
  if (event.key === 'Delete') {
    if (inInput) return;
    // 优先删除选中的元素框（含手动元素）
    if (selectedDetectedElements.value.size > 0) {
      event.preventDefault();
      pushUndo(); // 删除元素框也入栈，支持撤销
      const nextLayers = { ...layerDetectedElements.value };
      for (const key of selectedDetectedElements.value) {
        const [layerId, elId] = key.split('::');
        if (nextLayers[layerId]) {
          nextLayers[layerId] = nextLayers[layerId].filter((e) => (e.object_name || e.name || e.id) !== elId);
          if (!nextLayers[layerId].length) delete nextLayers[layerId];
        }
      }
      layerDetectedElements.value = nextLayers;
      selectedDetectedElements.value = new Set();
      elementClickPositions.value = {};
      // 持久化到文档
      canvas.updateDocument(props.id, (draft) => {
        draft.payload.detectedElements = JSON.parse(JSON.stringify(layerDetectedElements.value));
        return draft;
      });
      return;
    }
    // 否则删除选中图层
    if (selectedLayerId.value && layers.value.length > 1) {
      event.preventDefault();
      removeLayer(selectedLayerId.value);
    }
  }
  if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
    if (inInput) return;
    event.preventDefault();
    const snapshot = undoStack.value.pop();
    if (snapshot && doc.value) {
      // 标记撤销恢复中，阻止 watch 触发自动检测
      _undoRestoring.value = true;
      // 兼容旧格式（纯数组）和新格式（含检测数据的对象）
      const layersData = Array.isArray(snapshot) ? snapshot : snapshot.layers;
      // 关键修复：先恢复 layerDetectedElements（如果快照里有），这样 layers watch 触发时新图层的检测数据已就位
      if (!Array.isArray(snapshot) && snapshot.detectedElements) {
        layerDetectedElements.value = snapshot.detectedElements;
        // 同步持久化到文档
        canvas.updateDocument(props.id, (draft) => {
          draft.payload.detectedElements = snapshot.detectedElements;
          return draft;
        });
      }
      if (!Array.isArray(snapshot) && snapshot.selectedDetectedElements) {
        selectedDetectedElements.value = new Set(snapshot.selectedDetectedElements);
      }
      // 然后才恢复 layers
      canvas.updateDocument(props.id, (draft) => { draft.payload.layers = layersData; return draft; });
      selectedLayerId.value = layersData[0]?.id || '';
      selectedLayerIds.value = selectedLayerId.value ? [selectedLayerId.value] : [];
      // 只删除已不存在的图层的检测数据
      const currentLayerIds = new Set(layersData.map(l => l.id));
      const nextDetected = { ...layerDetectedElements.value };
      let pruned = false;
      for (const lid of Object.keys(nextDetected)) {
        if (!currentLayerIds.has(lid)) {
          delete nextDetected[lid];
          pruned = true;
        }
      }
      if (pruned) layerDetectedElements.value = nextDetected;
      // 清除已不存在的图层的选中元素
      const nextSelected = new Set();
      for (const key of selectedDetectedElements.value) {
        const [lid] = key.split('::');
        if (currentLayerIds.has(lid)) nextSelected.add(key);
      }
      selectedDetectedElements.value = nextSelected;
      // 关键：先解除撤销标记，再等 watch 全部执行完毕
      // 用 setTimeout 而非 nextTick，确保 deep watch 全部触发完毕
      setTimeout(() => { _undoRestoring.value = false; }, 100);
    }
  }
  // 工具快捷键
  if (!inInput) {
    const keyMap = { v: 'select', h: 'hand', f: 'focus', m: 'annotate' };
    const tool = keyMap[event.key.toLowerCase()];
    if (tool) { event.preventDefault(); activeTool.value = tool; }
    // T 快捷键：直接添加文本节点
    if (event.key.toLowerCase() === 't') { event.preventDefault(); addTextNode(); }
    // I 快捷键：添加图片占位节点
    if (event.key.toLowerCase() === 'i') { event.preventDefault(); addImageNode(); }
  }
}

// Undo stack（同时保存图层和元素检测数据，撤销时一起恢复）
const undoStack = ref([]);
function pushUndo() {
  if (doc.value?.payload?.layers) {
    undoStack.value.push({
      layers: JSON.parse(JSON.stringify(doc.value.payload.layers)),
      detectedElements: JSON.parse(JSON.stringify(layerDetectedElements.value)),
      selectedDetectedElements: [...selectedDetectedElements.value],
    });
    if (undoStack.value.length > 50) undoStack.value.shift();
  }
}

// Ctrl state
const ctrlHeld = ref(false);

function addGenerationRecordToCanvas(record) {
  if (!record.imageUrl) return;
  addImageLayerFromUrl(record.imageUrl, '生图记录复用');
}

function useGenerationRecordAsReference(record) {
  if (!record.imageUrl) return;
  chatReferenceImages.value.push({
    id: `ref-${Date.now()}`,
    url: record.imageUrl,
    name: `记录 ${new Date(record.createdAt).toLocaleString()}`,
    uploading: false,
  });
  activeChatReferenceId.value = chatReferenceImages.value.at(-1)?.id || '';
}

function reuseGenerationRecordPrompt(record) {
  chatText.value = record.prompt || '';
}

function removeGenerationRecord(id) {
  generationHistory.value = generationHistory.value.filter((r) => r.id !== id);
}

onMounted(() => {
  _mounted.value = true;
  updateViewportSize();
  window.addEventListener('resize', updateViewportSize);
  window.addEventListener('keydown', onGlobalKeydown);
  loadUILayout();
  // 建立 pill 删除监听 — MutationObserver 比 @input 更可靠
  nextTick(() => setupPillObserver());
  // 恢复已缓存的检测元素（清除旧版错误归一化的缓存）
  const cachedElements = doc.value?.payload?.detectedElements;
  if (cachedElements) {
    let hasBadData = false;
    for (const els of Object.values(cachedElements)) {
      if (Array.isArray(els)) {
        for (const el of els) {
          const box = el.box_2d || el.box2d || [];
          // 检查是否有坏数据：值超出 0-1 范围，或者坐标不合理
          if (box.some(v => Math.abs(v) > 1.05) || box.length !== 4) { hasBadData = true; break; }
          // 检查坐标是否有效（top < bottom, left < right）
          if (box[0] >= box[2] || box[1] >= box[3]) { hasBadData = true; break; }
        }
      }
      if (hasBadData) break;
    }
    if (hasBadData) {
      // 旧版归一化 bug 导致的数据，清除缓存让用户重新检测
      console.log('[detect] 清除旧版缓存数据，需要重新检测');
      canvas.updateDocument(props.id, (draft) => {
        draft.payload.detectedElements = {};
        return draft;
      });
      layerDetectedElements.value = {};
    } else {
      // 对缓存数据进行归一化处理，确保坐标在 0-1 范围
      const normalized = {};
      for (const [layerId, els] of Object.entries(cachedElements)) {
        if (Array.isArray(els)) {
          normalized[layerId] = els.map(el => {
            const box = normalizeBoxVal(el.box_2d || el.box2d || [0, 0, 1, 1]);
            return { ...el, box_2d: box, box2d: box };
          });
        }
      }
      layerDetectedElements.value = normalized;
    }
  }
  // 聊天记录滚动到底部（最后一条消息）
  scrollChatToBottom();
  const onCtrlDown = (e) => { if (e.key === 'Control') ctrlHeld.value = true; };
  const onCtrlUp = (e) => { if (e.key === 'Control') ctrlHeld.value = false; };
  window.addEventListener('keydown', onCtrlDown);
  window.addEventListener('keyup', onCtrlUp);
  const onDocClick = () => { toolbarAddOpen.value = false; helpMenuOpen.value = false; };
  window.addEventListener('click', onDocClick);
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onCtrlDown);
    window.removeEventListener('keyup', onCtrlUp);
    window.removeEventListener('click', onDocClick);
    window.removeEventListener('resize', updateViewportSize);
    if (_pillObserver) { _pillObserver.disconnect(); _pillObserver = null; }
    window.removeEventListener('keydown', onGlobalKeydown);
    // 清理所有定时器
    clearTimeout(_manualBlurTimer);
    clearTimeout(_layoutSaveTimer);
  });
});

onBeforeUnmount(() => {
  _mounted.value = false;
  chatReferenceImages.value.forEach((image) => {
    if (image.localUrl?.startsWith('blob:')) URL.revokeObjectURL(image.localUrl);
  });
});

// 监听 layers 变化时同步元素检测数据到 layerDetectedElements
watch(
  () => doc.value?.payload?.layers,
  () => syncDetectionFromLayers(),
  { deep: true, immediate: true }
);
watch(() => doc.value?.payload?.layers?.length, () => syncDetectionFromLayers());

// ============ 主题切换（套餐 B 改造） ============
import { useTheme } from '../composables/useTheme';
const { theme: currentTheme, cycle: cycleTheme, isDark, isLight, isSystem } = useTheme();
function themeIcon() {
  if (isSystem()) return '🖥';
  if (isDark()) return '🌙';
  return '☀️';
}
function themeLabel() {
  if (isSystem()) return '跟随系统';
  if (isDark()) return '深色';
  return '浅色';
}
</script>

<template>
  <main class="editor">
    <header class="editor-head glass-header">
      <div class="head-left">
        <button class="logo logo-link" type="button" @click="router.push('/')">YOUMI</button><span>·</span><b>万能画布</b><span>/</span><button>✎ {{ doc.title }}</button><em>已保存 · 刚刚</em>
      </div>
      <div class="head-actions">
        <button class="theme-toggle" :title="`当前：${themeLabel()}（点击切换）`" @click="cycleTheme">
          <span class="theme-toggle__icon">{{ themeIcon() }}</span>
          <span>{{ themeLabel() }}</span>
        </button>
        <button class="panel-visibility-btn" :class="{ active: getDetectionVisible() }" :title="getDetectionVisible() ? '隐藏视觉框' : '显示视觉框'" @click="setDetectionVisible(!getDetectionVisible())">{{ getDetectionVisible() ? '👁' : '🚫' }}</button>
        <button class="panel-visibility-btn" :class="{ active: rightPanelVisible }" :title="rightPanelVisible ? '隐藏对话框' : '显示对话框'" @click="rightPanelVisible = !rightPanelVisible">▮</button><button @click="router.push('/canvas')">×</button>
      </div>
    </header>

    <section class="editor-body">
      <div class="top-tools">
        <button>✎ 编辑画布⌄</button>
        <button @click="router.push('/canvas')">▣ 我的画布列表</button>
        <div class="add-image">
          <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onFileChange" />
          <button :class="{ active: addOpen }" @click="toggleAddMenu">▧ 添加图片</button>
          <div v-if="addOpen" class="add-menu">
            <button @click="openImageUpload('canvas')">⇧ 本地上传</button>
            <button>▤ 从历史生成导入</button>
          </div>
        </div>
        <button :class="{ active: shortcutsOpen }" @click="shortcutsOpen = !shortcutsOpen; if (shortcutsOpen) addOpen = false">⌘ 快捷键</button>
      </div>

      <aside v-if="activeTool === 'annotate'" class="annotate-banner" @pointerdown.stop>
        <div class="annotate-banner-text">
          <strong>标记工具</strong>
          <span>拖拽画框 → 手动添加元素到输入框</span>
          <span>点击画布元素 → 选中加入输入框</span>
          <span>其他工具下 <kbd>Ctrl+点击</kbd> 也可选中元素</span>
        </div>
        <button type="button" class="annotate-banner-close" @pointerdown.stop @click="activeTool = 'select'">退出标记</button>
      </aside>

      <!-- 左侧 + 号分类菜单栏（已合并到 bottom-tools 的 uc-toolbar-add-btn 弹层） -->
      <div
        :class="['stage', { 'hand-tool': activeTool === 'hand', 'annotate-tool': activeTool === 'annotate', 'is-panning': panState, 'is-connecting': connecting.active }]"
        @wheel.prevent="wheelZoom"
        @pointerdown="startMarquee"
        @pointermove="moveMarquee; updateConnectionDrag($event)"
        @pointerup="stopMarquee; cancelConnection()"
        @pointercancel="stopMarquee; cancelConnection()"
      >
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
          <dl><dt>拖入图片</dt><dd>或 .yq 画布文件 即可添加到画布</dd><dt>空格</dt><dd>长按 + 左键拖动 即可平移画布</dd><dt>A</dt><dd>打开“添加图片”面板，从本地或生成历史导入</dd></dl>
        </div>

        <figure
          v-for="layer in layers"
          :key="layer.id"
          :data-layer-id="layer.id"
          :class="[
            'canvas-layer',
            {
              selected: selectedLayerIds.includes(layer.id),
              'multi-selected': selectedLayerIds.length > 1 && selectedLayerIds.includes(layer.id),
              'is-placeholder': layer.type === 'placeholder',
              'is-text': layer.type === 'text',
              'is-video': layer.type === 'video',
              'is-video-placeholder': layer.type === 'video' && !layer.url,
              'is-image': layer.type === 'image' || (layer.url && !layer.type),
              'is-image-placeholder': layer.type === 'image-placeholder',
              'is-failed': layer.status === 'failed',
            },
          ]"
          :style="{
            transform: `translate(${layer.x * viewScale + viewOffset.x}px, ${layer.y * viewScale + viewOffset.y}px) scale(${viewScale})`,
            width: `${layer.width}px`,
            height: (layer.type === 'placeholder' || layer.type === 'text' || layer.type === 'video' || layer.type === 'image-placeholder') ? `${layer.height}px` : undefined,
            zIndex: layer.zIndex,
            '--canvas-inverse-scale': 1 / viewScale,
          }"
          @pointerdown="startLayerDrag($event, layer)"
          @pointermove="moveLayer"
          @pointerup="stopLayerDrag"
          @pointercancel="stopLayerDrag"
          @dblclick="onLayerDblClick($event, layer)"
        >
          <div v-if="layer.type !== 'placeholder' && detectingLayerIds.has(layer.id)" class="layer-detecting-overlay">
            <span class="layer-detecting-spinner" />
            <span class="layer-detecting-text">AI 检测元素中...</span>
          </div>
          <template v-if="layer.type !== 'placeholder' && layer.type !== 'text' && layer.type !== 'image-placeholder' && !(layer.type === 'video' && !layer.url) && layer.id === selectedLayerId && selectedLayerIds.length <= 1">
            <div class="layer-toolbar">
              <button>✂ 智能抠图</button><button @click.stop="maybeAutoDetect(selectedLayer)"><template v-if="selectedLayer && detectingLayerIds.has(selectedLayer.id)">⏳ 检测中...</template><template v-else>◈ 智能分层</template></button><button>T 编辑文字</button><button>↔ 扩图</button><button>☏ 对话修改</button><button>▧ 尺寸修改</button><button>⌗ 裁剪</button><button>✂ 分割</button><button>⇩ 下载</button><button @click.stop="removeLayer(layer.id)">⌫ 删除</button>
            </div>
          </template>
          <template v-if="layer.type === 'placeholder'">
            <div
              class="uc-layer-placeholder-card"
              :style="{ '--placeholder-preview': layer.previewUrl ? `url(${layer.previewUrl})` : 'none' }"
            >
              <div class="loading-card-container size-md">
                <div class="virtual-progress-bar">
                  <div class="virtual-progress-fill dark" :style="{ width: `${Math.max(3, Math.min(100, layer.progress || 0))}%` }" />
                </div>
                <div class="logo-wrapper">
                  <strong class="uc-placeholder-logo">YOUMI</strong>
                </div>
                <span class="progress-percent dark">{{ Math.round(layer.progress || 0) }}%</span>
                <p class="dynamic-text dark">{{ layer.statusText || '正在校准粒子精度与材质细节...' }}</p>
              </div>
              <button class="uc-placeholder-close" type="button" title="移除这张执行卡（不影响后台任务）" @pointerdown.stop @click.stop="removeLayer(layer.id)">×</button>
            </div>
          </template>
          <template v-else-if="layer.type === 'text'">
            <!-- 文本节点：暖金品牌色选中态 + 提示词标签 -->
            <div class="uc-text-node">
              <!-- 图层标签：类型+时间 -->
              <div class="uc-layer-label"><i class="ri-text"></i> {{ layer.name }} <small>{{ formatLayerTime(layer) }}</small></div>
              <div class="uc-text-node-area">
                <span v-if="editingTextLayerId !== layer.id" class="uc-text-node-span" :style="{ fontSize: (layer.fontSize || 14) + 'px', color: layer.color || '#999', textAlign: layer.align || 'left' }">{{ layer.text || '双击开始编辑...' }}</span>
                <textarea v-else ref="textEditRef" class="uc-text-edit-input" v-model="editingTextValue" @blur="finishEditText" @keydown.escape.prevent="finishEditText" @pointerdown.stop></textarea>
              </div>
              <div class="uc-text-node-hint" @pointerdown.stop @click.stop>
                <i class="ri-edit-line"></i> 提示词
              </div>
              <button class="uc-node-close" type="button" title="删除文本节点" @pointerdown.stop @click.stop="removeLayer(layer.id)">×</button>
              <!-- 左右连接点 -->
              <div class="uc-connection-port uc-port-left" @pointerdown.stop="startConnection($event, layer.id, 'left')" @pointerup.stop="finishConnection($event, layer.id, 'left')">+</div>
              <div class="uc-connection-port uc-port-right" @pointerdown.stop="startConnection($event, layer.id, 'right')" @pointerup.stop="finishConnection($event, layer.id, 'right')">+</div>
            </div>
          </template>
          <template v-else-if="layer.type === 'image-placeholder'">
            <!-- 图片占位节点：暖金品牌色 + 虚线框 + 图标 + 提示词 -->
            <div class="uc-image-placeholder">
              <!-- 图层标签 -->
              <div class="uc-layer-label"><i class="ri-image-line"></i> {{ layer.name }} <small>{{ formatLayerTime(layer) }}</small></div>
              <div class="uc-image-placeholder-inner">
                <div class="uc-placeholder-icon">
                  <i class="ri-image-line"></i>
                </div>
              </div>
              <div class="uc-text-node-hint" @pointerdown.stop @click.stop>
                <i class="ri-edit-line"></i> 提示词
              </div>
              <button class="uc-node-close" type="button" title="删除图片节点" @pointerdown.stop @click.stop="removeLayer(layer.id)">×</button>
              <!-- 左右连接点 -->
              <div class="uc-connection-port uc-port-left" @pointerdown.stop="startConnection($event, layer.id, 'left')" @pointerup.stop="finishConnection($event, layer.id, 'left')">+</div>
              <div class="uc-connection-port uc-port-right" @pointerdown.stop="startConnection($event, layer.id, 'right')" @pointerup.stop="finishConnection($event, layer.id, 'right')">+</div>
            </div>
          </template>
          <template v-else-if="layer.type === 'video'">
            <div class="uc-video-node">
              <!-- 图层标签 -->
              <div class="uc-layer-label"><i class="ri-video-line"></i> {{ layer.name }} <small>{{ formatLayerTime(layer) }}</small></div>
              <template v-if="layer.url">
                <!-- 有视频内容 -->
                <div class="uc-video-node-inner">
                  <video :src="layer.url" muted preload="metadata" class="uc-video-node-video" @pointerdown.stop></video>
                  <button class="uc-video-play-btn" @pointerdown.stop @click.stop="playVideoNode(layer)"><i class="ri-play-fill"></i></button>
                </div>
              </template>
              <template v-else>
                <!-- 视频占位态：暖金品牌色 + 虚线框 + 图标 + 提示词 -->
                <div class="uc-image-placeholder-inner">
                  <div class="uc-placeholder-icon">
                    <i class="ri-video-line"></i>
                  </div>
                </div>
                <div class="uc-text-node-hint" @pointerdown.stop @click.stop>
                  <i class="ri-edit-line"></i> 提示词
                </div>
              </template>
              <button class="uc-node-close" type="button" title="删除视频节点" @pointerdown.stop @click.stop="removeLayer(layer.id)">×</button>
              <!-- 左右连接点 -->
              <div class="uc-connection-port uc-port-left" @pointerdown.stop="startConnection($event, layer.id, 'left')" @pointerup.stop="finishConnection($event, layer.id, 'left')">+</div>
              <div class="uc-connection-port uc-port-right" @pointerdown.stop="startConnection($event, layer.id, 'right')" @pointerup.stop="finishConnection($event, layer.id, 'right')">+</div>
            </div>
          </template>
          <template v-else>
            <!-- 图片节点（含已上传内容）：与占位态保持一致的 UI 结构 -->
            <div class="uc-image-node">
              <div class="uc-layer-label"><i class="ri-image-line"></i> {{ layer.name }} <small>{{ formatLayerTime(layer) }}</small></div>
              <div class="uc-image-node-inner">
                <img :src="layer.url" :alt="layer.name" draggable="false" />
              </div>
              <div class="uc-text-node-hint" @pointerdown.stop @click.stop>
                <i class="ri-edit-line"></i> 提示词
              </div>
              <button class="uc-node-close" type="button" title="删除图片节点" @pointerdown.stop @click.stop="removeLayer(layer.id)">×</button>
              <!-- 左右连接点 -->
              <div class="uc-connection-port uc-port-left" @pointerdown.stop="startConnection($event, layer.id, 'left')" @pointerup.stop="finishConnection($event, layer.id, 'left')">+</div>
              <div class="uc-connection-port uc-port-right" @pointerdown.stop="startConnection($event, layer.id, 'right')" @pointerup.stop="finishConnection($event, layer.id, 'right')">+</div>
            </div>
          </template>
          <template v-if="layer.type !== 'placeholder' && layer.type !== 'text' && layer.type !== 'image' && layer.type !== 'image-placeholder' && layer.type !== 'video' && !(layer.url && !layer.type) && layer.id === selectedLayerId && selectedLayerIds.length <= 1">
            <i v-for="point in ['top-left','top','top-right','right','bottom-right','bottom','bottom-left','left']" :key="point" :class="['resize-dot', point]" @pointerdown="startResize($event, layer, point)" @pointermove="resizeLayer" @pointerup="stopResize" @pointercancel="stopResize" />
          </template>
        </figure>

        <!-- 连接线 SVG 层（在节点层之后，通过 CSS z-index 控制层叠） -->
        <svg class="connections-layer">
          <!-- 已建立的连接线 -->
          <g v-for="conn in getConnectionPaths()" :key="conn.id" class="connection-group">
            <!-- 透明宽点击区域 -->
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
              @click.stop="selectConnection($event, conn.id)"
            />
            <!-- 连接点圆圈 -->
            <circle :cx="conn.fromX" :cy="conn.fromY" r="4" class="connection-dot" />
            <circle :cx="conn.toX" :cy="conn.toY" r="4" class="connection-dot" />
          </g>
          <!-- 正在拖拽的连接线 -->
          <path
            v-if="connecting.active"
            :d="connectingPath"
            class="connection-line connecting"
          />
        </svg>
        <!-- 连接线选中后的删除按钮（剪刀+删除） -->
        <div
          v-if="selectedConnection.id"
          class="connection-delete-btn"
          :style="{ left: selectedConnection.x + 'px', top: selectedConnection.y + 'px' }"
          @pointerdown.stop
          @click.stop="removeConnection(selectedConnection.id); deselectConnection()"
        >
          <i class="ri-scissors-line"></i>
          <span>删除</span>
        </div>

        <div v-if="marquee.active" class="selection-marquee" :style="marqueeStyle" />
        <div v-if="manualBoxDraft.active" class="manual-box-draft" :style="manualBoxDraftStyle" />
        <div v-if="manualNameInput.visible" class="manual-name-input" :style="{ left: `${manualNameInput.x}px`, top: `${manualNameInput.y}px` }" @pointerdown.stop>
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

      <!-- 元素检测框 overlay -->
      <div
        :class="['detected-elements-overlay', { 'annotate-mode': activeTool === 'annotate', 'ctrl-mode': ctrlHeld && activeTool !== 'annotate', 'detection-visible': getDetectionVisible() }]"
        @pointerdown="handleDetectedOverlayClick"
      >
        <template v-for="(elements, layerId) in layerDetectedElements" :key="layerId">
          <template v-for="(el, eIdx) in elements" :key="`${layerId}::${el.object_name || el.name || el.id || `e${eIdx}`}`">
            <div
              v-if="layers.find((l) => l.id === layerId) && !isElementBlocked(layerId, el.box_2d || el.box2d || [0,0,1,1])"
              class="detected-element-box"
              :class="{ 'selected': selectedDetectedElements.has(`${layerId}::${el.object_name || el.name || el.id || `e${eIdx}`}`) }"
              :style="(function() {
                const layer = layers.find((l) => l.id === layerId);
                const box = el.box_2d || el.box2d || [0,0,1,1];
                // 节点类型有 padding（外层4px + 内层4px = 8px），需要偏移
                const isNode = layer.type === 'image' || layer.type === 'video' || layer.type === 'text' || layer.type === 'image-placeholder' || (layer.url && !layer.type);
                const pad = isNode ? 8 : 0;
                const innerW = layer.width - pad * 2;
                const innerH = layer.height - pad * 2;
                return {
                  left: `${(layer.x + pad + box[1] * innerW) * viewScale + viewOffset.x}px`,
                  top: `${(layer.y + pad + box[0] * innerH) * viewScale + viewOffset.y}px`,
                  width: `${Math.max(2, (box[3] - box[1]) * innerW * viewScale)}px`,
                  height: `${Math.max(2, (box[2] - box[0]) * innerH * viewScale)}px`,
                };
              })()"
            >
              <span class="detected-element-label">{{ el.object_name || el.name || '元素' }}</span>
            </div>
            <span
              v-if="selectedDetectedElements.has(`${layerId}::${el.object_name || el.name || el.id || `e${eIdx}`}`) && !isElementBlocked(layerId, el.box_2d || el.box2d || [0,0,1,1])"
              class="detected-element-index"
              :style="getElementClickStyle(`${layerId}::${el.object_name || el.name || el.id || `e${eIdx}`}`)"
            >{{ [...selectedDetectedElements].indexOf(`${layerId}::${el.object_name || el.name || el.id || `e${eIdx}`}`) + 1 }}</span>
          </template>
        </template>
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
            :class="['canvas-minimap-layer', { selected: layer.selected, placeholder: layer.type === 'placeholder' }]"
            :style="layer.style"
          ></i>
          <b class="canvas-minimap-viewport" :style="canvasMinimap.viewportStyle"></b>
        </div>
      </aside>

      <div class="canvas-zoom-bar" aria-label="画布缩放">
        <button class="zoom-bar-icon-btn" title="适应画布" @click="zoom(0, { fit: true })"><i class="ri-aspect-ratio-line"></i></button>
        <button class="zoom-bar-icon-btn minimap-toggle-btn" :class="{ active: minimapVisible }" title="地图" @click="minimapVisible = !minimapVisible"><i class="ri-map-pin-line"></i></button>
        <div class="zoom-bar-slider-wrap">
          <input type="range" class="zoom-bar-slider" min="0" max="100" :value="zoomSliderValue" @input="setZoomFromSlider($event.target.value)" />
        </div>
        <button @click="zoom(-0.08)"><i class="ri-subtract-line"></i></button>
        <strong @click="zoomSliderReset" title="点击重置 100%">{{ Math.round(viewScale * 100) }}%</strong>
        <button @click="zoom(0.08)"><i class="ri-add-line"></i></button>
        <div class="zoom-bar-sep"></div>
        <button class="zoom-bar-help-btn" :class="{ active: helpMenuOpen }" title="帮助" @click.stop="openHelpMenu">?</button>
      </div>

      <!-- 反推提示词卡片：隐藏大图，参考图 URL 仍传给生图 API -->
      <aside v-if="false" class="reverse-prompt-mini-card uc-floating" aria-label="反推提示词卡片" @pointerdown.stop="">
      </aside>

      <nav class="bottom-tools uc-sidebar-tools uc-floating uc-floating-toolbar is-docked" aria-label="画布工具栏" @pointerdown.stop>
        <div class="uc-toolbar-add-wrap" ref="addMenuWrapEl">
          <button type="button" class="uc-sidebar-tool-btn uc-toolbar-add-btn" :class="{ active: toolbarAddOpen }" title="添加节点" @click.stop="toggleToolbarAdd()">
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
      </nav>

      <aside v-if="rightPanelVisible" class="right-panel uc-left uc-rightpanel uc-floating uc-floating-panel" :style="{ width: `${panel.width}px`, ...(panel.x === null ? {} : { left: `${panel.x}px`, top: `${panel.y}px`, right: 'auto' }) }">
        <div class="panel-resize-handle" title="调节对话窗口宽度" @pointerdown="startPanelResize" @pointermove="resizePanel" @pointerup="stopPanelResize" @pointercancel="stopPanelResize" />
        <header class="uc-left-tabs uc-floating-drag-handle">
          <button class="uc-left-tab" :class="{ active: rightTab === 'chat' }" @click="rightTab = 'chat'">
            <i class="ri-chat-3-line" aria-hidden="true"></i><span>对话窗口</span>
          </button>
          <button class="uc-left-tab" :class="{ active: rightTab === 'layers' }" @click="rightTab = 'layers'">
            <i class="ri-stack-line" aria-hidden="true"></i><span>图层窗口</span>
          </button>
          <button class="uc-left-tab" :class="{ active: rightTab === 'history' }" @click="rightTab = 'history'">
            <i class="ri-image-circle-line" aria-hidden="true"></i><span>生图记录</span><b v-if="generationHistory.length">{{ generationHistory.length }}</b>
          </button>
          <button class="panel-drag uc-rightpanel-toggle-btn uc-floating uc-floating-toggle is-docked" title="拖动右侧面板" @pointerdown="startPanelDrag" @pointermove="movePanel" @pointerup="stopPanel" @pointercancel="stopPanel">
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
          >
            <div
              v-for="message in chatMessages"
              :key="message.id"
              :class="['uc-chat-msg', message.role === 'user' ? 'uc-chat-msg--user' : 'uc-chat-msg--assistant']"
            >
              <div class="uc-chat-msg-bubble" v-html="renderMessageContent(message)"></div>
            </div>
            <div v-if="!chatMessages.length" class="chat-empty"><i>☏</i><strong>对话生图：通过自然语言修改画布上的图片</strong><span>点选画布上的图片，再描述你想要的修改</span></div>
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
                      left: `${((hoverPreview.box[1] || 0) + (hoverPreview.box[3] || 1)) * 50}%`,
                      top: `${((hoverPreview.box[0] || 0) + (hoverPreview.box[2] || 1)) * 50}%`,
                    }"
                  >
                    <span>{{ hoverPreview.order }}</span>
                  </div>
                </div>
              </div>
            </div>
          </Teleport>
          <div class="chat-input uc-chat-inputbar" :style="{ flexBasis: `${panel.chatHeight + 24}px`, minHeight: `${panel.chatHeight + 24}px` }">
            <div v-if="selectedLayer" class="target-layer"><img :src="selectedLayer.thumbnailUrl" alt="" /><span>{{ layerName(selectedLayerIndex) }}</span></div>
            <div class="chat-box uc-ref-panel" :style="{ height: `${panel.chatHeight}px` }" @click="handleChatBoxClick">
              <div class="chat-box-resize" title="向上拖动扩大输入框" @pointerdown="startChatResize" @pointermove="resizeChatBox" @pointerup="stopChatResize" @pointercancel="stopChatResize" />
              <div class="uc-home-dialog-main">
                <div class="uc-chat-upload-deck yh-upload-deck" :class="{ 'has-images': chatReferenceImages.length }" :style="{ '--deck-count': chatReferenceImages.length }">
                  <button
                    v-for="(image, index) in chatReferenceImages"
                    :key="image.id"
                    class="yh-upload-card"
                    :class="{ active: activeChatReferenceId === image.id, uploading: image.uploading, error: image.error }"
                    :style="{ '--deck-index': index, '--deck-total': chatReferenceImages.length }"
                    type="button"
                    @mouseenter="activeChatReferenceId = image.id"
                    @focus="activeChatReferenceId = image.id"
                  >
                    <img :src="image.url" :alt="image.name || '参考图'" />
                    <span v-if="image.uploading" class="yh-upload-card-status">上传中</span>
                    <span v-else-if="image.error" class="yh-upload-card-status">失败</span>
                    <span class="yh-image-count">{{ index + 1 }}</span>
                    <span class="yh-remove-image" role="button" tabindex="0" @click.stop="removeChatReferenceImage(image.id)">×</span>
                  </button>
                  <button class="uc-upload-tile yh-upload-tile" type="button" :class="{ compact: chatReferenceImages.length }" @click.stop="openImageUpload('chat')">
                    <span v-if="chatUploading && !chatReferenceImages.length" class="yh-uploading">上传中</span>
                    <span v-else>{{ chatReferenceImages.length ? '+' : '＋' }}</span>
                  </button>
                </div>
                <div
                  ref="chatEditorRef"
                  class="chat-editor"
                  :class="{ 'chat-editor-empty': !chatText.trim() && !getSelectedDetectedElements().length }"
                  :data-placeholder="'描述你想生成的图片，或选中画布图片描述修改...'"
                  contenteditable="true"
                  @input="handleEditorInput"
                  @click="handleEditorPillClick"
                  @keydown.enter.prevent="sendChat"
                  @keydown.ctrl.enter.prevent="document.execCommand('insertLineBreak')"
                  @keydown.backspace="handleEditorBackspace"
                />
              </div>
              <div class="uc-chat-generate-options" @click.stop>
                <label>
                  <span>模型</span>
                  <select v-model="chatModel" :disabled="chatGenerating">
                    <option v-for="model in chatModelOptions" :key="model" :value="model">{{ model }}</option>
                  </select>
                </label>
                <label>
                  <span>比例</span>
                  <select v-model="chatRatio" :disabled="chatGenerating">
                    <option v-for="ratio in chatRatioOptions" :key="ratio" :value="ratio">{{ ratio }}</option>
                  </select>
                </label>
                <label>
                  <span>分辨率</span>
                  <select v-model="chatResolution" :disabled="chatGenerating">
                    <option v-for="resolution in chatResolutionOptions" :key="resolution" :value="resolution">{{ resolution }}</option>
                  </select>
                </label>
              </div>
              <footer class="uc-bottom-toolbar"><span>Enter 发送 · Ctrl+Enter 换行</span><button :disabled="(!chatText.trim() && !getSelectedDetectedElements().length) || chatGenerating" @click="sendChat"><i class="ri-send-plane-fill" aria-hidden="true"></i>{{ chatGenerating ? '生成中' : '发送' }}</button></footer>
            </div>
          </div>
        </section>

        <section v-else class="layers-panel">
          <h3>图层 <b>{{ layers.length }}</b></h3>
          <button v-for="layer in [...layers].reverse()" :key="layer.id" :class="{ active: selectedLayerIds.includes(layer.id) }" @click="selectedLayerId = layer.id; selectedLayerIds = [layer.id]">
            <span>◉</span><img v-if="layer.thumbnailUrl" :src="layer.thumbnailUrl" alt="" /><i v-else class="ri-ai-generate-2-line" aria-hidden="true"></i><strong>{{ layerName(layers.findIndex((item) => item.id === layer.id)) }}</strong><small>{{ Math.round(layer.width) }} x {{ Math.round(layer.height) }}</small><em>▣</em>
          </button>
        </section>

        <section v-if="rightTab === 'history'" class="generation-history-panel">
          <h3>生图记录 <b>{{ generationHistory.length }}</b></h3>
          <article v-for="record in [...generationHistory].reverse()" :key="record.id" class="gh-record">
            <img v-if="record.imageUrl" :src="record.imageUrl" alt="" />
            <strong>{{ record.model }} · {{ record.ratio }}</strong>
            <p>{{ record.prompt }}</p>
            <small v-if="record.referenceImageUrls?.length">参考图 {{ record.referenceImageUrls.length }} 张</small>
            <footer>
              <button type="button" @click="addGenerationRecordToCanvas(record)">加到画布</button>
              <button type="button" @click="useGenerationRecordAsReference(record)">作参考图</button>
              <button type="button" @click="reuseGenerationRecordPrompt(record)">复用提示词</button>
              <button type="button" class="danger" @click="removeGenerationRecord(record.id)">删除</button>
            </footer>
          </article>
        </section>
      </aside>
    </section>

    <!-- 帮助菜单 -->
    <Teleport to="body">
      <div v-if="helpMenuOpen" class="zoom-bar-help-menu" :style="helpMenuStyle" @click.stop>
        <button class="help-menu-item" @click="helpMenuOpen = false"><i class="ri-guide-line"></i><span>帮助</span></button>
        <button class="help-menu-item" @click="helpMenuOpen = false; shortcutsOpen = true"><i class="ri-keyboard-line"></i><span>快捷键</span></button>
      </div>
    </Teleport>

    <!-- 快捷键面板 -->
    <div v-if="shortcutsOpen" class="shortcuts-backdrop" @click.self="shortcutsOpen = false">
      <div class="shortcuts-panel">
        <div class="shortcuts-head">
          <h2>⌨ 快捷键速查</h2>
          <button @click="shortcutsOpen = false">✕</button>
        </div>
        <div class="shortcuts-body">
          <div class="shortcuts-group">
            <h3>🛠 工具切换</h3>
            <dl>
              <div><dt>V</dt><dd>选择工具</dd></div>
              <div><dt>H</dt><dd>抓手工具（拖动画布）</dd></div>
              <div><dt>F</dt><dd>聚焦选中图层 / 适应画面</dd></div>
              <div><dt>T</dt><dd>插入文字</dd></div>
              <div><dt>M</dt><dd>标记元素（点击选中）</dd></div>
            </dl>
          </div>
          <div class="shortcuts-group">
            <h3>🖱 画布操作</h3>
            <dl>
              <div><dt>滚轮</dt><dd>缩放画布</dd></div>
              <div><dt>空格 + 拖拽</dt><dd>平移画布</dd></div>
              <div><dt>拖入图片/文件</dt><dd>添加图片到画布</dd></div>
              <div><dt>Ctrl + 点击</dt><dd>任意工具下临时选中元素</dd></div>
            </dl>
          </div>
          <div class="shortcuts-group">
            <h3>✏ 编辑</h3>
            <dl>
              <div><dt>Ctrl + Z</dt><dd>撤销上一步（最多50步）</dd></div>
              <div><dt>Delete</dt><dd>删除选中图层</dd></div>
              <div><dt>Backspace</dt><dd>输入框内删除字符</dd></div>
              <div><dt>Esc</dt><dd>关闭面板</dd></div>
            </dl>
          </div>
          <div class="shortcuts-group">
            <h3>💬 对话</h3>
            <dl>
              <div><dt>Enter</dt><dd>发送对话消息</dd></div>
              <div><dt>Ctrl + Enter</dt><dd>输入框换行</dd></div>
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
        <button @click="openImageUpload('canvas'); toolbarAddOpen = false"><i class="ri-upload-2-line" aria-hidden="true"></i><span class="uc-toolbar-add-text">本地上传</span><span class="uc-toolbar-add-shortcut">拖拽</span></button>
        <button @click="toolbarAddOpen = false"><i class="ri-history-line" aria-hidden="true"></i><span class="uc-toolbar-add-text">历史生成导入</span><span class="uc-toolbar-add-shortcut">H</span></button>
      </div>
      <div class="uc-toolbar-add-divider"></div>
      <div class="uc-toolbar-add-group">
        <span class="uc-toolbar-add-group-label">添加节点</span>
        <button @click="addImageNode(); toolbarAddOpen = false"><i class="ri-image-line" aria-hidden="true"></i><span class="uc-toolbar-add-text">图片</span><span class="uc-toolbar-add-shortcut">I</span></button>
        <button @click="addVideoNode(); toolbarAddOpen = false"><i class="ri-video-line" aria-hidden="true"></i><span class="uc-toolbar-add-text">视频</span><span class="uc-toolbar-add-shortcut">V</span></button>
        <button @click="addTextNode(); toolbarAddOpen = false"><i class="ri-text" aria-hidden="true"></i><span class="uc-toolbar-add-text">文本</span><span class="uc-toolbar-add-shortcut">T</span></button>
      </div>
    </div>
  </Teleport>

  <!-- 重叠元素切换弹窗 -->
  <Teleport to="body">
    <div v-if="overlapDropdown.visible" class="detect-select-overlay" @click="closeOverlapDropdown">
      <div class="detect-select-popup" :style="{ left: `${overlapDropdown.x}px`, top: `${overlapDropdown.y}px`, transform: 'translateY(-100%)' }" @pointerdown.stop="">
        <div class="detect-select-popup-header">切换重叠元素 ({{ overlapDropdown.candidates.length }})</div>
        <div class="detect-select-popup-list">
          <button
            v-for="(c, i) in overlapDropdown.candidates"
            :key="`${c.layerId}::${c.id}`"
            :class="['detect-select-popup-item', { selected: `${c.layerId}::${c.id}` === overlapDropdown.pillKey }]"
            @click.stop="replacePillElement(c)"
          >
            <span :class="['detect-select-popup-dot', { active: `${c.layerId}::${c.id}` === overlapDropdown.pillKey }]"></span>
            <span class="detect-select-popup-name">{{ c.name }}</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 图片查看器 -->
  <Teleport to="body">
    <div v-if="imageViewer.show" class="uc-image-viewer-overlay" @click.self="closeImageViewer" @keydown.escape="closeImageViewer">
      <div class="uc-image-viewer-container">
        <!-- 关闭按钮 -->
        <button class="uc-image-viewer-close" @click="closeImageViewer">
          <i class="ri-close-line"></i>
        </button>

        <!-- 图片显示区域 -->
        <div class="uc-image-viewer-content">
          <img
            :src="imageViewer.url"
            :alt="imageViewer.name"
            :style="{
              transform: `rotate(${imageViewer.rotation}deg) scaleX(${imageViewer.flipX ? -1 : 1}) scaleY(${imageViewer.flipY ? -1 : 1}) scale(${imageViewer.scale})`,
              transition: 'transform 0.3s ease',
            }"
            draggable="false"
          />
        </div>

        <!-- 底部工具栏 -->
        <div class="uc-image-viewer-toolbar">
          <!-- 左翻转 -->
          <button class="uc-viewer-tool-btn" title="左翻转" @click="rotateImage(-90)">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
              <path d="M3 3v5h5"/>
            </svg>
          </button>

          <!-- 右翻转 -->
          <button class="uc-viewer-tool-btn" title="右翻转" @click="rotateImage(90)">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
              <path d="M21 3v5h-5"/>
            </svg>
          </button>

          <!-- 左右镜像 -->
          <button class="uc-viewer-tool-btn" title="左右镜像" @click="flipImage('x')">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 3v18"/>
              <path d="M16 7l4 5-4 5"/>
              <path d="M8 7l-4 5 4 5"/>
            </svg>
          </button>

          <!-- 上下镜像 -->
          <button class="uc-viewer-tool-btn" title="上下镜像" @click="flipImage('y')">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 12h18"/>
              <path d="M7 8L2 12l5 4"/>
              <path d="M17 8l5 4-5 4"/>
            </svg>
          </button>

          <!-- 缩小 -->
          <button class="uc-viewer-tool-btn" title="缩小" @click="zoomImage(-0.25)">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/>
              <path d="M21 21l-4.35-4.35"/>
              <path d="M8 11h6"/>
            </svg>
          </button>

          <!-- 放大 -->
          <button class="uc-viewer-tool-btn" title="放大" @click="zoomImage(0.25)">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/>
              <path d="M21 21l-4.35-4.35"/>
              <path d="M11 8v6"/>
              <path d="M8 11h6"/>
            </svg>
          </button>

          <!-- 下载 -->
          <button class="uc-viewer-tool-btn" title="下载" @click="downloadImage">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
        </div>

        <!-- 页码指示器 -->
        <div class="uc-image-viewer-page">1 / 1</div>
      </div>
    </div>
  </Teleport>
</template>
