<script setup>
import { computed, onMounted, ref } from 'vue'
import ImageViewer from '../ImageViewer.vue'
import { useUserStore } from '../../stores/user'
import { apiPath } from '../../utils/apiBase'
import { writeTextToClipboard } from '../../utils/clipboard'

const emit = defineEmits(['error', 'success'])
const userStore = useUserStore()
const status = ref(null)
const objects = ref([])
const prefix = ref('')
const marker = ref('')
const nextMarker = ref('')
const markerHistory = ref([])
const search = ref('')
const loading = ref(false)
const uploading = ref(false)
const deletingKey = ref('')
const fileInput = ref(null)
const fromDate = ref('')
const toDate = ref('')
const datePreview = ref(null)
const datePreviewLoading = ref(false)
const dateDeleting = ref(false)
const imageViewer = ref({ open: false, images: [], index: 0 })
const videoViewer = ref({ open: false, url: '', title: '' })

const breadcrumbs = computed(() => {
  const parts = prefix.value.split('/').filter(Boolean)
  return [{ label: '根目录', prefix: '' }, ...parts.map((part, index) => ({
    label: part,
    prefix: `${parts.slice(0, index + 1).join('/')}/`,
  }))]
})
const filteredObjects = computed(() => {
  const keyword = search.value.trim().toLocaleLowerCase()
  if (!keyword) return objects.value
  return objects.value.filter((item) => item.name.toLocaleLowerCase().includes(keyword))
})

async function request(path, options = {}) {
  const response = await fetch(apiPath(path), {
    ...options,
    headers: { ...userStore.authHeaders(), ...(options.headers || {}) },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || payload?.code !== 0) {
    if (response.status === 401) userStore.openLogin()
    throw new Error(payload?.message || `请求失败：${response.status}`)
  }
  return payload.data
}

async function loadStatus() {
  status.value = await request('/api/admin/oss/status')
  if (status.value.configured) await loadObjects()
}

async function loadObjects(options = {}) {
  loading.value = true
  try {
    const params = new URLSearchParams({ prefix: prefix.value, limit: '100' })
    const requestedMarker = options.marker ?? marker.value
    if (requestedMarker) params.set('marker', requestedMarker)
    const data = await request(`/api/admin/oss/objects?${params}`)
    objects.value = data.objects || []
    nextMarker.value = data.truncated ? data.nextMarker || '' : ''
  } catch (error) {
    emit('error', error.message || 'OSS 对象列表加载失败')
  } finally {
    loading.value = false
  }
}

function openFolder(item) {
  markerHistory.value = []
  marker.value = ''
  prefix.value = item.key
  search.value = ''
  datePreview.value = null
  void loadObjects({ marker: '' })
}

function goToBreadcrumb(item) {
  markerHistory.value = []
  marker.value = ''
  prefix.value = item.prefix
  search.value = ''
  datePreview.value = null
  void loadObjects({ marker: '' })
}

async function previewDateDeletion() {
  if (!fromDate.value || !toDate.value) {
    emit('error', '请选择完整的开始和结束日期')
    return
  }
  datePreviewLoading.value = true
  datePreview.value = null
  try {
    datePreview.value = await request('/api/admin/oss/objects/date-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: prefix.value, fromDate: fromDate.value, toDate: toDate.value }),
    })
  } catch (error) {
    emit('error', error.message || 'OSS 日期筛选失败')
  } finally {
    datePreviewLoading.value = false
  }
}

async function deleteDateMatches() {
  const preview = datePreview.value
  if (!preview?.matchedCount) return
  const scope = preview.prefix || '根目录'
  const confirmed = window.confirm(
    `确定删除“${scope}”及子目录中，${preview.fromDate} 至 ${preview.toDate}（含）最后修改的 ${preview.matchedCount} 个对象吗？此操作不可撤销。`,
  )
  if (!confirmed) return
  dateDeleting.value = true
  try {
    const result = await request('/api/admin/oss/objects/delete-by-date', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: prefix.value, fromDate: fromDate.value, toDate: toDate.value }),
    })
    datePreview.value = null
    emit('success', `已删除 ${result.deletedCount || 0} 个 OSS 对象`)
    await loadObjects()
  } catch (error) {
    emit('error', error.message || 'OSS 批量删除失败')
  } finally {
    dateDeleting.value = false
  }
}

