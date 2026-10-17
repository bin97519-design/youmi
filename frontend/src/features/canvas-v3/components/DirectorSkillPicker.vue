<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  DIRECTOR_SKILL_CATALOG,
  DIRECTOR_SKILL_CATEGORIES,
} from '../config/directorSkillCatalog.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  selectedCount: { type: Number, default: 0 },
})

const emit = defineEmits(['update:open', 'select', 'create-request', 'import-request'])

const MENU_WIDTH = 450
const MENU_HEIGHT = 400
const VIEWPORT_MARGIN = 8
const TRIGGER_GAP = 8
const FAVORITES_STORAGE_KEY = 'libtv:director:favorite-skills'

const trigger = ref(null)
const dialog = ref(null)
const searchInput = ref(null)
const createButton = ref(null)
const createMenu = ref(null)
const directoryDialog = ref(null)
const detailDialog = ref(null)
const activeTab = ref('home-commerce')
const searchQuery = ref('')
const debouncedSearchQuery = ref('')
const createMenuOpen = ref(false)
const directoryOpen = ref(false)
const directoryQuery = ref('')
const directoryCategory = ref('all')
const detailSkill = ref(null)
const hoveredSkill = ref(null)
const previewStyle = ref({})
const favorites = ref(new Set())
const menuStyle = ref({})
let focusOnOpen = 'search'
let restoreFocusAfterClose = false
let bodyOverflowBeforeModal = ''
let previewOpenTimer = 0
let previewCloseTimer = 0
let createCloseTimer = 0
let searchDebounceTimer = 0

const tabs = [
  { id: 'home-commerce', label: '家居电商' },
  { id: 'general', label: '通用' },
  { id: 'favorite', label: '收藏' },
  { id: 'mine', label: '我的' },
]

const directoryCategories = [
  { id: 'all', label: '推荐' },
  { id: 'film', label: '专业影视' },
  { id: 'advertising', label: '商业广告' },
  { id: 'drama', label: '短剧漫剧' },
  { id: 'anime-game', label: '动漫游戏' },
  { id: 'music-video', label: '音乐MV' },
  { id: 'creator', label: '自媒体创作' },
  { id: 'home-commerce', label: '家居电商' },
  { id: 'common', label: '通用技能' },
  { id: 'discover', label: '发现' },
]

const catalog = computed(() =>
  Array.isArray(DIRECTOR_SKILL_CATALOG) ? DIRECTOR_SKILL_CATALOG : [],
)

const categoryOptions = computed(() => {
  const known = new Set(
    (Array.isArray(DIRECTOR_SKILL_CATEGORIES) ? DIRECTOR_SKILL_CATEGORIES : []).map((category) =>
      typeof category === 'string' ? category : category?.id,
    ),
  )
  return directoryCategories.map((category) => ({
    ...category,
    available: category.id === 'all' || known.has(category.id),
  }))
})

const normalizedSearch = computed(() => debouncedSearchQuery.value.trim().toLocaleLowerCase())
const visibleSkills = computed(() => {
  let values = catalog.value
  if (activeTab.value === 'home-commerce') {
    values = values.filter((skill) => skill.category === 'home-commerce')
  } else if (activeTab.value === 'general') {
    values = values.filter((skill) => skill.category === 'common')
  } else if (activeTab.value === 'favorite') {
    values = values.filter((skill) => favorites.value.has(skill.id || skill.skillKey))
  } else if (activeTab.value === 'mine') {
    values = values.filter((skill) => skill.owned || skill.mine || skill.isMine)
  }
  if (!normalizedSearch.value) return values
  return values.filter((skill) => skillSearchText(skill).includes(normalizedSearch.value))
})

const normalizedDirectorySearch = computed(() => directoryQuery.value.trim().toLocaleLowerCase())
const directorySkills = computed(() =>
  catalog.value.filter((skill) => {
    if (activeTab.value === 'home-commerce' && skill.category !== 'home-commerce') return false
    if (activeTab.value === 'general' && skill.category !== 'common') return false
    if (activeTab.value === 'favorite' && !favorites.value.has(skillId(skill))) return false
    if (activeTab.value === 'mine' && !(skill.owned || skill.mine || skill.isMine)) return false
    const category = skill.category || skill.categoryId || skill.categoryLabel
    const matchesCategory =
      directoryCategory.value === 'all' ||
      directoryCategory.value === 'discover' ||
      category === directoryCategory.value
    const matchesSearch =
      !normalizedDirectorySearch.value ||
      skillSearchText(skill).includes(normalizedDirectorySearch.value)
    return matchesCategory && matchesSearch
  }),
)

function detailField(skill, field) {
  if (skill?.[field]) return skill[field]
  if (skill?.shortSlug === 'viral-video-replicator') {
    if (field === 'scenario') return '带货短视频、创意特效视频'
    if (field === 'usage') return '导入爆款视频和替换的内容'
    if (field === 'output') return '同款视频'
  }
  if (field === 'scenario') return '短视频、品牌广告与创意视频制作'
  if (field === 'usage') return '添加 Skill 后，输入创作目标并提供必要的参考素材'
  return '完整的视频创作方案与可继续生成的视频素材'
}

function skillId(skill) {
  return skill?.id || skill?.skillKey || skill?.shortSlug || skill?.name
}

function skillName(skill) {
  return skill?.name || skill?.label || skill?.title || '未命名 Skill'
}

function skillDescription(skill) {
  return skill?.description || skill?.summary || '通过 Skill 扩展 TV Director 的创作能力'
}

function skillSlug(skill) {
  return (
    skill?.shortSlug || skill?.skillKey || skillName(skill).replaceAll(' ', '-').toLocaleLowerCase()
  )
}

