<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  source: { type: String, required: true },
  title: { type: String, default: '视频' },
  poster: { type: String, default: '' },
  initialTime: { type: Number, default: 0 },
  selected: Boolean,
})
const emit = defineEmits(['metadata', 'snapshot', 'expand', 'time', 'timeupdate'])
const root = ref(null)
const video = ref(null)
const snapshotTrigger = ref(null)
const hovered = ref(false)
const focused = ref(false)
const playing = ref(false)
const mode = ref('idle')
const hasUserFrame = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const volume = ref(0.5)
const muted = ref(false)
const error = ref('')
const snapshotMenu = ref(false)
const reducedMotion = ref(false)
const inView = ref(false)
const userPlaying = computed(() => playing.value && mode.value === 'user')
const showControls = computed(
  () => props.selected || hovered.value || focused.value || userPlaying.value || snapshotMenu.value,
)
const showPoster = computed(() => props.poster && mode.value !== 'preview' && !hasUserFrame.value)
let previewRestoreTime = 0
let requestVersion = 0
let lastEmittedTime = 0
let initialPositionApplied = false
let disposed = false
let observer
let documentRef
let windowRef
let motionQuery

function timeLabel(value) {
  const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
function syncTime() {
  const time = video.value?.currentTime
  if (Number.isFinite(time) && time >= 0) {
    currentTime.value = time
    if (time !== lastEmittedTime) {
      lastEmittedTime = time
      emit('time', time)
      emit('timeupdate', time)
    }
  }
}
function syncAudio() {
  if (!video.value) return
  video.value.volume = volume.value
  video.value.muted = mode.value === 'preview' || muted.value
}
function pause(restorePreview = true) {
  requestVersion += 1
  const element = video.value
  element?.pause()
  playing.value = false
  if (mode.value === 'preview') {
    mode.value = 'idle'
    if (restorePreview && element && Number.isFinite(previewRestoreTime)) {
      element.currentTime = previewRestoreTime
      currentTime.value = previewRestoreTime
    }
  }
  syncAudio()
}
async function requestPlayback(nextMode) {
  const element = video.value
  if (!element || disposed || error.value) return
  const version = ++requestVersion
  mode.value = nextMode
  syncAudio()
  try {
    await element.play()
    if (disposed || version !== requestVersion) {
      // A late hover promise must not pause a newer, explicitly started playback.
      if (disposed || mode.value !== 'user') element.pause()
      return
    }
    playing.value = true
  } catch (cause) {
    if (disposed || version !== requestVersion) return
    playing.value = false
    if (nextMode === 'preview') {
      mode.value = 'idle'
      element.currentTime = previewRestoreTime
      currentTime.value = previewRestoreTime
      syncAudio()
      return
    }
    error.value =
      cause?.name === 'NotAllowedError'
        ? '浏览器暂未允许播放，请再次点击播放。'
        : '视频暂时无法播放，请检查视频地址或编码格式。'
  }
}
function enter() {
  hovered.value = true
  if (
    props.selected ||
    playing.value ||
    mode.value === 'user' ||
    reducedMotion.value ||
    !inView.value ||
    documentRef?.hidden ||
    error.value
  )
    return
  previewRestoreTime = video.value?.currentTime || 0
  void requestPlayback('preview')
}
function leave() {
  hovered.value = false
  if (mode.value === 'preview') pause()
}
function togglePlayback() {
  if (playing.value) {
    pause(false)
    mode.value = 'user'
    hasUserFrame.value = true
    return
  }
  if (mode.value === 'preview') pause()
  error.value = ''
  hasUserFrame.value = true
  void requestPlayback('user')
}
function metadata(event) {
  const element = event.target
  duration.value = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : 0
  if (duration.value && element.readyState >= 1 && !initialPositionApplied) {
    initialPositionApplied = true
    const time = Number.isFinite(props.initialTime) ? props.initialTime : 0
    const nextTime = Math.min(Math.max(0, duration.value - 0.04), Math.max(0, time))
    if (nextTime > 0) hasUserFrame.value = true
    if (Math.abs(element.currentTime - nextTime) > 0.001) element.currentTime = nextTime
  }
  syncTime()
  syncAudio()
  emit('metadata', {
    width: Number(element.videoWidth) || 0,
    height: Number(element.videoHeight) || 0,
    duration: duration.value,
  })
}
function seek(event) {
  if (!duration.value || !video.value) return
  const value = Number(event.target.value)
  if (!Number.isFinite(value)) return
  if (mode.value === 'preview') pause(false)
  mode.value = 'user'
  hasUserFrame.value = true
  const nextTime = Math.max(0, Math.min(duration.value, value))
  video.value.currentTime = nextTime
  currentTime.value = nextTime
}
function setVolume(event) {
  const value = Number(event.target.value)
  if (!Number.isFinite(value)) return
  volume.value = Math.max(0, Math.min(1, value))
  muted.value = volume.value === 0
  syncAudio()
}
function toggleMute() {
  muted.value = !muted.value
  syncAudio()
}
function closeSnapshotMenu(restoreFocus = false) {
  snapshotMenu.value = false
  if (restoreFocus) snapshotTrigger.value?.focus()
}
function requestSnapshot(position = 'current') {
  if (!video.value || !duration.value || error.value) return
  const time =
    position === 'first'
      ? 0
      : position === 'last'
        ? Math.max(0, duration.value - 0.04)
        : video.value.currentTime
  pause(false)
  closeSnapshotMenu(true)
  emit('snapshot', { time: Number.isFinite(time) ? time : 0, position })
}
function handleKey(event) {
  if (event.target?.tagName === 'INPUT' || event.target?.tagName === 'BUTTON') return
  if (event.key === ' ' || event.key === 'k') {
    event.preventDefault()
    event.stopPropagation()
    togglePlayback()
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault()
    event.stopPropagation()
    seek({ target: { value: currentTime.value + (event.key === 'ArrowLeft' ? -5 : 5) } })
  } else if (event.key === 'm') {
    event.preventDefault()
    event.stopPropagation()
    toggleMute()
  } else if (event.key === 'f') {
    event.preventDefault()
    event.stopPropagation()
    emit('expand')
  } else if (event.key === 'Escape' && snapshotMenu.value) {
    event.preventDefault()
    event.stopPropagation()
    closeSnapshotMenu(true)
  }
}
function mediaError() {
  pause(false)
  error.value = '视频加载失败，请检查视频地址或编码格式。'
}
function visibilityChanged() {
  if (documentRef?.hidden) pause()
}
function windowBlurred() {
  pause()
  closeSnapshotMenu()
}
function focusOut(event) {
  if (root.value?.contains(event.relatedTarget)) return
  focused.value = false
  closeSnapshotMenu()
  pause()
}
function outsidePointer(event) {
  if (!root.value?.contains(event.target)) closeSnapshotMenu()
}
function motionChanged() {
  reducedMotion.value = !!motionQuery?.matches
  if (reducedMotion.value && mode.value === 'preview') pause()
}
watch(
  () => props.source,
  () => {
    pause(false)
    mode.value = 'idle'
    hasUserFrame.value = false
    initialPositionApplied = false
    currentTime.value = 0
    duration.value = 0
    error.value = ''
    snapshotMenu.value = false
  },
)
watch(
  () => props.selected,
  (selected, previous) => {
    if (previous && !selected) {
      pause()
      closeSnapshotMenu()
    } else if (selected && mode.value === 'preview') pause()
  },
)
onMounted(() => {
  documentRef = root.value?.ownerDocument
  windowRef = documentRef?.defaultView
  motionQuery = windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)')
  motionChanged()
  if (motionQuery?.addEventListener) motionQuery.addEventListener('change', motionChanged)
  else motionQuery?.addListener?.(motionChanged)
  documentRef?.addEventListener('visibilitychange', visibilityChanged)
  documentRef?.addEventListener('pointerdown', outsidePointer)
  windowRef?.addEventListener('blur', windowBlurred)
  if (windowRef?.IntersectionObserver) {
    observer = new windowRef.IntersectionObserver((entries) => {
      inView.value = !!entries[0]?.isIntersecting
      if (!inView.value) pause()
    })
    observer.observe(root.value)
  }
  syncAudio()
})
onBeforeUnmount(() => {
  disposed = true
  pause()
  observer?.disconnect()
  documentRef?.removeEventListener('visibilitychange', visibilityChanged)
  documentRef?.removeEventListener('pointerdown', outsidePointer)
  windowRef?.removeEventListener('blur', windowBlurred)
  if (motionQuery?.removeEventListener) motionQuery.removeEventListener('change', motionChanged)
  else motionQuery?.removeListener?.(motionChanged)
})
defineExpose({ getCurrentTime: () => video.value?.currentTime || 0, pause, requestSnapshot })
</script>