function nextPage() {
  if (!nextMarker.value) return
  markerHistory.value.push(marker.value)
  marker.value = nextMarker.value
  void loadObjects()
}

function previousPage() {
  if (!markerHistory.value.length) return
  marker.value = markerHistory.value.pop()
  void loadObjects()
}

function chooseFile() {
  fileInput.value?.click()
}

async function uploadFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  uploading.value = true
  try {
    const form = new FormData()
    form.set('file', file)
    form.set('key', `${prefix.value}${file.name}`)
    await request('/api/admin/oss/objects', { method: 'POST', body: form })
    await loadObjects()
  } catch (error) {
    emit('error', error.message || 'OSS 文件上传失败')
  } finally {
    uploading.value = false
  }
}

async function deleteObject(item) {
  if (!window.confirm(`确定删除 OSS 对象“${item.key}”吗？此操作不可撤销。`)) return
  deletingKey.value = item.key
  try {
    const params = new URLSearchParams({ key: item.key })
    await request(`/api/admin/oss/objects?${params}`, { method: 'DELETE' })
    await loadObjects()
  } catch (error) {
    emit('error', error.message || 'OSS 对象删除失败')
  } finally {
    deletingKey.value = ''
  }
}

async function copyObjectUrl(item) {
  const url = item.url || item.previewUrl
  if (!url) {
    emit('error', '该对象没有可复制的链接地址')
    return
  }
  try {
    await writeTextToClipboard(url)
    emit('success', '链接地址已复制')
  } catch {
    emit('error', '复制链接失败，请检查浏览器剪贴板权限')
  }
}

function formatBytes(bytes) {
  const value = Number(bytes || 0)
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false })
}

function fileExtension(item) {
  if (item.folder) return ''
  const name = item.name || item.key || ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function filePreviewType(item) {
  if (item.folder) return 'folder'
  const extension = fileExtension(item)
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic', 'heif'].includes(extension)) return 'image'
  if (['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi', 'flv', 'ts', 'wmv', 'mpeg', 'mpg'].includes(extension)) return 'video'
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'wma', 'opus'].includes(extension)) return 'audio'
  if (extension === 'pdf') return 'pdf'
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(extension)) return 'archive'
  if (['txt', 'md', 'json', 'xml', 'csv', 'log'].includes(extension)) return 'text'
  return 'file'
}

function previewIcon(item) {
  return {
    folder: 'ri-folder-3-fill',
    audio: 'ri-music-2-fill',
    pdf: 'ri-file-pdf-2-fill',
    archive: 'ri-folder-zip-fill',
    text: 'ri-file-text-fill',
    file: 'ri-file-3-fill',
  }[filePreviewType(item)] || 'ri-file-3-fill'
}

function previewLabel(item) {
  return fileExtension(item).slice(0, 5).toUpperCase() || 'FILE'
}

function openFilePreview(event, item) {
  const type = filePreviewType(item)
  if (type !== 'image' && type !== 'video') return
  event.preventDefault()
  event.stopPropagation()
  if (type === 'video') {
    videoViewer.value = { open: true, url: item.previewUrl, title: item.name }
    return
  }
  const images = filteredObjects.value
    .filter((object) => filePreviewType(object) === 'image' && object.previewUrl)
    .map((object) => ({ url: object.previewUrl, name: object.name }))
  imageViewer.value = {
    open: true,
    images,
    index: images.findIndex((image) => image.name === item.name && image.url === item.previewUrl),
  }
}

