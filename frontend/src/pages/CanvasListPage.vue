<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useCanvasStore } from '../stores/canvas';
import { useUserStore } from '../stores/user';
import { useTheme } from '../composables/useTheme';
import { apiPath } from '../utils/apiBase';
import { createStoredZip } from '../utils/storedZip';

const router = useRouter();
const canvas = useCanvasStore();
const userStore = useUserStore();
const { cycle: cycleTheme, isDark } = useTheme();

const query = ref('');
const sortOpen = ref(false);
const sortBy = ref('updated');
const compactView = ref(false);
const editingTitleId = ref(null);
const editingTitleText = ref('');
const downloadingDocId = ref('');
const downloadProgress = ref('');
const deleteTarget = ref(null);
const deleting = ref(false);
const toast = ref({ visible: false, type: 'success', message: '' });
let toastTimer = null;

const sortOptions = [
  { value: 'updated', label: '最近修改', icon: 'ri-time-line' },
  { value: 'created', label: '最近创建', icon: 'ri-add-box-line' },
  { value: 'opened', label: '最近打开', icon: 'ri-history-line' },
  { value: 'title', label: '标题名称', icon: 'ri-sort-alphabet-asc' },
];

const activeSort = computed(
  () => sortOptions.find((option) => option.value === sortBy.value) || sortOptions[0],
);

function toTimestamp(value) {
  if (typeof value === 'number') return value;
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function layerCount(doc) {
  return Array.isArray(doc?.payload?.layers) ? doc.payload.layers.length : 0;
}

function isRealImageLayer(layer) {
  if (!layer?.url) return false;
  return !['placeholder', 'text', 'image-placeholder', 'video'].includes(layer.type);
}

function downloadableLayers(doc) {
  return (doc?.payload?.layers || []).filter(isRealImageLayer);
}

function imageCount(doc) {
  return downloadableLayers(doc).length;
}

const documents = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase('zh-CN');
  const list = canvas.documents.filter((doc) => {
    if (!keyword) return true;
    return String(doc.title || '')
      .toLocaleLowerCase('zh-CN')
      .includes(keyword);
  });
  const sorted = [...list];
  if (sortBy.value === 'title') {
    return sorted.sort((left, right) =>
      String(left.title || '').localeCompare(String(right.title || ''), 'zh-CN'),
    );
  }
  if (sortBy.value === 'created') {
    return sorted.sort((left, right) => toTimestamp(right.createdAt) - toTimestamp(left.createdAt));
  }
  if (sortBy.value === 'opened') {
    return sorted.sort(
      (left, right) => toTimestamp(right.lastOpenedAt) - toTimestamp(left.lastOpenedAt),
    );
  }
  return sorted.sort((left, right) => toTimestamp(right.updatedAt) - toTimestamp(left.updatedAt));
});

function createDocument() {
  if (!userStore.requireLogin()) return;
  const doc = canvas.createDocument();
  router.push(`/canvas/${doc.id}`);
}

function openDocument(id) {
  if (!userStore.requireLogin()) return;
  canvas.markOpened(id);
  router.push(`/canvas/${id}`);
}

function requestRemoveDocument(doc) {
  if (!userStore.requireLogin()) return;
  deleteTarget.value = doc;
}

async function confirmRemoveDocument() {
  if (!deleteTarget.value || deleting.value) return;
  deleting.value = true;
  const title = deleteTarget.value.title;
  try {
    await canvas.removeDocumentAsync(deleteTarget.value.id);
    deleteTarget.value = null;
    showToast(`“${title}”已删除`);
  } catch (error) {
    showToast(error?.message || '删除失败，请重试', 'error');
  } finally {
    deleting.value = false;
  }
}

function startEditTitle(doc) {
  editingTitleId.value = doc.id;
  editingTitleText.value = doc.title;
  nextTick(() => {
    const input = document.querySelector('.document-card.is-editing .card-title-input');
    input?.focus();
    input?.select();
  });
}

