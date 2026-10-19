<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  DIRECTOR_ATTACHMENT_ACCEPT,
  normalizeDirectorAsset,
} from '../config/directorAttachments.js'
import CanvasIcon from './CanvasIcon.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  availableAssets: { type: Array, default: () => [] },
  attachedIds: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:open', 'local-files', 'select-assets'])
const root = ref(null)
const trigger = ref(null)
const fileInput = ref(null)
const libraryDialog = ref(null)
const search = ref('')
const filter = ref('all')
const libraryOpen = ref(false)
const libraryLocation = ref('root')
const searchOpen = ref(false)
const filterOpen = ref(false)
const createOpen = ref(false)
const selectedIds = ref(new Set())
const customFolders = ref([])

const folderDate = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
  .format(new Date())
  .replaceAll('/', '-')

const normalizedAssets = computed(() =>
  props.availableAssets.map(normalizeDirectorAsset).filter(Boolean),
)
const visibleAssets = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return normalizedAssets.value.filter((asset) => {
    if (filter.value !== 'all' && asset.kind !== filter.value) return false
    return !query || `${asset.name} ${asset.kind}`.toLocaleLowerCase().includes(query)
  })
})
const selectableCount = computed(
  () =>
    [...selectedIds.value].filter((id) => normalizedAssets.value.some((asset) => asset.id === id))
      .length,
)

function setOpen(value, { restoreFocus = false } = {}) {
  emit('update:open', Boolean(value))
  if (!value) {
    libraryOpen.value = false
    selectedIds.value = new Set()
    search.value = ''
    filter.value = 'all'
    libraryLocation.value = 'root'
    searchOpen.value = false
    filterOpen.value = false
    createOpen.value = false
    if (restoreFocus) nextTick(() => trigger.value?.focus({ preventScroll: true }))
  }
}

function toggleMenu() {
  setOpen(!props.open, { restoreFocus: props.open })
}

function chooseLocalFiles() {
  emit('update:open', false)
  nextTick(() => fileInput.value?.click())
}

function onFiles(event) {
  const files = [...(event.target.files || [])]
  if (files.length) emit('local-files', files)
  event.target.value = ''
  nextTick(() => trigger.value?.focus({ preventScroll: true }))
}

function openLibrary() {
  const attached = new Set(props.attachedIds.map(String))
  selectedIds.value = new Set(
    normalizedAssets.value
      .filter((asset) => attached.has(String(asset.id)))
      .map((asset) => asset.id),
  )
  libraryLocation.value = 'root'
  searchOpen.value = false
  filterOpen.value = false
  createOpen.value = false
  libraryOpen.value = true
  nextTick(() => libraryDialog.value?.focus({ preventScroll: true }))
}

function openUnsortedFolder() {
  libraryLocation.value = 'unsorted'
  selectedIds.value = new Set()
}

function returnToLibraryRoot() {
  libraryLocation.value = 'root'
  search.value = ''
  filter.value = 'all'
  searchOpen.value = false
  filterOpen.value = false
  createOpen.value = false
  selectedIds.value = new Set()
}

function toggleSearch() {
  searchOpen.value = !searchOpen.value
  filterOpen.value = false
  createOpen.value = false
  if (searchOpen.value)
    nextTick(() => libraryDialog.value?.querySelector('[data-asset-search]')?.focus())
}

function toggleFilter() {
  filterOpen.value = !filterOpen.value
  searchOpen.value = false
  createOpen.value = false
}

function toggleCreate() {
  createOpen.value = !createOpen.value
  searchOpen.value = false
  filterOpen.value = false
}

function pickFilter(value) {
  filter.value = value
  filterOpen.value = false
}

function createFolder() {
  const number = customFolders.value.length + 1
  customFolders.value.push({ id: `folder-${Date.now()}-${number}`, name: `新建文件夹 ${number}` })
  createOpen.value = false
}

function toggleAsset(assetId) {
  const next = new Set(selectedIds.value)
  if (next.has(assetId)) next.delete(assetId)
  else next.add(assetId)
  selectedIds.value = next
}

function confirmAssets() {
  const selected = normalizedAssets.value.filter((asset) => selectedIds.value.has(asset.id))
  emit('select-assets', selected)
  setOpen(false, { restoreFocus: true })
}

