<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  left: { type: Number, required: true },
  top: { type: Number, default: 56 },
  busy: Boolean,
})
const emit = defineEmits(['action'])
const toolbar = ref(null)
const snapshotTrigger = ref(null)
const snapshotMenu = ref(null)
const menuOpen = ref(false)
const width = ref(908)
const viewportWidth = ref(typeof window === 'undefined' ? 1135 : window.innerWidth)
const menuLeft = ref(0)
const menuBelow = ref(false)
const menuPlacement = computed(() => ({
  left: `${menuLeft.value}px`,
  top: menuBelow.value ? 'calc(100% + 6px)' : undefined,
  bottom: menuBelow.value ? undefined : 'calc(100% + 6px)',
}))
let resizeObserver
const actions = [
  { key: 'enhance', label: '高清', icon: 'hd' },
  { key: 'reshoot', label: '片段重拍', icon: 'reshoot', caret: true },
  { key: 'frames', label: '逐帧拉片', icon: 'frames', caret: true, dot: true },
  { key: 'remove-subtitles', label: '智能去字幕', icon: 'subtitles', caret: true },
  { key: 'separate', label: '音视频分离', icon: 'separate', caret: true },
  { key: 'replace', label: '元素替换', icon: 'replace', caret: true, dot: true },
  { key: 'intro', label: '创意片头', icon: 'intro' },
]
const icons = {
  hd: 'M3 4h14v12H3z M6 7v6m4-6v6M6 10h4m3-3h1a3 3 0 0 1 0 6h-1z',
  reshoot: 'M3 4h14v12H3z M8 7l5 3-5 3z',
  frames:
    'M10 2v3m0 10v3M2 10h3m10 0h3M4.3 4.3l2 2m7.4 7.4 2 2M4.3 15.7l2-2m7.4-7.4 2-2 M10 6a4 4 0 1 1 0 8 4 4 0 0 1 0-8',
  subtitles: 'M3 4h14v12H3z M5.5 12h3m3 0h3M2 2l16 16',
  separate: 'M3 6h5v8H3z M12 3v14m3-10v6m3-4v2 M5 9l2 1-2 1z',
  replace: 'M4 3h8l4 4v10H4z M12 3v4h4M7 10h5m-2-2 2 2-2 2m2 2H7m2-2-2 2 2 2',
  intro: 'M3 5h14v12H3zM3 5l3-3m2 3 3-3m2 3 3-3M8 8l5 3-5 3z',
}
const placement = computed(() => {
  const available = Math.max(0, viewportWidth.value - 16)
  const actualWidth = Math.min(width.value, available)
  const minimum = actualWidth / 2 + 8
  const maximum = viewportWidth.value - actualWidth / 2 - 8
  return {
    left: `${Math.max(minimum, Math.min(maximum, Number(props.left) || minimum))}px`,
    top: `${Math.max(8, Number(props.top) || 0)}px`,
  }
})
function choose(key, payload) {
  if (props.busy) return
  const restoreSnapshotFocus = menuOpen.value
  menuOpen.value = false
  if (restoreSnapshotFocus) snapshotTrigger.value?.focus({ preventScroll: true })
  emit('action', key, payload)
}
function updatePlacement() {
  viewportWidth.value = globalThis.window?.innerWidth || 1135
  const rect = toolbar.value?.getBoundingClientRect?.()
  if (rect?.width) width.value = rect.width
  const trigger = snapshotTrigger.value?.getBoundingClientRect?.()
  if (rect && trigger) {
    menuLeft.value = Math.max(0, Math.min(rect.width - 168, trigger.left - rect.left))
    menuBelow.value = rect.top < 118
  }
}
function closeMenu(restoreFocus = false) {
  menuOpen.value = false
  if (restoreFocus) snapshotTrigger.value?.focus({ preventScroll: true })
}
async function openMenu(event) {
  if (props.busy) return
  menuOpen.value = !menuOpen.value
  updatePlacement()
  if (menuOpen.value && event?.type === 'keydown') {
    await nextTick()
    snapshotMenu.value?.querySelector('[role="menuitem"]')?.focus()
  }
}
function menuKey(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeMenu(true)
  } else if (event.key === 'Tab') closeMenu()
  else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    const items = [...(snapshotMenu.value?.querySelectorAll('[role="menuitem"]') || [])]
    if (!items.length) return
    const index = items.indexOf(globalThis.document?.activeElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
    items[next]?.focus()
  }
}
function outside(event) {
  if (!toolbar.value?.contains(event.target)) closeMenu()
}
function escape(event) {
  if (event.key === 'Escape' && menuOpen.value) menuKey(event)
}
onMounted(() => {
  updatePlacement()
  globalThis.document?.addEventListener('pointerdown', outside, true)
  globalThis.document?.addEventListener('keydown', escape, true)
  globalThis.window?.addEventListener('resize', updatePlacement)
  if (globalThis.ResizeObserver) {
    resizeObserver = new ResizeObserver(updatePlacement)
    resizeObserver.observe(toolbar.value)
  }
})
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  globalThis.document?.removeEventListener('pointerdown', outside, true)
  globalThis.document?.removeEventListener('keydown', escape, true)
  globalThis.window?.removeEventListener('resize', updatePlacement)
})
</script>