function saveTitle(doc) {
  const trimmed = editingTitleText.value.trim();
  if (trimmed && trimmed !== doc.title) {
    doc.title = trimmed;
    doc.updatedAt = Date.now();
    void canvas.syncTitleNow(doc);
    showToast('画布名称已更新');
  }
  editingTitleId.value = null;
}

function cancelEditTitle() {
  editingTitleId.value = null;
}

function onTitleKeydown(event, doc) {
  if (event.key === 'Enter') {
    event.preventDefault();
    saveTitle(doc);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    cancelEditTitle();
  }
}

function selectSort(value) {
  sortBy.value = value;
  sortOpen.value = false;
}

function formatRelativeTime(value) {
  const timestamp = toTimestamp(value);
  if (!timestamp) return '刚刚';
  const delta = Math.max(0, Date.now() - timestamp);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < minute) return '刚刚';
  if (delta < hour) return `${Math.floor(delta / minute)} 分钟前`;
  if (delta < day) return `${Math.floor(delta / hour)} 小时前`;
  if (delta < 7 * day) return `${Math.floor(delta / day)} 天前`;
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(
    timestamp,
  );
}

function formatAbsoluteTime(value) {
  const timestamp = toTimestamp(value);
  if (!timestamp) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(timestamp);
}

function imageExtension(url, contentType) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('png')) return '.png';
  if (type.includes('jpeg') || type.includes('jpg')) return '.jpg';
  if (type.includes('webp')) return '.webp';
  if (type.includes('gif')) return '.gif';
  if (type.includes('avif')) return '.avif';
  const match = String(url || '')
    .split('?')[0]
    .match(/\.(png|jpe?g|webp|gif|avif)$/i);
  return match ? `.${match[1].toLowerCase().replace('jpeg', 'jpg')}` : '.png';
}

function safeDownloadName(value, fallback) {
  const cleaned = [...String(value || '')]
    .map((character) => (character.charCodeAt(0) < 32 ? '_' : character))
    .join('')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .replace(/[. ]+$/g, '');
  return cleaned || fallback;
}

function uniqueZipFileName(baseName, extension, usedNames) {
  let candidate = `${baseName}${extension}`;
  let suffix = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${baseName}-${suffix}${extension}`;
    suffix += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

async function fetchImageForZip(layer, index) {
  const url = String(layer.url || '');
  const isCrossOrigin = /^https?:/i.test(url) && !url.startsWith(location.origin);
  const requestUrl = isCrossOrigin
    ? apiPath(`/api/image-tasks/proxy-download?url=${encodeURIComponent(url)}`)
    : url;
  const response = await fetch(requestUrl, {
    headers: isCrossOrigin ? { ...userStore.authHeaders() } : undefined,
  });
  if (!response.ok) {
    throw new Error(`${layer.name || `第 ${index + 1} 张图片`}下载失败`);
  }
  const blob = await response.blob();
  const extension = imageExtension(url, blob.type);
  const rawName = safeDownloadName(layer.name, `图片-${String(index + 1).padStart(2, '0')}`);
  return {
    baseName: rawName.replace(/\.(png|jpe?g|webp|gif|avif)$/i, ''),
    extension,
    data: new Uint8Array(await blob.arrayBuffer()),
  };
}

async function downloadCanvas(doc) {
  if (downloadingDocId.value) return;
  const layers = downloadableLayers(doc);
  if (!layers.length) {
    showToast('这个画布里没有可下载的图片', 'error');
    return;
  }

  downloadingDocId.value = doc.id;
  const files = [];
  const usedNames = new Set();
  try {
    for (let index = 0; index < layers.length; index += 1) {
      downloadProgress.value = `正在准备 ${index + 1}/${layers.length}`;
      const image = await fetchImageForZip(layers[index], index);
      files.push({
        name: uniqueZipFileName(image.baseName, image.extension, usedNames),
        data: image.data,
      });
    }
    downloadProgress.value = '正在生成 ZIP';
    const blobUrl = URL.createObjectURL(createStoredZip(files));
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `${safeDownloadName(doc.title, '有米画布')}-${layers.length}张.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    showToast(`已打包下载 ${layers.length} 张图片`);
  } catch (error) {
    console.error('[canvas-list-download] error:', error);
    showToast(error?.message || '图片打包失败，请重试', 'error');
  } finally {
    downloadingDocId.value = '';
    downloadProgress.value = '';
  }
}

