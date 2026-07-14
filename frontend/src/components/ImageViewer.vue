<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  images: { type: Array, default: () => [] },
  startIndex: { type: Number, default: 0 },
})

const emit = defineEmits(['close', 'download', 'change'])
const overlayRef = ref(null)
const imageRef = ref(null)
const state = reactive({
  index: 0,
  rotation: 0,
  flipX: false,
  flipY: false,
  scale: 1,
  translateX: 0,
  translateY: 0,
  dragging: false,
  dragStartX: 0,
  dragStartY: 0,
})

const normalizedImages = computed(() =>
  props.images
    .map((image, index) =>
      typeof image === 'string'
        ? { url: image, name: `图片 ${index + 1}` }
        : { url: image?.url || '', name: image?.name || `图片 ${index + 1}` },
    )
    .filter((image) => image.url),
)
const currentImage = computed(
  () => normalizedImages.value[state.index] || { url: '', name: '图片' },
)

let transformFrame = null
let pendingTransform = null
let dragBaseX = 0
let dragBaseY = 0
let captureElement = null

function transformValue(
  translateX = state.translateX,
  translateY = state.translateY,
  scale = state.scale,
) {
  return `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale}) rotate(${state.rotation}deg) scaleX(${state.flipX ? -1 : 1}) scaleY(${state.flipY ? -1 : 1})`
}

function applyTransform(
  translateX = state.translateX,
  translateY = state.translateY,
  scale = state.scale,
) {
  if (imageRef.value) imageRef.value.style.transform = transformValue(translateX, translateY, scale)
}

function queueTransform(translateX, translateY, scale = state.scale) {
  pendingTransform = { translateX, translateY, scale }
  if (transformFrame !== null) return
  transformFrame = requestAnimationFrame(() => {
    transformFrame = null
    const pending = pendingTransform
    pendingTransform = null
    if (pending) applyTransform(pending.translateX, pending.translateY, pending.scale)
  })
}

function cancelTransformFrame() {
  if (transformFrame !== null) cancelAnimationFrame(transformFrame)
  transformFrame = null
  pendingTransform = null
}

function resetTransform() {
  cancelTransformFrame()
  state.rotation = 0
  state.flipX = false
  state.flipY = false
  state.scale = 1
  state.translateX = 0
  state.translateY = 0
  nextTick(applyTransform)
}

function close() {
  stopDrag()
  cancelTransformFrame()
  emit('close')
}

function switchImage(step) {
  const total = normalizedImages.value.length
  if (total < 2) return
  state.index = (state.index + step + total) % total
  resetTransform()
  emit('change', state.index)
}

function zoom(delta) {
  state.scale = Math.max(0.25, Math.min(4, state.scale + delta))
  applyTransform()
}

function onWheel(event) {
  const factor = event.deltaY > 0 ? 0.9 : 1.1
  state.scale = Math.max(0.25, Math.min(4, state.scale * factor))
  queueTransform(state.translateX, state.translateY, state.scale)
}

function rotate(degrees) {
  state.rotation += degrees
  applyTransform()
}

function flip(axis) {
  if (axis === 'x') state.flipX = !state.flipX
  else state.flipY = !state.flipY
  applyTransform()
}

function startDrag(event) {
  if (event.button !== 0 || event.target.closest('button')) return
  event.preventDefault()
  state.dragging = true
  state.dragStartX = event.clientX
  state.dragStartY = event.clientY
  dragBaseX = state.translateX
  dragBaseY = state.translateY
  try {
    event.currentTarget.setPointerCapture(event.pointerId)
    captureElement = event.currentTarget
  } catch {
    captureElement = null
  }
  imageRef.value?.classList.add('is-dragging')
  window.addEventListener('pointermove', moveDrag)
  window.addEventListener('pointerup', stopDrag)
  window.addEventListener('pointercancel', stopDrag)
}

function moveDrag(event) {
  if (!state.dragging) return
  queueTransform(
    dragBaseX + event.clientX - state.dragStartX,
    dragBaseY + event.clientY - state.dragStartY,
  )
}