function closeLibrary() {
  setOpen(false, { restoreFocus: true })
}

function handleDocumentPointerDown(event) {
  if (!props.open || libraryOpen.value || root.value?.contains(event.target)) return
  setOpen(false)
}

function handleDocumentKeydown(event) {
  if (!props.open || event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  if (libraryOpen.value) closeLibrary()
  else setOpen(false, { restoreFocus: true })
}

function handleDialogKeydown(event) {
  if (event.key !== 'Tab') return
  const focusable = [
    ...(libraryDialog.value?.querySelectorAll(
      'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ) || []),
  ]
  if (!focusable.length) return
  const current = focusable.indexOf(document.activeElement)
  if (event.shiftKey && current <= 0) {
    event.preventDefault()
    focusable.at(-1)?.focus()
  } else if (!event.shiftKey && current === focusable.length - 1) {
    event.preventDefault()
    focusable[0]?.focus()
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      document.addEventListener('pointerdown', handleDocumentPointerDown, true)
      document.addEventListener('keydown', handleDocumentKeydown, true)
    } else {
      libraryOpen.value = false
      document.removeEventListener('pointerdown', handleDocumentPointerDown, true)
      document.removeEventListener('keydown', handleDocumentKeydown, true)
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown, true)
  document.removeEventListener('keydown', handleDocumentKeydown, true)
})
</script>

<template>
  <div ref="root" class="cv3-director-attachment-picker">
    <button
      ref="trigger"
      type="button"
      title="添加附件"
      aria-label="添加附件"
      aria-haspopup="dialog"
      :aria-expanded="open"
      @click.stop="toggleMenu"
    >
      <CanvasIcon name="plus" :size="18" />
    </button>
    <input
      ref="fileInput"
      class="cv3-director-hidden-input"
      type="file"
      multiple
      :accept="DIRECTOR_ATTACHMENT_ACCEPT"
      @change="onFiles"
    />

    <Transition name="cv3-director-popover">
      <div
        v-if="open && !libraryOpen"
        class="cv3-director-attachment-menu"
        role="dialog"
        aria-label="添加附件"
        @pointerdown.stop
      >
        <button type="button" @click="chooseLocalFiles">
          <CanvasIcon name="upload" :size="16" />
          <span>本地上传</span>
        </button>
        <button type="button" @click="openLibrary">
          <CanvasIcon name="assets" :size="16" />
          <span>素材库添加</span>
        </button>
      </div>
    </Transition>

    <Teleport to="body">
      <Transition name="cv3-director-attachment-dialog">
        <div
          v-if="open && libraryOpen"
          class="cv3-director-asset-backdrop"
          data-canvas-shortcuts-ignore
          @pointerdown.self="closeLibrary"
        >
          <section
            ref="libraryDialog"
            class="cv3-director-asset-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cv3-director-asset-dialog-title"
            tabindex="-1"
            @keydown="handleDialogKeydown"
          >
            <header>
              <h2 id="cv3-director-asset-dialog-title">资产管理</h2>
              <button type="button" aria-label="关闭素材库" @click="closeLibrary">
                <CanvasIcon name="close" :size="18" />
              </button>
            </header>

            <div class="cv3-director-asset-subheader">
              <nav aria-label="资产位置">
                <button
                  v-if="libraryLocation === 'unsorted'"
                  type="button"
                  @click="returnToLibraryRoot"
                >
                  个人资产库
                </button>
                <strong v-else>个人资产库</strong>
                <template v-if="libraryLocation === 'unsorted'">
                  <CanvasIcon name="chevron" :size="13" />
                  <span>待分类资产</span>
                </template>
              </nav>
              <div class="cv3-director-asset-actions">
                <label v-if="searchOpen" class="cv3-director-asset-search">
                  <CanvasIcon name="search" :size="16" />
                  <input
                    v-model="search"
                    data-asset-search
                    type="search"
                    placeholder="搜索"
                    aria-label="搜索素材"
                  />
                </label>
                <button v-else type="button" aria-label="搜索" title="搜索" @click="toggleSearch">
                  <CanvasIcon name="search" :size="19" />
                </button>
                <button
                  type="button"
                  aria-label="筛选"
                  title="筛选"
                  :aria-expanded="filterOpen"
                  @click="toggleFilter"
                >
                  <CanvasIcon name="filter" :size="19" />
                </button>
                <button
                  type="button"
                  class="cv3-director-asset-new"
                  :aria-expanded="createOpen"
                  @click="toggleCreate"
                >
                  <CanvasIcon name="plus" :size="17" />
                  <span>新建</span>
                </button>
                <div v-if="filterOpen" class="cv3-director-asset-action-menu is-filter" role="menu">
                  <button
                    v-for="(label, value) in {
                      all: '全部素材',
                      image: '图片',
                      video: '视频',
                      audio: '音频',
                    }"
                    :key="value"
                    type="button"
                    role="menuitemradio"
                    :aria-checked="filter === value"
                    @click="pickFilter(value)"
                  >
                    <CanvasIcon v-if="filter === value" name="check" :size="13" />
                    <span v-else class="cv3-director-asset-menu-spacer" />
                    {{ label }}
                  </button>
                </div>
                <div v-if="createOpen" class="cv3-director-asset-action-menu is-create" role="menu">
                  <button type="button" role="menuitem" @click="chooseLocalFiles">
                    <CanvasIcon name="upload" :size="15" />
                    上传资产
                  </button>
                  <button type="button" role="menuitem" @click="createFolder">
                    <CanvasIcon name="folder" :size="15" />
                    新建文件夹
                  </button>
                </div>
              </div>
            </div>

            <div v-if="libraryLocation === 'root'" class="cv3-director-folder-grid">
              <button type="button" class="cv3-director-folder-card" @click="openUnsortedFolder">
                <span class="cv3-director-folder-preview">
                  <CanvasIcon name="folder" :size="54" />
                </span>
                <strong>待分类资产</strong>
                <small>{{ folderDate }}</small>
              </button>
              <button
                v-for="folder in customFolders"
                :key="folder.id"
                type="button"
                class="cv3-director-folder-card"
              >
                <span class="cv3-director-folder-preview">
                  <CanvasIcon name="folder" :size="54" />
                </span>
                <strong>{{ folder.name }}</strong>
                <small>{{ folderDate }}</small>
              </button>
            </div>

            <template v-else>
              <div
                v-if="visibleAssets.length"
                class="cv3-director-asset-grid"
                role="listbox"
                aria-label="素材"
                aria-multiselectable="true"
              >
                <button
                  v-for="asset in visibleAssets"
                  :key="asset.id"
                  type="button"
                  role="option"
                  :aria-selected="selectedIds.has(asset.id)"
                  :class="{ 'is-selected': selectedIds.has(asset.id) }"
                  @click="toggleAsset(asset.id)"
                >
                  <span class="cv3-director-asset-preview">
                    <img v-if="asset.kind === 'image'" :src="asset.previewUrl" :alt="asset.name" />
                    <video
                      v-else-if="asset.kind === 'video'"
                      :src="asset.previewUrl"
                      muted
                      preload="metadata"
                    />
                    <CanvasIcon
                      v-else
                      :name="asset.kind === 'audio' ? 'audio' : 'assets'"
                      :size="28"
                    />
                    <span v-if="selectedIds.has(asset.id)" class="cv3-director-asset-check">
                      <CanvasIcon name="check" :size="13" />
                    </span>
                  </span>
                  <span class="cv3-director-asset-name">{{ asset.name }}</span>
                  <small>
                    {{ asset.kind === 'image' ? '图片' : asset.kind === 'video' ? '视频' : '音频' }}
                  </small>
                </button>
              </div>
              <div v-else class="cv3-director-asset-empty">
                <strong>{{ normalizedAssets.length ? '没有匹配的素材' : '当前暂无资产' }}</strong>
                <p v-if="normalizedAssets.length">换个关键词或筛选条件试试</p>
                <button type="button" @click="chooseLocalFiles">
                  <CanvasIcon name="upload" :size="15" />
                  上传资产
                </button>
              </div>

              <footer v-if="selectableCount">
                <span>已选择 {{ selectableCount }} 项</span>
                <div>
                  <button type="button" @click="selectedIds = new Set()">取消选择</button>
                  <button type="button" class="is-primary" @click="confirmAssets">
                    添加（{{ selectableCount }}）
                  </button>
                </div>
              </footer>
            </template>
          </section>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.cv3-director-attachment-picker {
  position: relative;
  display: inline-flex;
}

.cv3-director-attachment-picker > button {
  display: inline-flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.58);
  cursor: pointer;
  transition:
    background-color 150ms ease,
    color 150ms ease;
}

