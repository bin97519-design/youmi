<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CANVAS_SELECTION_LAYOUTS } from '../../utils/canvasSelection'
import { canvasSelectionToolbarPlacement } from '../../utils/canvasSelectionToolbarPlacement'

const props = defineProps({
  count: { type: Number, required: true },
  anchor: { type: Object, required: true },
  viewport: { type: Object, required: true },
  available: { type: Object, required: true },
  obstacles: { type: Array, default: () => [] },
  groupName: { type: String, default: '' },
  mutable: Boolean,
  canAddToChat: Boolean,
  canDownload: Boolean,
  downloading: Boolean,
})
const emit = defineEmits(['arrange', 'group', 'chat', 'download'])
const root = ref(null)
const menuOpen = ref(false)
const measured = ref(false)
const size = ref({ width: 400, height: 48 })
let observer
const placement = computed(() =>
  canvasSelectionToolbarPlacement(
    props.anchor,
    props.viewport,
    props.available,
    size.value,
    props.obstacles,
  ),
)
const style = computed(() => ({
  ...placement.value.style,
  visibility: measured.value ? 'visible' : 'hidden',
}))
const menuStyle = computed(() => placement.value.menuStyle)
function closeOutside(event) {
  if (!root.value?.contains(event.target)) menuOpen.value = false
}
function closeOnEscape(event) {
  if (event.key === 'Escape' && menuOpen.value) {
    event.stopPropagation()
    menuOpen.value = false
    root.value?.querySelector('[aria-haspopup="menu"]')?.focus({ preventScroll: true })
  }
}
function arrange(key) {
  emit('arrange', key)
  menuOpen.value = false
}
function handleMenuKeydown(event) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const items = [...root.value.querySelectorAll('[role="menuitem"]:not(:disabled)')]
  const current = items.indexOf(document.activeElement)
  const index =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
  items[index]?.focus({ preventScroll: true })
}
watch(
  () => props.mutable,
  (value) => {
    if (!value) menuOpen.value = false
  },
)
watch(
  [
    () => props.anchor.x,
    () => props.anchor.y,
    () => props.anchor.bottom,
    () => props.viewport.left,
    () => props.viewport.top,
    () => props.viewport.scale,
  ],
  () => {
    menuOpen.value = false
  },
)
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    size.value = {
      width: entry.borderBoxSize?.[0]?.inlineSize || root.value.offsetWidth,
      height: root.value.offsetHeight,
    }
    measured.value = true
  })
  observer.observe(root.value)
  document.addEventListener('pointerdown', closeOutside)
  document.addEventListener('keydown', closeOnEscape, true)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  document.removeEventListener('pointerdown', closeOutside)
  document.removeEventListener('keydown', closeOnEscape, true)
})
watch(menuOpen, async (value) => {
  if (value) {
    await nextTick()
    root.value?.querySelector('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true })
  }
})
</script>

<template>
  <nav
    ref="root"
    class="canvas-selection-toolbar"
    :style="style"
    aria-label="多选工具栏"
    @pointerdown.stop
    @click.stop
    @dblclick.stop
    @wheel.stop
  >
    <span class="canvas-selection-count" :title="groupName || `已选中 ${count} 项`">
      {{ count }}
    </span>
    <button
      type="button"
      title="排列选中内容"
      aria-haspopup="menu"
      :aria-expanded="menuOpen"
      :disabled="!mutable"
      @click="menuOpen = !menuOpen"
      @keydown.down.prevent="menuOpen = true"
    >
      <i class="ri-layout-grid-fill" aria-hidden="true"></i>
      <i class="ri-arrow-down-s-line" aria-hidden="true"></i>
    </button>
    <button
      type="button"
      :disabled="!mutable"
      :title="groupName ? '取消分组' : '创建分组'"
      @click="emit('group')"
    >
      <i
        :class="groupName ? 'ri-split-cells-horizontal' : 'ri-layout-grid-line'"
        aria-hidden="true"
      ></i>
      <span>{{ groupName ? '解组' : '分组' }}</span>
    </button>
    <button type="button" title="添加到对话" :disabled="!canAddToChat" @click="emit('chat')">
      <i class="ri-chat-new-line" aria-hidden="true"></i>
      <span>添加到对话</span>
    </button>
    <button
      type="button"
      class="canvas-selection-download"
      :disabled="!canDownload || downloading"
      :title="downloading ? '正在打包' : '下载选中内容'"
      aria-label="下载选中内容"
      @click="emit('download')"
    >
      <i
        :class="downloading ? 'ri-loader-4-line is-spinning' : 'ri-download-2-line'"
        aria-hidden="true"
      ></i>
    </button>
    <div
      v-if="menuOpen"
      class="canvas-selection-menu"
      :style="menuStyle"
      role="menu"
      aria-label="排列方式"
      @keydown="handleMenuKeydown"
    >
      <button
        v-for="option in CANVAS_SELECTION_LAYOUTS"
        :key="option.key"
        type="button"
        role="menuitem"
        :class="{ 'starts-section': option.section }"
        :disabled="option.key.startsWith('distribute-') && count < 3"
        @click="arrange(option.key)"
      >
        <i :class="option.icon" aria-hidden="true"></i>
        <span>{{ option.label }}</span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.canvas-selection-toolbar {
  position: absolute;
  transform-origin: top left;
  z-index: 2147482600;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  width: max-content;
  padding: 6px;
  box-sizing: border-box;
  border: 1px solid var(--canvas-border);
  border-radius: 14px;
  background: #262626;
  color: var(--canvas-text);
  box-shadow: var(--canvas-panel-shadow);
  font-size: 12px;
  letter-spacing: 0;
  pointer-events: auto;
}
.canvas-selection-toolbar button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 32px;
  padding: 5px 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
  white-space: nowrap;
  cursor: pointer;
}
.canvas-selection-toolbar button:hover:not(:disabled),
.canvas-selection-toolbar button[aria-expanded='true'] {
  color: var(--canvas-accent);
  background: var(--canvas-accent-soft);
}
.canvas-selection-toolbar button:focus-visible {
  outline: 2px solid var(--canvas-accent);
  outline-offset: -2px;
}
.canvas-selection-toolbar button:disabled {
  opacity: 0.4;
  cursor: default;
}
.canvas-selection-toolbar i {
  font-size: 16px;
}
.canvas-selection-count {
  min-width: 24px;
  padding: 0 6px;
  color: #c0c0c0;
  font-variant-numeric: tabular-nums;
  text-align: center;
  border-right: 1px solid var(--canvas-border);
}
.canvas-selection-toolbar .canvas-selection-download {
  width: 32px;
  padding: 0;
}
.canvas-selection-menu {
  position: absolute;
  display: flex;
  flex-direction: column;
  padding: 5px;
  box-sizing: border-box;
  overflow-y: auto;
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  background: var(--canvas-panel);
  box-shadow: var(--canvas-panel-shadow);
}
.canvas-selection-menu button {
  justify-content: flex-start;
  min-height: 32px;
  flex-shrink: 0;
}
.canvas-selection-menu button.starts-section {
  border-top: 1px solid var(--canvas-border);
  border-radius: 0;
  margin-top: 4px;
  padding-top: 8px;
}
.is-spinning {
  animation: selection-spin 1s linear infinite;
}
@keyframes selection-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 360px) {
  .canvas-selection-toolbar {
    display: grid;
    grid-template-columns: max-content auto minmax(0, 1fr) 32px;
    gap: 3px;
  }
  .canvas-selection-toolbar button {
    padding-inline: 6px;
  }
  .canvas-selection-count {
    grid-column: 1;
    grid-row: 1;
  }
  .canvas-selection-toolbar > button:nth-of-type(1) {
    grid-column: 2;
    grid-row: 1;
  }
  .canvas-selection-toolbar > button:nth-of-type(2) {
    grid-column: 3 / 5;
    grid-row: 1;
  }
  .canvas-selection-toolbar > button:nth-of-type(3) {
    grid-column: 1 / 4;
    grid-row: 2;
    justify-content: flex-start;
  }
  .canvas-selection-toolbar > button:nth-of-type(4) {
    grid-column: 4;
    grid-row: 2;
  }
}
</style>
