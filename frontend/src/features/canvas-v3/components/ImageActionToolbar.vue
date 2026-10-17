<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CanvasIcon from './CanvasIcon.vue'
import { useCanvasV3GraphStore } from '../stores/graph'
import { apiPath } from '../../../utils/apiBase'
import { IMAGE_GRID_TEMPLATES, imageGridPreset } from '../config/imageGridTemplates'
import { imageGridMenuPlacement } from '../config/popupPlacement'
import { imageEditPreset, PORTRAIT_MENU } from '../config/imageEditPresets'
const props = defineProps({
  node: { type: Object, required: true },
  left: { type: Number, required: true },
  top: { type: Number, default: 56 },
})
const emit = defineEmits(['preview', 'focus', 'emotion', 'angles'])
const graph = useCanvasV3GraphStore()
const menu = ref('')
const gridTrigger = ref(null)
const portraitTrigger = ref(null)
const activeMenuTrigger = computed(() =>
  menu.value === 'portrait' ? portraitTrigger.value : gridTrigger.value,
)
const hoverMenuOpen = computed(() => ['grid', 'portrait'].includes(menu.value))
const gridMenu = ref(null)
const gridPlacement = ref({})
let closeTimer
const gridMenuId = computed(() => `cv3-image-${menu.value || 'grid'}-menu`)