function skillSearchText(skill) {
  return [skillName(skill), skillDescription(skill), skillSlug(skill), skill?.categoryLabel]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase()
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

function updatePosition() {
  if (!props.open || !trigger.value) return
  const anchor = trigger.value.getBoundingClientRect()
  const width = Math.min(MENU_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2)
  const availableAbove = Math.max(180, anchor.top - TRIGGER_GAP - VIEWPORT_MARGIN)
  const height = Math.min(MENU_HEIGHT, availableAbove)
  const left = Math.round(
    clamp(anchor.right - width, VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN),
  )
  menuStyle.value = {
    left: `${left}px`,
    bottom: `${Math.round(window.innerHeight - anchor.top + TRIGGER_GAP)}px`,
    width: `${Math.round(width)}px`,
    height: `${Math.round(height)}px`,
    '--cv3-skill-origin-x': `${Math.round(
      clamp(anchor.left + anchor.width / 2 - left, 16, width - 16),
    )}px`,
  }
}

function updatePreview(skill, event) {
  window.clearTimeout(previewCloseTimer)
  const row = event?.currentTarget
  const menu = dialog.value
  if (!row || !menu) return
  const rowBox = row.getBoundingClientRect()
  const menuBox = menu.getBoundingClientRect()
  const previewHeight = 244
  previewStyle.value = {
    top: `${Math.round(clamp(rowBox.top - menuBox.top, 8, menuBox.height - previewHeight - 8))}px`,
  }
  window.clearTimeout(previewOpenTimer)
  previewOpenTimer = window.setTimeout(
    () => {
      hoveredSkill.value = skill
    },
    event?.type === 'focus' ? 0 : 120,
  )
}

function clearPreview() {
  window.clearTimeout(previewOpenTimer)
  previewCloseTimer = window.setTimeout(() => {
    hoveredSkill.value = null
  }, 80)
}

function openCreateMenu() {
  window.clearTimeout(createCloseTimer)
  createMenuOpen.value = true
}

function scheduleCreateMenuClose() {
  window.clearTimeout(createCloseTimer)
  createCloseTimer = window.setTimeout(() => {
    if (!createMenu.value?.contains(document.activeElement)) createMenuOpen.value = false
  }, 100)
}

function requestOpen(nextOpen, target = 'search') {
  if (nextOpen) {
    focusOnOpen = target
    restoreFocusAfterClose = false
  }
  emit('update:open', nextOpen)
}

function closeMenu({ restoreFocus = true } = {}) {
  createMenuOpen.value = false
  hoveredSkill.value = null
  if (!props.open) return
  restoreFocusAfterClose = restoreFocus
  emit('update:open', false)
}

function closeAll({ restoreFocus = false } = {}) {
  detailSkill.value = null
  directoryOpen.value = false
  closeMenu({ restoreFocus })
}

function toggleMenu() {
  if (props.open) closeMenu({ restoreFocus: false })
  else requestOpen(true)
}

function selectSkill(skill) {
  emit('select', skill)
  closeAll({ restoreFocus: false })
}

function requestCreate() {
  emit('create-request')
  closeAll({ restoreFocus: false })
}

function requestImport() {
  emit('import-request')
  closeAll({ restoreFocus: false })
}

function toggleFavorite(skill) {
  const next = new Set(favorites.value)
  const id = skillId(skill)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  favorites.value = next
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...next]))
  } catch {
    // Favorites remain available for the current session when storage is unavailable.
  }
}

function restoreFavorites() {
  try {
    const saved = JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY) || '[]')
    if (Array.isArray(saved))
      favorites.value = new Set(saved.filter((id) => typeof id === 'string'))
  } catch {
    favorites.value = new Set()
  }
}

async function shareSkill(skill) {
  const shareData = { title: skillName(skill), text: skillDescription(skill) }
  try {
    if (navigator.share) await navigator.share(shareData)
    else await navigator.clipboard?.writeText(`${shareData.title}\n${shareData.text}`)
  } catch {
    // The native share sheet can be dismissed without changing local state.
  }
}

function openDirectory() {
  createMenuOpen.value = false
  hoveredSkill.value = null
  directoryOpen.value = true
  nextTick(() => directoryDialog.value?.querySelector('[data-autofocus]')?.focus())
}

function closeDirectory() {
  detailSkill.value = null
  directoryOpen.value = false
  nextTick(() => dialog.value?.querySelector('.cv3-director-skill-all')?.focus())
}

function showMainTab(tabId) {
  activeTab.value = tabId
  directoryCategory.value = 'all'
}

function openDetail(skill) {
  hoveredSkill.value = null
  detailSkill.value = skill
  nextTick(() => detailDialog.value?.querySelector('[data-autofocus]')?.focus())
}

function closeDetail() {
  detailSkill.value = null
  nextTick(() => {
    if (directoryOpen.value) directoryDialog.value?.focus({ preventScroll: true })
    else dialog.value?.focus({ preventScroll: true })
  })
}

function focusFirstSkill(position = 'first') {
  const rows = [...(dialog.value?.querySelectorAll?.('[role="option"]') || [])]
  if (!rows.length) {
    searchInput.value?.focus({ preventScroll: true })
    return
  }
  const target = position === 'last' ? rows.at(-1) : rows[0]
  target?.focus({ preventScroll: true })
}

function moveListFocus(event) {
  const rows = [...(dialog.value?.querySelectorAll?.('[role="option"]') || [])]
  if (!rows.length) return false
  const current = rows.indexOf(document.activeElement)
  let next = current
  if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % rows.length
  else if (event.key === 'ArrowUp')
    next = current < 0 ? rows.length - 1 : (current - 1 + rows.length) % rows.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = rows.length - 1
  else return false
  event.preventDefault()
  rows[next]?.focus({ preventScroll: true })
  rows[next]?.scrollIntoView({ block: 'nearest' })
  return true
}

function handleDialogKeydown(event) {
  if (
    event.key === 'ArrowDown' ||
    event.key === 'ArrowUp' ||
    event.key === 'Home' ||
    event.key === 'End'
  ) {
    moveListFocus(event)
  }
}

function handleTriggerKeydown(event) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    requestOpen(true, event.key === 'ArrowUp' ? 'last' : 'search')
  }
}

function getFocusable(container) {
  if (!container) return []
  return [
    ...container.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true')
}

function trapFocus(event, container) {
  if (event.key !== 'Tab') return
  const values = getFocusable(container)
  if (!values.length) return
  const first = values[0]
  const last = values.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function handleDocumentKeydown(event) {
  if (event.key !== 'Escape' || !props.open) return
  event.preventDefault()
  event.stopImmediatePropagation()
  if (detailSkill.value) closeDetail()
  else if (directoryOpen.value) closeDirectory()
  else if (createMenuOpen.value) {
    createMenuOpen.value = false
    nextTick(() => createButton.value?.focus())
  } else closeMenu({ restoreFocus: true })
}

function handleDocumentPointerDown(event) {
  if (!props.open || directoryOpen.value || detailSkill.value) return
  const path = event.composedPath?.() || []
  const inside = [trigger.value, dialog.value, createMenu.value].some(
    (element) => element && (path.includes(element) || element.contains(event.target)),
  )
  if (!inside) closeMenu({ restoreFocus: false })
}

function handleOverlayPointerDown(event, close) {
  if (event.target === event.currentTarget) close()
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      activeTab.value = 'home-commerce'
      searchQuery.value = ''
      debouncedSearchQuery.value = ''
      await nextTick()
      updatePosition()
      if (focusOnOpen === 'last') focusFirstSkill('last')
      else searchInput.value?.focus({ preventScroll: true })
      return
    }
    createMenuOpen.value = false
    directoryOpen.value = false
    detailSkill.value = null
    if (restoreFocusAfterClose) {
      restoreFocusAfterClose = false
      await nextTick()
      trigger.value?.focus({ preventScroll: true })
    }
  },
)

