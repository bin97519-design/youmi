<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { selectionMenuPlacement, selectionToolbarPlacement } from '../config/selectionGeometry.js'

const props = defineProps({
  bounds: { type: Object, required: true },
  viewport: { type: Object, required: true },
  group: { type: Object, default: null },
  colors: { type: Array, default: null },
  layouts: { type: Array, default: null },
  mutable: Boolean,
  canExecute: Boolean,
  canDownload: Boolean,
  executing: Boolean,
  downloading: Boolean,
})
const emit = defineEmits([
  'color',
  'arrange',
  'execute',
  'toolbox',
  'convert',
  'ungroup',
  'download',
])
const root = ref(null)
const colorTrigger = ref(null)
const layoutTrigger = ref(null)
const menuPanel = ref(null)
const menu = ref('')
const menuPosition = ref(null)
const id = `cv3-group-${useId()}`
const placement = computed(() =>
  selectionToolbarPlacement(
    props.bounds && { ...props.bounds, top: props.bounds.top - 18 },
    { width: 556, height: 50 },
    props.viewport,
  ),
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
const color = computed(() =>
  /^#[\da-f]{6}$/i.test(props.group?.color || '') ? props.group.color : '#b8b8b8',
)
const convertLabel = computed(() => (props.group?.type === 'storyboard' ? '转普通组' : '转分镜组'))
const defaultLayouts = [
  { key: 'grid', label: '宫格排列', path: 'M3 3h6v6H3zM12 3h6v6h-6zM3 12h6v6H3zM12 12h6v6h-6z' },
  { key: 'horizontal', label: '水平排列', path: 'M2.5 5h4v10h-4zM8 5h4v10H8zM13.5 5h4v10h-4z' },
  { key: 'vertical', label: '垂直排列', path: 'M5 2.5h10v4H5zM5 8h10v4H5zM5 13.5h10v4H5z' },
]
const defaultColors = [
  { label: '灰色', value: '#b8b8b8' },
  { label: '红色', value: '#f08a8a' },
  { label: '橙色', value: '#eeb77b' },
  { label: '黄色', value: '#e9d681' },
  { label: '绿色', value: '#8fc5a0' },
  { label: '蓝色', value: '#8aade8' },
  { label: '紫色', value: '#b899d5' },
]
const colorOptions = computed(() => {
  const seen = new Set()
  return (props.colors || defaultColors)
    .filter((entry) => {
      const value = typeof entry?.value === 'string' ? entry.value.toLowerCase() : ''
      if (!/^#[\da-f]{6}$/.test(value) || seen.has(value)) return false
      seen.add(value)
      return true
    })
    .slice(0, 24)
    .map((entry) => ({
      value: entry.value.toLowerCase(),
      label: String(entry.label || entry.value).slice(0, 32),
    }))
})
const layoutOptions = computed(() => {
  const seen = new Set()
  return (props.layouts || defaultLayouts)
    .filter((entry) => {
      if (!defaultLayouts.some((layout) => layout.key === entry?.key) || seen.has(entry.key))
        return false
      seen.add(entry.key)
      return true
    })
    .map((entry) => ({
      ...defaultLayouts.find((layout) => layout.key === entry.key),
      label: String(
        entry.label || defaultLayouts.find((layout) => layout.key === entry.key).label,
      ).slice(0, 32),
    }))
})
const icon = {
  execute:
    'M4.38 5.05a3.13 3.13 0 0 1 4.84-2.61l7.53 4.95a3.13 3.13 0 0 1 .17 5.1l-.17.12-7.53 4.95a3.13 3.13 0 0 1-4.85-2.61zm1.25 9.9c0 1.5 1.65 2.39 2.9 1.57l7.53-4.95a1.88 1.88 0 0 0 0-3.14L8.53 3.48a1.87 1.87 0 0 0-2.9 1.57z',
  toolbox:
    'M5 8.77a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5m10 5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5m0-10a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5m0-1.25a2.5 2.5 0 0 0-2.42 1.87h-.08a3.1 3.1 0 0 0-3.12 3.13c0 1.03-.84 1.87-1.88 1.87h-.08a2.5 2.5 0 1 0 0 1.25h.08c1.04 0 1.88.84 1.88 1.88 0 1.72 1.4 3.12 3.12 3.12h.08a2.5 2.5 0 1 0 0-1.25h-.08a1.87 1.87 0 0 1-1.87-1.87c0-1.03-.5-1.93-1.25-2.5a3.1 3.1 0 0 0 1.24-2.5c0-1.04.84-1.88 1.88-1.88h.08A2.5 2.5 0 1 0 15 2.52',
  convert:
    'M.63 10c.34 0 .62.28.62.63v1.24c0 1.04.84 1.88 1.88 1.88h1.25a.62.62 0 1 1 0 1.25H3.13A3.1 3.1 0 0 1 0 11.88v-1.26c0-.34.28-.62.63-.62m13.75 0c.34 0 .62.28.62.63v1.24C15 13.6 13.6 15 11.88 15h-1.26a.62.62 0 1 1 0-1.25h1.26c1.03 0 1.87-.84 1.87-1.87v-1.26c0-.34.28-.62.63-.62M7.95 3.33c.55 0 1.07.22 1.45.6l.07.07q.16.16.4.17c.99 0 1.8.8 1.8 1.8v2.57a2.3 2.3 0 0 1-2.3 2.3H5.64a2.3 2.3 0 0 1-2.3-2.3V5.97c0-1 .81-1.8 1.8-1.8q.24 0 .4-.17l.07-.07c.38-.38.9-.6 1.45-.6zm-.9 1.25a.8.8 0 0 0-.57.24l-.07.07c-.34.34-.8.53-1.27.53-.3 0-.56.24-.56.55v2.57c0 .58.47 1.04 1.05 1.04h3.75c.57 0 1.04-.46 1.04-1.04V5.97c0-.3-.25-.55-.56-.55a1.8 1.8 0 0 1-1.27-.53l-.07-.07a.8.8 0 0 0-.57-.24zm.45 1.54a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5M4.38 0a.62.62 0 1 1 0 1.25H3.13c-1.04 0-1.88.84-1.88 1.88v1.25a.62.62 0 1 1-1.25 0V3.13C0 1.4 1.4 0 3.13 0zm7.5 0C13.6 0 15 1.4 15 3.13v1.25a.62.62 0 1 1-1.25 0V3.13c0-1.04-.84-1.88-1.87-1.88h-1.26a.62.62 0 1 1 0-1.25z',
  ungroup:
    'M17.47 1.64a.62.62 0 1 1 .89.89L2.53 18.36a.63.63 0 0 1-.89-.89zM11.46 16.25a.62.62 0 1 1 0 1.25H8.54a.62.62 0 1 1 0-1.25zm4.79-1.04a.63.63 0 0 1 1.25 0 2.3 2.3 0 0 1-2.3 2.29.63.63 0 0 1 0-1.25c.58 0 1.05-.47 1.05-1.04M2.5 11.46V8.54a.62.62 0 1 1 1.25 0v2.92a.62.62 0 1 1-1.25 0m13.75 0V8.54a.62.62 0 1 1 1.25 0v2.92a.62.62 0 1 1-1.25 0M2.5 4.79v-.04c0-1.24 1-2.25 2.25-2.25a.63.63 0 0 1 0 1.25 1 1 0 0 0-1 1v.04a.63.63 0 0 1-1.25 0m8.96-2.29a.62.62 0 1 1 0 1.25H8.54a.62.62 0 1 1 0-1.25z',
  download:
    'M2.5 14.38v-2.09a.62.62 0 1 1 1.25 0v2.09c0 1.03.84 1.87 1.88 1.87h8.75c1.03 0 1.87-.84 1.87-1.87v-2.09a.62.62 0 1 1 1.25 0v2.09c0 1.72-1.4 3.12-3.12 3.12H5.62a3.1 3.1 0 0 1-3.12-3.12M9.38 3.13a.62.62 0 1 1 1.24 0v7.86l1.85-1.85a.62.62 0 1 1 .89.89l-2.92 2.91a.6.6 0 0 1-.88 0l-2.92-2.91a.62.62 0 1 1 .89-.89L9.37 11z',
}

function triggerFor(kind) {
  return kind === 'color' ? colorTrigger.value : layoutTrigger.value
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
  const width = trigger?.width || 40
  return selectionMenuPlacement(
    { left, right: left + width, top: toolbar.top, bottom: toolbar.top + toolbar.height },
    kind === 'color'
      ? { width: 224, height: 16 + Math.ceil(colorOptions.value.length / 7) * 36 }
      : { width: 120, height: layoutOptions.value.length * 40 + 12 },
    props.viewport,
    'above',
  )
}
async function toggleMenu(kind, event) {
  if (!props.mutable || props.executing || !props.group?.id) return
  if (kind === 'color' ? !colorOptions.value.length : !layoutOptions.value.length) return
  if (menu.value === kind && event?.type !== 'keydown') return closeMenu(true)
  menu.value = kind
  menuPosition.value = positionedMenu(kind)
  await nextTick()
  const entries = menuItems()
  entries[event?.key === 'ArrowUp' ? entries.length - 1 : 0]?.focus({ preventScroll: true })
}
function triggerKey(kind, event) {
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
  event.preventDefault()
  event.stopPropagation()
  return toggleMenu(kind, event)
}
function permitted(action) {
  if (!props.group?.id) return false
  if (action === 'download') return props.canDownload && !props.downloading
  if (action === 'execute') return props.mutable && props.canExecute && !props.executing
  return props.mutable && !props.executing
}
function choose(action, payload) {
  if (!permitted(action)) return
  if (action === 'color' && !colorOptions.value.some((entry) => entry.value === payload)) return
  if (action === 'arrange' && !layoutOptions.value.some((entry) => entry.key === payload)) return
  closeMenu(Boolean(menu.value))
  if (payload === undefined) emit(action)
  else emit(action, payload)
}
function menuItems() {
  return [...(menuPanel.value?.querySelectorAll('[role^="menuitem"]:not(:disabled)') || [])]
}
function menuKey(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeMenu(true)
  } else if (event.key === 'Tab') closeMenu(true)
  else if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    event.stopPropagation()
    const entries = menuItems()
    if (!entries.length) return
    const current = entries.indexOf(globalThis.document?.activeElement)
    const backwards = ['ArrowUp', 'ArrowLeft'].includes(event.key)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? entries.length - 1
          : current < 0
            ? backwards
              ? entries.length - 1
              : 0
            : (current + (backwards ? -1 : 1) + entries.length) % entries.length
    entries[next]?.focus({ preventScroll: true })
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
    props.mutable,
    props.executing,
    props.group?.id,
    props.group?.type,
    colorOptions.value.map((entry) => `${entry.value}:${entry.label}`).join('|'),
    layoutOptions.value.map((entry) => `${entry.key}:${entry.label}`).join('|'),
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
    v-if="group?.id && placement"
    ref="root"
    class="cv3-group-toolbar nodrag nopan nowheel"
    :style="toolbarStyle"
    role="toolbar"
    aria-label="分组操作工具栏"
    :aria-description="group.name"
    data-cv3-selection-ui
    @pointerdown.stop
    @click.stop
    @dblclick.stop
    @wheel.stop
    @focusout="focusOut"
  >
    <div class="cv3-group-toolbar-scroll" @scroll="closeMenu()">
      <button
        ref="colorTrigger"
        class="cv3-group-color-trigger"
        type="button"
        aria-label="分组颜色"
        title="分组颜色"
        aria-haspopup="menu"
        :aria-expanded="menu === 'color'"
        :aria-controls="`${id}-color`"
        :disabled="!mutable || executing || !colorOptions.length"
        @click="toggleMenu('color', $event)"
        @keydown="triggerKey('color', $event)"
      >
        <span class="cv3-group-swatch" :style="{ background: color }" />
      </button>
      <button
        ref="layoutTrigger"
        class="cv3-group-layout-trigger"
        type="button"
        aria-label="分组布局"
        title="分组布局"
        aria-haspopup="menu"
        :aria-expanded="menu === 'layout'"
        :aria-controls="`${id}-layout`"
        :disabled="!mutable || executing || !layoutOptions.length"
        @click="toggleMenu('layout', $event)"
        @keydown="triggerKey('layout', $event)"
      >
        <svg class="cv3-group-grid-icon" viewBox="0 0 20 20" aria-hidden="true">
          <g v-for="row in 3" :key="row" :opacity="row === 2 ? 0.9 : 0.3">
            <rect
              v-for="column in 3"
              :key="column"
              :x="2.25 + (column - 1) * 5.67"
              :y="2.25 + (row - 1) * 5.67"
              width="4.17"
              height="4.17"
              rx="1.25"
            />
          </g>
        </svg>
        <svg class="cv3-group-chevron" viewBox="0 0 12 12" aria-hidden="true">
          <path d="m3 4.5 3 3 3-3" />
        </svg>
      </button>
      <span class="cv3-group-divider" aria-hidden="true" />
      <button
        type="button"
        :disabled="!mutable || !canExecute || executing"
        :aria-busy="executing"
        @click="choose('execute')"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true"><path :d="icon.execute" /></svg>
        <span>{{ executing ? '执行中' : '整组执行' }}</span>
      </button>
      <button type="button" :disabled="!mutable || executing" @click="choose('toolbox')">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path :d="icon.toolbox" /></svg>
        <span>添加到工具箱</span>
      </button>
      <button
        type="button"
        :disabled="!mutable || executing"
        @click="choose('convert', group.type === 'storyboard' ? 'normal' : 'storyboard')"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path :d="icon.convert" transform="translate(.5 .5)" />
        </svg>
        <span>{{ convertLabel }}</span>
      </button>
      <button type="button" :disabled="!mutable || executing" @click="choose('ungroup')">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path :d="icon.ungroup" /></svg>
        <span>解组</span>
      </button>
      <span class="cv3-group-divider" aria-hidden="true" />
      <button
        class="cv3-group-download"
        type="button"
        aria-label="批量下载"
        :title="downloading ? '正在打包下载' : '批量下载'"
        :aria-busy="downloading"
        :disabled="!canDownload || downloading"
        @click="choose('download')"
      >
        <svg v-if="!downloading" viewBox="0 0 20 20" aria-hidden="true">
          <path :d="icon.download" />
        </svg>
        <svg
          v-else
          class="cv3-group-spinner cv3-group-stroke-icon"
          viewBox="0 0 20 20"
          aria-hidden="true"
        >
          <path d="M10 2a8 8 0 1 1-8 8" />
        </svg>
      </button>
    </div>
    <div
      v-if="menu && menuPosition"
      :id="`${id}-${menu}`"
      ref="menuPanel"
      class="cv3-group-menu"
      :class="`is-${menu}`"
      :style="menuStyle"
      role="menu"
      :aria-label="menu === 'color' ? '分组颜色' : '分组布局'"
      data-cv3-selection-ui
      @keydown="menuKey"
    >
      <template v-if="menu === 'color'">
        <button
          v-for="swatch in colorOptions"
          :key="swatch.value"
          class="cv3-group-color-option"
          type="button"
          role="menuitemradio"
          :aria-label="swatch.label"
          :aria-checked="color.toLowerCase() === swatch.value"
          :title="swatch.label"
          :disabled="!mutable || executing"
          @click="choose('color', swatch.value)"
        >
          <span class="cv3-group-swatch" :style="{ background: swatch.value }">
            <svg
              v-if="color.toLowerCase() === swatch.value"
              class="cv3-group-stroke-icon"
              viewBox="0 0 20 20"
              aria-hidden="true"
            >
              <path d="m5 10 3 3 7-7" />
            </svg>
          </span>
        </button>
      </template>
      <template v-else>
        <button
          v-for="layout in layoutOptions"
          :key="layout.key"
          type="button"
          role="menuitem"
          :disabled="!mutable || executing"
          @click="choose('arrange', layout.key)"
        >
          <svg class="cv3-group-stroke-icon" viewBox="0 0 20 20" aria-hidden="true">
            <path :d="layout.path" />
          </svg>
          <span>{{ layout.label }}</span>
        </button>
      </template>
    </div>
  </nav>
</template>

<style scoped>
.cv3-group-toolbar {
  position: absolute;
  z-index: 44;
  box-sizing: border-box;
  height: 50px;
  padding: 4px;
  border: 0.5px solid #363636;
  border-radius: 14px;
  background: #262626;
  color: #dedede;
  box-shadow: 0 4px 10px #00000014;
  backdrop-filter: blur(16px);
  font-family: inherit;
  font-size: 13px;
  line-height: 20px;
  pointer-events: auto;
}
.cv3-group-toolbar-scroll {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  height: 40px;
  overflow-x: auto;
  scrollbar-width: none;
}
.cv3-group-toolbar-scroll::-webkit-scrollbar {
  display: none;
}
.cv3-group-toolbar button {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  box-sizing: border-box;
  padding: 0 8px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
}
.cv3-group-toolbar button:hover:not(:disabled),
.cv3-group-toolbar button[aria-expanded='true'] {
  background: #ffffff10;
  color: #fff;
}
.cv3-group-toolbar button:focus-visible {
  outline: 2px solid #8dd4e5;
  outline-offset: -2px;
}
.cv3-group-toolbar button:disabled {
  opacity: 0.38;
  cursor: default;
}
.cv3-group-toolbar svg {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  fill: currentColor;
}
.cv3-group-toolbar svg.cv3-group-stroke-icon {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.cv3-group-toolbar svg.cv3-group-chevron {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1;
  opacity: 0.6;
}
.cv3-group-toolbar button.cv3-group-color-trigger {
  width: 40px;
  height: 40px;
  padding: 0;
}
.cv3-group-toolbar button.cv3-group-layout-trigger {
  gap: 4px;
}
.cv3-group-toolbar button.cv3-group-download {
  width: 36px;
  padding: 0;
}
.cv3-group-swatch {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 20px;
  height: 20px;
  border: 0.5px solid #00000026;
  border-radius: 50%;
  color: #181818;
}
.cv3-group-divider {
  flex: 0 0 1px;
  height: 24px;
  margin: 0 2px;
  background: #363636;
}
.cv3-group-menu {
  position: absolute;
  z-index: 1;
  box-sizing: border-box;
  padding: 5px;
  overflow-y: auto;
  border: 1px solid #363636;
  border-radius: 10px;
  background: #262626;
  color: #dedede;
  box-shadow: 0 5px 16px #0005;
}
.cv3-group-menu.is-color {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  padding: 8px;
}
.cv3-group-menu.is-color button {
  width: 28px;
  height: 32px;
  padding: 0;
}
.cv3-group-menu.is-color button[aria-checked='true'] {
  background: #ffffff14;
}
.cv3-group-menu.is-layout button {
  display: flex;
  justify-content: flex-start;
  width: 100%;
  height: 40px;
  gap: 8px;
}
.cv3-group-menu.is-layout button span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cv3-group-spinner {
  animation: cv3-group-spin 1s linear infinite;
}
@keyframes cv3-group-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .cv3-group-spinner {
    animation: none;
  }
}
@media (prefers-contrast: more) {
  .cv3-group-toolbar,
  .cv3-group-menu {
    border-color: #aaa;
    background: #202020;
    color: #fff;
  }
}
</style>
