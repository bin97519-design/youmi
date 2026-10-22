<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import VideoNodePlayer from './VideoNodePlayer.vue'

const props = defineProps({
  open: { type: Boolean, default: true },
  source: { type: String, required: true },
  title: { type: String, default: '视频预览' },
  poster: { type: String, default: '' },
  currentTime: { type: Number, default: 0 },
  busy: Boolean,
})
const emit = defineEmits(['close', 'snapshot', 'download', 'timeupdate', 'metadata'])
const dialog = ref(null)
const closeButton = ref(null)
const dimensions = ref({ width: 16, height: 9 })
const headingId = `cv3-video-preview-title-${useId()}`
const aspect = computed(() => `${dimensions.value.width} / ${dimensions.value.height}`)
let previousFocus
let opened = false
function restoreFocus() {
  if (previousFocus?.isConnected !== false) previousFocus?.focus?.({ preventScroll: true })
  previousFocus = null
  opened = false
}
function metadata(value) {
  if (value.width > 0 && value.height > 0) dimensions.value = value
  emit('metadata', value)
}
function keydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('close')
    return
  }
  if (event.key !== 'Tab') return
  const items = [
    ...(dialog.value?.querySelectorAll(
      'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
    ) || []),
  ].filter((element) => element.getAttribute?.('aria-hidden') !== 'true')
  if (!items.length) {
    event.preventDefault()
    dialog.value?.focus()
    return
  }
  const active = globalThis.document?.activeElement
  if (event.shiftKey && (active === items[0] || !dialog.value?.contains(active))) {
    event.preventDefault()
    items.at(-1)?.focus()
  } else if (!event.shiftKey && (active === items.at(-1) || !dialog.value?.contains(active))) {
    event.preventDefault()
    items[0]?.focus()
  }
}
watch(
  () => props.open,
  async (open) => {
    if (!open) {
      restoreFocus()
      return
    }
    if (!opened) {
      previousFocus = globalThis.document?.activeElement
      opened = true
    }
    await nextTick()
    if (props.open) closeButton.value?.focus({ preventScroll: true })
  },
  { immediate: true },
)
onBeforeUnmount(restoreFocus)
</script>

<template>
  <div
    v-if="open"
    class="cv3-video-preview-backdrop"
    @click.self="emit('close')"
    @pointerdown.stop
    @keydown="keydown"
  >
    <section
      ref="dialog"
      class="cv3-video-preview-dialog"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="headingId"
      tabindex="-1"
    >
      <header>
        <h2 :id="headingId">{{ title }}</h2>
        <button type="button" aria-label="下载视频" :disabled="busy" @click="emit('download')">
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 2v11m-4-4 4 4 4-4M3 12v5h14v-5" />
          </svg>
        </button>
        <button ref="closeButton" type="button" aria-label="关闭视频预览" @click="emit('close')">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10m0-10L5 15" /></svg>
        </button>
      </header>
      <div class="cv3-video-preview-stage" :style="{ aspectRatio: aspect }">
        <VideoNodePlayer
          :source="source"
          :title="title"
          :poster="poster"
          :selected="true"
          :initial-time="currentTime"
          @metadata="metadata"
          @snapshot="emit('snapshot', $event)"
          @timeupdate="emit('timeupdate', $event)"
        />
      </div>
    </section>
  </div>
</template>

<style scoped>
.cv3-video-preview-backdrop {
  position: fixed;
  z-index: 1100;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 32px;
  background: #050505e8;
}
.cv3-video-preview-dialog {
  display: flex;
  flex-direction: column;
  width: min(1100px, 100%);
  max-height: 100%;
  border: 1px solid #3b3b3b;
  border-radius: 14px;
  background: #1b1b1b;
  color: #ddd;
  outline: none;
  overflow: hidden;
}
.cv3-video-preview-dialog header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  min-height: 48px;
  gap: 4px;
  padding: 0 12px 0 18px;
  box-sizing: border-box;
}
.cv3-video-preview-dialog h2 {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 500;
}
.cv3-video-preview-dialog header button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 7px;
  color: #bbb;
  background: transparent;
  cursor: pointer;
}
.cv3-video-preview-dialog header button:hover,
.cv3-video-preview-dialog header button:active {
  color: #fff;
  background: #ffffff14;
}
.cv3-video-preview-dialog button:disabled {
  opacity: 0.4;
  cursor: default;
}
.cv3-video-preview-dialog header button:focus-visible {
  outline: 2px solid #84d1df;
  outline-offset: 1px;
}
.cv3-video-preview-dialog svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.cv3-video-preview-stage {
  position: relative;
  flex: 0 1 auto;
  width: 100%;
  min-height: 180px;
  max-height: calc(100vh - 114px);
  background: #111;
  overflow: hidden;
}
@media (max-width: 640px) {
  .cv3-video-preview-backdrop {
    padding: 12px;
  }
  .cv3-video-preview-stage {
    max-height: calc(100vh - 74px);
  }
}
@media (prefers-contrast: more) {
  .cv3-video-preview-dialog {
    border-color: #bbb;
    color: #fff;
  }
}
</style>
