<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref } from 'vue';
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
const selectedLayerId = ref(doc.value.payload.layers[0]?.id || '');
const selectedLayerIds = ref(selectedLayerId.value ? [selectedLayerId.value] : []);
const rightTab = ref('chat');
const chatText = ref('');
const chatReferenceImages = ref([]);
const activeChatReferenceId = ref('');
const chatUploading = ref(false);
const chatGenerating = ref(false);
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
const activeTool = ref('select');
const canvasTools = [
  { key: 'select', label: '选择', shortcut: 'V', icon: 'ri-cursor-line' },
  { key: 'hand', label: '抓手（拖动画布）', shortcut: 'H', icon: 'ri-hand' },
  { key: 'focus', label: '聚焦选中 / 适应画面', shortcut: 'F', icon: 'ri-focus-3-line' },
  { key: 'bringTop', label: '置顶图层', icon: 'ri-arrow-up-double-line' },
  { key: 'bringForward', label: '上移一层', icon: 'ri-arrow-up-line' },
  { key: 'text', label: '插入文字', shortcut: 'T', icon: 'ri-text' },
  { key: 'shape', label: '插入矢量图', icon: 'ri-shape-line' },
];
const dragState = ref(null);
const panState = ref(null);
const resizeState = ref(null);
const marquee = reactive({ active: false, startX: 0, startY: 0, currentX: 0, currentY: 0 });
const panel = reactive({ x: null, y: 6, width: 340, chatHeight: 258, dragging: null, resizing: null, resizingChat: null });
const toolbar = reactive({ x: null, y: null, dragging: null });

const layers = computed(() => doc.value.payload.layers);
const selectedLayer = computed(() => layers.value.find((item) => item.id === selectedLayerId.value));
const selectedLayerIndex = computed(() => layers.value.findIndex((item) => item.id === selectedLayerId.value));
const viewScale = computed(() => doc.value.payload.view.scale || 1);
const viewOffset = computed(() => doc.value.payload.view.offset || { x: 0, y: 0 });
const toolbarStyle = computed(() => (toolbar.x === null ? {} : { left: `${toolbar.x}px`, top: `${toolbar.y}px`, bottom: 'auto' }));
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

async function sendChat() {
  const text = chatText.value.trim();
  if (!text || chatGenerating.value) return;
  if (!userStore.requireLogin()) return;

  const createdAt = Date.now();
  const assistantId = `msg-${createdAt}-assistant`;
  const imageUrls = chatReferenceImages.value
    .filter((image) => !image.uploading && !image.error)
    .map((image) => image.url)
    .filter((url) => url && !String(url).startsWith('blob:'));

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

function zoom(delta, center = null) {
  canvas.updateDocument(props.id, (draft) => {
    const oldScale = draft.payload.view.scale || 1;
    const nextScale = Math.max(0.3, Math.min(1.8, Number((oldScale + delta).toFixed(2))));
    const offset = draft.payload.view.offset || { x: 0, y: 0 };

    draft.payload.view.scale = nextScale;

    if (center) {
      const worldX = (center.x - offset.x) / oldScale;
      const worldY = (center.y - offset.y) / oldScale;
      draft.payload.view.offset = {
        x: Math.round(center.x - worldX * nextScale),
        y: Math.round(center.y - worldY * nextScale),
      };
    }

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

onBeforeUnmount(() => {
  chatReferenceImages.value.forEach((image) => {
    if (image.localUrl?.startsWith('blob:')) URL.revokeObjectURL(image.localUrl);
  });
});
</script>

<template>
  <main class="editor">
    <header class="editor-head">
      <div class="head-left">
        <button class="logo logo-link" type="button" @click="router.push('/')">YOUMI</button><span>·</span><b>万能画布</b><span>/</span><button>✎ {{ doc.title }}</button><em>已保存 · 刚刚</em>
      </div>
      <div class="head-actions">
        <button>↶</button><button>↷</button><button @click="zoom(-0.08)">−</button><strong>{{ Math.round(viewScale * 100) }}%</strong><button @click="zoom(0.08)">＋</button><button @click="router.push('/canvas')">×</button>
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
        <button>ⓘ 帮助</button>
        <button>⌘ 快捷键</button>
      </div>

      <div
        :class="['stage', { 'hand-tool': activeTool === 'hand', 'is-panning': panState }]"
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
            <button>✂ 智能抠图</button><button>◈ 智能分层</button><button>T 编辑文字</button><button>↔ 扩图</button><button>☏ 对话修改</button><button>▧ 尺寸修改</button><button>⌗ 裁剪</button><button>✂ 分割</button><button>⇩ 下载</button><button @click.stop="removeLayer(layer.id)">⌫ 删除</button>
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
      </div>

      <nav class="bottom-tools uc-sidebar-tools uc-floating uc-floating-toolbar" :style="toolbarStyle" aria-label="画布工具栏" @pointerdown.stop>
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
        <div
          class="uc-floating-drag-grip uc-floating-drag-grip--right"
          title="拖动工具栏"
          @pointerdown.stop="startToolbarDrag"
          @pointermove.stop="moveToolbar"
          @pointerup.stop="stopToolbarDrag"
          @pointercancel.stop="stopToolbarDrag"
        >
          <i class="ri-drag-move-2-fill" aria-hidden="true"></i>
        </div>
      </nav>

      <aside class="right-panel uc-left uc-rightpanel uc-floating uc-floating-panel" :style="{ width: `${panel.width}px`, ...(panel.x === null ? {} : { left: `${panel.x}px`, top: `${panel.y}px`, right: 'auto' }) }">
        <div class="panel-resize-handle" title="调节对话窗口宽度" @pointerdown="startPanelResize" @pointermove="resizePanel" @pointerup="stopPanelResize" @pointercancel="stopPanelResize" />
        <header class="uc-left-tabs uc-floating-drag-handle">
          <button class="uc-left-tab" :class="{ active: rightTab === 'chat' }" @click="rightTab = 'chat'">
            <i class="ri-chat-3-line" aria-hidden="true"></i><span>对话窗口</span>
          </button>
          <button class="uc-left-tab" :class="{ active: rightTab === 'layers' }" @click="rightTab = 'layers'">
            <i class="ri-stack-line" aria-hidden="true"></i><span>图层窗口</span>
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
                <textarea v-model="chatText" placeholder="描述你想生成的图片，或选中画布图片描述修改..." @keydown.ctrl.enter.prevent="sendChat" />
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
              <footer class="uc-bottom-toolbar"><span>⌘ Ctrl/⌘ + Enter 发送</span><button :disabled="!chatText.trim() || chatGenerating" @click="sendChat"><i class="ri-send-plane-fill" aria-hidden="true"></i>{{ chatGenerating ? '生成中' : '发送' }}</button></footer>
            </div>
          </div>
        </section>

        <section v-else class="layers-panel">
          <h3>图层 <b>{{ layers.length }}</b></h3>
          <button v-for="(layer, index) in [...layers].reverse()" :key="layer.id" :class="{ active: selectedLayerIds.includes(layer.id) }" @click="selectedLayerId = layer.id; selectedLayerIds = [layer.id]">
            <span>◉</span><img v-if="layer.thumbnailUrl" :src="layer.thumbnailUrl" alt="" /><i v-else class="ri-ai-generate-2-line" aria-hidden="true"></i><strong>{{ layerName(layers.findIndex((item) => item.id === layer.id)) }}</strong><small>{{ Math.round(layer.width) }} x {{ Math.round(layer.height) }}</small><em>▣</em>
          </button>
        </section>
      </aside>
    </section>
  </main>
</template>