watch(searchQuery, (query) => {
  window.clearTimeout(searchDebounceTimer)
  searchDebounceTimer = window.setTimeout(() => {
    debouncedSearchQuery.value = query
  }, 300)
})

watch(
  () => directoryOpen.value || Boolean(detailSkill.value),
  (modalOpen) => {
    if (modalOpen) {
      if (!bodyOverflowBeforeModal) bodyOverflowBeforeModal = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = bodyOverflowBeforeModal
      bodyOverflowBeforeModal = ''
    }
  },
)

onMounted(() => {
  restoreFavorites()
  document.addEventListener('pointerdown', handleDocumentPointerDown, true)
  document.addEventListener('keydown', handleDocumentKeydown, true)
  window.addEventListener('resize', updatePosition)
  window.addEventListener('scroll', updatePosition, true)
  window.visualViewport?.addEventListener('resize', updatePosition)
  window.visualViewport?.addEventListener('scroll', updatePosition)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown, true)
  document.removeEventListener('keydown', handleDocumentKeydown, true)
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('scroll', updatePosition, true)
  window.visualViewport?.removeEventListener('resize', updatePosition)
  window.visualViewport?.removeEventListener('scroll', updatePosition)
  if (bodyOverflowBeforeModal || document.body.style.overflow === 'hidden') {
    document.body.style.overflow = bodyOverflowBeforeModal
  }
  window.clearTimeout(previewOpenTimer)
  window.clearTimeout(previewCloseTimer)
  window.clearTimeout(createCloseTimer)
  window.clearTimeout(searchDebounceTimer)
})
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="cv3-director-skill-trigger"
    :class="{ 'is-open': open }"
    title="Skill"
    aria-label="Skill"
    aria-haspopup="dialog"
    :aria-expanded="open"
    aria-controls="cv3-director-skill-dialog"
    :data-selected-count="Math.max(0, selectedCount)"
    @click.stop="toggleMenu"
    @keydown="handleTriggerKeydown"
  >
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M8.4 1.33c.15 0 .27.12.27.27v.67c0 .14-.12.26-.27.26H3.55c-.2 0-.35.16-.35.36v7.4q.51-.29 1.13-.3h8.47V7.6c0-.15.12-.27.27-.27h.66c.15 0 .27.12.27.27V14c0 .34-.26.63-.6.66H4.21a2.3 2.3 0 0 1-2.19-2H2V2.9c0-.8.61-1.47 1.4-1.55h5M4.33 11.2a1.13 1.13 0 0 0 0 2.27h8.47V11.2zm7.4-9.91a.3.3 0 0 1 .54 0 4.7 4.7 0 0 0 2.44 2.44.3.3 0 0 1 0 .54 4.7 4.7 0 0 0-2.44 2.44.3.3 0 0 1-.54 0 4.7 4.7 0 0 0-2.44-2.44.3.3 0 0 1 0-.54 4.7 4.7 0 0 0 2.44-2.44"
        fill="currentColor"
      />
    </svg>
  </button>

  <Teleport to="body">
    <Transition name="cv3-director-skill-popover">
      <section
        v-if="open"
        id="cv3-director-skill-dialog"
        ref="dialog"
        class="cv3-director-skill-dialog"
        :style="menuStyle"
        role="dialog"
        aria-modal="false"
        aria-label="Skill"
        tabindex="-1"
        data-canvas-shortcuts-ignore
        data-director-popup-open="true"
        @keydown.stop="handleDialogKeydown"
      >
        <header class="cv3-director-skill-header">
          <h2>Skill</h2>
          <div class="cv3-director-skill-header-actions">
            <span
              class="cv3-director-skill-create-wrap"
              @mouseenter="openCreateMenu"
              @mouseleave="scheduleCreateMenuClose"
              @focusin="openCreateMenu"
              @focusout="scheduleCreateMenuClose"
            >
              <button
                ref="createButton"
                type="button"
                class="cv3-director-skill-create"
                aria-haspopup="menu"
                :aria-expanded="createMenuOpen"
                @click="openCreateMenu"
              >
                <span aria-hidden="true">＋</span>
                创建
                <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="m4.7 6.2 3.3 3.3 3.3-3.3"
                    fill="none"
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.2"
                  />
                </svg>
              </button>
              <Transition name="cv3-director-skill-submenu">
                <div
                  v-if="createMenuOpen"
                  ref="createMenu"
                  class="cv3-director-skill-create-menu"
                  role="menu"
                  aria-label="创建 Skill"
                >
                  <button type="button" role="menuitem" @click="requestCreate">
                    <span class="cv3-director-skill-menu-icon" aria-hidden="true">＋</span>
                    <span>
                      <b>创建新的Skill</b>
                      <small>通过与Agent对话创建</small>
                    </span>
                  </button>
                  <button type="button" role="menuitem" @click="requestImport">
                    <span class="cv3-director-skill-menu-icon" aria-hidden="true">↥</span>
                    <span>
                      <b>导入已有Skill</b>
                      <small>上传 .md 文件或文件夹</small>
                    </span>
                  </button>
                </div>
              </Transition>
            </span>
            <button type="button" class="cv3-director-skill-all" @click="openDirectory">
              全部
            </button>
          </div>
        </header>

        <div class="cv3-director-skill-controls">
          <div class="cv3-director-skill-tabs" role="tablist" aria-label="Skill 分类">
            <button
              v-for="tab in tabs"
              :id="`cv3-director-skill-tab-${tab.id}`"
              :key="tab.id"
              type="button"
              role="tab"
              :aria-selected="activeTab === tab.id"
              :class="{ 'is-active': activeTab === tab.id }"
              @click="activeTab = tab.id"
            >
              {{ tab.label }}
            </button>
          </div>
          <label class="cv3-director-skill-search">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.2" />
              <path
                d="m10.4 10.4 3 3"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-width="1.2"
              />
            </svg>
            <input ref="searchInput" v-model="searchQuery" type="search" placeholder="搜索 Skill" />
          </label>
        </div>

        <div class="cv3-director-skill-list" role="listbox" aria-label="可用 Skill">
          <div
            v-for="skill in visibleSkills"
            :key="skillId(skill)"
            class="cv3-director-skill-row"
            role="option"
            tabindex="0"
            aria-selected="false"
            :aria-label="`使用 Skill ${skillName(skill)}`"
            @mouseenter="updatePreview(skill, $event)"
            @mouseleave="clearPreview"
            @focus="updatePreview(skill, $event)"
            @blur="clearPreview"
            @click="selectSkill(skill)"
            @keydown.enter.prevent="selectSkill(skill)"
            @keydown.space.prevent="selectSkill(skill)"
          >
            <span class="cv3-director-skill-icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 16 16">
                <path
                  d="M13.4 5.69q0-.25-.04-.49l-1.12 1.12-.33.32q-.15.14-.41.24-.37.12-.74 0-.26-.1-.42-.24l-.33-.32-.46-.47q-.19-.17-.32-.33-.16-.15-.24-.41a1.2 1.2 0 0 1 0-.74l.04-.12q.1-.17.2-.3l.32-.33 1.11-1.12-.48-.03a3.22 3.22 0 0 0-3.13 3.98l.1.38q.03.15.02.35a1 1 0 0 1-.13.47c-.1.19-.26.35-.4.49l-3.95 3.94a.77.77 0 1 0 1.1 1.1l3.94-3.95c.14-.14.3-.31.48-.4l.12-.06q.16-.07.35-.08.2 0 .35.03l.38.1a3.23 3.23 0 0 0 3.99-3.13m1.13 0a4.35 4.35 0 0 1-5.72 4.15l-.06-.01-.04.02-.18.18-3.94 3.94a1.9 1.9 0 0 1-2.7-2.7l3.94-3.93.2-.22v-.06l-.08-.34a4.36 4.36 0 0 1 6.02-5 .57.57 0 0 1 .17.92l-1.8 1.79-.28.32.03.04.26.26.46.47.27.25.04.03h.02l.03-.03.27-.25 1.79-1.8.05-.04a.57.57 0 0 1 .87.21q.38.83.38 1.8"
                  fill="currentColor"
                />
              </svg>
            </span>
            <span class="cv3-director-skill-copy">
              <span class="cv3-director-skill-name">{{ skillName(skill) }}</span>
              <span class="cv3-director-skill-meta">
                <i>/{{ skillSlug(skill) }}</i>
                <small>{{ skillDescription(skill) }}</small>
              </span>
            </span>
            <button
              type="button"
              class="cv3-director-skill-details"
              :aria-label="`查看 ${skillName(skill)} 详情`"
              @click.stop="openDetail(skill)"
            >
              详情
            </button>
          </div>

          <div v-if="!visibleSkills.length" class="cv3-director-skill-empty">
            <svg width="34" height="34" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M8.4 1.33c.15 0 .27.12.27.27v.67c0 .14-.12.26-.27.26H3.55c-.2 0-.35.16-.35.36v7.4q.51-.29 1.13-.3h8.47V7.6c0-.15.12-.27.27-.27h.66c.15 0 .27.12.27.27V14c0 .34-.26.63-.6.66H4.21a2.3 2.3 0 0 1-2.19-2H2V2.9c0-.8.61-1.47 1.4-1.55h5M4.33 11.2a1.13 1.13 0 0 0 0 2.27h8.47V11.2z"
                fill="currentColor"
              />
            </svg>
            <strong>
              {{
                activeTab === 'favorite'
                  ? '还没有收藏 Skill'
                  : activeTab === 'mine'
                    ? '还没有自己的 Skill'
                    : '没有找到 Skill'
              }}
            </strong>
            <span>换个关键词试试</span>
          </div>
        </div>

        <button type="button" class="cv3-director-skill-footer" @click="openDirectory">
          没找到合适的？
          <span>查看全部 Skill</span>
        </button>

        <Transition name="cv3-director-skill-preview">
          <aside
            v-if="hoveredSkill?.coverUrl"
            class="cv3-director-skill-preview"
            :style="previewStyle"
            aria-hidden="true"
          >
            <img :src="hoveredSkill.coverUrl" alt="" />
            <div>
              <strong>{{ skillName(hoveredSkill) }}</strong>
              <p>{{ skillDescription(hoveredSkill) }}</p>
            </div>
          </aside>
        </Transition>
      </section>
    </Transition>

    <Transition name="cv3-director-skill-modal">
      <div
        v-if="open && directoryOpen"
        class="cv3-director-skill-overlay"
        role="presentation"
        @pointerdown="handleOverlayPointerDown($event, closeDirectory)"
      >
        <section
          ref="directoryDialog"
          class="cv3-director-skill-directory"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cv3-director-skill-directory-title"
          tabindex="-1"
          @keydown="trapFocus($event, directoryDialog)"
        >
          <button
            data-autofocus
            type="button"
            class="cv3-director-skill-close"
            aria-label="关闭 Skill 目录"
            @click="closeDirectory"
          >
            ×
          </button>
          <header>
            <h2 id="cv3-director-skill-directory-title">Skill</h2>
            <nav aria-label="Skill 目录分组">
              <button
                type="button"
                :class="{ 'is-active': activeTab === 'home-commerce' }"
                @click="showMainTab('home-commerce')"
              >
                家居电商
              </button>
              <button
                type="button"
                :class="{ 'is-active': activeTab === 'general' }"
                @click="showMainTab('general')"
              >
                Skill
              </button>
              <button
                type="button"
                :class="{ 'is-active': activeTab === 'favorite' }"
                @click="showMainTab('favorite')"
              >
                收藏
              </button>
              <button
                type="button"
                :class="{ 'is-active': activeTab === 'mine' }"
                @click="showMainTab('mine')"
              >
                我的
              </button>
            </nav>
            <label class="cv3-director-skill-directory-search">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <circle
                  cx="7"
                  cy="7"
                  r="4.5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.2"
                />
                <path
                  d="m10.4 10.4 3 3"
                  fill="none"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-width="1.2"
                />
              </svg>
              <input
                v-model="directoryQuery"
                type="search"
                placeholder="搜索 Skill"
                aria-label="搜索全部 Skill"
              />
            </label>
          </header>

          <div class="cv3-director-skill-directory-body">
            <aside aria-label="Skill 类别">
              <button
                v-for="category in categoryOptions"
                :key="category.id"
                type="button"
                :class="{ 'is-active': directoryCategory === category.id }"
                @click="directoryCategory = category.id"
              >
                {{ category.label }}
              </button>
            </aside>
            <main>
              <p>{{ directorySkills.length }} 个 Skill</p>
              <div class="cv3-director-skill-grid">
                <article
                  v-for="skill in directorySkills"
                  :key="skillId(skill)"
                  class="cv3-director-skill-card"
                >
                  <button
                    type="button"
                    class="cv3-director-skill-card-open"
                    @click="openDetail(skill)"
                  >
                    <span class="cv3-director-skill-card-cover">
                      <img v-if="skill.coverUrl" :src="skill.coverUrl" alt="" />
                      <svg v-else width="28" height="28" viewBox="0 0 16 16" aria-hidden="true">
                        <path
                          d="M8.4 1.33c.15 0 .27.12.27.27v.67c0 .14-.12.26-.27.26H3.55c-.2 0-.35.16-.35.36v7.4q.51-.29 1.13-.3h8.47V7.6c0-.15.12-.27.27-.27h.66c.15 0 .27.12.27.27V14c0 .34-.26.63-.6.66H4.21a2.3 2.3 0 0 1-2.19-2H2V2.9c0-.8.61-1.47 1.4-1.55h5"
                          fill="currentColor"
                        />
                      </svg>
                    </span>
                    <span class="cv3-director-skill-card-copy">
                      <strong>{{ skillName(skill) }}</strong>
                      <small>{{ skillDescription(skill) }}</small>
                      <i>/{{ skillSlug(skill) }}</i>
                    </span>
                  </button>
                  <div class="cv3-director-skill-card-actions">
                    <button
                      type="button"
                      :aria-label="favorites.has(skillId(skill)) ? '取消收藏' : '收藏'"
                      @click="toggleFavorite(skill)"
                    >
                      {{ favorites.has(skillId(skill)) ? '★' : '☆' }}
                    </button>
                    <button type="button" @click="selectSkill(skill)">使用</button>
                  </div>
                </article>
              </div>
              <div v-if="!directorySkills.length" class="cv3-director-skill-directory-empty">
                没有匹配的 Skill
              </div>
            </main>
          </div>
        </section>
      </div>
    </Transition>

    <Transition name="cv3-director-skill-modal">
      <div
        v-if="open && detailSkill"
        class="cv3-director-skill-overlay is-detail"
        role="presentation"
        @pointerdown="handleOverlayPointerDown($event, closeDetail)"
      >
        <section
          ref="detailDialog"
          class="cv3-director-skill-detail"
          role="dialog"
          aria-modal="true"
          :aria-label="`${skillName(detailSkill)} 详情`"
          tabindex="-1"
          @keydown="trapFocus($event, detailDialog)"
        >
          <button
            data-autofocus
            type="button"
            class="cv3-director-skill-close"
            aria-label="关闭 Skill 详情"
            @click="closeDetail"
          >
            ×
          </button>
          <div class="cv3-director-skill-detail-scroll">
            <header class="cv3-director-skill-detail-header">
              <div>
                <span class="cv3-director-skill-detail-kicker">
                  Skill · {{ detailSkill.categoryLabel || '通用' }}
                </span>
                <h2>{{ skillName(detailSkill) }}</h2>
                <p>{{ skillDescription(detailSkill) }}</p>
                <div class="cv3-director-skill-detail-tags">
                  <span>/{{ skillSlug(detailSkill) }}</span>
                  <span>v{{ detailSkill.version || '1.0' }}</span>
                </div>
              </div>
              <div class="cv3-director-skill-detail-actions">
                <button type="button" class="is-quiet" @click="shareSkill(detailSkill)">
                  分享
                </button>
                <button type="button" class="is-quiet" @click="toggleFavorite(detailSkill)">
                  {{ favorites.has(skillId(detailSkill)) ? '★ 已收藏' : '☆ 收藏' }}
                </button>
                <button type="button" class="is-primary" @click="selectSkill(detailSkill)">
                  ＋ 添加 Skill
                </button>
              </div>
            </header>

            <div class="cv3-director-skill-detail-media">
              <img
                v-if="detailSkill.coverUrl"
                :src="detailSkill.coverUrl"
                :alt="`${skillName(detailSkill)} 封面`"
              />
              <svg v-else width="48" height="48" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M8.4 1.33c.15 0 .27.12.27.27v.67c0 .14-.12.26-.27.26H3.55c-.2 0-.35.16-.35.36v7.4q.51-.29 1.13-.3h8.47V7.6c0-.15.12-.27.27-.27h.66c.15 0 .27.12.27.27V14c0 .34-.26.63-.6.66H4.21a2.3 2.3 0 0 1-2.19-2H2V2.9c0-.8.61-1.47 1.4-1.55h5"
                  fill="currentColor"
                />
              </svg>
              <button type="button" class="cv3-director-skill-media-prev" aria-label="上一项">
                ‹
              </button>
              <button type="button" class="cv3-director-skill-media-play" aria-label="预览">
                ▶
              </button>
              <button type="button" class="cv3-director-skill-media-next" aria-label="下一项">
                ›
              </button>
            </div>

            <section
              class="cv3-director-skill-introduction"
              aria-labelledby="cv3-skill-intro-title"
            >
              <h3 id="cv3-skill-intro-title">简介</h3>
              <dl>
                <div>
                  <dt>介绍</dt>
                  <dd>{{ detailSkill.introduction || skillDescription(detailSkill) }}</dd>
                </div>
                <div>
                  <dt>使用场景</dt>
                  <dd>{{ detailField(detailSkill, 'scenario') }}</dd>
                </div>
                <div>
                  <dt>如何使用</dt>
                  <dd>{{ detailField(detailSkill, 'usage') }}</dd>
                </div>
                <div>
                  <dt>输出内容</dt>
                  <dd>{{ detailField(detailSkill, 'output') }}</dd>
                </div>
                <div v-if="detailSkill.sourceName">
                  <dt>研究来源</dt>
                  <dd>
                    {{ detailSkill.sourceName }} · {{ detailSkill.sourceLicense || '参考架构' }}
                  </dd>
                </div>
              </dl>
            </section>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cv3-director-skill-trigger {
  display: inline-grid;
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 8px;
  color: #969696;
  background: transparent;
  cursor: pointer;
  transition:
    color 150ms ease,
    background-color 150ms ease;
}