<template>
  <div
    ref="root"
    class="cv3-video-node-player"
    :class="{ 'show-controls': showControls }"
    role="group"
    :aria-label="title"
    tabindex="0"
    @pointerenter="enter"
    @pointerleave="leave"
    @focusin="focused = true"
    @focusout="focusOut"
    @keydown="handleKey"
    @dblclick.stop="emit('expand')"
  >
    <video
      ref="video"
      class="cv3-video-node-element"
      :src="source"
      :poster="poster || undefined"
      :aria-label="title"
      preload="metadata"
      playsinline
      @loadedmetadata="metadata"
      @durationchange="metadata"
      @timeupdate="syncTime"
      @play="playing = true"
      @pause="playing = false"
      @ended="playing = false"
      @error="mediaError"
    />
    <img
      v-if="showPoster"
      class="cv3-video-node-poster"
      :src="poster"
      :alt="title"
      draggable="false"
    />
    <div v-if="error" class="cv3-video-node-error" role="status">{{ error }}</div>
    <div
      class="cv3-video-node-controls nodrag nopan nowheel"
      @pointerdown.stop
      @click.stop
      @dblclick.stop
      @keydown.stop
      @keydown.esc.stop="closeSnapshotMenu(true)"
    >
      <button
        type="button"
        :aria-label="playing ? '暂停视频' : '播放视频'"
        :title="playing ? '暂停' : '播放'"
        @click="togglePlayback"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path v-if="playing" d="M4.5 3.5v9M11.5 3.5v9" stroke="currentColor" stroke-width="2.8" />
          <path v-else d="m5 3 8 5-8 5Z" fill="currentColor" />
        </svg>
      </button>
      <span class="cv3-video-node-time">{{ timeLabel(currentTime) }}</span>
      <input
        class="cv3-video-node-progress"
        type="range"
        min="0"
        :max="duration || 1"
        step="0.01"
        :value="currentTime"
        :disabled="!duration"
        aria-label="视频播放进度"
        :aria-valuetext="`${timeLabel(currentTime)} / ${timeLabel(duration)}`"
        :style="{ '--cv3-video-progress': `${duration ? (currentTime / duration) * 100 : 0}%` }"
        @input="seek"
      />
      <span class="cv3-video-node-time">{{ timeLabel(duration) }}</span>
      <div class="cv3-video-node-volume">
        <button
          type="button"
          :aria-label="muted || volume === 0 ? '取消静音' : '静音'"
          :aria-pressed="muted"
          @click="toggleMute"
        >
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2.5 6h3L9 3v10l-3.5-3h-3Z" fill="currentColor" />
            <path
              v-if="muted || volume === 0"
              d="m11 6 3 4m0-4-3 4"
              stroke="currentColor"
              stroke-width="1.4"
            />
            <path
              v-else
              d="M11 5.5a4 4 0 0 1 0 5m2-7a7 7 0 0 1 0 9"
              stroke="currentColor"
              stroke-width="1.2"
            />
          </svg>
        </button>
        <div class="cv3-video-node-volume-popup">
          <span>{{ muted ? 0 : Math.round(volume * 100) }}</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            :value="volume"
            aria-label="视频音量"
            @input="setVolume"
          />
        </div>
      </div>
      <div class="cv3-video-node-snapshot">
        <button
          ref="snapshotTrigger"
          class="cv3-video-node-snapshot-button"
          type="button"
          aria-label="截取当前帧"
          title="截取当前帧"
          :disabled="!duration || !!error"
          @click="requestSnapshot('current')"
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            stroke-width="1.45"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path
              d="M2.4 6V4.4a2 2 0 0 1 2-2H6m8 0h1.6a2 2 0 0 1 2 2V6m0 8v1.6a2 2 0 0 1-2 2H14m-8 0H4.4a2 2 0 0 1-2-2V14"
            />
            <path
              d="M6.2 6.7h1.4l.8-1.3h3.2l.8 1.3h1.4c.8 0 1.4.6 1.4 1.4v4.6c0 .8-.6 1.4-1.4 1.4H6.2c-.8 0-1.4-.6-1.4-1.4V8.1c0-.8.6-1.4 1.4-1.4Z"
            />
            <circle cx="10" cy="10.2" r="2.1" />
          </svg>
        </button>
        <button
          class="cv3-video-node-snapshot-options"
          type="button"
          aria-label="截帧选项"
          title="截帧选项"
          aria-haspopup="menu"
          :aria-expanded="snapshotMenu"
          :disabled="!duration || !!error"
          @click="snapshotMenu = !snapshotMenu"
        >
          <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="m3 4.5 3 3 3-3"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <div
          v-if="snapshotMenu"
          class="cv3-video-node-snapshot-menu"
          role="menu"
          aria-label="视频截帧"
        >
          <button type="button" role="menuitem" @click="requestSnapshot('current')">
            截取当前帧
          </button>
          <button type="button" role="menuitem" @click="requestSnapshot('first')">截取首帧</button>
          <button type="button" role="menuitem" @click="requestSnapshot('last')">截取尾帧</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cv3-video-node-player {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  outline: none;
  background: #202020;
}
.cv3-video-node-element,
.cv3-video-node-poster {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  object-fit: contain;
  pointer-events: none;
}
.cv3-video-node-poster {
  position: absolute;
  inset: 0;
}
.cv3-video-node-controls {
  position: absolute;
  z-index: 2;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 6px 10px 4px;
  box-sizing: border-box;
  border-bottom-right-radius: inherit;
  border-bottom-left-radius: inherit;
  color: #fff;
  background: linear-gradient(transparent, #0009);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 120ms ease;
}
.show-controls .cv3-video-node-controls {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}
.cv3-video-node-controls button {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  color: inherit;
  background: transparent;
  cursor: pointer;
}
.cv3-video-node-controls button:hover,
.cv3-video-node-controls button:active {
  background: #ffffff20;
}
.cv3-video-node-controls button:disabled {
  opacity: 0.4;
  cursor: default;
}
.cv3-video-node-controls button:focus-visible,
.cv3-video-node-controls input:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}
.cv3-video-node-controls svg {
  width: 16px;
  height: 16px;
}
.cv3-video-node-time {
  flex: 0 0 auto;
  color: #fff;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.cv3-video-node-progress {
  flex: 1 1 auto;
  min-width: 20px;
  height: 16px;
  margin: 0;
  appearance: none;
  background: transparent;
  cursor: pointer;
}
.cv3-video-node-progress::-webkit-slider-runnable-track {
  height: 2px;
  background: linear-gradient(
    to right,
    #fff var(--cv3-video-progress),
    #ffffff60 var(--cv3-video-progress)
  );
}
.cv3-video-node-progress::-moz-range-track {
  height: 2px;
  background: #ffffff60;
}
.cv3-video-node-progress::-moz-range-progress {
  height: 2px;
  background: #fff;
}
.cv3-video-node-progress::-webkit-slider-thumb {
  width: 7px;
  height: 7px;
  margin-top: -2.5px;
  border: 0;
  border-radius: 50%;
  appearance: none;
  background: #fff;
}
.cv3-video-node-progress::-moz-range-thumb {
  width: 7px;
  height: 7px;
  border: 0;
  border-radius: 50%;
  background: #fff;
}
.cv3-video-node-volume,
.cv3-video-node-snapshot {
  position: relative;
  display: flex;
  flex: 0 0 auto;
}
.cv3-video-node-controls .cv3-video-node-snapshot-button {
  width: 32px;
  height: 32px;
  background: transparent;
}
.cv3-video-node-controls .cv3-video-node-snapshot-button svg {
  width: 18px;
  height: 18px;
}
.cv3-video-node-controls .cv3-video-node-snapshot-options {
  width: 12px;
  height: 32px;
  opacity: 0;
}
.cv3-video-node-controls .cv3-video-node-snapshot-options svg {
  width: 10px;
  height: 10px;
}
.cv3-video-node-snapshot:hover .cv3-video-node-snapshot-options,
.cv3-video-node-snapshot:focus-within .cv3-video-node-snapshot-options {
  opacity: 1;
}
.cv3-video-node-volume-popup {
  position: absolute;
  right: -11px;
  bottom: 25px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px;
  border: 1px solid #444;
  border-radius: 8px;
  color: #fff;
  background: #272727;
  font-size: 12px;
  opacity: 0;
  visibility: hidden;
}
.cv3-video-node-volume:hover .cv3-video-node-volume-popup,
.cv3-video-node-volume:focus-within .cv3-video-node-volume-popup {
  opacity: 1;
  visibility: visible;
}
.cv3-video-node-volume-popup input {
  width: 72px;
  accent-color: #fff;
}
.cv3-video-node-snapshot-menu {
  position: absolute;
  right: -2px;
  bottom: 30px;
  min-width: 124px;
  padding: 5px;
  border: 1px solid #424242;
  border-radius: 10px;
  background: #282828;
  box-shadow: 0 5px 16px #0005;
}
.cv3-video-node-snapshot-menu button {
  display: flex;
  justify-content: flex-start;
  width: 100%;
  height: 30px;
  padding: 0 9px;
  font-size: 12px;
  white-space: nowrap;
}
.cv3-video-node-error {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  padding: 20px;
  color: #e7c0b3;
  background: #202020d9;
  text-align: center;
  font-size: 13px;
}
@media (prefers-reduced-motion: reduce) {
  .cv3-video-node-controls {
    transition: none;
  }
}
@media (prefers-contrast: more) {
  .cv3-video-node-controls {
    background: #171717;
  }
}
</style>