function showToast(message, type = 'success') {
  if (toastTimer) window.clearTimeout(toastTimer);
  toast.value = { visible: true, type, message };
  toastTimer = window.setTimeout(() => {
    toast.value.visible = false;
  }, 2600);
}

function handleDocumentClick() {
  sortOpen.value = false;
}

function handleKeydown(event) {
  if (event.key !== 'Escape') return;
  sortOpen.value = false;
  deleteTarget.value = null;
  cancelEditTitle();
}

onMounted(async () => {
  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('keydown', handleKeydown);
  if (!canvas.serverSynced) await canvas.syncFromServer();
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick);
  document.removeEventListener('keydown', handleKeydown);
  if (toastTimer) window.clearTimeout(toastTimer);
});
</script>

<template>
  <main class="canvas-list">
    <header class="library-head">
      <button class="icon-command back-command" type="button" @click="router.push('/')">
        <i class="ri-arrow-left-line" aria-hidden="true"></i>
        <span>返回首页</span>
      </button>

      <div class="library-title">
        <div>
          <h1>我的画布</h1>
          <p>集中管理你的创作项目</p>
        </div>
        <div class="library-status">
          <span><i class="ri-layout-grid-line" aria-hidden="true"></i>{{ canvas.documents.length }} 个</span>
          <span><i class="ri-cloud-line" aria-hidden="true"></i>已开启云端保存</span>
        </div>
      </div>

      <div class="header-actions">
        <button
          class="theme-command"
          type="button"
          :title="isDark() ? '开灯（切换到浅色）' : '关灯（切换到深色）'"
          :aria-label="isDark() ? '开灯（切换到浅色）' : '关灯（切换到深色）'"
          @click="cycleTheme"
        >
          <i :class="isDark() ? 'ri-sun-line' : 'ri-moon-line'" aria-hidden="true"></i>
          <span>{{ isDark() ? '开灯' : '关灯' }}</span>
        </button>
        <button class="create-command" type="button" @click="createDocument">
          <i class="ri-add-line" aria-hidden="true"></i>
          <span>新建画布</span>
        </button>
      </div>
    </header>

    <section class="library-toolbar" aria-label="画布筛选工具">
      <label class="library-search">
        <i class="ri-search-line" aria-hidden="true"></i>
        <input v-model="query" type="search" placeholder="搜索画布标题" />
        <button
          v-if="query"
          type="button"
          title="清空搜索"
          aria-label="清空搜索"
          @click="query = ''"
        >
          <i class="ri-close-line" aria-hidden="true"></i>
        </button>
      </label>

      <span class="result-count">
        {{ query ? `${documents.length} 个结果` : `共 ${documents.length} 个画布` }}
      </span>

      <div class="toolbar-actions">
        <div class="sort-control" @click.stop>
          <button
            class="sort-trigger"
            type="button"
            :aria-expanded="sortOpen"
            @click="sortOpen = !sortOpen"
          >
            <i :class="activeSort.icon" aria-hidden="true"></i>
            <span>{{ activeSort.label }}</span>
            <i class="ri-arrow-down-s-line sort-arrow" aria-hidden="true"></i>
          </button>
          <div v-if="sortOpen" class="sort-menu">
            <button
              v-for="option in sortOptions"
              :key="option.value"
              type="button"
              :class="{ active: option.value === sortBy }"
              @click="selectSort(option.value)"
            >
              <i :class="option.icon" aria-hidden="true"></i>
              <span>{{ option.label }}</span>
              <i
                v-if="option.value === sortBy"
                class="ri-check-line check-icon"
                aria-hidden="true"
              ></i>
            </button>
          </div>
        </div>

        <div class="view-control" aria-label="画布排列">
          <button
            type="button"
            title="标准视图"
            aria-label="标准视图"
            :class="{ active: !compactView }"
            @click="compactView = false"
          >
            <i class="ri-layout-grid-line" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            title="紧凑视图"
            aria-label="紧凑视图"
            :class="{ active: compactView }"
            @click="compactView = true"
          >
            <i class="ri-grid-line" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    </section>

    <section
      v-if="documents.length"
      class="document-grid"
      :class="{ 'is-compact': compactView }"
    >
      <article
        v-for="doc in documents"
        :key="doc.id"
        class="document-card"
        :class="{ 'is-editing': editingTitleId === doc.id }"
        @dblclick="openDocument(doc.id)"
      >
        <button
          class="document-preview"
          type="button"
          :aria-label="`打开画布：${doc.title}`"
          @click="openDocument(doc.id)"
        >
          <img v-if="doc.thumbnailUrl" :src="doc.thumbnailUrl" alt="" loading="lazy" />
          <span v-else class="empty-preview">
            <i class="ri-image-line" aria-hidden="true"></i>
          </span>
          <span v-if="doc.meta?.editing" class="editing-badge">编辑中</span>
          <span class="image-count-badge">
            <i class="ri-image-2-line" aria-hidden="true"></i>
            {{ imageCount(doc) }}
          </span>
          <span class="open-overlay">
            <i class="ri-arrow-right-up-line" aria-hidden="true"></i>
            打开画布
          </span>
        </button>

        <footer class="document-info">
          <div class="document-title-row">
            <input
              v-if="editingTitleId === doc.id"
              v-model="editingTitleText"
              class="card-title-input"
              @blur="saveTitle(doc)"
              @keydown="onTitleKeydown($event, doc)"
              @click.stop
              @dblclick.stop
            />
            <strong v-else :title="doc.title">{{ doc.title }}</strong>
            <button
              v-if="editingTitleId !== doc.id"
              class="title-action"
              type="button"
              title="重命名"
              aria-label="重命名画布"
              @click.stop="startEditTitle(doc)"
            >
              <i class="ri-edit-line" aria-hidden="true"></i>
            </button>
          </div>

          <div class="document-meta">
            <span><i class="ri-stack-line" aria-hidden="true"></i>{{ layerCount(doc) }} 图层</span>
            <span class="meta-dot" aria-hidden="true"></span>
            <time :datetime="new Date(toTimestamp(doc.updatedAt)).toISOString()" :title="formatAbsoluteTime(doc.updatedAt)">
              {{ formatRelativeTime(doc.updatedAt) }}
            </time>
          </div>

          <div class="document-actions">
            <button
              class="download-command"
              type="button"
              :disabled="!imageCount(doc) || Boolean(downloadingDocId)"
              :title="imageCount(doc) ? `打包下载 ${imageCount(doc)} 张图片` : '没有可下载的图片'"
              @click.stop="downloadCanvas(doc)"
            >
              <i
                :class="downloadingDocId === doc.id ? 'ri-loader-4-line is-spinning' : 'ri-file-zip-line'"
                aria-hidden="true"
              ></i>
              <span>
                {{ downloadingDocId === doc.id ? downloadProgress : '打包下载' }}
              </span>
            </button>
            <button
              class="delete-command"
              type="button"
              title="删除画布"
              aria-label="删除画布"
              @click.stop="requestRemoveDocument(doc)"
            >
              <i class="ri-delete-bin-6-line" aria-hidden="true"></i>
            </button>
          </div>
        </footer>
      </article>
    </section>

    <section v-else class="empty-library">
      <span><i :class="query ? 'ri-search-eye-line' : 'ri-layout-grid-line'" aria-hidden="true"></i></span>
      <h2>{{ query ? '没有匹配的画布' : '还没有画布' }}</h2>
      <p>{{ query ? '换一个关键词试试' : '新建一个空白画布开始创作' }}</p>
      <button v-if="query" type="button" @click="query = ''">清空搜索</button>
      <button v-else type="button" @click="createDocument">
        <i class="ri-add-line" aria-hidden="true"></i>新建画布
      </button>
    </section>

    <div
      v-if="deleteTarget"
      class="dialog-backdrop"
      role="presentation"
      @click.self="deleteTarget = null"
    >
      <section
        class="delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
      >
        <span class="dialog-icon"><i class="ri-delete-bin-6-line" aria-hidden="true"></i></span>
        <div>
          <h2 id="delete-dialog-title">删除这个画布？</h2>
          <p>“{{ deleteTarget.title }}”删除后无法恢复。</p>
        </div>
        <footer>
          <button type="button" :disabled="deleting" @click="deleteTarget = null">取消</button>
          <button class="danger" type="button" :disabled="deleting" @click="confirmRemoveDocument">
            {{ deleting ? '正在删除' : '确认删除' }}
          </button>
        </footer>
      </section>
    </div>

    <Transition name="toast">
      <div v-if="toast.visible" class="library-toast" :class="`is-${toast.type}`" role="status">
        <i
          :class="toast.type === 'error' ? 'ri-error-warning-line' : 'ri-checkbox-circle-line'"
          aria-hidden="true"
        ></i>
        {{ toast.message }}
      </div>
    </Transition>
  </main>
