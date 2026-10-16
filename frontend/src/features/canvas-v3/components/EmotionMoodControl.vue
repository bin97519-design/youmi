<script setup>
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import { emotionAt } from '../config/portraitEmotion'
import {
  createEmotionMotion,
  emotionOpacities,
  emotionWeights,
  moodPosition,
} from '../config/emotionMotion'

const props = defineProps({
  roleId: { type: String, required: true },
  x: { type: Number, default: 50 },
  y: { type: Number, default: 50 },
})
const emit = defineEmits(['select'])
const points = Array.from({ length: 25 }, (_, i) =>
  emotionAt(10 + (i % 5) * 20, 10 + Math.floor(i / 5) * 20),
)
const position = shallowRef(moodPosition(props.x, props.y))
const loaded = shallowRef(new Set())
const media = window.matchMedia('(prefers-reduced-motion: reduce)')
const reduced = shallowRef(media.matches)
const mood = computed(() => emotionAt(props.x, props.y))
let gesture = null
let disposed = false
const motion = createEmotionMotion({
  initial: position.value,
  render: (point) => (position.value = point),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (id) => cancelAnimationFrame(id),
  reducedMotion: () => reduced.value,
})
const layers = computed(() => {
  const p = reduced.value ? emotionAt(position.value.x, position.value.y) : position.value
  const weights = emotionWeights(p.x, p.y).map((w, i) => (loaded.value.has(i) ? w : 0))
  return emotionOpacities(weights)
})
const knobStyle = computed(() => ({
  transform: `translate3d(${position.value.x * 1.5}px, ${position.value.y * 1.5}px, 0) translate(-50%, -50%)`,
}))

async function decoded(event, index) {
  try {
    await event.target.decode()
    if (!disposed) loaded.value = new Set([...loaded.value, index])
  } catch {
    // Leave the stable neutral preview visible if an individual asset cannot decode.
  }
}
function select(x, y) {
  const point = emotionAt(x, y)
  motion.to(point.x, point.y)
  emit('select', point.x, point.y)
}
function pointerPoint(event) {
  const rect = event.currentTarget.getBoundingClientRect()
  return {
    x: ((event.clientX - rect.left) / rect.width) * 100,
    y: ((event.clientY - rect.top) / rect.height) * 100,
  }
}
function start(event) {
  if (event.button !== 0 || gesture) return
  event.preventDefault()
  const point = pointerPoint(event)
  const grabbed = Math.hypot(point.x - position.value.x, point.y - position.value.y) <= 7
  gesture = {
    id: event.pointerId,
    start: { x: event.clientX, y: event.clientY },
    offset: grabbed
      ? { x: point.x - position.value.x, y: point.y - position.value.y }
      : { x: 0, y: 0 },
    dragged: false,
  }
  event.currentTarget.setPointerCapture(event.pointerId)
  event.currentTarget.focus({ preventScroll: true })
  if (grabbed) motion.follow(position.value.x, position.value.y, event.timeStamp)
  else select(point.x, point.y)
}
function drag(event) {
  if (gesture?.id !== event.pointerId) return
  if (
    !gesture.dragged &&
    Math.hypot(event.clientX - gesture.start.x, event.clientY - gesture.start.y) < 2
  )
    return
  gesture.dragged = true
  const point = pointerPoint(event)
  const next = moodPosition(point.x - gesture.offset.x, point.y - gesture.offset.y)
  motion.follow(next.x, next.y, event.timeStamp)
  const nearest = emotionAt(next.x, next.y)
  emit('select', nearest.x, nearest.y)
}
function end(event, cancelled = false) {
  if (gesture?.id !== event.pointerId) return
  if (gesture.dragged && !cancelled) drag(event)
  const nearest = gesture.dragged ? emotionAt(position.value.x, position.value.y) : mood.value
  gesture = null
  motion.release(nearest.x, nearest.y, event.timeStamp, cancelled)
  emit('select', nearest.x, nearest.y)
  if (event.currentTarget.hasPointerCapture(event.pointerId))
    event.currentTarget.releasePointerCapture(event.pointerId)
}
function keyboard(event) {
  const direction = {
    ArrowLeft: [-20, 0],
    ArrowRight: [20, 0],
    ArrowUp: [0, -20],
    ArrowDown: [0, 20],
  }[event.key]
  if (!direction) return
  event.preventDefault()
  select(props.x + direction[0], props.y + direction[1])
}
function updatePreference() {
  reduced.value = media.matches
  motion.to(props.x, props.y, true)
}
watch(
  () => [props.roleId, props.x, props.y],
  (next, previous) => {
    if (next[0] !== previous[0]) gesture = null
    if (!gesture) motion.to(next[1], next[2], next[0] !== previous[0])
  },
)
onMounted(() => media.addEventListener('change', updatePreference))
onBeforeUnmount(() => {
  disposed = true
  gesture = null
  motion.dispose()
  media.removeEventListener('change', updatePreference)
})
</script>

<template>
  <div class="cv3-emotion-controls">
    <div class="cv3-emotion-preview" role="img" :aria-label="mood.label + '表情示意'">
      <img :src="points[12].preview" alt="" draggable="false" fetchpriority="high" />
      <img
        v-for="(point, i) in points"
        :key="point.x + '-' + point.y"
        :src="point.preview"
        alt=""
        draggable="false"
        decoding="async"
        :style="{ opacity: layers[i], willChange: layers[i] > 0 ? 'opacity' : 'auto' }"
        @load="decoded($event, i)"
      />
      <small>表情示意 · 生成后查看实际效果</small>
    </div>
    <span class="cv3-emotion-divider" />
    <div class="cv3-mood-board">
      <span class="axis-top">激动</span>
      <span class="axis-bottom">平静</span>
      <span class="axis-left">亲近</span>
      <span class="axis-right">疏离</span>
      <div
        class="cv3-mood-grid"
        role="group"
        aria-label="情绪定位区"
        tabindex="0"
        @pointerdown="start"
        @pointermove="drag"
        @pointerup="end($event)"
        @pointercancel="end($event, true)"
        @lostpointercapture="end($event, true)"
        @keydown="keyboard"
      >
        <button
          v-for="point in points"
          :key="point.x + '-' + point.y"
          type="button"
          :aria-label="point.label"
          :aria-pressed="mood.x === point.x && mood.y === point.y"
          :title="point.label"
          :style="{ left: point.x + '%', top: point.y + '%' }"
          :class="{
            center: point.x === 50 && point.y === 50,
            selected: mood.x === point.x && mood.y === point.y,
          }"
          @click="!$event.detail && select(point.x, point.y)"
        />
        <span class="cv3-mood-knob" :style="knobStyle" />
      </div>
    </div>
  </div>
  <p class="cv3-emotion-location">
    <span>情绪定位</span>
    <strong aria-live="polite">{{ mood.label }}</strong>
  </p>
</template>
