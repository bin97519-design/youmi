<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { selectionMenuPlacement, selectionToolbarPlacement } from '../config/selectionGeometry.js'

const props = defineProps({
  count: { type: Number, default: 0 },
  bounds: { type: Object, required: true },
  viewport: { type: Object, required: true },
  mutable: Boolean,
  group: { type: Object, default: null },
  canSave: Boolean,
  canDownload: Boolean,
  canChat: Boolean,
  downloading: Boolean,
})
const emit = defineEmits([
  'arrange',
  'save',
  'duplicate',
  'group',
  'ungroup',
  'download',
  'chat',
  'skill',
])
const root = ref(null)
const layoutTrigger = ref(null)
const groupTrigger = ref(null)
const menuPanel = ref(null)
const menu = ref('')
const menuPosition = ref(null)
const id = `cv3-selection-${useId()}`
const placement = computed(() =>
  selectionToolbarPlacement(props.bounds, { width: 644, height: 50 }, props.viewport),
)
const toolbarStyle = computed(
  () =>
    placement.value && {
      left: `${placement.value.left}px`,
      top: `${placement.value.top}px`,
      width: `${placement.value.width}px`,
      maxWidth: `${placement.value.maxWidth}px`,
    },
)
const menuStyle = computed(
  () =>
    menuPosition.value &&
    placement.value && {
      left: `${menuPosition.value.left - placement.value.left}px`,
      top: `${menuPosition.value.top - placement.value.top}px`,
      width: `${menuPosition.value.width}px`,
      height: `${menuPosition.value.height}px`,
      maxHeight: `${menuPosition.value.maxHeight}px`,
    },
)
const layouts = [
  { key: 'grid', label: '宫格排列', path: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z' },
  { key: 'horizontal', label: '水平排列', path: 'M3 6h5v12H3zM10 6h5v12h-5zM17 6h4v12h-4z' },
  { key: 'vertical', label: '垂直排列', path: 'M6 3h12v5H6zM6 10h12v5H6zM6 17h12v4H6z' },
]
const icon = {
  layout: 'M3 3h18v7H3zM3 14h7v7H3zM14 14h7v7h-7z',
  asset: 'M12 9 5 22h14L12 9Zm3 1 5-7-6-2-5 7M10 9a5 5 0 1 0-2 8',
  copy: 'M8 8h13v13H8zM16 8V3H3v13h5',
  group:
    'M8 2H4a2 2 0 0 0-2 2v4M16 2h4a2 2 0 0 1 2 2v4M2 16v4a2 2 0 0 0 2 2h4m8 0h4a2 2 0 0 0 2-2v-4M7 7h7v7H7zM11 14v4h7v-7h-4',
  download: 'M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6',
  chat: 'M20 4H4v13h5l3 4 3-4h5V4ZM8 9h8M8 13h5',
  skill: 'M5 4h9l5 5v12H5V4Zm9 0v5h5M9 13h6M9 17h4M3 2v4M1 4h4',
  storyboard: 'M3 5h18v14H3zM3 9h18M7 5v4m5-4v4m5-4v4M8 12v4l5-2-5-2',
  ungroup: 'M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h6v6h-6zM10 12h4',
}

function triggerFor(kind) {
  return kind === 'layout' ? layoutTrigger.value : groupTrigger.value
}
function closeMenu(restoreFocus = false) {
  const trigger = triggerFor(menu.value)
  menu.value = ''
  menuPosition.value = null
  if (restoreFocus) trigger?.focus({ preventScroll: true })
}
function positionedMenu(kind) {
  const toolbar = placement.value
  if (!toolbar) return null
  const trigger = triggerFor(kind)?.getBoundingClientRect?.()
  const outer = root.value?.getBoundingClientRect?.()
  const left = trigger && outer ? toolbar.left + trigger.left - outer.left : toolbar.left
  const width = trigger?.width || 30
  return selectionMenuPlacement(
    {
      left,
      right: left + width,
      top: toolbar.top,
      bottom: toolbar.top + toolbar.height,
    },
    kind === 'layout'
      ? { width: 120, height: 132 }
      : { width: 150, height: props.group ? 115 : 80 },
    props.viewport,
    kind === 'layout' ? 'above' : 'below',
  )
}
async function toggleMenu(kind, event) {
  if (!props.mutable || props.count < 2) return
  if (menu.value === kind && event?.type !== 'keydown') return closeMenu(true)
  menu.value = kind
  menuPosition.value = positionedMenu(kind)
  await nextTick()
  const entries = [...(menuPanel.value?.querySelectorAll('[role="menuitem"]:not(:disabled)') || [])]
  entries[event?.key === 'ArrowUp' ? entries.length - 1 : 0]?.focus({ preventScroll: true })
}
function triggerKey(kind, event) {
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
  event.preventDefault()
  event.stopPropagation()
  return toggleMenu(kind, event)
}
function permitted(action) {
  if (props.count < 2) return false
  if (action === 'save') return props.canSave
  if (action === 'download') return props.canDownload && !props.downloading
  if (action === 'chat') return props.canChat
  return props.mutable
}
function choose(action, payload) {
  if (!permitted(action)) return
  closeMenu(Boolean(menu.value))
  if (payload === undefined) emit(action)
  else emit(action, payload)
}
function menuKey(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeMenu(true)
  } else if (event.key === 'Tab') closeMenu(true)
  else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    event.stopPropagation()
    const items = [...(menuPanel.value?.querySelectorAll('[role="menuitem"]:not(:disabled)') || [])]
    if (!items.length) return
    const current = items.indexOf(globalThis.document?.activeElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : current < 0
            ? event.key === 'ArrowUp'
              ? items.length - 1
              : 0
            : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
    items[next]?.focus({ preventScroll: true })
  }
}
function outside(event) {
  if (!root.value?.contains(event.target)) closeMenu()
}
function escape(event) {
  if (event.key === 'Escape' && menu.value) menuKey(event)
}
function closeOnMove() {
  closeMenu(Boolean(menuPanel.value?.contains(globalThis.document?.activeElement)))
}
function focusOut(event) {
  if (!root.value?.contains(event.relatedTarget)) closeMenu()
}
watch(
  () => [
    props.bounds?.left,
    props.bounds?.top,
    props.bounds?.right,
    props.bounds?.bottom,
    props.viewport?.width,
    props.viewport?.height,
    props.count,
    props.mutable,
    props.group?.id,
    props.group?.type,
  ],
  closeOnMove,
)
onMounted(() => {
  globalThis.document?.addEventListener('pointerdown', outside, true)
  globalThis.document?.addEventListener('keydown', escape, true)
  globalThis.window?.addEventListener('resize', closeOnMove)
})
onBeforeUnmount(() => {
  globalThis.document?.removeEventListener('pointerdown', outside, true)
  globalThis.document?.removeEventListener('keydown', escape, true)
  globalThis.window?.removeEventListener('resize', closeOnMove)
})
</script>