.cv3-director-skill-trigger:hover,
.cv3-director-skill-trigger:focus-visible,
.cv3-director-skill-trigger.is-open {
  color: #f4f4f4;
  background: rgba(255, 255, 255, 0.08);
  outline: none;
}

.cv3-director-skill-trigger svg {
  display: block;
}

.cv3-director-skill-dialog {
  position: fixed;
  z-index: 1100;
  display: flex;
  flex-direction: column;
  overflow: visible;
  border: 0.5px solid #363636;
  border-radius: 12px;
  color: #ececec;
  background: rgba(23, 23, 23, 0.985);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.24);
  transform-origin: var(--cv3-skill-origin-x, 90%) bottom;
}

.cv3-director-skill-dialog:focus {
  outline: none;
}

.cv3-director-skill-header {
  display: flex;
  height: 44px;
  flex: 0 0 44px;
  align-items: center;
  justify-content: space-between;
  padding: 10px 10px 10px 12px;
}

.cv3-director-skill-header h2 {
  margin: 0;
  font-size: 13px;
  font-weight: 550;
  line-height: 24px;
}

.cv3-director-skill-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.cv3-director-skill-create-wrap {
  position: relative;
}
.cv3-director-skill-create,
.cv3-director-skill-all {
  display: inline-flex;
  height: 24px;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  color: #aaa;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
}

