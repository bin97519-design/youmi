<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useUserStore } from '../../../stores/user'
import { useCanvasV3GraphStore } from '../stores/graph'
import { apiPath } from '../../../utils/apiBase'
import { uploadBase64ImageDirect } from '../../../utils/ossUpload'
import {
  createSelectionSavedAssets,
  selectionAssetSnapshots,
} from '../sync/selectionSavedAssets.js'
import {
  imageAssetFolderPath,
  loadImageAssetCollections,
  saveImageAssetCollections,
} from '../config/imageAssetCollections.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  nodes: { type: Array, default: () => [] },
  projectId: { type: [String, Number], default: null },
})
const emit = defineEmits(['close', 'saved'])
const user = useUserStore()
const graph = useCanvasV3GraphStore()
const client = createSelectionSavedAssets({
  path: apiPath,
  headers: () => user.authHeaders(),
  uploadImage: uploadBase64ImageDirect,
})
const dialog = ref(null)
const rows = ref([])
const names = ref({})
const folderId = ref('')
const tags = ref([])
const collections = ref({ folders: [], tags: [] })
const expanded = ref(new Set())
const menu = ref('')
const adding = ref('')
const parentFolderId = ref('')
const newName = ref('')
const saving = ref(false)
const stopping = ref(false)
const attempted = ref(false)
const error = ref('')
const notice = ref('')
const accountId = computed(() => String(user.profile?.id || user.profile?.userId || ''))
const currentProject = computed(() => String(props.projectId ?? graph.projectId ?? ''))
const selectedFolder = computed(() =>
  imageAssetFolderPath(collections.value.folders, folderId.value).join(' / '),
)
const retryable = computed(() =>
  rows.value.filter((row) => ['pending', 'failed'].includes(row.status)),
)
const savedCount = computed(() => rows.value.filter((row) => row.status === 'saved').length)
const failedCount = computed(
  () => rows.value.filter((row) => ['failed', 'invalid'].includes(row.status)).length,
)
const uncertainCount = computed(() => rows.value.filter((row) => row.status === 'uncertain').length)
const validNames = computed(() =>
  retryable.value.every((row) => {
    const name = names.value[row.key]?.trim()
    return (
      name &&
      name.length <= 50 &&
      ![...name].some((letter) => letter.codePointAt(0) < 32 || letter.codePointAt(0) === 127)
    )
  }),
)
const canSave = computed(
  () =>
    !saving.value &&
    retryable.value.length > 0 &&
    Boolean(selectedFolder.value) &&
    validNames.value,
)
const saveLabel = computed(() => (saving.value ? '保存中…' : attempted.value ? '继续保存' : '保存'))
const visibleFolders = computed(() => {
  const result = []
  const walk = (parentId, depth) => {
    for (const folder of collections.value.folders.filter((item) => item.parentId === parentId)) {
      const children = collections.value.folders.some((item) => item.parentId === folder.id)
      result.push({ ...folder, depth, children })
      if (expanded.value.has(folder.id)) walk(folder.id, depth + 1)
    }
  }
  walk('', 0)
  return result
})
const statusLabel = (status) =>
  ({
    pending: '待保存',
    saving: '保存中',
    saved: '已保存',
    failed: '保存失败',
    uncertain: '结果待核对',
    invalid: '无可保存产物',
  })[status]
let batch = null
let controller = null
let session = 0
let openedAccount = ''
let openedProject = ''
let previousFocus = null
let emittedKeys = new Set()

function storage() {
  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}