<template>
  <nav
    v-if="count >= 2 && placement"
    ref="root"
    class="cv3-selection-toolbar nodrag nopan nowheel"
    :style="toolbarStyle"
    role="toolbar"
    aria-label="多选操作工具栏"
    :aria-description="`已选中 ${count} 个节点`"
    data-cv3-selection-ui
    @pointerdown.stop
    @click.stop
    @dblclick.stop
    @wheel.stop
    @focusout="focusOut"
  >
    <div class="cv3-selection-toolbar-scroll" @scroll="closeMenu()">
      <button
        ref="layoutTrigger"
        class="cv3-selection-icon-button cv3-selection-layout-trigger"
        type="button"
        aria-label="布局"
        title="布局"
        aria-haspopup="menu"
        :aria-expanded="menu === 'layout'"
        :aria-controls="`${id}-layout`"
        :disabled="!mutable"
        @click="toggleMenu('layout', $event)"
        @keydown="triggerKey('layout', $event)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="icon.layout" /></svg>
      </button>
      <span class="cv3-selection-divider" aria-hidden="true" />
      <button type="button" :disabled="!canSave" @click="choose('save')">
        <svg class="cv3-selection-icon-16" viewBox="0 0 24 24" aria-hidden="true">
          <path :d="icon.asset" />
        </svg>
        <span>保存到资产</span>
      </button>
      <button type="button" :disabled="!mutable" @click="choose('duplicate')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="icon.copy" /></svg>
        <span>创建副本</span>
      </button>
      <span class="cv3-selection-divider" aria-hidden="true" />
      <button
        ref="groupTrigger"
        type="button"
        aria-haspopup="menu"
        :aria-expanded="menu === 'group'"
        :aria-controls="`${id}-group`"
        :disabled="!mutable"
        @click="toggleMenu('group', $event)"
        @keydown="triggerKey('group', $event)"
      >
        <svg class="cv3-selection-icon-16" viewBox="0 0 24 24" aria-hidden="true">
          <path :d="icon.group" />
        </svg>
        <span>打组</span>
        <svg class="cv3-selection-chevron" viewBox="0 0 12 12" aria-hidden="true">
          <path d="m3 4.5 3 3 3-3" />
        </svg>
      </button>
      <button
        class="cv3-selection-icon-button cv3-selection-download"
        type="button"
        aria-label="批量下载"
        :title="downloading ? '正在打包下载' : '批量下载'"
        :aria-busy="downloading"
        :disabled="!canDownload || downloading"
        @click="choose('download')"
      >
        <svg v-if="!downloading" viewBox="0 0 24 24" aria-hidden="true">
          <path :d="icon.download" />
        </svg>
        <svg v-else class="cv3-selection-spinner" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3a9 9 0 1 1-9 9" />
        </svg>
      </button>
      <span class="cv3-selection-divider" aria-hidden="true" />
      <button type="button" :disabled="!canChat" @click="choose('chat')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="icon.chat" /></svg>
        <span>添加到Chat</span>
      </button>
      <button type="button" :disabled="!mutable" @click="choose('skill')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="icon.skill" /></svg>
        <span>创建为Skill</span>
      </button>
    </div>
    <div
      v-if="menu && menuPosition"
      :id="`${id}-${menu}`"
      ref="menuPanel"
      class="cv3-selection-menu"
      :class="`is-${menu}`"
      :style="menuStyle"
      role="menu"
      :aria-label="menu === 'layout' ? '布局方式' : '打组方式'"
      data-cv3-selection-ui
      @keydown="menuKey"
    >
      <template v-if="menu === 'layout'">
        <button
          v-for="layout in layouts"
          :key="layout.key"
          type="button"
          role="menuitem"
          :disabled="!mutable"
          @click="choose('arrange', layout.key)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="layout.path" /></svg>
          <span>{{ layout.label }}</span>
        </button>
      </template>
      <template v-else>
        <button
          type="button"
          role="menuitem"
          :disabled="!mutable"
          @click="choose('group', 'normal')"
        >
          <svg class="cv3-selection-icon-16" viewBox="0 0 24 24" aria-hidden="true">
            <path :d="icon.group" />
          </svg>
          <span>打组</span>
        </button>
        <button
          type="button"
          role="menuitem"
          :disabled="!mutable"
          @click="choose('group', 'storyboard')"
        >
          <svg class="cv3-selection-icon-16" viewBox="0 0 24 24" aria-hidden="true">
            <path :d="icon.storyboard" />
          </svg>
          <span>合并分镜组</span>
        </button>
        <button
          v-if="group"
          type="button"
          role="menuitem"
          :disabled="!mutable"
          @click="choose('ungroup')"
        >
          <svg class="cv3-selection-icon-16" viewBox="0 0 24 24" aria-hidden="true">
            <path :d="icon.ungroup" />
          </svg>
          <span>取消分组</span>
        </button>
      </template>
    </div>
  </nav>