.cv3-director-skill-all {
  width: 52px;
}
.cv3-director-skill-create:hover,
.cv3-director-skill-create:focus-visible,
.cv3-director-skill-all:hover,
.cv3-director-skill-all:focus-visible {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
  outline: none;
}

.cv3-director-skill-create-menu {
  position: absolute;
  z-index: 50;
  top: calc(100% + 4px);
  right: 0;
  width: 264px;
  padding: 6px;
  border: 0.5px solid rgba(255, 255, 255, 0.12);
  border-radius: 16px;
  background: #262626;
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.42);
}

.cv3-director-skill-create-menu > button {
  display: flex;
  width: 100%;
  min-height: 52px;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border: 0;
  border-radius: 10px;
  color: #eee;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.cv3-director-skill-create-menu > button:hover,
.cv3-director-skill-create-menu > button:focus-visible {
  background: rgba(255, 255, 255, 0.08);
  outline: none;
}
.cv3-director-skill-menu-icon {
  display: grid;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  place-items: center;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.07);
  font-size: 16px;
}
.cv3-director-skill-create-menu b {
  display: block;
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
}
.cv3-director-skill-create-menu small {
  display: block;
  margin-top: 2px;
  color: #858585;
  font-size: 11px;
  line-height: 16px;
}

.cv3-director-skill-controls {
  display: flex;
  height: 36px;
  flex: 0 0 36px;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 0 12px 4px;
}