function stopDrag(event) {
  if (!state.dragging) return
  if (event) {
    state.translateX = dragBaseX + event.clientX - state.dragStartX
    state.translateY = dragBaseY + event.clientY - state.dragStartY
  }
  state.dragging = false
  cancelTransformFrame()
  applyTransform()
  imageRef.value?.classList.remove('is-dragging')
  try {
    if (event && captureElement?.hasPointerCapture?.(event.pointerId)) {
      captureElement.releasePointerCapture(event.pointerId)
    }
  } catch {
    captureElement = null
  }
  captureElement = null
  window.removeEventListener('pointermove', moveDrag)
  window.removeEventListener('pointerup', stopDrag)
  window.removeEventListener('pointercancel', stopDrag)
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    const maxIndex = Math.max(0, normalizedImages.value.length - 1)
    state.index = Math.min(Math.max(0, props.startIndex), maxIndex)
    resetTransform()
    nextTick(() => overlayRef.value?.focus())
  },
)

watch(
  () => props.startIndex,
  (index) => {
    if (!props.open) return
    state.index = Math.min(Math.max(0, index), Math.max(0, normalizedImages.value.length - 1))
    resetTransform()
  },
)

onBeforeUnmount(() => {
  stopDrag()
  cancelTransformFrame()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && currentImage.url"
      ref="overlayRef"
      class="uc-image-viewer-overlay"
      role="dialog"
      aria-modal="true"
      tabindex="0"
      @click.self="close"
      @keydown.escape="close"
      @keydown.left="switchImage(-1)"
      @keydown.right="switchImage(1)"
    >
      <div class="uc-image-viewer-container">
        <button
          class="uc-image-viewer-close"
          type="button"
          title="关闭"
          aria-label="关闭图片预览"
          @click="close"
        >
          <i class="ri-close-line"></i>
        </button>

        <div
          class="uc-image-viewer-content"
          :style="{ cursor: state.dragging ? 'grabbing' : 'grab' }"
          @wheel.prevent="onWheel"
          @pointerdown="startDrag"
        >
          <button
            v-if="normalizedImages.length > 1"
            class="uc-image-viewer-nav uc-image-viewer-nav-prev"
            type="button"
            title="上一张 (←)"
            @click.stop="switchImage(-1)"
          >
            <i class="ri-arrow-left-s-line"></i>
          </button>
          <img ref="imageRef" :src="currentImage.url" :alt="currentImage.name" draggable="false" />
          <button
            v-if="normalizedImages.length > 1"
            class="uc-image-viewer-nav uc-image-viewer-nav-next"
            type="button"
            title="下一张 (→)"
            @click.stop="switchImage(1)"
          >
            <i class="ri-arrow-right-s-line"></i>
          </button>
        </div>

        <div class="uc-image-viewer-toolbar">
          <button class="uc-viewer-tool-btn" type="button" title="左右翻转" @click="flip('x')">
            <i class="ri-arrow-left-right-line"></i>
          </button>
          <button class="uc-viewer-tool-btn" type="button" title="上下翻转" @click="flip('y')">
            <i class="ri-arrow-up-down-line"></i>
          </button>
          <div class="uc-viewer-tool-divider"></div>
          <button class="uc-viewer-tool-btn" type="button" title="左旋转" @click="rotate(-90)">
            <i class="ri-arrow-go-back-line"></i>
          </button>
          <button class="uc-viewer-tool-btn" type="button" title="右旋转" @click="rotate(90)">
            <i class="ri-arrow-go-forward-line"></i>
          </button>
          <div class="uc-viewer-tool-divider"></div>
          <button class="uc-viewer-tool-btn" type="button" title="缩小" @click="zoom(-0.25)">
            <i class="ri-zoom-out-line"></i>
          </button>
          <button class="uc-viewer-tool-btn" type="button" title="放大" @click="zoom(0.25)">
            <i class="ri-zoom-in-line"></i>
          </button>
          <div class="uc-viewer-tool-divider"></div>
          <button
            class="uc-viewer-tool-btn"
            type="button"
            title="下载"
            @click="emit('download', currentImage)"
          >
            <i class="ri-download-line"></i>
          </button>
        </div>

        <div v-if="normalizedImages.length > 1" class="uc-image-viewer-page">
          {{ state.index + 1 }} / {{ normalizedImages.length }}
        </div>
      </div>
    </div>
  </Teleport>
</template>
