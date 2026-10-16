<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  DIRECTOR_ADAPTATION_DIRECTIONS,
  DIRECTOR_ADAPTATION_EPISODES,
  DIRECTOR_GENRES,
  DIRECTOR_HOT_PRESETS,
  DIRECTOR_MODE_MENU,
  DIRECTOR_ROLES,
  getDirectorMode,
} from '../config/directorModes.js'
import { serializeDirectorModelChip } from '../config/directorModelCatalog.js'
import { serializeDirectorSkillChip } from '../config/directorSkillCatalog.js'
import AgentOrb from './AgentOrb.vue'
import CanvasIcon from './CanvasIcon.vue'
import DirectorModelPicker from './DirectorModelPicker.vue'
import DirectorSkillPicker from './DirectorSkillPicker.vue'
import ScriptSetupDialog from './ScriptSetupDialog.vue'

const props = defineProps({
  docked: { type: Boolean, default: false },
  dockWidth: { type: Number, default: 340 },
})
const emit = defineEmits(['close', 'update:docked', 'update:dock-width', 'dock-width-commit'])
const STORAGE_KEY = 'libtv:chatAgentDrawer:floatRect'
const DEFAULT_RECT = { right: 16, bottom: 16, width: 400, height: 640 }
const MIN_WIDTH = 320
const MIN_HEIGHT = 400

const panel = ref(null)
const closeButton = ref(null)
const modeTrigger = ref(null)
const modeMenu = ref(null)
const adaptationTrigger = ref(null)
const adaptationPopover = ref(null)
const directorCustomTrigger = ref(null)
const directorCustomMenu = ref(null)
const storyFileInput = ref(null)
const directorRoleInput = ref(null)
const skillFileInput = ref(null)
const composerInput = ref(null)
const prompt = ref('')
const sentMessages = ref([])
const rect = reactive({ ...DEFAULT_RECT })
const drag = reactive({ active: false, kind: '', direction: '', cursor: '', start: null })
const activeModeId = ref('omni')
const modeMenuOpen = ref(false)
const modelMenuOpen = ref(false)
const skillMenuOpen = ref(false)
const scriptSubmenuOpen = ref(false)
const scriptSetupOpen = ref(false)
const scriptSetup = ref(null)
const adaptationSettingsOpen = ref(false)
const adaptationDirection = ref('')
const adaptationEpisodes = ref(DIRECTOR_ADAPTATION_EPISODES.default)
const storyFileName = ref('')
const directorRoleExpanded = ref(false)
const directorCustomMenuOpen = ref(false)
const activeDirectorRoleId = ref('auto')
const selectedModels = ref([])
const activeModelChipId = ref('')
const draggedModelChipIndex = ref(-1)
const selectedSkills = ref([])
const activeSkillChipId = ref('')
const draggedSkillChipIndex = ref(-1)
const skillCreationOpen = ref(false)
const skillCreationChoice = ref('blank')

const activeMode = computed(() => getDirectorMode(activeModeId.value))
const activeDirectorRole = computed(
  () => DIRECTOR_ROLES.find((role) => role.id === activeDirectorRoleId.value) || DIRECTOR_ROLES[0],
)
const scriptModeActive = computed(() => activeModeId.value.startsWith('script_'))
const hasInlinePopup = computed(
  () =>
    modeMenuOpen.value ||
    modelMenuOpen.value ||
    skillMenuOpen.value ||
    adaptationSettingsOpen.value ||
    directorCustomMenuOpen.value,
)
const adaptationSummary = computed(() => {
  const selected = DIRECTOR_ADAPTATION_DIRECTIONS.find(
    (direction) => direction.id === adaptationDirection.value,
  )
  if (!selected && adaptationEpisodes.value === DIRECTOR_ADAPTATION_EPISODES.default) return ''
  return `改编设定：${selected?.label || '自动'} · ${adaptationEpisodes.value}集`
})
const scriptSetupSummary = computed(() => {
  if (!scriptSetup.value) return ''
  const genre =
    DIRECTOR_GENRES.find((item) => item.id === scriptSetup.value.mainGenre)?.label || '自动题材'
  return `剧本设定：${genre} · ${scriptSetup.value.episodes || 20}集`
})

