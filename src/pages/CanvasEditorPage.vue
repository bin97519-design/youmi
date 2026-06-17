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

// 归一化 box_2d 到 0-1（与 maybeAutoDetect 内的 normalizeBox 一致）
function normalizeBoxVal(raw) {
  if (!Array.isArray(raw) || raw.length !== 4) return [0, 0, 1, 1];
  const allSmall = raw.every(v => Math.abs(v) <= 1.05);
  if (allSmall) return raw;
  return raw.map(v => v / 1000);
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
const rightPanelVisible = ref(true);
const isReversePromptCanvas = computed(() => props.id === 'reverse-prompt');
const reversePromptCard = reactive({ x: null, y: null, width: 380, height: 240, dragging: null });
const reversePromptConnectors = ref([]);
const selectedLayerId = ref(doc.value.payload.layers[0]?.id || '');
const selectedLayerIds = ref(selectedLayerId.value ? [selectedLayerId.value] : []);
const rightTab = ref('chat');
const chatText = ref('');
const chatReferenceImages = ref([]);
const activeChatReferenceId = ref('');
const chatUploading = ref(false);
const chatGenerating = ref(false);
const generationHistory = ref([]);
const chatModel = ref('banana2');
const chatRatio = ref('9:16');
const chatResolution = ref('2K');
const chatModelOptions = ['banana2', 'banana pro', 'GPT imag 2'];
const chatRatioOptions = ['1:1', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const chatResolutionOptions = ['2K', '4K'];
const TASK_POLL_INTERVAL = 2500;
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
  { key: 'text', label: '插入文字', shortcut: 'T', icon: 'ri-text' },
  { key: 'shape', label: '插入矢量图', icon: 'ri-shape-line' },
  { key: 'annotate', label: '标记元素（点击图片元素选中加入输入框）', shortcut: 'M', icon: 'ri-mark-pen-line' },
];
const dragState = ref(null);
const panState = ref(null);
const resizeState = ref(null);
const marquee = reactive({ active: false, startX: 0, startY: 0, currentX: 0, currentY: 0 });
const annotationInput = reactive({ visible: false, layerId: '', x: 0, y: 0, width: 0, height: 0, text: '', geoPixel: null });
const manualBoxDraft = reactive({ active: false, startX: 0, startY: 0, currentX: 0, currentY: 0, layerId: '' });
const selectedAnnotation = ref({ layerId: '', annoId: '' });
const panel = reactive({ x: null, y: 6, width: 340, chatHeight: 258, dragging: null, resizing: null, resizingChat: null });
const toolbar = reactive({ x: null, y: null, dragging: null });

const layers = computed(() => doc.value.payload.layers);
const selectedLayer = computed(() => layers.value.find((item) => item.id === selectedLayerId.value));
const selectedLayerIndex = computed(() => layers.value.findIndex((item) => item.id === selectedLayerId.value));
const viewScale = computed(() => doc.value.payload.view.scale || 1);
const viewOffset = computed(() => doc.value.payload.view.offset || { x: 0, y: 0 });

// Watch for newly added layers to auto-detect
watch(() => layers.value.map((l) => l.id), (newIds, oldIds) => {
  if (!newIds || !oldIds) return;
  const added = newIds.filter((id) => !oldIds.includes(id));
  for (const id of added) {
    const layer = layers.value.find((l) => l.id === id);
    if (layer && layer.url && layer.type !== 'placeholder') {
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

function imageSize(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || 800, height: image.naturalHeight || 800 });
    image.onerror = () => resolve({ width: 800, height: 800 });
    image.src = src;
  });
}

async function maybeAutoDetect(layer) {
  if (!layer || !layer.url || layer.type === 'placeholder') return;
  if (!autoDetectionEnabled.value) return;
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

async function uploadFile(file) {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch('http://101.133.149.214/prod-api/api/v1/file/upload', { method: 'POST', body: form });
  if (!response.ok) throw new Error(`图片上传失败：${response.status}`);
  const result = await response.json();
  const url = extractUploadUrl(result);
  if (!url) throw new Error('上传成功，但接口没有返回图片地址');
  return url.startsWith('http') ? url : `http://101.133.149.214${url}`;
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
}

async function addImageLayerFromUrl(url, name = 'AI生成图片') {
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
}

function addGeneratingPlaceholderLayer(prompt) {
  const referenceImages = chatReferenceImages.value.filter((image) => !image.uploading && !image.error);
  const selected = selectedLayer.value;
  const fallbackBase = [...layers.value].reverse().find((layer) => layer.type !== 'placeholder');
  const base = selected?.type === 'placeholder' ? fallbackBase : selected;
  const previewUrl = referenceImages.at(-1)?.url || base?.url || '';
  let layerId = '';

  canvas.updateDocument(props.id, (draft) => {
    const index = draft.payload.layers.length;
    const maxZ = draft.payload.layers.reduce((max, layer) => Math.max(max, layer.zIndex || 0), 0);
    const fallbackX = Math.round(((panel.x ?? 0) + 260 - viewOffset.value.x) / viewScale.value);
    const fallbackY = Math.round((210 - viewOffset.value.y) / viewScale.value);
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
      x: base ? base.x + Math.min(420, base.width + 42) : fallbackX,
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
  const size = await imageSize(url);
  let replaced = false;
  canvas.updateDocument(props.id, (draft) => {
    const index = draft.payload.layers.findIndex((layer) => layer.id === layerId);
    if (index === -1) return draft;
    const placeholder = draft.payload.layers[index];
    const width = placeholder.width || (size.width > size.height ? 360 : 280);
    draft.payload.layers[index] = {
      ...placeholder,
      type: 'image',
      url,
      thumbnailUrl: url,
      naturalWidth: size.width,
      naturalHeight: size.height,
      width,
      height: Math.round((width * size.height) / size.width),
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
  return layerId;
}

function openImageUpload(mode = 'canvas') {
  if (!userStore.requireLogin()) return;
  fileInputMode.value = mode;
  addOpen.value = false;
  fileInput.value?.click();
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
      const url = await uploadFile(file);
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
  if (event.button !== 0 || event.target.closest('.layer-toolbar') || event.target.closest('.resize-dot')) return;
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
  if (event && event.shiftKey) {
    set.add(key);
  } else if (set.has(key)) {
    set.delete(key);
  } else {
    set.clear();
    set.add(key);
  }
  selectedDetectedElements.value = set;
  if (event) {
    const overlay = event.currentTarget.closest('.detected-elements-overlay');
    const overlayRect = overlay ? overlay.getBoundingClientRect() : event.currentTarget.getBoundingClientRect();
    elementClickPositions.value = {
      ...elementClickPositions.value,
      [key]: { x: event.clientX - overlayRect.left, y: event.clientY - overlayRect.top },
    };
  }
  chatSkipPillSync.value = false;
}

// 同步：editor 里被 Backspace 删除的 pill → 取消画布选中
function handleEditorInput() {
  if (_pillSyncLock > 0) return;  // 程序正在写入，跳过同步
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
      // 清理该元素的位置记录
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
  // 同步纯文本
  const textContent = [];
  for (const node of editor.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      textContent.push(node.textContent);
    } else if (node.nodeType === Node.ELEMENT_NODE && !node.classList.contains('chat-pill')) {
      textContent.push(node.textContent || '');
    }
  }
  chatText.value = textContent.join('');
}

function handleEditorPillClick(event) {
  const pill = event.target.closest('.chat-pill');
  if (!pill) return;
  // 点击 pill 的处理：如果点击的是 em（切换重叠元素），弹出选择
  if (event.target.closest('[data-action="pick-overlap"]')) {
    const elId = pill.dataset.elId;
    const elLayer = pill.dataset.elLayer;
    // 可以在这里弹出重叠元素列表
    return;
  }
}

function clearAllAnnotations() {
  selectedDetectedElements.value = new Set();
  elementClickPositions.value = {};
}

function startResize(event, layer, point) {
  if (!userStore.requireLogin()) return;
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
  const detected = getSelectedDetectedElements();
  if (!detected.length) {
    if (editor.innerHTML !== chatText.value) editor.innerHTML = chatText.value;
    setTimeout(() => { if (_pillSyncLock === lockId) _pillSyncLock = 0; }, 50);
    return;
  }
  let html = '';
  let idx = 0;
  for (const el of detected) {
    idx += 1;
    html += buildElementPill(el, idx);
  }
  html += chatText.value;
  // 仅当内容变化时写入，避免无谓的 @input 事件
  if (editor.innerHTML !== html) {
    editor.innerHTML = html;
  }
  // Place cursor at end of last text node
  requestAnimationFrame(() => {
    if (_pillSyncLock !== lockId) return;
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    sel.addRange(range);
    setTimeout(() => { if (_pillSyncLock === lockId) _pillSyncLock = 0; }, 50);
  });
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

function getElementClickStyle(key) {
  const pos = elementClickPositions.value[key];
  if (!pos) return {};
  return { left: `${pos.x}px`, top: `${pos.y}px` };
}

async function sendChat() {
  const text = chatText.value.trim();
  if (!text || chatGenerating.value) return;
  if (!userStore.requireLogin()) return;

  const createdAt = Date.now();
  const assistantId = `msg-${createdAt}-assistant`;
  const chatImageUrls = chatReferenceImages.value
    .filter((image) => !image.uploading && !image.error)
    .map((image) => image.url)
    .filter((url) => url && !String(url).startsWith('blob:'));
  // 合并反推参考图（元素选中时自动添加的 layer 图）—— 不显示但传给 API
  const refImageUrls = visibleReferenceImages.value
    .map((r) => r.url)
    .filter((url) => url && !String(url).startsWith('blob:'));
  const imageUrls = [...new Set([...chatImageUrls, ...refImageUrls])];

  addChatMessages([
    { id: `msg-${createdAt}`, role: 'user', text, targetLayerId: selectedLayerId.value, createdAt },
    {
      id: assistantId,
      role: 'assistant',
      text: '已提交对话生图任务，请等待生成结果（生成完成后会显示在画布中）。',
      createdAt: createdAt + 1,
    },
  ]);
  chatText.value = '';
  chatGenerating.value = true;
  const placeholderId = addGeneratingPlaceholderLayer(text);

  try {
    const taskId = await submitImageTask({ prompt: text, imageUrls });
    updateChatMessage(assistantId, { taskId, text: `任务已提交，模型 ${chatModel.value}｜${chatRatio.value}｜${chatResolution.value}，正在生成...` });
    updateGeneratingPlaceholder(placeholderId, { taskId, progress: 8, status: 'processing' });

    for (let index = 0; index < TASK_MAX_POLLS; index += 1) {
      await wait(TASK_POLL_INTERVAL);
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
          prompt: text,
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
}

function startMarquee(event) {
  if (event.button !== 0) return;

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
      canvas.updateDocument(props.id, (draft) => { draft.payload.layers = snapshot; return draft; });
      selectedLayerId.value = snapshot[0]?.id || '';
      selectedLayerIds.value = selectedLayerId.value ? [selectedLayerId.value] : [];
    }
  }
  // 工具快捷键
  if (!inInput) {
    const keyMap = { v: 'select', h: 'hand', f: 'focus', t: 'text', m: 'annotate' };
    const tool = keyMap[event.key.toLowerCase()];
    if (tool) { event.preventDefault(); activeTool.value = tool; }
  }
}

// Undo stack
const undoStack = ref([]);
function pushUndo() {
  if (doc.value?.payload?.layers) {
    undoStack.value.push(JSON.parse(JSON.stringify(doc.value.payload.layers)));
    if (undoStack.value.length > 30) undoStack.value.shift();
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
  updateViewportSize();
  window.addEventListener('resize', updateViewportSize);
  window.addEventListener('keydown', onGlobalKeydown);
  loadUILayout();
  // 恢复已缓存的检测元素（清除旧版错误归一化的缓存）
  const cachedElements = doc.value?.payload?.detectedElements;
  if (cachedElements) {
    let hasBadData = false;
    for (const els of Object.values(cachedElements)) {
      if (Array.isArray(els)) {
        for (const el of els) {
          const box = el.box_2d || el.box2d || [];
          if (box.some(v => Math.abs(v) > 1.05)) { hasBadData = true; break; }
        }
      }
      if (hasBadData) break;
    }
    if (hasBadData) {
      // 旧版归一化 bug 导致的数据，清除缓存让用户重新检测
      canvas.updateDocument(props.id, (draft) => {
        draft.payload.detectedElements = {};
        return draft;
      });
      layerDetectedElements.value = {};
    } else {
      layerDetectedElements.value = { ...cachedElements };
    }
  }
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
    window.removeEventListener('keydown', onGlobalKeydown);
  });
});

onBeforeUnmount(() => {
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
</script>

<template>
  <main class="editor">
    <header class="editor-head">
      <div class="head-left">
        <button class="logo logo-link" type="button" @click="router.push('/')">YOUMI</button><span>·</span><b>万能画布</b><span>/</span><button>✎ {{ doc.title }}</button><em>已保存 · 刚刚</em>
      </div>
      <div class="head-actions">
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

      <aside v-if="activeTool === 'annotate'" class="annotate-banner">
        标记工具已开启 · 点击图片元素选中加入输入框；其他工具下可按住 Ctrl+点击 选中元素
        <button type="button" class="annotate-banner-close" @click="activeTool = 'select'">退出</button>
      </aside>

      <div
        :class="['stage', { 'hand-tool': activeTool === 'hand', 'annotate-tool': activeTool === 'annotate', 'is-panning': panState }]"
        @wheel.prevent="wheelZoom"
        @pointerdown="startMarquee"
        @pointermove="moveMarquee"
        @pointerup="stopMarquee"
        @pointercancel="stopMarquee"
      >
        <div v-if="layers.length === 0" class="start-card">
          <i>▧</i>
          <h2>开始你的画布</h2>
          <p>把图片直接拖到这里，或按下面的快捷键</p>
          <dl><dt>拖入图片</dt><dd>或 .yq 画布文件 即可添加到画布</dd><dt>空格</dt><dd>长按 + 左键拖动 即可平移画布</dd><dt>A</dt><dd>打开“添加图片”面板，从本地或生成历史导入</dd></dl>
        </div>

        <figure
          v-for="(layer, index) in layers"
          :key="layer.id"
          :data-layer-id="layer.id"
          :class="[
            'canvas-layer',
            {
              selected: selectedLayerIds.includes(layer.id),
              'multi-selected': selectedLayerIds.length > 1 && selectedLayerIds.includes(layer.id),
              'is-placeholder': layer.type === 'placeholder',
              'is-failed': layer.status === 'failed',
            },
          ]"
          :style="{
            transform: `translate(${layer.x * viewScale + viewOffset.x}px, ${layer.y * viewScale + viewOffset.y}px) scale(${viewScale})`,
            width: `${layer.width}px`,
            height: layer.type === 'placeholder' ? `${layer.height}px` : undefined,
            zIndex: layer.zIndex,
            '--canvas-inverse-scale': 1 / viewScale,
          }"
          @pointerdown="startLayerDrag($event, layer)"
          @pointermove="moveLayer"
          @pointerup="stopLayerDrag"
          @pointercancel="stopLayerDrag"
        >
          <div v-if="layer.type !== 'placeholder' && layer.id === selectedLayerId && selectedLayerIds.length <= 1" class="layer-toolbar">
            <button>✂ 智能抠图</button><button @click.stop="maybeAutoDetect(selectedLayer)"><template v-if="selectedLayer && detectingLayerIds.has(selectedLayer.id)">⏳ 检测中...</template><template v-else>◈ 智能分层</template></button><button>T 编辑文字</button><button>↔ 扩图</button><button>☏ 对话修改</button><button>▧ 尺寸修改</button><button>⌗ 裁剪</button><button>✂ 分割</button><button>⇩ 下载</button><button @click.stop="removeLayer(layer.id)">⌫ 删除</button>
          </div>
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
              <button class="uc-placeholder-close" type="button" title="移除这张执行卡（不影响后台任务）" @click.stop="removeLayer(layer.id)">×</button>
            </div>
          </template>
          <template v-else>
            <span class="layer-badge">{{ index + 1 }}</span>
            <img :src="layer.url" :alt="layer.name" draggable="false" />
          </template>
          <template v-if="layer.type !== 'placeholder' && layer.id === selectedLayerId && selectedLayerIds.length <= 1">
            <i v-for="point in ['top-left','top','top-right','right','bottom-right','bottom','bottom-left','left']" :key="point" :class="['resize-dot', point]" @pointerdown="startResize($event, layer, point)" @pointermove="resizeLayer" @pointerup="stopResize" @pointercancel="stopResize" />
          </template>
        </figure>
        <div v-if="marquee.active" class="selection-marquee" :style="marqueeStyle" />
        <div v-if="getDetectionVisible() || activeTool === 'annotate' || ctrlHeld" :class="['detected-elements-overlay', { 'annotate-mode': activeTool === 'annotate', 'ctrl-mode': ctrlHeld && activeTool !== 'annotate', 'detection-visible': getDetectionVisible() }]">
          <template v-for="(elements, layerId) in layerDetectedElements" :key="layerId">
            <template v-for="(el, eIdx) in elements" :key="`${layerId}::${el.object_name || el.name || el.id || `e${eIdx}`}`">
              <div
                v-if="layers.find((l) => l.id === layerId)"
                class="detected-element-box"
                :style="(function() {
                  const layer = layers.find((l) => l.id === layerId);
                  const box = el.box_2d || el.box2d || [0,0,1,1];
                  // box 归一化 (0-1)，layer.x/y/width/height 是世界坐标
                  // 渲染公式与 line 1470 一致：screen = world * viewScale + viewOffset
                  return {
                    left: `${(layer.x + box[1] * layer.width) * viewScale + viewOffset.x}px`,
                    top: `${(layer.y + box[0] * layer.height) * viewScale + viewOffset.y}px`,
                    width: `${Math.max(2, (box[3] - box[1]) * layer.width * viewScale)}px`,
                    height: `${Math.max(2, (box[2] - box[0]) * layer.height * viewScale)}px`,
                  };
                })()"
                @pointerdown.stop="smartToggleElement(layerId, el.object_name || el.name || el.id || `e${eIdx}`, $event)"
              >
                <span class="detected-element-label">{{ el.object_name || el.name || '元素' }}</span>
              </div>
              <span
                v-if="selectedDetectedElements.has(`${layerId}::${el.object_name || el.name || el.id || `e${eIdx}`}`)"
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
        <div class="uc-toolbar-add-wrap">
          <button type="button" class="uc-sidebar-tool-btn uc-toolbar-add-btn" :class="{ active: toolbarAddOpen }" title="添加图片" @click.stop="toolbarAddOpen = !toolbarAddOpen">
            <i class="ri-add-line" aria-hidden="true"></i>
          </button>
          <div v-if="toolbarAddOpen" class="uc-toolbar-add-menu" @click.stop>
            <button @click="openImageUpload('canvas'); toolbarAddOpen = false"><i class="ri-upload-2-line" aria-hidden="true"></i>本地上传</button>
            <button @click="toolbarAddOpen = false"><i class="ri-history-line" aria-hidden="true"></i>从历史生成导入</button>
          </div>
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
          <div class="chat-history uc-chat-history">
            <div
              v-for="message in chatMessages"
              :key="message.id"
              :class="['uc-chat-msg', message.role === 'user' ? 'uc-chat-msg--user' : 'uc-chat-msg--assistant']"
            >
              <div class="uc-chat-msg-bubble">{{ message.text }}</div>
            </div>
            <div v-if="!chatMessages.length" class="chat-empty"><i>☏</i><strong>对话生图：通过自然语言修改画布上的图片</strong><span>点选画布上的图片，再描述你想要的修改</span></div>
          </div>
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
              <footer class="uc-bottom-toolbar"><span>Enter 发送 · Ctrl+Enter 换行</span><button :disabled="!chatText.trim() || chatGenerating" @click="sendChat"><i class="ri-send-plane-fill" aria-hidden="true"></i>{{ chatGenerating ? '生成中' : '发送' }}</button></footer>
            </div>
          </div>
        </section>

        <section v-else class="layers-panel">
          <h3>图层 <b>{{ layers.length }}</b></h3>
          <button v-for="(layer, index) in [...layers].reverse()" :key="layer.id" :class="{ active: selectedLayerIds.includes(layer.id) }" @click="selectedLayerId = layer.id; selectedLayerIds = [layer.id]">
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
              <div><dt>Ctrl + Z</dt><dd>撤销上一步（最多30步）</dd></div>
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
</template>
