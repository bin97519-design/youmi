<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useUserStore } from '../../../stores/user'
import { apiPath } from '../../../utils/apiBase'
import { uploadFileDirect } from '../../../utils/ossUpload'
import { useCanvasV3GraphStore } from '../stores/graph'
import {
  PRODUCT_ASSET_CATEGORIES,
  PRODUCT_ASSET_CATEGORY_FILTERS,
  personalAssetImageUrl,
  personalAssetKind,
  personalAssetLibrary,
  personalProductCategory,
} from '../config/personalAssetLibrary.js'
import { createPersonalAssetLibraryClient } from '../sync/personalAssetLibraryClient.js'
import CanvasIcon from './CanvasIcon.vue'
import PersonalAssetCarousel from './PersonalAssetCarousel.vue'

const props = defineProps({
  kind: {
    type: String,
    required: true,
    validator: (value) => ['product', 'scene'].includes(value),
  },
})
const emit = defineEmits(['busy-change'])
const user = useUserStore()
const graph = useCanvasV3GraphStore()
const info = computed(() => personalAssetLibrary(props.kind))
const client = computed(() =>
  createPersonalAssetLibraryClient({
    kind: props.kind,
    path: apiPath,
    headers: () => user.authHeaders(),
  }),
)
const items = ref([])
const query = ref('')
const searchVisible = ref(false)
const searchInput = ref(null)
const searchToggle = ref(null)
const mode = ref('grid')
const previousMode = ref('grid')
const multiSelect = ref(false)
const selectedIds = ref([])
const selectedCategories = ref([])
const categoryMenu = ref(false)
const categoryTrigger = ref(null)
const categoryText = computed(() =>
  PRODUCT_ASSET_CATEGORY_FILTERS.filter((value) => selectedCategories.value.includes(value)).join(
    '、',
  ),
)
const selectedId = ref('')
const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const uploading = ref(false)
const uploadProgress = ref(0)
const error = ref('')
const notice = ref('')
const draft = ref(null)
const draftCategory = ref('')
const categoryChanged = ref(false)
const picker = ref(false)
const deleteTarget = ref(null)
const uploadInput = ref(null)
const nameInput = ref(null)
const confirmCancel = ref(null)
const busy = computed(() => saving.value || deleting.value || uploading.value)
const filtered = computed(() => {
  const term = query.value.trim().toLocaleLowerCase()
  return items.value.filter(
    (item) =>
      `${item.name} ${item.description || ''}`.toLocaleLowerCase().includes(term) &&
      (props.kind !== 'product' ||
        !selectedCategories.value.length ||
        selectedCategories.value.includes(personalProductCategory(item) || '未分类')),
  )
})
const hasFilters = computed(() => query.value.trim() || selectedCategories.value.length)
const selected = computed(() => filtered.value.find((item) => item.id === selectedId.value) || null)
const selectedItems = computed(() =>
  filtered.value.filter((item) => selectedIds.value.includes(item.id)),
)
const actionItems = computed(() =>
  multiSelect.value ? selectedItems.value : selected.value ? [selected.value] : [],
)
const canvasImages = computed(() =>
  graph.nodes.filter(
    (node) => node.data?.kind === 'image' && personalAssetImageUrl(node.data.assetUrl),
  ),
)
let disposed = false
let requestVersion = 0
let listVersion = 0
let listController
let actionController
let uploadController
let previousFocus
const clone = (value) => JSON.parse(JSON.stringify(value))
const current = (version, kind) => !disposed && version === requestVersion && kind === props.kind
watch(busy, (value) => emit('busy-change', value), { immediate: true })
watch([filtered, mode], ([visible, view]) => {
  const ids = new Set(visible.map((item) => item.id))
  selectedIds.value = selectedIds.value.filter((id) => ids.has(id))
  if (view === 'carousel' && !ids.has(selectedId.value)) selectedId.value = visible[0]?.id || ''
})
watch(
  () => Boolean(draft.value || deleteTarget.value),
  async (open) => {
    if (open && typeof document !== 'undefined') previousFocus = document.activeElement
    await nextTick()
    if (disposed || Boolean(draft.value || deleteTarget.value) !== open) return
    if (open) (nameInput.value || confirmCancel.value)?.focus?.()
    else restoreFocus()
  },
  { flush: 'post' },
)
function restoreFocus() {
  if (previousFocus?.isConnected !== false) previousFocus?.focus?.({ preventScroll: true })
  previousFocus = null
}