</template>

<style scoped>
main.canvas-list {
  min-height: 100vh;
  padding: 28px clamp(20px, 3.5vw, 64px) 72px;
  color: var(--canvas-text);
  background: var(--canvas-workspace);
  transition:
    color 180ms ease,
    background-color 180ms ease;
}

.library-head {
  display: grid;
  grid-template-columns: minmax(150px, 1fr) auto minmax(150px, 1fr);
  align-items: center;
  gap: 24px;
  min-height: 64px;
}

.icon-command,
.theme-command,
.create-command,
.sort-trigger,
.view-control button,
.title-action,
.download-command,
.delete-command,
.empty-library button,
.delete-dialog button {
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  color: var(--canvas-text);
  background: var(--canvas-panel);
  transition:
    color 150ms ease,
    border-color 150ms ease,
    background-color 150ms ease,
    opacity 150ms ease;
}

.icon-command,
.theme-command,
.create-command {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 40px;
  padding: 0 14px;
  font-size: 14px;
  font-weight: 600;
}

.back-command {
  justify-self: start;
}

.icon-command:hover,
.theme-command:hover {
  border-color: var(--canvas-border-strong);
  background: var(--canvas-surface-hover);
}

.header-actions {
  display: flex;
  align-items: center;
  justify-self: end;
  gap: 8px;
}

