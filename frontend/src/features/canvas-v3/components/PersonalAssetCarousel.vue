<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  createCharacterDragNavigator,
  createCharacterWheelNavigator,
  stepCharacterSpring,
} from '../config/characterStudioCarousel.js'
import { personalAssetImageUrl } from '../config/personalAssetLibrary.js'

const props = defineProps({
  items: { type: Array, default: () => [] },
  activeId: { type: String, default: '' },
  selectedIds: { type: Array, default: () => [] },
  multiSelect: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  kind: { type: String, default: 'product' },
})
const emit = defineEmits(['activate', 'select'])
const singular = computed(() => (props.kind === 'scene' ? '场景' : '商品'))
const entries = computed(() => {
  const seen = new Set()
  return props.items.filter((item) => {
    if (
      !item ||
      typeof item.id !== 'string' ||
      !item.id ||
      seen.has(item.id) ||
      !(personalAssetImageUrl(item.imageUrl) || personalAssetImageUrl(item.coverUrl))
    )
      return false
    seen.add(item.id)
    return true
  })
})
const boundedIndex = (value) =>
  Math.max(0, Math.min(Math.max(0, entries.value.length - 1), Math.round(Number(value) || 0)))
const initialIndex = Math.max(
  0,
  entries.value.findIndex((item) => item.id === props.activeId),
)
const activeIndex = ref(initialIndex)
const position = ref(initialIndex)
const activeItem = computed(() => entries.value[activeIndex.value] || null)
const selected = computed(() => new Set(props.selectedIds))
const visibleItems = computed(() =>
  entries.value
    .map((item, index) => ({ item, index, offset: index - position.value }))
    .filter(({ index, offset }) => index === activeIndex.value || Math.abs(offset) <= 2.5),
)
const stage = ref(null)
const dragging = ref(false)
const reducedMotion = ref(false)
const stageSize = ref({ width: 1000, height: 420 })
const cardWidth = computed(() =>
  Math.max(
    120,
    Math.min(
      440,
      stageSize.value.width * 0.46,
      Math.max(120, stageSize.value.height - 64) * (4 / 3),
    ),
  ),
)
const cardStep = computed(() => cardWidth.value + Math.min(48, stageSize.value.width * 0.04))
const wheel = createCharacterWheelNavigator()
const drag = createCharacterDragNavigator()
const cardElements = new Map()
let pointerSession = null
let suppressPointerClick = false
let velocity = 0
let frameId = 0
let previousFrame = 0
let motionPreference
let resizeObserver
let mounted = false