function stopList() {
  listController?.abort()
  listController = null
  listVersion += 1
  loading.value = false
}
async function showSearch() {
  if (busy.value) return
  categoryMenu.value = false
  searchVisible.value = true
  await nextTick()
  searchInput.value?.focus?.()
}
function blurSearch(event) {
  if (busy.value || query.value.trim() || event?.relatedTarget?.closest?.('.cv3-personal-search'))
    return
  searchVisible.value = false
}
async function clearSearch() {
  if (busy.value) return
  query.value = ''
  await nextTick()
  searchInput.value?.focus?.()
}
function setView(value) {
  if (busy.value || !['grid', 'carousel'].includes(value)) return
  categoryMenu.value = false
  mode.value = value
}
function toggleMultiSelect() {
  if (busy.value) return
  categoryMenu.value = false
  if (multiSelect.value) {
    multiSelect.value = false
    selectedIds.value = []
    mode.value = previousMode.value
  } else {
    previousMode.value = mode.value
    mode.value = 'grid'
    selectedIds.value = selected.value ? [selected.value.id] : []
    multiSelect.value = true
  }
}
function activateAsset(id) {
  if (busy.value || !filtered.value.some((item) => item.id === id)) return
  selectedId.value = id
}
function selectAsset(id) {
  if (busy.value || !filtered.value.some((item) => item.id === id)) return
  selectedId.value = id
  if (multiSelect.value)
    selectedIds.value = selectedIds.value.includes(id)
      ? selectedIds.value.filter((value) => value !== id)
      : [...selectedIds.value, id]
}
function toggleCategory(value) {
  if (busy.value || props.kind !== 'product' || !PRODUCT_ASSET_CATEGORY_FILTERS.includes(value))
    return
  selectedCategories.value = selectedCategories.value.includes(value)
    ? selectedCategories.value.filter((entry) => entry !== value)
    : [...selectedCategories.value, value]
}
async function clearCategories() {
  if (busy.value) return
  selectedCategories.value = []
  categoryMenu.value = false
  await nextTick()
  categoryTrigger.value?.focus?.({ preventScroll: true })
}
function resetFilters() {
  if (busy.value) return
  query.value = ''
  selectedCategories.value = []
  categoryMenu.value = false
}
function dismissCategoryMenu(event) {
  if (!event.target.closest?.('[data-product-category-menu]')) categoryMenu.value = false
}
function setDraftCategory(value) {
  if (busy.value || props.kind !== 'product') return
  draftCategory.value = PRODUCT_ASSET_CATEGORIES.includes(value) ? value : ''
  categoryChanged.value = true
}
function handleEscape(event) {
  if (categoryMenu.value && !draft.value && !deleteTarget.value) {
    event.stopPropagation()
    event.preventDefault()
    categoryMenu.value = false
    void nextTick(() => categoryTrigger.value?.focus?.({ preventScroll: true }))
    return
  }
  if (!draft.value && !deleteTarget.value && !picker.value) {
    if (searchVisible.value) {
      event.stopPropagation()
      event.preventDefault()
      if (query.value) query.value = ''
      else {
        searchVisible.value = false
        void nextTick(() => searchToggle.value?.focus?.({ preventScroll: true }))
      }
      return
    }
    if (multiSelect.value) {
      event.stopPropagation()
      event.preventDefault()
      toggleMultiSelect()
      return
    }
  }
  if (!draft.value && !deleteTarget.value && !picker.value) return
  event.stopPropagation()
  event.preventDefault()
  if (busy.value) return
  if (picker.value) picker.value = false
  else if (deleteTarget.value) deleteTarget.value = null
  else closeForm()
}

