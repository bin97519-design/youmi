<script setup>
import { characterStudioPortraitPreview } from '../config/characterStudioCatalog.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CanvasIcon from './CanvasIcon.vue'
import CharacterStudioWireframe from './CharacterStudioWireframe.vue'
import PersonalAssetLibrary from './PersonalAssetLibrary.vue'
import { personalAssetKind } from '../config/personalAssetLibrary.js'
import {
  CHARACTER_LIBRARY_FILTERS,
  characterLibraryItems,
  characterLibrarySelection,
  filterCharacterLibrary,
} from '../config/characterStudioLibrary.js'
import {
  createCharacterWheelNavigator,
  createCharacterDragNavigator,
  stepCharacterSpring,
} from '../config/characterStudioCarousel.js'

const props = defineProps({
  myItems: { type: Array, default: () => [] },
  officialItems: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
})
const emit = defineEmits([
  'create',
  'open',
  'inspect',
  'insert',
  'remove',
  'rename',
  'reload',
  'age-variant',
  'library-busy',
])
const tab = ref('my')
const modelLibraryActive = computed(() => tab.value === 'my' || tab.value === 'official')
const personalBusy = ref(false)
const libraryTabIds = ['my', 'official', 'product', 'scene']
const mode = ref('carousel')
const filters = ref({ gender: [], ageGroup: [], culture: [] })
const query = ref('')
const searchVisible = ref(false)
const searchInput = ref(null)
const searchToggle = ref(null)
const filterMenu = ref('')
const filterTriggers = {}
const filterText = computed(() =>
  Object.fromEntries(
    CHARACTER_LIBRARY_FILTERS.map((filter) => [
      filter.key,
      filter.options.filter((option) => filters.value[filter.key].includes(option)).join('、'),
    ]),
  ),
)
const createMenu = ref(false)
const multiSelect = ref(false)
const selectedIds = ref([])
const activeIndex = ref(props.myItems.some((item) => personalAssetKind(item) === 'model') ? 1 : 0)
const carouselPosition = ref(activeIndex.value)
const reducedMotion = ref(false)
const wheelNavigator = createCharacterWheelNavigator()
const dragNavigator = createCharacterDragNavigator()
const carouselStage = ref(null)
const dragging = ref(false)
const lookX = ref(0)
const lookY = ref(0)
let lookTargetX = 0
let lookTargetY = 0
let lookVelocityX = 0
let lookVelocityY = 0
let pointerSession = null
let suppressPointerClick = false
let frameId = 0
let previousFrame = 0
let carouselVelocity = 0
let motionPreference
const grid = ref(null)
const myFiltered = computed(() =>
  filterCharacterLibrary(
    props.myItems.filter((item) => personalAssetKind(item) === 'model'),
    filters.value,
    query.value,
  ).map((item) => ({ ...item, librarySource: 'my' })),
)
const officialFiltered = computed(() =>
  filterCharacterLibrary(props.officialItems, filters.value, query.value).map((item) => ({
    ...item,
    librarySource: 'official',
  })),
)
const items = computed(() =>
  characterLibraryItems([...myFiltered.value, ...officialFiltered.value]),
)
const selectedItems = computed(() => characterLibrarySelection(items.value, selectedIds.value))
const hasFilters = computed(
  () => query.value.trim() || Object.values(filters.value).some((values) => values.length),
)
// The creation card remains at the start even after the first personal role is saved.
const createPlaceholder = computed(() => !hasFilters.value)
const carouselItems = computed(() =>
  createPlaceholder.value
    ? [{ id: '__character_create__', name: '创建新模特', isCreate: true }, ...items.value]
    : items.value,
)
const activeEntry = computed(() => carouselItems.value[activeIndex.value] || null)
const activeItem = computed(() => (activeEntry.value?.isCreate ? null : activeEntry.value))
const visibleItems = computed(() =>
  carouselItems.value
    .map((item, index) => ({ item, index, offset: index - carouselPosition.value }))
    .filter(({ offset }) => Math.abs(offset) <= 3),
)
const actionItems = computed(() =>
  multiSelect.value ? selectedItems.value : activeItem.value ? [activeItem.value] : [],
)
const deletableItems = computed(() =>
  selectedItems.value.filter((item) => item.librarySource === 'my'),
)
const gridSections = computed(() => [
  { id: 'my', name: '我的模特库', items: myFiltered.value },
  { id: 'official', name: '官方模特库', items: officialFiltered.value },
])

watch(
  [filters, query],
  () => {
    setActive(
      tab.value === 'official' ? myFiltered.value.length + (createPlaceholder.value ? 1 : 0) : 0,
      { immediate: true },
    )
    selectedIds.value = []
  },
  { deep: true },
)
watch(tab, () => {
  if (!modelLibraryActive.value) filterMenu.value = ''
  createMenu.value = false
})
watch(items, (next) => {
  setActive(activeIndex.value, { immediate: true })
  const visibleIds = new Set(next.map((item) => item.id))
  selectedIds.value = selectedIds.value.filter((id) => visibleIds.has(id))
})
watch(activeEntry, (entry, previous) => {
  if (entry?.id !== previous?.id) resetLook({ immediate: true })
})

async function navigateLibrary(value) {
  if (personalBusy.value || !libraryTabIds.includes(value)) return
  filterMenu.value = ''
  tab.value = value
  selectedIds.value = []
  if (!modelLibraryActive.value) {
    multiSelect.value = false
    resetCarouselGesture()
    return
  }
  activeIndex.value =
    value === 'official' ? myFiltered.value.length + (createPlaceholder.value ? 1 : 0) : 0
  setActive(activeIndex.value, { immediate: true })
  if (mode.value !== 'grid') return
  await nextTick()
  const section = grid.value?.querySelector?.(`[data-character-section="${value}"]`)
  if (section && grid.value) grid.value.scrollTop = Math.max(0, section.offsetTop - 16)
}
function libraryTabKey(event) {
  const index = libraryTabIds.indexOf(tab.value)
  const next =
    event.key === 'ArrowRight'
      ? libraryTabIds[(index + 1) % libraryTabIds.length]
      : event.key === 'ArrowLeft'
        ? libraryTabIds[(index + libraryTabIds.length - 1) % libraryTabIds.length]
        : event.key === 'Home'
          ? libraryTabIds[0]
          : event.key === 'End'
            ? libraryTabIds.at(-1)
            : ''
  if (!next || personalBusy.value) return
  event.preventDefault()
  const tablist = event.currentTarget.parentElement
  void navigateLibrary(next)
  void nextTick(() => tablist?.querySelector?.(`#cv3-character-tab-${next}`)?.focus())
}
function setPersonalBusy(value) {
  personalBusy.value = Boolean(value)
  emit('library-busy', personalBusy.value)
}
async function setView(value) {
  resetCarouselGesture()
  mode.value = value
  snapCarousel()
  if (value === 'grid') {
    await nextTick()
    await navigateLibrary(tab.value)
  }
}
function itemIndex(item) {
  return carouselItems.value.findIndex((entry) => entry.id === item.id)
}

