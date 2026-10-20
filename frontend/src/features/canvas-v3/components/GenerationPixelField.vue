<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  GENERATION_DOT_FPS,
  GENERATION_DOT_OFFSET,
  GENERATION_DOT_RADIUS,
  GENERATION_DOT_STEP,
  generationDotOpacity,
  generationDotSeed,
} from '../config/generationPixelField.js'

const props = defineProps({ seed: { type: String, default: 'canvas-generation' } })
const field = ref(null)
const canvas = ref(null)
let context
let view
let document
let resizeObserver
let intersectionObserver
let motionPreference
let reducedMotion = false
let inView = false
let width = 0
let height = 0
let frameId = 0
let elapsed = 0
let previousTick = null
let previousPaint = null
let disposed = false
let seed = generationDotSeed(props.seed)

function paint() {
  if (!context || !width || !height || disposed || document?.hidden) return
  context.clearRect(0, 0, width, height)
  for (let y = GENERATION_DOT_OFFSET; y < height; y += GENERATION_DOT_STEP) {
    for (let x = GENERATION_DOT_OFFSET; x < width; x += GENERATION_DOT_STEP) {
      const opacity = generationDotOpacity(seed, x / width, y / height, reducedMotion ? 0 : elapsed)
      if (opacity < 0.006) continue
      context.fillStyle = `rgba(174, 180, 188, ${opacity.toFixed(3)})`
      context.beginPath()
      context.arc(x, y, GENERATION_DOT_RADIUS, 0, Math.PI * 2)
      context.fill()
    }
  }
}

function canAnimate() {
  return Boolean(
    !disposed &&
    context &&
    width &&
    height &&
    inView &&
    !document?.hidden &&
    !reducedMotion &&
    view?.requestAnimationFrame,
  )
}

function stop() {
  if (frameId) view?.cancelAnimationFrame?.(frameId)
  frameId = 0
  previousTick = null
  previousPaint = null
}

function tick(timestamp) {
  frameId = 0
  if (!canAnimate()) return
  if (previousTick !== null) elapsed += Math.min(100, Math.max(0, timestamp - previousTick))
  previousTick = timestamp
  if (previousPaint === null || timestamp - previousPaint >= 1000 / GENERATION_DOT_FPS) {
    paint()
    previousPaint = timestamp
  }
  frameId = view.requestAnimationFrame(tick)
}

function synchronize() {
  if (!canAnimate()) {
    stop()
    if (reducedMotion && inView) paint()
  } else if (!frameId) {
    frameId = view.requestAnimationFrame(tick)
  }
}

function resize(rect) {
  if (disposed || !field.value || !canvas.value) return
  width = Math.max(0, Number(rect?.width ?? field.value.clientWidth) || 0)
  height = Math.max(0, Number(rect?.height ?? field.value.clientHeight) || 0)
  // Preserve the delicate 1.4px dots without allocating huge high-DPI buffers.
  const density = Math.min(
    1.5,
    Math.max(1, view?.devicePixelRatio || 1),
    Math.sqrt(1000000 / Math.max(1, width * height)),
  )
  canvas.value.width = Math.round(width * density)
  canvas.value.height = Math.round(height * density)
  context?.setTransform(density, 0, 0, density, 0, 0)
  paint()
  synchronize()
}

function resizeFromWindow() {
  resize()
}

function motionChanged() {
  reducedMotion = Boolean(motionPreference?.matches)
  synchronize()
}

watch(
  () => props.seed,
  (value) => {
    seed = generationDotSeed(value)
    if (inView) paint()
  },
)

onMounted(() => {
  view = globalThis.window
  document = globalThis.document
  try {
    context = canvas.value?.getContext?.('2d', { alpha: true })
  } catch {
    // The CSS field is a static fallback for environments without Canvas 2D.
  }
  motionPreference = view?.matchMedia?.('(prefers-reduced-motion: reduce)')
  reducedMotion = Boolean(motionPreference?.matches)
  if (motionPreference?.addEventListener) motionPreference.addEventListener('change', motionChanged)
  else motionPreference?.addListener?.(motionChanged)
  document?.addEventListener?.('visibilitychange', synchronize)
  view?.addEventListener?.('resize', resizeFromWindow)

  const Resize = view?.ResizeObserver || globalThis.ResizeObserver
  if (Resize) {
    resizeObserver = new Resize((entries) => {
      const entry = entries.find((item) => item.target === field.value)
      if (entry) resize(entry.contentRect)
    })
    resizeObserver.observe(field.value)
  }
  const Intersection = view?.IntersectionObserver || globalThis.IntersectionObserver
  if (Intersection) {
    intersectionObserver = new Intersection((entries) => {
      if (disposed) return
      const entry = entries.find((item) => item.target === field.value)
      if (!entry) return
      inView = entry.isIntersecting
      synchronize()
    })
    intersectionObserver.observe(field.value)
  }
  // Without IntersectionObserver, use the static field instead of running an
  // animation that cannot reliably stop when a node leaves the viewport.
  resize()
})

onBeforeUnmount(() => {
  disposed = true
  stop()
  resizeObserver?.disconnect()
  intersectionObserver?.disconnect()
  document?.removeEventListener?.('visibilitychange', synchronize)
  view?.removeEventListener?.('resize', resizeFromWindow)
  if (motionPreference?.removeEventListener)
    motionPreference.removeEventListener('change', motionChanged)
  else motionPreference?.removeListener?.(motionChanged)
  context = null
})
</script>

<template>
  <div ref="field" class="cv3-generation-pixel-field" aria-hidden="true">
    <canvas ref="canvas" class="cv3-generation-pixel-canvas" />
  </div>
</template>

<style scoped>
.cv3-generation-pixel-field {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: inherit;
  pointer-events: none;
  background: var(--cv3-generation-surface, #242527);
}
.cv3-generation-pixel-canvas {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .cv3-generation-pixel-field {
    animation: none;
  }
}
</style>