function stopFrame() {
  if (frameId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frameId)
  frameId = 0
  previousFrame = 0
}
function snap() {
  stopFrame()
  velocity = 0
  position.value = activeIndex.value
}
function frame(time) {
  frameId = 0
  if (!mounted || pointerSession || props.disabled || reducedMotion.value) return
  const next = stepCharacterSpring(
    { position: position.value, velocity },
    activeIndex.value,
    previousFrame ? (time - previousFrame) / 1000 : 1 / 60,
  )
  previousFrame = time
  position.value = next.position
  velocity = next.velocity
  if (next.settled) {
    previousFrame = 0
    position.value = activeIndex.value
  } else frameId = requestAnimationFrame(frame)
}
function settle() {
  if (
    reducedMotion.value ||
    props.disabled ||
    typeof requestAnimationFrame !== 'function' ||
    (typeof document !== 'undefined' && document.hidden)
  )
    snap()
  else if (!frameId && Math.abs(position.value - activeIndex.value) > 0.0001) {
    previousFrame = 0
    frameId = requestAnimationFrame(frame)
  }
}
function releasePointer(session) {
  try {
    if (
      session?.element?.releasePointerCapture &&
      (!session.element.hasPointerCapture || session.element.hasPointerCapture(session.id))
    )
      session.element.releasePointerCapture(session.id)
  } catch {
    // A native cancellation may already have released capture.
  }
}
function cancelDrag() {
  const session = pointerSession
  pointerSession = null
  if (dragging.value) suppressPointerClick = true
  dragging.value = false
  drag.reset()
  releasePointer(session)
}
function setActive(
  value,
  { immediate = false, fromWheel = false, fromDrag = false, notify = true } = {},
) {
  if (props.disabled && notify) return
  if (!fromDrag) cancelDrag()
  if (!fromWheel) wheel.reset()
  const previous = activeIndex.value
  activeIndex.value = boundedIndex(value)
  if (notify && activeIndex.value !== previous && activeItem.value)
    emit('activate', activeItem.value.id)
  if (immediate || Math.abs(activeIndex.value - previous) > 3) snap()
  else settle()
}
function selectItem(item, index, event) {
  if (props.disabled || (suppressPointerClick && event?.detail !== 0)) return
  setActive(index)
  emit('select', item.id)
}
function itemStyle(offset) {
  const distance = Math.min(1, Math.abs(offset))
  return {
    width: `${cardWidth.value}px`,
    transform: `translate3d(${offset * cardStep.value}px, 0, 0) translate(-50%, -50%) scale(${1 - distance * 0.16})`,
    opacity: 1 - distance * 0.74,
    zIndex: Math.max(0, 10 - Math.round(Math.abs(offset) * 2)),
  }
}
function handleWheel(event) {
  if (
    props.disabled ||
    pointerSession ||
    entries.value.length < 2 ||
    event.defaultPrevented ||
    event.ctrlKey ||
    event.metaKey ||
    !Number.isFinite(event.deltaY) ||
    !event.deltaY ||
    !Number.isFinite(event.deltaX ?? 0) ||
    Math.abs(event.deltaX ?? 0) > Math.abs(event.deltaY)
  )
    return
  event.preventDefault()
  event.stopPropagation()
  const direction = wheel.consume(event, eventTime(event))
  if (direction) setActive(activeIndex.value + direction, { fromWheel: true })
}
function eventTime(event) {
  return Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now()
}
function pointerDown(event) {
  if (
    props.disabled ||
    pointerSession ||
    event.isPrimary === false ||
    (event.button ?? 0) !== 0 ||
    event.ctrlKey ||
    event.metaKey
  )
    return
  suppressPointerClick = false
  if (entries.value.length < 2) return
  if (
    !drag.start({
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      position: position.value,
      step: cardStep.value,
      max: entries.value.length - 1,
      now: eventTime(event),
    })
  )
    return
  stopFrame()
  wheel.reset()
  pointerSession = { id: event.pointerId, element: event.currentTarget }
}
function pointerMove(event) {
  if (!pointerSession || event.pointerId !== pointerSession.id) return
  const next = drag.move({
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    now: eventTime(event),
  })
  if (!next) return
  if (next.cancelled) {
    cancelDrag()
    settle()
    return
  }
  if (!dragging.value) {
    dragging.value = true
    try {
      pointerSession.element.setPointerCapture?.(event.pointerId)
    } catch {
      // Pointer capture may be unavailable after a native touch cancellation.
    }
  }
  suppressPointerClick = true
  event.preventDefault()
  event.stopPropagation()
  position.value = next.position
  velocity = reducedMotion.value ? 0 : next.velocity
  const previous = activeIndex.value
  activeIndex.value = boundedIndex(next.position)
  if (activeIndex.value !== previous) emit('activate', activeItem.value.id)
}
function pointerEnd(event, cancelled = false) {
  if (!pointerSession || event.pointerId !== pointerSession.id) return
  if (!cancelled && Number.isFinite(event.clientX) && Number.isFinite(event.clientY))
    pointerMove(event)
  if (!pointerSession) return
  const result = drag.end({ pointerId: event.pointerId, now: eventTime(event), cancelled })
  const session = pointerSession
  pointerSession = null
  dragging.value = false
  releasePointer(session)
  if (!result) return
  if (result.dragged) suppressPointerClick = true
  position.value = result.position
  velocity = reducedMotion.value ? 0 : result.velocity
  setActive(result.dragged ? result.index : activeIndex.value, { fromDrag: true })
}
function pointerLeave() {
  wheel.reset()
  if (pointerSession && !dragging.value) {
    cancelDrag()
    settle()
  }
}
function handleKey(event) {
  if (
    props.disabled ||
    event.defaultPrevented ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.target?.closest?.('input,select,textarea')
  )
    return
  const targets = {
    ArrowLeft: activeIndex.value - 1,
    ArrowRight: activeIndex.value + 1,
    Home: 0,
    End: entries.value.length - 1,
  }
  if (Object.hasOwn(targets, event.key)) {
    event.preventDefault()
    event.stopPropagation()
    setActive(targets[event.key])
    void nextTick(() => cardElements.get(activeItem.value?.id)?.focus?.({ preventScroll: true }))
  } else if (
    ['Enter', ' '].includes(event.key) &&
    event.target === event.currentTarget &&
    activeItem.value
  ) {
    event.preventDefault()
    selectItem(activeItem.value, activeIndex.value, { detail: 0 })
  }
}
function cardRef(id, element) {
  if (element) cardElements.set(id, element)
  else cardElements.delete(id)
}
function updateSize() {
  const bounds = stage.value?.getBoundingClientRect?.()
  if (bounds?.width > 0 && bounds?.height > 0)
    stageSize.value = { width: bounds.width, height: bounds.height }
}
function motionChanged(event) {
  reducedMotion.value = Boolean(event.matches)
  if (event.matches) {
    cancelDrag()
    snap()
  }
}
function suspend() {
  cancelDrag()
  wheel.reset()
  snap()
}
function visibilityChanged() {
  if (document.hidden) suspend()
}
watch(
  () => props.activeId,
  (id) => {
    const index = entries.value.findIndex((item) => item.id === id)
    if (index >= 0 && index !== activeIndex.value) setActive(index, { notify: false })
  },
)
watch(
  () => entries.value.map((item) => item.id).join('\0'),
  () => {
    cancelDrag()
    wheel.reset()
    const index = entries.value.findIndex((item) => item.id === props.activeId)
    activeIndex.value = index >= 0 ? index : boundedIndex(activeIndex.value)
    snap()
  },
)
watch(
  () => props.disabled,
  (disabled) => disabled && suspend(),
)
watch(() => props.kind, suspend)
onMounted(() => {
  mounted = true
  updateSize()
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(updateSize)
    if (stage.value) resizeObserver.observe(stage.value)
  }
  if (typeof window !== 'undefined') {
    motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (motionPreference) {
      motionChanged(motionPreference)
      if (motionPreference.addEventListener)
        motionPreference.addEventListener('change', motionChanged)
      else motionPreference.addListener?.(motionChanged)
    }
    window.addEventListener('blur', suspend)
    window.addEventListener('resize', updateSize)
  }
  if (typeof document !== 'undefined')
    document.addEventListener('visibilitychange', visibilityChanged)
})
onBeforeUnmount(() => {
  mounted = false
  suspend()
  resizeObserver?.disconnect()
  if (motionPreference?.removeEventListener)
    motionPreference.removeEventListener('change', motionChanged)
  else motionPreference?.removeListener?.(motionChanged)
  if (typeof window !== 'undefined') {
    window.removeEventListener('blur', suspend)
    window.removeEventListener('resize', updateSize)
  }
  if (typeof document !== 'undefined')
    document.removeEventListener('visibilitychange', visibilityChanged)
  cardElements.clear()
})
</script>