function toggleFilter(key, option) {
  const selected = filters.value[key]
  filters.value = {
    ...filters.value,
    [key]: selected.includes(option)
      ? selected.filter((value) => value !== option)
      : [...selected, option],
  }
  filterMenu.value = key
}
async function clearFilter(key) {
  filters.value = { ...filters.value, [key]: [] }
  filterMenu.value = ''
  await nextTick()
  filterTriggers[key]?.focus?.({ preventScroll: true })
}
function resetFilters() {
  filters.value = { gender: [], ageGroup: [], culture: [] }
  query.value = ''
}
async function showSearch() {
  if (!modelLibraryActive.value || personalBusy.value) return
  searchVisible.value = true
  filterMenu.value = ''
  await nextTick()
  searchInput.value?.focus?.()
}
function blurSearch(event) {
  if (query.value.trim() || event?.relatedTarget?.closest?.('.cv3-character-library-search')) return
  searchVisible.value = false
}
async function clearSearch() {
  if (!modelLibraryActive.value || personalBusy.value) return
  query.value = ''
  await nextTick()
  searchInput.value?.focus?.()
}
function toggleMultiSelect() {
  multiSelect.value = !multiSelect.value
  selectedIds.value = []
}
function toggleItem(item) {
  selectedIds.value = selectedIds.value.includes(item.id)
    ? selectedIds.value.filter((id) => id !== item.id)
    : [...selectedIds.value, item.id]
}
function activateItem(item, index) {
  setActive(index)
  if (item.isCreate) {
    createMenu.value = true
    return
  }
  if (multiSelect.value) toggleItem(item)
}
function stopCarouselFrame() {
  if (frameId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frameId)
  frameId = 0
  previousFrame = 0
}
function snapCarousel() {
  stopCarouselFrame()
  carouselVelocity = 0
  carouselPosition.value = activeIndex.value
  lookX.value = lookY.value = lookTargetX = lookTargetY = 0
  lookVelocityX = lookVelocityY = 0
}
function animateCarousel(time) {
  frameId = 0
  const elapsed = previousFrame ? (time - previousFrame) / 1000 : 1 / 60
  previousFrame = time
  const next = pointerSession
    ? { position: carouselPosition.value, velocity: carouselVelocity, settled: true }
    : stepCharacterSpring(
        { position: carouselPosition.value, velocity: carouselVelocity },
        activeIndex.value,
        elapsed,
      )
  const nextX = stepCharacterSpring(
    { position: lookX.value, velocity: lookVelocityX },
    lookTargetX,
    elapsed,
  )
  const nextY = stepCharacterSpring(
    { position: lookY.value, velocity: lookVelocityY },
    lookTargetY,
    elapsed,
  )
  carouselPosition.value = next.position
  carouselVelocity = next.velocity
  lookX.value = nextX.position
  lookY.value = nextY.position
  lookVelocityX = nextX.velocity
  lookVelocityY = nextY.velocity
  if (next.settled && nextX.settled && nextY.settled) {
    previousFrame = 0
    if (!pointerSession) carouselPosition.value = activeIndex.value
  } else frameId = requestAnimationFrame(animateCarousel)
}
function startCarouselFrame() {
  if (!frameId && !reducedMotion.value && typeof requestAnimationFrame === 'function') {
    previousFrame = 0
    frameId = requestAnimationFrame(animateCarousel)
  }
}
function syncCarouselTab() {
  if (modelLibraryActive.value && mode.value === 'carousel')
    tab.value = activeEntry.value?.librarySource || (activeEntry.value?.isCreate ? 'my' : tab.value)
}
function setActive(index, { immediate = false, fromWheel = false, fromDrag = false } = {}) {
  if (!fromDrag) cancelCarouselDrag()
  if (!fromWheel) resetCarouselGesture()
  const previous = activeIndex.value
  activeIndex.value = Math.max(
    0,
    Math.min(Math.max(0, carouselItems.value.length - 1), Math.round(Number(index) || 0)),
  )
  syncCarouselTab()
  if (
    immediate ||
    reducedMotion.value ||
    mode.value !== 'carousel' ||
    Math.abs(activeIndex.value - previous) > 3 ||
    typeof requestAnimationFrame !== 'function'
  ) {
    snapCarousel()
  } else if (!frameId && Math.abs(carouselPosition.value - activeIndex.value) > 0.0001) {
    startCarouselFrame()
  }
}
function resetCarouselGesture() {
  wheelNavigator.reset()
}
function carouselWheel(event) {
  if (
    event.defaultPrevented ||
    event.ctrlKey ||
    event.metaKey ||
    mode.value !== 'carousel' ||
    props.loading ||
    props.error ||
    pointerSession ||
    carouselItems.value.length < 2 ||
    !Number.isFinite(event.deltaY) ||
    event.deltaY === 0 ||
    !Number.isFinite(event.deltaX ?? 0) ||
    Math.abs(event.deltaX ?? 0) > Math.abs(event.deltaY)
  )
    return
  // Consume only the portrait area. The surrounding dialog and grid keep their
  // native scrolling, and browser zoom gestures are never intercepted.
  event.preventDefault()
  event.stopPropagation()
  const now = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now()
  const direction = wheelNavigator.consume(event, now)
  if (direction) setActive(activeIndex.value + direction, { fromWheel: true })
}
function pointerTime(event) {
  return Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now()
}
function releaseCarouselPointer(session) {
  if (!session?.element?.releasePointerCapture) return
  try {
    if (!session.element.hasPointerCapture || session.element.hasPointerCapture(session.id))
      session.element.releasePointerCapture(session.id)
  } catch {
    // A native cancel can release capture before its cancellation event is delivered.
  }
}
function cancelCarouselDrag() {
  const session = pointerSession
  pointerSession = null
  if (dragging.value) suppressPointerClick = true
  dragging.value = false
  dragNavigator.reset()
  releaseCarouselPointer(session)
}
function resetLook({ immediate = false } = {}) {
  lookTargetX = lookTargetY = 0
  if (immediate || reducedMotion.value || typeof requestAnimationFrame !== 'function') {
    lookX.value = lookY.value = lookVelocityX = lookVelocityY = 0
  } else if (lookX.value || lookY.value || lookVelocityX || lookVelocityY) startCarouselFrame()
}
function portraitLookStyle(index) {
  // Only the active creation mannequin follows the pointer. Real character
  // portraits, including neighboring cards, remain completely still on hover.
  if (index !== activeIndex.value || !carouselItems.value[index]?.isCreate) return undefined
  return {
    '--character-look-x': `${lookX.value}px`,
    '--character-look-y': `${lookY.value}px`,
    '--character-look-rx': `${-lookY.value * 0.35}deg`,
    '--character-look-ry': `${lookX.value * 0.45}deg`,
  }
}
function carouselPointerDown(event) {
  if (
    pointerSession ||
    event.isPrimary === false ||
    (event.button ?? 0) !== 0 ||
    event.ctrlKey ||
    event.metaKey
  )
    return
  suppressPointerClick = false
  if (
    props.loading ||
    props.error ||
    mode.value !== 'carousel' ||
    carouselItems.value.length < 2 ||
    event.target.closest?.('input,select,textarea')
  )
    return
  const element = event.currentTarget
  const step =
    typeof getComputedStyle === 'function'
      ? parseFloat(getComputedStyle(element).getPropertyValue('--character-step')) || 245
      : 245
  if (
    !dragNavigator.start({
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      position: carouselPosition.value,
      step,
      max: carouselItems.value.length - 1,
      now: pointerTime(event),
    })
  )
    return
  stopCarouselFrame()
  resetCarouselGesture()
  pointerSession = { id: event.pointerId, element }
  resetLook()
}
function carouselPointerMove(event) {
  if (pointerSession) {
    if (event.pointerId !== pointerSession.id) return
    const next = dragNavigator.move({
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      now: pointerTime(event),
    })
    if (!next) return
    if (next.cancelled) {
      cancelCarouselDrag()
      setActive(activeIndex.value)
      return
    }
    if (!dragging.value) {
      dragging.value = true
      try {
        pointerSession.element.setPointerCapture?.(event.pointerId)
      } catch {
        /* Native gesture may already have cancelled. */
      }
    }
    suppressPointerClick = true
    event.preventDefault()
    event.stopPropagation()
    carouselPosition.value = next.position
    carouselVelocity = next.velocity
    activeIndex.value = Math.max(
      0,
      Math.min(carouselItems.value.length - 1, Math.round(next.position)),
    )
    syncCarouselTab()
    return
  }
  if (!activeEntry.value?.isCreate) {
    resetLook({ immediate: true })
    return
  }
  if (
    reducedMotion.value ||
    event.pointerType === 'touch' ||
    !Number.isFinite(event.clientX) ||
    !Number.isFinite(event.clientY)
  )
    return
  const bounds = event.currentTarget.getBoundingClientRect()
  if (!bounds.width || !bounds.height) return
  lookTargetX =
    Math.max(-1, Math.min(1, (event.clientX - bounds.left - bounds.width / 2) / 160)) * 4
  lookTargetY =
    Math.max(
      -1,
      Math.min(1, (event.clientY - bounds.top - bounds.height / 2) / (bounds.height / 2)),
    ) * 3
  // Without animation support retain the static alternative, rather than jump on hover.
  startCarouselFrame()
}
function finishCarouselPointer(event, cancelled = false) {
  if (!pointerSession || event.pointerId !== pointerSession.id) return
  if (!cancelled && Number.isFinite(event.clientX) && Number.isFinite(event.clientY))
    carouselPointerMove(event)
  if (!pointerSession) return
  const result = dragNavigator.end({
    pointerId: event.pointerId,
    now: pointerTime(event),
    cancelled,
  })
  const session = pointerSession
  pointerSession = null
  dragging.value = false
  releaseCarouselPointer(session)
  if (!result) return
  if (result.dragged) suppressPointerClick = true
  carouselPosition.value = result.position
  carouselVelocity = reducedMotion.value ? 0 : result.velocity
  setActive(result.dragged ? result.index : activeIndex.value, { fromDrag: true })
}
function carouselPointerUp(event) {
  finishCarouselPointer(event)
}
function carouselPointerCancel(event) {
  finishCarouselPointer(event, true)
}
function carouselPointerLeave() {
  resetCarouselGesture()
  if (!pointerSession) resetLook()
}
function guardPointerClick(event) {
  if ((!suppressPointerClick && !dragging.value) || event.detail === 0) return
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation?.()
}
function carouselKey(event) {
  if (event.key === 'ArrowLeft') setActive(activeIndex.value - 1)
  else if (event.key === 'ArrowRight') setActive(activeIndex.value + 1)
  else if (event.key === 'Home') setActive(0)
  else if (event.key === 'End') setActive(carouselItems.value.length - 1)
  else return
  event.preventDefault()
}
function dismissLocalMenus(event) {
  if (!event.target.closest?.('[data-character-menu]')) {
    filterMenu.value = ''
    createMenu.value = false
  }
}
function handleEscape(event) {
  if (!filterMenu.value && !createMenu.value && !searchVisible.value && !multiSelect.value) return
  event.preventDefault()
  event.stopPropagation()
  if (filterMenu.value) {
    const key = filterMenu.value
    filterMenu.value = ''
    void nextTick(() => filterTriggers[key]?.focus?.({ preventScroll: true }))
    return
  }
  if (createMenu.value) {
    createMenu.value = false
    return
  }
  if (searchVisible.value) {
    if (query.value) query.value = ''
    else {
      searchVisible.value = false
      void nextTick(() => searchToggle.value?.focus?.({ preventScroll: true }))
    }
    return
  }
  multiSelect.value = false
  selectedIds.value = []
}
function create(method) {
  createMenu.value = false
  emit('create', method)
}
function insert() {
  if (actionItems.value.length) emit('insert', actionItems.value)
}
function removeSelected() {
  if (deletableItems.value.length) emit('remove', deletableItems.value)
}
function motionPreferenceChanged(event) {
  reducedMotion.value = event.matches
  if (event.matches) {
    cancelCarouselDrag()
    snapCarousel()
  }
}
onMounted(() => {
  if (typeof window === 'undefined' || !window.matchMedia) return
  motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
  motionPreferenceChanged(motionPreference)
  if (motionPreference.addEventListener)
    motionPreference.addEventListener('change', motionPreferenceChanged)
  else motionPreference.addListener?.(motionPreferenceChanged)
})
onBeforeUnmount(() => {
  cancelCarouselDrag()
  stopCarouselFrame()
  resetCarouselGesture()
  if (motionPreference?.removeEventListener)
    motionPreference.removeEventListener('change', motionPreferenceChanged)
  else motionPreference?.removeListener?.(motionPreferenceChanged)
})
</script>