async function loadLibrary() {
  if (busy.value) return
  listController?.abort()
  const controller = new AbortController()
  listController = controller
  const listRequest = ++listVersion
  const version = requestVersion
  const kind = props.kind
  loading.value = true
  error.value = ''
  try {
    const result = await client.value.list({ signal: controller.signal })
    if (!current(version, kind) || listRequest !== listVersion || controller.signal.aborted) return
    items.value = result.filter((item) => personalAssetKind(item) === kind)
    if (!filtered.value.some((item) => item.id === selectedId.value))
      selectedId.value = filtered.value[0]?.id || ''
  } catch (failure) {
    if (current(version, kind) && listRequest === listVersion && failure.name !== 'AbortError')
      error.value = failure.message || '素材加载失败，请重试'
  } finally {
    if (current(version, kind) && listRequest === listVersion) loading.value = false
    if (listController === controller) listController = null
  }
}
function cancelUpload() {
  uploadController?.abort()
  uploadController = null
  uploading.value = false
  uploadProgress.value = 0
  if (uploadInput.value) uploadInput.value.value = ''
}
function closeForm() {
  if (saving.value) return
  cancelUpload()
  draft.value = null
  picker.value = false
  error.value = ''
}
async function importAsset(source) {
  if (busy.value) return
  categoryMenu.value = false
  draftCategory.value = ''
  categoryChanged.value = false
  draft.value = { name: '', description: '', imageUrl: '', coverUrl: '', config: {} }
  error.value = ''
  notice.value = ''
  picker.value = source === 'canvas'
  if (source === 'upload') {
    await nextTick()
    uploadInput.value?.click()
  }
}
function editAsset() {
  if (!selected.value || busy.value || multiSelect.value) return
  categoryMenu.value = false
  draftCategory.value = personalProductCategory(selected.value)
  categoryChanged.value = false
  draft.value = clone(selected.value)
  error.value = ''
  notice.value = ''
  picker.value = false
}
function selectCanvasImage(node) {
  if (!draft.value || busy.value) return
  const imageUrl = personalAssetImageUrl(node.data?.assetUrl)
  if (!imageUrl) return
  draft.value = {
    ...draft.value,
    name: draft.value.name || node.data.title || `未命名${info.value.singular}`,
    imageUrl,
    coverUrl: imageUrl,
    config: { ...draft.value.config, sourceNodeId: node.id },
  }
  picker.value = false
}
async function uploadImage(event) {
  const input = event.target
  const file = input.files?.[0]
  if (!file || busy.value || !draft.value) {
    input.value = ''
    return
  }
  if (
    !file.type?.startsWith('image/') ||
    file.type.toLowerCase() === 'image/svg+xml' ||
    /\.svgz?$/i.test(file.name || '')
  ) {
    error.value = '请选择 PNG、JPG、WebP 等图片文件，不支持 SVG'
    input.value = ''
    return
  }
  if (file.size > 20 * 1024 * 1024) {
    error.value = '图片不能超过 20 MB'
    input.value = ''
    return
  }
  if (!user.requireLogin()) {
    input.value = ''
    return
  }
  const controller = new AbortController()
  uploadController = controller
  const version = requestVersion
  const kind = props.kind
  uploading.value = true
  uploadProgress.value = 0
  error.value = ''
  try {
    const result = await uploadFileDirect(file, {
      dir: `canvas-library/${kind}`,
      signal: controller.signal,
      onProgress(value) {
        if (!current(version, kind) || uploadController !== controller || controller.signal.aborted)
          return
        const percent = typeof value === 'number' ? value : value?.percent
        uploadProgress.value = Math.max(0, Math.min(100, Number(percent) || 0))
      },
    })
    if (!current(version, kind) || uploadController !== controller || controller.signal.aborted)
      return
    const imageUrl = personalAssetImageUrl(typeof result === 'string' ? result : result?.url)
    if (!imageUrl) throw new Error('上传未返回可用图片地址，请重试')
    draft.value = {
      ...draft.value,
      name: draft.value.name || file.name.replace(/\.[^.]+$/, ''),
      imageUrl,
      coverUrl: imageUrl,
    }
    picker.value = false
  } catch (failure) {
    if (current(version, kind) && uploadController === controller && failure.name !== 'AbortError')
      error.value = failure.message || '图片上传失败，请重试'
  } finally {
    input.value = ''
    if (current(version, kind) && uploadController === controller) {
      uploading.value = false
      uploadController = null
    }
  }
}
async function saveAsset() {
  if (!draft.value || busy.value) return
  const name = typeof draft.value.name === 'string' ? draft.value.name.trim() : ''
  const imageUrl =
    personalAssetImageUrl(draft.value.imageUrl) || personalAssetImageUrl(draft.value.coverUrl)
  if (!name || !imageUrl) {
    error.value = `请填写${info.value.singular}名称并选择一张有效图片`
    return
  }
  if (!user.requireLogin()) return
  stopList()
  const record = {
    ...clone(draft.value),
    name,
    description: typeof draft.value.description === 'string' ? draft.value.description.trim() : '',
    imageUrl,
    coverUrl: personalAssetImageUrl(draft.value.coverUrl) || imageUrl,
    config: { ...clone(draft.value.config || {}), libraryKind: props.kind },
  }
  if (props.kind === 'product' && (!draft.value.id || categoryChanged.value))
    record.config.productCategory = draftCategory.value
  const controller = new AbortController()
  actionController = controller
  const version = requestVersion
  const kind = props.kind
  saving.value = true
  error.value = ''
  try {
    const saved = await client.value.save(record, { signal: controller.signal })
    if (!current(version, kind) || controller.signal.aborted) return
    items.value = [saved, ...items.value.filter((item) => item.id !== saved.id)]
    selectedId.value = saved.id
    query.value = ''
    selectedCategories.value = []
    categoryMenu.value = false
    multiSelect.value = false
    selectedIds.value = []
    draft.value = null
    picker.value = false
    notice.value = `${info.value.singular}已保存到${info.value.label}`
  } catch (failure) {
    if (current(version, kind) && failure.name !== 'AbortError')
      error.value = failure.message || '保存失败，请重试'
  } finally {
    if (current(version, kind)) saving.value = false
    if (actionController === controller) actionController = null
  }
}
function askRemove() {
  if (selected.value && !busy.value && !multiSelect.value)
    deleteTarget.value = clone(selected.value)
}
async function removeAsset() {
  if (!deleteTarget.value || busy.value || !user.requireLogin()) return
  stopList()
  const record = clone(deleteTarget.value)
  const controller = new AbortController()
  actionController = controller
  const version = requestVersion
  const kind = props.kind
  deleting.value = true
  error.value = ''
  try {
    await client.value.remove(record, { signal: controller.signal })
    if (!current(version, kind) || controller.signal.aborted) return
    items.value = items.value.filter((item) => item.id !== record.id)
    selectedId.value = filtered.value[0]?.id || ''
    deleteTarget.value = null
    notice.value = `${info.value.singular}已从素材库移除，画布上的图片不受影响`
  } catch (failure) {
    if (current(version, kind) && failure.name !== 'AbortError')
      error.value = failure.message || '删除失败，请重试'
  } finally {
    if (current(version, kind)) deleting.value = false
    if (actionController === controller) actionController = null
  }
}
function insertAsset() {
  if (busy.value || !actionItems.value.length) return
  const records = actionItems.value.map((record) => ({
    record,
    imageUrl: personalAssetImageUrl(record.imageUrl) || personalAssetImageUrl(record.coverUrl),
  }))
  if (records.some(({ imageUrl }) => !imageUrl)) {
    error.value = '当前素材没有可用的原图，请重新导入'
    return
  }
  for (const { record, imageUrl } of records) {
    const node = graph.addNode('image')
    graph.updateNodeData(node.id, {
      title: record.name,
      assetUrl: imageUrl,
      artifactStatus: 'ready',
      mediaOrigin: 'upload',
      libraryAsset: { kind: props.kind, id: record.id, name: record.name },
    })
  }
  notice.value =
    records.length === 1
      ? `已将「${records[0].record.name}」添加到当前画布`
      : `已将 ${records.length} 项${info.value.singular}素材添加到当前画布`
}
watch(
  () => props.kind,
  () => {
    requestVersion += 1
    listVersion += 1
    listController?.abort()
    actionController?.abort()
    cancelUpload()
    items.value = []
    selectedId.value = ''
    query.value = ''
    searchVisible.value = false
    mode.value = previousMode.value = 'grid'
    multiSelect.value = false
    selectedIds.value = []
    selectedCategories.value = []
    categoryMenu.value = false
    draftCategory.value = ''
    categoryChanged.value = false
    draft.value = null
    deleteTarget.value = null
    picker.value = false
    loading.value = saving.value = deleting.value = false
    error.value = notice.value = ''
    void loadLibrary()
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  disposed = true
  requestVersion += 1
  listController?.abort()
  actionController?.abort()
  uploadController?.abort()
  emit('busy-change', false)
  previousFocus = null
})
</script>