function updateGridPlacement() {
  if (!hoverMenuOpen.value || !activeMenuTrigger.value) return
  const button = activeMenuTrigger.value.getBoundingClientRect()
  const toolbar = activeMenuTrigger.value.closest('.cv3-image-toolbar').getBoundingClientRect()
  const placement = imageGridMenuPlacement(
    { left: button.left, right: button.right, top: toolbar.top, bottom: toolbar.bottom },
    {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    menu.value === 'portrait' ? { width: 180, height: 96 } : undefined,
  )
  gridPlacement.value = {
    left: placement.left + 'px',
    top: placement.top == null ? undefined : placement.top + 'px',
    bottom: placement.bottom == null ? undefined : placement.bottom + 'px',
    width: placement.width + 'px',
    maxHeight: placement.maxHeight + 'px',
  }
}
function keepGridOpen() {
  clearTimeout(closeTimer)
}
function closeGrid(restoreFocus = false) {
  keepGridOpen()
  if (!hoverMenuOpen.value) return
  const trigger = activeMenuTrigger.value
  menu.value = ''
  if (restoreFocus) trigger?.focus({ preventScroll: true })
}
function leaveGrid() {
  keepGridOpen()
  // Allow the pointer to cross the 4px gap into the teleported menu.
  closeTimer = setTimeout(() => {
    if (!gridMenu.value?.contains(document.activeElement)) closeGrid()
  }, 160)
}
function openGrid(action = 'grid') {
  keepGridOpen()
  menu.value = action
  updateGridPlacement()
}
function enterAction(action) {
  if (['grid', 'portrait'].includes(action)) openGrid(action)
  else closeGrid()
}
function clickAction(action) {
  if (['grid', 'portrait'].includes(action)) openGrid(action)
  else if (action === 'panorama') chooseEditPreset('panorama-720')
  else if (action === 'angles') {
    menu.value = ''
    emit('angles', props.node)
  } else menu.value = menu.value === action ? '' : action
}
async function gridTriggerKey(event, action) {
  if (!['grid', 'portrait'].includes(action) || !['ArrowDown', 'ArrowUp'].includes(event.key))
    return
  event.preventDefault()
  event.stopPropagation()
  openGrid(action)
  await nextTick()
  const items = gridMenu.value?.querySelectorAll('[role="menuitem"]')
  items?.[event.key === 'ArrowUp' ? items.length - 1 : 0]?.focus()
}
function gridMenuKey(event) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const items = [...gridMenu.value.querySelectorAll('[role="menuitem"]')]
  const index = items.indexOf(document.activeElement)
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
  items[next]?.focus()
}
function gridFocusOut(event) {
  if (
    !gridMenu.value?.contains(event.relatedTarget) &&
    event.relatedTarget !== activeMenuTrigger.value
  )
    closeGrid()
}
function closeOnOutside(event) {
  if (!gridMenu.value?.contains(event.target) && !activeMenuTrigger.value?.contains(event.target))
    closeGrid()
}
function closeOnEscape(event) {
  if (event.key !== 'Escape' || !hoverMenuOpen.value) return
  event.preventDefault()
  event.stopPropagation()
  closeGrid(true)
}
function chooseGridTemplate(id) {
  const preset = imageGridPreset(id)
  if (!preset) return
  closeGrid()
  const node = graph.createImageVariation(props.node.id, preset)
  if (node) emit('focus', node)
}
function chooseEditPreset(id) {
  const preset = imageEditPreset(id)
  if (!preset) return
  closeGrid()
  menu.value = ''
  if (id === 'portrait-emotion') {
    emit('emotion', props.node)
    return
  }
  const node = graph.createImageVariation(props.node.id, preset)
  if (node) emit('focus', node)
}
watch(
  () => props.top,
  () => {
    void nextTick(updateGridPlacement)
  },
)
watch(
  () => props.node.id,
  () => {
    keepGridOpen()
    menu.value = ''
  },
)
onMounted(() => {
  document.addEventListener('pointerdown', closeOnOutside, true)
  document.addEventListener('keydown', closeOnEscape, true)
  document.addEventListener('scroll', updateGridPlacement, true)
  window.addEventListener('resize', updateGridPlacement)
})
onBeforeUnmount(() => {
  keepGridOpen()
  document.removeEventListener('pointerdown', closeOnOutside, true)
  document.removeEventListener('keydown', closeOnEscape, true)
  document.removeEventListener('scroll', updateGridPlacement, true)
  window.removeEventListener('resize', updateGridPlacement)
})
const actions = [
  ['portrait', '人像质感调节', 'character', 'NEW'],
  ['panorama', '全景', 'panorama'],
  ['angles', '多角度', 'angles'],
  ['lighting', '打光', 'lighting'],
  ['grid', '九宫格', 'grid'],
  ['hd', '高清', 'hd'],
  ['elements', '元素编辑', 'elements'],
  ['layers', '图层分离', 'layers'],
  ['split', '宫格切分', 'grid'],
]
const instructions = {
  portrait: '保留引用图的人物身份和构图，精细优化皮肤质感与真实细节，避免过度磨皮。',
  panorama: '将引用图自然扩展为全景画面，保留原有主体和构图，延展两侧场景。',
  angles: '保持引用图主体的外观、颜色与细节一致，展示新的三分之二侧面视角。',
  lighting: '保持引用图主体和构图不变，调整为柔和的侧向自然光与真实阴影。',
  grid: '以引用图为统一视觉参考，创作 3×3 九宫格分镜，每个画面保持主体一致，展示不同景别。',
  hd: '在保留引用图构图和内容的前提下，提升清晰度和细节，避免添加新的主体。',
  elements: '编辑引用图的指定元素：请在此说明需要修改的主体、区域与目标效果。',
  layers: '根据引用图，提取独立视觉元素：请在此说明要单独提取的主体或背景。',
  split: '参考引用的宫格图，单独重建指定画格：请填写行列位置，并保留画格原有构图与内容。',
}
function edit(action) {
  const node = graph.createImageVariation(props.node.id, {
    title: actions.find((item) => item[0] === action)?.[1] || '图片编辑',
    prompt: instructions[action],
    params: action === 'hd' ? { resolution: '4K' } : action === 'panorama' ? { ratio: '21:9' } : {},
  })
  menu.value = ''
  if (node) emit('focus', node)
}
function rotate() {
  graph.remember()
  graph.updateNodeData(props.node.id, { rotation: ((props.node.data.rotation || 0) + 90) % 360 })
}
function download() {
  const link = document.createElement('a')
  link.href = props.node.data.assetUrl.startsWith('data:')
    ? props.node.data.assetUrl
    : apiPath('/api/image-tasks/proxy-download?url=' + encodeURIComponent(props.node.data.assetUrl))
  link.download = props.node.data.title + '.png'
  link.click()
}
</script>