.cv3-director-skill-tabs {
  display: flex;
  min-width: 0;
  height: 28px;
  align-items: center;
  gap: 2px;
}
.cv3-director-skill-tabs button {
  height: 28px;
  padding: 0 9px;
  border: 0;
  border-radius: 6px;
  color: #838383;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
}
.cv3-director-skill-tabs button:hover,
.cv3-director-skill-tabs button:focus-visible {
  color: #eee;
  background: rgba(255, 255, 255, 0.06);
  outline: none;
}
.cv3-director-skill-tabs button.is-active {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}

.cv3-director-skill-search,
.cv3-director-skill-directory-search {
  display: flex;
  width: 212px;
  height: 28px;
  flex: 0 0 212px;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border: 0.5px solid rgba(255, 255, 255, 0.12);
  border-radius: 7px;
  color: #777;
  background: rgba(0, 0, 0, 0.15);
}
.cv3-director-skill-search:focus-within,
.cv3-director-skill-directory-search:focus-within {
  border-color: rgba(50, 195, 255, 0.7);
  box-shadow: 0 0 0 2px rgba(0, 178, 255, 0.1);
}
.cv3-director-skill-search input,
.cv3-director-skill-directory-search input {
  width: 100%;
  min-width: 0;
  padding: 0;
  border: 0;
  outline: 0;
  color: #eee;
  background: transparent;
  font: inherit;
  font-size: 12px;
}
.cv3-director-skill-search input::-webkit-search-cancel-button,
.cv3-director-skill-directory-search input::-webkit-search-cancel-button {
  display: none;
}

.cv3-director-skill-list {
  min-height: 0;
  flex: 1 1 auto;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 6px 6px;
  scrollbar-color: #4d4d4d transparent;
  scrollbar-width: thin;
}