.cv3-director-attachment-picker > button:hover,
.cv3-director-attachment-picker > button:focus-visible {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  outline: none;
}

.cv3-director-attachment-picker > button[aria-expanded='true'] {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.cv3-director-hidden-input {
  display: none;
}

.cv3-director-attachment-menu {
  position: absolute;
  z-index: 190;
  bottom: 46px;
  left: -52px;
  display: flex;
  width: 154px;
  flex-direction: column;
  padding: 3px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 12px;
  background: #282828;
  box-shadow:
    0 14px 30px rgba(0, 0, 0, 0.42),
    0 2px 8px rgba(0, 0, 0, 0.32);
}

.cv3-director-attachment-menu button {
  display: flex;
  width: 100%;
  height: 36px;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: rgba(255, 255, 255, 0.9);
  cursor: pointer;
  font-size: 13px;
  text-align: left;
}

.cv3-director-attachment-menu button:hover,
.cv3-director-attachment-menu button:focus-visible {
  background: rgba(255, 255, 255, 0.09);
  outline: none;
}

.cv3-director-attachment-menu button :deep(svg) {
  flex: 0 0 auto;
  color: rgba(255, 255, 255, 0.58);
}

.cv3-director-popover-enter-active,
.cv3-director-popover-leave-active {
  transition:
    opacity 150ms ease,
    transform 180ms cubic-bezier(0.2, 0, 0, 1);
  transform-origin: bottom center;
}

.cv3-director-popover-enter-from,
.cv3-director-popover-leave-to {
  opacity: 0;
  transform: translateY(5px) scale(0.98);
}

.cv3-director-asset-backdrop {
  position: fixed;
  z-index: 2500;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.72);
}