<template>
  <section
    class="cv3-personal-carousel"
    role="region"
    aria-roledescription="轮播列表"
    :aria-label="`${singular}列表`"
    :aria-disabled="disabled"
    :tabindex="disabled ? -1 : 0"
    @keydown="handleKey"
  >
    <div
      ref="stage"
      class="cv3-personal-carousel-stage"
      :class="{ 'is-dragging': dragging, 'is-disabled': disabled }"
      role="list"
      @wheel="handleWheel"
      @pointerdown="pointerDown"
      @pointermove="pointerMove"
      @pointerup="pointerEnd($event)"
      @pointercancel="pointerEnd($event, true)"
      @lostpointercapture="pointerEnd($event, true)"
      @pointerleave="pointerLeave"
      @dragstart.prevent
    >
      <div
        v-for="{ item, index, offset } in visibleItems"
        :key="item.id"
        class="cv3-personal-carousel-card"
        :class="{ 'is-current': index === activeIndex, 'is-selected': selected.has(item.id) }"
        :style="itemStyle(offset)"
        role="listitem"
      >
        <button
          :ref="(element) => cardRef(item.id, element)"
          type="button"
          class="cv3-personal-carousel-select"
          :role="multiSelect ? 'checkbox' : undefined"
          :aria-checked="multiSelect ? selected.has(item.id) : undefined"
          :aria-pressed="multiSelect ? undefined : index === activeIndex"
          :aria-current="index === activeIndex ? 'true' : undefined"
          :aria-label="`选择${item.name}`"
          :tabindex="index === activeIndex ? 0 : -1"
          :disabled="disabled"
          @click="selectItem(item, index, $event)"
        >
          <span class="cv3-personal-carousel-image">
            <img
              :src="personalAssetImageUrl(item.imageUrl) || personalAssetImageUrl(item.coverUrl)"
              :alt="item.name"
              draggable="false"
            />
            <span v-if="multiSelect" class="cv3-personal-carousel-check" aria-hidden="true">
              {{ selected.has(item.id) ? '✓' : '' }}
            </span>
          </span>
          <span class="cv3-personal-carousel-name" :title="item.name">{{ item.name }}</span>
        </button>
      </div>
      <p v-if="!entries.length" class="cv3-personal-carousel-empty">暂无{{ singular }}素材</p>
    </div>
    <button
      class="cv3-personal-carousel-arrow is-previous"
      type="button"
      :aria-label="`上一个${singular}`"
      :disabled="disabled || activeIndex <= 0 || !entries.length"
      @click="setActive(activeIndex - 1)"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m9.5 4-4 4 4 4" /></svg>
    </button>
    <button
      class="cv3-personal-carousel-arrow is-next"
      type="button"
      :aria-label="`下一个${singular}`"
      :disabled="disabled || activeIndex >= entries.length - 1"
      @click="setActive(activeIndex + 1)"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6.5 4 4 4-4 4" /></svg>
    </button>
    <label
      class="cv3-personal-carousel-scrubber"
      :class="{ 'is-disabled': disabled || entries.length < 2 }"
      :style="{
        '--personal-scroll-progress':
          entries.length > 1 ? Math.max(0, Math.min(1, position / (entries.length - 1))) : 0,
      }"
    >
      <i aria-hidden="true" />
      <input
        type="range"
        min="0"
        :max="Math.max(0, entries.length - 1)"
        step="1"
        :value="activeIndex"
        :disabled="disabled || entries.length < 2"
        :aria-label="`${singular}列表位置`"
        :aria-valuetext="`${entries.length ? activeIndex + 1 : 0} / ${entries.length} ${activeItem?.name || ''}`"
        @input="setActive($event.target.value, { immediate: true })"
      />
      <span class="cv3-personal-carousel-count" aria-live="polite">
        {{ entries.length ? activeIndex + 1 : 0 }} / {{ entries.length }}
      </span>
    </label>
  </section>