</template>

<style scoped>
.cv3-selection-toolbar {
  position: absolute;
  z-index: 44;
  box-sizing: border-box;
  height: 50px;
  padding: 8px;
  border: 1px solid #363636;
  border-radius: 12px;
  background: #262626;
  color: #dedede;
  box-shadow: 0 4px 14px #0003;
  font-family: inherit;
  font-size: 13px;
  line-height: 20px;
  pointer-events: auto;
}
.cv3-selection-toolbar-scroll {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2px;
  height: 32px;
  overflow-x: auto;
  scrollbar-width: none;
}
.cv3-selection-toolbar-scroll::-webkit-scrollbar {
  display: none;
}
.cv3-selection-toolbar button {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 32px;
  box-sizing: border-box;
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
}
.cv3-selection-toolbar button:hover:not(:disabled),
.cv3-selection-toolbar button[aria-expanded='true'] {
  background: #ffffff10;
  color: #fff;
}
.cv3-selection-toolbar button:focus-visible {
  outline: 2px solid #8dd4e5;
  outline-offset: -2px;
}
.cv3-selection-toolbar button:disabled {
  opacity: 0.38;
  cursor: default;
}
.cv3-selection-toolbar svg {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.cv3-selection-toolbar svg.cv3-selection-icon-16 {
  width: 16px;
  height: 16px;
}
.cv3-selection-toolbar svg.cv3-selection-chevron {
  width: 8px;
  height: 8px;
  color: #999;
}
.cv3-selection-toolbar button.cv3-selection-icon-button {
  width: 30px;
  padding: 0;
}
.cv3-selection-toolbar button.cv3-selection-download {
  width: 32px;
}
.cv3-selection-download svg {
  width: 20px;
  height: 20px;
}
.cv3-selection-divider {
  flex: 0 0 1px;
  height: 18px;
  margin: 0 4px;
  background: #424242;
}
.cv3-selection-menu {
  position: absolute;
  z-index: 1;
  box-sizing: border-box;
  padding: 5px;
  overflow-y: auto;
  border: 1px solid #363636;
  border-radius: 9px;
  background: #262626;
  color: #dedede;
  box-shadow: 0 5px 16px #0005;
}
.cv3-selection-menu button {
  display: flex;
  justify-content: flex-start;
  width: 100%;
}
.cv3-selection-menu.is-layout button {
  height: 40px;
}
.cv3-selection-menu.is-group {
  padding: 4px;
}
.cv3-selection-menu.is-group button {
  height: 35px;
}
.cv3-selection-menu button span {
  overflow: hidden;
  text-overflow: ellipsis;
}
.cv3-selection-spinner {
  animation: cv3-selection-spin 1s linear infinite;
}
@keyframes cv3-selection-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .cv3-selection-spinner {
    animation: none;
  }
}
@media (prefers-contrast: more) {
  .cv3-selection-toolbar,
  .cv3-selection-menu {
    border-color: #aaa;
    background: #202020;
    color: #fff;
  }
}
</style>