.theme-command {
  color: var(--canvas-text-muted);
}

.theme-command i {
  color: var(--canvas-accent);
  font-size: 17px;
}

.library-title {
  display: flex;
  align-items: center;
  gap: 20px;
}

.library-title h1 {
  margin: 0;
  color: var(--canvas-text);
  font-size: 24px;
  line-height: 1.2;
  font-weight: 600;
  letter-spacing: 0;
}

.library-title p {
  margin: 5px 0 0;
  color: var(--canvas-text-subtle);
  font-size: 13px;
}

.library-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 20px;
  border-left: 1px solid var(--canvas-border);
}

.library-status span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 9px;
  border: 1px solid var(--canvas-border);
  border-radius: 999px;
  color: var(--canvas-text-muted);
  background: var(--canvas-surface);
  font-size: 12px;
  white-space: nowrap;
}

.library-status i {
  color: var(--canvas-accent);
  font-size: 14px;
}

.create-command {
  color: #fff;
  border-color: var(--canvas-accent);
  background: var(--canvas-accent);
  box-shadow: 0 8px 20px var(--canvas-accent-soft);
}

.create-command:hover {
  border-color: var(--canvas-accent-hover);
  background: var(--canvas-accent-hover);
}

.create-command i {
  font-size: 18px;
}