.cv3-director-asset-dialog {
  display: flex;
  width: min(1106px, calc(100vw - 32px));
  height: min(732px, calc(100vh - 32px));
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #454545;
  border-radius: 22px;
  background: #252525;
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.62);
  color: #f2f2f2;
}

.cv3-director-asset-dialog > header,
.cv3-director-asset-dialog > footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
}

.cv3-director-asset-dialog > header {
  min-height: 72px;
  padding: 0 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.cv3-director-asset-dialog h2,
.cv3-director-asset-dialog p {
  margin: 0;
}

.cv3-director-asset-dialog h2 {
  font-size: 18px;
  font-weight: 600;
}

.cv3-director-asset-dialog header p {
  margin-top: 5px;
  color: rgba(255, 255, 255, 0.42);
  font-size: 12px;
}

.cv3-director-asset-dialog header > button {
  display: inline-flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
}

.cv3-director-asset-dialog header > button:hover,
.cv3-director-asset-dialog header > button:focus-visible {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  outline: none;
}

.cv3-director-asset-subheader {
  display: flex;
  min-height: 60px;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 0 16px;
}

.cv3-director-asset-subheader nav {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  color: rgba(255, 255, 255, 0.9);
  font-size: 15px;
}

.cv3-director-asset-subheader nav button {
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.92);
  cursor: pointer;
  font: inherit;
  font-weight: 600;
}

.cv3-director-asset-subheader nav button:hover,
.cv3-director-asset-subheader nav button:focus-visible {
  color: #fff;
  text-decoration: underline;
  outline: none;
}