<template>
  <div
    ref="toolbar"
    class="cv3-video-toolbar nodrag nopan"
    :style="placement"
    role="toolbar"
    aria-label="视频编辑工具栏"
    @pointerdown.stop
    @click.stop
  >
    <div class="cv3-video-toolbar-scroll">
      <button
        v-for="action in actions"
        :key="action.key"
        type="button"
        :aria-label="action.label"
        :disabled="busy"
        @click="choose(action.key)"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true"><path :d="icons[action.icon]" /></svg>
        <span>{{ action.label }}</span>
        <svg
          v-if="action.caret"
          class="cv3-video-toolbar-caret"
          viewBox="0 0 12 12"
          aria-hidden="true"
        >
          <path d="m3 4.5 3 3 3-3" />
        </svg>
        <i v-if="action.dot" class="cv3-video-toolbar-dot" aria-hidden="true" />
      </button>
      <span class="cv3-video-toolbar-divider" aria-hidden="true" />
      <div class="cv3-video-toolbar-snapshot">
        <button
          type="button"
          aria-label="截取当前帧"
          title="截取当前帧"
          :disabled="busy"
          @click="choose('snapshot', { position: 'current' })"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path
              d="M2.5 6V4.5a2 2 0 0 1 2-2H6m8 0h1.5a2 2 0 0 1 2 2V6m0 8v1.5a2 2 0 0 1-2 2H14m-8 0H4.5a2 2 0 0 1-2-2V14M6 7h2l1-1.5h2L12 7h2v7H6z"
            />
            <circle cx="10" cy="10.5" r="2" />
          </svg>
        </button>
        <button
          ref="snapshotTrigger"
          class="cv3-video-toolbar-menu-trigger"
          type="button"
          aria-label="截帧选项"
          aria-haspopup="menu"
          :aria-expanded="menuOpen"
          :disabled="busy"
          @click="openMenu"
          @keydown.down.prevent="openMenu"
        >
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg>
        </button>
      </div>
      <button
        type="button"
        aria-label="下载视频"
        title="下载视频"
        :disabled="busy"
        @click="choose('download')"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M10 2v11m-4-4 4 4 4-4M3 12v5h14v-5" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="放大预览"
        title="放大预览"
        :disabled="busy"
        @click="choose('expand')"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M12 3h5v5m0-5-6 6M8 17H3v-5m0 5 6-6" />
        </svg>
      </button>
    </div>
    <div
      v-if="menuOpen"
      ref="snapshotMenu"
      class="cv3-video-toolbar-menu"
      :style="menuPlacement"
      role="menu"
      aria-label="视频截帧"
      @keydown="menuKey"
    >
      <button
        v-for="[position, label] in [
          ['current', '截取当前帧'],
          ['first', '截取首帧'],
          ['last', '截取尾帧'],
        ]"
        :key="position"
        type="button"
        role="menuitem"
        @click="choose('snapshot', { position })"
      >
        {{ label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.cv3-video-toolbar {
  position: absolute;
  z-index: 43;
  width: max-content;
  max-width: calc(100vw - 16px);
  height: 42px;
  box-sizing: border-box;
  padding: 5px 8px;
  border: 1px solid #383838;
  border-radius: 12px;
  background: #252525;
  color: #e1e1e1;
  box-shadow: 0 4px 12px #0003;
  transform: translateX(-50%);
}
.cv3-video-toolbar-scroll {
  display: flex;
  align-items: center;
  height: 100%;
  overflow-x: auto;
  scrollbar-width: thin;
}
.cv3-video-toolbar button {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 30px;
  box-sizing: border-box;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  color: inherit;
  background: transparent;
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.2;
  white-space: nowrap;
  cursor: pointer;
}
.cv3-video-toolbar button:hover,
.cv3-video-toolbar button:active {
  background: #ffffff12;
  color: #fff;
}
.cv3-video-toolbar button:focus-visible {
  outline: 2px solid #87d3e0;
  outline-offset: -2px;
}
.cv3-video-toolbar button:disabled {
  opacity: 0.4;
  cursor: default;
}
.cv3-video-toolbar svg {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.cv3-video-toolbar svg.cv3-video-toolbar-caret {
  width: 10px;
  height: 10px;
  color: #929292;
}
.cv3-video-toolbar-dot {
  position: absolute;
  top: 0;
  right: 0;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #38d2f1;
}
.cv3-video-toolbar-divider {
  flex: 0 0 auto;
  width: 1px;
  height: 20px;
  margin: 0 5px;
  background: #3d3d3d;
}
.cv3-video-toolbar-snapshot {
  display: flex;
  flex: 0 0 auto;
}
.cv3-video-toolbar button.cv3-video-toolbar-menu-trigger {
  width: 16px;
  padding: 0;
}
.cv3-video-toolbar-menu {
  position: absolute;
  z-index: 1;
  width: 168px;
  box-sizing: border-box;
  padding: 6px;
  border: 1px solid #3a3a3a;
  border-radius: 10px;
  background: #272727;
  box-shadow: 0 6px 18px #0004;
}
.cv3-video-toolbar-menu button {
  display: flex;
  justify-content: flex-start;
  width: 100%;
  height: 32px;
  font-size: 13px;
}
@media (prefers-contrast: more) {
  .cv3-video-toolbar,
  .cv3-video-toolbar-menu {
    border-color: #b5b5b5;
    background: #202020;
    color: #fff;
  }
}
</style>