.library-toolbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 66px;
  margin: 22px 0 20px;
  padding: 10px 0;
  background: color-mix(in srgb, var(--canvas-workspace) 92%, transparent);
  backdrop-filter: blur(12px);
}

.library-search {
  display: flex;
  align-items: center;
  gap: 9px;
  width: min(420px, 38vw);
  height: 40px;
  padding: 0 11px;
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  color: var(--canvas-text-subtle);
  background: var(--canvas-panel);
}

.library-search:focus-within {
  border-color: var(--canvas-accent-border);
  box-shadow: 0 0 0 3px var(--canvas-accent-soft);
}

.library-search > i {
  font-size: 17px;
}

.library-search input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  color: var(--canvas-text);
  background: transparent;
  font-size: 14px;
}

.library-search input::placeholder {
  color: var(--canvas-text-subtle);
}

.library-search button {
  display: grid;
  width: 24px;
  height: 24px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 4px;
  color: var(--canvas-text-subtle);
  background: transparent;
}

.library-search button:hover {
  color: var(--canvas-text);
  background: var(--canvas-surface-hover);
}

.result-count {
  color: var(--canvas-text-subtle);
  font-size: 13px;
  white-space: nowrap;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}

.sort-control {
  position: relative;
}

.sort-trigger {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 132px;
  height: 40px;
  padding: 0 10px;
  font-size: 13px;
}

.sort-trigger:hover {
  border-color: var(--canvas-border-strong);
  background: var(--canvas-surface-hover);
}

.sort-trigger > i:first-child {
  color: var(--canvas-accent);
  font-size: 16px;
}

.sort-trigger span {
  flex: 1;
  text-align: left;
}

.sort-arrow {
  color: var(--canvas-text-subtle);
  font-size: 16px;
}

.sort-menu {
  position: absolute;
  top: 46px;
  right: 0;
  z-index: 30;
  width: 176px;
  padding: 5px;
  border: 1px solid var(--canvas-border);
  border-radius: 7px;
  background: var(--canvas-panel);
  box-shadow: var(--canvas-panel-shadow);
}

.sort-menu button {
  display: grid;
  grid-template-columns: 20px 1fr 18px;
  align-items: center;
  gap: 7px;
  width: 100%;
  height: 36px;
  padding: 0 9px;
  border: 0;
  border-radius: 5px;
  color: var(--canvas-text-muted);
  background: transparent;
  font-size: 13px;
  text-align: left;
}

.sort-menu button:hover {
  color: var(--canvas-text);
  background: var(--canvas-surface-hover);
}

.sort-menu button.active {
  color: var(--canvas-accent);
  background: var(--canvas-accent-soft);
}

.check-icon {
  justify-self: end;
}

.view-control {
  display: grid;
  grid-template-columns: repeat(2, 34px);
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--canvas-border);
  border-radius: 7px;
  background: var(--canvas-panel);
}

.view-control button {
  display: grid;
  width: 34px;
  height: 32px;
  padding: 0;
  place-items: center;
  border: 0;
  background: transparent;
  font-size: 16px;
}

.view-control button:hover {
  background: var(--canvas-surface-hover);
}

.view-control button.active {
  color: var(--canvas-accent);
  background: var(--canvas-accent-soft);
}

.document-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(264px, 1fr));
  gap: 18px;
  align-items: start;
}

.document-grid.is-compact {
  grid-template-columns: repeat(auto-fill, minmax(218px, 1fr));
  gap: 12px;
}

.document-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--canvas-border);
  border-radius: 8px;
  background: var(--canvas-panel);
  box-shadow: none;
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease,
    transform 150ms ease;
}

.document-card:hover {
  border-color: var(--canvas-accent-border);
  box-shadow: var(--canvas-panel-shadow);
  transform: translateY(-2px);
}