function sameContext() {
  return openedAccount === accountId.value && openedProject === currentProject.value
}
function restoreFocus() {
  if (previousFocus?.isConnected !== false) previousFocus?.focus?.({ preventScroll: true })
  previousFocus = null
}
function invalidate() {
  session += 1
  controller?.abort()
  batch?.cancel()
  controller = null
  saving.value = false
  stopping.value = false
}
function emitConfirmed() {
  if (!sameContext() || !batch) return
  const confirmed = batch
    .state()
    .filter((row) => row.status === 'saved' && row.saved && !emittedKeys.has(row.key))
  if (!confirmed.length) return
  for (const row of confirmed) emittedKeys.add(row.key)
  emit(
    'saved',
    confirmed.map((row) => row.saved),
  )
}
async function initialize() {
  invalidate()
  openedAccount = accountId.value
  openedProject = currentProject.value
  emittedKeys = new Set()
  error.value = ''
  notice.value = ''
  attempted.value = false
  folderId.value = ''
  tags.value = []
  menu.value = ''
  adding.value = ''
  expanded.value = new Set()
  collections.value = loadImageAssetCollections(storage(), openedAccount)
  try {
    batch = client.createBatch(selectionAssetSnapshots(props.nodes))
    rows.value = batch.state()
    names.value = Object.fromEntries(rows.value.map((row) => [row.key, row.name]))
    if (!rows.value.length) error.value = '请选择可保存的图片或视频素材'
  } catch (cause) {
    batch = null
    rows.value = []
    names.value = {}
    error.value = cause.message || '无法读取待保存素材，请重新选择'
  }
  const current = session
  await nextTick()
  if (props.open && current === session)
    dialog.value?.querySelector?.('[data-selection-asset-name]')?.focus?.({ preventScroll: true })
}
function close() {
  emitConfirmed()
  invalidate()
  menu.value = ''
  adding.value = ''
  emit('close')
}
function stop() {
  stopping.value = true
  notice.value = '正在停止：未开始的素材不会保存，已确认保存的资产不会回滚。'
  controller?.abort()
  batch?.cancel()
}
function toggleMenu(value) {
  if (saving.value) return
  menu.value = menu.value === value ? '' : value
  adding.value = ''
}
function selectFolder(id) {
  if (saving.value || !collections.value.folders.some((folder) => folder.id === id)) return
  folderId.value = id
  menu.value = ''
}
function toggleFolder(id) {
  const value = new Set(expanded.value)
  if (value.has(id)) value.delete(id)
  else value.add(id)
  expanded.value = value
}
function toggleTag(tag) {
  if (saving.value || !collections.value.tags.includes(tag)) return
  tags.value = tags.value.includes(tag)
    ? tags.value.filter((value) => value !== tag)
    : [...tags.value, tag]
}
async function startAdd(kind, parentId = '') {
  if (saving.value) return
  adding.value = kind
  parentFolderId.value = parentId
  newName.value = ''
  notice.value = '目录和标签保存在本机当前账号，资产本身会保存到云端。'
  await nextTick()
  dialog.value?.querySelector?.('[data-selection-new-name]')?.focus?.()
}
function commitAdd() {
  const value = newName.value.trim()
  if (saving.value || !value || !user.requireLogin()) return
  if (!sameContext() || !accountId.value) {
    error.value = '账号或项目已变化，请重新打开保存窗口'
    return
  }
  if ([...value].some((letter) => letter.codePointAt(0) < 32 || letter.codePointAt(0) === 127)) {
    error.value = '名称包含无效字符'
    return
  }
  const updated = { folders: [...collections.value.folders], tags: [...collections.value.tags] }
  let selectedId = ''
  if (adding.value === 'folder') {
    const duplicate = updated.folders.find(
      (folder) => folder.parentId === parentFolderId.value && folder.name === value,
    )
    if (duplicate) selectedId = duplicate.id
    else {
      if (updated.folders.length >= 200) {
        error.value = '目录数量已达上限'
        return
      }
      selectedId = `folder-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
      updated.folders.push({
        id: selectedId,
        parentId: parentFolderId.value,
        name: value.slice(0, 40),
      })
    }
  } else if (!updated.tags.includes(value)) {
    if (updated.tags.length >= 100) {
      error.value = '标签数量已达上限'
      return
    }
    updated.tags.push(value.slice(0, 30))
  }
  try {
    collections.value = saveImageAssetCollections(storage(), openedAccount, updated)
    if (selectedId) {
      folderId.value = selectedId
      expanded.value = new Set([...expanded.value, parentFolderId.value])
    } else if (!tags.value.includes(value)) tags.value = [...tags.value, value.slice(0, 30)]
    adding.value = ''
    newName.value = ''
    error.value = ''
  } catch (cause) {
    error.value = cause.message
  }
}
async function save() {
  if (!canSave.value || !batch || !user.requireLogin()) return
  if (!sameContext() || !accountId.value) {
    error.value = '账号或项目已变化，请重新打开保存窗口'
    return
  }
  const current = ++session
  const request = new AbortController()
  controller = request
  const isCurrent = () => props.open && current === session && sameContext()
  saving.value = true
  stopping.value = false
  attempted.value = true
  error.value = ''
  notice.value = ''
  menu.value = ''
  adding.value = ''
  try {
    const result = await batch.run(
      {
        names: { ...names.value },
        folderId: folderId.value,
        folderPath: imageAssetFolderPath(collections.value.folders, folderId.value),
        tags: [...tags.value],
      },
      {
        signal: request.signal,
        isCurrent,
        onProgress: (value) => {
          if (isCurrent()) rows.value = value
        },
      },
    )
    if (!isCurrent()) return
    rows.value = result.rows
    emitConfirmed()
    notice.value = result.cancelled
      ? '已停止。未开始项未保存，已保存项不会回滚；再次保存只处理失败和未开始项。'
      : result.failed.length || result.uncertain.length
        ? '已完成本轮保存，部分素材未成功。再次保存会跳过已保存和结果待核对的项。'
        : '全部资产已保存到云端。'
  } catch (cause) {
    if (isCurrent())
      error.value = cause.message?.replaceAll('模特', '资产') || '保存失败，请稍后重试'
  } finally {
    if (current === session) {
      saving.value = false
      stopping.value = false
      controller = null
    }
  }
}
function keydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    if (adding.value) adding.value = ''
    else if (menu.value) menu.value = ''
    else if (saving.value) stop()
    else close()
  } else if (event.key === 'Tab') {
    const controls = [
      ...(dialog.value?.querySelectorAll?.(
        'button:not([disabled]), input:not([disabled]), [tabindex="0"]',
      ) || []),
    ]
    if (!controls.length) return
    const active = globalThis.document?.activeElement
    if (event.shiftKey && (active === controls[0] || !controls.includes(active))) {
      event.preventDefault()
      controls.at(-1)?.focus?.()
    } else if (!event.shiftKey && (active === controls.at(-1) || !controls.includes(active))) {
      event.preventDefault()
      controls[0]?.focus?.()
    }
  }
}
watch(
  () => props.open,
  (open) => {
    if (open) {
      previousFocus = globalThis.document?.activeElement
      initialize()
    } else {
      emitConfirmed()
      invalidate()
      restoreFocus()
    }
  },
  { immediate: true },
)
watch(
  [accountId, currentProject],
  () => {
    if (!props.open) return
    invalidate()
    batch = null
    rows.value = []
    names.value = {}
    error.value = '账号或项目已变化，请重新打开保存窗口'
    emit('close')
  },
  { flush: 'sync' },
)
onBeforeUnmount(() => {
  invalidate()
  restoreFocus()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="cv3-selection-save-backdrop"
      data-selection-context-dialog
      data-canvas-shortcuts-ignore
      @pointerdown.self="close"
      @contextmenu.prevent
      @keydown="keydown"
    >
      <section
        ref="dialog"
        class="cv3-selection-save-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="保存资产"
        :aria-busy="saving"
        @pointerdown="menu = ''"
      >
        <header class="cv3-selection-save-header">
          <h2>保存资产</h2>
          <button type="button" aria-label="关闭保存资产" @click="close">×</button>
        </header>
        <form class="cv3-selection-save-body" @submit.prevent="save">
          <section class="cv3-selection-save-materials" aria-label="待保存素材">
            <div class="cv3-selection-save-grid" role="list">
              <div
                v-for="(row, index) in rows"
                :key="row.key"
                class="cv3-selection-save-card"
                role="listitem"
                :data-status="row.status"
              >
                <div class="cv3-selection-save-thumbnail">
                  <img
                    v-if="row.kind === 'image' && row.sourceUrl"
                    :src="row.sourceUrl"
                    :alt="row.fileName"
                    referrerpolicy="no-referrer"
                  />
                  <img
                    v-else-if="row.posterUrl"
                    :src="row.posterUrl"
                    :alt="row.fileName"
                    referrerpolicy="no-referrer"
                  />
                  <span v-else class="cv3-selection-save-fallback" aria-hidden="true">
                    {{ row.kind === 'video' ? '▷' : '▧' }}
                  </span>
                  <span v-if="row.status !== 'pending'" class="cv3-selection-save-badge">
                    {{ statusLabel(row.status) }}
                  </span>
                </div>
                <input
                  v-model="names[row.key]"
                  data-selection-asset-name
                  :aria-label="`资产名称${index + 1}`"
                  :aria-describedby="row.error ? `cv3-selection-save-error-${index}` : undefined"
                  :title="names[row.key]"
                  maxlength="50"
                  autocomplete="off"
                  :disabled="saving || ['saved', 'uncertain', 'invalid'].includes(row.status)"
                />
                <small
                  v-if="row.error"
                  :id="`cv3-selection-save-error-${index}`"
                  class="cv3-selection-save-item-error"
                  :title="row.error"
                >
                  {{ row.error }}
                </small>
              </div>
              <p v-if="!rows.length" class="cv3-selection-save-empty">暂无可保存素材</p>
            </div>
            <div class="cv3-selection-save-selection-count" role="status" aria-live="polite">
              <span v-if="!attempted">已选择 {{ rows.length }} 项素材</span>
              <span v-else>
                已保存 {{ savedCount }}/{{ rows.length }}
                <template v-if="failedCount">· 失败 {{ failedCount }}</template>
                <template v-if="uncertainCount">· 待核对 {{ uncertainCount }}</template>
              </span>
              <progress
                v-if="attempted"
                :value="savedCount + failedCount + uncertainCount"
                :max="Math.max(1, rows.length)"
                aria-label="资产保存进度"
              />
            </div>
          </section>
          <div class="cv3-selection-save-fields">
            <label class="cv3-selection-save-label">
              保存位置
              <span>*</span>
            </label>
            <div class="cv3-selection-save-select-wrap" @pointerdown.stop>
              <button
                type="button"
                class="cv3-selection-save-select"
                aria-label="选择保存位置"
                aria-haspopup="tree"
                :aria-expanded="menu === 'folder'"
                :disabled="saving"
                @click="toggleMenu('folder')"
              >
                <span :class="{ placeholder: !selectedFolder }">
                  {{ selectedFolder || '请选择文件夹' }}
                </span>
                <span aria-hidden="true">⌄</span>
              </button>
              <div v-if="menu === 'folder'" class="cv3-selection-save-dropdown">
                <div class="cv3-selection-save-menu-header">
                  <span>个人资产库</span>
                  <button type="button" aria-label="新建根目录" @click="startAdd('folder')">
                    ＋
                  </button>
                </div>
                <div class="cv3-selection-save-tree" role="tree" aria-label="资产目录">
                  <div
                    v-for="folder in visibleFolders"
                    :key="folder.id"
                    class="cv3-selection-save-folder"
                    :class="{ selected: folderId === folder.id }"
                    :style="{ paddingLeft: `${8 + folder.depth * 12}px` }"
                  >
                    <button
                      v-if="folder.children"
                      type="button"
                      class="cv3-selection-save-arrow"
                      :aria-label="`${expanded.has(folder.id) ? '收起' : '展开'}${folder.name}`"
                      @click="toggleFolder(folder.id)"
                    >
                      {{ expanded.has(folder.id) ? '⌄' : '›' }}
                    </button>
                    <span v-else class="cv3-selection-save-arrow" aria-hidden="true" />
                    <button
                      type="button"
                      class="cv3-selection-save-folder-name"
                      role="treeitem"
                      :aria-selected="folderId === folder.id"
                      :aria-label="`选择目录${folder.name}`"
                      @click="selectFolder(folder.id)"
                    >
                      <span aria-hidden="true">▱</span>
                      {{ folder.name }}
                    </button>
                    <button
                      type="button"
                      class="cv3-selection-save-folder-add"
                      :aria-label="`在${folder.name}中新建目录`"
                      @click="startAdd('folder', folder.id)"
                    >
                      ＋
                    </button>
                    <span v-if="folderId === folder.id" aria-hidden="true">✓</span>
                  </div>
                </div>
                <div v-if="adding === 'folder'" class="cv3-selection-save-create">
                  <input
                    v-model="newName"
                    data-selection-new-name
                    aria-label="新目录名称"
                    maxlength="40"
                    placeholder="新建文件夹"
                    @keydown.enter.prevent="commitAdd"
                  />
                  <button type="button" :disabled="!newName.trim()" @click="commitAdd">确定</button>
                  <button type="button" aria-label="取消新建目录" @click="adding = ''">×</button>
                </div>
              </div>
            </div>
            <label class="cv3-selection-save-label">设置标签</label>
            <div class="cv3-selection-save-select-wrap" @pointerdown.stop>
              <button
                type="button"
                class="cv3-selection-save-select"
                aria-label="设置标签"
                aria-haspopup="listbox"
                :aria-expanded="menu === 'tag'"
                :disabled="saving"
                @click="toggleMenu('tag')"
              >
                <span :class="{ placeholder: !tags.length }">
                  {{ tags.join('、') || '请选择标签' }}
                </span>
                <span aria-hidden="true">⌄</span>
              </button>
              <div v-if="menu === 'tag'" class="cv3-selection-save-dropdown">
                <div class="cv3-selection-save-menu-header">
                  <span>标签</span>
                  <button type="button" aria-label="新建标签" @click="startAdd('tag')">＋</button>
                </div>
                <div
                  class="cv3-selection-save-tags"
                  role="listbox"
                  aria-label="资产标签"
                  aria-multiselectable="true"
                >
                  <button
                    v-for="tag in collections.tags"
                    :key="tag"
                    type="button"
                    role="option"
                    :aria-label="`标签${tag}`"
                    :aria-selected="tags.includes(tag)"
                    @click="toggleTag(tag)"
                  >
                    <span>{{ tag }}</span>
                    <span v-if="tags.includes(tag)">✓</span>
                  </button>
                </div>
                <div v-if="adding === 'tag'" class="cv3-selection-save-create">
                  <input
                    v-model="newName"
                    data-selection-new-name
                    aria-label="新标签名称"
                    maxlength="30"
                    placeholder="输入标签名称"
                    @keydown.enter.prevent="commitAdd"
                  />
                  <button type="button" :disabled="!newName.trim()" @click="commitAdd">确定</button>
                  <button type="button" aria-label="取消新建标签" @click="adding = ''">×</button>
                </div>
              </div>
            </div>
            <p v-if="error" class="cv3-selection-save-error" role="alert">{{ error }}</p>
            <p v-if="notice" class="cv3-selection-save-notice" role="status">{{ notice }}</p>
            <p v-if="uncertainCount" class="cv3-selection-save-notice">
              结果待核对的项不会自动重试，请先在资产库确认，避免重复保存。
            </p>
            <footer class="cv3-selection-save-actions">
              <button v-if="saving" type="button" :disabled="stopping" @click="stop">
                {{ stopping ? '停止中…' : '停止保存' }}
              </button>
              <button v-else type="button" @click="close">
                {{ savedCount === rows.length && rows.length ? '完成' : '取消' }}
              </button>
              <button type="submit" class="cv3-selection-save-submit" :disabled="!canSave">
                {{ saveLabel }}
              </button>
            </footer>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.cv3-selection-save-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1600;
  display: grid;
  place-items: center;
  padding: 16px;
  background: #0008;
  backdrop-filter: blur(5px);
}
.cv3-selection-save-dialog {
  box-sizing: border-box;
  width: 720px;
  height: 520px;
  max-width: 100%;
  max-height: calc(100dvh - 32px);
  color: #eee;
  background: #262626;
  border: 1px solid #363636;
  border-radius: 16px;
  box-shadow: 0 16px 56px #0005;
  font:
    13px/1.5 -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    'Microsoft YaHei',
    sans-serif;
}
.cv3-selection-save-dialog * {
  box-sizing: border-box;
}
.cv3-selection-save-dialog button,
.cv3-selection-save-dialog input {
  color: inherit;
  font: inherit;
}
.cv3-selection-save-dialog button {
  cursor: pointer;
  border: 0;
}
.cv3-selection-save-dialog button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.cv3-selection-save-dialog button:focus-visible,
.cv3-selection-save-dialog input:focus-visible {
  outline: 1px solid #aaa;
  outline-offset: 2px;
}
.cv3-selection-save-header {
  height: 50px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  border-bottom: 1px solid #363636;
}
.cv3-selection-save-header h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
}
.cv3-selection-save-header button {
  width: 24px;
  height: 24px;
  padding: 0;
  background: none;
  color: #999;
  font-size: 22px;
  line-height: 20px;
}
.cv3-selection-save-body {
  display: flex;
  gap: 24px;
  height: calc(100% - 50px);
  padding: 24px;
  margin: 0;
}
.cv3-selection-save-materials {
  display: flex;
  flex: 1;
  height: 405px;
  max-height: 100%;
  min-width: 0;
  flex-direction: column;
  border: 1px solid #3c3c3c;
  border-radius: 12px;
  overflow: hidden;
}
.cv3-selection-save-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-auto-rows: min-content;
  gap: 12px;
  flex: 1;
  min-height: 0;
  padding: 14px 16px;
  overflow-y: auto;
  align-content: start;
}
.cv3-selection-save-card {
  min-width: 0;
}
.cv3-selection-save-thumbnail {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  max-width: 116px;
  overflow: hidden;
  border-radius: 8px;
  background: #1c1c1c;
}
.cv3-selection-save-thumbnail img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cv3-selection-save-fallback {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  font-size: 32px;
  color: #777;
}
.cv3-selection-save-badge {
  position: absolute;
  left: 4px;
  right: 4px;
  bottom: 4px;
  padding: 2px 4px;
  border-radius: 4px;
  background: #111c;
  text-align: center;
  font-size: 11px;
}
.cv3-selection-save-card[data-status='saved'] .cv3-selection-save-badge {
  color: #9ad4a7;
}
.cv3-selection-save-card[data-status='failed'] .cv3-selection-save-badge,
.cv3-selection-save-card[data-status='invalid'] .cv3-selection-save-badge {
  color: #f19e9e;
}
.cv3-selection-save-card[data-status='uncertain'] .cv3-selection-save-badge {
  color: #e1bd83;
}
.cv3-selection-save-card > input {
  display: block;
  width: 100%;
  height: 24px;
  min-width: 0;
  padding: 0 2px;
  margin-top: 4px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  font-size: 12px;
  text-overflow: ellipsis;
}
.cv3-selection-save-card > input:not(:disabled):hover {
  background: #333;
  border-color: #444;
}
.cv3-selection-save-card > input:disabled {
  opacity: 1;
}
.cv3-selection-save-item-error {
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  font-size: 11px;
  color: #e6a4a4;
}
.cv3-selection-save-selection-count {
  display: flex;
  gap: 6px;
  flex-direction: column;
  padding: 8px 16px 12px;
  color: #999;
  font-size: 12px;
}
.cv3-selection-save-selection-count progress {
  width: 100%;
  height: 4px;
  accent-color: #ddd;
}
.cv3-selection-save-empty {
  grid-column: 1 / -1;
  padding: 32px 0;
  color: #888;
  text-align: center;
}
.cv3-selection-save-fields {
  width: 236px;
  flex: 0 0 236px;
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.cv3-selection-save-label {
  margin: 0 0 8px;
  color: #aaa;
}
.cv3-selection-save-label > span {
  color: #ee6868;
}
.cv3-selection-save-select-wrap {
  position: relative;
  margin-bottom: 16px;
}
.cv3-selection-save-select {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid #444 !important;
  border-radius: 8px;
  background: #333;
  text-align: left;
}
.cv3-selection-save-select > span:first-child {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cv3-selection-save-select > .placeholder {
  color: #777;
}
.cv3-selection-save-select > span:last-child {
  color: #999;
}
.cv3-selection-save-dropdown {
  position: absolute;
  z-index: 2;
  left: 0;
  right: 0;
  top: calc(100% + 4px);
  padding: 4px;
  border: 1px solid #333;
  border-radius: 12px;
  background: #1f1f1f;
  box-shadow: 0 8px 24px #0006;
}
.cv3-selection-save-menu-header {
  display: flex;
  height: 32px;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  margin-bottom: 4px;
  border-bottom: 1px solid #3a3a3a;
  color: #aaa;
}
.cv3-selection-save-menu-header button {
  width: 24px;
  height: 24px;
  padding: 0;
  background: none;
  font-size: 18px;
}
.cv3-selection-save-tree,
.cv3-selection-save-tags {
  max-height: 200px;
  overflow: auto;
}
.cv3-selection-save-folder {
  display: flex;
  min-height: 32px;
  align-items: center;
  gap: 3px;
  padding-right: 6px;
  border-radius: 4px;
}
.cv3-selection-save-folder:hover,
.cv3-selection-save-folder.selected {
  background: #414141;
}
.cv3-selection-save-arrow {
  flex: 0 0 12px;
  width: 12px;
  padding: 0;
  background: none;
}
.cv3-selection-save-folder-name {
  display: flex;
  flex: 1;
  min-width: 0;
  height: 32px;
  align-items: center;
  gap: 6px;
  padding: 0;
  background: none;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cv3-selection-save-folder-name > span {
  font-size: 21px;
}
.cv3-selection-save-folder-add {
  width: 20px;
  height: 24px;
  padding: 0;
  background: none;
  opacity: 0;
}
.cv3-selection-save-folder:hover .cv3-selection-save-folder-add,
.cv3-selection-save-folder:focus-within .cv3-selection-save-folder-add {
  opacity: 1;
}
.cv3-selection-save-tags > button {
  display: flex;
  width: 100%;
  height: 32px;
  justify-content: space-between;
  align-items: center;
  padding: 0 8px;
  border-radius: 4px;
  background: none;
  text-align: left;
}
.cv3-selection-save-tags > button:hover,
.cv3-selection-save-tags > button[aria-selected='true'] {
  background: #414141;
}
.cv3-selection-save-create {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 4px;
}
.cv3-selection-save-create input {
  width: 0;
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 6px;
  border: 1px solid #555;
  border-radius: 4px;
  background: #333;
}
.cv3-selection-save-create button {
  padding: 3px;
  background: none;
}
.cv3-selection-save-error,
.cv3-selection-save-notice {
  margin: 0 0 8px;
  font-size: 12px;
  line-height: 1.5;
}
.cv3-selection-save-error {
  color: #ef9696;
}
.cv3-selection-save-notice {
  color: #aaa;
}
.cv3-selection-save-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 16px;
  margin-top: auto;
}
.cv3-selection-save-actions button {
  min-width: 50px;
  height: 32px;
  padding: 0 12px;
  border-radius: 6px;
  background: #393939;
}
.cv3-selection-save-actions .cv3-selection-save-submit {
  background: #f3f3f3;
  color: #222;
}
@media (max-width: 700px) {
  .cv3-selection-save-dialog {
    height: auto;
    overflow: auto;
  }
  .cv3-selection-save-body {
    flex-direction: column;
    padding: 16px;
    gap: 16px;
  }
  .cv3-selection-save-materials {
    height: auto;
    min-height: 210px;
    max-height: 45dvh;
    flex: none;
  }
  .cv3-selection-save-fields {
    width: 100%;
    flex: none;
  }
  .cv3-selection-save-thumbnail {
    max-width: none;
  }
  .cv3-selection-save-dropdown {
    position: relative;
    top: auto;
    margin-top: 4px;
  }
}
</style>