.cv3-director-asset-subheader nav span {
  overflow: hidden;
  color: rgba(255, 255, 255, 0.52);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv3-director-asset-actions {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
}

.cv3-director-asset-actions > button {
  display: inline-flex;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: rgba(255, 255, 255, 0.72);
  cursor: pointer;
}

.cv3-director-asset-actions > button:hover,
.cv3-director-asset-actions > button:focus-visible,
.cv3-director-asset-actions > button[aria-expanded='true'] {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  outline: none;
}

.cv3-director-asset-actions > button.cv3-director-asset-new {
  width: auto;
  min-width: 80px;
  gap: 5px;
  margin-left: 8px;
  padding: 0 14px;
  border-radius: 10px;
  background: #f2f2f2;
  color: #222;
  font-size: 14px;
}

.cv3-director-asset-actions > button.cv3-director-asset-new:hover,
.cv3-director-asset-actions > button.cv3-director-asset-new:focus-visible,
.cv3-director-asset-actions > button.cv3-director-asset-new[aria-expanded='true'] {
  background: #fff;
  color: #111;
}

.cv3-director-asset-search {
  display: flex;
  width: 210px;
  height: 36px;
  align-items: center;
  gap: 7px;
  padding: 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 9px;
  background: #303030;
  color: rgba(255, 255, 255, 0.5);
}

.cv3-director-asset-search input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: none;
  background: transparent;
  color: #fff;
}

.cv3-director-asset-action-menu {
  position: absolute;
  z-index: 2;
  top: 43px;
  right: 0;
  display: flex;
  width: 150px;
  flex-direction: column;
  padding: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 11px;
  background: #303030;
  box-shadow: 0 16px 38px rgba(0, 0, 0, 0.45);
}

.cv3-director-asset-action-menu.is-filter {
  right: 91px;
}

.cv3-director-asset-action-menu button {
  display: flex;
  height: 34px;
  align-items: center;
  gap: 8px;
  padding: 0 9px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.86);
  cursor: pointer;
  font-size: 12px;
  text-align: left;
}

.cv3-director-asset-action-menu button:hover,
.cv3-director-asset-action-menu button:focus-visible {
  background: rgba(255, 255, 255, 0.08);
  outline: none;
}

.cv3-director-asset-menu-spacer {
  width: 13px;
}

.cv3-director-folder-grid {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: repeat(auto-fill, 136px);
  align-content: start;
  gap: 18px;
  overflow: auto;
  padding: 2px 17px 24px;
}

.cv3-director-folder-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: #f2f2f2;
  cursor: pointer;
  text-align: left;
}

.cv3-director-folder-preview {
  display: flex;
  width: 136px;
  height: 136px;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 13px;
  background: #303030;
  color: #a9a9a9;
  transition:
    border-color 140ms ease,
    background-color 140ms ease;
}

.cv3-director-folder-card:hover .cv3-director-folder-preview,
.cv3-director-folder-card:focus-visible .cv3-director-folder-preview {
  border-color: rgba(255, 255, 255, 0.2);
  background: #343434;
}

.cv3-director-folder-card strong,
.cv3-director-folder-card small {
  overflow: hidden;
  width: 100%;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv3-director-folder-card strong {
  padding: 9px 4px 0;
  font-size: 13px;
  font-weight: 500;
}

.cv3-director-folder-card small {
  padding: 4px 4px 0;
  color: rgba(255, 255, 255, 0.32);
  font-size: 11px;
}

.cv3-director-asset-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 20px;
}

.cv3-director-asset-toolbar label {
  display: flex;
  width: min(280px, 48%);
  height: 36px;
  align-items: center;
  gap: 8px;
  padding: 0 11px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  background: #292929;
  color: rgba(255, 255, 255, 0.45);
}

.cv3-director-asset-toolbar input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: none;
  background: transparent;
  color: #f3f3f3;
}

.cv3-director-asset-toolbar [role='tablist'] {
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.045);
}

.cv3-director-asset-toolbar [role='tab'] {
  height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  font-size: 12px;
}