.document-preview {
  position: relative;
  display: grid;
  width: 100%;
  aspect-ratio: 4 / 3;
  padding: 0;
  place-items: center;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  color: var(--canvas-text-subtle);
  background: var(--canvas-surface);
}

.document-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 180ms ease;
}

.document-card:hover .document-preview img {
  transform: scale(1.015);
}

.empty-preview {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border: 1px solid var(--canvas-border-strong);
  border-radius: 8px;
  color: var(--canvas-text-subtle);
  background: var(--canvas-panel);
  font-size: 23px;
}

.editing-badge,
.image-count-badge {
  position: absolute;
  top: 10px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border-radius: 5px;
  color: #fff;
  background: rgba(19, 25, 36, 0.82);
  backdrop-filter: blur(8px);
  font-size: 11px;
  font-weight: 600;
}

.editing-badge {
  left: 10px;
  color: #071a14;
  background: #6ee7b7;
}

.image-count-badge {
  right: 10px;
}

.open-overlay {
  position: absolute;
  inset: auto 10px 10px auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 10px;
  border-radius: 5px;
  color: #fff;
  background: rgba(19, 25, 36, 0.84);
  opacity: 0;
  transform: translateY(4px);
  transition:
    opacity 150ms ease,
    transform 150ms ease;
  font-size: 12px;
  font-weight: 600;
}

.document-card:hover .open-overlay,
.document-preview:focus-visible .open-overlay {
  opacity: 1;
  transform: translateY(0);
}

.document-info {
  display: grid;
  gap: 10px;
  padding: 13px;
}

.document-title-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 28px;
  align-items: center;
  gap: 6px;
  min-height: 28px;
}

.document-title-row strong {
  overflow: hidden;
  color: var(--canvas-text);
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-title-input {
  width: 100%;
  height: 28px;
  padding: 0 7px;
  border: 1px solid var(--canvas-accent);
  border-radius: 5px;
  outline: none;
  color: var(--canvas-text);
  background: var(--canvas-input);
  font-size: 14px;
  font-weight: 600;
}

.title-action,
.delete-command {
  display: grid;
  width: 28px;
  height: 28px;
  padding: 0;
  place-items: center;
  color: var(--canvas-text-subtle);
  background: transparent;
  border-color: transparent;
  font-size: 15px;
}

.title-action:hover {
  color: var(--canvas-text);
  border-color: var(--canvas-border);
  background: var(--canvas-surface-hover);
}

.document-meta {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  color: var(--canvas-text-subtle);
  font-size: 12px;
}

.document-meta span:first-child {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.document-meta i {
  font-size: 14px;
}

.meta-dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--canvas-text-subtle);
}

.document-meta time {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.document-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 32px;
  gap: 7px;
  padding-top: 2px;
}

.download-command {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 32px;
  min-width: 0;
  padding: 0 10px;
  color: var(--canvas-text-muted);
  font-size: 12px;
  font-weight: 600;
}

.download-command span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.download-command:hover:not(:disabled) {
  color: var(--canvas-accent);
  border-color: var(--canvas-accent-border);
  background: var(--canvas-accent-soft);
}

.download-command:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.delete-command {
  width: 32px;
  height: 32px;
}

.delete-command:hover {
  color: #ef6464;
  border-color: rgba(239, 100, 100, 0.35);
  background: rgba(239, 100, 100, 0.1);
}

.is-spinning {
  animation: library-spin 800ms linear infinite;
}

@keyframes library-spin {
  to {
    transform: rotate(360deg);
  }
}

.document-grid.is-compact .document-info {
  gap: 8px;
  padding: 11px;
}

.document-grid.is-compact .open-overlay {
  display: none;
}

.empty-library {
  display: grid;
  min-height: 360px;
  place-items: center;
  align-content: center;
  gap: 9px;
  border: 1px dashed var(--canvas-border-strong);
  border-radius: 8px;
  color: var(--canvas-text-muted);
  background: var(--canvas-panel);
  text-align: center;
}