<template>
  <section
    class="cv3-personal-library"
    :aria-label="`${info.label}素材`"
    :aria-busy="busy || loading"
    @pointerdown="dismissCategoryMenu"
    @keydown.esc="handleEscape"
  >
    <div class="cv3-personal-toolbar" role="toolbar" :aria-label="`${info.singular}素材工具栏`">
      <div class="cv3-personal-toolbar-filters">
        <div
          v-if="kind === 'product'"
          class="cv3-personal-category-filter"
          data-product-category-menu
        >
          <div
            class="cv3-character-filter-pill"
            :class="{ 'has-value': selectedCategories.length }"
          >
            <button
              v-if="selectedCategories.length"
              type="button"
              class="cv3-character-filter-pill-clear"
              aria-label="清除类目筛选"
              title="清除类目筛选"
              :disabled="busy"
              @click.stop="clearCategories"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M10 5.29a.5.5 0 0 1 .71.7L8.71 8l2 2a.5.5 0 0 1-.7.71L8 8.71l-2 2a.5.5 0 0 1-.71-.7l2-2.01-2-2a.5.5 0 1 1 .7-.71l2.01 2z"
                  fill="currentColor"
                  fill-opacity=".9"
                />
              </svg>
            </button>
            <button
              ref="categoryTrigger"
              type="button"
              class="cv3-character-filter-trigger"
              :class="{ 'has-value': selectedCategories.length }"
              :aria-label="categoryText ? `类目筛选，已选：${categoryText}` : '类目筛选'"
              :aria-expanded="categoryMenu"
              aria-controls="cv3-personal-product-category-menu"
              :disabled="busy"
              @click="categoryMenu = !categoryMenu"
            >
              <span class="cv3-character-filter-label">类目</span>
              <template v-if="categoryText">
                <span class="cv3-character-filter-divider" aria-hidden="true" />
                <span class="cv3-character-filter-values" :title="categoryText">
                  {{ categoryText }}
                </span>
              </template>
              <CanvasIcon v-else name="chevron" :size="12" />
            </button>
          </div>
          <div
            v-if="categoryMenu"
            id="cv3-personal-product-category-menu"
            class="cv3-character-filter-menu"
            role="group"
            aria-label="类目选项"
          >
            <label
              v-for="category in PRODUCT_ASSET_CATEGORY_FILTERS"
              :key="category"
              :class="{ 'is-selected': selectedCategories.includes(category) }"
            >
              <input
                class="cv3-character-filter-checkbox"
                type="checkbox"
                :checked="selectedCategories.includes(category)"
                :disabled="busy"
                @change="toggleCategory(category)"
              />
              <span>{{ category }}</span>
              <CanvasIcon
                v-if="selectedCategories.includes(category)"
                class="cv3-character-filter-check"
                name="check"
                :size="15"
              />
            </label>
          </div>
        </div>
        <label v-if="searchVisible" class="cv3-personal-search">
          <CanvasIcon name="search" :size="16" />
          <input
            ref="searchInput"
            v-model="query"
            type="search"
            :disabled="busy"
            :aria-label="`搜索${info.singular}`"
            :placeholder="`搜索${info.singular}名称或描述`"
            @blur="blurSearch"
          />
          <button
            v-if="query"
            type="button"
            class="cv3-personal-search-clear"
            :aria-label="`清除${info.singular}搜索`"
            :disabled="busy"
            @click="clearSearch"
          >
            <CanvasIcon name="close" :size="14" />
          </button>
        </label>
        <button
          v-else
          ref="searchToggle"
          type="button"
          class="cv3-personal-toolbar-icon cv3-personal-search-toggle"
          :aria-label="`搜索${info.singular}`"
          :title="`搜索${info.singular}名称或描述`"
          :disabled="busy"
          @click="showSearch"
        >
          <CanvasIcon name="search" :size="16" />
        </button>
      </div>
      <div class="cv3-personal-toolbar-views">
        <button
          type="button"
          class="cv3-personal-toolbar-icon cv3-personal-multi-toggle"
          :class="{ 'is-active': multiSelect }"
          :aria-label="multiSelect ? '退出多选' : '多选'"
          :title="multiSelect ? '退出多选' : '多选'"
          :aria-pressed="multiSelect"
          :disabled="busy"
          @click="toggleMultiSelect"
        >
          <template v-if="multiSelect">
            <CanvasIcon name="close" :size="16" />
            <span>退出多选</span>
          </template>
          <svg v-else width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="3.83" cy="4.83" r="1.33" stroke="currentColor" />
            <circle cx="3.83" cy="11.17" r="1.33" stroke="currentColor" />
            <path
              d="M7.83 4.83h5.67M7.83 11.17h5.67"
              stroke="currentColor"
              stroke-linecap="round"
            />
          </svg>
        </button>
        <div class="cv3-personal-view-segment" role="group" aria-label="素材展示方式">
          <button
            type="button"
            :class="{ 'is-active': mode === 'carousel' }"
            :aria-pressed="mode === 'carousel'"
            aria-label="列表模式"
            title="列表模式"
            :disabled="busy"
            @click="setView('carousel')"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="4.5" y="2" width="7" height="12" rx="2" stroke="currentColor" />
              <path
                d="M3 4H2.5a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1H3m10-8h.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H13"
                stroke="currentColor"
              />
            </svg>
          </button>
          <span class="cv3-personal-view-divider" aria-hidden="true" />
          <button
            type="button"
            :class="{ 'is-active': mode === 'grid' }"
            :aria-pressed="mode === 'grid'"
            aria-label="宫格模式"
            title="宫格模式"
            :disabled="busy"
            @click="setView('grid')"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="currentColor" />
              <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" />
            </svg>
          </button>
        </div>
      </div>
    </div>
    <p v-if="error" class="cv3-personal-error" role="alert">
      {{ error }}
      <button
        v-if="!draft && !deleteTarget"
        type="button"
        :disabled="busy || loading"
        @click="loadLibrary"
      >
        重试
      </button>
    </p>
    <p v-if="notice" class="cv3-personal-notice" role="status">{{ notice }}</p>
    <div class="cv3-personal-content" :class="{ 'is-carousel': mode === 'carousel' }">
      <div v-if="loading" class="cv3-personal-empty" role="status">正在加载{{ info.label }}…</div>
      <div v-else-if="!filtered.length" class="cv3-personal-empty">
        <CanvasIcon :name="kind === 'product' ? 'cube' : 'image'" :size="38" />
        <h2>{{ hasFilters ? '没有找到匹配素材' : info.emptyTitle }}</h2>
        <p>{{ hasFilters ? '调整类目或关键词，或清除条件查看全部素材' : info.emptyDescription }}</p>
        <button
          v-if="selectedCategories.length"
          type="button"
          :disabled="busy"
          @click="resetFilters"
        >
          清除筛选
        </button>
        <button v-else-if="query.trim()" type="button" :disabled="busy" @click="query = ''">
          清空搜索
        </button>
        <button v-else type="button" :disabled="busy" @click="importAsset('upload')">
          {{ info.uploadLabel }}
        </button>
      </div>
      <PersonalAssetCarousel
        v-else-if="mode === 'carousel'"
        :items="filtered"
        :active-id="selectedId"
        :selected-ids="selectedIds"
        :multi-select="multiSelect"
        :disabled="busy"
        :kind="kind"
        @activate="activateAsset"
        @select="selectAsset"
      />
      <div v-else class="cv3-personal-grid" :aria-label="`${info.singular}素材列表`">
        <button
          v-for="item in filtered"
          :key="item.id"
          type="button"
          class="cv3-personal-card"
          :class="{
            'is-selected': multiSelect ? selectedIds.includes(item.id) : selectedId === item.id,
          }"
          :aria-pressed="multiSelect ? selectedIds.includes(item.id) : selectedId === item.id"
          :aria-label="`选择${item.name}`"
          :disabled="busy"
          @click="selectAsset(item.id)"
        >
          <span class="cv3-personal-card-image">
            <img
              :src="personalAssetImageUrl(item.coverUrl) || personalAssetImageUrl(item.imageUrl)"
              :alt="item.name"
              loading="lazy"
            />
          </span>
          <span v-if="multiSelect" class="cv3-personal-selection-check" aria-hidden="true">
            <CanvasIcon v-if="selectedIds.includes(item.id)" name="check" :size="13" />
          </span>
          <strong>{{ item.name }}</strong>
          <small v-if="kind === 'product'" class="cv3-personal-category-badge">
            {{ personalProductCategory(item) || '未分类' }}
          </small>
          <span>{{ item.description || `已保存的${info.singular}素材` }}</span>
        </button>
      </div>
    </div>
    <footer class="cv3-personal-footer">
      <div>
        <button type="button" :disabled="busy" @click="importAsset('upload')">
          <CanvasIcon name="plus" :size="15" />
          从本地上传
        </button>
        <button type="button" :disabled="busy" @click="importAsset('canvas')">
          从当前画布导入
        </button>
        <button
          type="button"
          class="cv3-personal-refresh"
          :aria-label="`刷新${info.singular}库`"
          :title="`刷新${info.singular}库`"
          :disabled="busy || loading"
          @click="loadLibrary"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M13.2 6a5.4 5.4 0 1 0 .1 3.6M13.5 2.5V6h-3.4"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <span v-if="multiSelect" class="cv3-personal-selected-count" role="status">
          已选 {{ selectedItems.length }} 项
        </span>
      </div>
      <div>
        <button
          type="button"
          class="is-danger"
          :disabled="busy || !selected || multiSelect"
          @click="askRemove"
        >
          删除
        </button>
        <button type="button" :disabled="busy || !selected || multiSelect" @click="editAsset">
          编辑
        </button>
        <button
          type="button"
          class="is-primary"
          :disabled="busy || !actionItems.length"
          @click="insertAsset"
        >
          添加到画布
        </button>
      </div>
    </footer>
    <div v-if="draft" class="cv3-personal-overlay cv3-character-inner-scrim">
      <form
        class="cv3-personal-form"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        :aria-label="`${draft.id ? '编辑' : '导入'}${info.singular}`"
        @submit.prevent="saveAsset"
      >
        <header>
          <h2>{{ draft.id ? `编辑${info.singular}` : info.importTitle }}</h2>
          <button
            type="button"
            :aria-label="`关闭${info.singular}表单`"
            :disabled="saving"
            @click="closeForm"
          >
            ×
          </button>
        </header>
        <p>{{ info.importHint }}</p>
        <div class="cv3-personal-preview">
          <img
            v-if="personalAssetImageUrl(draft.imageUrl)"
            :src="draft.imageUrl"
            :alt="`${info.singular}原图预览`"
          />
          <span v-else>请选择{{ info.singular }}图片</span>
        </div>
        <div class="cv3-personal-image-actions">
          <button type="button" :disabled="busy" @click="uploadInput?.click()">上传图片</button>
          <button type="button" :disabled="busy" @click="picker = !picker">选择画布图片</button>
        </div>
        <input
          ref="uploadInput"
          class="cv3-personal-file"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          :aria-label="`上传${info.singular}图片`"
          :disabled="busy"
          @change="uploadImage"
        />
        <div v-if="uploading" class="cv3-personal-upload" role="status">
          上传中 {{ uploadProgress }}%
          <button type="button" @click="cancelUpload">取消上传</button>
        </div>
        <div v-if="picker" class="cv3-personal-canvas-picker" aria-label="当前画布图片">
          <p v-if="!canvasImages.length">当前画布没有可导入的图片，请从本地上传</p>
          <button
            v-for="node in canvasImages"
            :key="node.id"
            type="button"
            :disabled="busy"
            :aria-label="`使用${node.data.title || '画布图片'}`"
            @click="selectCanvasImage(node)"
          >
            <img :src="node.data.assetUrl" :alt="node.data.title || '画布图片'" />
            <span>{{ node.data.title || '画布图片' }}</span>
          </button>
        </div>
        <label>
          {{ info.singular }}名称
          <input
            ref="nameInput"
            v-model="draft.name"
            :aria-label="`${info.singular}名称`"
            maxlength="80"
            :disabled="busy"
            required
          />
        </label>
        <label>
          描述
          <textarea
            v-model="draft.description"
            :aria-label="`${info.singular}描述`"
            maxlength="4000"
            rows="3"
            :disabled="busy"
            placeholder="记录材质、风格、用途等，方便后续查找"
          />
        </label>
        <label v-if="kind === 'product'">
          商品类目
          <select
            aria-label="商品类目"
            :value="draftCategory"
            :disabled="busy"
            @change="setDraftCategory($event.target.value)"
          >
            <option value="">未分类</option>
            <option v-for="category in PRODUCT_ASSET_CATEGORIES" :key="category" :value="category">
              {{ category }}
            </option>
          </select>
        </label>
        <p v-if="error" class="cv3-personal-error" role="alert">{{ error }}</p>
        <footer>
          <button type="button" :disabled="saving" @click="closeForm">取消</button>
          <button type="submit" class="is-primary" :disabled="busy">
            {{ saving ? '保存中…' : `保存到${info.label}` }}
          </button>
        </footer>
      </form>
    </div>
    <div v-if="deleteTarget" class="cv3-personal-overlay cv3-character-inner-scrim">
      <section
        class="cv3-personal-confirm"
        role="alertdialog"
        :aria-label="`删除${info.singular}`"
        aria-modal="true"
      >
        <h2>删除「{{ deleteTarget.name }}」？</h2>
        <p>仅从{{ info.label }}移除，已添加到画布的图片不会被删除。</p>
        <p v-if="error" class="cv3-personal-error" role="alert">{{ error }}</p>
        <footer>
          <button
            ref="confirmCancel"
            type="button"
            :disabled="deleting"
            @click="deleteTarget = null"
          >
            取消
          </button>
          <button type="button" class="is-danger" :disabled="deleting" @click="removeAsset">
            {{ deleting ? '删除中…' : '确认删除' }}
          </button>
        </footer>
      </section>
    </div>
  </section>