.cv3-director-asset-toolbar [role='tab'].is-active {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.cv3-director-asset-grid {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  align-content: start;
  gap: 12px;
  overflow: auto;
  padding: 2px 20px 18px;
}

.cv3-director-asset-grid > button {
  min-width: 0;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 12px;
  outline: none;
  background: transparent;
  color: #eee;
  cursor: pointer;
  text-align: left;
}

.cv3-director-asset-grid > button:hover,
.cv3-director-asset-grid > button:focus-visible {
  border-color: rgba(255, 255, 255, 0.28);
}

.cv3-director-asset-grid > button.is-selected {
  border-color: #2aa8ff;
  box-shadow: 0 0 0 1px #2aa8ff;
}

.cv3-director-asset-preview {
  position: relative;
  display: flex;
  aspect-ratio: 4 / 3;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 10px;
  background: #2b2b2b;
  color: rgba(255, 255, 255, 0.4);
}

.cv3-director-asset-preview img,
.cv3-director-asset-preview video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cv3-director-asset-check {
  position: absolute;
  top: 7px;
  right: 7px;
  display: flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border: 2px solid #fff;
  border-radius: 50%;
  background: #168df0;
  color: #fff;
}

.cv3-director-asset-name,
.cv3-director-asset-grid small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv3-director-asset-name {
  padding: 8px 8px 0;
  font-size: 12px;
}

.cv3-director-asset-grid small {
  padding: 3px 8px 8px;
  color: rgba(255, 255, 255, 0.36);
  font-size: 10px;
}

.cv3-director-asset-empty {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.34);
}

.cv3-director-asset-empty strong {
  margin-top: 12px;
  color: rgba(255, 255, 255, 0.74);
  font-size: 14px;
}

.cv3-director-asset-empty p {
  margin-top: 5px;
  font-size: 12px;
}

.cv3-director-asset-empty button {
  margin-top: 15px;
  padding: 7px 15px;
  border: 0;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  cursor: pointer;
}

.cv3-director-asset-dialog > footer {
  min-height: 64px;
  padding: 12px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.48);
  font-size: 12px;
}

.cv3-director-asset-dialog > footer > div {
  display: flex;
  gap: 8px;
}

.cv3-director-asset-dialog > footer button {
  min-width: 76px;
  height: 36px;
  padding: 0 14px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 9px;
  background: transparent;
  color: rgba(255, 255, 255, 0.78);
  cursor: pointer;
}

.cv3-director-asset-dialog > footer button.is-primary {
  border-color: #ededed;
  background: #ededed;
  color: #151515;
}

.cv3-director-asset-dialog > footer button:disabled {
  border-color: rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.24);
  cursor: default;
}

.cv3-director-attachment-dialog-enter-active,
.cv3-director-attachment-dialog-leave-active {
  transition: opacity 150ms ease;
}

.cv3-director-attachment-dialog-enter-active .cv3-director-asset-dialog,
.cv3-director-attachment-dialog-leave-active .cv3-director-asset-dialog {
  transition: transform 180ms cubic-bezier(0.2, 0, 0, 1);
}

.cv3-director-attachment-dialog-enter-from,
.cv3-director-attachment-dialog-leave-to {
  opacity: 0;
}

.cv3-director-attachment-dialog-enter-from .cv3-director-asset-dialog,
.cv3-director-attachment-dialog-leave-to .cv3-director-asset-dialog {
  transform: translateY(8px) scale(0.98);
}

@media (max-width: 640px) {
  .cv3-director-asset-backdrop {
    padding: 8px;
  }

  .cv3-director-asset-dialog {
    width: calc(100vw - 16px);
    height: calc(100vh - 16px);
    border-radius: 16px;
  }

  .cv3-director-asset-subheader {
    align-items: flex-start;
    flex-direction: column;
    padding-block: 10px;
  }

  .cv3-director-asset-actions {
    width: 100%;
    justify-content: flex-end;
  }

  .cv3-director-asset-search {
    min-width: 0;
    flex: 1;
  }

  .cv3-director-folder-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .cv3-director-folder-preview {
    width: 100%;
    height: auto;
    aspect-ratio: 1;
  }

  .cv3-director-asset-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .cv3-director-asset-toolbar label {
    width: 100%;
  }

  .cv3-director-asset-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (prefers-reduced-motion: reduce) {
  .cv3-director-attachment-dialog-enter-active,
  .cv3-director-attachment-dialog-leave-active,
  .cv3-director-attachment-dialog-enter-active .cv3-director-asset-dialog,
  .cv3-director-attachment-dialog-leave-active .cv3-director-asset-dialog {
    transition: none;
  }
}
</style>