const panelStyle = computed(() =>
  props.docked
    ? {
        top: '0px',
        right: '0px',
        bottom: 'auto',
        width: `${props.dockWidth}px`,
        height: '100vh',
      }
    : {
        right: `${rect.right}px`,
        bottom: `${rect.bottom}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      },
)

const shortcuts = [
  { id: 'canvas', icon: 'workflow', label: '感知画布开始创作' },
  { id: 'script', icon: 'storyboard', label: '从爆款预设开始剧本原创' },
  { id: 'adapt', icon: 'smartEdit', label: '上传故事来改编' },
  { id: 'optimize', icon: 'text', label: '批量优化提示词' },
]

const resizeDirections = ['w', 'e', 'n', 's', 'nw', 'ne', 'sw', 'se']

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function normalizedRect(source = rect) {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const availableWidth = Math.max(viewportWidth - 32, 0)
  const availableHeight = Math.max(viewportHeight - 32, 0)
  const minimumWidth = Math.min(MIN_WIDTH, availableWidth)
  const minimumHeight = Math.min(MIN_HEIGHT, availableHeight)
  const width = Math.round(
    Math.max(minimumWidth, Math.min(availableWidth, Number(source.width) || DEFAULT_RECT.width)),
  )
  const height = Math.round(
    Math.max(
      minimumHeight,
      Math.min(availableHeight, Number(source.height) || DEFAULT_RECT.height),
    ),
  )
  return {
    width,
    height,
    right: Math.round(clamp(Number(source.right) || 0, 0, viewportWidth - width)),
    bottom: Math.round(clamp(Number(source.bottom) || 0, 0, viewportHeight - height)),
  }
}

function applyRect(nextRect) {
  Object.assign(rect, normalizedRect(nextRect))
}

function saveRect() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...rect }))
  } catch {
    // Storage can be unavailable in private browser contexts; the panel still works for this visit.
  }
}

function restoreRect() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    applyRect(saved || DEFAULT_RECT)
  } catch {
    applyRect(DEFAULT_RECT)
  }
}

function resizeHandleStyle(direction) {
  const common = {
    cursor:
      direction.length === 1
        ? direction === 'w' || direction === 'e'
          ? 'ew-resize'
          : 'ns-resize'
        : direction === 'nw' || direction === 'se'
          ? 'nwse-resize'
          : 'nesw-resize',
  }
  if (direction === 'w')
    return {
      ...common,
      right: `${rect.right + rect.width - 4}px`,
      bottom: `${rect.bottom + 14}px`,
      width: '8px',
      height: `${Math.max(0, rect.height - 28)}px`,
    }
  if (direction === 'e')
    return {
      ...common,
      right: `${rect.right - 4}px`,
      bottom: `${rect.bottom + 14}px`,
      width: '8px',
      height: `${Math.max(0, rect.height - 28)}px`,
    }
  if (direction === 'n')
    return {
      ...common,
      right: `${rect.right + 14}px`,
      bottom: `${rect.bottom + rect.height - 4}px`,
      width: `${Math.max(0, rect.width - 28)}px`,
      height: '8px',
    }
  if (direction === 's')
    return {
      ...common,
      right: `${rect.right + 14}px`,
      bottom: `${rect.bottom - 4}px`,
      width: `${Math.max(0, rect.width - 28)}px`,
      height: '8px',
    }
  const isWest = direction.includes('w')
  const isNorth = direction.includes('n')
  return {
    ...common,
    right: `${isWest ? rect.right + rect.width - 8 : rect.right - 8}px`,
    bottom: `${isNorth ? rect.bottom + rect.height - 8 : rect.bottom - 8}px`,
    width: '16px',
    height: '16px',
  }
}

function beginInteraction(event, kind, direction = '') {
  if (event.button !== 0) return
  if (kind === 'move' && props.docked) return
  if (kind === 'move' && event.target.closest('button')) return
  event.preventDefault()
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  drag.active = true
  drag.kind = kind
  drag.direction = direction
  drag.cursor =
    kind === 'move'
      ? 'grabbing'
      : kind === 'dock-resize'
        ? 'col-resize'
        : resizeHandleStyle(direction).cursor
  drag.start = {
    x: event.clientX,
    y: event.clientY,
    left: viewportWidth - rect.right - rect.width,
    top: viewportHeight - rect.bottom - rect.height,
    rightEdge: viewportWidth - rect.right,
    bottomEdge: viewportHeight - rect.bottom,
    ...rect,
  }
  document.body.style.cursor = drag.cursor
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', continueInteraction, true)
  window.addEventListener('pointerup', endInteraction, true)
  window.addEventListener('pointercancel', endInteraction, true)
}

function continueInteraction(event) {
  if (!drag.active || !drag.start) return
  const dx = event.clientX - drag.start.x
  const dy = event.clientY - drag.start.y
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  if (drag.kind === 'dock-resize') {
    const maxWidth = Math.max(0, Math.min(600, viewportWidth - 48))
    const minWidth = Math.min(MIN_WIDTH, maxWidth)
    emit('update:dock-width', Math.round(clamp(viewportWidth - event.clientX, minWidth, maxWidth)))
    return
  }
  if (drag.kind === 'move') {
    rect.right = Math.round(clamp(drag.start.right - dx, 0, viewportWidth - rect.width))
    rect.bottom = Math.round(clamp(drag.start.bottom - dy, 0, viewportHeight - rect.height))
    return
  }

  const maxWidth = Math.max(viewportWidth - 32, 0)
  const maxHeight = Math.max(viewportHeight - 32, 0)
  const minWidth = Math.min(MIN_WIDTH, maxWidth)
  const minHeight = Math.min(MIN_HEIGHT, maxHeight)
  let left = drag.start.left
  let top = drag.start.top
  let rightEdge = drag.start.rightEdge
  let bottomEdge = drag.start.bottomEdge
  if (drag.direction.includes('w'))
    left = clamp(drag.start.left + dx, Math.max(0, rightEdge - maxWidth), rightEdge - minWidth)
  if (drag.direction.includes('e'))
    rightEdge = clamp(
      drag.start.rightEdge + dx,
      left + minWidth,
      Math.min(viewportWidth, left + maxWidth),
    )
  if (drag.direction.includes('n'))
    top = clamp(drag.start.top + dy, Math.max(0, bottomEdge - maxHeight), bottomEdge - minHeight)
  if (drag.direction.includes('s'))
    bottomEdge = clamp(
      drag.start.bottomEdge + dy,
      top + minHeight,
      Math.min(viewportHeight, top + maxHeight),
    )
  rect.width = Math.round(rightEdge - left)
  rect.height = Math.round(bottomEdge - top)
  rect.right = Math.round(viewportWidth - rightEdge)
  rect.bottom = Math.round(viewportHeight - bottomEdge)
}

function endInteraction() {
  if (!drag.active) return
  const completedKind = drag.kind
  drag.active = false
  drag.kind = ''
  drag.direction = ''
  drag.start = null
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('pointermove', continueInteraction, true)
  window.removeEventListener('pointerup', endInteraction, true)
  window.removeEventListener('pointercancel', endInteraction, true)
  if (completedKind === 'dock-resize') emit('dock-width-commit')
  else saveRect()
}

function isEventInside(event, ...elements) {
  return elements.some((element) => element?.contains?.(event.target))
}

function closeModeMenu({ restoreFocus = false } = {}) {
  modeMenuOpen.value = false
  scriptSubmenuOpen.value = false
  if (restoreFocus) nextTick(() => modeTrigger.value?.focus({ preventScroll: true }))
}

function closeInlinePopups({ restoreFocus = false } = {}) {
  closeModeMenu({ restoreFocus })
  modelMenuOpen.value = false
  skillMenuOpen.value = false
  adaptationSettingsOpen.value = false
  directorCustomMenuOpen.value = false
}

function toggleModeMenu() {
  const willOpen = !modeMenuOpen.value
  closeInlinePopups()
  modeMenuOpen.value = willOpen
  scriptSubmenuOpen.value = willOpen && scriptModeActive.value
  if (willOpen) {
    nextTick(() => {
      modeMenu.value
        ?.querySelector?.(`[data-mode-id="${activeModeId.value}"]`)
        ?.focus({ preventScroll: true })
    })
  }
}

function selectMode(modeId, { openSetup = true } = {}) {
  activeModeId.value = getDirectorMode(modeId).id
  closeInlinePopups({ restoreFocus: true })
  if (activeModeId.value === 'script_original' && openSetup) scriptSetupOpen.value = true
  if (activeModeId.value !== 'script_adaptation') adaptationSettingsOpen.value = false
  if (activeModeId.value !== 'directing') {
    directorRoleExpanded.value = false
    directorCustomMenuOpen.value = false
  }
  nextTick(() => composerInput.value?.focus({ preventScroll: true }))
}

function activateShortcut(shortcut) {
  if (shortcut.id === 'script') {
    selectMode('script_original')
    return
  }
  if (shortcut.id === 'adapt') {
    selectMode('script_adaptation', { openSetup: false })
    nextTick(() => storyFileInput.value?.click())
    return
  }
  if (shortcut.id === 'canvas') {
    prompt.value = '请感知当前画布内容并给出下一步创作建议'
  } else if (shortcut.id === 'optimize') {
    prompt.value = '请批量优化当前画布中的提示词'
  }
  nextTick(() => composerInput.value?.focus({ preventScroll: true }))
}

function onStoryFileChange(event) {
  const file = event.target.files?.[0]
  storyFileName.value = file?.name || ''
  event.target.value = ''
}

function onDirectorRoleFileChange(event) {
  const file = event.target.files?.[0]
  if (file) {
    sentMessages.value.push(`已导入导演角色：${file.name}`)
    directorRoleExpanded.value = false
  }
  event.target.value = ''
}

function resetAdaptationSettings() {
  adaptationDirection.value = ''
  adaptationEpisodes.value = DIRECTOR_ADAPTATION_EPISODES.default
}

function toggleAdaptationDirection(directionId) {
  adaptationDirection.value = adaptationDirection.value === directionId ? '' : directionId
}

function confirmScriptSetup(payload) {
  scriptSetup.value = payload
  scriptSetupOpen.value = false
  nextTick(() => composerInput.value?.focus({ preventScroll: true }))
}

function pickDirectorRole(roleId) {
  activeDirectorRoleId.value = roleId
}

function stepDirectorRole(direction) {
  const current = Math.max(
    0,
    DIRECTOR_ROLES.findIndex((role) => role.id === activeDirectorRoleId.value),
  )
  const next = (current + direction + DIRECTOR_ROLES.length) % DIRECTOR_ROLES.length
  activeDirectorRoleId.value = DIRECTOR_ROLES[next].id
}

function createDirectorRole() {
  directorCustomMenuOpen.value = false
  directorRoleExpanded.value = false
  prompt.value = '帮我创建一个新的导演角色：'
  nextTick(() => composerInput.value?.focus({ preventScroll: true }))
}

function chooseDirectorSuggestion(text) {
  prompt.value = text
  nextTick(() => composerInput.value?.focus({ preventScroll: true }))
}

function insertDirectorModel(model) {
  selectedModels.value.push({
    ...model,
    instanceId: `${model.key}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  })
  activeModelChipId.value = selectedModels.value.at(-1)?.instanceId || ''
  nextTick(() => composerInput.value?.focus({ preventScroll: true }))
}