<template>
  <section
    class="cv3-character-library"
    aria-label="创作素材库"
    @pointerdown="dismissLocalMenus"
    @keydown.esc="handleEscape"
  >
    <header class="cv3-character-library-header">
      <div class="cv3-character-library-tabs" role="tablist" aria-label="创作素材库分类">
        <button
          v-for="item in [
            { id: 'my', name: '我的模特库' },
            { id: 'official', name: '官方模特库' },
            { id: 'product', name: '我的商品库' },
            { id: 'scene', name: '我的场景库' },
          ]"
          :id="`cv3-character-tab-${item.id}`"
          :key="item.id"
          type="button"
          role="tab"
          :aria-selected="tab === item.id"
          :tabindex="tab === item.id ? 0 : -1"
          :disabled="personalBusy"
          aria-controls="cv3-character-library-content"
          :class="{ 'is-active': tab === item.id }"
          @click="navigateLibrary(item.id)"
          @keydown="libraryTabKey"
        >
          {{ item.name }}
        </button>
      </div>
      <div v-if="modelLibraryActive" class="cv3-character-library-toolbar">
        <div class="cv3-character-library-filters">
          <div
            v-for="filter in CHARACTER_LIBRARY_FILTERS"
            :key="filter.key"
            class="cv3-character-library-filter"
            data-character-menu
          >
            <div
              class="cv3-character-filter-pill"
              :class="{ 'has-value': filters[filter.key].length }"
            >
              <button
                v-if="filters[filter.key].length"
                type="button"
                class="cv3-character-filter-pill-clear"
                :aria-label="`清除${filter.label}筛选`"
                :title="`清除${filter.label}筛选`"
                @click.stop="clearFilter(filter.key)"
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
                :ref="(element) => (filterTriggers[filter.key] = element)"
                type="button"
                class="cv3-character-filter-trigger"
                :class="{ 'has-value': filters[filter.key].length }"
                :aria-expanded="filterMenu === filter.key"
                :aria-controls="`cv3-character-filter-${filter.key}`"
                :aria-label="
                  filterText[filter.key]
                    ? `${filter.label}筛选，已选：${filterText[filter.key]}`
                    : `${filter.label}筛选`
                "
                @click="filterMenu = filterMenu === filter.key ? '' : filter.key"
              >
                <span class="cv3-character-filter-label">{{ filter.label }}</span>
                <template v-if="filterText[filter.key]">
                  <span class="cv3-character-filter-divider" aria-hidden="true" />
                  <span class="cv3-character-filter-values" :title="filterText[filter.key]">
                    {{ filterText[filter.key] }}
                  </span>
                </template>
                <CanvasIcon v-else name="chevron" :size="12" />
              </button>
            </div>
            <div
              v-if="filterMenu === filter.key"
              :id="`cv3-character-filter-${filter.key}`"
              class="cv3-character-filter-menu"
              role="group"
              :aria-label="`${filter.label}选项`"
            >
              <label
                v-for="option in filter.options"
                :key="option"
                :class="{ 'is-selected': filters[filter.key].includes(option) }"
              >
                <input
                  class="cv3-character-filter-checkbox"
                  type="checkbox"
                  :checked="filters[filter.key].includes(option)"
                  @change="toggleFilter(filter.key, option)"
                />
                <span>{{ option }}</span>
                <CanvasIcon
                  v-if="filters[filter.key].includes(option)"
                  class="cv3-character-filter-check"
                  name="check"
                  :size="15"
                />
              </label>
            </div>
          </div>
          <div v-if="searchVisible" class="cv3-character-library-search">
            <CanvasIcon name="search" :size="16" />
            <input
              ref="searchInput"
              v-model="query"
              type="search"
              placeholder="搜索模特名称或描述"
              aria-label="搜索模特"
              @blur="blurSearch"
            />
            <button
              v-if="query"
              type="button"
              class="cv3-character-search-clear"
              aria-label="清除搜索"
              @click="clearSearch"
            >
              <CanvasIcon name="close" :size="14" />
            </button>
          </div>
          <button
            v-else
            ref="searchToggle"
            type="button"
            class="cv3-character-icon-button cv3-character-search-toggle"
            title="搜索模特"
            aria-label="搜索模特"
            @click="showSearch"
          >
            <CanvasIcon name="search" :size="16" />
          </button>
        </div>
        <div class="cv3-character-library-views">
          <button
            type="button"
            class="cv3-character-icon-button"
            :class="{ 'is-active': multiSelect }"
            :aria-pressed="multiSelect"
            aria-label="多选"
            title="多选"
            @click="toggleMultiSelect"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <rect x="3" y="3" width="12" height="12" rx="2" stroke="currentColor" />
              <path
                d="M7 17h9a1 1 0 0 0 1-1V7M6 9l2 2 4-4"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <span class="cv3-character-view-divider" />
          <button
            type="button"
            class="cv3-character-icon-button"
            :class="{ 'is-active': mode === 'carousel' }"
            :aria-pressed="mode === 'carousel'"
            aria-label="列表模式"
            title="列表模式"
            @click="setView('carousel')"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <rect x="6" y="3" width="8" height="14" rx="1" stroke="currentColor" />
              <path d="M3 6v8M17 6v8" stroke="currentColor" stroke-linecap="round" />
            </svg>
          </button>
          <button
            type="button"
            class="cv3-character-icon-button"
            :class="{ 'is-active': mode === 'grid' }"
            :aria-pressed="mode === 'grid'"
            aria-label="宫格模式"
            title="宫格模式"
            @click="setView('grid')"
          >
            <CanvasIcon name="gridFour" :size="19" />
          </button>
        </div>
      </div>
    </header>

    <div
      v-if="!modelLibraryActive"
      id="cv3-character-library-content"
      class="cv3-personal-library-panel"
      role="tabpanel"
      :aria-labelledby="`cv3-character-tab-${tab}`"
    >
      <PersonalAssetLibrary :key="tab" :kind="tab" @busy-change="setPersonalBusy" />
    </div>
    <div
      v-else
      id="cv3-character-library-content"
      class="cv3-character-library-content"
      role="tabpanel"
      :aria-labelledby="`cv3-character-tab-${tab}`"
      :aria-busy="loading"
    >
      <div v-if="loading" class="cv3-character-library-status" role="status">正在加载模特库…</div>
      <div v-else-if="error" class="cv3-character-library-status" role="alert">
        <p>{{ error }}</p>
        <button type="button" @click="emit('reload')">重新加载</button>
      </div>
      <template v-else-if="items.length">
        <div
          v-if="mode === 'carousel'"
          class="cv3-character-carousel"
          tabindex="0"
          aria-label="模特列表，使用左右方向键浏览"
          @keydown="carouselKey"
        >
          <button
            class="cv3-character-carousel-arrow is-previous"
            type="button"
            aria-label="上一个模特"
            :disabled="activeIndex === 0"
            @click="setActive(activeIndex - 1)"
          >
            <CanvasIcon name="chevron" :size="22" />
          </button>
          <div
            ref="carouselStage"
            class="cv3-character-carousel-stage"
            :class="{ 'is-dragging': dragging }"
            @wheel="carouselWheel"
            @pointerdown="carouselPointerDown"
            @pointermove="carouselPointerMove"
            @pointerup="carouselPointerUp"
            @pointercancel="carouselPointerCancel"
            @lostpointercapture="carouselPointerCancel"
            @pointerleave="carouselPointerLeave"
            @click.capture="guardPointerClick"
            @dblclick.capture="guardPointerClick"
            @dragstart.prevent
          >
            <article
              v-for="{ item, index, offset } in visibleItems"
              :key="item.id"
              class="cv3-character-carousel-card"
              :class="{
                'is-current': index === activeIndex,
                'is-selected': selectedIds.includes(item.id),
              }"
              :style="{
                '--character-offset': offset,
                '--character-distance': Math.min(3, Math.abs(offset)),
                zIndex: Math.round(100 - Math.abs(offset) * 10),
              }"
            >
              <button
                type="button"
                class="cv3-character-portrait"
                :aria-label="
                  item.isCreate
                    ? '创建新模特'
                    : multiSelect
                      ? `${selectedIds.includes(item.id) ? '取消选择' : '选择'}${item.name}`
                      : `查看${item.name}`
                "
                :aria-pressed="
                  !item.isCreate &&
                  (multiSelect ? selectedIds.includes(item.id) : index === activeIndex)
                "
                @click="activateItem(item, index)"
                @dblclick="!multiSelect && !item.isCreate && emit('open', item)"
              >
                <span
                  class="cv3-character-portrait-content"
                  :class="{ 'is-create-look': item.isCreate && index === activeIndex }"
                  :style="portraitLookStyle(index)"
                >
                  <CharacterStudioWireframe v-if="item.isCreate" />
                  <img
                    v-else-if="item.imageUrl"
                    :src="characterStudioPortraitPreview(item)"
                    :alt="item.name"
                    draggable="false"
                  />
                  <CanvasIcon v-else name="characterSheet" :size="64" />
                </span>
                <span v-if="multiSelect && !item.isCreate" class="cv3-character-selection-check">
                  <CanvasIcon v-if="selectedIds.includes(item.id)" name="check" :size="16" />
                </span>
              </button>
              <button
                v-if="index === activeIndex && !multiSelect && !item.isCreate"
                type="button"
                class="cv3-character-view-assets"
                @click="emit('inspect', item)"
              >
                <CanvasIcon name="assets" :size="15" />
                查看模特资产
              </button>
            </article>
          </div>
          <button
            class="cv3-character-carousel-arrow is-next"
            type="button"
            aria-label="下一个模特"
            :disabled="activeIndex >= carouselItems.length - 1"
            @click="setActive(activeIndex + 1)"
          >
            <CanvasIcon name="chevron" :size="22" />
          </button>
          <div v-if="activeItem" class="cv3-character-active-title">
            <h2>{{ activeItem.name }}</h2>
            <button
              type="button"
              class="cv3-character-icon-button"
              aria-label="生成其他年龄版本"
              title="生成其他年龄版本"
              @click="emit('age-variant', activeItem)"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path
                  d="m7 2 1.4 4.6L13 8l-4.6 1.4L7 14l-1.4-4.6L1 8l4.6-1.4L7 2ZM13 1l.6 2.4L16 4l-2.4.6L13 7l-.6-2.4L10 4l2.4-.6L13 1Z"
                  stroke="currentColor"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
          </div>
          <div v-else-if="activeEntry?.isCreate" class="cv3-character-active-title">
            <h2>创建新模特</h2>
          </div>
          <p
            v-if="activeItem?.description"
            class="cv3-character-active-description cv3-character-sr-only"
          >
            {{ activeItem.description }}
          </p>
          <label
            class="cv3-character-carousel-scrubber"
            :class="{ 'is-disabled': carouselItems.length < 2 }"
            :style="{
              '--character-progress':
                carouselItems.length > 1
                  ? Math.max(0, Math.min(1, carouselPosition / (carouselItems.length - 1)))
                  : 0,
            }"
          >
            <span class="cv3-character-sr-only">模特列表</span>
            <i class="cv3-character-scrollbar-thumb" aria-hidden="true" />
            <input
              type="range"
              min="0"
              :max="Math.max(0, carouselItems.length - 1)"
              step="1"
              :value="activeIndex"
              :disabled="carouselItems.length < 2"
              aria-label="模特列表位置"
              :aria-valuetext="`${activeIndex + 1} / ${carouselItems.length} ${activeEntry?.name || ''}`"
              @input="setActive($event.target.value, { immediate: true })"
            />
            <span class="cv3-character-sr-only">
              {{ activeIndex + 1 }} / {{ carouselItems.length }}
            </span>
          </label>
        </div>
        <div v-else ref="grid" class="cv3-character-grid">
          <section
            v-for="section in gridSections"
            :key="section.id"
            class="cv3-character-grid-section"
            :data-character-section="section.id"
            :aria-label="section.name"
          >
            <h2>{{ section.name }}</h2>
            <div class="cv3-character-grid-cards">
              <button
                v-if="section.id === 'my' && !hasFilters"
                type="button"
                class="cv3-character-grid-new"
                data-character-menu
                @click="createMenu = !createMenu"
              >
                <CanvasIcon name="plus" :size="30" />
                <span>创建新模特</span>
              </button>
              <article
                v-for="item in section.items"
                :key="item.id"
                class="cv3-character-grid-item"
                :class="{
                  'is-selected': multiSelect
                    ? selectedIds.includes(item.id)
                    : activeItem?.id === item.id,
                }"
              >
                <button
                  type="button"
                  class="cv3-character-grid-cover"
                  :aria-label="`${multiSelect ? '选择' : '查看'}${item.name}`"
                  :aria-pressed="
                    multiSelect ? selectedIds.includes(item.id) : activeItem?.id === item.id
                  "
                  @click="activateItem(item, itemIndex(item))"
                  @dblclick="!multiSelect && emit('open', item)"
                >
                  <img
                    v-if="item.imageUrl"
                    :src="characterStudioPortraitPreview(item)"
                    :alt="item.name"
                    loading="lazy"
                    draggable="false"
                  />
                  <CanvasIcon v-else name="characterSheet" :size="52" />
                  <span v-if="multiSelect" class="cv3-character-selection-check">
                    <CanvasIcon v-if="selectedIds.includes(item.id)" name="check" :size="16" />
                  </span>
                </button>
                <div class="cv3-character-grid-caption">
                  <button
                    type="button"
                    @click="multiSelect ? toggleItem(item) : emit('inspect', item)"
                  >
                    {{ item.name }}
                  </button>
                  <button
                    v-if="section.id === 'my' && !multiSelect"
                    type="button"
                    class="cv3-character-rename"
                    :aria-label="`重命名${item.name}`"
                    title="重命名"
                    @click="emit('rename', item)"
                  >
                    ···
                  </button>
                </div>
              </article>
            </div>
            <p
              v-if="!section.items.length && (section.id !== 'my' || hasFilters)"
              class="cv3-character-grid-empty"
            >
              暂无{{ section.id === 'my' ? '我的' : '官方' }}模特
            </p>
          </section>
        </div>
      </template>
      <div v-else-if="hasFilters" class="cv3-character-library-status">
        <p>没有找到符合条件的模特</p>
        <button type="button" @click="resetFilters">清除筛选</button>
      </div>
      <div v-else-if="tab === 'my'" class="cv3-character-empty">
        <button
          type="button"
          class="cv3-character-empty-figure"
          aria-label="创建新模特"
          data-character-menu
          @click="createMenu = !createMenu"
        >
          <CharacterStudioWireframe />
        </button>
        <h2>创建新模特</h2>
        <p>生成新模特，或导入已有模特素材</p>
      </div>
      <div v-else class="cv3-character-library-status">
        <CanvasIcon name="characterSheet" :size="42" />
        <p>暂无官方模特</p>
      </div>
    </div>

    <footer
      v-if="modelLibraryActive"
      class="cv3-character-library-footer"
      :class="{ 'is-empty': !activeItem && !multiSelect }"
    >
      <div class="cv3-character-library-create" data-character-menu>
        <div v-if="createMenu" class="cv3-character-create-menu">
          <button type="button" @click="create('generate')">
            <CanvasIcon name="plus" :size="18" />
            生成新模特
          </button>
          <button type="button" @click="create('import')">
            <CanvasIcon name="image" :size="18" />
            导入已有模特
          </button>
        </div>
        <button
          type="button"
          class="cv3-character-create-button"
          :aria-expanded="createMenu"
          @click="createMenu = !createMenu"
        >
          <CanvasIcon name="plus" :size="17" />
          创建新模特
          <CanvasIcon name="chevron" :size="14" />
        </button>
      </div>
      <div v-if="items.length && (activeItem || multiSelect)" class="cv3-character-library-actions">
        <span v-if="multiSelect" class="cv3-character-selected-count">
          已选 {{ selectedItems.length }} 个模特
        </span>
        <button
          type="button"
          class="cv3-character-action-secondary"
          :disabled="!actionItems.length || loading"
          @click="insert"
        >
          添加到画布
        </button>
        <button
          v-if="!multiSelect"
          type="button"
          class="cv3-character-action-primary"
          :disabled="!activeItem || loading"
          @click="activeItem && emit('open', activeItem)"
        >
          编辑模特
        </button>
        <button
          v-else-if="myFiltered.length"
          type="button"
          class="cv3-character-action-secondary is-danger"
          :disabled="!deletableItems.length || loading"
          @click="removeSelected"
        >
          删除模特
        </button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.cv3-character-library {
  isolation: isolate;
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  min-height: 0;
  color: #f2f2f2;
  background: #242424;
  font:
    14px/1.5 system-ui,
    -apple-system,
    'Segoe UI',
    sans-serif;
}
.cv3-character-library button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.cv3-character-library button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.cv3-character-library button:active:not(:disabled) {
  opacity: 0.75;
}
.cv3-character-library :is(button, input):focus-visible {
  outline: 2px solid #6ad6e5;
  outline-offset: 3px;
}
.cv3-character-library-header {
  flex: 0 0 auto;
  padding: 27px 32px 0;
}
.cv3-character-library-tabs {
  display: flex;
  gap: 30px;
  padding-right: 32px;
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: #505050 transparent;
}
.cv3-character-library-tabs button {
  flex-shrink: 0;
  padding: 0;
  color: #858585;
  font-size: 18px;
  font-weight: 600;
  line-height: 27px;
}
.cv3-personal-library-panel {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
}
.cv3-character-library-tabs button.is-active {
  color: #f5f5f5;
}
.cv3-character-library-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 26px;
}
.cv3-character-library-filters,
.cv3-character-library-views {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.cv3-character-library-filter {
  position: relative;
  min-width: 0;
  max-width: 100%;
}
.cv3-character-library-filters {
  flex: 1 1 auto;
  gap: 6px;
}
.cv3-character-library-views {
  flex: none;
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
.cv3-character-library .cv3-character-filter-trigger {
  gap: 4px;
  box-sizing: border-box;
  height: 32px;
  min-width: 0;
  padding: 0 10px 0 14px;
  border-radius: 9999px;
  background: transparent;
  color: inherit;
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
  white-space: nowrap;
}
.cv3-character-library .cv3-character-filter-trigger.has-value {
  padding-left: 0;
}
.cv3-character-library .cv3-character-filter-pill-clear {
  flex: none;
  width: 16px;
  height: 16px;
  padding: 0;
  border-radius: 3px;
  color: inherit;
}
.cv3-character-library .cv3-character-filter-pill-clear:hover {
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
.cv3-character-filter-checkbox {
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
.cv3-character-library .cv3-character-icon-button {
  width: 30px;
  height: 30px;
  padding: 4px;
  border-radius: 6px;
  color: #929292;
}
.cv3-character-library .cv3-character-icon-button:hover,
.cv3-character-library .cv3-character-icon-button.is-active {
  background: #383838;
  color: #f2f2f2;
}
.cv3-character-library .cv3-character-search-toggle {
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
.cv3-character-library .cv3-character-search-toggle:hover {
  background: #3a3a3a;
}
.cv3-character-library .cv3-character-search-toggle:focus-visible,
.cv3-character-library .cv3-character-search-clear:focus-visible {
  outline: 2px solid #aaa;
  outline-offset: 3px;
}
.cv3-character-view-divider {
  height: 16px;
  width: 1px;
  margin: 0 4px;
  background: #4a4a4a;
}
.cv3-character-library-search {
  display: flex;
  flex: 0 1 200px;
  align-items: center;
  gap: 6px;
  width: 200px;
  height: 32px;
  min-width: 80px;
  box-sizing: border-box;
  padding: 0 10px;
  border: 0;
  border-radius: 9999px;
  background: #ffffff0f;
  color: #929292;
}
.cv3-character-library-search > .cv3-icon {
  flex: none;
}
.cv3-character-library-search:focus-within {
  box-shadow: inset 0 0 0 1px #777;
}
.cv3-character-library-search input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 0;
  border: 0;
  outline: 0;
  color: #eee;
  font: inherit;
  font-size: 13px;
  background: transparent;
}
.cv3-character-library .cv3-character-library-search input:focus-visible {
  outline: none;
}
.cv3-character-library-search input::-webkit-search-cancel-button {
  display: none;
}
.cv3-character-library .cv3-character-search-clear {
  flex: none;
  width: 18px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #aaa;
}
.cv3-character-library .cv3-character-search-clear:hover {
  background: transparent;
  color: #fff;
}
.cv3-character-library-content {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
.cv3-character-library-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 15px;
  height: 100%;
  padding: 32px;
  box-sizing: border-box;
  color: #939393;
  text-align: center;
}
.cv3-character-library-status p {
  max-width: 540px;
  margin: 0;
  overflow-wrap: anywhere;
}
.cv3-character-library-status button {
  padding: 7px 17px;
  border: 1px solid #565656;
  border-radius: 20px;
  color: #eee;
}
.cv3-character-carousel {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  height: 100%;
  min-height: 0;
  padding: 18px 0 28px;
  box-sizing: border-box;
  outline: 0;
}
.cv3-character-carousel-stage {
  --character-step: 245px;
  position: relative;
  flex: 0 1 430px;
  min-height: 150px;
  height: 430px;
  width: 100%;
  overflow: hidden;
  overscroll-behavior: contain;
  touch-action: pan-y pinch-zoom;
  cursor: grab;
  user-select: none;
}
.cv3-character-carousel-stage.is-dragging,
.cv3-character-carousel-stage.is-dragging .cv3-character-portrait {
  cursor: grabbing;
}
.cv3-character-carousel-stage.is-dragging .cv3-character-view-assets {
  opacity: 0;
  pointer-events: none;
}
.cv3-character-carousel-card {
  --character-offset: 0;
  --character-distance: 0;
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 240px;
  transform: translateX(calc(-50% + var(--character-offset) * var(--character-step)))
    scale(calc(1 - var(--character-distance) * 0.06));
  opacity: max(0.14, calc(1 - var(--character-distance) * 0.7));
  transform-origin: center bottom;
  will-change: transform, opacity;
}
.cv3-character-carousel-card.is-current {
  z-index: 1;
}
.cv3-character-library .cv3-character-portrait {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 0;
  overflow: hidden;
  border-radius: 12px;
  color: #717171;
  cursor: grab;
  perspective: 900px;
}
.cv3-character-portrait-content {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.cv3-character-portrait-content.is-create-look {
  transform: translate3d(var(--character-look-x, 0px), var(--character-look-y, 0px), 0)
    rotateX(var(--character-look-rx, 0deg)) rotateY(var(--character-look-ry, 0deg));
  transform-origin: center 55%;
  will-change: transform;
}
.cv3-character-portrait-content > :deep(.cv3-character-wireframe) {
  transform: translateY(28px) scale(0.965);
}
.cv3-character-portrait img {
  display: block;
  width: auto;
  max-width: none;
  height: 100%;
  flex-shrink: 0;
  object-fit: contain;
  user-select: none;
}
.cv3-character-carousel-card.is-selected .cv3-character-portrait {
  box-shadow: inset 0 0 0 2px #f0f0f0;
}
.cv3-character-library .cv3-character-view-assets {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  min-height: 32px;
  gap: 5px;
  padding: 5px 10px;
  border: 1px solid #fff4;
  border-radius: 8px;
  background: #232323d9;
  white-space: nowrap;
  font-size: 12px;
  opacity: 0;
}
.cv3-character-carousel-card:hover .cv3-character-view-assets,
.cv3-character-carousel-card:focus-within .cv3-character-view-assets {
  opacity: 1;
}
.cv3-character-library .cv3-character-carousel-arrow {
  position: absolute;
  top: 45%;
  z-index: 2;
  width: 28px;
  height: 28px;
  border: 1px solid #414141;
  border-radius: 50%;
  background: #2b2b2b;
  color: #bbb;
}
.cv3-character-carousel-arrow:hover:not(:disabled) {
  background: #363636;
}
.cv3-character-carousel-arrow.is-previous {
  left: 20px;
}
.cv3-character-carousel-arrow.is-next {
  right: 20px;
}
.cv3-character-carousel-arrow.is-previous :deep(svg) {
  transform: rotate(90deg);
}
.cv3-character-carousel-arrow.is-next :deep(svg) {
  transform: rotate(-90deg);
}
.cv3-character-active-title {
  position: relative;
  top: 20px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 5px;
  margin-top: 13px;
  min-height: 32px;
}
.cv3-character-active-title h2 {
  max-width: 70%;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 600;
}
.cv3-character-active-description {
  width: min(540px, 85%);
  margin: 3px auto 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
  font-size: 12px;
  color: #8c8c8c;
}
.cv3-character-carousel-scrubber {
  --character-thumb-width: clamp(44px, 8.5%, 96px);
  position: absolute;
  left: 24px;
  right: 24px;
  bottom: 2px;
  display: block;
  height: 18px;
  border-radius: 8px;
  cursor: grab;
}
.cv3-character-carousel-scrubber input {
  appearance: none;
  position: absolute;
  inset: 0;
  width: 100%;
  height: 18px;
  padding: 0;
  margin: 0;
  border: 0;
  outline: 0;
  background: transparent;
  cursor: grab;
}
.cv3-character-carousel-scrubber input::-webkit-slider-runnable-track {
  height: 6px;
  background: transparent;
}
.cv3-character-carousel-scrubber input::-webkit-slider-thumb {
  appearance: none;
  width: var(--character-thumb-width);
  height: 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
}
.cv3-character-carousel-scrubber input::-moz-range-track {
  height: 6px;
  background: transparent;
}
.cv3-character-carousel-scrubber input::-moz-range-thumb {
  width: var(--character-thumb-width);
  height: 6px;
  border: 0;
  background: transparent;
}
.cv3-character-scrollbar-thumb {
  position: absolute;
  top: 6px;
  left: calc(var(--character-progress) * (100% - var(--character-thumb-width)));
  width: var(--character-thumb-width);
  height: 6px;
  border-radius: 6px;
  background: #505050;
  pointer-events: none;
}
.cv3-character-carousel-scrubber:hover .cv3-character-scrollbar-thumb,
.cv3-character-carousel-scrubber:focus-within .cv3-character-scrollbar-thumb {
  background: #747474;
}
.cv3-character-carousel-scrubber input:focus-visible {
  outline: 0;
  box-shadow: none;
}
.cv3-character-carousel-scrubber:has(input:focus-visible) {
  outline: 1px solid #797979;
  outline-offset: 1px;
}
.cv3-character-carousel-scrubber input:active {
  cursor: grabbing;
}
.cv3-character-carousel-scrubber.is-disabled .cv3-character-scrollbar-thumb {
  opacity: 0.3;
}
.cv3-character-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.cv3-character-grid {
  position: relative;
  height: 100%;
  overflow-y: auto;
  padding: 28px 34px 20px;
  box-sizing: border-box;
  scrollbar-width: thin;
  scrollbar-color: #5b5b5b transparent;
}
.cv3-character-grid::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.cv3-character-grid::-webkit-scrollbar-track {
  background: transparent;
}
.cv3-character-grid::-webkit-scrollbar-thumb {
  border-radius: 6px;
  background: #505050;
}
.cv3-character-grid-section + .cv3-character-grid-section {
  margin-top: 32px;
}
.cv3-character-grid-section h2 {
  margin: 0 0 16px;
  font-size: 16px;
  font-weight: 500;
}
.cv3-character-grid-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(145px, 1fr));
  gap: 23px 20px;
}
.cv3-character-library .cv3-character-grid-new {
  flex-direction: column;
  align-self: start;
  width: 100%;
  aspect-ratio: 3 / 4;
  border: 1px dashed #565656;
  border-radius: 10px;
  color: #8b8b8b;
  background: #292929;
}
.cv3-character-grid-empty {
  margin: 20px 0 35px;
  color: #7e7e7e;
  font-size: 13px;
}
.cv3-character-grid-item {
  min-width: 0;
}
.cv3-character-library .cv3-character-grid-cover {
  position: relative;
  display: flex;
  width: 100%;
  aspect-ratio: 3 / 4;
  padding: 0;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: 10px;
  background: #2c2c2c;
  color: #777;
}
.cv3-character-grid-item.is-selected .cv3-character-grid-cover {
  border-color: #bdbdbd;
}
.cv3-character-grid-cover img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.cv3-character-grid-caption {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  margin-top: 9px;
}
.cv3-character-grid-caption > button:first-child {
  display: block;
  min-width: 0;
  padding: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  font-size: 12px;
}
.cv3-character-library .cv3-character-rename {
  padding: 0 3px;
  color: #aaa;
  font-size: 16px;
}
.cv3-character-selection-check {
  position: absolute;
  top: 10px;
  right: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 1px solid #bdbdbd;
  border-radius: 4px;
  background: #333a;
  color: #eee;
}
.cv3-character-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 0;
  padding: 14px 20px;
  box-sizing: border-box;
  color: #777;
}
.cv3-character-library .cv3-character-empty-figure {
  position: relative;
  flex: 0 1 330px;
  width: 164px;
  height: 330px;
  min-height: 110px;
  padding: 0;
  color: #565656;
}
.cv3-character-empty-figure > svg {
  height: 100%;
  max-width: 100%;
}
.cv3-character-empty-plus {
  position: absolute;
  top: 41%;
  left: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  transform: translate(-50%, -50%);
  border: 1px solid #555;
  border-radius: 50%;
  background: #292929;
  color: #b5b5b5;
}
.cv3-character-empty h2 {
  margin: 11px 0 0;
  color: #a9a9a9;
  font-size: 15px;
  font-weight: 500;
}
.cv3-character-empty p {
  margin: 6px 0 0;
  color: #707070;
  font-size: 12px;
}
.cv3-character-library-footer {
  position: relative;
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  justify-content: flex-start;
  min-height: 45px;
  padding: 17px 32px 27px;
  gap: 18px;
  border-top: 1px solid #343434;
}
.cv3-character-library-footer.is-empty {
  justify-content: center;
}
.cv3-character-library-create {
  position: relative;
  z-index: 5;
}
.cv3-character-library .cv3-character-create-button {
  min-height: 38px;
  padding: 8px 16px;
  border: 1px solid #535353;
  border-radius: 22px;
  background: #ededed;
  color: #242424;
  font-size: 13px;
  font-weight: 500;
}
.cv3-character-library-footer:not(.is-empty) .cv3-character-create-button {
  padding-inline: 8px;
  border-color: transparent;
  background: transparent;
  color: #e5e5e5;
}
.cv3-character-create-menu {
  position: absolute;
  left: 0;
  bottom: calc(100% + 9px);
  min-width: 165px;
  padding: 6px;
  border: 1px solid #494949;
  border-radius: 12px;
  background: #303030;
  box-shadow: 0 6px 24px #0005;
}
.cv3-character-library .cv3-character-create-menu button {
  justify-content: flex-start;
  width: 100%;
  padding: 9px 11px;
  border-radius: 6px;
  font-size: 13px;
  white-space: nowrap;
}
.cv3-character-create-menu button:hover {
  background: #414141;
}
.cv3-character-library-actions {
  position: absolute;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 12px;
  transform: translateX(-50%);
}
.cv3-character-library .cv3-character-action-primary,
.cv3-character-library .cv3-character-action-secondary {
  min-height: 38px;
  padding: 8px 21px;
  border-radius: 12px;
  font-size: 13px;
  white-space: nowrap;
}
.cv3-character-library .cv3-character-action-primary {
  background: #ededed;
  color: #252525;
}
.cv3-character-library .cv3-character-action-secondary {
  background: #3d3d3d;
  color: #d0d0d0;
}
.cv3-character-library .cv3-character-action-secondary.is-danger {
  color: #f3a6a6;
}
.cv3-character-selected-count {
  color: #aaa;
  font-size: 12px;
  white-space: nowrap;
}
@media (max-width: 820px) {
  .cv3-character-library-header {
    padding: 24px 22px 0;
  }
  .cv3-character-library-toolbar {
    flex-wrap: wrap;
  }
  .cv3-character-library-filters {
    flex-wrap: wrap;
  }
  .cv3-character-carousel {
    padding-inline: 0;
  }
  .cv3-character-carousel-card {
    width: 190px;
    transform: translateX(calc(-50% + var(--character-offset) * var(--character-step)));
  }
  .cv3-character-carousel-stage {
    --character-step: 210px;
  }
  .cv3-character-library-footer {
    flex-wrap: wrap;
    justify-content: center;
    padding: 13px 20px 20px;
  }
  .cv3-character-library-actions {
    position: static;
    transform: none;
    flex-wrap: wrap;
    justify-content: center;
  }
  .cv3-character-carousel-arrow.is-previous {
    left: 8px;
  }
  .cv3-character-carousel-arrow.is-next {
    right: 8px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .cv3-character-library *,
  .cv3-character-library *::before,
  .cv3-character-library *::after {
    animation: none !important;
    transition: none !important;
    scroll-behavior: auto !important;
  }
}
</style>