<template>
  <div
    class="cv3-image-toolbar"
    :style="{ top: top + 'px', left: left + 'px' }"
    role="toolbar"
    aria-label="图片编辑工具栏"
  >
    <button
      v-for="[action, label, icon, badge] in actions"
      :key="action"
      :ref="
        (element) => {
          if (action === 'grid') gridTrigger = element
          if (action === 'portrait') portraitTrigger = element
        }
      "
      type="button"
      :class="{ 'is-open': menu === action }"
      :aria-label="label"
      :title="
        ['grid', 'portrait'].includes(action)
          ? undefined
          : action === 'angles'
            ? '多角度编辑器'
            : label + '：创建引用当前图片的编辑节点'
      "
      :aria-haspopup="['grid', 'portrait'].includes(action) ? 'menu' : undefined"
      :aria-expanded="['grid', 'portrait'].includes(action) ? menu === action : undefined"
      :aria-controls="
        ['grid', 'portrait'].includes(action) ? 'cv3-image-' + action + '-menu' : undefined
      "
      @pointerenter="enterAction(action)"
      @pointerleave="['grid', 'portrait'].includes(action) && leaveGrid()"
      @keydown="gridTriggerKey($event, action)"
      @click="clickAction(action)"
    >
      <CanvasIcon :name="icon" :size="16" />
      <span>{{ label }}</span>
      <small v-if="badge">{{ badge }}</small>
      <CanvasIcon
        v-if="['portrait', 'grid', 'hd', 'split'].includes(action)"
        name="chevron"
        :size="10"
      />
    </button>
    <span class="cv3-image-toolbar-divider" />
    <button type="button" title="局部重绘" aria-label="局部重绘" @click="edit('elements')">
      <CanvasIcon name="eraser" :size="18" />
    </button>
    <button type="button" title="旋转图片" aria-label="旋转图片" @click="rotate">
      <CanvasIcon name="rotate" :size="18" />
    </button>
    <button type="button" title="下载图片" aria-label="下载图片" @click="download">
      <CanvasIcon name="download" :size="18" />
    </button>
    <button type="button" title="放大预览" aria-label="放大预览" @click="emit('preview')">
      <CanvasIcon name="expand" :size="20" />
    </button>
    <div v-if="menu && !hoverMenuOpen" class="cv3-image-action-menu">
      <strong>{{ actions.find((item) => item[0] === menu)?.[1] }}</strong>
      <p>{{ instructions[menu] }}</p>
      <button type="button" @click="edit(menu)">
        创建编辑节点
        <CanvasIcon name="plus" :size="14" />
      </button>
      <small>生成图片需在新节点中确认模型与提示词后发起。</small>
    </div>
    <Teleport to=".cv3-app-shell">
      <div
        v-if="hoverMenuOpen"
        :id="gridMenuId"
        ref="gridMenu"
        class="cv3-image-grid-menu"
        :class="{ 'is-portrait': menu === 'portrait' }"
        role="menu"
        :aria-label="menu === 'portrait' ? '人像质感调节' : '九宫格模板'"
        :style="gridPlacement"
        @pointerenter="keepGridOpen"
        @pointerleave="leaveGrid"
        @focusout="gridFocusOut"
        @keydown.stop="gridMenuKey"
      >
        <button
          v-for="template in menu === 'portrait' ? PORTRAIT_MENU : IMAGE_GRID_TEMPLATES"
          :key="template.id"
          type="button"
          role="menuitem"
          @click="
            menu === 'portrait' ? chooseEditPreset(template.id) : chooseGridTemplate(template.id)
          "
        >
          <CanvasIcon :name="template.icon" :size="18" />
          <span>{{ template.label }}</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>