.cv3-director-skill-row {
  position: relative;
  display: flex;
  width: 100%;
  height: 64px;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border: 0;
  border-radius: 8px;
  color: #e9e9e9;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.cv3-director-skill-row:hover,
.cv3-director-skill-row:focus-visible {
  background: rgba(255, 255, 255, 0.075);
  outline: none;
}
.cv3-director-skill-icon {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  place-items: center;
  border: 0.5px solid rgba(255, 255, 255, 0.13);
  border-radius: 7px;
  color: #d0d0d0;
  background: rgba(255, 255, 255, 0.045);
}
.cv3-director-skill-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}
.cv3-director-skill-name {
  max-width: 230px;
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  line-height: 17px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cv3-director-skill-meta {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}
.cv3-director-skill-meta i {
  max-width: 180px;
  height: 20px;
  overflow: hidden;
  padding: 1px 5px;
  border: 0.5px solid rgba(255, 255, 255, 0.13);
  border-radius: 5px;
  color: #9d9d9d;
  font-size: 11px;
  font-style: normal;
  line-height: 17px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cv3-director-skill-meta small {
  min-width: 0;
  overflow: hidden;
  color: #777;
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cv3-director-skill-details {
  position: absolute;
  top: 8px;
  right: 10px;
  display: none;
  width: 52px;
  height: 24px;
  border: 0.5px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  color: #ddd;
  background: #383838;
  cursor: pointer;
  font-size: 12px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}
.cv3-director-skill-row:hover .cv3-director-skill-details,
.cv3-director-skill-row:focus-within .cv3-director-skill-details {
  display: block;
}
.cv3-director-skill-details:hover,
.cv3-director-skill-details:focus-visible {
  color: #fff;
  background: #494949;
  outline: none;
}

.cv3-director-skill-empty {
  display: flex;
  height: 100%;
  min-height: 180px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  color: #555;
  text-align: center;
}
.cv3-director-skill-empty strong {
  margin-top: 10px;
  color: #aaa;
  font-size: 13px;
  font-weight: 500;
}
.cv3-director-skill-empty span {
  margin-top: 4px;
  color: #666;
  font-size: 11px;
}

.cv3-director-skill-footer {
  height: 36px;
  flex: 0 0 36px;
  padding: 0;
  border: 0;
  border-top: 0.5px solid rgba(255, 255, 255, 0.07);
  color: #737373;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  text-align: center;
}
.cv3-director-skill-footer span {
  color: #aaa;
}
.cv3-director-skill-footer:hover span,
.cv3-director-skill-footer:focus-visible span {
  color: #fff;
  text-decoration: underline;
  outline: none;
}

.cv3-director-skill-preview {
  position: absolute;
  z-index: 1110;
  right: calc(100% + 8px);
  width: 290px;
  overflow: hidden;
  border: 0.5px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  background: #262626;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
  pointer-events: none;
}
.cv3-director-skill-preview img {
  display: block;
  width: 290px;
  height: 160px;
  object-fit: cover;
  background: #181818;
}
.cv3-director-skill-preview div {
  padding: 12px 16px;
}
.cv3-director-skill-preview strong {
  display: block;
  overflow: hidden;
  color: #f2f2f2;
  font-size: 15px;
  font-weight: 550;
  line-height: 24px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cv3-director-skill-preview p {
  display: -webkit-box;
  margin: 3px 0 0;
  overflow: hidden;
  color: #929292;
  font-size: 13px;
  line-height: 20px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.cv3-director-skill-overlay {
  position: fixed;
  z-index: 1200;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(2px);
}
.cv3-director-skill-overlay.is-detail {
  background: rgba(0, 0, 0, 0.5);
}
.cv3-director-skill-directory {
  position: relative;
  display: flex;
  width: min(1120px, 92vw);
  height: min(700px, 88vh);
  flex-direction: column;
  overflow: hidden;
  border: 0.5px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  color: #eee;
  background: rgba(20, 20, 20, 0.98);
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.62);
  backdrop-filter: blur(32px);
}
.cv3-director-skill-directory:focus,
.cv3-director-skill-detail:focus {
  outline: none;
}
.cv3-director-skill-close {
  position: absolute;
  z-index: 4;
  top: 16px;
  right: 16px;
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 7px;
  color: #8c8c8c;
  background: transparent;
  cursor: pointer;
  font-size: 21px;
  font-weight: 300;
  line-height: 1;
}
.cv3-director-skill-close:hover,
.cv3-director-skill-close:focus-visible {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
  outline: none;
}

.cv3-director-skill-directory > header {
  display: grid;
  grid-template-columns: auto 1fr auto;
  height: 88px;
  flex: 0 0 88px;
  align-items: end;
  gap: 32px;
  padding: 16px 60px 16px 24px;
  border-bottom: 0.5px solid rgba(255, 255, 255, 0.08);
}
.cv3-director-skill-directory > header h2 {
  align-self: center;
  margin: 0;
  font-size: 23px;
  font-weight: 600;
}
.cv3-director-skill-directory > header nav {
  display: flex;
  align-items: center;
  gap: 16px;
}
.cv3-director-skill-directory > header nav button {
  height: 32px;
  padding: 0 2px;
  border: 0;
  border-bottom: 2px solid transparent;
  color: #777;
  background: transparent;
  cursor: pointer;
  font-size: 17px;
  font-weight: 500;
}
.cv3-director-skill-directory > header nav button.is-active {
  color: #fff;
  border-bottom-color: #fff;
}
.cv3-director-skill-directory-search {
  width: 336px;
  height: 34px;
  flex-basis: 336px;
  border-radius: 8px;
}
.cv3-director-skill-directory-body {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: 184px minmax(0, 1fr);
}
.cv3-director-skill-directory-body > aside {
  display: flex;
  overflow-y: auto;
  flex-direction: column;
  gap: 2px;
  padding: 16px 12px;
  border-right: 0.5px solid rgba(255, 255, 255, 0.08);
}
.cv3-director-skill-directory-body > aside button {
  height: 36px;
  flex: 0 0 36px;
  padding: 0 12px;
  border: 0;
  border-radius: 8px;
  color: #858585;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  text-align: left;
}
.cv3-director-skill-directory-body > aside button:hover,
.cv3-director-skill-directory-body > aside button:focus-visible,
.cv3-director-skill-directory-body > aside button.is-active {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
  outline: none;
}
.cv3-director-skill-directory-body > main {
  min-width: 0;
  overflow-y: auto;
  padding: 16px 20px 24px;
}
.cv3-director-skill-directory-body > main > p {
  margin: 0 0 12px;
  color: #777;
  font-size: 12px;
}
.cv3-director-skill-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.cv3-director-skill-card {
  position: relative;
  display: flex;
  height: 129px;
  min-width: 0;
  align-items: center;
  padding: 12px;
  border: 0.5px solid rgba(255, 255, 255, 0.1);
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.035);
  transition:
    border-color 150ms ease,
    background-color 150ms ease;
}
.cv3-director-skill-card:hover {
  border-color: rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.055);
}
.cv3-director-skill-card-open {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 14px;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.cv3-director-skill-card-open:focus-visible {
  outline: 1px solid #37bdf0;
  outline-offset: 4px;
}
.cv3-director-skill-card-cover {
  display: grid;
  width: 185px;
  height: 104px;
  flex: 0 0 min(185px, 36%);
  place-items: center;
  overflow: hidden;
  border-radius: 8px;
  color: #606060;
  background: #202020;
}
.cv3-director-skill-card-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cv3-director-skill-card-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  align-self: stretch;
  justify-content: center;
}
.cv3-director-skill-card-copy strong {
  overflow: hidden;
  font-size: 14px;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cv3-director-skill-card-copy small {
  display: -webkit-box;
  margin-top: 5px;
  overflow: hidden;
  color: #7f7f7f;
  font-size: 12px;
  line-height: 17px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.cv3-director-skill-card-copy i {
  margin-top: 7px;
  overflow: hidden;
  color: #656565;
  font-size: 10px;
  font-style: normal;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cv3-director-skill-card-actions {
  position: absolute;
  right: 10px;
  bottom: 8px;
  display: flex;
  gap: 5px;
  opacity: 0;
  transition: opacity 120ms ease;
}
.cv3-director-skill-card:hover .cv3-director-skill-card-actions,
.cv3-director-skill-card:focus-within .cv3-director-skill-card-actions {
  opacity: 1;
}
.cv3-director-skill-card-actions button {
  height: 26px;
  padding: 0 8px;
  border: 0.5px solid rgba(255, 255, 255, 0.13);
  border-radius: 6px;
  color: #d8d8d8;
  background: #333;
  cursor: pointer;
  font-size: 11px;
}
.cv3-director-skill-card-actions button:hover,
.cv3-director-skill-card-actions button:focus-visible {
  color: #fff;
  background: #454545;
  outline: none;
}
.cv3-director-skill-directory-empty {
  padding: 100px 20px;
  color: #666;
  text-align: center;
}

.cv3-director-skill-detail {
  position: relative;
  width: min(900px, calc(100vw - 40px));
  height: min(772px, calc(100vh - 120px));
  max-height: calc(100vh - 120px);
  overflow: hidden;
  border: 0.5px solid rgba(255, 255, 255, 0.12);
  border-radius: 16px;
  color: #eee;
  background: #212121;
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.68);
}
.cv3-director-skill-detail-scroll {
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 28px 24px 36px;
  scrollbar-color: #4d4d4d transparent;
  scrollbar-width: thin;
}
.cv3-director-skill-detail-header {
  display: flex;
  min-height: 96px;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 0 36px 20px 2px;
}
.cv3-director-skill-detail-media {
  position: relative;
  display: grid;
  width: 100%;
  aspect-ratio: 16 / 9;
  place-items: center;
  overflow: hidden;
  border: 0.5px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  color: #555;
  background: #171717;
}
.cv3-director-skill-detail-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cv3-director-skill-detail-media button {
  position: absolute;
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  padding: 0;
  border: 0.5px solid rgba(255, 255, 255, 0.16);
  border-radius: 50%;
  color: rgba(255, 255, 255, 0.82);
  background: rgba(15, 15, 15, 0.66);
  cursor: pointer;
  backdrop-filter: blur(8px);
}
.cv3-director-skill-detail-media button:hover,
.cv3-director-skill-detail-media button:focus-visible {
  outline: none;
  color: #fff;
  background: rgba(15, 15, 15, 0.86);
}
.cv3-director-skill-media-prev {
  left: 14px;
}
.cv3-director-skill-media-next {
  right: 14px;
}
.cv3-director-skill-media-play {
  left: 50%;
  width: 46px !important;
  height: 46px !important;
  padding-left: 3px !important;
  transform: translateX(-50%);
}
.cv3-director-skill-detail-kicker {
  color: #6bbfe1;
  font-size: 12px;
}
.cv3-director-skill-detail-header h2 {
  margin: 8px 0 5px;
  font-size: 24px;
  font-weight: 580;
  line-height: 32px;
}
.cv3-director-skill-detail-header p {
  margin: 0;
  color: #9b9b9b;
  font-size: 13px;
  line-height: 20px;
}
.cv3-director-skill-detail-tags {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.cv3-director-skill-detail-tags span {
  padding: 3px 8px;
  border: 0.5px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  color: #929292;
  font-size: 11px;
}
.cv3-director-skill-introduction {
  padding: 24px 4px 4px;
}
.cv3-director-skill-introduction h3 {
  margin: 0 0 16px;
  font-size: 15px;
  font-weight: 550;
}
.cv3-director-skill-introduction dl {
  margin: 0;
}
.cv3-director-skill-introduction dl > div {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 18px;
  padding: 12px 0;
  border-top: 0.5px solid rgba(255, 255, 255, 0.08);
}
.cv3-director-skill-introduction dt {
  color: #858585;
  font-size: 12px;
  line-height: 20px;
}
.cv3-director-skill-introduction dd {
  margin: 0;
  color: #c7c7c7;
  font-size: 13px;
  line-height: 20px;
}
.cv3-director-skill-detail-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  padding-top: 6px;
}
.cv3-director-skill-detail-actions button {
  height: 36px;
  padding: 0 14px;
  border: 0.5px solid rgba(255, 255, 255, 0.14);
  border-radius: 9px;
  cursor: pointer;
  font-size: 12px;
}
.cv3-director-skill-detail-actions .is-quiet {
  color: #ccc;
  background: rgba(255, 255, 255, 0.06);
}
.cv3-director-skill-detail-actions .is-primary {
  color: #111;
  background: #fff;
  font-weight: 550;
}
.cv3-director-skill-detail-actions button:hover,
.cv3-director-skill-detail-actions button:focus-visible {
  filter: brightness(1.12);
  outline: 2px solid rgba(52, 192, 246, 0.25);
  outline-offset: 1px;
}

.cv3-director-skill-popover-enter-active,
.cv3-director-skill-popover-leave-active {
  transition:
    opacity 150ms ease,
    transform 180ms cubic-bezier(0.2, 0, 0, 1);
}
.cv3-director-skill-popover-enter-from,
.cv3-director-skill-popover-leave-to {
  opacity: 0;
  transform: translateY(5px) scale(0.98);
}
.cv3-director-skill-submenu-enter-active,
.cv3-director-skill-submenu-leave-active,
.cv3-director-skill-preview-enter-active,
.cv3-director-skill-preview-leave-active {
  transition:
    opacity 120ms ease,
    transform 150ms cubic-bezier(0.2, 0, 0, 1);
}
.cv3-director-skill-submenu-enter-from,
.cv3-director-skill-submenu-leave-to {
  opacity: 0;
  transform: translateY(-3px) scale(0.98);
}
.cv3-director-skill-preview-enter-from,
.cv3-director-skill-preview-leave-to {
  opacity: 0;
  transform: translateX(6px) scale(0.985);
}
.cv3-director-skill-modal-enter-active,
.cv3-director-skill-modal-leave-active {
  transition: opacity 200ms ease;
}
.cv3-director-skill-modal-enter-active .cv3-director-skill-directory,
.cv3-director-skill-modal-enter-active .cv3-director-skill-detail,
.cv3-director-skill-modal-leave-active .cv3-director-skill-directory,
.cv3-director-skill-modal-leave-active .cv3-director-skill-detail {
  transition: transform 200ms cubic-bezier(0.2, 0, 0, 1);
}
.cv3-director-skill-modal-enter-from,
.cv3-director-skill-modal-leave-to {
  opacity: 0;
}
.cv3-director-skill-modal-enter-from .cv3-director-skill-directory,
.cv3-director-skill-modal-enter-from .cv3-director-skill-detail,
.cv3-director-skill-modal-leave-to .cv3-director-skill-directory,
.cv3-director-skill-modal-leave-to .cv3-director-skill-detail {
  transform: translateY(8px) scale(0.95);
}

@media (max-width: 760px) {
  .cv3-director-skill-directory {
    width: calc(100vw - 20px);
    height: calc(100vh - 20px);
  }
  .cv3-director-skill-directory > header {
    grid-template-columns: 1fr;
    height: auto;
    gap: 8px;
    align-items: start;
    padding: 16px 52px 12px 16px;
  }
  .cv3-director-skill-directory > header h2 {
    display: none;
  }
  .cv3-director-skill-directory-search {
    width: 100%;
    flex-basis: auto;
  }
  .cv3-director-skill-directory-body {
    grid-template-columns: 1fr;
  }
  .cv3-director-skill-directory-body > aside {
    flex-direction: row;
    overflow-x: auto;
    padding: 8px 12px;
    border-right: 0;
    border-bottom: 0.5px solid rgba(255, 255, 255, 0.08);
  }
  .cv3-director-skill-directory-body > aside button {
    flex: 0 0 auto;
  }
  .cv3-director-skill-grid {
    grid-template-columns: 1fr;
  }
  .cv3-director-skill-detail {
    height: calc(100vh - 24px);
    max-height: calc(100vh - 24px);
  }
  .cv3-director-skill-detail-scroll {
    padding: 20px 14px 28px;
  }
  .cv3-director-skill-detail-header {
    flex-direction: column;
    gap: 14px;
    padding: 0 34px 18px 0;
  }
  .cv3-director-skill-detail-actions {
    width: 100%;
  }
  .cv3-director-skill-introduction dl > div {
    grid-template-columns: 72px minmax(0, 1fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  .cv3-director-skill-trigger,
  .cv3-director-skill-card,
  .cv3-director-skill-card-actions,
  .cv3-director-skill-popover-enter-active,
  .cv3-director-skill-popover-leave-active,
  .cv3-director-skill-submenu-enter-active,
  .cv3-director-skill-submenu-leave-active,
  .cv3-director-skill-preview-enter-active,
  .cv3-director-skill-preview-leave-active,
  .cv3-director-skill-modal-enter-active,
  .cv3-director-skill-modal-leave-active,
  .cv3-director-skill-modal-enter-active .cv3-director-skill-directory,
  .cv3-director-skill-modal-enter-active .cv3-director-skill-detail,
  .cv3-director-skill-modal-leave-active .cv3-director-skill-directory,
  .cv3-director-skill-modal-leave-active .cv3-director-skill-detail {
    transition: none;
  }
}
</style>