.empty-library > span {
  display: grid;
  width: 58px;
  height: 58px;
  margin-bottom: 5px;
  place-items: center;
  border: 1px solid var(--canvas-border);
  border-radius: 8px;
  color: var(--canvas-accent);
  background: var(--canvas-accent-soft);
  font-size: 27px;
}

.empty-library h2 {
  margin: 0;
  color: var(--canvas-text);
  font-size: 17px;
}

.empty-library p {
  margin: 0 0 8px;
  color: var(--canvas-text-subtle);
  font-size: 13px;
}

.empty-library button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 13px;
  color: #fff;
  border-color: var(--canvas-accent);
  background: var(--canvas-accent);
  font-weight: 600;
}

.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  padding: 20px;
  place-items: center;
  background: rgba(4, 8, 15, 0.56);
  backdrop-filter: blur(4px);
}

.delete-dialog {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 14px;
  width: min(420px, 100%);
  padding: 20px;
  border: 1px solid var(--canvas-border-strong);
  border-radius: 8px;
  color: var(--canvas-text);
  background: var(--canvas-panel);
  box-shadow: var(--canvas-panel-shadow);
}

.dialog-icon {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 7px;
  color: #ef6464;
  background: rgba(239, 100, 100, 0.12);
  font-size: 20px;
}

.delete-dialog h2 {
  margin: 1px 0 6px;
  font-size: 17px;
}

.delete-dialog p {
  margin: 0;
  color: var(--canvas-text-muted);
  font-size: 13px;
  line-height: 1.6;
}

.delete-dialog footer {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 5px;
}

.delete-dialog button {
  height: 36px;
  padding: 0 14px;
  font-weight: 600;
}

.delete-dialog button:hover:not(:disabled) {
  border-color: var(--canvas-border-strong);
  background: var(--canvas-surface-hover);
}

.delete-dialog button.danger {
  color: #fff;
  border-color: #dc4c4c;
  background: #dc4c4c;
}

.delete-dialog button.danger:hover:not(:disabled) {
  border-color: #c83e3e;
  background: #c83e3e;
}

.library-toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  z-index: 120;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: min(520px, calc(100vw - 32px));
  min-height: 40px;
  padding: 8px 14px;
  border: 1px solid var(--canvas-border-strong);
  border-radius: 7px;
  color: var(--canvas-text);
  background: var(--canvas-panel);
  box-shadow: var(--canvas-panel-shadow);
  transform: translateX(-50%);
  font-size: 13px;
}

.library-toast i {
  color: #39c894;
  font-size: 17px;
}

.library-toast.is-error i {
  color: #ef6464;
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 150ms ease,
    transform 150ms ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}

@media (max-width: 900px) {
  main.canvas-list {
    padding: 18px 16px 48px;
  }

  .library-head {
    grid-template-columns: 40px minmax(0, 1fr) auto;
    gap: 10px;
  }

  .back-command {
    width: 40px;
    padding: 0;
  }

  .back-command span,
  .library-title p,
  .library-status {
    display: none;
  }

  .library-title {
    display: block;
  }

  .library-title h1 {
    font-size: 20px;
  }

  .create-command {
    padding: 0 11px;
  }

  .library-toolbar {
    position: static;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 9px;
    margin-top: 14px;
    background: transparent;
    backdrop-filter: none;
  }

  .library-search {
    grid-column: 1 / -1;
    width: 100%;
  }

  .result-count {
    padding-left: 2px;
  }

  .document-grid,
  .document-grid.is-compact {
    grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr));
  }

}

@media (max-width: 520px) {
  .theme-command span,
  .create-command span {
    display: none;
  }

  .theme-command,
  .create-command {
    width: 40px;
    padding: 0;
  }

  .sort-trigger {
    min-width: 40px;
    width: 40px;
  }

  .sort-trigger span,
  .sort-arrow {
    display: none;
  }

  .document-grid,
  .document-grid.is-compact {
    grid-template-columns: 1fr;
  }

  .document-preview {
    aspect-ratio: 16 / 10;
  }
}
</style>
