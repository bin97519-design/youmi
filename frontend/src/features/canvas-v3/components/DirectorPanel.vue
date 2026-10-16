<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import AgentOrb from './AgentOrb.vue'
import CanvasIcon from './CanvasIcon.vue'

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
const prompt = ref('')
const sentMessages = ref([])
const rect = reactive({ ...DEFAULT_RECT })
const drag = reactive({ active: false, kind: '', direction: '', cursor: '', start: null })

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
  { icon: 'workflow', label: '感知画布开始创作' },
  { icon: 'storyboard', label: '从爆款预设开始剧本原创' },
  { icon: 'smartEdit', label: '上传故事来改编' },
  { icon: 'text', label: '批量优化提示词' },
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

function submitPrompt() {
  const content = prompt.value.trim()
  if (!content) return
  sentMessages.value.push(content)
  prompt.value = ''
}

function handleViewportResize() {
  if (!props.docked) applyRect(rect)
}

onMounted(async () => {
  restoreRect()
  window.addEventListener('resize', handleViewportResize)
  await nextTick()
  closeButton.value?.focus({ preventScroll: true })
})

onBeforeUnmount(() => {
  endInteraction()
  window.removeEventListener('resize', handleViewportResize)
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
    @pointerdown.stop
    @wheel.stop
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
        <div v-if="!sentMessages.length" class="cv3-director-welcome">
          <AgentOrb decorative :size="40" />
          <h3>让 TV Director 辅助你的无限创意</h3>
          <div class="cv3-director-shortcuts">
            <button v-for="shortcut in shortcuts" :key="shortcut.label" type="button">
              <CanvasIcon :name="shortcut.icon" :size="16" />
              <span>{{ shortcut.label }}</span>
              <span class="cv3-director-arrow" aria-hidden="true">→</span>
            </button>
          </div>
        </div>
        <div v-else class="cv3-director-chat">
          <p v-for="(message, index) in sentMessages" :key="index">{{ message }}</p>
        </div>
      </div>

      <div class="cv3-director-composer">
        <form @submit.prevent="submitPrompt">
          <textarea
            v-model="prompt"
            rows="2"
            aria-label="发送给 TV Director"
            placeholder="开始你的创作，或者 @ 引用工作流/节点/资源"
            @keydown.enter.exact.prevent="submitPrompt"
          />
          <div class="cv3-director-composer-controls">
            <button type="button" title="添加附件" aria-label="添加附件">
              <CanvasIcon name="plus" :size="18" />
            </button>
            <button type="button" class="cv3-director-mode">
              <span>全能创作</span>
              <CanvasIcon name="chevron" :size="12" />
            </button>
            <button type="button" title="选择模型" aria-label="选择模型">
              <CanvasIcon name="sceneSheet" :size="17" />
            </button>
            <button type="button" title="Skill" aria-label="Skill">
              <CanvasIcon name="script" :size="17" />
            </button>
            <button type="button" title="手动生成" aria-label="手动生成">
              <CanvasIcon name="move" :size="17" />
            </button>
            <span class="cv3-director-spacer" />
            <button
              class="cv3-director-send"
              type="submit"
              aria-label="发送"
              :disabled="!prompt.trim()"
            >
              <CanvasIcon name="arrowUp" :size="20" />
            </button>
          </div>
        </form>
      </div>
    </div>
  </section>

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
  overflow: hidden;
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
  height: 138px;
  flex: 0 0 138px;
  padding: 4px 8px 12px;
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

.cv3-director-composer textarea::placeholder {
  color: rgba(255, 255, 255, 0.35);
}

.cv3-director-composer-controls {
  display: flex;
  height: 32px;
  align-items: center;
  gap: 3px;
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
  .cv3-director-chat {
    animation: none;
  }

  .cv3-director-composer form,
  .cv3-director-header button,
  .cv3-director-shortcuts button {
    transition: none;
  }
}
</style>