function downloadPreviewImage(image) {
  const link = document.createElement('a')
  link.href = image.url
  link.download = image.name
  link.rel = 'noopener'
  link.click()
}

function closeVideoPreview() {
  videoViewer.value = { open: false, url: '', title: '' }
}

function handleVideoPreviewLoaded(event) {
  const video = event.currentTarget
  if (video.duration > 0) video.currentTime = Math.min(0.1, video.duration / 2)
}

onMounted(() => void loadStatus())
</script>

<template>
  <section class="oss-manager console-card">
    <header class="oss-manager-head">
      <div>
        <h2>OSS 对象管理</h2>
        <p v-if="status?.configured">
          {{ status.bucket }} <span>·</span> {{ status.endpoint }}
          <template v-if="status.customDomain"><span>·</span> {{ status.customDomain }}</template>
        </p>
        <p v-else-if="status">OSS 尚未配置完整的访问凭证或 Bucket。</p>
        <p v-else>正在读取存储配置...</p>
      </div>
      <div class="oss-manager-actions">
        <input ref="fileInput" type="file" hidden @change="uploadFile" />
        <button type="button" class="oss-button" :disabled="!status?.configured || uploading" @click="chooseFile">
          <i :class="uploading ? 'ri-loader-4-line oss-spin' : 'ri-upload-2-line'" aria-hidden="true"></i>
          {{ uploading ? '上传中...' : '上传文件' }}
        </button>
        <button type="button" class="oss-icon-button" title="刷新对象列表" :disabled="loading || !status?.configured" @click="loadObjects()">
          <i :class="loading ? 'ri-loader-4-line oss-spin' : 'ri-refresh-line'" aria-hidden="true"></i>
        </button>
      </div>
    </header>

    <div v-if="status?.configured" class="oss-browser-toolbar">
      <nav class="oss-breadcrumbs" aria-label="OSS 目录">
        <template v-for="(item, index) in breadcrumbs" :key="item.prefix">
          <span v-if="index" class="ri-arrow-right-s-line" aria-hidden="true"></span>
          <button type="button" :disabled="index === breadcrumbs.length - 1" @click="goToBreadcrumb(item)">
            {{ item.label }}
          </button>
        </template>
      </nav>
      <label class="oss-search">
        <i class="ri-search-line" aria-hidden="true"></i>
        <input v-model="search" type="search" placeholder="筛选当前页对象" />
      </label>
    </div>

    <section v-if="status?.configured" class="oss-date-cleanup">
      <div class="oss-date-copy">
        <strong>按时间范围清理</strong>
        <p>针对当前目录及子目录递归筛选。OSS 没有独立创建时间，按最后修改时间判断；匹配对象会被永久删除，空目录随后消失。</p>
      </div>
      <div class="oss-date-controls">
        <label><span>开始日期</span><input v-model="fromDate" type="date" @input="datePreview = null" /></label>
        <label><span>结束日期</span><input v-model="toDate" type="date" @input="datePreview = null" /></label>
        <button type="button" class="oss-button" :disabled="datePreviewLoading || dateDeleting || !fromDate || !toDate" @click="previewDateDeletion">
          <i :class="datePreviewLoading ? 'ri-loader-4-line oss-spin' : 'ri-search-line'" aria-hidden="true"></i>
          {{ datePreviewLoading ? '筛选中...' : '预览匹配对象' }}
        </button>
      </div>
      <div v-if="datePreview" class="oss-date-result" aria-live="polite">
        <div class="oss-date-result-head">
          <span>匹配 <strong>{{ datePreview.matchedCount }}</strong> 个对象 · {{ formatBytes(datePreview.matchedBytes) }}</span>
          <button type="button" class="oss-button is-danger-button" :disabled="!datePreview.matchedCount || dateDeleting" @click="deleteDateMatches">
            <i :class="dateDeleting ? 'ri-loader-4-line oss-spin' : 'ri-delete-bin-6-line'" aria-hidden="true"></i>
            {{ dateDeleting ? '删除中...' : '删除匹配对象' }}
          </button>
        </div>
        <ul v-if="datePreview.sample?.length" class="oss-date-samples">
          <li v-for="item in datePreview.sample" :key="item.key" :title="item.key">
            <span>{{ item.key }}</span><time>{{ formatDate(item.lastModified) }}</time>
          </li>
        </ul>
        <p v-if="datePreview.matchedCount > datePreview.sample?.length" class="oss-date-more">
          仅展示前 {{ datePreview.sample.length }} 个，共 {{ datePreview.matchedCount }} 个符合条件。
        </p>
        <p v-else-if="!datePreview.matchedCount" class="oss-date-more">没有对象符合该时间范围。</p>
      </div>
    </section>

    <div v-if="!status" class="oss-empty">正在加载 OSS 配置...</div>
    <div v-else-if="!status.configured" class="oss-empty oss-empty-error">
      请在后端配置 `youmi.oss` 的 endpoint、AK/SK 和 bucket-name 后刷新。
    </div>
    <div v-else class="oss-table-wrap">
      <table class="oss-table">
        <thead>
          <tr><th class="oss-preview-heading">预览</th><th>对象</th><th>大小</th><th>修改时间</th><th class="oss-table-actions">操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in filteredObjects" :key="item.key">
            <td class="oss-preview-cell">
              <a v-if="!item.folder && item.previewUrl" class="oss-preview" :class="`is-${filePreviewType(item)}`" :href="item.previewUrl" target="_blank" rel="noopener noreferrer" :title="`${item.name} · 打开预览`" @click="openFilePreview($event, item)">
                <img v-if="filePreviewType(item) === 'image'" :src="item.thumbnailUrl || item.previewUrl" :alt="item.name" loading="lazy" />
                <video v-else-if="filePreviewType(item) === 'video'" :src="item.previewUrl" muted playsinline preload="metadata" @loadeddata="handleVideoPreviewLoaded" />
                <template v-else>
                  <i :class="previewIcon(item)" aria-hidden="true"></i>
                  <span>{{ previewLabel(item) }}</span>
                </template>
                <i v-if="filePreviewType(item) === 'video'" class="oss-preview-play ri-play-fill" aria-hidden="true"></i>
              </a>
              <span v-else class="oss-preview is-folder" :title="item.folder ? '文件夹' : '无预览地址'">
                <i :class="previewIcon(item)" aria-hidden="true"></i>
                <span>{{ item.folder ? '目录' : previewLabel(item) }}</span>
              </span>
            </td>
            <td>
              <button v-if="item.folder" class="oss-name-button" type="button" @click="openFolder(item)">
                <i class="ri-folder-3-line" aria-hidden="true"></i><span>{{ item.name }}</span>
              </button>
              <div v-else class="oss-object-name" :title="item.key">
                <i class="ri-file-line" aria-hidden="true"></i><span>{{ item.name }}</span>
              </div>
            </td>
            <td>{{ item.folder ? '-' : formatBytes(item.size) }}</td>
            <td>{{ item.folder ? '-' : formatDate(item.lastModified) }}</td>
            <td class="oss-row-actions">
              <template v-if="!item.folder">
                <button class="oss-icon-button" type="button" title="复制链接地址" aria-label="复制链接地址" @click="copyObjectUrl(item)">
                  <i class="ri-link-m" aria-hidden="true"></i>
                </button>
                <a class="oss-icon-button" :href="item.previewUrl" :download="item.name" title="下载文件">
                  <i class="ri-download-2-line" aria-hidden="true"></i>
                </a>
                <button class="oss-icon-button is-danger" type="button" :disabled="deletingKey === item.key" title="删除对象" @click="deleteObject(item)">
                  <i :class="deletingKey === item.key ? 'ri-loader-4-line oss-spin' : 'ri-delete-bin-6-line'" aria-hidden="true"></i>
                </button>
              </template>
              <span v-else class="oss-folder-hint">打开目录</span>
            </td>
          </tr>
          <tr v-if="!loading && !filteredObjects.length">
            <td colspan="5" class="oss-no-results">{{ search ? '当前页没有匹配对象' : '此目录暂无对象' }}</td>
          </tr>
          <tr v-if="loading && !objects.length"><td colspan="5" class="oss-no-results">正在读取对象...</td></tr>
        </tbody>
      </table>
    </div>

    <footer v-if="status?.configured" class="oss-manager-foot">
      <span>{{ objects.length }} 项{{ search ? ` · 筛选后 ${filteredObjects.length} 项` : '' }}</span>
      <div>
        <button class="oss-button is-secondary" type="button" :disabled="loading || !markerHistory.length" @click="previousPage">上一页</button>
        <button class="oss-button is-secondary" type="button" :disabled="loading || !nextMarker" @click="nextPage">下一页</button>
      </div>
    </footer>

    <ImageViewer
      :open="imageViewer.open"
      :images="imageViewer.images"
      :start-index="imageViewer.index"
      @close="imageViewer.open = false"
      @change="imageViewer.index = $event"
      @download="downloadPreviewImage"
    />
    <Teleport to="body">
      <div v-if="videoViewer.open" class="oss-video-overlay" tabindex="-1" @click.self="closeVideoPreview" @keydown.esc="closeVideoPreview">
        <section class="oss-video-dialog" role="dialog" aria-modal="true" :aria-label="videoViewer.title">
          <header>
            <strong :title="videoViewer.title">{{ videoViewer.title }}</strong>
            <button class="oss-icon-button" type="button" title="关闭视频预览" aria-label="关闭视频预览" @click="closeVideoPreview">
              <i class="ri-close-line" aria-hidden="true"></i>
            </button>
          </header>
          <video :src="videoViewer.url" controls autoplay playsinline preload="metadata"></video>
        </section>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.oss-manager { padding: 0; overflow: hidden; }