</template>

<style scoped>
.cv3-personal-carousel {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  outline: none;
}
.cv3-personal-carousel-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  touch-action: pan-y;
  user-select: none;
  cursor: grab;
}
.cv3-personal-carousel-stage.is-dragging,
.cv3-personal-carousel-stage.is-dragging button {
  cursor: grabbing;
}
.cv3-personal-carousel-stage.is-disabled {
  cursor: default;
}
.cv3-personal-carousel-card {
  position: absolute;
  top: 50%;
  left: 50%;
  transform-origin: center;
}
.cv3-personal-carousel-select {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: #f0f0f0;
  font: inherit;
  cursor: pointer;
}
.cv3-personal-carousel-image {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border-radius: 12px;
  background: transparent;
  outline: 1px solid #ffffff12;
  outline-offset: -1px;
}
.cv3-personal-carousel-image img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center;
  pointer-events: none;
}
.is-selected .cv3-personal-carousel-image {
  outline: 2px solid #e7e7e7;
}
.cv3-personal-carousel-select:focus-visible .cv3-personal-carousel-image {
  outline: 2px solid #b9d8ff;
  outline-offset: 3px;
}
.cv3-personal-carousel-name {
  max-width: 100%;
  margin-top: 22px;
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0;
}
.is-current .cv3-personal-carousel-name {
  opacity: 1;
}
.cv3-personal-carousel-check {
  position: absolute;
  top: 12px;
  right: 12px;
  display: grid;
  width: 20px;
  height: 20px;
  place-items: center;
  border: 1px solid #ffffffa6;
  border-radius: 5px;
  background: #242424;
  color: #242424;
  font-size: 14px;
}
.is-selected .cv3-personal-carousel-check {
  border-color: #fff;
  background: #fff;
}
.cv3-personal-carousel-arrow {
  position: absolute;
  z-index: 12;
  top: calc(50% - 30px);
  display: grid;
  width: 30px;
  height: 30px;
  padding: 7px;
  place-items: center;
  border: 1px solid #ffffff1a;
  border-radius: 50%;
  background: #ffffff0a;
  color: #e6e6e6;
  cursor: pointer;
}
.cv3-personal-carousel-arrow.is-previous {
  left: 20px;
}
.cv3-personal-carousel-arrow.is-next {
  right: 20px;
}
.cv3-personal-carousel-arrow svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.25;
}
.cv3-personal-carousel-arrow:hover:not(:disabled) {
  background: #ffffff14;
}
.cv3-personal-carousel-arrow:disabled {
  opacity: 0.3;
  cursor: default;
}
.cv3-personal-carousel-arrow:focus-visible {
  outline: 2px solid #b9d8ff;
  outline-offset: 3px;
}
.cv3-personal-carousel-scrubber {
  position: relative;
  display: block;
  flex: none;
  height: 24px;
  margin: 0 20px 2px;
}
.cv3-personal-carousel-scrubber i {
  position: absolute;
  top: 9px;
  left: calc(var(--personal-scroll-progress) * (100% - 96px));
  width: 96px;
  height: 6px;
  border-radius: 999px;
  background: #4b4b4b;
  pointer-events: none;
}
.cv3-personal-carousel-scrubber:hover i,
.cv3-personal-carousel-scrubber:focus-within i {
  background: #727272;
}
.cv3-personal-carousel-scrubber input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  appearance: none;
  background: transparent;
  color: transparent;
  cursor: ew-resize;
}
.cv3-personal-carousel-scrubber input::-webkit-slider-runnable-track {
  height: 6px;
  background: transparent;
}
.cv3-personal-carousel-scrubber input::-webkit-slider-thumb {
  width: 96px;
  height: 6px;
  appearance: none;
  border: none;
  border-radius: 999px;
  background: transparent;
}
.cv3-personal-carousel-scrubber input::-moz-range-track {
  height: 6px;
  background: transparent;
}
.cv3-personal-carousel-scrubber input::-moz-range-thumb {
  width: 96px;
  height: 6px;
  border: none;
  background: transparent;
}
.cv3-personal-carousel-scrubber input:focus-visible {
  outline: 1px solid #b9d8ff;
  outline-offset: 1px;
  border-radius: 6px;
}
.cv3-personal-carousel-scrubber.is-disabled i {
  opacity: 0.3;
}
.cv3-personal-carousel-count {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
.cv3-personal-carousel-empty {
  position: absolute;
  inset: 0;
  display: grid;
  margin: 0;
  place-items: center;
  color: #aaa;
  font-size: 13px;
}
@media (prefers-contrast: more) {
  .cv3-personal-carousel-image {
    outline-color: #777;
  }
  .cv3-personal-carousel-arrow {
    border-color: #888;
    background: #242424;
  }
}
@media (prefers-reduced-motion: reduce) {
  .cv3-personal-carousel-card {
    will-change: auto;
  }
}
</style>