</template>

<style scoped>
.cv3-personal-library {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  color: #e8e8e8;
}
.cv3-personal-library button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 13px;
  border: 1px solid #454545;
  border-radius: 9px;
  background: #303030;
  color: #ddd;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.cv3-personal-library button:hover:not(:disabled) {
  background: #3b3b3b;
}
.cv3-personal-library button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.cv3-personal-library button:focus-visible,
.cv3-personal-library input:focus-visible,
.cv3-personal-library textarea:focus-visible,
.cv3-personal-library select:focus-visible {
  outline: 2px solid #aaa;
  outline-offset: 3px;
}
.cv3-personal-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
  box-sizing: border-box;
  height: 32px;
  gap: 16px;
  margin: 16px 0 17px;
  padding: 0 20px;
  color: #929292;
  font-size: 12px;
}
.cv3-personal-toolbar-filters {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.cv3-personal-toolbar-views {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
  height: 32px;
}
.cv3-personal-library .cv3-personal-toolbar-icon {
  flex: none;
  box-sizing: border-box;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 9999px;
  background: #ffffff0f;
  color: #c3c3c3;
}
.cv3-personal-library .cv3-personal-toolbar-icon:hover:not(:disabled) {
  background: #3a3a3a;
}
.cv3-personal-library .cv3-personal-multi-toggle.is-active {
  width: auto;
  gap: 4px;
  padding: 0 12px;
  background: #fff;
  color: #262626;
  font-size: 13px;
  line-height: 20px;
  white-space: nowrap;
}
.cv3-personal-library .cv3-personal-multi-toggle.is-active:hover:not(:disabled) {
  background: #f2f2f2;
}
.cv3-personal-view-segment {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 32px;
  padding: 0 3px;
  border-radius: 9999px;
  background: #ffffff0f;
}
.cv3-personal-library .cv3-personal-view-segment > button {
  flex: none;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 9999px;
  background: transparent;
  color: #929292;
}
.cv3-personal-library .cv3-personal-view-segment > button:hover:not(:disabled) {
  background: #ffffff0f;
  color: #e8e8e8;
}
.cv3-personal-library .cv3-personal-view-segment > button.is-active {
  color: #f2f2f2;
}
.cv3-personal-view-divider {
  width: 1px;
  height: 8px;
  background: #ffffff1a;
}
.cv3-personal-search {
  display: flex;
  flex: 0 1 200px;
  align-items: center;
  gap: 6px;
  width: 200px;
  height: 32px;
  min-width: 80px;
  box-sizing: border-box;
  padding: 0 10px;
  border-radius: 9999px;
  background: #ffffff0f;
}
.cv3-personal-search > .cv3-icon {
  flex: none;
}
.cv3-personal-search:focus-within {
  box-shadow: inset 0 0 0 1px #777;
}
.cv3-personal-library input,
.cv3-personal-library textarea,
.cv3-personal-library select {
  box-sizing: border-box;
  border: 1px solid #4b4b4b;
  border-radius: 8px;
  padding: 9px 11px;
  background: #252525;
  color: #eee;
  font: inherit;
  font-size: 13px;
}
.cv3-personal-search input {
  width: 100%;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  outline: none;
}
.cv3-personal-library .cv3-personal-search input:focus-visible {
  outline: none;
}
.cv3-personal-search input::-webkit-search-cancel-button {
  display: none;
}
.cv3-personal-library .cv3-personal-search-clear {
  flex: none;
  width: 18px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #aaa;
}
.cv3-personal-library .cv3-personal-search-clear:hover:not(:disabled) {
  background: transparent;
  color: #fff;
}
.cv3-personal-category-filter {
  position: relative;
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
}
.cv3-character-filter-pill {
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  height: 32px;
  min-width: 60px;
  max-width: 100%;
  border-radius: 9999px;
  background: #ffffff0f;
  color: #fff;
}
.cv3-character-filter-pill:hover {
  background: #3a3a3a;
}
.cv3-character-filter-pill.has-value {
  gap: 4px;
  padding-left: 10px;
  background: #fff;
  color: #000;
}
.cv3-character-filter-pill.has-value:hover {
  background: #f2f2f2;
}
.cv3-personal-library .cv3-character-filter-trigger {
  gap: 4px;
  box-sizing: border-box;
  height: 32px;
  min-width: 0;
  padding: 0 10px 0 14px;
  border: 0;
  border-radius: 9999px;
  background: transparent;
  color: inherit;
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
  white-space: nowrap;
}
.cv3-personal-library .cv3-character-filter-trigger:hover:not(:disabled) {
  background: transparent;
}
.cv3-personal-library .cv3-character-filter-trigger.has-value {
  padding-left: 0;
}
.cv3-personal-library .cv3-character-filter-pill-clear {
  flex: none;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: inherit;
}
.cv3-personal-library .cv3-character-filter-pill-clear:hover:not(:disabled) {
  background: transparent;
  opacity: 0.55;
}
.cv3-character-filter-label,
.cv3-character-filter-trigger > .cv3-icon {
  flex: none;
}
.cv3-character-filter-divider {
  flex: none;
  width: 1px;
  height: 8px;
  background: #00000026;
}
.cv3-character-filter-values {
  min-width: 0;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cv3-character-filter-trigger > .cv3-icon {
  transition: transform 140ms ease;
}
.cv3-character-filter-trigger[aria-expanded='true'] > .cv3-icon {
  transform: rotate(180deg);
}
.cv3-character-filter-menu {
  position: absolute;
  z-index: 6;
  top: calc(100% + 8px);
  left: 0;
  box-sizing: border-box;
  width: 180px;
  padding: 6px;
  border: 1px solid #343434;
  border-radius: 16px;
  background: #242424;
  box-shadow: 0 12px 32px #0003;
}
.cv3-character-filter-menu label {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  box-sizing: border-box;
  height: 36px;
  padding: 0 8px;
  border-radius: 10px;
  cursor: pointer;
  color: #e4e4e4;
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  user-select: none;
}
.cv3-character-filter-menu label:hover,
.cv3-character-filter-menu label:focus-within {
  background: #343434;
  color: #f5f5f5;
}
.cv3-character-filter-menu label:has(input:focus-visible) {
  outline: 1px solid #929292;
  outline-offset: -1px;
}
.cv3-character-filter-menu label.is-selected {
  color: #fff;
}
.cv3-personal-library .cv3-character-filter-checkbox {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
.cv3-character-filter-check {
  flex: none;
  color: #d7d7d7;
}
.cv3-personal-category-badge {
  align-self: flex-start;
  margin: 5px 0;
  padding: 1px 6px;
  border-radius: 4px;
  background: #ffffff0a;
  color: #aaa;
  font-size: 10px;
}
.cv3-personal-content {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 10px 32px 26px;
  scrollbar-width: thin;
  scrollbar-color: #555 transparent;
}
.cv3-personal-content.is-carousel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
}
.cv3-personal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 22px 18px;
}
.cv3-personal-library .cv3-personal-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  min-width: 0;
  padding: 9px;
  border-color: transparent;
  background: transparent;
  text-align: left;
}
.cv3-personal-selection-check {
  position: absolute;
  top: 17px;
  right: 17px;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: 1px solid #999;
  border-radius: 5px;
  background: #242424cc;
  color: #fff;
}
.is-selected .cv3-personal-selection-check {
  border-color: #eee;
  background: #eee;
  color: #262626;
}
.cv3-personal-library .cv3-personal-card.is-selected {
  border-color: #999;
  background: #ffffff08;
}
.cv3-personal-card-image {
  display: grid;
  place-items: center;
  aspect-ratio: 4/3;
  overflow: hidden;
  border-radius: 9px;
  background: #2d2d2d;
}
.cv3-personal-card img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.cv3-personal-card strong {
  margin-top: 7px;
  font-size: 13px;
  font-weight: 500;
}
.cv3-personal-card > span:last-child {
  color: #8e8e8e;
  font-size: 11px;
}
.cv3-personal-card strong,
.cv3-personal-card > span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cv3-personal-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 260px;
  height: 100%;
  gap: 14px;
  text-align: center;
  color: #939393;
}
.cv3-personal-empty h2 {
  margin: 0;
  color: #c3c3c3;
  font-size: 16px;
  font-weight: 500;
}
.cv3-personal-empty p {
  max-width: 460px;
  margin: 0;
  font-size: 13px;
  line-height: 1.8;
}
.cv3-personal-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 32px 24px;
  border-top: 1px solid #353535;
}
.cv3-personal-footer > div,
.cv3-personal-image-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
  align-items: center;
}
.cv3-personal-selected-count {
  color: #a8a8a8;
  font-size: 12px;
  white-space: nowrap;
}
.cv3-personal-library .cv3-personal-refresh {
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #969696;
}
.cv3-personal-library .is-primary {
  border-color: #ededed;
  background: #ededed;
  color: #252525;
}
.cv3-personal-library .is-primary:hover:not(:disabled) {
  background: #fff;
}
.cv3-personal-library .is-danger {
  color: #e8a4a4;
}
.cv3-personal-error,
.cv3-personal-notice {
  margin: 0 32px 10px;
  padding: 9px 12px;
  border-radius: 8px;
  background: #ffffff06;
  font-size: 12px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.cv3-personal-error {
  color: #eeb2a5;
}
.cv3-personal-notice {
  color: #c5dbc7;
}
.cv3-personal-overlay {
  position: absolute;
  z-index: 8;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: #171717ed;
}
.cv3-personal-form,
.cv3-personal-confirm {
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-sizing: border-box;
  width: min(580px, 100%);
  max-height: 100%;
  overflow: auto;
  padding: 23px;
  border: 1px solid #454545;
  border-radius: 16px;
  background: #292929;
  scrollbar-width: thin;
}
.cv3-personal-form header,
.cv3-personal-form footer,
.cv3-personal-confirm footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.cv3-personal-form h2,
.cv3-personal-confirm h2 {
  margin: 0;
  color: #eee;
  font-size: 16px;
}
.cv3-personal-form p,
.cv3-personal-confirm p {
  margin: 0;
  color: #aaa;
  font-size: 12px;
  line-height: 1.8;
}
.cv3-personal-form label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
  color: #bbb;
}
.cv3-personal-preview {
  display: grid;
  place-items: center;
  min-height: 110px;
  height: 180px;
  border: 1px dashed #494949;
  border-radius: 10px;
  overflow: hidden;
  color: #888;
  font-size: 12px;
  background: #222;
}
.cv3-personal-preview img {
  max-width: 100%;
  max-height: 180px;
  object-fit: contain;
}
.cv3-personal-library .cv3-personal-file {
  display: none;
}
.cv3-personal-upload {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #bbb;
  font-size: 12px;
}
.cv3-personal-canvas-picker {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(105px, 1fr));
  gap: 8px;
  max-height: 190px;
  padding: 10px;
  overflow: auto;
  background: #222;
  border-radius: 9px;
}
.cv3-personal-library .cv3-personal-canvas-picker button {
  flex-direction: column;
  padding: 6px;
  min-width: 0;
}
.cv3-personal-canvas-picker img {
  width: 100%;
  height: 75px;
  object-fit: contain;
}
.cv3-personal-canvas-picker span {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cv3-personal-canvas-picker > p {
  grid-column: 1/-1;
}
@media (max-width: 700px) {
  .cv3-personal-toolbar,
  .cv3-personal-footer {
    padding-inline: 18px;
  }
  .cv3-personal-content {
    padding-inline: 18px;
  }
  .cv3-personal-grid {
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  }
  .cv3-personal-toolbar {
    height: auto;
    min-height: 32px;
    gap: 8px;
    flex-wrap: wrap;
  }
  .cv3-personal-toolbar-views {
    margin-left: auto;
  }
  .cv3-personal-footer {
    justify-content: center;
  }
}
@media (prefers-reduced-motion: reduce) {
  .cv3-character-filter-trigger > .cv3-icon {
    transition: none;
  }
}
</style>
