<template>
  <div class="image-file-actions" :class="{ 'image-file-actions--toolbar': variant === 'toolbar' }">
    <button v-if="showPreview" type="button" :disabled="!url" @click.stop="previewImage">
      <span aria-hidden="true">◎</span>
      {{ previewText }}
    </button>
    <button v-if="showDownload" type="button" :disabled="!url || downloading" @click.stop="downloadImage">
      <span aria-hidden="true">⇩</span>
      {{ downloading ? '下载中' : downloadText }}
    </button>
    <button v-if="showCopy" type="button" :disabled="!url" @click.stop="copyUrl">
      <span aria-hidden="true">⧉</span>
      {{ copied ? '已复制' : copyText }}
    </button>
  </div>
</template>

<script setup>
import { ref } from 'vue';

const props = defineProps({
  url: { type: String, default: '' },
  fileName: { type: String, default: '' },
  proxyDownloadEndpoint: { type: String, default: '/api/v1/file/proxy-download' },
  previewText: { type: String, default: '预览' },
  downloadText: { type: String, default: '下载' },
  copyText: { type: String, default: '复制链接' },
  showPreview: { type: Boolean, default: true },
  showDownload: { type: Boolean, default: true },
  showCopy: { type: Boolean, default: false },
  variant: {
    type: String,
    default: 'default',
    validator: (value) => ['default', 'toolbar'].includes(value),
  },
});

const emit = defineEmits(['preview', 'download', 'copy', 'error']);

const downloading = ref(false);
const copied = ref(false);

function previewImage() {
  if (!props.url) return;
  window.open(props.url, '_blank', 'noopener,noreferrer');
  emit('preview', props.url);
}

async function downloadImage() {
  if (!props.url || downloading.value) return;
  downloading.value = true;

  try {
    const downloadUrl = props.proxyDownloadEndpoint
      ? `${props.proxyDownloadEndpoint}?url=${encodeURIComponent(props.url)}`
      : props.url;
    const fileName = props.fileName || resolveFileName(props.url);

    const response = await fetch(downloadUrl, { mode: 'cors' });
    if (!response.ok) {
      throw new Error(`下载失败：${response.status}`);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    emit('download', { url: props.url, fileName });
  } catch (error) {
    openFallbackDownload(props.url);
    emit('error', error);
  } finally {
    downloading.value = false;
  }
}

async function copyUrl() {
  if (!props.url) return;

  try {
    await navigator.clipboard.writeText(props.url);
    copied.value = true;
    emit('copy', props.url);
    window.setTimeout(() => {
      copied.value = false;
    }, 1200);
  } catch (error) {
    emit('error', error);
  }
}

function resolveFileName(url) {
  try {
    const parsed = new URL(url);
    const name = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
    return name || `image-${Date.now()}.png`;
  } catch {
    return `image-${Date.now()}.png`;
  }
}

function openFallbackDownload(url) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.download = props.fileName || resolveFileName(url);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
</script>

<style scoped>
.image-file-actions {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.image-file-actions button {
  display: inline-flex;
  height: 32px;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(148, 163, 184, 0.45);
  border-radius: 6px;
  padding: 0 10px;
  background: rgba(15, 23, 42, 0.04);
  color: #111827;
  font-size: 13px;
  cursor: pointer;
}

.image-file-actions button:hover:not(:disabled) {
  border-color: #3b82f6;
  color: #2563eb;
}

.image-file-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.image-file-actions--toolbar {
  display: contents;
}

.image-file-actions--toolbar button {
  height: auto;
  min-height: 0;
  border: 0;
  border-radius: 0;
  padding: 0;
  background: transparent;
  box-shadow: none;
  color: inherit;
  font: inherit;
}

.image-file-actions--toolbar button:hover:not(:disabled) {
  border-color: transparent;
  color: inherit;
}
</style>