.oss-manager-head, .oss-browser-toolbar, .oss-manager-foot { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 20px; }
.oss-manager-head { border-bottom: 1px solid var(--console-border, #383a40); }
.oss-manager-head h2 { margin: 0; color: var(--console-text, #f3f4f6); font-size: 16px; }
.oss-manager-head p { margin: 6px 0 0; color: var(--console-muted, #a0a4ad); font-size: 12px; overflow-wrap: anywhere; }
.oss-manager-head p span { padding: 0 5px; color: var(--console-subtle, #757b86); }
.oss-manager-actions, .oss-manager-foot > div { display: flex; align-items: center; gap: 8px; }
.oss-button, .oss-icon-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 34px; border: 1px solid var(--console-border, #41444c); border-radius: 6px; color: var(--console-text, #edf0f3); background: var(--console-surface-raised, #292b31); cursor: pointer; text-decoration: none; }
.oss-button { padding: 0 12px; font-size: 12px; }
.oss-button:not(:disabled):hover, .oss-icon-button:not(:disabled):hover { border-color: var(--console-accent, #20bfd2); color: var(--console-accent, #20bfd2); }
.oss-button:disabled, .oss-icon-button:disabled { opacity: .45; cursor: not-allowed; }
.oss-icon-button { width: 34px; height: 34px; padding: 0; font-size: 15px; }
.oss-icon-button.is-danger:hover { color: #ed6b70; border-color: #ed6b70; }
.oss-browser-toolbar { padding-top: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--console-border, #383a40); }
.oss-date-cleanup { display: grid; grid-template-columns: minmax(180px, 1fr) auto; gap: 14px 20px; padding: 16px 20px; border-bottom: 1px solid var(--console-border, #383a40); }
.oss-date-copy strong { color: var(--console-text, #edf0f3); font-size: 13px; }
.oss-date-copy p { max-width: 620px; margin: 5px 0 0; color: var(--console-muted, #9298a3); font-size: 11px; line-height: 1.5; }
.oss-date-controls { display: flex; align-items: end; gap: 8px; }
.oss-date-controls label { display: grid; gap: 5px; color: var(--console-subtle, #858b96); font-size: 10px; }
.oss-date-controls input { min-height: 34px; border: 1px solid var(--console-border, #41444c); border-radius: 6px; padding: 0 8px; color: var(--console-text, #edf0f3); background: var(--console-input, #1d1f24); color-scheme: dark; font: inherit; }
.oss-date-result { grid-column: 1 / -1; padding: 12px; border: 1px solid var(--console-border, #383a40); border-radius: 6px; background: var(--console-surface-raised, #292b31); }
.oss-date-result-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--console-text, #edf0f3); font-size: 12px; }
.oss-date-result-head strong { color: var(--console-accent, #20bfd2); }
.oss-button.is-danger-button { color: #f08084; border-color: color-mix(in srgb, #e35d63 50%, var(--console-border, #41444c)); }
.oss-button.is-danger-button:not(:disabled):hover { color: #fff; border-color: #e35d63; background: #a83e46; }
.oss-date-samples { display: grid; gap: 5px; max-height: 170px; overflow: auto; margin: 10px 0 0; padding: 0; list-style: none; }
.oss-date-samples li { display: flex; justify-content: space-between; gap: 16px; color: var(--console-muted, #a0a4ad); font-size: 11px; }
.oss-date-samples li span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oss-date-samples time { flex: 0 0 auto; }
.oss-date-more { margin: 8px 0 0; color: var(--console-subtle, #858b96); font-size: 11px; }
.oss-breadcrumbs { display: flex; align-items: center; gap: 4px; min-width: 0; color: var(--console-muted, #9298a3); }
.oss-breadcrumbs span { font-size: 16px; }
.oss-breadcrumbs button { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 0; padding: 4px 5px; color: var(--console-accent, #20bfd2); background: transparent; cursor: pointer; }
.oss-breadcrumbs button:disabled { color: var(--console-text, #edf0f3); cursor: default; }
.oss-search { display: flex; align-items: center; gap: 8px; width: min(280px, 40%); height: 34px; padding: 0 10px; border: 1px solid var(--console-border, #41444c); border-radius: 6px; color: var(--console-muted, #a0a4ad); background: var(--console-input, #1d1f24); }
.oss-search input { width: 100%; min-width: 0; border: 0; outline: 0; color: var(--console-text, #f3f4f6); background: transparent; font: inherit; font-size: 12px; }
.oss-table-wrap { overflow: auto; }
.oss-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 12px; }
.oss-table th, .oss-table td { height: 48px; padding: 7px 20px; border-bottom: 1px solid var(--console-border, #34363d); color: var(--console-muted, #a0a4ad); }
.oss-table th { height: 38px; color: var(--console-subtle, #858b96); font-weight: 500; }
.oss-table th:nth-child(2), .oss-table td:nth-child(2) { min-width: 260px; }
.oss-table th.oss-preview-heading, .oss-table td.oss-preview-cell { width: 92px; min-width: 92px; padding-right: 8px; padding-left: 20px; }
.oss-preview { position: relative; display: flex; width: 64px; height: 46px; align-items: center; justify-content: center; overflow: hidden; border: 1px solid var(--console-border, #41444c); border-radius: 5px; color: var(--console-muted, #a0a4ad); background: var(--console-input, #1d1f24); text-decoration: none; }
.oss-preview img, .oss-preview video { display: block; width: 100%; height: 100%; object-fit: cover; }
.oss-preview > i:not(.oss-preview-play) { font-size: 20px; }
.oss-preview > span { position: absolute; right: 2px; bottom: 2px; max-width: 42px; overflow: hidden; border-radius: 2px; padding: 1px 3px; color: #eef2f5; background: rgb(16 18 22 / 78%); font-size: 8px; line-height: 1.3; text-overflow: ellipsis; }
.oss-preview.is-pdf { color: #ed7777; }
.oss-preview.is-audio { color: #50c9b2; }
.oss-preview.is-archive { color: #e6b767; }
.oss-preview.is-folder { color: var(--console-accent, #20bfd2); }
.oss-preview-play { position: absolute; display: grid; width: 20px; height: 20px; place-items: center; border-radius: 50%; color: #fff; background: rgb(16 18 22 / 74%); font-size: 15px; }
.oss-video-overlay { position: fixed; z-index: 3000; inset: 0; display: grid; place-items: center; padding: 24px; background: rgb(0 0 0 / 78%); }
.oss-video-dialog { display: grid; width: min(100%, 1100px); max-height: 92vh; overflow: hidden; border: 1px solid var(--console-border, #41444c); border-radius: 8px; background: var(--console-surface, #202228); box-shadow: 0 18px 60px rgb(0 0 0 / 42%); }
.oss-video-dialog header { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 16px; border-bottom: 1px solid var(--console-border, #383a40); }
.oss-video-dialog header strong { overflow: hidden; color: var(--console-text, #edf0f3); font-size: 13px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.oss-video-dialog video { display: block; width: 100%; max-height: calc(92vh - 60px); background: #090a0c; object-fit: contain; }
.oss-table-actions { width: 142px; text-align: right; }
.oss-row-actions { white-space: nowrap; text-align: right; }
.oss-row-actions .oss-icon-button { margin-left: 5px; vertical-align: middle; }
.oss-name-button, .oss-object-name { display: flex; align-items: center; gap: 9px; min-width: 0; color: var(--console-text, #edf0f3); }
.oss-name-button { border: 0; padding: 0; background: transparent; color: var(--console-accent, #20bfd2); cursor: pointer; font: inherit; }
.oss-name-button span, .oss-object-name span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oss-name-button i { font-size: 17px; }
.oss-object-name i { color: var(--console-subtle, #858b96); font-size: 16px; }
.oss-folder-hint { color: var(--console-subtle, #858b96); }
.oss-no-results, .oss-empty { padding: 38px 20px !important; text-align: center; color: var(--console-muted, #9298a3) !important; }
.oss-empty-error { color: #df7777 !important; }
.oss-manager-foot { min-height: 60px; border-top: 1px solid var(--console-border, #383a40); color: var(--console-muted, #9298a3); font-size: 12px; }
.oss-button.is-secondary { min-height: 30px; }
.oss-spin { animation: oss-spin .8s linear infinite; }
@keyframes oss-spin { to { transform: rotate(360deg); } }
@media (max-width: 720px) {
  .oss-manager-head, .oss-browser-toolbar { align-items: stretch; flex-direction: column; }
  .oss-date-cleanup { grid-template-columns: 1fr; }
  .oss-date-controls { flex-wrap: wrap; }
  .oss-date-controls label { flex: 1 1 130px; }
  .oss-date-controls .oss-button { align-self: flex-end; }
  .oss-manager-actions { align-self: flex-end; }
  .oss-search { width: auto; }
  .oss-table th, .oss-table td { padding-right: 10px; padding-left: 10px; }
  .oss-table th:nth-child(2), .oss-table td:nth-child(2) { min-width: 190px; }
  .oss-table th.oss-preview-heading, .oss-table td.oss-preview-cell { padding-right: 6px; padding-left: 10px; }
  .oss-preview { width: 54px; height: 40px; }
  .oss-row-actions .oss-icon-button { width: 30px; height: 30px; margin-left: 2px; }
  .oss-video-overlay { padding: 12px; }
  .oss-video-dialog video { max-height: calc(92vh - 56px); }
}
</style>