function insertDirectorSkill(skill) {
  selectedSkills.value.push({
    ...skill,
    instanceId: `${skill.skillKey || skill.id}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
  })
  activeSkillChipId.value = selectedSkills.value.at(-1)?.instanceId || ''
  nextTick(() => composerInput.value?.focus({ preventScroll: true }))
}

function removeDirectorSkill(index) {
  if (index < 0 || index >= selectedSkills.value.length) return
  const [removed] = selectedSkills.value.splice(index, 1)
  if (removed?.instanceId === activeSkillChipId.value) activeSkillChipId.value = ''
  nextTick(() => composerInput.value?.focus({ preventScroll: true }))
}

function handleSkillChipKeydown(event, index) {
  if (event.key !== 'Backspace' && event.key !== 'Delete') return
  event.preventDefault()
  event.stopPropagation()
  removeDirectorSkill(index)
}

function beginSkillChipDrag(event, index) {
  draggedSkillChipIndex.value = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', selectedSkills.value[index]?.id || '')
  }
}

function dropSkillChip(event, targetIndex) {
  event.preventDefault()
  const sourceIndex = draggedSkillChipIndex.value
  draggedSkillChipIndex.value = -1
  if (sourceIndex < 0 || sourceIndex === targetIndex) return
  const reordered = [...selectedSkills.value]
  const [moved] = reordered.splice(sourceIndex, 1)
  reordered.splice(targetIndex, 0, moved)
  selectedSkills.value = reordered
}

function startSkillCreation() {
  skillMenuOpen.value = false
  skillCreationChoice.value = 'blank'
  skillCreationOpen.value = true
}

function dismissSkillCreation() {
  skillCreationOpen.value = false
  nextTick(() => composerInput.value?.focus({ preventScroll: true }))
}

function confirmSkillCreation() {
  const fromCanvas = skillCreationChoice.value === 'canvas'
  sentMessages.value.push({
    display: fromCanvas ? '基于当前画布创建 Skill' : '从零聊出一个 Skill',
    raw: fromCanvas ? '基于当前画布创建 Skill' : '从零聊出一个 Skill',
    parts: [{ type: 'skill_creation', source: fromCanvas ? 'canvas' : 'blank' }],
  })
  prompt.value = fromCanvas
    ? '请分析当前画布，并把这套创作流程整理成一个可复用的 Skill：'
    : '请帮我从零创建一个 Skill，我想实现：'
  skillCreationOpen.value = false
  nextTick(() => composerInput.value?.focus({ preventScroll: true }))
}

function requestSkillImport() {
  skillMenuOpen.value = false
  nextTick(() => skillFileInput.value?.click())
}

async function onSkillFileChange(event) {
  const files = [...(event.target.files || [])]
  for (const file of files) {
    const rawName = file.name.replace(/\.md$/i, '') || '导入的 Skill'
    let skillPrompt = ''
    try {
      skillPrompt = (await file.text()).trim().slice(0, 12000)
    } catch {
      // The imported file can still be represented as a draft chip when browser reading fails.
    }
    insertDirectorSkill({
      id: `local/${rawName}-${Date.now().toString(36)}`,
      skillKey: `local/${rawName}`,
      name: rawName,
      label: rawName,
      description: `从 ${file.name} 导入`,
      prompt: skillPrompt,
      draft: true,
    })
  }
  event.target.value = ''
}

function removeDirectorModel(index) {
  if (index < 0 || index >= selectedModels.value.length) return
  const [removed] = selectedModels.value.splice(index, 1)
  if (removed?.instanceId === activeModelChipId.value) activeModelChipId.value = ''
  nextTick(() => composerInput.value?.focus({ preventScroll: true }))
}

function handleComposerBackspace(event) {
  if (prompt.value || !selectedModels.value.length) {
    if (!prompt.value && selectedSkills.value.length) {
      event.preventDefault()
      removeDirectorSkill(selectedSkills.value.length - 1)
    }
    return
  }
  event.preventDefault()
  removeDirectorModel(selectedModels.value.length - 1)
}

function handleModelChipKeydown(event, index) {
  if (event.key !== 'Backspace' && event.key !== 'Delete') return
  event.preventDefault()
  event.stopPropagation()
  removeDirectorModel(index)
}

function beginModelChipDrag(event, index) {
  draggedModelChipIndex.value = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', selectedModels.value[index]?.key || '')
  }
}

function dropModelChip(event, targetIndex) {
  event.preventDefault()
  const sourceIndex = draggedModelChipIndex.value
  draggedModelChipIndex.value = -1
  if (sourceIndex < 0 || sourceIndex === targetIndex) return
  const reordered = [...selectedModels.value]
  const [moved] = reordered.splice(sourceIndex, 1)
  reordered.splice(targetIndex, 0, moved)
  selectedModels.value = reordered
}

function handleModeMenuKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeModeMenu({ restoreFocus: true })
    return
  }
  const items = [
    ...(modeMenu.value?.querySelectorAll?.('[role="menuitemradio"], [role="menuitem"]') || []),
  ]
  if (!items.length) return
  const current = Math.max(0, items.indexOf(document.activeElement))
  let next = current
  if (event.key === 'ArrowDown') next = (current + 1) % items.length
  else if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = items.length - 1
  else return
  event.preventDefault()
  items[next]?.focus({ preventScroll: true })
}

function handlePanelEscape(event) {
  if (!hasInlinePopup.value) return
  event.preventDefault()
  event.stopPropagation()
  closeInlinePopups({ restoreFocus: modeMenuOpen.value })
}

function handleDocumentPointerDown(event) {
  if (modeMenuOpen.value && !isEventInside(event, modeTrigger.value, modeMenu.value))
    closeModeMenu()
  if (
    adaptationSettingsOpen.value &&
    !isEventInside(event, adaptationTrigger.value, adaptationPopover.value)
  )
    adaptationSettingsOpen.value = false
  if (
    directorCustomMenuOpen.value &&
    !isEventInside(event, directorCustomTrigger.value, directorCustomMenu.value)
  )
    directorCustomMenuOpen.value = false
}

function submitPrompt() {
  const content = prompt.value.trim()
  if (!content && !selectedModels.value.length && !selectedSkills.value.length) return
  const serializedModels = selectedModels.value.map(serializeDirectorModelChip).filter(Boolean)
  const serializedSkills = selectedSkills.value
    .map((skill) => {
      const serialized = serializeDirectorSkillChip(skill)
      if (serialized) return serialized
      if (!skill?.id) return null
      const structuredPart = { type: 'skill', id: skill.id, name: skill.name || skill.label }
      if (skill.prompt) structuredPart.prompt = skill.prompt
      if (skill.draft) structuredPart.draft = true
      return { marker: `{{ skill:${skill.id} }}`, structuredPart }
    })
    .filter(Boolean)
  sentMessages.value.push({
    display: [
      ...selectedModels.value.map((model) => model.label),
      ...selectedSkills.value.map((skill) => skill.name || skill.label),
      content,
    ]
      .filter(Boolean)
      .join(' '),
    raw: [
      ...serializedModels.map((model) => model.marker),
      ...serializedSkills.map((skill) => skill.marker),
      content,
    ]
      .filter(Boolean)
      .join(' '),
    parts: [
      ...serializedModels.map((model) => model.structuredPart),
      ...serializedSkills.map((skill) => skill.structuredPart),
    ],
  })
  prompt.value = ''
  selectedModels.value = []
  selectedSkills.value = []
  activeModelChipId.value = ''
  activeSkillChipId.value = ''
}

function handleViewportResize() {
  if (!props.docked) applyRect(rect)
  closeInlinePopups()
}

onMounted(async () => {
  restoreRect()
  window.addEventListener('resize', handleViewportResize)
  document.addEventListener('pointerdown', handleDocumentPointerDown, true)
  await nextTick()
  closeButton.value?.focus({ preventScroll: true })
})

onBeforeUnmount(() => {
  endInteraction()
  window.removeEventListener('resize', handleViewportResize)
  document.removeEventListener('pointerdown', handleDocumentPointerDown, true)
})

watch(
  () => props.docked,
  () => closeInlinePopups(),
)

watch(modelMenuOpen, (open) => {
  if (open) skillMenuOpen.value = false
})

watch(skillMenuOpen, (open) => {
  if (!open) return
  modelMenuOpen.value = false
  closeModeMenu()
})
</script>

<template>
  <section
    id="cv3-director-panel"
    ref="panel"
    class="cv3-director-panel"
    :class="{ 'is-docked': docked }"
    :style="panelStyle"
    role="dialog"
    aria-modal="false"
    aria-labelledby="cv3-director-title"
    data-canvas-shortcuts-ignore
    :data-director-popup-open="hasInlinePopup || scriptSetupOpen ? 'true' : undefined"
    @pointerdown.stop
    @wheel.stop
    @keydown.esc="handlePanelEscape"
  >
    <span
      v-if="docked"
      class="cv3-director-dock-resize-handle"
      role="separator"
      aria-label="调整 AI 助手面板宽度"
      aria-orientation="vertical"
      data-docked-resize-edge="w"
      @pointerdown.stop="beginInteraction($event, 'dock-resize')"
    />
    <header class="cv3-director-header" @pointerdown="beginInteraction($event, 'move')">
      <h2 id="cv3-director-title">新对话</h2>
      <nav aria-label="TV Director 工具">
        <button type="button" title="新对话" aria-label="新对话" disabled>
          <CanvasIcon name="plus" :size="16" />
        </button>
        <button type="button" title="历史记录" aria-label="历史记录">
          <CanvasIcon name="history" :size="16" />
        </button>
        <button type="button" title="分享" aria-label="分享" disabled>
          <CanvasIcon name="share" :size="14" />
        </button>
        <button type="button" title="全局设置" aria-label="全局设置">
          <CanvasIcon name="settings" :size="16" />
        </button>
        <button type="button" title="LibTV Plugin" aria-label="LibTV Plugin">
          <CanvasIcon name="links" :size="14" />
        </button>
        <button
          type="button"
          :title="docked ? '切换为浮窗' : '停靠到右侧'"
          :aria-label="docked ? '切换为浮窗' : '停靠到右侧'"
          :aria-pressed="docked"
          @click="emit('update:docked', !docked)"
        >
          <CanvasIcon :name="docked ? 'directorFloat' : 'directorDock'" :size="16" />
        </button>
        <button
          ref="closeButton"
          type="button"
          class="cv3-director-close"
          title="关闭"
          aria-label="关闭 TV Director"
          @click="emit('close')"
        >
          <span aria-hidden="true">−</span>
        </button>
      </nav>
    </header>

    <div class="cv3-director-body">
      <div class="cv3-director-messages" aria-live="polite">
        <section v-if="skillCreationOpen" class="cv3-director-skill-question">
          <div class="cv3-director-skill-question-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <path
                d="M13.4 5.69q0-.25-.04-.49l-1.12 1.12-.33.32q-.15.14-.41.24-.37.12-.74 0-.26-.1-.42-.24l-.33-.32-.46-.47q-.19-.17-.32-.33-.16-.15-.24-.41a1.2 1.2 0 0 1 0-.74l.04-.12q.1-.17.2-.3l.32-.33 1.11-1.12-.48-.03a3.22 3.22 0 0 0-3.13 3.98l.1.38q.03.15.02.35a1 1 0 0 1-.13.47c-.1.19-.26.35-.4.49l-3.95 3.94a.77.77 0 1 0 1.1 1.1l3.94-3.95c.14-.14.3-.31.48-.4l.12-.06q.16-.07.35-.08.2 0 .35.03l.38.1a3.23 3.23 0 0 0 3.99-3.13m1.13 0a4.35 4.35 0 0 1-5.72 4.15l-.06-.01-.04.02-.18.18-3.94 3.94a1.9 1.9 0 0 1-2.7-2.7l3.94-3.93.2-.22v-.06l-.08-.34a4.36 4.36 0 0 1 6.02-5 .57.57 0 0 1 .17.92l-1.8 1.79-.28.32.03.04.26.26.46.47.27.25.04.03h.02l.03-.03.27-.25 1.79-1.8.05-.04a.57.57 0 0 1 .87.21q.38.83.38 1.8"
                fill="currentColor"
              />
            </svg>
          </div>
          <h3>你想做什么？</h3>
          <div
            class="cv3-director-skill-question-options"
            role="radiogroup"
            aria-label="创建 Skill 方式"
          >
            <button
              type="button"
              role="radio"
              :aria-checked="skillCreationChoice === 'blank'"
              :class="{ 'is-active': skillCreationChoice === 'blank' }"
              @click="skillCreationChoice = 'blank'"
            >
              <b>1</b>
              <span>从零聊出一个 Skill</span>
            </button>
            <button
              type="button"
              role="radio"
              :aria-checked="skillCreationChoice === 'canvas'"
              :class="{ 'is-active': skillCreationChoice === 'canvas' }"
              @click="skillCreationChoice = 'canvas'"
            >
              <b>2</b>
              <span>基于当前画布创建 Skill</span>
            </button>
          </div>
          <footer>
            <button type="button" @click="dismissSkillCreation">忽略</button>
            <button type="button" class="is-primary" @click="confirmSkillCreation">提交</button>
          </footer>
        </section>
        <div
          v-else-if="!sentMessages.length && activeModeId === 'omni'"
          class="cv3-director-welcome"
        >
          <AgentOrb decorative :size="40" />
          <h3>让 TV Director 辅助你的无限创意</h3>
          <div class="cv3-director-shortcuts">
            <button
              v-for="shortcut in shortcuts"
              :key="shortcut.id"
              type="button"
              @click="activateShortcut(shortcut)"
            >
              <CanvasIcon :name="shortcut.icon" :size="16" />
              <span>{{ shortcut.label }}</span>
              <span class="cv3-director-arrow" aria-hidden="true">→</span>
            </button>
          </div>
        </div>
        <div
          v-else-if="!sentMessages.length && activeModeId === 'script_original'"
          class="cv3-director-script-home"
        >
          <div class="cv3-director-section-heading">
            <span>从爆款题材开始</span>
            <button type="button" @click="scriptSetupOpen = true">剧本设定器</button>
          </div>
          <div class="cv3-director-preset-list">
            <button
              v-for="preset in DIRECTOR_HOT_PRESETS"
              :key="preset.id"
              type="button"
              @click="prompt = preset.prompt"
            >
              <b>#{{ preset.rank }}</b>
              <span>{{ preset.label }}</span>
            </button>
          </div>
        </div>
        <div
          v-else-if="!sentMessages.length && activeModeId === 'script_adaptation'"
          class="cv3-director-welcome cv3-director-adaptation-home"
        >
          <span class="cv3-director-mode-emblem" aria-hidden="true">
            <CanvasIcon name="smartEdit" :size="24" />
          </span>
          <h3>上传故事，快速改编为可拍剧本</h3>
          <p>支持 PDF、TXT、Markdown 和 Word 文档，单个文件不超过 20MB</p>
          <div class="cv3-director-home-actions">
            <button type="button" @click="storyFileInput?.click()">
              <CanvasIcon name="upload" :size="16" />
              上传剧本
            </button>
            <button type="button" @click="adaptationSettingsOpen = true">
              <CanvasIcon name="settings" :size="16" />
              改编设定
            </button>
          </div>
        </div>
        <div
          v-else-if="!sentMessages.length && activeModeId === 'directing'"
          class="cv3-director-directing"
          :class="{ 'is-expanded': directorRoleExpanded }"
        >
          <div v-if="directorRoleExpanded" class="cv3-director-role-heading">
            <span>选择导演角色或</span>
            <span class="cv3-director-custom-wrap">
              <button
                ref="directorCustomTrigger"
                type="button"
                class="cv3-director-custom-trigger"
                aria-haspopup="menu"
                :aria-expanded="directorCustomMenuOpen"
                @click="directorCustomMenuOpen = !directorCustomMenuOpen"
              >
                自定义角色
                <CanvasIcon name="chevron" :size="12" />
              </button>
              <Transition name="cv3-director-popover">
                <div
                  v-if="directorCustomMenuOpen"
                  ref="directorCustomMenu"
                  class="cv3-director-custom-menu"
                  role="menu"
                  data-canvas-shortcuts-ignore
                  data-director-popup-open="true"
                >
                  <button type="button" role="menuitem" @click="createDirectorRole">
                    <CanvasIcon name="characterSheet" :size="18" />
                    <span>
                      <b>创建新的导演角色</b>
                      <small>通过 TV Director 对话创建</small>
                    </span>
                  </button>
                  <button type="button" role="menuitem" @click="directorRoleInput?.click()">
                    <CanvasIcon name="upload" :size="18" />
                    <span>
                      <b>导入已有的导演角色</b>
                      <small>上传 .md 文件或文件夹</small>
                    </span>
                  </button>
                </div>
              </Transition>
            </span>
          </div>
          <div class="cv3-director-role-stage">
            <button
              v-if="directorRoleExpanded"
              type="button"
              class="cv3-director-role-nav"
              aria-label="上一个角色"
              @click="stepDirectorRole(-1)"
            >
              ‹
            </button>
            <div class="cv3-director-role-list" role="radiogroup" aria-label="导演角色">
              <button
                v-for="role in DIRECTOR_ROLES"
                v-show="directorRoleExpanded || role.id === activeDirectorRoleId"
                :key="role.id"
                type="button"
                class="cv3-director-role-avatar"
                :class="{ 'is-active': role.id === activeDirectorRoleId }"
                role="radio"
                :aria-checked="role.id === activeDirectorRoleId"
                :title="role.label"
                @click="pickDirectorRole(role.id)"
              >
                <span>{{ role.label.slice(0, 1) }}</span>
              </button>
            </div>
            <button
              v-if="directorRoleExpanded"
              type="button"
              class="cv3-director-role-nav"
              aria-label="下一个角色"
              @click="stepDirectorRole(1)"
            >
              ›
            </button>
            <button
              v-else
              type="button"
              class="cv3-director-role-toggle"
              aria-label="切换角色"
              @click="directorRoleExpanded = true"
            >
              <CanvasIcon name="reset" :size="12" />
            </button>
          </div>
          <p>导演角色 · {{ activeDirectorRole.label }}</p>
          <div v-if="!directorRoleExpanded" class="cv3-director-suggestions">
            <button type="button" @click="chooseDirectorSuggestion('优化当前视频节点的镜头语言')">
              <CanvasIcon name="cinematicLight" :size="15" />
              优化镜头语言
            </button>
            <button type="button" @click="chooseDirectorSuggestion('根据一句话生成完整分镜')">
              <CanvasIcon name="storyboard" :size="15" />
              一句话生成分镜
            </button>
          </div>
        </div>
        <div v-else class="cv3-director-chat">
          <p v-for="(message, index) in sentMessages" :key="index">
            {{ typeof message === 'string' ? message : message.display }}
          </p>
        </div>
      </div>

      <div
        class="cv3-director-composer"
        :class="{
          'has-auxiliary':
            scriptModeActive && (scriptSetupSummary || activeModeId === 'script_adaptation'),
          'has-model-chips': selectedModels.length || selectedSkills.length,
          'has-double-auxiliary':
            (selectedModels.length || selectedSkills.length) &&
            scriptModeActive &&
            (scriptSetupSummary || activeModeId === 'script_adaptation'),
        }"
      >
        <form
          :class="{
            'has-auxiliary':
              scriptModeActive && (scriptSetupSummary || activeModeId === 'script_adaptation'),
            'has-model-chips': selectedModels.length || selectedSkills.length,
            'has-double-auxiliary':
              (selectedModels.length || selectedSkills.length) &&
              scriptModeActive &&
              (scriptSetupSummary || activeModeId === 'script_adaptation'),
          }"
          @submit.prevent="submitPrompt"
        >
          <div
            v-if="activeModeId === 'script_original' && scriptSetupSummary"
            class="cv3-director-auxiliary"
          >
            <button type="button" class="cv3-director-summary-chip" @click="scriptSetupOpen = true">
              <CanvasIcon name="script" :size="15" />
              {{ scriptSetupSummary }}
            </button>
            <button
              type="button"
              class="cv3-director-chip-remove"
              aria-label="移除剧本设定"
              @click="scriptSetup = null"
            >
              ×
            </button>
          </div>
          <div v-if="activeModeId === 'script_adaptation'" class="cv3-director-auxiliary">
            <button type="button" class="cv3-director-aux-button" @click="storyFileInput?.click()">
              <CanvasIcon name="upload" :size="15" />
              {{ storyFileName || '上传剧本' }}
            </button>
            <button
              ref="adaptationTrigger"
              type="button"
              class="cv3-director-aux-button"
              :class="{ 'is-active': adaptationSettingsOpen }"
              aria-haspopup="dialog"
              :aria-expanded="adaptationSettingsOpen"
              @click="adaptationSettingsOpen = !adaptationSettingsOpen"
            >
              <CanvasIcon name="settings" :size="15" />
              {{ adaptationSummary || '改编设定' }}
            </button>
          </div>
          <div
            v-if="selectedModels.length || selectedSkills.length"
            class="cv3-director-model-chips"
            aria-label="已添加模型和 Skill"
          >
            <button
              v-for="(model, index) in selectedModels"
              :key="model.instanceId"
              type="button"
              class="cv3-director-model-chip"
              :class="{ 'is-active': activeModelChipId === model.instanceId }"
              :title="model.label"
              :aria-label="`模型 ${model.label}，按退格或删除键移除`"
              draggable="true"
              @click="activeModelChipId = model.instanceId"
              @keydown="handleModelChipKeydown($event, index)"
              @dragstart="beginModelChipDrag($event, index)"
              @dragover.prevent
              @drop="dropModelChip($event, index)"
              @dragend="draggedModelChipIndex = -1"
            >
              <span class="cv3-director-model-chip-icon" aria-hidden="true">
                <img v-if="model.logoUrl" :src="model.logoUrl" alt="" />
              </span>
              <span>{{ model.label }}</span>
            </button>
            <button
              v-for="(skill, index) in selectedSkills"
              :key="skill.instanceId"
              type="button"
              class="cv3-director-model-chip cv3-director-skill-chip"
              :class="{ 'is-active': activeSkillChipId === skill.instanceId }"
              :title="skill.name || skill.label"
              :aria-label="`Skill ${skill.name || skill.label}，按退格或删除键移除`"
              draggable="true"
              @click="activeSkillChipId = skill.instanceId"
              @keydown="handleSkillChipKeydown($event, index)"
              @dragstart="beginSkillChipDrag($event, index)"
              @dragover.prevent
              @drop="dropSkillChip($event, index)"
              @dragend="draggedSkillChipIndex = -1"
            >
              <span class="cv3-director-skill-chip-icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M13.4 5.69q0-.25-.04-.49l-1.12 1.12-.33.32q-.15.14-.41.24-.37.12-.74 0-.26-.1-.42-.24l-.33-.32-.46-.47q-.19-.17-.32-.33-.16-.15-.24-.41a1.2 1.2 0 0 1 0-.74l.04-.12q.1-.17.2-.3l.32-.33 1.11-1.12-.48-.03a3.22 3.22 0 0 0-3.13 3.98l.1.38q.03.15.02.35a1 1 0 0 1-.13.47c-.1.19-.26.35-.4.49l-3.95 3.94a.77.77 0 1 0 1.1 1.1l3.94-3.95c.14-.14.3-.31.48-.4l.12-.06q.16-.07.35-.08.2 0 .35.03l.38.1a3.23 3.23 0 0 0 3.99-3.13m1.13 0a4.35 4.35 0 0 1-5.72 4.15l-.06-.01-.04.02-.18.18-3.94 3.94a1.9 1.9 0 0 1-2.7-2.7l3.94-3.93.2-.22v-.06l-.08-.34a4.36 4.36 0 0 1 6.02-5 .57.57 0 0 1 .17.92l-1.8 1.79-.28.32.03.04.26.26.46.47.27.25.04.03h.02l.03-.03.27-.25 1.79-1.8.05-.04a.57.57 0 0 1 .87.21q.38.83.38 1.8"
                    fill="currentColor"
                  />
                </svg>
              </span>
              <span>{{ skill.name || skill.label }}</span>
            </button>
          </div>
          <textarea
            ref="composerInput"
            v-model="prompt"
            rows="2"
            aria-label="发送给 TV Director"
            :placeholder="activeMode.placeholder"
            @keydown.enter.exact.prevent="submitPrompt"
            @keydown.backspace.exact="handleComposerBackspace"
          />
          <div class="cv3-director-composer-controls">
            <button type="button" title="添加附件" aria-label="添加附件">
              <CanvasIcon name="plus" :size="18" />
            </button>
            <button
              ref="modeTrigger"
              type="button"
              class="cv3-director-mode"
              :class="{ 'is-open': modeMenuOpen }"
              aria-label="选择创作模式"
              aria-haspopup="menu"
              :aria-expanded="modeMenuOpen"
              aria-controls="cv3-director-mode-menu"
              @click.stop="toggleModeMenu"
            >
              <span>{{ activeMode.triggerLabel }}</span>
              <CanvasIcon name="chevron" :size="12" />
            </button>
            <DirectorModelPicker
              v-if="activeModeId === 'omni'"
              v-model:open="modelMenuOpen"
              :selected-count="selectedModels.length"
              @select="insertDirectorModel"
            />
            <DirectorSkillPicker
              v-if="activeModeId === 'omni'"
              v-model:open="skillMenuOpen"
              :selected-count="selectedSkills.length"
              @select="insertDirectorSkill"
              @create-request="startSkillCreation"
              @import-request="requestSkillImport"
            />
            <button
              v-else
              type="button"
              class="cv3-director-model-pill"
              title="选择剧本模型"
              aria-label="选择剧本模型"
            >
              <CanvasIcon name="sceneSheet" :size="15" />
              <span>Doubao Seed Evolving</span>
              <CanvasIcon name="chevron" :size="10" />
            </button>
            <button
              v-if="activeModeId !== 'directing'"
              type="button"
              title="手动生成"
              aria-label="手动生成"
            >
              <CanvasIcon name="move" :size="17" />
            </button>
            <span class="cv3-director-spacer" />
            <button
              class="cv3-director-send"
              type="submit"
              aria-label="发送"
              :disabled="!prompt.trim() && !selectedModels.length && !selectedSkills.length"
            >
              <CanvasIcon name="arrowUp" :size="20" />
            </button>
          </div>
        </form>

        <Transition name="cv3-director-popover">
          <div
            v-if="modeMenuOpen"
            id="cv3-director-mode-menu"
            ref="modeMenu"
            class="cv3-director-mode-menu"
            role="menu"
            aria-label="选择创作模式"
            data-canvas-shortcuts-ignore
            data-director-popup-open="true"
            @keydown="handleModeMenuKeydown"
          >
            <template v-for="item in DIRECTOR_MODE_MENU" :key="item.id">
              <button
                v-if="item.type === 'mode'"
                type="button"
                role="menuitemradio"
                :aria-checked="activeModeId === item.modeId"
                :data-mode-id="item.modeId"
                @click="selectMode(item.modeId)"
              >
                <span class="cv3-director-menu-check">
                  <CanvasIcon v-if="activeModeId === item.modeId" name="check" :size="18" />
                </span>
                <span>{{ item.label }}</span>
              </button>
              <div v-else class="cv3-director-mode-group" @pointerenter="scriptSubmenuOpen = true">
                <button
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  :aria-expanded="scriptSubmenuOpen"
                  @click="scriptSubmenuOpen = true"
                >
                  <span class="cv3-director-menu-check" />
                  <span>{{ item.label }}</span>
                  <span class="cv3-director-menu-arrow" aria-hidden="true">›</span>
                </button>
                <Transition name="cv3-director-popover">
                  <div
                    v-if="scriptSubmenuOpen"
                    class="cv3-director-script-submenu"
                    role="menu"
                    aria-label="剧本创编"
                  >
                    <button
                      v-for="modeId in item.children"
                      :key="modeId"
                      type="button"
                      role="menuitemradio"
                      :aria-checked="activeModeId === modeId"
                      :data-mode-id="modeId"
                      @click="selectMode(modeId)"
                    >
                      <span>{{ getDirectorMode(modeId).label }}</span>
                      <span class="cv3-director-menu-check">
                        <CanvasIcon v-if="activeModeId === modeId" name="check" :size="18" />
                      </span>
                    </button>
                  </div>
                </Transition>
              </div>
            </template>
          </div>
        </Transition>

        <Transition name="cv3-director-popover">
          <section
            v-if="adaptationSettingsOpen"
            ref="adaptationPopover"
            class="cv3-director-adaptation-popover"
            role="dialog"
            aria-label="改编设定"
            data-canvas-shortcuts-ignore
            data-director-popup-open="true"
            @keydown.esc.stop.prevent="adaptationSettingsOpen = false"
          >
            <header>
              <strong>改编设定</strong>
              <button
                type="button"
                aria-label="关闭改编设定"
                @click="adaptationSettingsOpen = false"
              >
                ×
              </button>
            </header>
            <p>改编方向</p>
            <div class="cv3-director-adaptation-options">
              <button
                v-for="direction in DIRECTOR_ADAPTATION_DIRECTIONS"
                :key="direction.id"
                type="button"
                :class="{ 'is-selected': adaptationDirection === direction.id }"
                :aria-pressed="adaptationDirection === direction.id"
                @click="toggleAdaptationDirection(direction.id)"
              >
                <b>{{ direction.label }}</b>
                <small>{{ direction.description }}</small>
              </button>
            </div>
            <div class="cv3-director-episodes-row">
              <label for="cv3-adaptation-episodes">集数</label>
              <input
                id="cv3-adaptation-episodes"
                v-model.number="adaptationEpisodes"
                type="range"
                :min="DIRECTOR_ADAPTATION_EPISODES.min"
                :max="DIRECTOR_ADAPTATION_EPISODES.max"
                :step="DIRECTOR_ADAPTATION_EPISODES.step"
              />
              <input
                v-model.number="adaptationEpisodes"
                type="number"
                aria-label="改编集数"
                :min="DIRECTOR_ADAPTATION_EPISODES.min"
                :max="DIRECTOR_ADAPTATION_EPISODES.max"
              />
            </div>
            <button
              type="button"
              class="cv3-director-reset-settings"
              @click="resetAdaptationSettings"
            >
              重置
            </button>
          </section>
        </Transition>
      </div>
    </div>

    <input
      ref="storyFileInput"
      class="cv3-director-hidden-input"
      type="file"
      accept=".pdf,.txt,.md,.doc,.docx"
      aria-label="上传剧本文件"
      @change="onStoryFileChange"
    />
    <input
      ref="directorRoleInput"
      class="cv3-director-hidden-input"
      type="file"
      accept=".md,text/markdown"
      aria-label="导入导演角色"
      @change="onDirectorRoleFileChange"
    />
    <input
      ref="skillFileInput"
      class="cv3-director-hidden-input"
      type="file"
      accept=".md,text/markdown"
      multiple
      aria-label="导入 Skill"
      @change="onSkillFileChange"
    />
  </section>

  <ScriptSetupDialog
    :open="scriptSetupOpen"
    @cancel="scriptSetupOpen = false"
    @confirm="confirmScriptSetup"
  />

  <template v-if="!docked">
    <span
      v-for="direction in resizeDirections"
      :key="direction"
      class="cv3-director-resize-handle"
      :class="`is-${direction}`"
      :style="resizeHandleStyle(direction)"
      :data-resize-direction="direction"
      role="separator"
      aria-label="调整浮窗大小"
      :data-floating-resize-edge="direction"
      @pointerdown="beginInteraction($event, 'resize', direction)"
    />
  </template>
</template>

<style scoped>
.cv3-director-panel {
  position: fixed;
  z-index: 100;
  display: flex;
  min-width: min(320px, calc(100vw - 32px));
  min-height: min(400px, calc(100vh - 32px));
  flex-direction: column;
  overflow: visible;
  border: 0.5px solid #525252;
  border-radius: 28px;
  background: rgba(31, 31, 31, 0.95);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
  color: #f2f2f2;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.cv3-director-panel:focus-within {
  border-color: #5c5c5c;
}

.cv3-director-panel.is-docked {
  min-width: 0;
  min-height: 0;
  max-width: calc(100vw - 48px);
  border: 0;
  border-left: 0.5px solid #525252;
  border-radius: 0;
  background: #212121;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.cv3-director-panel.is-docked:focus-within {
  border-left-color: #5c5c5c;
}

.cv3-director-header {
  display: flex;
  height: 52px;
  flex: 0 0 52px;
  align-items: flex-start;
  justify-content: space-between;
  padding: 10px 16px 14px;
  cursor: grab;
}

.cv3-director-header:active {
  cursor: grabbing;
}

.cv3-director-panel.is-docked .cv3-director-header,
.cv3-director-panel.is-docked .cv3-director-header:active {
  position: sticky;
  z-index: 1000;
  top: 0;
  background: #212121;
  cursor: default;
}

.cv3-director-header h2 {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
}

.cv3-director-header nav {
  display: flex;
  align-items: center;
  gap: 2px;
}

.cv3-director-header button,
.cv3-director-composer-controls button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  color: rgba(255, 255, 255, 0.62);
  cursor: pointer;
}

.cv3-director-header button {
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 8px;
  background: transparent;
  transition:
    color 150ms ease,
    background-color 150ms ease;
}

.cv3-director-header button:hover:not(:disabled),
.cv3-director-header button:focus-visible {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  outline: none;
}

.cv3-director-header button:disabled {
  opacity: 0.4;
  cursor: default;
}

.cv3-director-close span {
  position: relative;
  top: -1px;
  font-size: 18px;
  font-weight: 300;
  line-height: 1;
}

.cv3-director-body {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.cv3-director-messages {
  display: flex;
  min-height: 0;
  flex: 1;
  align-items: flex-end;
  padding: 8px 16px;
  overflow: auto;
  scrollbar-color: #5a5a5a transparent;
  scrollbar-width: thin;
}

.cv3-director-welcome {
  width: 100%;
  min-height: 252px;
  animation: cv3-director-fade-in 200ms ease-out both;
  text-align: center;
}

.cv3-director-welcome :deep(.cv3-agent-orb) {
  margin: 0 auto;
  opacity: 1;
}

.cv3-director-welcome h3 {
  margin: 12px 0 20px;
  color: #f2f2f2;
  font-size: 16px;
  font-weight: 500;
  line-height: 24px;
}

.cv3-director-skill-question {
  width: 100%;
  align-self: center;
  padding: 14px;
  border: 0.5px solid #484848;
  border-radius: 16px;
  background: #282828;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
  animation: cv3-director-fade-in 180ms ease-out both;
}

.cv3-director-skill-question-icon {
  display: grid;
  width: 32px;
  height: 32px;
  margin-bottom: 10px;
  place-items: center;
  border: 0.5px solid #525252;
  border-radius: 9px;
  background: #333;
  color: #dedede;
}

.cv3-director-skill-question h3 {
  margin: 0 0 12px;
  color: #f4f4f4;
  font-size: 15px;
  font-weight: 500;
  line-height: 22px;
}

.cv3-director-skill-question-options {
  display: grid;
  gap: 7px;
}

.cv3-director-skill-question-options button {
  display: grid;
  min-height: 42px;
  grid-template-columns: 24px 1fr;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border: 0.5px solid #454545;
  border-radius: 10px;
  background: transparent;
  color: rgba(255, 255, 255, 0.72);
  cursor: pointer;
  font-size: 13px;
  text-align: left;
  transition:
    border-color 150ms ease,
    background-color 150ms ease,
    color 150ms ease;
}

.cv3-director-skill-question-options button:hover,
.cv3-director-skill-question-options button:focus-visible,
.cv3-director-skill-question-options button.is-active {
  border-color: #676767;
  outline: none;
  background: rgba(255, 255, 255, 0.07);
  color: #fff;
}

.cv3-director-skill-question-options button.is-active {
  border-color: #07b8dd;
  box-shadow: inset 0 0 0 0.5px rgba(7, 184, 221, 0.42);
}

.cv3-director-skill-question-options b {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.08);
  font-size: 11px;
  font-weight: 500;
}

.cv3-director-skill-question footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}

.cv3-director-skill-question footer button {
  height: 30px;
  padding: 0 13px;
  border: 0;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.07);
  color: rgba(255, 255, 255, 0.66);
  cursor: pointer;
}

.cv3-director-skill-question footer button:hover,
.cv3-director-skill-question footer button:focus-visible {
  outline: none;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.cv3-director-skill-question footer .is-primary {
  background: #f2f2f2;
  color: #171717;
}

.cv3-director-skill-question footer .is-primary:hover,
.cv3-director-skill-question footer .is-primary:focus-visible {
  background: #fff;
  color: #111;
}

.cv3-director-shortcuts {
  display: grid;
}

.cv3-director-shortcuts button {
  display: grid;
  width: 100%;
  height: 39px;
  grid-template-columns: 16px 1fr 16px;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  font-size: 14px;
  line-height: 22px;
  text-align: left;
  transition:
    background-color 150ms ease,
    color 150ms ease;
}

.cv3-director-shortcuts button:hover,
.cv3-director-shortcuts button:focus-visible {
  background: rgba(255, 255, 255, 0.07);
  color: rgba(255, 255, 255, 0.88);
  outline: none;
}

.cv3-director-arrow {
  color: rgba(255, 255, 255, 0.3);
  font-size: 18px;
  text-align: right;
}

.cv3-director-script-home,
.cv3-director-directing {
  width: 100%;
  animation: cv3-director-fade-in 200ms ease-out both;
}

.cv3-director-section-heading,
.cv3-director-role-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  color: rgba(255, 255, 255, 0.58);
  font-size: 13px;
}

.cv3-director-section-heading > button,
.cv3-director-home-actions button,
.cv3-director-suggestions button {
  display: inline-flex;
  height: 30px;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.72);
  cursor: pointer;
  font-size: 12px;
}

.cv3-director-section-heading > button:hover,
.cv3-director-home-actions button:hover,
.cv3-director-suggestions button:hover {
  background: rgba(255, 255, 255, 0.09);
  color: #fff;
}

.cv3-director-preset-list {
  display: grid;
  max-height: 250px;
  gap: 6px;
  overflow: auto;
}

.cv3-director-preset-list button {
  display: grid;
  height: 34px;
  grid-template-columns: 34px 1fr;
  align-items: center;
  padding: 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.025);
  color: rgba(255, 255, 255, 0.68);
  cursor: pointer;
  text-align: left;
}

.cv3-director-preset-list button:hover,
.cv3-director-preset-list button:focus-visible {
  border-color: rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  outline: none;
}

.cv3-director-preset-list b {
  color: rgba(255, 255, 255, 0.38);
  font-size: 11px;
}

.cv3-director-adaptation-home p {
  margin: -10px auto 18px;
  color: rgba(255, 255, 255, 0.38);
  font-size: 12px;
  line-height: 18px;
}

.cv3-director-mode-emblem {
  display: inline-flex;
  width: 44px;
  height: 44px;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.75);
}

.cv3-director-home-actions,
.cv3-director-suggestions {
  display: flex;
  justify-content: center;
  gap: 8px;
}

.cv3-director-directing {
  text-align: center;
}

.cv3-director-role-heading {
  justify-content: center;
  gap: 6px;
}

.cv3-director-custom-wrap {
  position: relative;
}

.cv3-director-custom-trigger {
  display: inline-flex;
  height: 28px;
  align-items: center;
  gap: 3px;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.66);
  cursor: pointer;
}

.cv3-director-custom-menu {
  position: absolute;
  z-index: 180;
  top: calc(100% + 6px);
  right: 0;
  display: flex;
  width: 300px;
  flex-direction: column;
  padding: 6px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  background: #242424;
  box-shadow: 0 16px 24px -8px rgba(0, 0, 0, 0.35);
  text-align: left;
}

.cv3-director-custom-menu > button {
  display: flex;
  width: 100%;
  min-height: 58px;
  align-items: flex-start;
  gap: 8px;
  padding: 8px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: rgba(255, 255, 255, 0.9);
  cursor: pointer;
}

.cv3-director-custom-menu > button:hover,
.cv3-director-custom-menu > button:focus-visible {
  background: rgba(255, 255, 255, 0.08);
  outline: none;
}

.cv3-director-custom-menu span {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.cv3-director-custom-menu b {
  font-size: 14px;
  font-weight: 450;
  line-height: 22px;
}

.cv3-director-custom-menu small {
  color: rgba(255, 255, 255, 0.32);
  font-size: 12px;
  line-height: 18px;
}

.cv3-director-role-stage {
  position: relative;
  display: flex;
  min-height: 96px;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.cv3-director-role-list {
  display: flex;
  max-width: calc(100% - 58px);
  align-items: center;
  justify-content: center;
  gap: 6px;
  overflow: hidden;
}

.cv3-director-role-avatar {
  display: inline-flex;
  width: 50px;
  height: 50px;
  flex: 0 0 50px;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 50%;
  background:
    radial-gradient(circle at 35% 28%, rgba(255, 255, 255, 0.32), transparent 18%),
    linear-gradient(145deg, #80f4ce, #4c7cb7 56%, #171d28);
  color: #eefcff;
  cursor: pointer;
  font-size: 16px;
  opacity: 0.38;
  transition:
    width 220ms cubic-bezier(0.2, 0, 0, 1),
    height 220ms cubic-bezier(0.2, 0, 0, 1),
    opacity 180ms ease,
    border-color 180ms ease;
}

.cv3-director-role-avatar.is-active {
  width: 88px;
  height: 88px;
  flex-basis: 88px;
  border-color: #84f5d2;
  box-shadow: 0 0 0 2px rgba(132, 245, 210, 0.12);
  opacity: 1;
}

.cv3-director-role-nav,
.cv3-director-role-toggle {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.52);
  cursor: pointer;
}

.cv3-director-role-toggle {
  position: absolute;
  right: calc(50% - 51px);
  bottom: 5px;
}

.cv3-director-directing > p {
  margin: 8px 0 16px;
  color: rgba(255, 255, 255, 0.58);
  font-size: 13px;
}

.cv3-director-suggestions button {
  min-width: 128px;
  justify-content: center;
}

.cv3-director-chat {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 8px;
  animation: cv3-director-fade-in 200ms ease-out both;
}

.cv3-director-chat p {
  max-width: 85%;
  align-self: flex-end;
  margin: 0;
  padding: 9px 12px;
  border-radius: 14px 14px 4px 14px;
  background: #303030;
  color: #eee;
  font-size: 14px;
  line-height: 20px;
}

.cv3-director-composer {
  position: relative;
  height: 138px;
  flex: 0 0 138px;
  padding: 4px 8px 12px;
}

.cv3-director-composer.has-auxiliary {
  height: 172px;
  flex-basis: 172px;
}

.cv3-director-composer.has-model-chips {
  height: 172px;
  flex-basis: 172px;
}

.cv3-director-composer.has-double-auxiliary {
  height: 206px;
  flex-basis: 206px;
}

.cv3-director-composer form {
  display: flex;
  height: 122px;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: 1px solid #525252;
  border-radius: 16px;
  background: #212121;
  transition: height 280ms cubic-bezier(0.2, 0, 0, 1);
}

.cv3-director-composer form.has-auxiliary {
  height: 156px;
}

.cv3-director-composer form.has-model-chips {
  height: 156px;
}

.cv3-director-composer form.has-double-auxiliary {
  height: 190px;
}

.cv3-director-composer textarea {
  width: 100%;
  height: 64px;
  min-height: 64px;
  padding: 0 0 8px;
  resize: none;
  border: 0;
  outline: 0;
  background: transparent;
  color: #f0f0f0;
  font: inherit;
  font-size: 14px;
  line-height: 24px;
}

.cv3-director-composer form.has-auxiliary textarea {
  height: 38px;
  min-height: 38px;
}

.cv3-director-composer textarea::placeholder {
  color: rgba(255, 255, 255, 0.35);
}

.cv3-director-composer-controls {
  display: flex;
  height: 32px;
  align-items: center;
  gap: 3px;
}

.cv3-director-auxiliary {
  display: flex;
  min-height: 30px;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}

.cv3-director-auxiliary > button {
  display: inline-flex;
  height: 28px;
  min-width: 0;
  align-items: center;
  gap: 5px;
  padding: 0 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.68);
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
}

.cv3-director-auxiliary > button:hover,
.cv3-director-auxiliary > button.is-active {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.cv3-director-auxiliary .cv3-director-summary-chip,
.cv3-director-auxiliary .cv3-director-aux-button {
  max-width: calc(100% - 32px);
  overflow: hidden;
  text-overflow: ellipsis;
}

.cv3-director-auxiliary .cv3-director-chip-remove {
  width: 26px;
  min-width: 26px;
  padding: 0;
  justify-content: center;
  font-size: 17px;
}

.cv3-director-model-chips {
  display: flex;
  min-height: 24px;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.cv3-director-model-chips::-webkit-scrollbar {
  display: none;
}

.cv3-director-model-chip {
  display: inline-flex;
  max-width: 135px;
  height: 24px;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  padding: 0 6px 0 4px;
  border: 0.5px solid #525252;
  border-radius: 8px;
  outline: none;
  background: transparent;
  color: #f7f7f7;
  cursor: grab;
  font-size: 13px;
  font-weight: 400;
  line-height: 16px;
  transition:
    border-color 150ms ease,
    background-color 150ms ease,
    opacity 150ms ease;
}

.cv3-director-model-chip:active {
  cursor: grabbing;
}

.cv3-director-model-chip:hover,
.cv3-director-model-chip:focus-visible,
.cv3-director-model-chip.is-active {
  border-color: #22d3ee;
  background: rgba(34, 211, 238, 0.07);
}

.cv3-director-model-chip > span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv3-director-model-chip-icon {
  display: inline-flex;
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  align-items: center;
  justify-content: center;
}

.cv3-director-model-chip-icon img {
  width: 14px;
  height: 14px;
  object-fit: contain;
}

.cv3-director-skill-chip-icon {
  display: inline-flex;
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  align-items: center;
  justify-content: center;
  color: #bdbdbd;
}

.cv3-director-skill-chip.is-active .cv3-director-skill-chip-icon,
.cv3-director-skill-chip:hover .cv3-director-skill-chip-icon,
.cv3-director-skill-chip:focus-visible .cv3-director-skill-chip-icon {
  color: #4ed9f3;
}

.cv3-director-composer-controls button {
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 8px;
  background: transparent;
  transition: background-color 150ms ease;
}

.cv3-director-composer-controls button:hover:not(:disabled),
.cv3-director-composer-controls button:focus-visible {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  outline: none;
}

.cv3-director-composer-controls .cv3-director-mode {
  width: auto;
  min-width: 81px;
  justify-content: flex-start;
  gap: 4px;
  padding: 0 4px 0 8px;
  border-radius: 9999px;
  color: #e9e9e9;
  font-size: 13px;
}

.cv3-director-composer-controls .cv3-director-mode > span {
  max-width: 122px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv3-director-composer-controls .cv3-director-mode :deep(svg) {
  transition: transform 180ms cubic-bezier(0.2, 0, 0, 1);
}

.cv3-director-composer-controls .cv3-director-mode.is-open {
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.cv3-director-composer-controls .cv3-director-mode.is-open :deep(svg) {
  transform: rotate(180deg);
}

.cv3-director-composer-controls .cv3-director-model-pill {
  width: auto;
  max-width: 154px;
  gap: 4px;
  padding: 0 6px;
  justify-content: flex-start;
  font-size: 12px;
}

.cv3-director-model-pill span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv3-director-mode-menu,
.cv3-director-script-submenu {
  position: absolute;
  z-index: 170;
  display: flex;
  width: 160px;
  flex-direction: column;
  padding: 6px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  background: #242424;
  box-shadow:
    0 16px 24px -8px rgba(0, 0, 0, 0.34),
    0 4px 8px -4px rgba(0, 0, 0, 0.22),
    0 1px 1px rgba(0, 0, 0, 0.16);
}

.cv3-director-mode-menu {
  bottom: 53px;
  left: 51px;
}

.cv3-director-mode-menu button,
.cv3-director-script-submenu button {
  display: flex;
  width: 100%;
  height: 36px;
  align-items: center;
  padding: 0 8px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: rgba(255, 255, 255, 0.9);
  cursor: pointer;
  font-size: 13px;
  line-height: 20px;
  text-align: left;
}

.cv3-director-mode-menu button:hover,
.cv3-director-mode-menu button:focus-visible,
.cv3-director-script-submenu button:hover,
.cv3-director-script-submenu button:focus-visible {
  background: rgba(255, 255, 255, 0.08);
  outline: none;
}

.cv3-director-mode-group {
  position: relative;
}

.cv3-director-menu-check {
  display: inline-flex;
  width: 26px;
  flex: 0 0 26px;
  align-items: center;
}

.cv3-director-mode-menu button > span:nth-child(2),
.cv3-director-script-submenu button > span:first-child {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv3-director-menu-arrow {
  padding-left: 8px;
  font-size: 18px;
}

.cv3-director-script-submenu {
  right: calc(100% + 2px);
  bottom: 0;
}

.cv3-director-script-submenu .cv3-director-menu-check {
  justify-content: flex-end;
}

.cv3-director-adaptation-popover {
  position: absolute;
  z-index: 175;
  bottom: calc(100% + 8px);
  left: 8px;
  width: min(280px, calc(100% - 16px));
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  background: #242424;
  box-shadow: 0 16px 28px -8px rgba(0, 0, 0, 0.46);
  color: #f2f2f2;
}

.cv3-director-adaptation-popover header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.cv3-director-adaptation-popover header strong {
  font-size: 14px;
  font-weight: 550;
}

.cv3-director-adaptation-popover header button {
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  font-size: 18px;
}

.cv3-director-adaptation-popover > p {
  margin: 0 0 7px;
  color: rgba(255, 255, 255, 0.46);
  font-size: 12px;
}

.cv3-director-adaptation-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.cv3-director-adaptation-options button {
  display: flex;
  min-height: 54px;
  flex-direction: column;
  align-items: flex-start;
  padding: 7px 8px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.025);
  color: rgba(255, 255, 255, 0.72);
  cursor: pointer;
  text-align: left;
}

.cv3-director-adaptation-options button.is-selected {
  border-color: rgba(38, 194, 255, 0.68);
  background: rgba(38, 194, 255, 0.1);
  color: #fff;
}

.cv3-director-adaptation-options b {
  font-size: 12px;
  font-weight: 500;
}

.cv3-director-adaptation-options small {
  display: -webkit-box;
  margin-top: 2px;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.34);
  font-size: 10px;
  line-height: 14px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.cv3-director-episodes-row {
  display: grid;
  grid-template-columns: auto 1fr 48px;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  color: rgba(255, 255, 255, 0.62);
  font-size: 12px;
}

.cv3-director-episodes-row input[type='range'] {
  accent-color: #09caf5;
}

.cv3-director-episodes-row input[type='number'] {
  width: 48px;
  height: 28px;
  padding: 0 5px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 7px;
  outline: none;
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  text-align: center;
}

.cv3-director-reset-settings {
  display: block;
  margin: 10px 0 0 auto;
  padding: 4px 7px;
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  font-size: 11px;
}

.cv3-director-hidden-input {
  display: none;
}

.cv3-director-popover-enter-active,
.cv3-director-popover-leave-active {
  transition:
    opacity 150ms ease,
    transform 180ms cubic-bezier(0.2, 0, 0, 1);
  transform-origin: bottom left;
}

.cv3-director-popover-enter-from,
.cv3-director-popover-leave-to {
  opacity: 0;
  transform: translateY(5px) scale(0.98);
}

.cv3-director-spacer {
  flex: 1;
}

.cv3-director-composer-controls .cv3-director-send {
  border-radius: 12px;
  background: #e8e8e8;
  color: #171717;
}

.cv3-director-composer-controls .cv3-director-send:disabled {
  background: #919191;
  color: #171717;
  cursor: default;
}

.cv3-director-resize-handle {
  position: fixed;
  z-index: 110;
  display: block;
  background: transparent;
  touch-action: none;
}

.cv3-director-dock-resize-handle {
  position: absolute;
  z-index: 100;
  top: 0;
  bottom: 0;
  left: 0;
  display: block;
  width: 12px;
  background: transparent;
  cursor: col-resize;
  touch-action: none;
  user-select: none;
}

@keyframes cv3-director-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .cv3-director-welcome,
  .cv3-director-chat,
  .cv3-director-script-home,
  .cv3-director-directing,
  .cv3-director-skill-question {
    animation: none;
  }

  .cv3-director-composer form,
  .cv3-director-header button,
  .cv3-director-shortcuts button,
  .cv3-director-role-avatar,
  .cv3-director-skill-question-options button,
  .cv3-director-composer-controls .cv3-director-mode :deep(svg),
  .cv3-director-popover-enter-active,
  .cv3-director-popover-leave-active {
    transition: none;
  }
}
</style>
